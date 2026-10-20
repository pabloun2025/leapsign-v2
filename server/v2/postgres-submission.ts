import {createHash,randomUUID} from 'node:crypto';
import type {SignatureValidationResult,SigningIntent} from '../../src/v2/contracts';
import {isPublicValidationReport} from '../../src/v2/public-data';
import {INTENT_LIFETIME_MS,MAX_PDF_BYTES} from '../../src/v2/policy';
import type {CanonicalStage,IntentRepository} from './intents';

type Rpc=(name:string,parameters:Record<string,unknown>)=>Promise<unknown>;
type Options={rpc:Rpc;writePrivateObject(path:string,pdf:Uint8Array):Promise<void>;uuid?:()=>string};
type ClaimContext={documentId:string;candidateSha256:string;actorId:string;nonceHash:string};
const unavailable=()=>Error('UNAVAILABLE');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[],optional:string[]=[])=>keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length>0&&value.length<=max;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');

function parsePosition(value:unknown){
 if(!record(value)||!exact(value,['page','x','y','width','height'])||!Number.isInteger(value.page)||Number(value.page)<1||Number(value.page)>500||!['x','y','width','height'].every(key=>finite(value[key]))||Number(value.x)<0||Number(value.y)<0||Number(value.width)<100||Number(value.height)<50)throw unavailable();
 return{page:Number(value.page),x:Number(value.x),y:Number(value.y),width:Number(value.width),height:Number(value.height)};
}
function parseClaim(value:unknown,id:string,actor:string,nonce:string,candidate:string):{intent:SigningIntent;current:CanonicalStage;replay?:SignatureValidationResult}{
 if(!record(value)||!exact(value,['intent','current'],['replay'])||!record(value.intent)||!record(value.current))throw unavailable();
 const intent=value.intent,current=value.current;
 if(!exact(intent,['id','documentId','versionId','baseSha256','stageId','signerId','role','profile','position','issuedAt','expiresAt','state','correlationId'],['expectedFingerprint'])||
   ![intent.id,intent.documentId,intent.versionId,intent.stageId,intent.signerId,intent.correlationId].every(uuid)||!hash(intent.baseSha256)||!text(intent.role,80)||intent.profile!=='firmaec-qr-compatible'||!['signed_pending_validation','validated'].includes(String(intent.state))||
   typeof intent.issuedAt!=='string'||typeof intent.expiresAt!=='string'||!Number.isFinite(Date.parse(intent.issuedAt))||!Number.isFinite(Date.parse(intent.expiresAt))||Date.parse(intent.expiresAt)<=Date.parse(intent.issuedAt)||Date.parse(intent.expiresAt)-Date.parse(intent.issuedAt)>INTENT_LIFETIME_MS||
   (intent.expectedFingerprint!==undefined&&!hash(intent.expectedFingerprint)))throw unavailable();
 const position=parsePosition(intent.position);
 if(!exact(current,['documentId','versionId','baseSha256','stageId','signerId','role','pageCount','pageWidth','pageHeight'],['expectedFingerprint'])||
   ![current.documentId,current.versionId,current.stageId,current.signerId].every(uuid)||!hash(current.baseSha256)||!text(current.role,80)||!Number.isInteger(current.pageCount)||Number(current.pageCount)<1||Number(current.pageCount)>500||!finite(current.pageWidth)||!finite(current.pageHeight)||Number(current.pageWidth)<=0||Number(current.pageHeight)<=0||
   (current.expectedFingerprint!==undefined&&!hash(current.expectedFingerprint)))throw unavailable();
 if(intent.id!==id||intent.signerId!==actor||intent.documentId!==current.documentId||intent.versionId!==current.versionId||intent.baseSha256!==current.baseSha256||intent.stageId!==current.stageId||intent.role!==current.role||intent.expectedFingerprint!==current.expectedFingerprint||position.page!==current.pageCount||position.x+position.width>Number(current.pageWidth)||position.y+position.height>Number(current.pageHeight))throw unavailable();
 const parsedIntent={...intent,position,nonce} as SigningIntent;
 const parsedCurrent={...current,pageCount:Number(current.pageCount),pageWidth:Number(current.pageWidth),pageHeight:Number(current.pageHeight)} as CanonicalStage;
 if(intent.state==='validated'){
  if(!isPublicValidationReport(value.replay)||value.replay.signedSha256!==candidate||value.replay.baseSha256!==intent.baseSha256)return (()=>{throw unavailable();})();
  return{intent:parsedIntent,current:parsedCurrent,replay:value.replay};
 }
 if(value.replay!==undefined)throw unavailable();
 return{intent:parsedIntent,current:parsedCurrent};
}
function matchingReceipt(value:unknown,versionId:string,candidate:string,report:SignatureValidationResult){
 if(!record(value)||!exact(value,['state'],['acceptedVersionId','report'])||value.state!=='validated'||value.acceptedVersionId!==versionId||!isPublicValidationReport(value.report))return false;
 const other=value.report;
 return other.valid&&other.baseSha256===report.baseSha256&&other.signedSha256===candidate&&other.previousSignatureCount===report.previousSignatureCount&&other.signatureCount===report.signatureCount&&other.revocation===report.revocation&&other.certificate?.fingerprint===report.certificate?.fingerprint;
}

