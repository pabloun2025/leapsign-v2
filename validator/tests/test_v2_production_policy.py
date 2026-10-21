import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import padding


TRUST = Path(__file__).parents[1] / "trust"


def _manifest():
    return json.loads((TRUST / "policy.json").read_text(encoding="utf-8"))


def _material(entry):
    path = TRUST / entry["file"]
    data = path.read_bytes()
    assert path.resolve().is_relative_to(TRUST.resolve())
    assert hashlib.sha256(data).hexdigest() == entry["sha256"]
    assert entry["source"]["repository"] == "https://minka.gob.ec/mintel/ge/firmaec/firmadigital-libreria.git"
    assert len(entry["source"]["commit"]) == 40
    assert entry["source"]["originalPath"].endswith(".java")
    assert datetime.fromisoformat(entry["incorporatedAt"]).tzinfo is not None
    return data


def _verify_certificate_signature(certificate, issuer):
    issuer.public_key().verify(
        certificate.signature,
        certificate.tbs_certificate_bytes,
        padding.PKCS1v15(),
        certificate.signature_hash_algorithm,
    )


def test_production_policy_is_official_hashed_and_legally_bounded():
    policy = _manifest()
    assert policy["version"] == 2
    assert policy["id"] == "leapsign-v2-ecuador-strict-1"
    assert policy["legalOutcome"] == "not_determined_by_software"
    assert policy["acceptance"] == {
        "cryptographicIntegrity": "required",
        "chainTrust": "required",
        "certificateValidity": "required_at_server_receipt",
        "revocation": "verified_good_required",
    }
    assert [authority["id"] for authority in policy["authorities"]] == ["bce"]
    assert not any("synthetic" in entry["file"].lower() for authority in policy["authorities"] for group in ("trustAnchors", "intermediates", "revocation") for entry in authority[group])


def test_bce_chain_and_crl_are_well_formed_current_and_signed():
    authority = _manifest()["authorities"][0]
    root = x509.load_der_x509_certificate(_material(authority["trustAnchors"][0]))
    intermediate = x509.load_der_x509_certificate(_material(authority["intermediates"][0]))
    root_constraints = root.extensions.get_extension_for_class(x509.BasicConstraints).value
    root_usage = root.extensions.get_extension_for_class(x509.KeyUsage).value
    intermediate_constraints = intermediate.extensions.get_extension_for_class(x509.BasicConstraints).value
    intermediate_usage = intermediate.extensions.get_extension_for_class(x509.KeyUsage).value
    assert root_constraints.ca and intermediate_constraints.ca
    assert root_usage.key_cert_sign and root_usage.crl_sign
    assert intermediate_usage.key_cert_sign and intermediate_usage.crl_sign
    assert root.subject == root.issuer == intermediate.issuer
    _verify_certificate_signature(root, root)
    _verify_certificate_signature(intermediate, root)

    now = datetime.now(timezone.utc)
    assert root.not_valid_before_utc <= now <= root.not_valid_after_utc
    assert intermediate.not_valid_before_utc <= now <= intermediate.not_valid_after_utc

    crl_entry = authority["revocation"][0]
    crl = x509.load_der_x509_crl(_material(crl_entry))
    assert crl.issuer == root.subject
    assert crl.last_update_utc <= now <= crl.next_update_utc
    root.public_key().verify(
        crl.signature,
        crl.tbs_certlist_bytes,
        padding.PKCS1v15(),
        crl.signature_hash_algorithm,
    )
    assert crl_entry["url"] == "https://www.eci.bce.ec/CRL/cacrl.crl"
    assert authority["revocationHosts"] == ["www.eci.bce.ec"]

    assert len(authority["revocation"]) == 2
    leaf_crl_entry = authority["revocation"][1]
    leaf_crl = x509.load_der_x509_crl(_material(leaf_crl_entry))
    assert leaf_crl.issuer == intermediate.subject
    assert leaf_crl.last_update_utc <= now <= leaf_crl.next_update_utc
    intermediate.public_key().verify(
        leaf_crl.signature,
        leaf_crl.tbs_certlist_bytes,
        padding.PKCS1v15(),
        leaf_crl.signature_hash_algorithm,
    )
    assert leaf_crl_entry["url"] == "https://www.eci.bce.ec/CRL/eci_bce_ec_crlfilecomb.crl"
