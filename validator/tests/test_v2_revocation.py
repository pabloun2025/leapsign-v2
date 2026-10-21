import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from validator.v2_revocation import RevocationFailure, RevocationManager


def fixture(tmp_path):
    now = datetime.now(timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic CRL issuer")])
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                   .public_key(key.public_key()).serial_number(1)
                   .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=2))
                   .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                   .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, None, None), critical=True)
                   .sign(key, hashes.SHA256()))
    cert_bytes = certificate.public_bytes(serialization.Encoding.DER)

    def crl(*, hours=1, signer=key, last_minutes=1):
        return (x509.CertificateRevocationListBuilder().issuer_name(name)
                .last_update(now - timedelta(minutes=last_minutes))
                .next_update(now + timedelta(hours=hours))
                .sign(signer, hashes.SHA256()).public_bytes(serialization.Encoding.DER))

    current = crl()
    (tmp_path / "issuer.der").write_bytes(cert_bytes)
    (tmp_path / "current.der").write_bytes(current)
    entry = {
        "file": "current.der", "sha256": sha256(current).hexdigest(),
        "incorporatedAt": now.isoformat(), "lastUpdate": (now - timedelta(minutes=1)).isoformat(),
        "nextUpdate": (now + timedelta(hours=1)).isoformat(),
        "issuerSha256": sha256(cert_bytes).hexdigest(),
        "refresh": {"url": "https://official.example/crl.der", "issuerFile": "issuer.der",
                    "timeoutSeconds": 2, "maxBytes": 2_097_152, "refreshBeforeSeconds": 43_200,
                    "cacheKey": "synthetic"},
    }
    policy = tmp_path / "policy.json"
    policy.write_text(json.dumps({"version": 2, "authorities": [{"id": "test", "revocationHosts": ["official.example"], "revocation": [entry]}]}))
    return policy, current, crl, other_key


def test_refresh_accepts_valid_signed_crl_and_replaces_atomically(tmp_path):
    policy, current, crl, _ = fixture(tmp_path)
    replacement = crl(hours=2, last_minutes=0)
    manager = RevocationManager(policy, cache_dir=tmp_path / "cache", fetch=lambda *_: replacement)
    status = manager.refresh(force=True)
    assert status["ready"] is True
    assert status["source"] == "official-cache"
    assert status["nextUpdate"] > status["thisUpdate"]
    assert (tmp_path / "cache" / "synthetic.der").read_bytes() == replacement
    assert current != replacement


def test_refresh_keeps_previous_valid_crl_when_source_is_unavailable(tmp_path):
    policy, current, _, _ = fixture(tmp_path)
    manager = RevocationManager(policy, cache_dir=tmp_path / "cache", fetch=lambda *_: (_ for _ in ()).throw(OSError("offline")))
    status = manager.refresh(force=True)
    assert status["ready"] is True and status["source"] == "bundled-fallback"
    assert not (tmp_path / "cache" / "synthetic.der").exists()
    assert current


@pytest.mark.parametrize("mode", ["expired", "bad_signature", "oversized"])
def test_refresh_rejects_invalid_replacement(tmp_path, mode):
    policy, _, crl, other_key = fixture(tmp_path)
    candidate = crl(hours=-1, last_minutes=120) if mode == "expired" else crl(hours=2, signer=other_key)
    if mode == "oversized":
        candidate = b"x" * 2_097_153
    manager = RevocationManager(policy, cache_dir=tmp_path / "cache", fetch=lambda *_: candidate)
    status = manager.refresh(force=True)
    assert status["ready"] is True and status["source"] == "bundled-fallback"


def test_fails_closed_when_source_and_bundled_crl_are_expired(tmp_path):
    policy, _, crl, _ = fixture(tmp_path)
    manifest = json.loads(policy.read_text())
    expired = crl(hours=-1, last_minutes=120)
    (tmp_path / "current.der").write_bytes(expired)
    manifest["authorities"][0]["revocation"][0]["sha256"] = sha256(expired).hexdigest()
    policy.write_text(json.dumps(manifest))
    manager = RevocationManager(policy, cache_dir=tmp_path / "cache", fetch=lambda *_: (_ for _ in ()).throw(OSError("offline")))
    with pytest.raises(RevocationFailure):
        manager.refresh(force=True)


def test_source_is_fixed_to_https_allowlist(tmp_path):
    policy, _, _, _ = fixture(tmp_path)
    manifest = json.loads(policy.read_text())
    manifest["authorities"][0]["revocation"][0]["refresh"]["url"] = "http://127.0.0.1/private"
    policy.write_text(json.dumps(manifest))
    with pytest.raises(RevocationFailure):
        RevocationManager(policy, cache_dir=tmp_path / "cache").refresh(force=True)
