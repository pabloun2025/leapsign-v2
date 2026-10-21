export type EmailKind='account_created'|'confirmation_pending'|'recovery'|'signer_invitation'|'signer_turn'|'signer_reminder'|'signature_received'|'process_blocked'|'process_completed'|'final_review'|'receipt'|'final_download'|'account_sensitive';
export type OutboxJob={id:string;kind:EmailKind;recipient:string;data:{documentName?:string;actionUrl:string};attempts:number};
export type RenderedEmail={from:string;replyTo:string;to:string;subject:string;html:string;text:string};
const FROM='LeapSign <no-reply@notificaciones.leapsign.app>';
const REPLY_TO='soporte@leapsign.app';
const TITLES:Record<EmailKind,string>={account_created:'Tu cuenta LeapSign',confirmation_pending:'Confirma tu correo',recovery:'Recupera tu acceso',signer_invitation:'Te invitaron a firmar',signer_turn:'Llegó tu turno de firma',signer_reminder:'Tu invitación está por expirar',signature_received:'Firma recibida',process_blocked:'El proceso necesita atención',process_completed:'Proceso completado',final_review:'Revisión final disponible',receipt:'Recibo de firma disponible',final_download:'Documento final disponible',account_sensitive:'Aviso de seguridad de tu cuenta'};
const escape=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
function actionUrl(value:string){const url=new URL(value);if(url.origin!=='https://pruebas.leapsign.app'||url.username||url.password||url.hash)return null;return url.toString();}

export function renderEmail(job:Pick<OutboxJob,'kind'|'recipient'|'data'>):RenderedEmail{
 const title=TITLES[job.kind];const url=actionUrl(job.data.actionUrl);if(!title||!url||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.recipient)||job.recipient.length>254)throw Error('INVALID_EMAIL_JOB');
 const documentName=(job.data.documentName??'tu documento').slice(0,124);
 const safeTitle=escape(title),safeDocument=escape(documentName),safeUrl=escape(url);
 return{from:FROM,replyTo:REPLY_TO,to:job.recipient,subject:title,html:`<!doctype html><html lang="es"><body style="margin:0;background:#f8f9f6;color:#17342c;font-family:Avenir Next,Segoe UI,sans-serif"><div style="max-width:600px;margin:auto;padding:32px 20px"><div style="font-size:24px;font-weight:700">LeapSign</div><div style="margin-top:24px;padding:28px;background:#fff;border:1px solid #dce6e0;border-radius:20px"><h1 style="font-size:28px">${safeTitle}</h1><p>${safeDocument}</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#145845;color:#fff;text-decoration:none;border-radius:9px">Continuar en LeapSign</a></p><p style="color:#52665c;font-size:13px">LeapSign procesa la firma técnica; no declara por sí solo validez jurídica. No reenvíes este enlace.</p></div></div></body></html>`,text:`LeapSign\n\n${title}\n${documentName}\n\nContinuar: ${url}\n\nNo reenvíes este enlace. LeapSign no declara por sí solo validez jurídica.`};
}

type OutboxDependencies={
 claim(limit:number):Promise<OutboxJob[]>;
 markSent(id:string,providerId:string):Promise<void>|void;
 markFailed(id:string,attempts:number,deadLetter:boolean,errorCode:string):Promise<void>|void;
 deliver(message:RenderedEmail,apiKey:string,idempotencyKey:string):Promise<{id:string}>;
};
export async function processOutboxBatch(deps:OutboxDependencies,apiKey:string){
 if(!apiKey||apiKey.length>4096)throw Error('EMAIL_CONFIGURATION_REQUIRED');
 const jobs=await deps.claim(20);
 await Promise.all(jobs.map(async job=>{
  try{const result=await deps.deliver(renderEmail(job),apiKey,job.id);if(!/^[A-Za-z0-9_-]{1,200}$/.test(result.id))throw Error();await deps.markSent(job.id,result.id);}
  catch{const attempts=job.attempts+1;await deps.markFailed(job.id,attempts,attempts>=8,'PROVIDER_UNAVAILABLE');}
 }));
}

function constantTime(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let difference=0;for(let index=0;index<a.length;index++)difference|=a[index]^b[index];return difference===0;}
function fromBase64(value:string){try{return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}catch{return new Uint8Array();}}
export async function verifyResendWebhook(body:Uint8Array,headers:{id:string;timestamp:string;signature:string},secret:string,now=Date.now()){
 try{
  const timestamp=Number(headers.timestamp);if(!Number.isInteger(timestamp)||Math.abs(now/1000-timestamp)>300||body.length>65_536||!secret.startsWith('whsec_'))return false;
  const key=fromBase64(secret.slice(6));if(key.length<6)return false;
  const signed=new Uint8Array(new TextEncoder().encode(`${headers.id}.${headers.timestamp}.`).length+body.length);const prefix=new TextEncoder().encode(`${headers.id}.${headers.timestamp}.`);signed.set(prefix);signed.set(body,prefix.length);
  const cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);const expected=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,signed));
  return headers.signature.split(' ').some(item=>{const [version,value]=item.split(',');return version==='v1'&&constantTime(expected,fromBase64(value??''));});
 }catch{return false;}
}