/** Request-scoped repository over private service-role RPCs. Construct a fresh
 * instance per HTTP submission; claim context is deliberately never persisted.
 * An ambiguous commit leaves an unreferenced object for later purge instead of
 * risking deletion of a version that PostgreSQL may already reference. */
export function postgresSubmission(options:Options):IntentRepository{
 const contexts=new Map<string,ClaimContext>();
 const nextUuid=options.uuid??randomUUID;
 return{
  async claim(id,actorId,nonce,candidateSha256){
   if(!uuid(id)||!uuid(actorId)||!/^[A-Za-z0-9_-]{43}$/.test(nonce)||!hash(candidateSha256))throw unavailable();
   const nonceHash=digest(nonce);
   const value=await options.rpc('v2_claim_intent',{p_intent_id:id,p_actor_id:actorId,p_nonce_hash:nonceHash,p_candidate_sha256:candidateSha256}).catch(()=>{throw unavailable();});
   const parsed=parseClaim(value,id,actorId,nonce,candidateSha256);
   if(!parsed.replay)contexts.set(id,{documentId:parsed.intent.documentId,candidateSha256,actorId,nonceHash});
   return parsed;
  },
  async commitValidated(id,candidateSha256,report,pdf){
   const context=contexts.get(id);const versionId=nextUuid();
   if(!context||context.candidateSha256!==candidateSha256||!uuid(versionId)||!isPublicValidationReport(report)||!report.valid||report.signedSha256!==candidateSha256||!(pdf instanceof Uint8Array)||pdf.length<5||pdf.length>MAX_PDF_BYTES||digest(pdf)!==candidateSha256)throw unavailable();
   const path=`${context.documentId}/versions/${versionId}.pdf`;
   await options.writePrivateObject(path,pdf).catch(()=>{throw unavailable();});
   try{
    const result=await options.rpc('v2_commit_validated',{p_intent_id:id,p_actor_id:context.actorId,p_nonce_hash:context.nonceHash,p_candidate_sha256:candidateSha256,p_version_id:versionId,p_byte_size:pdf.length,p_report:report});
    if(!record(result)||!exact(result,['acceptedVersionId'])||result.acceptedVersionId!==versionId)throw unavailable();
    contexts.delete(id);
   }catch{
    const receipt=await options.rpc('v2_get_intent_receipt',{p_intent_id:id,p_actor_id:context.actorId}).catch(()=>null);
    if(!matchingReceipt(receipt,versionId,candidateSha256,report))throw unavailable();
    contexts.delete(id);
   }
  },
  async reject(id,candidateSha256,code){
   const context=contexts.get(id);
   if(!uuid(id)||!hash(candidateSha256)||code!=='VALIDATION_FAILED'||(context&&context.candidateSha256!==candidateSha256))throw unavailable();
   if(!context)throw unavailable();
   await options.rpc('v2_reject_intent',{p_intent_id:id,p_actor_id:context.actorId,p_nonce_hash:context.nonceHash,p_candidate_sha256:candidateSha256}).catch(()=>{throw unavailable();});
   contexts.delete(id);
  },
 };
}
