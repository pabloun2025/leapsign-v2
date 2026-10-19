/** Public contracts only. A private key, certificate container or password must
 * never be part of a transport, persisted record or validator response. */
export type SignatureAppearanceProfile = 'firmaec-qr-compatible' | 'firmaec-information-compatible' | 'firmaec-information-extended-compatible';
export type SigningState = 'draft' | 'ready_for_signer' | 'signature_intent_issued' | 'awaiting_local_signature' | 'signed_pending_validation' | 'validated' | 'next_signer_ready' | 'completed' | 'rejected' | 'expired' | 'failed';
export type SignaturePosition = { page: number; x: number; y: number; width: number; height: number };
export type PublicCertificate = {
  subject: string; issuer: string; serial: string; notBefore: string; notAfter: string; fingerprint: string;
};
export type SigningIntent = {
  id: string; documentId: string; versionId: string; baseSha256: string;
  stageId: string; signerId: string; role: string; profile: SignatureAppearanceProfile;
  position: SignaturePosition; issuedAt: string; expiresAt: string; nonce: string;
  state: SigningState; correlationId: string;
  expectedFingerprint?: string;
};
export type PrepareSigningInput = { documentId: string; profile: SignatureAppearanceProfile; position: SignaturePosition };
export type SignedDocument = { intentId: string; pdf: Uint8Array; sha256: string };
/** Local only: NEVER serialize this object to an API, storage or telemetry. */
export type LocalSigningInput = { intent: SigningIntent; pdf: Uint8Array; certificate: File; password: string; reason: string; location: string };
export type ExternalSigningInput = { intentId: string; pdf: File };
export type ValidateSignatureInput = { intentId: string; pdf: Uint8Array };
export type SignatureValidationResult = {
  valid: boolean; policy: 'leapsign-v2-strict-offline-1'; baseSha256: string;
  signedSha256: string; previousSignatureCount: number; signatureCount: number;
  certificate?: PublicCertificate; revocation: 'good' | 'failed'; error?: string;
};
export interface SignatureProvider {
  prepareSigning(input: PrepareSigningInput): Promise<SigningIntent>;
  signLocally?(input: LocalSigningInput): Promise<SignedDocument>;
  submitExternalSignature(input: ExternalSigningInput): Promise<SignatureValidationResult>;
  validate(input: ValidateSignatureInput): Promise<SignatureValidationResult>;
}
