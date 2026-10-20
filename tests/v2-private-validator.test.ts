import {describe,it,expect,vi} from 'vitest';
import {OfflineValidatorClient} from '../server/v2/private-validator';
import {issueIntent} from '../server/v2/intents';
import {createHash} from 'node:crypto';
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
 it('prepares and checks canonical PDF metadata through the private service',async()=>{
  const hash=createHash('sha256').update(bytes).digest('hex');
  const fetcher=vi.fn(async(url:URL|string,options?:RequestInit)=>{expect(String(url)).toBe('https://validator.invalid/prepare');return Response.json({pdf:Buffer.from(bytes).toString('base64'),sha256:hash,byteSize:bytes.length,pageCount:1,lastPageWidth:595,lastPageHeight:842,signatureCount:0});});
  const client=new OfflineValidatorClient({flags:{DIRECT_P12_SIGNING_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:async()=>{},fetch:fetcher as unknown as typeof fetch});
  await expect(client.prepare(bytes)).resolves.toEqual({pdf:bytes,sha256:hash,byteSize:bytes.length,pageCount:1,lastPageWidth:595,lastPageHeight:842,signatureCount:0});
  const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(Object.keys(body)).toEqual(['pdf']);
 });
 it('rejects forged preparation metadata and additional response fields',async()=>{
  const client=new OfflineValidatorClient({flags:{DIRECT_P12_SIGNING_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},url:'https://validator.invalid/validate',serviceToken:'x'.repeat(32),beforeValidation:async()=>{},fetch:async()=>Response.json({pdf:Buffer.from(bytes).toString('base64'),sha256:'0'.repeat(64),byteSize:bytes.length,pageCount:1,lastPageWidth:595,lastPageHeight:842,signatureCount:0,password:'leak'})});
  await expect(client.prepare(bytes)).rejects.toThrow('INVALID_PREPARATION_REPORT');
 });
});
