import {describe, it, expect, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {issueIntent, authorizeIntent, validateCandidateBinding, submitExternal, type CanonicalStage, type IntentRepository} from '../server/v2/intents';
import {signingFlags, validateCertificateFile, assertV2Origin} from '../src/v2/policy';
import type {SignatureValidationResult} from '../src/v2/contracts';
const base = new TextEncoder().encode('%PDF-synthetic-base');
const signed = new TextEncoder().encode('%PDF-synthetic-base\n% synthetic unit test, not a real signature');
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const stage: CanonicalStage = {documentId:'doc',versionId:'v0',baseSha256:sha(base),stageId:'stage-1',signerId:'ana',role:'approval',pageCount:2,pageWidth:595,pageHeight:842};
const position = {page:2,x:320,y:20,width:250,height:80};
const intent = () => issueIntent(stage,'ana','firmaec-qr-compatible',position);
describe('v2 policy and server intent contracts (not a crypto substitute)',()=>{
 it('all new capabilities are disabled unless explicitly enabled',()=>expect(signingFlags()).toEqual({direct:false,external:false,firmaecProfile:false}));
 it('does not treat truthy text as enabled',()=>expect(signingFlags({DIRECT_P12_SIGNING_ENABLED:'1'}).direct).toBe(false));
 it('rejects the production v1 origin',()=>expect(()=>assertV2Origin('https://firma.veryfacil.org')).toThrow());
 it.each([{name:'cert.pdf',size:100},{name:'cert.p12',size:0},{name:'cert.pfx',size:1048577}])('rejects invalid certificate selection',file=>expect(()=>validateCertificateFile(file)).toThrow());
 it('accepts p12/pfx filenames locally',()=>{validateCertificateFile({name:'cert.PFX',size:100});validateCertificateFile({name:'cert.p12',size:100});});
 it('binds the exact stage, role, version, hash and authorized position',()=>{const i=intent();expect(i.nonce).toHaveLength(43);expect(Date.parse(i.expiresAt)-Date.parse(i.issuedAt)).toBe(300000);expect(i.baseSha256).toBe(stage.baseSha256);expect(i.position).toEqual(position);});
 it('prevents another user issuing an intent',()=>expect(()=>issueIntent(stage,'bea','firmaec-qr-compatible',position)).toThrow('NOT_YOUR_TURN'));
 it.each([{...position,page:1},{...position,x:-1},{...position,width:400},{...position,x:NaN}])('rejects unauthorized positions',p=>expect(()=>issueIntent(stage,'ana','firmaec-qr-compatible',p)).toThrow('INVALID_POSITION'));
 it('rejects expiration',()=>{const i=intent();expect(()=>authorizeIntent(i,stage,'ana',i.nonce,new Date(i.expiresAt))).toThrow('INTENT_EXPIRED');});
 it('rejects reuse',()=>{const i=intent();i.state='validated';expect(()=>authorizeIntent(i,stage,'ana',i.nonce)).toThrow('INTENT_UNAVAILABLE');});
 it('rejects a changed stage/version/role or another actor',()=>{const i=intent();for(const changed of [{...stage,versionId:'v1'},{...stage,role:'other'},{...stage,stageId:'stage-2'}])expect(()=>authorizeIntent(i,changed,'ana',i.nonce)).toThrow('CANONICAL_VERSION_CHANGED');expect(()=>authorizeIntent(i,stage,'bea',i.nonce)).toThrow('NOT_YOUR_TURN');});
 it('rejects modified or unrelated canonical PDF bytes',()=>{const i=intent();expect(()=>validateCandidateBinding(i,base,new TextEncoder().encode('%PDF-else'))).toThrow();expect(()=>validateCandidateBinding(i,new TextEncoder().encode('%PDF-other'),signed)).toThrow();});
 it('prefix continuity is necessary but never enough to accept a signature',async()=>{
  const i=intent();const repo: IntentRepository={claim:vi.fn(async()=>({intent:i,current:stage})),commitValidated:vi.fn(),reject:vi.fn()};
  const validator={validate:vi.fn(async()=>({valid:false} as SignatureValidationResult))};
  await expect(submitExternal(repo,validator,i.id,'ana',i.nonce,base,signed)).rejects.toThrow('VALIDATION_FAILED');
  expect(repo.commitValidated).not.toHaveBeenCalled();expect(repo.reject).toHaveBeenCalledOnce();
 });
 it('never advances the stage on unavailable validator',async()=>{
  const i=intent();const repo: IntentRepository={claim:vi.fn(async()=>({intent:i,current:stage})),commitValidated:vi.fn(),reject:vi.fn()};
  await expect(submitExternal(repo,{validate:async()=>{throw Error('unavailable');}},i.id,'ana',i.nonce,base,signed)).rejects.toThrow('VALIDATION_FAILED');expect(repo.commitValidated).not.toHaveBeenCalled();
 });
});
