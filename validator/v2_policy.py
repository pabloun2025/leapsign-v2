"""Deterministic loader for public v2 trust material.

The manifest, never a PDF or browser payload, is the only authority for trust.
Every referenced byte is local, bounded and pinned by SHA-256.
"""
from hashlib import sha256
import json
from pathlib import Path

from asn1crypto import crl, ocsp, x509


class PolicyFailure(Exception):
    pass


_ACCEPTANCE = {
    "cryptographicIntegrity": "required",
    "chainTrust": "required",
    "certificateValidity": "required_at_server_receipt",
    "revocation": "verified_good_required",
}


def _record(value):
    return value if isinstance(value, dict) else None


def _material(base: Path, entry, parser):
    entry = _record(entry)
    if not entry or not isinstance(entry.get("file"), str) or not isinstance(entry.get("sha256"), str):
        raise PolicyFailure("TRUST_POLICY_REQUIRED")
    relative = Path(entry["file"])
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise PolicyFailure("TRUST_POLICY_REQUIRED")
    path = base / relative
    try:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 2 * 1024 * 1024:
            raise PolicyFailure("TRUST_POLICY_REQUIRED")
        data = path.read_bytes()
    except (OSError, ValueError):
        raise PolicyFailure("TRUST_POLICY_REQUIRED") from None
    if len(entry["sha256"]) != 64 or sha256(data).hexdigest() != entry["sha256"]:
        raise PolicyFailure("TRUST_POLICY_REQUIRED")
    try:
        parser.load(data)
    except Exception:
        raise PolicyFailure("TRUST_POLICY_REQUIRED") from None
    return data


def load_policy(manifest_path: str | Path):
    manifest = Path(manifest_path)
    try:
        if manifest.is_symlink() or not manifest.is_file() or not 0 < manifest.stat().st_size <= 65536:
            raise PolicyFailure("TRUST_POLICY_REQUIRED")
        config = json.loads(manifest.read_bytes())
    except (OSError, ValueError, json.JSONDecodeError):
        raise PolicyFailure("TRUST_POLICY_REQUIRED") from None
    if (not isinstance(config, dict) or config.get("version") != 2
            or not isinstance(config.get("id"), str) or not config["id"].startswith("leapsign-v2-")
            or config.get("legalOutcome") != "not_determined_by_software"
            or config.get("acceptance") != _ACCEPTANCE
            or not isinstance(config.get("authorities"), list)
            or not 1 <= len(config["authorities"]) <= 16):
        raise PolicyFailure("TRUST_POLICY_REQUIRED")
    result = {"id": config["id"], "authorities": [], "trust_roots": [],
              "intermediates": [], "crls": [], "ocsps": []}
    for authority in config["authorities"]:
        authority = _record(authority)
        if (not authority or not isinstance(authority.get("id"), str)
                or authority["id"] in result["authorities"]
                or not isinstance(authority.get("revocationHosts"), list)
                or not all(isinstance(host, str) and host and "/" not in host for host in authority["revocationHosts"])):
            raise PolicyFailure("TRUST_POLICY_REQUIRED")
        result["authorities"].append(authority["id"])
        groups = (("trustAnchors", "trust_roots", x509.Certificate),
                  ("intermediates", "intermediates", x509.Certificate),
                  ("revocation", "crls", crl.CertificateList))
        for source_name, target_name, parser in groups:
            entries = authority.get(source_name)
            if not isinstance(entries, list) or len(entries) > 16 or (source_name == "trustAnchors" and not entries):
                raise PolicyFailure("TRUST_POLICY_REQUIRED")
            result[target_name].extend(_material(manifest.parent, entry, parser) for entry in entries)
        responses = authority.get("ocsps", [])
        if not isinstance(responses, list) or len(responses) > 16:
            raise PolicyFailure("TRUST_POLICY_REQUIRED")
        result["ocsps"].extend(_material(manifest.parent, entry, ocsp.OCSPResponse) for entry in responses)
    if not result["trust_roots"] or not (result["crls"] or result["ocsps"]):
        raise PolicyFailure("TRUST_POLICY_REQUIRED")
    return result
