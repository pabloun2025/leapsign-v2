"""Optional cross-engine laboratory. No real certificates; no private key files.

Set LIBPDF_MODULE_PATH to an independently installed/pinned @libpdf/core 0.5.3
dist/index.mjs. Absence is an explicit skip, never a successful crypto check.
This probes a Node implementation of browser APIs, not browser compatibility.
"""
import base64
import json
import os
from pathlib import Path
from io import BytesIO
import subprocess
from hashlib import sha256
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from validator.tests.test_v2_engine import sample, validate
from validator.v2_engine import ValidationFailure
from PIL import Image
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils import generic

pytestmark = pytest.mark.skipif(not os.environ.get("LIBPDF_MODULE_PATH"), reason="Local browser-engine laboratory is not configured")
ROOT = Path(__file__).resolve().parents[2]


def container(sample, **options):
    signer, cert = sample["identity"](**options)
    key = serialization.load_der_private_key(signer.signing_key.dump(), password=None)
    return pkcs12.serialize_key_and_certificates(
        b"Synthetic test only", key, cert,
        [x509.load_der_x509_certificate(sample["roots"][0])],
        serialization.BestAvailableEncryption(b"synthetic-password")), cert


def local_sign(pdf, p12, number=1, password="synthetic-password", use_browser=False, **options):
    payload = {"syntheticOnly": True, "pdf": base64.b64encode(pdf).decode(),
               "p12": base64.b64encode(p12).decode(), "password": password,
               "fieldName": f"Local_Signature_{number}", "number": number, **options}
    script = "probe-v2-browser-engine.mjs" if use_browser else "probe-v2-local-engine.mjs"
    process = subprocess.run(["node", str(ROOT / "scripts" / script)],
                             input=json.dumps(payload).encode(), stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=30, check=False)
    result = json.loads(process.stdout)
    if use_browser:
        assert result.pop("isolation", None) == {"staticGetRequests": 2, "violations": 0, "webStorageEntries": 0}
    if not result["ok"]:
        assert result == {"ok": False, "error": "LOCAL_ENGINE_REJECTED"}
        if not use_browser:
            assert process.returncode != 0
        return None
    assert process.returncode == 0
    return base64.b64decode(result["pdf"], validate=True)


def test_local_p12_three_incremental_cms_signatures(sample):
    previous = sample["base"]
    for number in range(1, 4):
        p12, cert = container(sample)
        candidate = local_sign(previous, p12, number)
        assert candidate is not None
        assert candidate.startswith(previous)
        report = validate(sample, previous, candidate,
                          expected_fingerprint=sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest())
        assert report["valid"] and report["signatureCount"] == number
        previous = candidate


@pytest.mark.parametrize("password", ["wrong", ""])
def test_local_wrong_password(sample, password):
    p12, _ = container(sample)
    assert local_sign(sample["base"], p12, password=password) is None


def test_local_malformed_container(sample):
    assert local_sign(sample["base"], b"not-a-p12") is None


def test_local_insufficient_cms_capacity(sample):
    p12, _ = container(sample)
    assert local_sign(sample["base"], p12, estimatedSize=16) is None


@pytest.mark.skipif(not os.environ.get("LIBPDF_VISIBLE_LAB"), reason="Reviewed appearance-only laboratory variant is not configured")
def test_local_visible_three_incremental_signatures(sample):
    previous = sample["base"]
    for number in range(1, 4):
        p12, _ = container(sample)
        candidate = local_sign(previous, p12, number, visible=True)
        assert candidate is not None
        report = validate(sample, previous, candidate, position={
            "page": 2, "x": 320, "y": 20 + 90 * (number - 1), "width": 250, "height": 80,
        })
        assert report["valid"] and report["signatureCount"] == number
        previous = candidate


browser_lab = pytest.mark.skipif(not all(os.environ.get(name) for name in ("BROWSER_WORKER_LAB_PATH", "PLAYWRIGHT_MODULE_PATH")), reason="Chromium signing laboratory is not configured")


