import {createSessionHandler} from '../../../server/v2/session-api';
import {createGuestSessionHandler} from '../../../server/v2/guest-session-api';
import {createAdminHandler} from '../../../server/v2/admin-api';
import {processOutboxBatch,verifyResendWebhook,type OutboxJob,type RenderedEmail} from '../../../server/v2/email-outbox';
import {createProcessHandler} from '../../../server/v2/process-api';
import {createContactsHandler} from '../../../server/v2/contacts-api';
import {createQueueHandler} from '../../../server/v2/queue-api';
import {createProcessActionsHandler} from '../../../server/v2/process-actions-api';
import {createFinalShareHandler} from '../../../server/v2/final-share-api';
import {createArcadeHandler} from '../../../server/v2/arcade-api';
import {createPreparationHandler} from '../../../server/v2/prepare-api';
import {createSubmissionHandler} from '../../../server/v2/submit-api';
import {createReceiptHandler} from '../../../server/v2/receipts-api';
import {createVerificationHandler} from '../../../server/v2/verification-api';
import {OfflineValidatorClient} from '../../../server/v2/private-validator';
import {postgresSubmission} from '../../../server/v2/postgres-submission';
import {supabasePrivate} from '../../../server/v2/supabase-private';
import {createSupabaseRepositories} from '../../../server/v2/supabase-repository';
import type {SigningFlags} from '../../../src/v2/policy';

