"""All keys and certificates are generated in memory for tests only."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import pytest
from asn1crypto import keys, x509 as asn1x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils import generic
from pyhanko.sign import fields, signers
from pyhanko_certvalidator.registry import SimpleCertificateStore
from reportlab.pdfgen import canvas
from validator.v2_engine import validate_pair, prepare_canonical, prepare_document, ValidationFailure


@pytest.fixture(scope="module", params=["EC", "ES"])
def sample(request):
    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, request.param), x509.NameAttribute(NameOID.COMMON_NAME, "LeapSign TEST CA - never trust in production")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=2))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, None, None), critical=True)
          .sign(ca_key, hashes.SHA256()))

    def identity(*, expired=False, suitable=True):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Persona de prueba")]))
                .issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=2)).not_valid_after(now - timedelta(days=1) if expired else now + timedelta(days=1))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.KeyUsage(suitable, suitable, False, False, False, False, False, None, None), critical=True)
                .sign(ca_key, hashes.SHA256()))
        registry = SimpleCertificateStore()
        registry.register(asn1x509.Certificate.load(ca.public_bytes(serialization.Encoding.DER)))
        signer = signers.SimpleSigner(
            signing_cert=asn1x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER)),
            signing_key=keys.PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())),
            cert_registry=registry)
        return signer, cert

    def revocations(serial=None):
        builder = x509.CertificateRevocationListBuilder().issuer_name(ca_name).last_update(now - timedelta(minutes=1)).next_update(now + timedelta(hours=1))
        if serial:
            builder = builder.add_revoked_certificate(x509.RevokedCertificateBuilder().serial_number(serial).revocation_date(now - timedelta(minutes=1)).build())
        return builder.sign(ca_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)

    output = BytesIO()
    page = canvas.Canvas(output, pagesize=(595, 842))
    page.drawString(50, 750, "LeapSign: documento sintetico sin datos personales")
    page.showPage()
    page.drawString(50, 750, "Ultima pagina")
    page.save()
    original = prepare_canonical(output.getvalue())
    signer, certificate = identity()

    def sign(pdf, number=1, signer=signer, box=(320, 20, 570, 100), on_page=1, replace_content=False):
        writer = IncrementalPdfFileWriter(BytesIO(pdf))
        if replace_content:
            stream = writer.add_object(generic.StreamObject(stream_data=b"0 0 500 800 re f"))
            writer.add_stream_to_page(0, stream)
        return signers.sign_pdf(writer, signers.PdfSignatureMetadata(field_name=f"Signature_{number}", subfilter=fields.SigSeedSubFilter.PADES), signer,
                                new_field_spec=fields.SigFieldSpec(f"Signature_{number}", on_page=on_page, box=box)).getvalue()

    first = sign(original)
    second = sign(first, 2, box=(320, 120, 570, 200))
    return {"base": original, "first": first, "second": second, "sign": sign, "identity": identity,
            "cert": certificate, "roots": [ca.public_bytes(serialization.Encoding.DER)], "crl": revocations,
            "third": sign(second, 3, box=(320, 220, 570, 300))}


def validate(sample, previous=None, candidate=None, **kwargs):
    previous = sample["base"] if previous is None else previous
    candidate = sample["first"] if candidate is None else candidate
    options = {"base_sha256": sha256(previous).hexdigest(), "trust_roots": sample["roots"], "crls": [sample["crl"]()]}
    return validate_pair(previous, candidate, **(options | kwargs))


def test_real_pades_signature(sample):
    result = validate(sample)
    assert result["valid"] and result["signatureCount"] == 1
    assert result["certificate"]["fingerprint"] == sha256(sample["cert"].public_bytes(serialization.Encoding.DER)).hexdigest()
    assert set(result["certificate"]) == {"subject", "issuer", "serial", "fingerprint", "notBefore", "notAfter"}


def test_two_sequential_signatures(sample):
    assert validate(sample, sample["first"], sample["second"])["signatureCount"] == 2


def test_three_sequential_signatures(sample):
    assert validate(sample, sample["second"], sample["third"])["signatureCount"] == 3


@pytest.mark.parametrize("mutation", ["unchanged", "different", "tampered", "unsigned_trailing", "multiple_signatures"])
def test_reject_document_changes(sample, mutation):
    candidate = {"unchanged": sample["base"], "different": b"%PDF-other",
                 "tampered": sample["first"].replace(b"/ByteRange", b"/ByteRangX", 1),
                 "unsigned_trailing": sample["first"] + b"\n% unsigned trailer",
                 "multiple_signatures": sample["second"]}[mutation]
    with pytest.raises(ValidationFailure):
        validate(sample, candidate=candidate)


def test_wrong_canonical_hash(sample):
    with pytest.raises(ValidationFailure, match="DOCUMENT_MISMATCH"):
        validate(sample, base_sha256="0" * 64)


def test_missing_trust_fails_closed(sample):
    with pytest.raises(ValidationFailure, match="TRUST_POLICY_REQUIRED"):
        validate(sample, trust_roots=[])


def test_missing_revocation_fails_closed(sample):
    with pytest.raises(ValidationFailure, match="TRUST_POLICY_REQUIRED"):
        validate(sample, crls=[])


def test_revoked_certificate(sample):
    with pytest.raises(ValidationFailure):
        validate(sample, crls=[sample["crl"](sample["cert"].serial_number)])


@pytest.mark.parametrize("options", [{"expired": True}, {"suitable": False}])
def test_expired_or_unsuitable_certificate(sample, options):
    signer, _ = sample["identity"](**options)
    candidate = sample["sign"](sample["base"], signer=signer)
    with pytest.raises(ValidationFailure):
        validate(sample, candidate=candidate)


def test_identity_pin(sample):
    with pytest.raises(ValidationFailure, match="SIGNER_IDENTITY_MISMATCH"):
        validate(sample, expected_fingerprint="0" * 64)


def test_authorized_visible_position(sample):
    assert validate(sample, position={"page": 2, "x": 320, "y": 20, "width": 250, "height": 80})["valid"]


def test_unauthorized_position(sample):
    with pytest.raises(ValidationFailure, match="SIGNATURE_POSITION_MISMATCH"):
        validate(sample, position={"page": 1, "x": 320, "y": 20, "width": 250, "height": 80})


def test_first_signature_cannot_replace_page_content(sample):
    with pytest.raises(ValidationFailure):
        validate(sample, candidate=sample["sign"](sample["base"], replace_content=True))


def test_canonical_preparation_never_rewrites_signed_pdf(sample):
    assert prepare_canonical(sample["first"]) == sample["first"]
    assert prepare_canonical(sample["base"]) == sample["base"]


def test_canonical_document_metadata_is_derived_server_side(sample):
    result = prepare_document(sample["base"])
    assert result["pdf"] == sample["base"]
    assert result["sha256"] == sha256(sample["base"]).hexdigest()
    assert result["byteSize"] == len(sample["base"])
    assert result["pageCount"] == 2
    assert result["lastPageWidth"] == pytest.approx(595, abs=0.01)
    assert result["lastPageHeight"] == pytest.approx(842, abs=0.01)
    assert result["signatureCount"] == 0


def active_pdf(sample, *, orphan=False, compressed=False):
    writer = IncrementalPdfFileWriter(BytesIO(sample["base"]))
    action = generic.DictionaryObject({generic.pdf_name("/S"): generic.pdf_name("/JavaScript"), generic.pdf_name("/JS"): generic.TextStringObject("void    0;")})
    if compressed:
        writer.stream_xrefs = True
        stream = writer.prepare_object_stream()
        ref = writer.add_object(action, obj_stream=stream)
    else:
        ref = writer.add_object(action)
    if not orphan:
        writer.root[generic.pdf_name("/OpenAction")] = ref
        writer.update_root()
    output = BytesIO(); writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("options", [{}, {"orphan": True}, {"compressed": True}])
def test_initial_active_content_is_rejected_without_rewriting(sample, options):
    with pytest.raises(ValidationFailure, match="UNSAFE_PDF_CONTENT"):
        prepare_canonical(active_pdf(sample, **options))


def test_escaped_javascript_name_is_rejected(sample):
    pdf = active_pdf(sample)
    # Same byte length preserves offsets while exercising parsed name decoding.
    escaped = pdf.replace(b"/JavaScript", b"/Java#53cript").replace(b"/JS (void    0\\073)", b"/J#53 (void0\\073)")
    assert len(escaped) == len(pdf) and b"/JavaScript" not in escaped and b"/JS " not in escaped
    with pytest.raises(ValidationFailure, match="UNSAFE_PDF_CONTENT"):
        prepare_canonical(escaped)


def test_a_signature_does_not_make_active_content_safe(sample):
    previous = active_pdf(sample)
    candidate = sample["sign"](previous)
    with pytest.raises(ValidationFailure, match="UNSAFE_PDF_CONTENT"):
        validate(sample, previous, candidate)


def test_javascript_mentioned_in_plain_text_is_not_an_active_action(sample):
    writer = IncrementalPdfFileWriter(BytesIO(sample["base"]))
    writer.root[generic.pdf_name("/Subject")] = generic.TextStringObject("Manual discussing /JavaScript and /JS, not an action")
    writer.update_root(); output = BytesIO(); writer.write(output)
    assert prepare_canonical(output.getvalue()) == output.getvalue()
