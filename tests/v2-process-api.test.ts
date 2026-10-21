import {describe, expect, it, vi} from 'vitest';
import {createProcessHandler, type ProcessDependencies} from '../server/v2/process-api';

const origin='https://pruebas.leapsign.app';
const actor='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';
const clientIpHash='a'.repeat(64);
const pdf=new TextEncoder().encode('%PDF-functional-test');
const signerHeader=Buffer.from(JSON.stringify(['ana@example.test','bea@example.test'])).toString('base64url');
function fixture(){
  const deps:ProcessDependencies={origin,authenticate:vi.fn(async()=>actor),clientRateKey:vi.fn(async()=>clientIpHash),reserve:vi.fn(async()=>{}),
    create:vi.fn(async()=>({id:documentId,filename:'Contrato.pdf',status:'ready_for_signer' as const,signerCount:2})),
    status:vi.fn(async()=>({id:documentId,filename:'Contrato.pdf',status:'ready_for_signer' as const,signatureCount:0,stages:[{ordinal:1,status:'ready_for_signer' as const,current:true},{ordinal:2,status:'ready_for_signer' as const,current:false}]})),
    finalize:vi.fn(async()=>({id:documentId,filename:'Contrato.pdf',status:'completed' as const,signatureCount:2,stages:[{ordinal:1,status:'validated' as const,current:false},{ordinal:2,status:'validated' as const,current:false}]})),
    download:vi.fn(async()=>({filename:'Contrato.pdf',pdf})),};
  return {deps,handle:createProcessHandler(deps)};
}
const createRequest=()=>new Request(origin+'/api/v2/processes',{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','X-LeapSign-Client':'v2','Content-Type':'application/pdf','X-LeapSign-Filename':encodeURIComponent('Contrato.pdf'),'X-LeapSign-Signers':signerHeader},body:pdf});

describe('v2 process API',()=>{
  it('creates a private sequential process with an anonymized client rate key',async()=>{const f=fixture();const response=await f.handle(createRequest());expect(response.status).toBe(201);expect(await response.json()).toEqual({id:documentId,filename:'Contrato.pdf',status:'ready_for_signer',signerCount:2});expect(f.deps.create).toHaveBeenCalledWith({ownerId:actor,clientIpHash,filename:'Contrato.pdf',pdf,signers:['ana@example.test','bea@example.test']});expect(f.deps.reserve).toHaveBeenCalledWith(actor,'create');});
  it('rejects cross-origin creation before reading or persisting',async()=>{const f=fixture();const request=createRequest();request.headers.set('Origin','https://evil.invalid');const response=await f.handle(request);expect(response.status).toBe(403);expect(f.deps.create).not.toHaveBeenCalled();});
  it('returns authorized progress without private signer identifiers',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/processes/${documentId}`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);const body=await response.json();expect(body.signatureCount).toBe(0);expect(JSON.stringify(body)).not.toContain(actor);expect(f.deps.status).toHaveBeenCalledWith(documentId,actor);});
  it('downloads only through an authenticated process route',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/processes/${documentId}/pdf`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('application/pdf');expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);});
  it('finalizes only through an explicit same-origin owner action',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/processes/${documentId}/finalize`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:documentId,status:'completed',signatureCount:2});expect(f.deps.reserve).toHaveBeenCalledWith(actor,'finalize');expect(f.deps.finalize).toHaveBeenCalledWith(documentId,actor);});
  it('rejects cross-origin finalization before invoking the repository',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/processes/${documentId}/finalize`,{method:'POST',headers:{Origin:'https://evil.invalid','X-LeapSign-Client':'v2'}}));expect(response.status).toBe(403);expect(f.deps.finalize).not.toHaveBeenCalled();});
  it('does not disclose process existence when a dependency rejects access',async()=>{const f=fixture();f.deps.status=async()=>{throw Error('NOT_OWNER');};const response=await f.handle(new Request(`${origin}/api/v2/processes/${documentId}`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(404);expect(await response.json()).toEqual({code:'NOT_FOUND'});});
  it('rejects privileged adapter fields instead of serializing them',async()=>{const f=fixture();f.deps.create=async()=>({id:documentId,filename:'Contrato.pdf',status:'ready_for_signer',signerCount:2,storagePath:'private/path'} as never);expect((await f.handle(createRequest())).status).toBe(404);f.deps.status=async()=>({id:documentId,filename:'Contrato.pdf',status:'ready_for_signer',signatureCount:0,stages:[{ordinal:1,status:'ready_for_signer',current:true}],ownerId:actor} as never);expect((await f.handle(new Request(`${origin}/api/v2/processes/${documentId}`,{headers:{'X-LeapSign-Client':'v2'}}))).status).toBe(404);});
});
