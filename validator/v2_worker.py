"""One bounded subprocess per private validation request. No outgoing network."""
import base64
import json
import os
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))

from validator.v2_engine import prepare_document, validate_pair, ValidationFailure
from validator.v2_policy import load_policy, PolicyFailure


def policy():
    try:
        loaded = load_policy(os.environ["V2_TRUST_POLICY_FILE"])
        return {key: loaded[key] for key in ("trust_roots", "intermediates", "crls", "ocsps")}
    except (KeyError, PolicyFailure):
        raise ValidationFailure("TRUST_POLICY_REQUIRED") from None


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
