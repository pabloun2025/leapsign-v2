import {describe,it,expect,vi} from 'vitest';
import {supabasePrivate} from '../server/v2/supabase-private';
const actor='12345678-1234-4234-8234-123456789abc';
const version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path=`${actor}/versions/${version}.pdf`;
const pdf=new TextEncoder().encode('%PDF-fixture');
const config={projectUrl:'https://lbreydchhskrrmpzniem.supabase.co',publicKey:'public-synthetic',serviceKey:'service-synthetic',bucket:'v2-pdfs'};
const request=()=>new Request('https://leapsign.app',{headers:{Cookie:'__Host-leapsign-v2=synthetic.token.value.only'}});
const exactId=(value:unknown)=>{
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==1 || !('id' in value) || typeof value.id!=='string')throw Error('INVALID_RPC_RESPONSE');
 return value.id;
};
describe('v2 private auth/storage adapters, mocked network only',()=>{
 it('explicitly rejects the v1 project',()=>expect(()=>supabasePrivate({...config,projectUrl:'https://lgsdoutarthfymbjgdrj.supabase.co'})).toThrow('V2_CONFIGURATION_REQUIRED'));
 it.each(['http://lbreydchhskrrmpzniem.supabase.co','https://evil.example','https://abcdefghijklmnopqrst.supabase.co','https://lbreydchhskrrmpzniem.supabase.co/path'])('rejects non-dedicated endpoints',projectUrl=>expect(()=>supabasePrivate({...config,projectUrl})).toThrow());
 it('verifies a cookie with the authentication server, never by decoding JWT locally',async()=>{const fetcher=vi.fn(async()=>Response.json({id:actor,email_confirmed_at:'2026-10-20',is_anonymous:false}));expect(await supabasePrivate({...config,fetch:fetcher}).authenticate(request())).toBe(actor);const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe(config.projectUrl+'/auth/v1/user');expect(JSON.stringify(init)).not.toContain(config.serviceKey);});
 it('does not call the server for absent or duplicate cookies',async()=>{const fetcher=vi.fn();const adapter=supabasePrivate({...config,fetch:fetcher});expect(await adapter.authenticate(new Request('https://leapsign.app'))).toBeNull();expect(await adapter.authenticate(new Request('https://leapsign.app',{headers:{Cookie:'__Host-leapsign-v2=one; __Host-leapsign-v2=two'}}))).toBeNull();expect(fetcher).not.toHaveBeenCalled();});
 it.each([{id:actor,is_anonymous:true,email_confirmed_at:'date'},{id:actor},{id:'malformed',email_confirmed_at:'date'}])('rejects unverified/anonymous responses',async user=>expect(await supabasePrivate({...config,fetch:async()=>Response.json(user)}).authenticate(request())).toBeNull());
 it('does not disclose authentication server errors',async()=>expect(await supabasePrivate({...config,fetch:async()=>{throw Error('secret');}}).authenticate(request())).toBeNull());
 it('calls a named RPC only with the server service role and a mandatory strict decoder',async()=>{
  const fetcher=vi.fn(async()=>Response.json({id:actor}));
  const id=await supabasePrivate({...config,fetch:fetcher}).rpc('claim_signing_intent',{p_id:actor},exactId);
  expect(id).toBe(actor);
  const [target,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(target).toBe(config.projectUrl+'/rest/v1/rpc/claim_signing_intent');
  expect(init.method).toBe('POST');
  expect(init.redirect).toBe('manual');
  expect(init.cache).toBe('no-store');
  expect(JSON.parse(String(init.body))).toEqual({p_id:actor});
  expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${config.serviceKey}`);
  expect(new Headers(init.headers).get('apikey')).toBe(config.serviceKey);
 });
 it('fails closed on an RPC response with extra fields or provider diagnostics',async()=>{
  const adapter=supabasePrivate({...config,fetch:async()=>Response.json({id:actor,internal:'do not expose'})});
  await expect(adapter.rpc('claim_signing_intent',{p_id:actor},exactId)).rejects.toThrow('UNAVAILABLE');
 });
 it('rejects malformed RPC names and non-JSON responses without making data available',async()=>{
  const fetcher=vi.fn(async()=>new Response('<html>proxy</html>',{headers:{'Content-Type':'text/html'}}));
  const adapter=supabasePrivate({...config,fetch:fetcher});
  await expect(adapter.rpc('../admin',{p_id:actor},exactId)).rejects.toThrow('UNAVAILABLE');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(adapter.rpc('claim_signing_intent',{p_id:actor},exactId)).rejects.toThrow('UNAVAILABLE');
 });
 it('writes a private PDF without overwrite semantics through the repository-compatible wrapper',async()=>{
  const fetcher=vi.fn(async()=>Response.json({Key:`${config.bucket}/${path}`}));
  await expect(supabasePrivate({...config,fetch:fetcher}).writePrivateObject(path,pdf)).resolves.toBeUndefined();
  const [target,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(target).toBe(`${config.projectUrl}/storage/v1/object/${config.bucket}/${path}`);
  expect(init.method).toBe('POST');
  const headers=new Headers(init.headers);
  expect(headers.get('If-None-Match')).toBe('*');
  expect(headers.get('x-upsert')).toBe('false');
  expect(headers.get('Content-Type')).toBe('application/pdf');
  expect(headers.get('Authorization')).toBe(`Bearer ${config.serviceKey}`);
  expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(pdf);
 });
 it('returns an opaque, exact cleanup capability only after a confirmed immutable upload',async()=>{
  const fetcher=vi.fn()
   .mockResolvedValueOnce(Response.json({Key:`${config.bucket}/${path}`}))
   .mockResolvedValueOnce(Response.json([{name:path,bucket_id:config.bucket}]));
  const staged=await supabasePrivate({...config,fetch:fetcher}).stagePrivateObject(path,pdf);
  expect(Object.keys(staged)).toEqual(['cleanupAfterDefiniteRejection']);
  await staged.cleanupAfterDefiniteRejection();
  const [target,init]=fetcher.mock.calls[1] as unknown as [string,RequestInit];
  expect(target).toBe(`${config.projectUrl}/storage/v1/object/${config.bucket}`);
  expect(init.method).toBe('DELETE');
  expect(JSON.parse(String(init.body))).toEqual({prefixes:[path]});
 });
 it('never exposes a generic delete and makes a confirmed cleanup capability one-shot',async()=>{
  const fetcher=vi.fn()
   .mockResolvedValueOnce(Response.json({Key:`${config.bucket}/${path}`}))
   .mockResolvedValueOnce(Response.json([{name:path,bucket_id:config.bucket}]));
  const adapter=supabasePrivate({...config,fetch:fetcher});
  expect(adapter).not.toHaveProperty('deletePrivateObject');
  const staged=await adapter.stagePrivateObject(path,pdf);
  await staged.cleanupAfterDefiniteRejection();
  await expect(staged.cleanupAfterDefiniteRejection()).rejects.toThrow('UNAVAILABLE');
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not return a cleanup capability when upload acknowledgement is malformed',async()=>{
  const fetcher=vi.fn(async()=>Response.json({Key:`${config.bucket}/${path}`,unexpected:true}));
  await expect(supabasePrivate({...config,fetch:fetcher}).stagePrivateObject(path,pdf)).rejects.toThrow('UNAVAILABLE');
 });
 it('rejects invalid upload bytes and paths before making a request',async()=>{
  const fetcher=vi.fn();const adapter=supabasePrivate({...config,fetch:fetcher});
  await expect(adapter.writePrivateObject('../candidate.pdf',pdf)).rejects.toThrow('UNAVAILABLE');
  await expect(adapter.writePrivateObject(path,new TextEncoder().encode('not-a-pdf'))).rejects.toThrow('UNAVAILABLE');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('streams only the permitted immutable private object',async()=>{const fetcher=vi.fn(async()=>new Response(pdf,{headers:{'Content-Type':'application/pdf'}}));const bytes=await supabasePrivate({...config,fetch:fetcher}).readPrivateObject(path,pdf.length);expect(bytes).toEqual(pdf);});
 it('rejects oversized bodies even without content length',async()=>{const adapter=supabasePrivate({...config,fetch:async()=>new Response('%PDF-too-many-bytes',{headers:{'Content-Type':'application/pdf'}})});await expect(adapter.readPrivateObject(path,5)).rejects.toThrow();});
 it('rejects traversal without making a request',async()=>{const fetcher=vi.fn();await expect(supabasePrivate({...config,fetch:fetcher}).readPrivateObject('../secrets',100)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it('combines caller cancellation with bounded RPC and storage timeouts',async()=>{
  const timeout=new AbortController();const caller=new AbortController();
  const timeoutSpy=vi.spyOn(AbortSignal,'timeout').mockReturnValue(timeout.signal);
  const fetcher=vi.fn(async(_target:string,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('provider detail')),{once:true})));
  const pending=supabasePrivate({...config,fetch:fetcher as unknown as typeof fetch}).readPrivateObject(path,pdf.length,caller.signal);
  expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  caller.abort();
  await expect(pending).rejects.toThrow('UNAVAILABLE');
  timeoutSpy.mockRestore();
 });
});
