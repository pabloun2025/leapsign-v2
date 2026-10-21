export type GuestExchange={actorId:string;documentId:string;email:string;expiresAt:string};
export interface GuestSessionDependencies{
 exchange(invitationHash:string,sessionHash:string,signal:AbortSignal):Promise<GuestExchange|null>;
 resolve?(request:Request,signal:AbortSignal):Promise<GuestExchange|null>;
 randomBytes?:()=>Uint8Array;
}

const headers={'Cache-Control':'no-store','Content-Type':'application/json','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(code:string,status:number,value:Record<string,unknown>={})=>new Response(JSON.stringify({code,...value}),{status,headers});
const tokenPattern=/^invite_[A-Za-z0-9_-]{43}$/;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bytesToHex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const bytesToBase64Url=(bytes:Uint8Array)=>{
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
async function digest(value:string){return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
function secureRandom(){const value=new Uint8Array(32);crypto.getRandomValues(value);return value;}
async function boundedText(request:Request){if(!request.body)throw Error();const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>512)throw Error();chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}

export function createGuestSessionHandler(deps:GuestSessionDependencies,origin:string){
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  if(url.origin!==origin||url.pathname!=='/api/v2/guest-session'||url.search||!['GET','POST','DELETE'].includes(request.method))return json('NOT_FOUND',404);
  if(request.headers.get('X-LeapSign-Client')!=='v2'||(request.method!=='GET'&&request.headers.get('Origin')!==origin)||
    (request.headers.has('Sec-Fetch-Site')&&!['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')!)))return json('FORBIDDEN',403);
  if(request.method==='DELETE')return new Response(JSON.stringify({code:'GUEST_SIGNED_OUT'}),{headers:{...headers,'Set-Cookie':'__Host-leapsign-v2-guest=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'}});
  if(request.method==='GET'){
   const active=await deps.resolve?.(request,AbortSignal.any([request.signal,AbortSignal.timeout(5_000)]));
   return active?json('GUEST_SESSION',200,{actorId:active.actorId,documentId:active.documentId,email:active.email}):json('UNAUTHENTICATED',401);
  }
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json('INVALID_REQUEST',400);
  try{
   const raw=await boundedText(request);
   const value:unknown=JSON.parse(raw);
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='invitation')throw Error();
   const invitation=(value as {invitation?:unknown}).invitation;if(typeof invitation!=='string'||!tokenPattern.test(invitation))throw Error();
   const session=bytesToBase64Url((deps.randomBytes??secureRandom)());if(!/^[A-Za-z0-9_-]{43}$/.test(session))throw Error();
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5_000)]);
   const exchanged=await deps.exchange(await digest(invitation),await digest(session),signal);
   if(!exchanged)return json('INVITATION_UNAVAILABLE',410);
   const expires=Date.parse(exchanged.expiresAt);
   if(!uuid.test(exchanged.actorId)||!uuid.test(exchanged.documentId)||!email.test(exchanged.email)||!Number.isFinite(expires)||expires<=Date.now())throw Error();
   const maxAge=Math.max(1,Math.min(86_400,Math.floor((expires-Date.now())/1000)));
   return new Response(JSON.stringify({code:'GUEST_SIGNED_IN',actorId:exchanged.actorId,documentId:exchanged.documentId,email:exchanged.email}),{status:200,headers:{...headers,'Set-Cookie':`__Host-leapsign-v2-guest=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`}});
  }catch{return json('INVALID_REQUEST',400);}
 };
}
