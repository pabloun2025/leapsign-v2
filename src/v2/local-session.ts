import type {SigningIntent} from './contracts';
import {MAX_CERTIFICATE_BYTES, MAX_PDF_BYTES} from './policy';
import {createLocalEngineWorker} from './local-engine/client';

/** Browser-only boundary. Never pass this request to fetch, storage or logging.
 * A dedicated worker must be created per operation, with no network access.
 * Termination releases references; JavaScript cannot guarantee zeroisation. */
export type LocalWorkerRequest = {
  intent: SigningIntent; pdf: ArrayBuffer; certificate: ArrayBuffer;
  password: string; reason: string; location: string;
};
export interface SigningWorkerPort {
  postMessage(request: LocalWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
export type LocalSessionOptions = {
  createWorker: () => SigningWorkerPort;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};
export type LocalSessionResult = {intentId: string; pdf: Uint8Array};
const messages = {
  CANCELLED: 'Firma cancelada. Tu documento no ha cambiado.',
  EXPIRED: 'El turno de firma ha caducado. Vuelve a solicitarlo.',
  INVALID_INPUT: 'No se pudo preparar el documento o el certificado.',
  TIMEOUT: 'La firma tardó demasiado. Inténtalo de nuevo.',
  LOCAL_FAILURE: 'No se pudo firmar el PDF en este dispositivo.',
} as const;
export class LocalSigningError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}

/** Transfers (detaches) input buffers to the isolated worker. Output remains
 * UNVALIDATED: callers must submit it to the independent backend validator.
 * This function intentionally has no network/storage/certificate persistence. */
export async function runLocalSigningSession(
  request: LocalWorkerRequest, options: LocalSessionOptions,
): Promise<LocalSessionResult> {
  const now = options.now ?? Date.now;
  if (options.signal?.aborted) throw new LocalSigningError('CANCELLED');
  const expiry = Date.parse(request.intent.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now()) throw new LocalSigningError('EXPIRED');
  const timeout = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000 ||
      !(request.pdf instanceof ArrayBuffer) || request.pdf.byteLength < 5 || request.pdf.byteLength > MAX_PDF_BYTES ||
      !(request.certificate instanceof ArrayBuffer) || request.certificate.byteLength < 1 || request.certificate.byteLength > MAX_CERTIFICATE_BYTES ||
      request.pdf === request.certificate || typeof request.password !== 'string' || request.password.length > 4096 ||
      typeof request.reason !== 'string' || request.reason.length > 500 ||
      typeof request.location !== 'string' || request.location.length > 200 ||
      !['signature_intent_issued', 'awaiting_local_signature'].includes(request.intent.state)) {
    throw new LocalSigningError('INVALID_INPUT');
  }
  let worker: SigningWorkerPort;
  try { worker = options.createWorker(); }
  catch { throw new LocalSigningError('LOCAL_FAILURE'); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      // Drop references, including the immutable password string. This does not
      // overwrite caller-owned values or guarantee physical memory erasure.
      request = undefined as unknown as LocalWorkerRequest;
    };
    const fail = (code: keyof typeof messages) => {
      if (settled) return;
      settled = true; cleanup(); reject(new LocalSigningError(code));
    };
    const abort = () => fail('CANCELLED');
    const timer = setTimeout(() => fail(expiry <= now() ? 'EXPIRED' : 'TIMEOUT'), Math.min(timeout, expiry - now()));
    worker.onerror = event => { event.preventDefault(); fail('LOCAL_FAILURE'); };
    worker.onmessageerror = () => fail('LOCAL_FAILURE');
    worker.onmessage = event => {
      if (settled) return;
      if (expiry <= now()) { fail('EXPIRED'); return; }
      const value = event.data;
      if (!value || typeof value !== 'object') { fail('LOCAL_FAILURE'); return; }
      const result = value as Record<string, unknown>;
      // No arbitrary worker strings, certificate details or exceptions escape.
      if (Object.keys(result).sort().join(',') !== 'intentId,pdf,type' || result.type !== 'signed' ||
          result.intentId !== request.intent.id || !(result.pdf instanceof ArrayBuffer) ||
          result.pdf.byteLength < 5 || result.pdf.byteLength > MAX_PDF_BYTES ||
          new TextDecoder().decode(new Uint8Array(result.pdf, 0, 5)) !== '%PDF-') {
        fail('LOCAL_FAILURE'); return;
      }
      const output = {intentId: request.intent.id, pdf: new Uint8Array(result.pdf)};
      settled = true; cleanup(); resolve(output);
    };
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) { abort(); return; }
    try { worker.postMessage(request, [request.pdf, request.certificate]); }
    catch { fail('LOCAL_FAILURE'); }
  });
}

/** Product-facing LocalSigner. Certificate and password only cross this
 * in-browser transfer boundary and are never accepted by an HTTP adapter. */
export function signWithLocalEngine(request: LocalWorkerRequest, signal: AbortSignal) {
  return runLocalSigningSession(request, {createWorker: createLocalEngineWorker, signal});
}