type Env={ASSETS:Fetcher;V2_ORIGIN:string;SUPABASE_V2_URL:string;SUPABASE_V2_PUBLISHABLE_KEY:string;SUPABASE_V2_SERVICE_ROLE_KEY:string;V2_STORAGE_BUCKET:string;V2_VALIDATOR_URL:string;V2_VALIDATOR_TOKEN:string;V2_DIRECT_ENABLED:string;V2_EXTERNAL_ENABLED:string;V2_PROFILE_ENABLED:string;RESEND_API_KEY?:string;RESEND_WEBHOOK_SECRET?:string};
const expectedOrigin='https://pruebas.leapsign.app';
const expectedSupabase='https://lbreydchhskrrmpzniem.supabase.co';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const enabled=(value:string)=>value==='true';
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const boundedBody=async(request:Request,limit:number)=>{if(!request.body)throw Error();const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('PAYLOAD_TOO_LARGE');chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}};
const hmacHex=async(secret:string,value:string)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const refreshRevocation=async(env:Env)=>{
 const validator=new URL(env.V2_VALIDATOR_URL);
 if(validator.protocol!=='https:'||validator.username||validator.password||validator.search||validator.hash||validator.pathname!=='/validate'||env.V2_VALIDATOR_TOKEN.length<32)throw Error('V2_CONFIGURATION_REQUIRED');
 const response=await fetch(new URL('/refresh',validator),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${env.V2_VALIDATOR_TOKEN}`}});
 if(!response.ok||response.redirected){await response.body?.cancel();throw Error('REVOCATION_REFRESH_FAILED');}
 await response.body?.cancel();
};

export default{async fetch(request:Request,env:Env):Promise<Response>{
 try{
  if(env.V2_ORIGIN!==expectedOrigin||env.SUPABASE_V2_URL!==expectedSupabase||env.V2_STORAGE_BUCKET!=='v2-pdfs'||!env.SUPABASE_V2_PUBLISHABLE_KEY||!env.SUPABASE_V2_SERVICE_ROLE_KEY||!env.V2_VALIDATOR_URL||!env.V2_VALIDATOR_TOKEN)throw Error();
  const url=new URL(request.url);if(url.origin!==expectedOrigin)return json({code:'NOT_FOUND'},404);
  const flags:SigningFlags={DIRECT_P12_SIGNING_ENABLED:env.V2_DIRECT_ENABLED,EXTERNAL_SIGNATURE_ENABLED:env.V2_EXTERNAL_ENABLED,FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:env.V2_PROFILE_ENABLED};
  if(url.pathname==='/api/v2/config'&&request.method==='GET'&&request.headers.get('X-LeapSign-Client')==='v2')return json({origin:expectedOrigin,supabaseUrl:expectedSupabase,publishableKey:env.SUPABASE_V2_PUBLISHABLE_KEY,flags:{direct:enabled(env.V2_DIRECT_ENABLED),external:enabled(env.V2_EXTERNAL_ENABLED),firmaecProfile:enabled(env.V2_PROFILE_ENABLED)}});
  const database=supabasePrivate({projectUrl:expectedSupabase,publicKey:env.SUPABASE_V2_PUBLISHABLE_KEY,serviceKey:env.SUPABASE_V2_SERVICE_ROLE_KEY,bucket:'v2-pdfs'});
  let activeActor='';
  const validator=new OfflineValidatorClient({flags,url:env.V2_VALIDATOR_URL,serviceToken:env.V2_VALIDATOR_TOKEN,fetch:globalThis.fetch.bind(globalThis),beforeValidation:async()=>{if(!activeActor)throw Error();await database.rpc('v2_reserve_operation',{p_actor_id:activeActor,p_operation:'validation'},value=>value);}});
  const repositories=createSupabaseRepositories(database,validator);
  const authenticate=async(req:Request)=>{const guest=await database.authenticateGuest(req);const owner=await database.authenticate(req);const requestPath=new URL(req.url).pathname;const guestDocument=guest?.documentId??'';const guestRoute=requestPath.startsWith('/api/v2/signing/')||(!owner&&requestPath.startsWith('/api/v2/verifications/'))||requestPath===`/api/v2/processes/${guestDocument}/pdf`;const actor=(guestRoute?guest?.actorId:owner)??owner??guest?.actorId??null;if(actor)activeActor=actor;return actor;};
  const authenticateCandidates=async(req:Request)=>{const[owner,guest]=await Promise.all([database.authenticate(req),database.authenticateGuest(req)]);return[owner,guest?.actorId];};
  const clientRateKey=async(req:Request)=>{const ip=req.headers.get('CF-Connecting-IP')??'';if(!/^[0-9a-f:.]{3,45}$/i.test(ip))throw Error('CLIENT_ADDRESS_REQUIRED');return hmacHex(env.SUPABASE_V2_SERVICE_ROLE_KEY,`leapsign-v2-email-rate:${ip.toLowerCase()}`);};
  const reserve=async(actor:string,operation:string)=>{activeActor=actor;await repositories.reserve(actor,operation);};
  if(url.pathname==='/api/v2/session')return createSessionHandler({verifyAccessToken:database.verifyAccessToken,resolveSession:(req)=>database.resolveUser(req)},expectedOrigin)(request);
  if(url.pathname==='/api/v2/guest-session')return createGuestSessionHandler({
   exchange:(invitationHash,sessionHash,signal)=>database.rpc('v2_exchange_guest_invitation',{p_invitation_hash:invitationHash,p_session_hash:sessionHash},value=>value as never,signal),
   resolve:(req)=>database.authenticateGuest(req),
  },expectedOrigin)(request);
  if(url.pathname.startsWith('/api/v2/admin/'))return createAdminHandler({
   authenticateAdministrator:database.authenticateAdministrator,
   listUsers:(page,search)=>database.rpc('v2_admin_list_users',{p_page:page,p_search:search},value=>value as never),
   invite:database.adminInvite,
   resend:database.adminResend,
   recover:database.adminRecover,
   suspend:database.adminSuspend,
   reactivate:database.adminReactivate,
   audit:(page)=>database.rpc('v2_list_admin_audit',{p_limit:50,p_offset:(page-1)*50},value=>Array.isArray(value)?value.flatMap(item=>record(item)&&typeof item.id==='number'&&typeof item.administrator_id==='string'&&typeof item.action==='string'&&typeof item.created_at==='string'?[{id:item.id,administratorId:item.administrator_id,action:item.action,targetUserId:typeof item.target_user_id==='string'?item.target_user_id:null,targetEmail:typeof item.target_email==='string'?item.target_email:null,createdAt:item.created_at}]:[]):[]),
   recordAudit:(administratorId,action,targetId,targetEmail)=>database.rpc('v2_record_admin_action',{p_administrator_id:administratorId,p_action:action,p_target_user_id:targetId??null,p_target_email:targetEmail??null},()=>true),
  },expectedOrigin)(request);
  if(url.pathname==='/api/v2/email/webhook'&&request.method==='POST'){
   if(!env.RESEND_WEBHOOK_SECRET)return json({code:'NOT_FOUND'},404);
   const contentLength=Number(request.headers.get('Content-Length')??'0');if(contentLength>65_536)return json({code:'PAYLOAD_TOO_LARGE'},413);
   let bytes:Uint8Array;try{bytes=await boundedBody(request,65_536);}catch{return json({code:'PAYLOAD_TOO_LARGE'},413);}
   const verified=await verifyResendWebhook(bytes,{id:request.headers.get('svix-id')??'',timestamp:request.headers.get('svix-timestamp')??'',signature:request.headers.get('svix-signature')??''},env.RESEND_WEBHOOK_SECRET);
   if(!verified)return json({code:'UNAUTHORIZED'},401);
   const event:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));const data=record(event)&&record(event.data)?event.data:null;
   const eventId=request.headers.get('svix-id')??'';const eventType=record(event)&&typeof event.type==='string'?event.type:'';
   const messageId=data&&typeof data.email_id==='string'?data.email_id:'';const recipient=data&&Array.isArray(data.to)&&typeof data.to[0]==='string'?data.to[0]:'';
   await database.rpc('v2_record_email_event',{p_event_id:eventId,p_message_id:messageId,p_event_type:eventType,p_recipient:recipient},()=>true);
   return json({code:'ACCEPTED'},202);
  }
  if(url.pathname==='/api/v2/contacts'||url.pathname.startsWith('/api/v2/contacts/'))return createContactsHandler({authenticate,reserve:reserve as never,list:repositories.listContacts,upsert:repositories.upsertContact,remove:repositories.deleteContact},expectedOrigin)(request);
  if(url.pathname.startsWith('/api/v2/rounds/'))return createQueueHandler({round:repositories.getRound,join:repositories.joinQueue,resolve:repositories.resolveQueue,claim:repositories.claimTurn,release:repositories.releaseTurn,reserve:reserve as never},expectedOrigin)(request);
  if(url.pathname.startsWith('/api/v2/arcade/'))return createArcadeHandler({clientKey:clientRateKey,start:repositories.startArcade,finish:repositories.finishArcade,leaderboard:repositories.leaderboard},expectedOrigin)(request);
  if(/^\/api\/v2\/(processes\/[a-f0-9-]{36}\/final-share|final\/[a-f0-9-]{36})$/.test(url.pathname))return createFinalShareHandler({authenticate,reserve:reserve as never,create:repositories.createFinalShare,resolve:repositories.resolveFinalShare},expectedOrigin)(request);
  if(/^\/api\/v2\/processes\/[a-f0-9-]{36}\/(actions|versions|incidents)$/.test(url.pathname))return createProcessActionsHandler({authenticate,reserve:reserve as never,action:repositories.processAction,versions:repositories.listVersions,listIncidents:repositories.listIncidents,reportIncident:repositories.reportIncident},expectedOrigin)(request);
  if(url.pathname==='/api/v2/processes'||url.pathname.startsWith('/api/v2/processes/'))return createProcessHandler({origin:expectedOrigin,authenticate,clientRateKey,reserve:reserve as never,create:repositories.create,status:repositories.status,list:repositories.listProcesses,download:repositories.download,finalize:repositories.finalize})(request);
  if(url.pathname==='/api/v2/signing/prepare'||/\/api\/v2\/signing\/intents\/[a-f0-9-]{36}\/pdf$/.test(url.pathname))return createPreparationHandler({origin:expectedOrigin,flags,authenticate,reserve:reserve as never,loadStage:repositories.loadStage,loadCanonical:repositories.loadCanonical,persistIntent:repositories.persistIntent,loadIntent:repositories.loadIntent})(request);
  if(url.pathname==='/api/v2/signing/submit'){
   const submission=postgresSubmission({rpc:(name,args)=>database.rpc(name,args,value=>value),writePrivateObject:database.writePrivateObject});
   return createSubmissionHandler({origin:expectedOrigin,flags,authenticate,reserve:reserve as never,repository:submission,validator,loadCanonical:repositories.loadCanonical})(request);
  }
  if(/\/api\/v2\/signing\/intents\/[a-f0-9-]{36}\/receipt$/.test(url.pathname))return createReceiptHandler({origin:expectedOrigin,authenticate,authenticateCandidates,reserve:reserve as never,load:repositories.receipt})(request);
  if(/\/api\/v2\/verifications\/[a-f0-9-]{36}$/.test(url.pathname))return createVerificationHandler({origin:expectedOrigin,authenticate,authenticateCandidates,reserve:reserve as never,load:repositories.verification})(request);
  if(url.pathname.startsWith('/api/v2/'))return json({code:'NOT_FOUND'},404);
  const asset=await env.ASSETS.fetch(request);if(asset.status!==404)return asset;
  return env.ASSETS.fetch(new Request(new URL('/',request.url),request));
 }catch{return json({code:'V2_CONFIGURATION_REQUIRED'},503);}
},async scheduled(controller:{cron?:string},env:Env,context:{waitUntil(promise:Promise<unknown>):void}){
 const jobs:Promise<unknown>[]=[];
 if(controller.cron==='17 */6 * * *')jobs.push(refreshRevocation(env));
 if(env.RESEND_API_KEY){
  const database=supabasePrivate({projectUrl:expectedSupabase,publicKey:env.SUPABASE_V2_PUBLISHABLE_KEY,serviceKey:env.SUPABASE_V2_SERVICE_ROLE_KEY,bucket:'v2-pdfs'});
  jobs.push(database.rpc('v2_enqueue_email_reminders',{},()=>true).then(()=>processOutboxBatch({
   claim:(limit)=>database.rpc('v2_claim_email_outbox',{p_limit:limit},value=>Array.isArray(value)?value.map(raw=>{if(!record(raw)||typeof raw.id!=='string'||typeof raw.kind!=='string'||typeof raw.recipient!=='string'||!record(raw.data)||typeof raw.attempts!=='number')throw Error();return{id:raw.id,kind:raw.kind,recipient:raw.recipient,data:raw.data,attempts:raw.attempts} as OutboxJob;}):[]),
   markSent:(id,providerId)=>database.rpc('v2_mark_email_sent',{p_id:id,p_provider_id:providerId},()=>true),
   markFailed:(id,attempts,dead,errorCode)=>database.rpc('v2_mark_email_failed',{p_id:id,p_attempts:attempts,p_dead:dead,p_error_code:errorCode},()=>true),
   deliver:async(message:RenderedEmail,apiKey:string,idempotencyKey:string)=>{const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:message.from,to:[message.to],reply_to:message.replyTo,subject:message.subject,html:message.html,text:message.text})});const value:unknown=await response.json();if(!response.ok||!record(value)||typeof value.id!=='string')throw Error();return{id:value.id};},
  },env.RESEND_API_KEY)));
 }
 context.waitUntil(Promise.all(jobs));
}};
