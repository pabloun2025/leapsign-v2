import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SignatureAppearanceProfile, SignaturePosition, SigningIntent, SignatureValidationResult } from '../../src/v2/contracts';
import { INTENT_LIFETIME_MS, MAX_PDF_BYTES } from '../../src/v2/policy';
import {isPublicValidationReport} from '../../src/v2/public-data';

export type CanonicalStage = { documentId: string; versionId: string; baseSha256: string; stageId: string; signerId: string; role: string; pageCount: number; pageWidth: number; pageHeight: number; expectedFingerprint?: string };
export class SigningError extends Error {
  constructor(readonly code: string) { super(code); }
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function issueIntent(stage: CanonicalStage, actorId: string, profile: SignatureAppearanceProfile, position: SignaturePosition, now = new Date()): SigningIntent {
  if (stage.signerId !== actorId) throw new SigningError('NOT_YOUR_TURN');
  if (!/^[a-f0-9]{64}$/.test(stage.baseSha256)) throw new SigningError('INVALID_CANONICAL_HASH');
  if (![stage.pageCount, stage.pageWidth, stage.pageHeight].every(Number.isFinite) || !Number.isInteger(stage.pageCount) || stage.pageCount < 1 || stage.pageCount > 500 || stage.pageWidth <= 0 || stage.pageHeight <= 0) throw new SigningError('INVALID_CANONICAL_GEOMETRY');
  if (stage.expectedFingerprint && !/^[a-f0-9]{64}$/.test(stage.expectedFingerprint)) throw new SigningError('INVALID_SIGNER_POLICY');
  if (profile !== 'firmaec-qr-compatible') throw new SigningError('PROFILE_UNSUPPORTED');
  const {page, x, y, width, height} = position;
  if (![page, x, y, width, height].every(Number.isFinite) || page !== stage.pageCount || x < 0 || y < 0 || width < 100 || height < 50 || x + width > stage.pageWidth || y + height > stage.pageHeight) throw new SigningError('INVALID_POSITION');
  return {
    id: randomUUID(), documentId: stage.documentId, versionId: stage.versionId, baseSha256: stage.baseSha256,
    stageId: stage.stageId, signerId: actorId, role: stage.role, profile, position: {...position},
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + INTENT_LIFETIME_MS).toISOString(),
    nonce: randomBytes(32).toString('base64url'), state: 'signature_intent_issued', correlationId: randomUUID(),
    ...(stage.expectedFingerprint ? {expectedFingerprint:stage.expectedFingerprint} : {}),
  };
}
export function authorizeIntent(intent: SigningIntent, current: CanonicalStage, actorId: string, nonce: string, now = new Date()) {
  if (actorId !== intent.signerId || actorId !== current.signerId) throw new SigningError('NOT_YOUR_TURN');
  if (nonce !== intent.nonce) throw new SigningError('INTENT_UNAUTHORIZED');
  const issued = Date.parse(intent.issuedAt), expires = Date.parse(intent.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(now.getTime()) || expires <= issued || expires - issued > INTENT_LIFETIME_MS) throw new SigningError('INTENT_INVALID');
  if (now.getTime() >= expires) throw new SigningError('INTENT_EXPIRED');
  if (!['signature_intent_issued', 'awaiting_local_signature'].includes(intent.state)) throw new SigningError('INTENT_UNAVAILABLE');
  if (current.documentId !== intent.documentId || current.versionId !== intent.versionId || current.baseSha256 !== intent.baseSha256 || current.stageId !== intent.stageId || current.role !== intent.role || current.expectedFingerprint !== intent.expectedFingerprint) throw new SigningError('CANONICAL_VERSION_CHANGED');
}
export function validateCandidateBinding(intent: SigningIntent, canonical: Uint8Array, signed: Uint8Array) {
  if (canonical.length < 5 || signed.length <= canonical.length || signed.length > MAX_PDF_BYTES || digest(canonical) !== intent.baseSha256) throw new SigningError('DOCUMENT_MISMATCH');
  // Necessary but NOT sufficient: CMS, revisions and trust are checked separately.
  for (let i = 0; i < canonical.length; i++) if (signed[i] !== canonical[i]) throw new SigningError('DOCUMENT_MISMATCH');
  return digest(signed);
}
export function assertValidationReport(intent: SigningIntent, signedHash: string, report: SignatureValidationResult) {
  if (!isPublicValidationReport(report) || report.valid !== true || report.baseSha256 !== intent.baseSha256 || report.signedSha256 !== signedHash || !report.certificate) throw new SigningError('SIGNATURE_REJECTED');
  if (intent.expectedFingerprint && report.certificate.fingerprint !== intent.expectedFingerprint) throw new SigningError('SIGNER_IDENTITY_MISMATCH');
}

/** Persistence adapter contract: claim and commit MUST be atomic in PostgreSQL.
 * No implementation based on a browser flag, client report or in-memory lock
 * may be used in production. Validation failure never advances a stage. */
export interface IntentRepository {
  claim(id: string, actorId: string, nonce: string, candidateSha256: string): Promise<{intent: SigningIntent; current: CanonicalStage; replay?: SignatureValidationResult}>;
  commitValidated(id: string, candidateSha256: string, report: SignatureValidationResult, pdf: Uint8Array): Promise<void>;
  reject(id: string, candidateSha256: string, code: string): Promise<void>;
}
export interface PrivatePdfValidator {
  validate(canonical: Uint8Array, signed: Uint8Array, intent: SigningIntent): Promise<SignatureValidationResult>;
}
export async function submitExternal(repo: IntentRepository, validator: PrivatePdfValidator, id: string, actorId: string, nonce: string, canonical: Uint8Array, signed: Uint8Array) {
  if (signed.length > MAX_PDF_BYTES) throw new SigningError('DOCUMENT_TOO_LARGE');
  const hash = digest(signed);
  const claimed = await repo.claim(id, actorId, nonce, hash);
  if (claimed.replay) return claimed.replay; // Only same actor + nonce + candidate.
  try {
    validateCandidateBinding(claimed.intent, canonical, signed);
    const report = await validator.validate(canonical, signed, claimed.intent);
    if (isPublicValidationReport(report) && !report.accepted) {
      await repo.reject(id, hash, report.error ?? 'VALIDATION_FAILED');
      return report;
    }
    assertValidationReport(claimed.intent, hash, report);
    await repo.commitValidated(id, hash, report, signed); // Reserve upload, store immutable bytes, then CAS the version again.
    return report;
  } catch {
    await repo.reject(id, hash, 'VALIDATION_FAILED');
    throw new SigningError('VALIDATION_FAILED');
  }
}
