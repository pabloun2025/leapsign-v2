import type {PrepareSigningInput, SignatureValidationResult, SigningIntent} from './contracts';
import {assertV2Origin, INTENT_LIFETIME_MS, MAX_PDF_BYTES, signingFlags, validateCertificateFile, type SigningFlags} from './policy';
import {LocalSigningError, type LocalWorkerRequest, type LocalSessionResult} from './local-session';

/** This port belongs to the authenticated v2 API, NOT a client-side validator.
 * No method accepts certificate files, private keys, passwords or worker reports. */
export interface SigningWorkflowApi {
  prepare(input: PrepareSigningInput, signal: AbortSignal): Promise<{
    intent: SigningIntent; pdf: Uint8Array; filename: string; previousSignatureCount: number;
  }>;
  submit(input: {intentId: string; nonce: string; pdf: Uint8Array; sha256: string}, signal: AbortSignal): Promise<SignatureValidationResult>;
}
export type WorkflowPhase = 'idle' | 'preparing' | 'ready' | 'signing' | 'validating' | 'validated' | 'cancelled' | 'expired' | 'failed';
export type WorkflowSnapshot = {
  phase: WorkflowPhase; filename?: string; expiresAt?: string; intentId?: string;
  signatureCount?: number; message?: string; directEnabled: boolean; externalEnabled: boolean;
  outcomeUnknown?: boolean;
};
const messages = {
  DISABLED: 'La firma no está disponible en este momento.',
  BUSY: 'Hay una operación de firma en curso.',
  CANCELLED: 'Operación cancelada antes del envío.',
  EXPIRED: 'Tu turno ha caducado. Abre el documento de nuevo.',
  PREPARATION_FAILED: 'No se pudo preparar tu turno. Vuelve a abrir el documento.',
  DOCUMENT_MISMATCH: 'El PDF no corresponde al documento de este turno.',
  CERTIFICATE_INVALID: 'Selecciona un certificado .p12 o .pfx de hasta 1 MB.',
  LOCAL_FAILURE: 'No se pudo firmar. Comprueba el certificado y la contraseña.',
  SUBMISSION_UNCONFIRMED: 'No pudimos confirmar el resultado. Consulta el seguimiento antes de volver a firmar.',
  SIGNATURE_REJECTED: 'La firma no superó la validación. El turno no se ha completado.',
} as const;
export class WorkflowError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
type Prepared = Awaited<ReturnType<SigningWorkflowApi['prepare']>>;
export type LocalSigner = (request: LocalWorkerRequest, signal: AbortSignal) => Promise<LocalSessionResult>;
type Options = {api: SigningWorkflowApi; localSigner: LocalSigner; flags: SigningFlags; origin: string; actorId: string; now?: () => number};
const bytesHash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), n => n.toString(16).padStart(2, '0')).join('');

/** UI coordinator only. Server Auth/quotas/SQL/independent CMS checks remain
 * authoritative. Not mounted in v1, not a replacement for the pending API. */
