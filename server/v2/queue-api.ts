import {V2_STAGING_ORIGIN,assertV2Origin} from '../../src/v2/policy';
import {parseQueueSession,queuePresentation} from './queue-domain';

type RoundAccess={id:string;filename:string;message:string;protected:boolean;paused:boolean;expectedSignatures:number|null;signatureCount:number};
type QueueState={actorId:string;status:'waiting'|'active'|'completed'|'left';position:number;leaseExpiresAt:string|null};
export interface QueueDependencies{
 round(documentId:string,accessSecretHash:string|null):Promise<RoundAccess>;
 join(input:{documentId:string;actorId:string;sessionHash:string;email:string|null;displayName:string|null}):Promise<{entryId:string;actorId:string;status:'waiting'|'active';position:number}>;
 resolve(documentId:string,sessionHash:string):Promise<QueueState|null>;
 claim(documentId:string,actorId:string,tokenHash:string):Promise<{leaseId:string;stageId:string;actorId:string;expiresAt:string}>;
 release(documentId:string,actorId:string):Promise<void>;
 reserve(actor:string,operation:'queue'):Promise<void>;
 randomSession?:()=>string;randomActor?:()=>string;digest?(value:string):Promise<string>;
}
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json',...headers}});
const uuid=(value:string)=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const randomToken=()=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const digest=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

export function createQueueHandler(deps:QueueDependencies,origin=V2_STAGING_ORIGIN){
 assertV2Origin(origin);const makeSession=deps.randomSession??randomToken;const makeActor=deps.randomActor??(()=>crypto.randomUUID());const hash=deps.digest??digest;
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);const match=/^\/api\/v2\/rounds\/([a-f0-9-]{36})\/(access|queue|turn)$/.exec(url.pathname);
  if(url.origin!==origin||url.search||!match||!uuid(match[1])||request.headers.get('X-LeapSign-Client')!=='v2')return json({code:'NOT_FOUND'},404);
  const documentId=match[1].toLowerCase(),resource=match[2];const mutation=request.method!=='GET';
  if(!['GET','POST','DELETE'].includes(request.method)||(resource==='access'&&request.method!=='GET')||(resource==='queue'&&!['GET','POST'].includes(request.method))||(resource==='turn'&&!['POST','DELETE'].includes(request.method)))return json({code:'NOT_FOUND'},404);
  if(mutation&&(request.headers.get('Origin')!==origin||(request.headers.has('Sec-Fetch-Site')&&!['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')!))))return json({code:'FORBIDDEN'},403);
  try{
   if(resource==='access'){const access=request.headers.get('X-LeapSign-Access');if(access!==null&&!/^[a-f0-9]{64}$/.test(access))throw Error();return json(await deps.round(documentId,access));}
   if(resource==='queue'&&request.method==='POST'){
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error();const text=await request.text();if(text.length>2048)throw Error();const value:unknown=JSON.parse(text);
    if(!object(value)||Object.keys(value).sort().join(',')!=='accessSecretHash,displayName,email'||(value.email!==null&&(typeof value.email!=='string'||value.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)))||(value.displayName!==null&&(typeof value.displayName!=='string'||value.displayName.length>120))||(value.accessSecretHash!==null&&(typeof value.accessSecretHash!=='string'||!/^[a-f0-9]{64}$/.test(value.accessSecretHash))))throw Error();
    await deps.round(documentId,value.accessSecretHash as string|null);const session=makeSession(),actorId=makeActor();if(!/^[A-Za-z0-9_-]{43}$/.test(session)||!uuid(actorId))throw Error();const joined=await deps.join({documentId,actorId,sessionHash:await hash(session),email:typeof value.email==='string'?value.email.toLowerCase():null,displayName:typeof value.displayName==='string'?value.displayName.normalize('NFC').trim():null});return json(queuePresentation({...joined,leaseExpiresAt:null}),201,{'Set-Cookie':`__Host-leapsign-v2-queue=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`});
   }
   const session=parseQueueSession(request.headers.get('Cookie'));if(!session)return json({code:'UNAUTHENTICATED'},401);const state=await deps.resolve(documentId,await hash(session));if(!state)return json({code:'UNAUTHENTICATED'},401);
   if(resource==='queue')return json(queuePresentation(state));
   await deps.reserve(state.actorId,'queue');
   if(request.method==='DELETE'){await deps.release(documentId,state.actorId);return json({ok:true});}
   const claimed=await deps.claim(documentId,state.actorId,await hash(`turn:${makeSession()}`));const headers=new Headers({...security,'Content-Type':'application/json'});headers.append('Set-Cookie',`__Host-leapsign-v2-guest=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);return new Response(JSON.stringify(claimed),{status:200,headers});
  }catch{return json({code:'ROUND_UNAVAILABLE'},409);}
 };
}
