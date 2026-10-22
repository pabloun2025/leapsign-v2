import {V2_STAGING_ORIGIN,assertV2Origin} from '../../src/v2/policy';
import {normalizeContactEmail} from './contacts-domain';

export type Contact={id:string;email:string;displayName:string|null;usageCount:number;lastUsedAt:string|null};
export interface ContactsDependencies{
 authenticate(request:Request):Promise<string|null>;
 reserve(actor:string,operation:'contacts'):Promise<void>;
 list(ownerId:string):Promise<Contact[]>;
 upsert(input:{ownerId:string;id:string|null;email:string;displayName:string|null}):Promise<Contact>;
 remove(ownerId:string,id:string):Promise<void>;
}
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json'}});
const uuid=(value:string)=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validMutation=(request:Request,origin:string)=>request.headers.get('Origin')===origin&&(!request.headers.has('Sec-Fetch-Site')||request.headers.get('Sec-Fetch-Site')==='same-origin');

export function createContactsHandler(deps:ContactsDependencies,origin=V2_STAGING_ORIGIN){
 assertV2Origin(origin);
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);const match=/^\/api\/v2\/contacts(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
  if(url.origin!==origin||url.search||!match||request.headers.get('X-LeapSign-Client')!=='v2')return json({code:'NOT_FOUND'},404);
  if(!['GET','POST','DELETE'].includes(request.method)||(request.method==='GET'&&match[1])||(request.method==='POST'&&match[1])||(request.method==='DELETE'&&!match[1]))return json({code:'NOT_FOUND'},404);
  if(request.method!=='GET'&&!validMutation(request,origin))return json({code:'FORBIDDEN'},403);
  try{
   const owner=await deps.authenticate(request);if(!owner)return json({code:'UNAUTHENTICATED'},401);
   if(request.method==='GET')return json({contacts:await deps.list(owner)});
   await deps.reserve(owner,'contacts');
   if(request.method==='DELETE'){if(!uuid(match[1]!))throw Error();await deps.remove(owner,match[1]!);return json({ok:true});}
   if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error();
   const text=await request.text();if(text.length>2048)throw Error();const value:unknown=JSON.parse(text);if(!object(value)||Object.keys(value).some(key=>!['id','email','displayName'].includes(key))||typeof value.email!=='string'||(value.id!==undefined&&(typeof value.id!=='string'||!uuid(value.id)))||(value.displayName!==undefined&&typeof value.displayName!=='string'))throw Error();
   const email=normalizeContactEmail(value.email);const displayName=typeof value.displayName==='string'?value.displayName.normalize('NFC').trim():'';
   if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||displayName.length>120)throw Error();
   return json(await deps.upsert({ownerId:owner,id:typeof value.id==='string'?value.id:null,email,displayName:displayName||null}),201);
  }catch{return json({code:'INVALID_REQUEST'},400);}
 };
}
