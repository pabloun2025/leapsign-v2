"""Strict offline validation. No certificate containers, passwords or network I/O.

This module is not enabled in v1. Trust roots and fresh CRLs/OCSP must be supplied
by the operator, never by the browser or by arbitrary AIA URLs in a certificate.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from asn1crypto import crl, ocsp, x509
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils import generic
from pyhanko.sign.diff_analysis import ModificationLevel, DEFAULT_DIFF_POLICY, SuspiciousModification
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko.sign.validation.status import SignatureCoverageLevel
from pyhanko_certvalidator import ValidationContext

POLICY = "leapsign-v2-strict-offline-1"
MAX_BYTES = 10 * 1024 * 1024


class ValidationFailure(Exception):
    pass


def prepare_canonical(pdf: bytes) -> bytes:
    """Owner-upload preparation only, before issuing any signing intention.

    An empty AcroForm enables strict diff analysis of the very first signature.
    Signed or already prepared input is returned byte-for-byte, never rewritten.
    """
    if not pdf.startswith(b"%PDF-") or not 0 < len(pdf) <= MAX_BYTES:
        raise ValidationFailure("DOCUMENT_MISMATCH")
    try:
        reader = PdfFileReader(BytesIO(pdf), strict=True)
        if reader.encrypted:
            raise ValidationFailure("DOCUMENT_MISMATCH")
        if reader.embedded_regular_signatures:
            return pdf
        if b"/ByteRange" in pdf:
            raise ValidationFailure("CANONICAL_PREPARATION_REQUIRED")
        if "/AcroForm" in reader.root and reader.root["/AcroForm"].get("/SigFlags") == 3:
            return pdf
        writer = IncrementalPdfFileWriter(BytesIO(pdf))
        if "/AcroForm" in writer.root:
            form = writer.root["/AcroForm"]
            form[generic.pdf_name("/SigFlags")] = generic.NumberObject(3)
            writer.update_container(form)
        else:
            writer.root[generic.pdf_name("/AcroForm")] = writer.add_object(generic.DictionaryObject({
                generic.pdf_name("/Fields"): generic.ArrayObject(),
                generic.pdf_name("/SigFlags"): generic.NumberObject(3),
            }))
        writer.update_root()
        output = BytesIO()
        writer.write(output)
        if len(output.getvalue()) > MAX_BYTES:
            raise ValidationFailure("DOCUMENT_MISMATCH")
        return output.getvalue()
    except ValidationFailure:
        raise
    except Exception:
        raise ValidationFailure("CANONICAL_PREPARATION_REQUIRED") from None


def validate_pair(previous: bytes, candidate: bytes, *, base_sha256: str,
                  trust_roots: list[bytes], crls: list[bytes], ocsps: list[bytes] | None = None,
                  expected_fingerprint: str | None = None, position: dict | None = None) -> dict:
    """No positive result without independent CMS, trust, revocation and diff checks.

    Times are evaluated at server receipt, not the untrusted claimed signing
    time. No qualified-signature, trusted-time or legal-validity claim is made.
    """
    if not trust_roots or not (crls or ocsps):
        raise ValidationFailure("TRUST_POLICY_REQUIRED")
    if (not previous.startswith(b"%PDF-") or not candidate.startswith(b"%PDF-")
            or not 0 < len(previous) < len(candidate) <= MAX_BYTES
            or sha256(previous).hexdigest() != base_sha256
            or not candidate.startswith(previous)):
        raise ValidationFailure("DOCUMENT_MISMATCH")
    try:
        before = PdfFileReader(BytesIO(previous), strict=True)
        after = PdfFileReader(BytesIO(candidate), strict=True)
        if before.encrypted or after.encrypted or before.root["/Pages"]["/Count"] != after.root["/Pages"]["/Count"]:
            raise ValidationFailure("DOCUMENT_MISMATCH")
        old = before.embedded_regular_signatures
        signatures = after.embedded_regular_signatures
        if len(signatures) != len(old) + 1:
            raise ValidationFailure("ONE_NEW_SIGNATURE_REQUIRED")
        # Also compare the unsigned canonical revision to the new revision.
        # Otherwise a first signer could append replacement page content and
        # correctly sign that unrelated content while preserving the prefix.
        if "/AcroForm" not in before.root:
            raise ValidationFailure("CANONICAL_PREPARATION_REQUIRED")
        difference = DEFAULT_DIFF_POLICY.review_file(after, before.xrefs.total_revisions - 1)
        if isinstance(difference, SuspiciousModification) or difference.modification_level > ModificationLevel.FORM_FILLING:
            raise ValidationFailure("CONTENT_CHANGED")
        if difference.changed_form_fields - {signatures[-1].field_name}:
            raise ValidationFailure("UNAUTHORIZED_FORM_CHANGES")
        # Fix identity and signed bytes for every previous signature, not just
        # the count; also validate each prior signature against the final PDF.
        for original, retained in zip(old, signatures):
            if original.sig_object.raw_get("/Contents") != retained.sig_object.raw_get("/Contents") or list(original.byte_range) != list(retained.byte_range):
                raise ValidationFailure("PREVIOUS_SIGNATURE_CHANGED")
        roots = [x509.Certificate.load(value) for value in trust_roots]
        revocations = [crl.CertificateList.load(value) for value in crls]
        responses = [ocsp.OCSPResponse.load(value) for value in (ocsps or [])]
        for signature in signatures:
            context = ValidationContext(trust_roots=roots, crls=revocations, ocsps=responses,
                                        allow_fetching=False, revocation_mode="require",
                                        moment=datetime.now(timezone.utc))
            status = validate_pdf_signature(signature, signer_validation_context=context)
            if not (status.intact and status.valid and status.trusted and status.bottom_line):
                raise ValidationFailure("CRYPTOGRAPHIC_VALIDATION_FAILED")
            if status.modification_level is not None and status.modification_level > ModificationLevel.FORM_FILLING:
                raise ValidationFailure("CONTENT_CHANGED")
        newest = signatures[-1]
        if newest.evaluate_signature_coverage() != SignatureCoverageLevel.ENTIRE_FILE:
            raise ValidationFailure("UNSIGNED_TRAILING_CONTENT")
        if str(newest.sig_object.get("/SubFilter")) not in ("/ETSI.CAdES.detached", "/adbe.pkcs7.detached"):
            raise ValidationFailure("UNSUPPORTED_SIGNATURE_PROFILE")
        cert = newest.signer_cert
        fingerprint = sha256(cert.dump()).hexdigest()
        if expected_fingerprint is not None and fingerprint != expected_fingerprint:
            raise ValidationFailure("SIGNER_IDENTITY_MISMATCH")
        if position:
            # Visible merged fields and separate widgets are both supported.
            field = newest.sig_field
            widgets = list(field.get("/Kids", [])) or [field]
            expected_page = after.find_page_for_modification(position["page"] - 1)[0]
            matching = False
            for widget in widgets:
                widget = widget.get_object()
                rect = [float(value) for value in widget.get("/Rect", [])]
                target = [position["x"], position["y"], position["x"] + position["width"], position["y"] + position["height"]]
                if len(rect) == 4 and all(abs(a - b) <= 0.5 for a, b in zip(rect, target)) and widget.raw_get("/P") == expected_page and "/AP" in widget:
                    matching = True
            if not matching:
                raise ValidationFailure("SIGNATURE_POSITION_MISMATCH")
        return {"valid": True, "policy": POLICY, "baseSha256": base_sha256,
                "signedSha256": sha256(candidate).hexdigest(), "previousSignatureCount": len(old),
                "signatureCount": len(signatures), "revocation": "good",
                "certificate": {"subject": cert.subject.human_friendly, "issuer": cert.issuer.human_friendly,
                                "serial": str(cert.serial_number), "fingerprint": fingerprint,
                                "notBefore": cert.not_valid_before.isoformat(), "notAfter": cert.not_valid_after.isoformat()}}
    except ValidationFailure:
        raise
    except Exception:
        # Never return parser/CMS/ASN.1 exception strings or dump PDF contents.
        raise ValidationFailure("CRYPTOGRAPHIC_VALIDATION_FAILED") from None
