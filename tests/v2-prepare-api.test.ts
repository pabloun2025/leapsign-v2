import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createPreparationHandler, type PreparationDependencies} from '../server/v2/prepare-api';
import {issueIntent} from '../server/v2/intents';
const pdf = new TextEncoder().encode('%PDF-synthetic, not a cryptographic fixture');
const stage = {documentId:'doc',versionId:'version',stageId:'stage',signerId:'ana',role:'signer',pageCount:1,pageWidth:595,pageHeight:842,baseSha256:createHash('sha256').update(pdf).digest('hex'),filename:'Contrato.pdf',previousSignatureCount:0};
const input = {documentId:'doc',profile:'firmaec-qr-compatible',position:{page:1,x:320,y:20,width:250,height:80}};
function fixture() {
 const intent=issueIntent(stage,'ana','firmaec-qr-compatible',input.position);
 const deps: PreparationDependencies={flags:{EXTERNAL_SIGNATURE_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},authenticate:vi.fn(async()=> 'ana'),reserve:vi.fn(async()=>{}),loadStage:vi.fn(async()=>({...stage})),loadCanonical:vi.fn(async()=>pdf),persistIntent:vi.fn(async()=>{}),loadIntent:vi.fn(async()=>intent)};
 const request=(body: unknown=input,origin='https://leapsign.app')=>new Request('https://leapsign.app/api/v2/signing/prepare',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-LeapSign-Client':'v2'},body:JSON.stringify(body)});
 return {deps,intent,request,handle:createPreparationHandler(deps)};
}
describe('v2 preparation routes, isolated server ports',()=>{
 it('supports explicitly configured staging without accepting production requests',async()=>{
  const f=fixture();f.deps.origin='https://pruebas.leapsign.app';const handler=createPreparationHandler(f.deps);
  expect((await handler(f.request())).status).toBe(503);
  const request=new Request('https://pruebas.leapsign.app/api/v2/signing/prepare',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://pruebas.leapsign.app','X-LeapSign-Client':'v2'},body:JSON.stringify(input)});
  expect((await handler(request)).status).toBe(200);
 });
 it('rejects production-origin POST against staging',async()=>{
  const f=fixture();f.deps.origin='https://pruebas.leapsign.app';
  expect((await createPreparationHandler(f.deps)(new Request('https://pruebas.leapsign.app/api/v2/signing/prepare',{method:'POST',headers:{Origin:'https://leapsign.app','X-LeapSign-Client':'v2'}}))).status).toBe(403);
 });
 it('rejects arbitrary configured origins before handling requests',()=>{const f=fixture();f.deps.origin='https://firma.veryfacil.org';expect(()=>createPreparationHandler(f.deps)).toThrow();});
 it('reserves budget and persists a bound intent before returning its exact PDF path',async()=>{const f=fixture();const r=await f.handle(f.request());expect(r.status).toBe(200);const body=await r.json();expect(body.filename).toBe('Contrato.pdf');expect(body.pdfPath).toBe(`/api/v2/signing/intents/${body.intent.id}/pdf`);expect(f.deps.reserve).toHaveBeenCalledWith('ana','prepare');expect(f.deps.persistIntent).toHaveBeenCalledOnce();expect(r.headers.get('Cache-Control')).toBe('no-store');});
 it('fails closed with disabled flags',async()=>{const f=fixture();f.deps.flags={};expect((await f.handle(f.request())).status).toBe(503);expect(f.deps.authenticate).not.toHaveBeenCalled();});
 it('blocks cross-origin requests before authentication',async()=>{const f=fixture();expect((await f.handle(f.request(input,'https://evil.example'))).status).toBe(403);expect(f.deps.authenticate).not.toHaveBeenCalled();});
 it('requires an authenticated actor',async()=>{const f=fixture();f.deps.authenticate=async()=>null;expect((await f.handle(f.request())).status).toBe(401);expect(f.deps.loadStage).not.toHaveBeenCalled();});
 it('does not load a PDF if budget reservation fails',async()=>{const f=fixture();f.deps.reserve=async()=>{throw Error('private budget detail');};const r=await f.handle(f.request());expect(await r.text()).not.toContain('private');expect(f.deps.loadStage).not.toHaveBeenCalled();});
 it.each([{...input,password:'secret'},{...input,position:{...input.position,extra:1}},{...input,documentId:'../other'}])('rejects extra or malformed input',async body=>{const f=fixture();expect((await f.handle(f.request(body))).status).toBe(409);expect(f.deps.persistIntent).not.toHaveBeenCalled();});
 it('rejects oversized JSON',async()=>{const f=fixture();expect((await f.handle(f.request({...input,padding:'x'.repeat(3000)}))).status).toBe(409);});
 it('does not issue an intent for another signer',async()=>{const f=fixture();f.deps.authenticate=async()=> 'bea';expect((await f.handle(f.request())).status).toBe(409);expect(f.deps.persistIntent).not.toHaveBeenCalled();});
 it('checks the immutable bytes before persisting',async()=>{const f=fixture();f.deps.loadCanonical=async()=>new TextEncoder().encode('%PDF-other');expect((await f.handle(f.request())).status).toBe(409);expect(f.deps.persistIntent).not.toHaveBeenCalled();});
 it('does not report success when atomic persistence rejects a stale stage',async()=>{const f=fixture();f.deps.persistIntent=async()=>{throw Error('changed');};expect((await f.handle(f.request())).status).toBe(409);});
 it('downloads only the authenticated current intent version',async()=>{const f=fixture();const r=await f.handle(new Request(`https://leapsign.app/api/v2/signing/intents/${f.intent.id}/pdf`,{headers:{'X-LeapSign-Client':'v2'}}));expect(r.status).toBe(200);expect(new Uint8Array(await r.arrayBuffer())).toEqual(pdf);expect(f.deps.reserve).toHaveBeenCalledWith('ana','download');});
 it('blocks expired download intents',async()=>{const f=fixture();f.deps.now=()=>new Date(f.intent.expiresAt);expect((await f.handle(new Request(`https://leapsign.app/api/v2/signing/intents/${f.intent.id}/pdf`,{headers:{'X-LeapSign-Client':'v2'}}))).status).toBe(409);expect(f.deps.loadCanonical).not.toHaveBeenCalled();});
});
