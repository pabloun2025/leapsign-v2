import {describe,it,expect,vi} from 'vitest';
import {OfflineValidatorClient} from '../server/v2/private-validator';
import {issueIntent} from '../server/v2/intents';
const intent=issueIntent({documentId:'d',versionId:'v',baseSha256:'a'.repeat(64),stageId:'s',signerId:'a',role:'approval',pageCount:1,pageWidth:595,pageHeight:842},'a','firmaec-qr-compatible',{page:1,x:320,y:20,width:250,height:80});
const bytes=new TextEncoder().encode('%PDF-synthetic test only');
describe('v2 private validator boundary',()=>{
 it('does not contact the validator when disabled',async()=>{
  const fetcher=vi.fn();const quota=vi.fn();
  const client=new OfflineValidatorClient({flags:{},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:quota,fetch:fetcher});
  await expect(client.validate(bytes,bytes,intent)).rejects.toThrow('V2_DISABLED');expect(fetcher).not.toHaveBeenCalled();expect(quota).not.toHaveBeenCalled();
 });
 it('allows independent validation with direct enabled and external disabled',async()=>{
  const fetcher=vi.fn(async()=>Response.json({valid:false}));const quota=vi.fn(async()=>{});
  const client=new OfflineValidatorClient({flags:{DIRECT_P12_SIGNING_ENABLED:'true',EXTERNAL_SIGNATURE_ENABLED:'false',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:quota,fetch:fetcher});
  await expect(client.validate(bytes,bytes,intent)).rejects.toThrow('INVALID_VALIDATION_REPORT');
  expect(quota).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
 });
 it('fails closed before the HTTP call if the budget cannot be reserved',async()=>{
  const fetcher=vi.fn();const client=new OfflineValidatorClient({flags:{EXTERNAL_SIGNATURE_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:async()=>{throw Error('budget unavailable');},fetch:fetcher});
  await expect(client.validate(bytes,bytes,intent)).rejects.toThrow('budget unavailable');expect(fetcher).not.toHaveBeenCalled();
 });
 it('sends only PDFs and authorized public policy, never credentials from a certificate',async()=>{
  const fetcher=vi.fn(async(_url,options)=>{
   const body=JSON.parse(String(options?.body));expect(Object.keys(body).sort()).toEqual(['baseSha256','candidate','position','previous']);expect(options?.redirect).toBe('error');
   return Response.json({valid:false,error:'not a real signature'});
  }) as unknown as typeof fetch;
  const client=new OfflineValidatorClient({flags:{EXTERNAL_SIGNATURE_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:async()=>{},fetch:fetcher});
  await expect(client.validate(bytes,bytes,intent)).rejects.toThrow('INVALID_VALIDATION_REPORT');
 });
 it('rejects redirected or oversized validation output',async()=>{
  const client=new OfflineValidatorClient({flags:{EXTERNAL_SIGNATURE_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:async()=>{},fetch:async()=>new Response('x'.repeat(65537))});
  await expect(client.validate(bytes,bytes,intent)).rejects.toThrow('INVALID_VALIDATION_REPORT');
 });
});
