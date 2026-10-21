"""Private v2 service; run on 127.0.0.1, never as an unauthenticated public API.

Raw JSON avoids multipart spooling PDF uploads to disk. Request limits apply
while streaming, before decoding/parsing. CPU validation runs in a killable
subprocess. No CORS, analytics, access logs, PDF files or exception dumps.
"""
import asyncio
import hmac
import json
import os
from pathlib import Path
import sys
from fastapi import FastAPI, HTTPException, Request
from validator.v2_policy import load_policy, PolicyFailure

MAX_REQUEST = 29 * 1024 * 1024
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
slots = asyncio.Semaphore(1)


def enabled():
    return (os.getenv("EXTERNAL_SIGNATURE_ENABLED") == "true" or os.getenv("DIRECT_P12_SIGNING_ENABLED") == "true") and os.getenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED") == "true"


def authorize(request):
    key = os.getenv("V2_VALIDATOR_TOKEN", "")
    if not enabled() or len(key) < 32 or not os.getenv("V2_TRUST_POLICY_FILE"):
        raise HTTPException(503, "VALIDATOR_DISABLED")
    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + key):
        raise HTTPException(401, "UNAUTHORIZED")


@app.get("/health")
async def health():
    return {"enabled": enabled(), "policy": "leapsign-v2-ecuador-strict-1"}


@app.get("/ready")
async def ready():
    try:
        loaded = load_policy(os.environ["V2_TRUST_POLICY_FILE"])
        return {"ready": True, "policy": loaded["id"], "authorities": loaded["authorities"]}
    except (KeyError, PolicyFailure):
        raise HTTPException(503, "VALIDATOR_NOT_READY") from None


async def run_private_worker(request: Request, *, operation=None, output_limit=65536):
    authorize(request)
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "JSON_REQUIRED")
    size = request.headers.get("content-length")
    if size and (not size.isascii() or not size.isdigit() or int(size) > MAX_REQUEST):
        raise HTTPException(413, "REQUEST_TOO_LARGE")
    if slots.locked():
        raise HTTPException(429, "VALIDATOR_BUSY")
    async with slots:
        content = bytearray()
        process = None
        try:
            async with asyncio.timeout(15):
                async for part in request.stream():
                    if len(content) + len(part) > MAX_REQUEST:
                        raise HTTPException(413, "REQUEST_TOO_LARGE")
                    content.extend(part)
            if operation:
                try:
                    payload = json.loads(content)
                    if not isinstance(payload, dict):
                        payload = {"invalid": True}
                except Exception:
                    payload = {"invalid": True}
                payload["operation"] = operation
                content = bytearray(json.dumps(payload).encode())
            # Pass only public trust configuration to the child, not API keys.
            environment = {"V2_TRUST_POLICY_FILE": os.environ["V2_TRUST_POLICY_FILE"], "PYTHONPATH": str(Path(__file__).resolve().parent.parent)}
            process = await asyncio.create_subprocess_exec(sys.executable, "-m", "validator.v2_worker",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, env=environment, cwd=Path(__file__).resolve().parent.parent)
            output, _ = await asyncio.wait_for(process.communicate(content), timeout=20)
            if process.returncode or len(output) > output_limit:
                raise HTTPException(503, "VALIDATION_UNAVAILABLE")
            result = json.loads(output)
            # Known normalized failures only; nothing from a client crypto report.
            return result
        except TimeoutError:
            raise HTTPException(503, "VALIDATION_TIMEOUT") from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "VALIDATION_UNAVAILABLE") from None
        finally:
            content.clear()
            if process and process.returncode is None:
                process.kill()
                await process.wait()


@app.post("/validate")
async def validate(request: Request):
    return await run_private_worker(request)


@app.post("/prepare")
async def prepare(request: Request):
    # A 10 MiB PDF expands to less than 14 MiB as base64. Keep the response
    # bounded independently from validation's small JSON report.
    return await run_private_worker(request, operation="prepare", output_limit=15 * 1024 * 1024)