export class SigningWorkflow {
  private prepared?: Prepared;
  private abort?: AbortController;
  private generation = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: WorkflowSnapshot;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    assertV2Origin(options.origin);
    const flags = signingFlags(options.flags);
    this.now = options.now ?? Date.now;
    this.snapshot = {phase: 'idle', directEnabled: flags.direct && flags.firmaecProfile, externalEnabled: flags.external && flags.firmaecProfile};
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  canonicalCopy() {return this.prepared ? new Uint8Array(this.prepared.pdf) : undefined;}
  private update(value: Partial<WorkflowSnapshot>) {
    if (this.disposed) return;
    this.snapshot = {...this.snapshot, ...value};
    this.listeners.forEach(listener => listener());
  }
  private assertAvailable(mode?: 'direct' | 'external') {
    if (this.disposed || (mode === 'direct' ? !this.snapshot.directEnabled : mode === 'external' ? !this.snapshot.externalEnabled : !this.snapshot.directEnabled && !this.snapshot.externalEnabled)) throw new WorkflowError('DISABLED');
    if (['preparing', 'signing', 'validating'].includes(this.snapshot.phase)) throw new WorkflowError('BUSY');
  }
  private requirePrepared() {
    if (!this.prepared || this.snapshot.phase !== 'ready') throw new WorkflowError('PREPARATION_FAILED');
    if (Date.parse(this.prepared.intent.expiresAt) <= this.now()) {
      this.prepared = undefined; this.update({phase: 'expired', message: messages.EXPIRED});
      throw new WorkflowError('EXPIRED');
    }
    return this.prepared;
  }
  private stillCurrent(generation: number) {
    if (generation !== this.generation || this.disposed) throw new WorkflowError('CANCELLED');
  }
  async prepare(input: PrepareSigningInput) {
    this.assertAvailable();
    if (this.snapshot.outcomeUnknown) throw new WorkflowError('SUBMISSION_UNCONFIRMED');
    const generation = ++this.generation;
    const abort = this.abort = new AbortController();
    this.prepared = undefined;
    this.update({phase: 'preparing', filename: undefined, intentId: undefined, expiresAt: undefined, message: undefined, signatureCount: undefined, outcomeUnknown: false});
    try {
      const value = await this.options.api.prepare(input, abort.signal);
      this.stillCurrent(generation);
      const i = value.intent;
      const issued = Date.parse(i.issuedAt), expires = Date.parse(i.expiresAt);
      if (i.documentId !== input.documentId || i.signerId !== this.options.actorId || i.profile !== input.profile ||
          !['signature_intent_issued', 'awaiting_local_signature'].includes(i.state) ||
          !['id', 'versionId', 'stageId', 'nonce', 'correlationId'].every(key => typeof i[key as keyof SigningIntent] === 'string' && String(i[key as keyof SigningIntent]).length > 0 && String(i[key as keyof SigningIntent]).length <= 128) ||
          !(['page', 'x', 'y', 'width', 'height'] as const).every(key => Number.isFinite(i.position[key]) && i.position[key] === input.position[key]) ||
          !Number.isFinite(issued) || !Number.isFinite(expires) || issued > this.now() + 30_000 || expires <= this.now() || expires <= issued || expires - issued > INTENT_LIFETIME_MS ||
          !(value.pdf instanceof Uint8Array) || value.pdf.length < 5 || value.pdf.length > MAX_PDF_BYTES ||
          new TextDecoder().decode(value.pdf.subarray(0, 5)) !== '%PDF-' ||
          typeof value.filename !== 'string' || value.filename.length > 128 || !/^[^\r\n/\\]+\.pdf$/i.test(value.filename) ||
          !Number.isInteger(value.previousSignatureCount) || value.previousSignatureCount < 0 || value.previousSignatureCount >= 20 ||
          !/^[a-f0-9]{64}$/.test(i.baseSha256) || await bytesHash(value.pdf) !== i.baseSha256) throw new WorkflowError('PREPARATION_FAILED');
      this.stillCurrent(generation);
      this.prepared = {filename: value.filename, previousSignatureCount: value.previousSignatureCount, pdf: new Uint8Array(value.pdf), intent: {...i, position: {...i.position}}};
      this.update({phase: 'ready', filename: value.filename, intentId: i.id, expiresAt: i.expiresAt});
    } catch (error) {
      if (generation !== this.generation || this.disposed) throw new WorkflowError('CANCELLED');
      this.prepared = undefined;
      this.update({phase: 'failed', message: messages.PREPARATION_FAILED});
      throw error instanceof WorkflowError ? error : new WorkflowError('PREPARATION_FAILED');
    }
  }
  async signLocal(input: {certificate: File; password: string; reason: string; location: string}) {
    this.assertAvailable('direct');
    const prepared = this.requirePrepared();
    try { validateCertificateFile(input.certificate); }
    catch {this.update({message: messages.CERTIFICATE_INVALID}); throw new WorkflowError('CERTIFICATE_INVALID');}
    const generation = ++this.generation;
    const abort = this.abort = new AbortController();
    this.update({phase: 'signing', message: undefined});
    let certificate: ArrayBuffer | undefined;
    try {
      certificate = await input.certificate.arrayBuffer();
      this.stillCurrent(generation);
      const candidate = await this.options.localSigner({intent: {...prepared.intent, position: {...prepared.intent.position}},
        pdf: new Uint8Array(prepared.pdf).buffer, certificate, password: input.password, reason: input.reason, location: input.location}, abort.signal);
      this.stillCurrent(generation);
      if (candidate.intentId !== prepared.intent.id) throw new WorkflowError('DOCUMENT_MISMATCH');
      await this.submit(candidate.pdf, prepared, generation, abort.signal);
    } catch (error) {this.failOperation(error, generation);}
    finally {if (certificate?.byteLength) new Uint8Array(certificate).fill(0);}
  }
  async submitExternal(pdf: Uint8Array) {
    this.assertAvailable('external');
    const prepared = this.requirePrepared();
    const generation = ++this.generation;
    const abort = this.abort = new AbortController();
    this.update({phase: 'signing', message: undefined});
    try {await this.submit(new Uint8Array(pdf), prepared, generation, abort.signal);}
    catch (error) {this.failOperation(error, generation);}
  }
  private async submit(pdf: Uint8Array, prepared: Prepared, generation: number, signal: AbortSignal) {
    if (!(pdf instanceof Uint8Array) || pdf.length <= prepared.pdf.length || pdf.length > MAX_PDF_BYTES ||
        prepared.pdf.some((byte, index) => pdf[index] !== byte)) throw new WorkflowError('DOCUMENT_MISMATCH');
    if (Date.parse(prepared.intent.expiresAt) <= this.now()) throw new WorkflowError('EXPIRED');
    const hash = await bytesHash(pdf);
    this.stillCurrent(generation);
    // After submission begins, cancellation cannot promise the server did not
    // commit. Disable the cancel action and never retry the mutation silently.
    this.update({phase: 'validating', message: undefined});
    let report: SignatureValidationResult;
    try {report = await this.options.api.submit({intentId: prepared.intent.id, nonce: prepared.intent.nonce, pdf, sha256: hash}, signal);}
    catch {throw new WorkflowError('SUBMISSION_UNCONFIRMED');}
    if (report.valid !== true || report.policy !== 'leapsign-v2-strict-offline-1' || report.baseSha256 !== prepared.intent.baseSha256 || report.signedSha256 !== hash ||
        report.revocation !== 'good' || !report.certificate || report.previousSignatureCount !== prepared.previousSignatureCount || report.signatureCount !== prepared.previousSignatureCount + 1 ||
        (prepared.intent.expectedFingerprint && report.certificate.fingerprint !== prepared.intent.expectedFingerprint)) throw new WorkflowError('SIGNATURE_REJECTED');
    this.prepared = undefined;
    this.update({phase: 'validated', signatureCount: report.signatureCount, message: 'Tu firma ha sido validada y guardada.'});
  }
  private failOperation(error: unknown, generation: number): never {
    if (generation !== this.generation || this.disposed) throw new WorkflowError('CANCELLED');
    const code = error instanceof WorkflowError ? error.code : error instanceof LocalSigningError && error.code === 'EXPIRED' ? 'EXPIRED' : 'LOCAL_FAILURE';
    const submitted = this.snapshot.phase === 'validating';
    if (submitted || code === 'EXPIRED') this.prepared = undefined;
    this.update({phase: code === 'EXPIRED' ? 'expired' : submitted ? 'failed' : 'ready', message: messages[code], outcomeUnknown: code === 'SUBMISSION_UNCONFIRMED'});
    throw new WorkflowError(code);
  }
  cancel() {
    if (this.snapshot.phase === 'validating') return false;
    this.generation++; this.abort?.abort(); this.prepared = undefined;
    this.update({phase: 'cancelled', message: messages.CANCELLED});
    return true;
  }
  dispose() {this.cancel(); this.disposed = true; this.listeners.clear();}
}
