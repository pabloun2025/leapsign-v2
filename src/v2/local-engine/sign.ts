import {PDF, P12Signer, type SignOptions} from '@libpdf/core';
import type {LocalWorkerRequest} from '../local-session';
import {MAX_CERTIFICATE_BYTES, MAX_PDF_BYTES} from '../policy';
import {certificateSubjectLabel} from './certificate-subject';
import {prepareSignatureAppearance, reserveCanonicalObjectNumbers, signatureFieldName} from './appearance';

type VisibleSignOptions = SignOptions & {leapSignPreserveAppearance: true};

function assertRequest(input: unknown): asserts input is LocalWorkerRequest {
  if (!input || typeof input !== 'object') throw new Error('INVALID_LOCAL_REQUEST');
  const value = input as Partial<LocalWorkerRequest>;
  const intent = value.intent;
  if (!intent || intent.profile !== 'firmaec-qr-compatible' ||
      !['signature_intent_issued', 'awaiting_local_signature'].includes(intent.state) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(intent.id) || Date.parse(intent.expiresAt) <= Date.now() ||
      !(value.pdf instanceof ArrayBuffer) || value.pdf.byteLength < 5 || value.pdf.byteLength > MAX_PDF_BYTES ||
      new TextDecoder().decode(new Uint8Array(value.pdf, 0, 5)) !== '%PDF-' ||
      !(value.certificate instanceof ArrayBuffer) || value.certificate.byteLength < 1 || value.certificate.byteLength > MAX_CERTIFICATE_BYTES ||
      value.certificate === value.pdf || typeof value.password !== 'string' || value.password.length > 4096 ||
      typeof value.reason !== 'string' || value.reason.length > 500 ||
      typeof value.location !== 'string' || value.location.length > 200) throw new Error('INVALID_LOCAL_REQUEST');
}

const preservesPrefix = (base: Uint8Array, candidate: Uint8Array) => {
  if (candidate.length <= base.length) return false;
  for (let index = 0; index < base.length; index++) if (candidate[index] !== base[index]) return false;
  return true;
};

export async function signPdfLocally(input: unknown) {
  assertRequest(input);
  const certificate = new Uint8Array(input.certificate);
  const base = new Uint8Array(input.pdf);
  const signer = await P12Signer.create(certificate, input.password, {buildChain: false});
  const pdf = await PDF.load(base);
  reserveCanonicalObjectNumbers(pdf);
  prepareSignatureAppearance(pdf, input.intent, certificateSubjectLabel(signer.certificate));
  const options: VisibleSignOptions = {
    signer, fieldName: signatureFieldName(input.intent.id),
    reason: input.reason, location: input.location,
    subFilter: 'ETSI.CAdES.detached', level: 'B-B', digestAlgorithm: 'SHA-256',
    estimatedSize: 16_384, leapSignPreserveAppearance: true,
  };
  const result = await pdf.sign(options);
  if (result.warnings.length) throw new Error('LOCAL_ENGINE_WARNING');
  const output = new Uint8Array(result.bytes);
  if (!preservesPrefix(base, output)) throw new Error('LOCAL_ENGINE_OUTPUT_INVALID');
  return Uint8Array.from(output);
}
