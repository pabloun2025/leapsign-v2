import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import type {SignatureValidationResult} from '../src/v2/contracts';
import {postgresSubmission} from '../server/v2/postgres-submission';
import {acceptedReport} from './helpers/validation-report';

const intentId='11111111-1111-4111-8111-111111111111';
const actor='22222222-2222-4222-8222-222222222222';
const documentId='33333333-3333-4333-8333-333333333333';
const versionId='44444444-4444-4444-8444-444444444444';
const stageId='55555555-5555-4555-8555-555555555555';
const nonce='A'.repeat(43);
const baseHash='a'.repeat(64);
const pdf=new TextEncoder().encode('%PDF-signed-synthetic');
const candidateHash=createHash('sha256').update(pdf).digest('hex');
const report:SignatureValidationResult=acceptedReport({baseSha256:baseHash,signedSha256:candidateHash});
const claimed={intent:{id:intentId,documentId,versionId,baseSha256:baseHash,stageId,signerId:actor,role:'signer',profile:'firmaec-qr-compatible',position:{page:1,x:300,y:20,width:250,height:80},issuedAt:'2026-10-20T10:00:00.000Z',expiresAt:'2026-10-20T10:05:00.000Z',state:'signed_pending_validation',correlationId:'66666666-6666-4666-8666-666666666666'},current:{documentId,versionId,baseSha256:baseHash,stageId,signerId:actor,role:'signer',pageCount:1,pageWidth:595,pageHeight:842}};

function fixture(){
 const rpc=vi.fn(async(name:string):Promise<unknown>=>name==='v2_claim_intent'?claimed:null);
 const writePrivateObject=vi.fn(async()=>{});
 return{rpc,writePrivateObject,repository:postgresSubmission({rpc,writePrivateObject,uuid:()=> '77777777-7777-4777-8777-777777777777'})};
}

describe('v2 PostgreSQL submission adapter',()=>{
 it('claims with a nonce digest and never transports the nonce in clear text',async()=>{const f=fixture();const result=await f.repository.claim(intentId,actor,nonce,candidateHash);expect(result.intent.nonce).toBe(nonce);expect(result.current.documentId).toBe(documentId);expect(f.rpc).toHaveBeenCalledWith('v2_claim_intent',{p_intent_id:intentId,p_actor_id:actor,p_nonce_hash:createHash('sha256').update(nonce).digest('hex'),p_candidate_sha256:candidateHash});expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(nonce);});
 it('returns only an exact validated replay for the same candidate',async()=>{const f=fixture();f.rpc.mockResolvedValueOnce({...claimed,intent:{...claimed.intent,state:'validated'},replay:report});expect((await f.repository.claim(intentId,actor,nonce,candidateHash)).replay).toEqual(report);});
 it('fails closed on malformed or cross-document claim data',async()=>{const f=fixture();f.rpc.mockResolvedValueOnce({...claimed,current:{...claimed.current,documentId:'other'}});await expect(f.repository.claim(intentId,actor,nonce,candidateHash)).rejects.toThrow('UNAVAILABLE');});
 it('writes an immutable candidate before committing the exact SQL version',async()=>{const f=fixture();await f.repository.claim(intentId,actor,nonce,candidateHash);f.rpc.mockResolvedValueOnce({acceptedVersionId:'77777777-7777-4777-8777-777777777777'});await f.repository.commitValidated(intentId,candidateHash,report,pdf);expect(f.writePrivateObject).toHaveBeenCalledWith(`${documentId}/versions/77777777-7777-4777-8777-777777777777.pdf`,pdf);expect(f.rpc.mock.calls[1]).toEqual(['v2_commit_validated',{p_intent_id:intentId,p_actor_id:actor,p_nonce_hash:createHash('sha256').update(nonce).digest('hex'),p_candidate_sha256:candidateHash,p_version_id:'77777777-7777-4777-8777-777777777777',p_byte_size:pdf.length,p_report:report}]);});
 it('recovers a successful commit after the commit response is lost',async()=>{const f=fixture();await f.repository.claim(intentId,actor,nonce,candidateHash);f.rpc.mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce({state:'validated',acceptedVersionId:'77777777-7777-4777-8777-777777777777',report});await expect(f.repository.commitValidated(intentId,candidateHash,report,pdf)).resolves.toBeUndefined();expect(f.rpc.mock.calls[2][0]).toBe('v2_get_intent_receipt');});
 it('does not claim success when an uncertain commit has no matching receipt',async()=>{const f=fixture();await f.repository.claim(intentId,actor,nonce,candidateHash);f.rpc.mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce({state:'signed_pending_validation'});await expect(f.repository.commitValidated(intentId,candidateHash,report,pdf)).rejects.toThrow('UNAVAILABLE');});
 it('rejects the same claimed candidate without advancing a stage',async()=>{const f=fixture();await f.repository.claim(intentId,actor,nonce,candidateHash);f.rpc.mockResolvedValueOnce(null);await f.repository.reject(intentId,candidateHash,'VALIDATION_FAILED');expect(f.rpc.mock.calls[1]).toEqual(['v2_reject_intent',{p_intent_id:intentId,p_actor_id:actor,p_nonce_hash:createHash('sha256').update(nonce).digest('hex'),p_candidate_sha256:candidateHash}]);});
});
