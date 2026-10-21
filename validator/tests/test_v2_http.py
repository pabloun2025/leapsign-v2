from fastapi.testclient import TestClient
from validator.v2_app import app
from validator.tests.test_v2_engine import sample
import base64
import json
import pytest
from hashlib import sha256
from pathlib import Path


def write_test_policy(path, root, crl):
    (path / "root.der").write_bytes(root)
    (path / "revocations.der").write_bytes(crl)
    source = {
        "repository": "https://example.invalid/test-only",
        "commit": "0" * 40,
        "originalPath": "synthetic-test-fixture.java",
        "commitDate": "2026-01-01T00:00:00+00:00",
        "license": "test-only",
    }
    entry = lambda file, data: {
        "file": file,
        "sha256": sha256(data).hexdigest(),
        "incorporatedAt": "2026-01-01T00:00:00+00:00",
        "source": source,
    }
    manifest = path / "policy.json"
    manifest.write_text(json.dumps({
        "version": 2,
        "id": "leapsign-v2-synthetic-test-only",
        "incorporatedAt": "2026-01-01T00:00:00+00:00",
        "legalOutcome": "not_determined_by_software",
        "acceptance": {
            "cryptographicIntegrity": "required",
            "chainTrust": "required",
            "certificateValidity": "required_at_server_receipt",
            "revocation": "verified_good_required",
        },
        "authorities": [{
            "id": "synthetic-test-only", "name": "Synthetic test CA",
            "compatibility": "test_only", "revocationHosts": [],
            "trustAnchors": [entry("root.der", root)], "intermediates": [],
            "revocation": [entry("revocations.der", crl)],
        }],
    }))
    return manifest


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("EXTERNAL_SIGNATURE_ENABLED", raising=False)
    monkeypatch.delenv("DIRECT_P12_SIGNING_ENABLED", raising=False)
    monkeypatch.delenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", raising=False)
    with TestClient(app) as client:
        assert client.post("/validate", json={}).status_code == 503


