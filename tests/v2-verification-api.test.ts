import {describe,expect,it,vi} from 'vitest';
import {createVerificationHandler,type VerificationDependencies} from '../server/v2/verification-api';

const origin='https://pruebas.leapsign.app';
const actor='11111111-1111-4111-8111-111111111111';
const receiptId='22222222-2222-4222-8222-222222222222';
const processId='33333333-3333-4333-8333-333333333333';
const value={processId,receiptId,signedSha256:'a'.repeat(64),signer:'CN=Persona de prueba',validatedAt:'2026-10-21T07:00:00Z',accepted:true as const,checks:{cryptographicIntegrity:'passed' as const,cmsSignature:'passed' as const,documentMatch:'passed' as const,oneNewSignature:'passed' as const,previousSignatures:'passed' as const,chainBuilt:'passed' as const,trusted:'passed' as const,certificateValidity:'passed' as const,revocation:'good' as const},revocation:'good' as const,legalOutcome:'not_determined_by_software' as const};
function fixture(){const deps:VerificationDependencies={origin,authenticate:vi.fn(async()=>actor),reserve:vi.fn(async()=>{}),load:vi.fn(async()=>value)};return{deps,handle:createVerificationHandler(deps)};}

describe('authenticated QR verification API',()=>{
  it('returns only the bounded technical receipt',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/verifications/${receiptId}`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual(value);expect(f.deps.load).toHaveBeenCalledWith(receiptId,actor);expect(f.deps.reserve).toHaveBeenCalledWith(actor,'receipt');});
  it('does not disclose existence without authentication',async()=>{const f=fixture();f.deps.authenticate=async()=>null;const response=await f.handle(new Request(`${origin}/api/v2/verifications/${receiptId}`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(401);expect(f.deps.load).not.toHaveBeenCalled();});
  it('tries every authenticated identity when owner and guest sessions coexist',async()=>{const f=fixture();const owner='44444444-4444-4444-8444-444444444444';f.deps.authenticateCandidates=async()=>[owner,actor];f.deps.load=vi.fn(async(_receipt,candidate)=>{if(candidate===owner)throw Error('not authorized');return value;});const response=await f.handle(new Request(`${origin}/api/v2/verifications/${receiptId}`,{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual(value);expect(f.deps.load).toHaveBeenNthCalledWith(1,receiptId,owner);expect(f.deps.load).toHaveBeenNthCalledWith(2,receiptId,actor);});
});
