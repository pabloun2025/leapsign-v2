import {describe,expect,it,vi} from 'vitest';
import {createQueueHandler,type QueueDependencies} from '../server/v2/queue-api';

const origin='https://pruebas.leapsign.app';
const documentId='11111111-1111-4111-8111-111111111111';
const actorId='22222222-2222-4222-8222-222222222222';
const session='s'.repeat(43);
const cookie=`__Host-leapsign-v2-queue=${session}`;
function fixture(){
 const deps:QueueDependencies={round:vi.fn(async()=>({id:documentId,filename:'Contrato.pdf',message:'Espera',protected:false,paused:false,expectedSignatures:2,signatureCount:0})),join:vi.fn(async()=>({entryId:'33333333-3333-4333-8333-333333333333',actorId,status:'waiting' as const,position:1})),resolve:vi.fn(async()=>({actorId,status:'waiting' as const,position:1,leaseExpiresAt:null})),claim:vi.fn(async()=>({leaseId:'44444444-4444-4444-8444-444444444444',stageId:'55555555-5555-4555-8555-555555555555',actorId,expiresAt:'2026-10-22T12:00:00Z'})),release:vi.fn(async()=>{}),reserve:vi.fn(async()=>{}),randomSession:()=>session,randomActor:()=>actorId,digest:vi.fn(async()=> 'a'.repeat(64))};
 return{deps,handle:createQueueHandler(deps,origin)};
}

describe('v2 queue API',()=>{
 it('shows sanitized round access without authentication',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/rounds/${documentId}/access`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({id:documentId,filename:'Contrato.pdf',message:'Espera',protected:false,paused:false,expectedSignatures:2,signatureCount:0});});
 it('joins once and places an opaque HTTP-only queue cookie',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/rounds/${documentId}/queue`,{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({email:'ana@example.test',displayName:'Ana',accessSecretHash:null})}));expect(response.status).toBe(201);expect(response.headers.get('Set-Cookie')).toContain(`__Host-leapsign-v2-queue=${session}`);expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');expect(f.deps.join).toHaveBeenCalledWith(expect.objectContaining({documentId,actorId,email:'ana@example.test',sessionHash:'a'.repeat(64)}));});
 it('returns the caller queue state without exposing other entries',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/rounds/${documentId}/queue`,{headers:{'X-LeapSign-Client':'v2',Cookie:cookie}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({state:'waiting',peopleAhead:0,leaseExpiresAt:null});});
 it('claims the first turn and reserves queue capacity',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/rounds/${documentId}/turn`,{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2',Cookie:cookie}}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({stageId:'55555555-5555-4555-8555-555555555555'});expect(f.deps.reserve).toHaveBeenCalledWith(actorId,'queue');expect(f.deps.claim).toHaveBeenCalledWith(documentId,actorId,'a'.repeat(64));});
 it('rejects cross-origin join before allocating an actor',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/rounds/${documentId}/queue`,{method:'POST',headers:{Origin:'https://evil.invalid','X-LeapSign-Client':'v2','Content-Type':'application/json'},body:'{}'}));expect(response.status).toBe(403);expect(f.deps.join).not.toHaveBeenCalled();});
});