def test_requires_service_authentication(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        assert client.post("/validate", json={}).status_code == 401
        assert client.post("/validate", json={}, headers={"Authorization": "Bearer " + "x" * 32}).json()["valid"] is False


def test_body_limit_before_read(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        response = client.post("/validate", content=b"{}", headers={"Authorization": "Bearer " + "x" * 32, "Content-Type": "application/json", "Content-Length": "999999999"})
        assert response.status_code == 413


def test_certificate_or_password_fields_are_rejected(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        response = client.post("/validate", json={"password": "synthetic-test-only"}, headers={"Authorization": "Bearer " + "x" * 32})
        assert response.json()["valid"] is False
        assert response.json()["accepted"] is False
        assert response.json()["error"] == "INVALID_REQUEST"
        assert "synthetic-test-only" not in response.text


@pytest.mark.parametrize("method", ["external", "direct"])
def test_real_http_worker_validation(sample, monkeypatch, tmp_path, method):
    # Only public trust material is written; all fixture private keys stay in memory.
    manifest = write_test_policy(tmp_path, sample["roots"][0], sample["crl"]())
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true" if method == "external" else "false")
    monkeypatch.setenv("DIRECT_P12_SIGNING_ENABLED", "true" if method == "direct" else "false")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(manifest))
    payload = {"previous": base64.b64encode(sample["base"]).decode(), "candidate": base64.b64encode(sample["first"]).decode(),
               "baseSha256": sha256(sample["base"]).hexdigest(), "position": {"page": 2, "x": 320, "y": 20, "width": 250, "height": 80}}
    with TestClient(app) as client:
        result = client.post("/validate", json=payload, headers={"Authorization": "Bearer " + "x" * 32})
        assert result.status_code == 200
        assert result.json()["valid"] is True
        assert result.json()["signatureCount"] == 1
        assert result.json()["revocation"] == "good"


def test_profile_flag_required_even_when_direct_mode_is_enabled(monkeypatch):
    monkeypatch.setenv("DIRECT_P12_SIGNING_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "false")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        assert client.post("/validate", json={}, headers={"Authorization": "Bearer " + "x" * 32}).status_code == 503


def test_private_prepare_returns_bounded_canonical_pdf(sample, monkeypatch, tmp_path):
    policy = write_test_policy(tmp_path, sample["roots"][0], sample["crl"]())
    monkeypatch.setenv("DIRECT_P12_SIGNING_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(policy))
    with TestClient(app) as client:
        result = client.post("/prepare", json={"pdf": base64.b64encode(sample["base"]).decode()}, headers={"Authorization": "Bearer " + "x" * 32})
        assert result.status_code == 200
        body = result.json()
        assert set(body) == {"pdf", "sha256", "byteSize", "pageCount", "lastPageWidth", "lastPageHeight", "signatureCount"}
        prepared = base64.b64decode(body["pdf"], validate=True)
        assert prepared == sample["base"]
        assert body["sha256"] == sha256(prepared).hexdigest()
        assert body["pageCount"] == 2


def test_private_prepare_rejects_certificate_and_password_fields(sample, monkeypatch, tmp_path):
    policy = write_test_policy(tmp_path, sample["roots"][0], sample["crl"]())
    monkeypatch.setenv("DIRECT_P12_SIGNING_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(policy))
    with TestClient(app) as client:
        result = client.post("/prepare", json={"pdf": "JVBERi0=", "password": "never"}, headers={"Authorization": "Bearer " + "x" * 32})
        assert result.json()["valid"] is False
        assert result.json()["accepted"] is False
        assert result.json()["error"] == "INVALID_REQUEST"
        assert "never" not in result.text


def test_ready_fails_closed_when_policy_is_missing(monkeypatch):
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/policy.json")
    with TestClient(app) as client:
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"detail": "VALIDATOR_NOT_READY"}


def test_health_names_the_production_policy(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    with TestClient(app) as client:
        assert client.get("/health").json() == {
            "enabled": True,
            "policy": "leapsign-v2-ecuador-strict-1",
        }


def test_ready_verifies_policy_hashes(sample, monkeypatch, tmp_path):
    policy = write_test_policy(tmp_path, sample["roots"][0], sample["crl"]())
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(policy))
    with TestClient(app) as client:
        assert client.get("/ready").json() == {
            "ready": True,
            "policy": "leapsign-v2-synthetic-test-only",
            "authorities": ["synthetic-test-only"],
        }
        (tmp_path / "root.der").write_bytes(b"changed")
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"detail": "VALIDATOR_NOT_READY"}


def test_ready_rejects_stale_revocation_material(sample, monkeypatch, tmp_path):
    policy = write_test_policy(tmp_path, sample["roots"][0], sample["crl"](stale=True))
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(policy))
    with TestClient(app) as client:
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"detail": "VALIDATOR_NOT_READY"}


def test_production_policy_rejects_synthetic_chain_with_structured_report(sample, monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("FIRMAEC_COMPATIBILITY_PROFILE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", str(Path(__file__).parents[1] / "trust" / "policy.json"))
    payload = {
        "previous": base64.b64encode(sample["base"]).decode(),
        "candidate": base64.b64encode(sample["first"]).decode(),
        "baseSha256": sha256(sample["base"]).hexdigest(),
        "position": {"page": 2, "x": 320, "y": 20, "width": 250, "height": 80},
    }
    with TestClient(app) as client:
        report = client.post("/validate", json=payload, headers={"Authorization": "Bearer " + "x" * 32}).json()
    assert report["accepted"] is False and report["valid"] is False
    assert report["policy"] == "leapsign-v2-ecuador-strict-1"
    assert report["error"] == "CHAIN_NOT_TRUSTED"
    assert report["checks"]["trusted"] == "failed"
    assert report["checks"]["cryptographicIntegrity"] == "passed"
    assert report["legalOutcome"] == "not_determined_by_software"
