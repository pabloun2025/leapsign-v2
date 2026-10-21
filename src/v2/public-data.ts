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
  if (!record(value) || typeof value.accepted !== 'boolean' || typeof value.valid !== 'boolean' || value.accepted !== value.valid ||
      typeof value.policy !== 'string' || !/^leapsign-v2-[a-z0-9-]{1,80}$/.test(value.policy) || value.legalOutcome !== 'not_determined_by_software') return false;
  const checks=value.checks;
  const checkNames=['cryptographicIntegrity','cmsSignature','documentMatch','oneNewSignature','previousSignatures','chainBuilt','trusted','certificateValidity','revocation'];
  if(!record(checks)||!exact(checks,checkNames)||!checkNames.slice(0,-1).every(key=>['passed','failed','not_evaluated'].includes(String(checks[key])))||!['good','revoked','unknown','unavailable','not_evaluated'].includes(String(checks.revocation)))return false;
  if(value.accepted){
    if(!exact(value,['accepted','valid','policy','baseSha256','signedSha256','previousSignatureCount','signatureCount','revocation','checks','legalOutcome','certificate'])||
      !hash(value.baseSha256)||!hash(value.signedSha256)||!count(value.previousSignatureCount,0,19)||!count(value.signatureCount,1,20)||
      value.signatureCount!==value.previousSignatureCount+1||value.revocation!=='good'||checkNames.slice(0,-1).some(key=>checks[key]!=='passed')||checks.revocation!=='good'||!value.certificate)return false;
  }else{
    const errors=['INVALID_REQUEST','VALIDATION_UNAVAILABLE','TRUST_POLICY_REQUIRED','REVOCATION_UNAVAILABLE','REVOCATION_EVIDENCE_INVALID','DOCUMENT_MISMATCH','ONE_NEW_SIGNATURE_REQUIRED','CONTENT_CHANGED','UNAUTHORIZED_FORM_CHANGES','PREVIOUS_SIGNATURE_CHANGED','CMS_SIGNATURE_INVALID','CRYPTOGRAPHIC_VALIDATION_FAILED','CHAIN_NOT_TRUSTED','CERTIFICATE_NOT_VALID','CERTIFICATE_CONSTRAINTS_FAILED','CERTIFICATE_REVOKED','UNSIGNED_TRAILING_CONTENT','UNSUPPORTED_SIGNATURE_PROFILE','SIGNER_IDENTITY_MISMATCH','SIGNATURE_POSITION_MISMATCH','CANONICAL_PREPARATION_REQUIRED','UNSAFE_PDF_CONTENT','PDF_COMPLEXITY_LIMIT'];
    if(!exact(value,['accepted','valid','policy','error','checks','legalOutcome'],['issuerDetected'])||!errors.includes(String(value.error))||value.certificate!==undefined||
      (value.issuerDetected!==undefined&&(!['CHAIN_NOT_TRUSTED'].includes(String(value.error))||!text(value.issuerDetected,4096))))return false;
    return true;
  }
  if (value.certificate !== undefined) {
    const c = value.certificate;
    if (!record(c) || !exact(c, ['subject','issuer','serial','notBefore','notAfter','fingerprint']) || !text(c.subject, 4096) || !text(c.issuer, 4096) || !text(c.serial, 512) ||
        !hash(c.fingerprint) || !date(c.notBefore) || !date(c.notAfter) || Date.parse(c.notAfter) <= Date.parse(c.notBefore)) return false;
  }
  return true;
}
