"""One bounded subprocess per private validation request. No outgoing network."""
import base64
import json
import os
from pathlib import Path
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))

from validator.v2_engine import prepare_document, validate_pair, ValidationFailure


def policy():
    manifest = Path(os.environ["V2_TRUST_POLICY_FILE"])
    if manifest.stat().st_size > 65536:
        raise ValidationFailure("TRUST_POLICY_REQUIRED")
    config = json.loads(manifest.read_bytes())
    if config.get("version") != 1:
        raise ValidationFailure("TRUST_POLICY_REQUIRED")
    result = {}
    for key in ("trust_roots", "crls", "ocsps"):
        names = config.get(key, [])
        if not isinstance(names, list) or len(names) > 16:
            raise ValidationFailure("TRUST_POLICY_REQUIRED")
        values = []
        for name in names:
            if not isinstance(name, str) or Path(name).name != name or name in (".", ".."):
                raise ValidationFailure("TRUST_POLICY_REQUIRED")
            file = manifest.parent / name
            if file.is_symlink() or not 0 < file.stat().st_size <= 2 * 1024 * 1024:
                raise ValidationFailure("TRUST_POLICY_REQUIRED")
            values.append(file.read_bytes())
        result[key] = values
    return result


def run():
    try:
        payload = json.loads(sys.stdin.buffer.read(29 * 1024 * 1024 + 1))
        if isinstance(payload, dict) and payload.get("operation") == "prepare":
            if set(payload) != {"operation", "pdf"} or not isinstance(payload["pdf"], str):
                raise ValidationFailure("INVALID_REQUEST")
            prepared = prepare_document(base64.b64decode(payload["pdf"], validate=True))
            prepared["pdf"] = base64.b64encode(prepared["pdf"]).decode()
            sys.stdout.write(json.dumps(prepared))
            return
        allowed = {"previous", "candidate", "baseSha256", "expectedFingerprint", "position"}
        if not isinstance(payload, dict) or set(payload) - allowed or not {"previous", "candidate", "baseSha256", "position"}.issubset(payload) or not isinstance(payload["position"], dict):
            raise ValidationFailure("INVALID_REQUEST")
        previous = base64.b64decode(payload["previous"], validate=True)
        candidate = base64.b64decode(payload["candidate"], validate=True)
        result = validate_pair(previous, candidate, base_sha256=payload["baseSha256"],
                               expected_fingerprint=payload.get("expectedFingerprint"),
                               position=payload.get("position"), **policy())
        sys.stdout.write(json.dumps(result))
    except ValidationFailure as error:
        sys.stdout.write(json.dumps({"valid": False, "error": str(error)}))
    except Exception:
        sys.stdout.write(json.dumps({"valid": False, "error": "VALIDATION_UNAVAILABLE"}))


if __name__ == "__main__":
    run()
