import {V2_STAGING_ORIGIN,assertV2Origin} from '../../src/v2/policy';
import {validateProcessAction,type ProcessAction} from './lifecycle';

export type ProcessVersion={id:string;sha256:string;signatureCount:number;createdAt:string;current:boolean};
export type ProcessIncident={id:string;status:string};
export interface ProcessActionsDependencies{
 authenticate(request:Request):Promise<string|null>;
 reserve(actor:string,operation:'process_action'):Promise<void>;
 action(input:{documentId:string;actorId:string;action:ProcessAction;versionId:string|null;reason:string}):Promise<unknown>;
 versions(documentId:string,actorId:string):Promise<ProcessVersion[]>;
 listIncidents(documentId:string,actorId:string):Promise<ProcessIncident[]>;
 reportIncident(input:{documentId:string;actorId:string;reason:string;note:string}):Promise<ProcessIncident>;
}
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json'}});
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const mutation=(request:Request,origin:string)=>request.headers.get('Origin')===origin&&(!request.headers.has('Sec-Fetch-Site')||['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')!));
async function body(request:Request){if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error();const text=await request.text();if(text.length>4096)throw Error();const value:unknown=JSON.parse(text);if(!object(value))throw Error();return value;}

export function createProcessActionsHandler(deps:ProcessActionsDependencies,origin=V2_STAGING_ORIGIN){
 assertV2Origin(origin);
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);const match=/^\/api\/v2\/processes\/([a-f0-9-]{36})\/(actions|versions|incidents)$/.exec(url.pathname);
  if(url.origin!==origin||url.search||!match||request.headers.get('X-LeapSign-Client')!=='v2')return json({code:'NOT_FOUND'},404);
  const resource=match[2],isMutation=request.method==='POST';
  if(!((resource==='actions'&&isMutation)||(resource==='versions'&&request.method==='GET')||(resource==='incidents'&&['GET','POST'].includes(request.method))))return json({code:'NOT_FOUND'},404);
  if(isMutation&&!mutation(request,origin))return json({code:'FORBIDDEN'},403);
  try{
   const actorId=await deps.authenticate(request);if(!actorId)return json({code:'UNAUTHENTICATED'},401);
   const documentId=match[1].toLowerCase();
   if(resource==='versions')return json({versions:await deps.versions(documentId,actorId)});
   if(resource==='incidents'&&request.method==='GET')return json({incidents:await deps.listIncidents(documentId,actorId)});
   await deps.reserve(actorId,'process_action');const value=await body(request);
   if(resource==='actions'){const action=validateProcessAction(value);if(!action)throw Error();return json(await deps.action({documentId,actorId,...action}));}
   if(Object.keys(value).some(key=>!['reason','note'].includes(key))||typeof value.reason!=='string'||typeof value.note!=='string')throw Error();
   const reason=value.reason.normalize('NFC').trim(),note=value.note.normalize('NFC').trim();if(!/^[a-z_]{3,40}$/.test(reason)||note.length>1000)throw Error();
   return json(await deps.reportIncident({documentId,actorId,reason,note}),201);
  }catch{return json({code:'INVALID_REQUEST'},400);}
 };
}
