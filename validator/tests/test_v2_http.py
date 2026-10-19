from fastapi.testclient import TestClient
from validator.v2_app import app
from validator.tests.test_v2_engine import sample
import base64
import json
from hashlib import sha256


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("EXTERNAL_SIGNATURE_ENABLED", raising=False)
    with TestClient(app) as client:
        assert client.post("/validate", json={}).status_code == 503


def test_requires_service_authentication(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        assert client.post("/validate", json={}).status_code == 401
        assert client.post("/validate", json={}, headers={"Authorization": "Bearer " + "x" * 32}).json()["valid"] is False


def test_body_limit_before_read(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        response = client.post("/validate", content=b"{}", headers={"Authorization": "Bearer " + "x" * 32, "Content-Type": "application/json", "Content-Length": "999999999"})
        assert response.status_code == 413


def test_certificate_or_password_fields_are_rejected(monkeypatch):
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
    monkeypatch.setenv("V2_VALIDATOR_TOKEN", "x" * 32)
    monkeypatch.setenv("V2_TRUST_POLICY_FILE", "/nonexistent/test-policy.json")
    with TestClient(app) as client:
        response = client.post("/validate", json={"password": "synthetic-test-only"}, headers={"Authorization": "Bearer " + "x" * 32})
        assert response.json() == {"valid": False, "error": "INVALID_REQUEST"}
        assert "synthetic-test-only" not in response.text


def test_real_http_worker_validation(sample, monkeypatch, tmp_path):
    # Only public trust material is written; all fixture private keys stay in memory.
    (tmp_path / "root.der").write_bytes(sample["roots"][0])
    (tmp_path / "revocations.der").write_bytes(sample["crl"]())
    manifest = tmp_path / "policy.json"
    manifest.write_text(json.dumps({"version": 1, "trust_roots": ["root.der"], "crls": ["revocations.der"]}))
    monkeypatch.setenv("EXTERNAL_SIGNATURE_ENABLED", "true")
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
