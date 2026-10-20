import {createHash} from 'node:crypto';
import {submitExternal, type IntentRepository, type PrivatePdfValidator} from './intents';
import {MAX_PDF_BYTES, V2_ORIGIN, assertV2Origin, signingFlags, type SigningFlags} from '../../src/v2/policy';
import {isPublicValidationReport} from '../../src/v2/public-data';

export interface SubmissionDependencies {
  origin?: string;
  flags: SigningFlags;
  authenticate(request: Request): Promise<string | null>;
  reserve(actor: string, operation: 'submit'): Promise<void>;
  repository: IntentRepository;
  validator: PrivatePdfValidator;
  /** Must load only the current private immutable version authorized by actor. */
  loadCanonical(versionId: string, actor: string): Promise<Uint8Array>;
}
const headers = {'Cache-Control':'no-store','Content-Type':'application/json','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const result = (code: string, status: number) => new Response(JSON.stringify({code}), {status,headers});
async function boundedPdf(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf' || !request.body) throw Error();
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(20_000)]);
  let abort!:()=>void; const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(Error());};signal.addEventListener('abort',abort,{once:true});});
  try {if(signal.aborted)abort(); while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.byteLength;if(size>MAX_PDF_BYTES)throw Error();chunks.push(value);} const pdf=new Uint8Array(size);let at=0;for(const chunk of chunks){pdf.set(chunk,at);at+=chunk.length;}if(pdf.length<5||new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw Error();return pdf;}
  finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Receives only the signed PDF bytes. The nonce travels in a custom header,
 * so certificate files, passwords and arbitrary multipart fields cannot enter
 * this endpoint. Persistence remains behind the atomic repository port. */
export function createSubmissionHandler(deps: SubmissionDependencies) {
  const origin=deps.origin ?? V2_ORIGIN; assertV2Origin(origin);
  return async (request: Request): Promise<Response> => {
    const url=new URL(request.url); const flags=signingFlags(deps.flags);
    if(url.origin!==origin || url.search || url.pathname!=='/api/v2/signing/submit')return result('NOT_FOUND',404);
    if(!flags.firmaecProfile||(!flags.direct&&!flags.external))return result('DISABLED',503);
    if(request.method!=='POST'||request.headers.get('Origin')!==origin||request.headers.get('X-LeapSign-Client')!=='v2'||(request.headers.has('Sec-Fetch-Site')&&request.headers.get('Sec-Fetch-Site')!=='same-origin'))return result('FORBIDDEN',403);
    const id=request.headers.get('X-LeapSign-Intent')??''; const nonce=request.headers.get('X-LeapSign-Nonce')??'';
    if(!/^[a-f0-9-]{36}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(nonce))return result('INVALID_REQUEST',400);
    try {const actor=await deps.authenticate(request);if(!actor)return result('UNAUTHENTICATED',401);await deps.reserve(actor,'submit');const pdf=await boundedPdf(request);const candidate=createHash('sha256').update(pdf).digest('hex');
      // Claim once, then reuse that locked result in submitExternal. This avoids
      // a second mutation while still loading precisely its canonical version.
      const claimed=await deps.repository.claim(id,actor,nonce,candidate);
      if (claimed.replay) return isPublicValidationReport(claimed.replay) ? new Response(JSON.stringify(claimed.replay),{headers}) : result('UNAVAILABLE',409);
      const canonical=await deps.loadCanonical(claimed.intent.versionId,actor);
      const repo:IntentRepository={...deps.repository,claim:async()=>claimed};
      const report=await submitExternal(repo,deps.validator,id,actor,nonce,canonical,pdf);
      return isPublicValidationReport(report)?new Response(JSON.stringify(report),{headers}):result('UNAVAILABLE',409);
    } catch {return result('UNAVAILABLE',409);}
  };
}
