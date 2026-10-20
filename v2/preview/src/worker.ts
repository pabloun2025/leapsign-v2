import {createSessionHandler} from '../../../server/v2/session-api';
import {createProcessHandler} from '../../../server/v2/process-api';
import {createPreparationHandler} from '../../../server/v2/prepare-api';
import {createSubmissionHandler} from '../../../server/v2/submit-api';
import {createReceiptHandler} from '../../../server/v2/receipts-api';
import {OfflineValidatorClient} from '../../../server/v2/private-validator';
import {postgresSubmission} from '../../../server/v2/postgres-submission';
import {supabasePrivate} from '../../../server/v2/supabase-private';
import {createSupabaseRepositories} from '../../../server/v2/supabase-repository';
import type {SigningFlags} from '../../../src/v2/policy';

type Env={ASSETS:Fetcher;V2_ORIGIN:string;SUPABASE_V2_URL:string;SUPABASE_V2_PUBLISHABLE_KEY:string;SUPABASE_V2_SERVICE_ROLE_KEY:string;V2_STORAGE_BUCKET:string;V2_VALIDATOR_URL:string;V2_VALIDATOR_TOKEN:string;V2_DIRECT_ENABLED:string;V2_EXTERNAL_ENABLED:string;V2_PROFILE_ENABLED:string};
const expectedOrigin='https://pruebas.leapsign.app';
const expectedSupabase='https://lbreydchhskrrmpzniem.supabase.co';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const enabled=(value:string)=>value==='true';

export default{async fetch(request:Request,env:Env):Promise<Response>{
 try{
  if(env.V2_ORIGIN!==expectedOrigin||env.SUPABASE_V2_URL!==expectedSupabase||env.V2_STORAGE_BUCKET!=='v2-pdfs'||!env.SUPABASE_V2_PUBLISHABLE_KEY||!env.SUPABASE_V2_SERVICE_ROLE_KEY||!env.V2_VALIDATOR_URL||!env.V2_VALIDATOR_TOKEN)throw Error();
  const url=new URL(request.url);if(url.origin!==expectedOrigin)return json({code:'NOT_FOUND'},404);
  const flags:SigningFlags={direct:enabled(env.V2_DIRECT_ENABLED),external:enabled(env.V2_EXTERNAL_ENABLED),firmaecProfile:enabled(env.V2_PROFILE_ENABLED)};
  if(url.pathname==='/api/v2/config'&&request.method==='GET'&&request.headers.get('X-LeapSign-Client')==='v2')return json({origin:expectedOrigin,supabaseUrl:expectedSupabase,publishableKey:env.SUPABASE_V2_PUBLISHABLE_KEY,flags});
  const database=supabasePrivate({projectUrl:expectedSupabase,publicKey:env.SUPABASE_V2_PUBLISHABLE_KEY,serviceKey:env.SUPABASE_V2_SERVICE_ROLE_KEY,bucket:'v2-pdfs'});
  let activeActor='';
  const validator=new OfflineValidatorClient({flags,url:env.V2_VALIDATOR_URL,serviceToken:env.V2_VALIDATOR_TOKEN,fetch,beforeValidation:async()=>{if(!activeActor)throw Error();await database.rpc('v2_reserve_operation',{p_actor_id:activeActor,p_operation:'validation'},value=>value);}});
  const repositories=createSupabaseRepositories(database,validator);
  const authenticate=async(req:Request)=>{const actor=await database.authenticate(req);if(actor)activeActor=actor;return actor;};
  const reserve=async(actor:string,operation:string)=>{activeActor=actor;await repositories.reserve(actor,operation);};
  if(url.pathname==='/api/v2/session')return createSessionHandler({verifyAccessToken:database.verifyAccessToken},expectedOrigin)(request);
  if(url.pathname==='/api/v2/processes'||url.pathname.startsWith('/api/v2/processes/'))return createProcessHandler({origin:expectedOrigin,authenticate,reserve:reserve as never,create:repositories.create,status:repositories.status,download:repositories.download})(request);
  if(url.pathname==='/api/v2/signing/prepare'||/\/api\/v2\/signing\/intents\/[a-f0-9-]{36}\/pdf$/.test(url.pathname))return createPreparationHandler({origin:expectedOrigin,flags,authenticate,reserve:reserve as never,loadStage:repositories.loadStage,loadCanonical:repositories.loadCanonical,persistIntent:repositories.persistIntent,loadIntent:repositories.loadIntent})(request);
  if(url.pathname==='/api/v2/signing/submit'){
   const submission=postgresSubmission({rpc:(name,args)=>database.rpc(name,args,value=>value),writePrivateObject:database.writePrivateObject});
   return createSubmissionHandler({origin:expectedOrigin,flags,authenticate,reserve:reserve as never,repository:submission,validator,loadCanonical:repositories.loadCanonical})(request);
  }
  if(/\/api\/v2\/signing\/intents\/[a-f0-9-]{36}\/receipt$/.test(url.pathname))return createReceiptHandler({origin:expectedOrigin,authenticate,reserve:reserve as never,load:repositories.receipt})(request);
  if(url.pathname.startsWith('/api/v2/'))return json({code:'NOT_FOUND'},404);
  const asset=await env.ASSETS.fetch(request);if(asset.status!==404)return asset;
  return env.ASSETS.fetch(new Request(new URL('/',request.url),request));
 }catch{return json({code:'V2_CONFIGURATION_REQUIRED'},503);}
}};