@browser_lab
@pytest.mark.skipif(not all(os.environ.get(name) for name in ("LIBPDF_VISIBLE_LAB", "QRCODE_MODULE_PATH", "JSQR_MODULE_PATH")), reason="Visible QR rendering/decoding laboratory is not configured")
def test_visible_qr_decodes_from_actual_signed_pdf(sample):
    audit_id = "https://pruebas.leapsign.app/verificar/00000000-0000-4000-8000-000000000001"
    p12, _ = container(sample)
    candidate = local_sign(sample["base"], p12, visible=True, qr=audit_id, use_browser=True)
    assert candidate is not None
    assert validate(sample, candidate=candidate, position={"page": 2, "x": 320, "y": 20, "width": 250, "height": 80})["valid"]
    # Render the actual annotation from the signed PDF, not the QR source matrix.
    # Both PDF and image stay in pipes/memory. No test private key is written.
    rendered = subprocess.run(["pdftoppm", "-f", "2", "-l", "2", "-singlefile", "-r", "144", "-"],
                              input=candidate, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True)
    image = Image.open(BytesIO(rendered.stdout)).convert("RGBA")
    payload = {"width": image.width, "height": image.height, "rgba": base64.b64encode(image.tobytes()).decode()}
    decoded = subprocess.run(["node", str(ROOT / "scripts/decode-v2-qr-lab.mjs")],
                             input=json.dumps(payload).encode(), stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=20, check=True)
    assert json.loads(decoded.stdout) == {"data": audit_id}


@browser_lab
def test_chromium_worker_uses_subject_from_synthetic_certificate(sample):
    p12, _ = container(sample)
    candidate = local_sign(sample["base"], p12, visible=True, use_browser=True)
    assert candidate is not None
    reader = PdfFileReader(BytesIO(candidate), strict=True)
    appearance = reader.embedded_regular_signatures[-1].sig_field["/AP"]["/N"].get_object().data
    assert b"PERSONA DE PRUEBA" in appearance


@browser_lab
def test_chromium_worker_three_incremental_signatures(sample):
    previous = sample["base"]
    for number in range(1, 4):
        p12, _ = container(sample)
        candidate = local_sign(previous, p12, number, visible=True, use_browser=True,
                               qr="https://pruebas.leapsign.app/verificar/00000000-0000-4000-8000-000000000001")
        assert candidate is not None
        report = validate(sample, previous, candidate, position={
            "page": 2, "x": 320, "y": 20 + 90 * (number - 1), "width": 250, "height": 80,
        })
        assert report["valid"] and report["signatureCount"] == number
        previous = candidate


@browser_lab
def test_chromium_worker_wrong_password(sample):
    p12, _ = container(sample)
    assert local_sign(sample["base"], p12, password="wrong", visible=True, use_browser=True) is None


@pytest.mark.parametrize("options", [{"expired": True}, {"suitable": False}])
def test_independent_validator_rejects_invalid_local_certificate(sample, options):
    # The underlying engine can mathematically sign with an unsuitable/expired
    # certificate. This is NOT acceptance: the independent policy must reject it.
    p12, _ = container(sample, **options)
    candidate = local_sign(sample["base"], p12)
    assert candidate is not None
    expected = "CERTIFICATE_NOT_VALID" if options.get("expired") else "CERTIFICATE_CONSTRAINTS_FAILED"
    with pytest.raises(ValidationFailure, match=expected):
        validate(sample, candidate=candidate)


def test_local_external_local_preserves_all_signatures(sample):
    p12, _ = container(sample)
    first = local_sign(sample["base"], p12)
    assert validate(sample, candidate=first)["signatureCount"] == 1
    second = sample["sign"](first, 2)
    assert validate(sample, first, second)["signatureCount"] == 2
    third = local_sign(second, p12, 3)
    assert validate(sample, second, third)["signatureCount"] == 3


@pytest.mark.skipif(not os.environ.get("LIBPDF_VISIBLE_LAB"), reason="Visible appearance laboratory is not configured")
@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_visible_signature_retains_rotated_canonical_page(sample, rotation):
    writer = IncrementalPdfFileWriter(BytesIO(sample["base"]))
    page_ref, _ = writer.find_page_for_modification(1)
    page = page_ref.get_object()
    page[generic.pdf_name("/Rotate")] = generic.NumberObject(rotation)
    writer.mark_update(page_ref)
    output = BytesIO()
    writer.write(output)
    previous = output.getvalue()
    p12, _ = container(sample)
    candidate = local_sign(previous, p12, visible=True)
    assert candidate is not None
    assert validate(sample, previous, candidate, position={"page": 2, "x": 320, "y": 20, "width": 250, "height": 80})["valid"]
