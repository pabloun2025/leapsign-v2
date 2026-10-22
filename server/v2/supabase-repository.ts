import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {SigningIntent,SignatureValidationResult} from '../../src/v2/contracts';
import type {CanonicalStage} from './intents';
import type {PreparedPdf} from './private-validator';
import {isDefiniteTransactionRejection,type StagedPrivateObject} from './supabase-private';

type Database={rpc<T>(name:string,args:Record<string,unknown>,decode:(value:unknown)=>T):Promise<T>;rpcWithDefiniteRejection<T>(name:string,args:Record<string,unknown>,decode:(value:unknown)=>T):Promise<T>;stagePrivateObject(path:string,pdf:Uint8Array):Promise<StagedPrivateObject>;readPrivateObject(path:string,maxBytes:number):Promise<Uint8Array>};
type Validator={prepare(pdf:Uint8Array):Promise<PreparedPdf>};
const unavailable=()=>Error('UNAVAILABLE');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const filename=(value:unknown):value is string=>typeof value==='string'&&/^[^\r\n/\\]{1,124}\.pdf$/i.test(value);
const storage=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9-]{36}\/versions\/[a-f0-9-]{36}\.pdf$/i.test(value);
const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const invitationToken=()=>`invite_${randomBytes(32).toString('base64url')}`;
type Contact={id:string;email:string;displayName:string|null;usageCount:number;lastUsedAt:string|null};

function contact(value:unknown):Contact{
 if(!object(value)||!uuid(value.id)||typeof value.email!=='string'||value.email.length>254||(value.displayName!==null&&typeof value.displayName!=='string')||!Number.isInteger(value.usageCount)||(value.lastUsedAt!==null&&typeof value.lastUsedAt!=='string'))throw unavailable();
 return value as Contact;
}
function round(value:unknown){if(!object(value)||!uuid(value.id)||!filename(value.filename)||typeof value.message!=='string'||typeof value.protected!=='boolean'||typeof value.paused!=='boolean'||(value.expectedSignatures!==null&&!Number.isInteger(value.expectedSignatures))||!Number.isInteger(value.signatureCount))throw unavailable();return value as {id:string;filename:string;message:string;protected:boolean;paused:boolean;expectedSignatures:number|null;signatureCount:number};}
function queue(value:unknown){if(!object(value)||!uuid(value.actorId)||!['waiting','active','completed','left'].includes(String(value.status))||!Number.isInteger(value.position)||(value.leaseExpiresAt!==null&&typeof value.leaseExpiresAt!=='string'))throw unavailable();return value as {actorId:string;status:'waiting'|'active'|'completed'|'left';position:number;leaseExpiresAt:string|null};}
function version(value:unknown){if(!object(value)||!uuid(value.id)||!hash(value.sha256)||!Number.isInteger(value.signatureCount)||typeof value.createdAt!=='string'||typeof value.current!=='boolean')throw unavailable();return value as {id:string;sha256:string;signatureCount:number;createdAt:string;current:boolean};}
function incident(value:unknown){if(!object(value)||!uuid(value.id)||typeof value.status!=='string')throw unavailable();return value as {id:string;status:string};}
function finalShare(value:unknown){if(!object(value)||!uuid(value.id)||!uuid(value.documentId)||typeof value.expiresAt!=='string')throw unavailable();return value as {id:string;documentId:string;expiresAt:string};}

