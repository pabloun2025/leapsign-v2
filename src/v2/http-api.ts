import type {PrepareSigningInput, SignatureValidationResult} from './contracts';
import type {SigningWorkflowApi} from './signing-workflow';
import {assertV2Origin, MAX_PDF_BYTES, signingFlags, type SigningFlags} from './policy';
import {isPublicSigningIntent, isPublicValidationReport} from './public-data';

export class SigningTransportError extends Error {
  constructor(readonly code: 'DISABLED' | 'INVALID_REQUEST' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'ABORTED') {super(code);}
}
type Options = {origin: string; flags: SigningFlags; fetch?: typeof fetch; timeoutMs?: number};

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new SigningTransportError('INVALID_RESPONSE');
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body.cancel(); throw new SigningTransportError('INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let abortRead!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortRead = () => {void reader.cancel().catch(() => {}); reject(new SigningTransportError('ABORTED'));};
    signal.addEventListener('abort', abortRead, {once: true});
  });
  try {
    if (signal.aborted) abortRead();
    while (true) {
      const {done, value} = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {await reader.cancel(); throw new SigningTransportError('INVALID_RESPONSE');}
      chunks.push(value);
    }
    if (signal.aborted) throw new SigningTransportError('ABORTED');
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
    return result;
  } finally {signal.removeEventListener('abort', abortRead); reader.releaseLock();}
}

/** Same-origin authenticated transport. The future server MUST independently
 * enforce session auth, Origin/CSRF, quotas, ownership and one-use intents.
 * These endpoint contracts are not deployed. No bearer credential is persisted.
 */
export class V2HttpSigningApi implements SigningWorkflowApi {
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  constructor(private readonly options: Options) {
    assertV2Origin(options.origin);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeout = options.timeoutMs ?? 20_000;
    if (!Number.isFinite(this.timeout) || this.timeout < 1 || this.timeout > 30_000) throw new SigningTransportError('INVALID_REQUEST');
  }
  private guard() {
    const flags = signingFlags(this.options.flags);
    if (!flags.firmaecProfile || (!flags.direct && !flags.external)) throw new SigningTransportError('DISABLED');
  }
  private signal(caller: AbortSignal) {return AbortSignal.any([caller, AbortSignal.timeout(this.timeout)]);}
  private async request(path: string, init: RequestInit, signal: AbortSignal, type: string) {
    if (signal.aborted) throw new SigningTransportError('ABORTED');
    try {
      const response = await this.fetcher(this.options.origin + path, {...init, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: {...init.headers, Accept: type, 'X-LeapSign-Client': 'v2'}});
      if (!response.ok || response.redirected) {
        await response.body?.cancel(); throw new SigningTransportError('UNAVAILABLE');
      }
      if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== type) {
        await response.body?.cancel(); throw new SigningTransportError('INVALID_RESPONSE');
      }
      return response;
    } catch (error) {
      if (error instanceof SigningTransportError) throw error;
      throw new SigningTransportError(signal.aborted ? 'ABORTED' : 'UNAVAILABLE');
    }
  }
  private async json(response: Response, signal: AbortSignal): Promise<unknown> {
    try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readBounded(response, 16_384, signal)));}
    catch (error) {if (error instanceof SigningTransportError) throw error; throw new SigningTransportError('INVALID_RESPONSE');}
  }
  async prepare(input: PrepareSigningInput, caller: AbortSignal) {
    this.guard();
    if (typeof input.documentId !== 'string' || !input.documentId.length || input.documentId.length > 128 || input.profile !== 'firmaec-qr-compatible') throw new SigningTransportError('INVALID_REQUEST');
    const {page, x, y, width, height} = input.position;
    if (![page, x, y, width, height].every(Number.isFinite)) throw new SigningTransportError('INVALID_REQUEST');
    const signal = this.signal(caller);
    const metadata = await this.json(await this.request('/api/v2/signing/prepare', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({documentId: input.documentId, profile: input.profile, position: {page, x, y, width, height}}),
    }, signal, 'application/json'), signal);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new SigningTransportError('INVALID_RESPONSE');
    const value = metadata as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'filename,intent,pdfPath,previousSignatureCount' || !isPublicSigningIntent(value.intent) ||
        typeof value.filename !== 'string' || value.filename.length > 128 || !/^[^\r\n/\\]+\.pdf$/i.test(value.filename) ||
        !Number.isInteger(value.previousSignatureCount) || Number(value.previousSignatureCount) < 0 || Number(value.previousSignatureCount) > 19 ||
        !/^[a-f0-9-]{36}$/.test(value.intent.id) || value.pdfPath !== `/api/v2/signing/intents/${value.intent.id}/pdf`) throw new SigningTransportError('INVALID_RESPONSE');
    const pdf = await readBounded(await this.request(value.pdfPath as string, {method: 'GET'}, signal, 'application/pdf'), MAX_PDF_BYTES, signal);
    return {intent: value.intent, filename: value.filename, previousSignatureCount: Number(value.previousSignatureCount), pdf};
  }
  async submit(input: {intentId: string; nonce: string; pdf: Uint8Array; sha256: string}, caller: AbortSignal): Promise<SignatureValidationResult> {
    this.guard();
    if (!/^[a-f0-9-]{36}$/.test(input.intentId) || typeof input.nonce !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(input.nonce) ||
        !/^[a-f0-9]{64}$/.test(input.sha256) || !(input.pdf instanceof Uint8Array) || input.pdf.length < 5 || input.pdf.length > MAX_PDF_BYTES) throw new SigningTransportError('INVALID_REQUEST');
    const signal = this.signal(caller);
    // Raw bounded PDF only: certificates, passwords and arbitrary multipart
    // fields have no transport representation. The server computes its hash.
    const value = await this.json(await this.request('/api/v2/signing/submit', {method: 'POST', headers:{'Content-Type':'application/pdf','X-LeapSign-Intent':input.intentId,'X-LeapSign-Nonce':input.nonce}, body:new Uint8Array(input.pdf)}, signal, 'application/json'), signal);
    if (!isPublicValidationReport(value)) throw new SigningTransportError('INVALID_RESPONSE');
    return value;
  }
}
