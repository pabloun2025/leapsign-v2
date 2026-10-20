import {createHash} from 'node:crypto';
import type {SigningIntent, PrepareSigningInput} from '../../src/v2/contracts';
import {MAX_PDF_BYTES, V2_ORIGIN, assertV2Origin, signingFlags, type SigningFlags} from '../../src/v2/policy';
import {isPublicSigningIntent} from '../../src/v2/public-data';
import {issueIntent, authorizeIntent, type CanonicalStage} from './intents';

/** Server-only ports. Adapters MUST use verified sessions, atomic shared budgets
 * and private immutable storage. This module is not mounted in v1. */
export interface PreparationDependencies {
  /** Explicit deployment origin; staging and production never share sessions. */
  origin?: string;
  flags: SigningFlags;
  authenticate(request: Request): Promise<string | null>;
  reserve(actor: string, operation: 'prepare' | 'download'): Promise<void>;
  loadStage(documentId: string, actor: string): Promise<CanonicalStage & {filename: string; previousSignatureCount: number}>;
  loadCanonical(versionId: string, actor: string): Promise<Uint8Array>;
  /** Atomically recheck current stage/version/actor before persisting. */
  persistIntent(intent: SigningIntent): Promise<void>;
  loadIntent(id: string, actor: string): Promise<SigningIntent>;
  now?: () => Date;
}
const headers = {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers:{...headers,'Content-Type':'application/json'}});
const exact = (value: object, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
async function readInput(request: Request): Promise<PrepareSigningInput> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || !request.body) throw Error();
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  const timeout = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {abort = () => {void reader.cancel().catch(()=>{}); reject(Error());}; timeout.addEventListener('abort', abort, {once:true});});
  try {
    if (timeout.aborted) abort();
    while (true) {
      const {done,value} = await Promise.race([reader.read(),stopped]);
      if (done) break;
      size += value.length; if (size > 2048) throw Error(); chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
    const input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!input || !exact(input,['documentId','profile','position']) || typeof input.documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.documentId) || input.profile !== 'firmaec-qr-compatible' || !input.position || !exact(input.position,['page','x','y','width','height']) || !Object.values(input.position).every(v=>typeof v === 'number' && Number.isFinite(v))) throw Error();
    return input;
  } finally {timeout.removeEventListener('abort',abort); await reader.cancel().catch(()=>{}); reader.releaseLock();}
}
function checkPdf(pdf: Uint8Array, hash: string) {
  if (pdf.length < 5 || pdf.length > MAX_PDF_BYTES || new TextDecoder().decode(pdf.subarray(0,5)) !== '%PDF-' || createHash('sha256').update(pdf).digest('hex') !== hash) throw Error();
}
export function createPreparationHandler(deps: PreparationDependencies) {
  const origin=deps.origin ?? V2_ORIGIN;
  assertV2Origin(origin);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url); const flags = signingFlags(deps.flags);
    if (url.origin !== origin || !flags.firmaecProfile || (!flags.direct && !flags.external)) return json({code:'DISABLED'},503);
    const prepare = url.pathname === '/api/v2/signing/prepare' && request.method === 'POST';
    const download = /^\/api\/v2\/signing\/intents\/([a-f0-9-]{36})\/pdf$/.exec(url.pathname);
    if (url.search || (!prepare && !(download && request.method === 'GET'))) return json({code:'NOT_FOUND'},404);
    // Cookie-authenticated mutations require a same-origin custom-header request.
    if (request.headers.get('X-LeapSign-Client') !== 'v2' || (prepare && request.headers.get('Origin') !== origin) || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) return json({code:'FORBIDDEN'},403);
    try {
      const actor = await deps.authenticate(request); if (!actor) return json({code:'UNAUTHENTICATED'},401);
      await deps.reserve(actor,prepare ? 'prepare' : 'download');
      if (request.signal.aborted) throw Error();
      if (prepare) {
        const input = await readInput(request);
        const stage = await deps.loadStage(input.documentId,actor);
        if (stage.documentId !== input.documentId) throw Error();
        if (!Number.isInteger(stage.previousSignatureCount) || stage.previousSignatureCount < 0 || stage.previousSignatureCount > 19 || !/^[^\r\n/\\]{1,124}\.pdf$/i.test(stage.filename)) throw Error();
        const width=Math.min(250,stage.pageWidth-20),height=Math.min(82,stage.pageHeight-20);
        const position=input.position.page===0
          ? {page:stage.pageCount,x:Math.max(0,stage.pageWidth-width-20),y:20,width,height}
          : input.position;
        const intent = issueIntent(stage,actor,input.profile,position,deps.now?.());
        if (!isPublicSigningIntent(intent)) throw Error();
        checkPdf(await deps.loadCanonical(stage.versionId,actor),intent.baseSha256);
        if (request.signal.aborted) throw Error();
        await deps.persistIntent(intent);
        return json({intent,filename:stage.filename,previousSignatureCount:stage.previousSignatureCount,pdfPath:`/api/v2/signing/intents/${intent.id}/pdf`});
      }
      const intent = await deps.loadIntent(download![1],actor);
      if (!isPublicSigningIntent(intent) || intent.id !== download![1]) throw Error();
      const stage = await deps.loadStage(intent.documentId,actor);
      authorizeIntent(intent,stage,actor,intent.nonce,deps.now?.());
      const pdf = await deps.loadCanonical(intent.versionId,actor); checkPdf(pdf,intent.baseSha256);
      if (request.signal.aborted) throw Error();
      return new Response(new Uint8Array(pdf),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="document.pdf"'}});
    } catch {return json({code:'UNAVAILABLE'},409);} // Never expose storage/session errors or document existence.
  };
}