function publicProcess(value:unknown){
 if(!object(value)||!uuid(value.id)||!filename(value.filename)||value.status!=='ready_for_signer'||!Number.isInteger(value.signerCount))throw unavailable();
 return{id:value.id,filename:value.filename,status:value.status,signerCount:Number(value.signerCount)} as const;
}
function download(value:unknown){
 if(!object(value)||!uuid(value.documentId)||!uuid(value.versionId)||!filename(value.filename)||!storage(value.storagePath)||!Number.isInteger(value.byteSize)||Number(value.byteSize)<5||!hash(value.sha256))throw unavailable();
 return value as {documentId:string;versionId:string;filename:string;storagePath:string;byteSize:number;sha256:string};
}
function stage(value:unknown){
 if(!object(value)||![value.documentId,value.versionId,value.stageId,value.signerId].every(uuid)||!hash(value.baseSha256)||typeof value.role!=='string'||!filename(value.filename)||!storage(value.storagePath)||!Number.isInteger(value.pageCount)||!Number.isInteger(value.previousSignatureCount)||!Number.isInteger(value.byteSize)||typeof value.pageWidth!=='number'||typeof value.pageHeight!=='number')throw unavailable();
 return value as CanonicalStage&{filename:string;previousSignatureCount:number;storagePath:string;byteSize:number};
}
function intent(value:unknown,nonce:string):SigningIntent{
 if(!object(value)||![value.id,value.documentId,value.versionId,value.stageId,value.signerId,value.correlationId].every(uuid)||!hash(value.baseSha256)||value.profile!=='firmaec-qr-compatible'||typeof value.role!=='string'||!object(value.position)||typeof value.issuedAt!=='string'||typeof value.expiresAt!=='string'||value.state!=='signature_intent_issued')throw unavailable();
 return{...value,nonce} as SigningIntent;
}

