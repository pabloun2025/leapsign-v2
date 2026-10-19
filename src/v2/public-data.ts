import type {SigningIntent, SignatureValidationResult} from './contracts';
import {INTENT_LIFETIME_MS} from './policy';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[], optional: string[] = []) => keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const date = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));

/** Narrow, public-only schema. Reject additional keys rather than carrying
 * arbitrary error dumps, certificate containers or secrets through the UI. */
export function isPublicSigningIntent(value: unknown): value is SigningIntent {
  if (!record(value) || !exact(value, ['id','documentId','versionId','baseSha256','stageId','signerId','role','profile','position','issuedAt','expiresAt','nonce','state','correlationId'], ['expectedFingerprint'])) return false;
  if (!['id','documentId','versionId','stageId','signerId','role','nonce','correlationId'].every(key => text(value[key])) || !hash(value.baseSha256)) return false;
  if (!['firmaec-qr-compatible','firmaec-information-compatible','firmaec-information-extended-compatible'].includes(String(value.profile)) || !['signature_intent_issued','awaiting_local_signature'].includes(String(value.state))) return false;
  const p = value.position;
  if (!record(p) || !exact(p, ['page','x','y','width','height']) || !count(p.page, 1, 500) ||
      !['x','y','width','height'].every(key => typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= 14400) ||
      (p.width as number) < 100 || (p.height as number) < 50) return false;
  if (!date(value.issuedAt) || !date(value.expiresAt)) return false;
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  return lifetime > 0 && lifetime <= INTENT_LIFETIME_MS && (value.expectedFingerprint === undefined || hash(value.expectedFingerprint));
}

export function isPublicValidationReport(value: unknown): value is SignatureValidationResult {
  if (!record(value) || !exact(value, ['valid','policy','baseSha256','signedSha256','previousSignatureCount','signatureCount','revocation'], ['certificate'])) return false;
  if (typeof value.valid !== 'boolean' || value.policy !== 'leapsign-v2-strict-offline-1' || !hash(value.baseSha256) || !hash(value.signedSha256) ||
      !count(value.previousSignatureCount, 0, 19) || !count(value.signatureCount, 0, 20) || !['good','failed'].includes(String(value.revocation))) return false;
  if (value.valid && (value.revocation !== 'good' || value.signatureCount !== value.previousSignatureCount + 1 || !value.certificate)) return false;
  if (value.certificate !== undefined) {
    const c = value.certificate;
    if (!record(c) || !exact(c, ['subject','issuer','serial','notBefore','notAfter','fingerprint']) || !text(c.subject, 4096) || !text(c.issuer, 4096) || !text(c.serial, 512) ||
        !hash(c.fingerprint) || !date(c.notBefore) || !date(c.notAfter) || Date.parse(c.notAfter) <= Date.parse(c.notBefore)) return false;
  }
  return true;
}
