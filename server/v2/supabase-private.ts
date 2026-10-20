import {MAX_PDF_BYTES} from '../../src/v2/policy';

type Options = {projectUrl: string; publicKey: string; serviceKey: string; bucket: string; fetch?: typeof fetch};
/** Explicit dedicated-v2 configuration only. Never falls back to v1 env vars. */
export function supabasePrivate(options: Options) {
  const url = new URL(options.projectUrl);
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(options.projectUrl) || url.hostname==='lgsdoutarthfymbjgdrj.supabase.co' || !/^[a-z0-9-]{1,63}$/.test(options.bucket) || !options.publicKey || !options.serviceKey) throw Error('V2_CONFIGURATION_REQUIRED');
  const fetcher=options.fetch ?? fetch;
  async function bounded(response: Response, limit: number, signal: AbortSignal) {
    if (!response.body || response.redirected || !response.ok) {await response.body?.cancel();throw Error('UNAVAILABLE');}
    const length=response.headers.get('Content-Length');
    if (length!==null && (!/^\d+$/.test(length) || Number(length)>limit)) {await response.body.cancel();throw Error('UNAVAILABLE');}
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    let abort!:()=>void;
    const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(Error('UNAVAILABLE'));};signal.addEventListener('abort',abort,{once:true});});
    try {
      if(signal.aborted) abort();
      while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.length;if(size>limit)throw Error('UNAVAILABLE');chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
    } finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  return {
    /** Cookie must be issued Secure; HttpOnly; SameSite=Strict; Path=/ by the
     * future v2 session exchange. No JWT decode-only authentication. */
    async authenticate(request: Request): Promise<string|null> {
      const cookies=(request.headers.get('Cookie') ?? '').split(';').map(c=>c.trim()).filter(c=>c.startsWith('__Host-leapsign-v2='));
      if(cookies.length!==1)return null;
      const token=cookies[0].slice('__Host-leapsign-v2='.length);
      if(token.length<20 || token.length>8192 || !/^[a-zA-Z0-9._-]+$/.test(token))return null;
      try {
        const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
        const response=await fetcher(url.origin+'/auth/v1/user',{headers:{apikey:options.publicKey,Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal});
        if(response.headers.get('Content-Type')?.split(';')[0]!=='application/json'){await response.body?.cancel();return null;}
        const user=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,32768,signal)));
        return typeof user.id==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(user.id) && !user.is_anonymous && Boolean(user.email_confirmed_at) ? user.id : null;
      } catch {return null;}
    },
    /** Verifies a browser-presented v2 access token remotely before the session
     * handler places it in an HTTP-only cookie.  This deliberately shares the
     * exact checks used for cookie authentication and never decodes a JWT.
     */
    async verifyAccessToken(token: string, caller: AbortSignal): Promise<string|null> {
      if (typeof token !== 'string' || token.length<20 || token.length>8192 || !/^[a-zA-Z0-9._-]+$/.test(token)) return null;
      try {
        const signal=AbortSignal.any([caller,AbortSignal.timeout(5000)]);
        const response=await fetcher(url.origin+'/auth/v1/user',{headers:{apikey:options.publicKey,Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal});
        if(response.headers.get('Content-Type')?.split(';')[0]!=='application/json'){await response.body?.cancel();return null;}
        const user=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,32768,signal)));
        return typeof user.id==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(user.id) && !user.is_anonymous && Boolean(user.email_confirmed_at) ? user.id : null;
      } catch {return null;}
    },
    async readPrivateObject(path: string, maxBytes: number): Promise<Uint8Array> {
      if(!/^[a-f0-9-]{36}\/versions\/[a-f0-9-]{36}\.pdf$/.test(path) || !Number.isInteger(maxBytes) || maxBytes<5 || maxBytes>MAX_PDF_BYTES)throw Error('UNAVAILABLE');
      const signal=AbortSignal.timeout(10000);
      const response=await fetcher(`${url.origin}/storage/v1/object/authenticated/${options.bucket}/${path}`,{headers:{apikey:options.serviceKey,Authorization:`Bearer ${options.serviceKey}`},redirect:'error',cache:'no-store',signal});
      if(response.headers.get('Content-Type')?.split(';')[0]!=='application/pdf'){await response.body?.cancel();throw Error('UNAVAILABLE');}
      return bounded(response,maxBytes,signal);
    },
  };
}