/** Request-scoped adapters for the private v2 RPC and immutable object store. */
export function createSupabaseRepositories(database:Database,validator:Validator){
 const stages=new Map<string,ReturnType<typeof stage>>();
 const versions=new Map<string,{path:string;bytes:number;hash:string}>();
 return{
  async reserve(actor:string,operation:string){await database.rpc('v2_reserve_operation',{p_actor_id:actor,p_operation:operation},value=>{if(!object(value)||value.reserved!==true)throw unavailable();return true;});},
  async create(input:{ownerId:string;clientIpHash:string;filename:string;pdf:Uint8Array;signers:string[];mode?:'directed'|'open_queue';message?:string;expectedSignatures?:number|null;accessSecretHash?:string|null}){
   const prepared=await validator.prepare(input.pdf);if(prepared.signatureCount+input.signers.length>20)throw unavailable();
   const documentId=randomUUID(),versionId=randomUUID(),path=`${documentId}/versions/${versionId}.pdf`;
   const staged=await database.stagePrivateObject(path,prepared.pdf);
   const invitationTokens=input.signers.map(()=>invitationToken());
   try{return await database.rpcWithDefiniteRejection('v2_create_parity_process',{p_owner_id:input.ownerId,p_client_ip_hash:input.clientIpHash,p_document_id:documentId,p_version_id:versionId,p_filename:input.filename,p_sha256:prepared.sha256,p_byte_size:prepared.byteSize,p_page_count:prepared.pageCount,p_last_page_width:prepared.lastPageWidth,p_last_page_height:prepared.lastPageHeight,p_existing_signature_count:prepared.signatureCount,p_signer_emails:input.signers,p_invitation_tokens:invitationTokens,p_mode:input.mode??'directed',p_message:input.message??'',p_expected_signatures:input.expectedSignatures??input.signers.length,p_access_secret_hash:input.accessSecretHash??null},publicProcess);}
   catch(error){if(isDefiniteTransactionRejection(error))await staged.cleanupAfterDefiniteRejection();throw unavailable();}
  },
  status(documentId:string,actor:string){return database.rpc('v2_get_process_status',{p_document_id:documentId,p_actor_id:actor},value=>value as never);},
  finalize(documentId:string,actor:string){return database.rpc('v2_finalize_process',{p_document_id:documentId,p_actor_id:actor},value=>value as never);},
  async download(documentId:string,actor:string){const meta=await database.rpc('v2_get_authorized_download',{p_document_id:documentId,p_actor_id:actor},download);const pdf=await database.readPrivateObject(meta.storagePath,meta.byteSize);if(pdf.length!==meta.byteSize||digest(pdf)!==meta.sha256)throw unavailable();return{filename:meta.filename,pdf};},
  async loadStage(documentId:string,actor:string){const value=await database.rpc('v2_get_signing_stage',{p_document_id:documentId,p_actor_id:actor},stage);stages.set(documentId,value);versions.set(value.versionId,{path:value.storagePath,bytes:value.byteSize,hash:value.baseSha256});return value;},
  async loadCanonical(versionId:string,actor?:string){let meta=versions.get(versionId);if(!meta&&actor){const raw=await database.rpc('v2_get_version_storage',{p_version_id:versionId,p_actor_id:actor},value=>value);if(!object(raw)||!storage(raw.storagePath)||!Number.isInteger(raw.byteSize)||!hash(raw.sha256))throw unavailable();meta={path:raw.storagePath,bytes:Number(raw.byteSize),hash:raw.sha256};versions.set(versionId,meta);}if(!meta)throw unavailable();const pdf=await database.readPrivateObject(meta.path,meta.bytes);if(pdf.length!==meta.bytes||digest(pdf)!==meta.hash)throw unavailable();return pdf;},
  async persistIntent(value:SigningIntent){const stored=await database.rpc('v2_issue_intent',{p_document_id:value.documentId,p_actor_id:value.signerId,p_intent_id:value.id,p_nonce_hash:digest(value.nonce),p_position:value.position,p_correlation_id:value.correlationId,p_issued_at:value.issuedAt,p_expires_at:value.expiresAt},raw=>intent(raw,value.nonce));if(stored.id!==value.id||stored.baseSha256!==value.baseSha256||stored.versionId!==value.versionId)throw unavailable();},
  async loadIntent(id:string,actor:string){const value=await database.rpc('v2_get_intent_download',{p_intent_id:id,p_actor_id:actor},raw=>{if(!object(raw)||!object(raw.current)||!filename(raw.filename)||!storage(raw.storagePath)||!Number.isInteger(raw.byteSize))throw unavailable();const current=stage({...raw.current,filename:raw.filename,previousSignatureCount:raw.previousSignatureCount,storagePath:raw.storagePath,byteSize:raw.byteSize});return{intent:intent(raw.intent,'download-authorized-nonce-withheld-00000000000'),current};});stages.set(value.current.documentId,value.current);versions.set(value.current.versionId,{path:value.current.storagePath,bytes:value.current.byteSize,hash:value.current.baseSha256});return value.intent;},
  async receipt(id:string,actor:string){return database.rpc('v2_get_intent_receipt',{p_intent_id:id,p_actor_id:actor},raw=>{if(!object(raw)||typeof raw.state!=='string')throw unavailable();return{state:raw.state,...(raw.report?{report:raw.report as SignatureValidationResult}:{})} as never;});},
  verification(id:string,actor:string){return database.rpc('v2_get_verification',{p_intent_id:id,p_actor_id:actor},value=>value as never);},
  listContacts(ownerId:string){return database.rpc('v2_list_contacts',{p_owner_id:ownerId},value=>{if(!Array.isArray(value)||value.length>500)throw unavailable();return value.map(contact);});},
  upsertContact(input:{ownerId:string;id:string|null;email:string;displayName:string|null}){return database.rpc('v2_upsert_contact',{p_owner_id:input.ownerId,p_contact_id:input.id,p_email:input.email,p_display_name:input.displayName},contact);},
  async deleteContact(ownerId:string,id:string){await database.rpc('v2_delete_contact',{p_owner_id:ownerId,p_contact_id:id},value=>{if(!object(value)||value.ok!==true)throw unavailable();return true;});},
  getRound(documentId:string,accessSecretHash:string|null){return database.rpc('v2_get_round_access',{p_document_id:documentId,p_access_secret_hash:accessSecretHash},round);},
  joinQueue(input:{documentId:string;actorId:string;sessionHash:string;email:string|null;displayName:string|null}){return database.rpc('v2_join_queue',{p_document_id:input.documentId,p_actor_id:input.actorId,p_session_hash:input.sessionHash,p_email:input.email,p_display_name:input.displayName},value=>{if(!object(value)||!uuid(value.entryId)||!uuid(value.actorId)||!['waiting','active'].includes(String(value.status))||!Number.isInteger(value.position))throw unavailable();return value as {entryId:string;actorId:string;status:'waiting'|'active';position:number};});},
  resolveQueue(documentId:string,sessionHash:string){return database.rpc('v2_resolve_queue_session',{p_document_id:documentId,p_session_hash:sessionHash},value=>value===null?null:queue(value));},
  claimTurn(documentId:string,actorId:string,tokenHash:string){return database.rpc('v2_claim_turn',{p_document_id:documentId,p_actor_id:actorId,p_token_hash:tokenHash},value=>{if(!object(value)||!uuid(value.leaseId)||!uuid(value.stageId)||!uuid(value.actorId)||typeof value.expiresAt!=='string')throw unavailable();return value as {leaseId:string;stageId:string;actorId:string;expiresAt:string};});},
  async releaseTurn(documentId:string,actorId:string){await database.rpc('v2_release_turn',{p_document_id:documentId,p_actor_id:actorId},value=>{if(!object(value)||value.ok!==true)throw unavailable();return true;});},
  processAction(input:{documentId:string;actorId:string;action:string;versionId:string|null;reason:string}){return database.rpc('v2_process_action',{p_document_id:input.documentId,p_owner_id:input.actorId,p_action:input.action,p_version_id:input.versionId,p_reason:input.reason},value=>{if(!object(value)||value.ok!==true||!uuid(value.id)||value.action!==input.action)throw unavailable();return value;});},
  listVersions(documentId:string,actorId:string){return database.rpc('v2_list_process_versions',{p_document_id:documentId,p_actor_id:actorId},value=>{if(!Array.isArray(value)||value.length>100)throw unavailable();return value.map(version);});},
  listIncidents(documentId:string,actorId:string){return database.rpc('v2_list_process_incidents',{p_document_id:documentId,p_actor_id:actorId},value=>{if(!Array.isArray(value)||value.length>100)throw unavailable();return value.map(incident);});},
  reportIncident(input:{documentId:string;actorId:string;reason:string;note:string}){return database.rpc('v2_report_process_incident',{p_document_id:input.documentId,p_actor_id:input.actorId,p_reason:input.reason,p_note:input.note},incident);},
  createFinalShare(input:{documentId:string;ownerId:string;tokenHash:string;expiresAt:string}){return database.rpc('v2_create_final_share',{p_document_id:input.documentId,p_owner_id:input.ownerId,p_token_hash:input.tokenHash,p_expires_at:input.expiresAt},finalShare);},
  async resolveFinalShare(input:{shareId:string;tokenHash:string}){const meta=await database.rpc('v2_resolve_final_share',{p_share_id:input.shareId,p_token_hash:input.tokenHash},download);const pdf=await database.readPrivateObject(meta.storagePath,meta.byteSize);if(pdf.length!==meta.byteSize||digest(pdf)!==meta.sha256)throw unavailable();return{filename:meta.filename,expiresAt:(meta as typeof meta&{expiresAt:string}).expiresAt,pdf};},
  startArcade(input:{ticketHash:string;originHash:string;seed:number}){return database.rpc('v2_start_arcade',{p_ticket_hash:input.ticketHash,p_origin_hash:input.originHash,p_seed:input.seed},value=>value as {runId:string;seed:number;expiresAt:string});},
  finishArcade(input:{ticketHash:string;alias:string;score:number}){return database.rpc('v2_finish_arcade',{p_ticket_hash:input.ticketHash,p_alias:input.alias,p_score:input.score},value=>value as {alias:string;score:number;createdAt:string});},
  leaderboard(){return database.rpc('v2_arcade_leaderboard',{},value=>value as Array<{alias:string;score:number;createdAt:string}>);},
 };
}
