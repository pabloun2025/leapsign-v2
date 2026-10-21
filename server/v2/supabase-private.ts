import {MAX_PDF_BYTES} from '../../src/v2/policy';

const V2_PROJECT_URL='https://lbreydchhskrrmpzniem.supabase.co';
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const PRIVATE_PDF=new RegExp(`^${UUID}/versions/${UUID}\\.pdf$`);
const RPC_RESPONSE_BYTES=65_536;
const STORAGE_RESPONSE_BYTES=16_384;

type Options = {projectUrl: string; publicKey: string; serviceKey: string; bucket: string; fetch?: typeof fetch};
export type StrictRpcDecoder<T>=(value:unknown)=>T;
export type StagedPrivateObject=Readonly<{
  /** Use only after a definitive commit rejection. A timeout or network error
   * from the commit RPC is ambiguous and must never trigger this cleanup. */
  cleanupAfterDefiniteRejection(caller?:AbortSignal):Promise<void>;
}>;

const unavailable=()=>Error('UNAVAILABLE');
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value) && typeof value==='object' && !Array.isArray(value) && (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);
const contentType=(response:Response)=>response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
const deadline=(caller:AbortSignal|undefined,milliseconds:number)=>caller ? AbortSignal.any([caller,AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);

function isJsonValue(value:unknown,seen=new Set<object>(),depth=0):boolean {
  if(value===null || typeof value==='string' || typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(depth>=16 || typeof value!=='object')return false;
  if(seen.has(value))return false;
  seen.add(value);
  const valid=Array.isArray(value)
    ? value.every(item=>isJsonValue(item,seen,depth+1))
    : isRecord(value) && Object.values(value).every(item=>isJsonValue(item,seen,depth+1));
  seen.delete(value);
  return valid;
}

/** Explicit dedicated-v2 configuration only. Never falls back to v1 env vars. */
export function supabasePrivate(options: Options) {
  let url:URL;
  try {url=new URL(options.projectUrl);} catch {throw Error('V2_CONFIGURATION_REQUIRED');}
  if ((options.projectUrl!==V2_PROJECT_URL && options.projectUrl!==`${V2_PROJECT_URL}/`) || url.origin!==V2_PROJECT_URL || !/^[a-z0-9-]{1,63}$/.test(options.bucket) || typeof options.publicKey!=='string' || !options.publicKey || typeof options.serviceKey!=='string' || !options.serviceKey) throw Error('V2_CONFIGURATION_REQUIRED');
  const fetcher=options.fetch ?? fetch;
  const serviceHeaders=(extra:Record<string,string>={})=>({apikey:options.serviceKey,Authorization:`Bearer ${options.serviceKey}`,...extra});

  async function bounded(response:Response,limit:number,signal:AbortSignal) {
    if (!response.body || response.redirected || !response.ok) {await response.body?.cancel();throw unavailable();}
    const length=response.headers.get('Content-Length');
    if (length!==null && (!/^\d+$/.test(length) || Number(length)>limit)) {await response.body.cancel();throw unavailable();}
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    let abort!:()=>void;
    const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(unavailable());};signal.addEventListener('abort',abort,{once:true});});
    try {
      if(signal.aborted)abort();
      while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.length;if(size>limit)throw unavailable();chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
    } finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }

  async function strictJson(response:Response,limit:number,signal:AbortSignal):Promise<unknown> {
    if(response.status!==200 || contentType(response)!=='application/json'){await response.body?.cancel();throw unavailable();}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,limit,signal)));
  }

  function rpcBody(args:Record<string,unknown>) {
    if(!isRecord(args) || Object.keys(args).some(key=>!/^p_[a-z0-9_]{1,60}$/.test(key)) || !isJsonValue(args))throw unavailable();
    const body=JSON.stringify(args);
    if(new TextEncoder().encode(body).length>65_536)throw unavailable();
    return body;
  }

  function validPdf(path:string,pdf:Uint8Array) {
    return PRIVATE_PDF.test(path) && pdf instanceof Uint8Array && pdf.length>=5 && pdf.length<=MAX_PDF_BYTES
      && pdf[0]===0x25 && pdf[1]===0x50 && pdf[2]===0x44 && pdf[3]===0x46 && pdf[4]===0x2d;
  }

  async function rpc<T>(name:string,args:Record<string,unknown>,decode:StrictRpcDecoder<T>,caller?:AbortSignal):Promise<T> {
    if(!/^[a-z][a-z0-9_]{0,62}$/.test(name) || typeof decode!=='function')throw unavailable();
    try {
      const body=rpcBody(args);const signal=deadline(caller,10_000);
      const response=await fetcher(`${url.origin}/rest/v1/rpc/${name}`,{
        method:'POST',headers:serviceHeaders({'Accept':'application/json','Content-Type':'application/json'}),body,redirect:'manual',cache:'no-store',signal,
      });
      const decoded=decode(await strictJson(response,RPC_RESPONSE_BYTES,signal));
      if(decoded===undefined)throw unavailable();
      return decoded;
    } catch {throw unavailable();}
  }

  async function stagePrivateObject(path:string,pdf:Uint8Array,caller?:AbortSignal):Promise<StagedPrivateObject> {
    if(!validPdf(path,pdf))throw unavailable();
    try {
      const signal=deadline(caller,10_000);const body=new Uint8Array(pdf);
      const response=await fetcher(`${url.origin}/storage/v1/object/${options.bucket}/${path}`,{
        method:'POST',headers:serviceHeaders({'Accept':'application/json','Content-Type':'application/pdf','If-None-Match':'*','x-upsert':'false'}),body,redirect:'manual',cache:'no-store',signal,
      });
      const acknowledgement=await strictJson(response,STORAGE_RESPONSE_BYTES,signal);
      if(!isRecord(acknowledgement) || acknowledgement.Key!==`${options.bucket}/${path}` || Object.keys(acknowledgement).some(key=>key!=='Key' && key!=='Id') || ('Id' in acknowledgement && (typeof acknowledgement.Id!=='string' || !new RegExp(`^${UUID}$`).test(acknowledgement.Id))))throw unavailable();
      let active=true;
      return Object.freeze({
        async cleanupAfterDefiniteRejection(cleanupCaller?:AbortSignal) {
          if(!active)throw unavailable();
          // Consume before the request: an ambiguous DELETE is never retried,
          // which prevents a later object at the same path from being removed.
          active=false;
          try {
            const cleanupSignal=deadline(cleanupCaller,10_000);
            const cleanupResponse=await fetcher(`${url.origin}/storage/v1/object/${options.bucket}`,{
              method:'DELETE',headers:serviceHeaders({'Accept':'application/json','Content-Type':'application/json'}),body:JSON.stringify({prefixes:[path]}),redirect:'manual',cache:'no-store',signal:cleanupSignal,
            });
            const deleted=await strictJson(cleanupResponse,STORAGE_RESPONSE_BYTES,cleanupSignal);
            if(!Array.isArray(deleted) || deleted.length!==1 || !isRecord(deleted[0]) || deleted[0].name!==path || deleted[0].bucket_id!==options.bucket)throw unavailable();
          } catch {throw unavailable();}
        },
      });
    } catch {throw unavailable();}
  }

  return {
    /** Cookie must be issued Secure; HttpOnly; SameSite=Strict; Path=/ by the
     * future v2 session exchange. No JWT decode-only authentication. */
    async authenticate(request:Request):Promise<string|null> {
      const cookies=(request.headers.get('Cookie') ?? '').split(';').map(c=>c.trim()).filter(c=>c.startsWith('__Host-leapsign-v2='));
      if(cookies.length!==1)return null;
      const token=cookies[0].slice('__Host-leapsign-v2='.length);
      if(token.length<20 || token.length>8192 || !/^[a-zA-Z0-9._-]+$/.test(token))return null;
      try {
        const signal=deadline(request.signal,5000);
        const response=await fetcher(url.origin+'/auth/v1/user',{headers:{apikey:options.publicKey,Authorization:`Bearer ${token}`},redirect:'manual',cache:'no-store',signal});
        if(contentType(response)!=='application/json'){await response.body?.cancel();return null;}
        const user=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,32768,signal)));
        return typeof user.id==='string' && new RegExp(`^${UUID}$`,'i').test(user.id) && !user.is_anonymous && Boolean(user.email_confirmed_at) ? user.id : null;
      } catch {return null;}
    },
    /** Verifies a browser-presented v2 access token remotely before the session
     * handler places it in an HTTP-only cookie. This never decodes a JWT. */
    async verifyAccessToken(token:string,caller:AbortSignal):Promise<string|null> {
      if(typeof token!=='string' || token.length<20 || token.length>8192 || !/^[a-zA-Z0-9._-]+$/.test(token))return null;
      try {
        const signal=deadline(caller,5000);
        const response=await fetcher(url.origin+'/auth/v1/user',{headers:{apikey:options.publicKey,Authorization:`Bearer ${token}`},redirect:'manual',cache:'no-store',signal});
        if(contentType(response)!=='application/json'){await response.body?.cancel();return null;}
        const user=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,32768,signal)));
        const valid=typeof user.id==='string' && new RegExp(`^${UUID}$`,'i').test(user.id) && !user.is_anonymous && Boolean(user.email_confirmed_at);
        return valid ? user.id : null;
      } catch {return null;}
    },
    rpc,
    stagePrivateObject,
    /** Repository port for callers whose transaction owns compensation. */
    async writePrivateObject(path:string,pdf:Uint8Array,caller?:AbortSignal):Promise<void> {await stagePrivateObject(path,pdf,caller);},
    async readPrivateObject(path:string,maxBytes:number,caller?:AbortSignal):Promise<Uint8Array> {
      if(!PRIVATE_PDF.test(path) || !Number.isInteger(maxBytes) || maxBytes<5 || maxBytes>MAX_PDF_BYTES)throw unavailable();
      try {
        const signal=deadline(caller,10_000);
        const response=await fetcher(`${url.origin}/storage/v1/object/authenticated/${options.bucket}/${path}`,{headers:serviceHeaders(),redirect:'manual',cache:'no-store',signal});
        if(contentType(response)!=='application/pdf'){await response.body?.cancel();throw unavailable();}
        const bytes=await bounded(response,maxBytes,signal);
        if(!validPdf(path,bytes))throw unavailable();
        return bytes;
      } catch {throw unavailable();}
    },
  };
}
