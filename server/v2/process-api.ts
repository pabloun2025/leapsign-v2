import {MAX_PDF_BYTES,V2_STAGING_ORIGIN,assertV2Origin} from '../../src/v2/policy';

export type PublicProcess={id:string;filename:string;status:'ready_for_signer'|'final_review'|'completed'|'failed';signerCount:number};
export type ProcessStatus={id:string;filename:string;status:PublicProcess['status'];signatureCount:number;stages:Array<{ordinal:number;status:'ready_for_signer'|'validated';current:boolean}>};
export interface ProcessDependencies{
 origin?:string;
 authenticate(request:Request):Promise<string|null>;
 clientRateKey(request:Request):Promise<string>;
 reserve(actor:string,operation:'create'|'status'|'download'|'finalize'):Promise<void>;
 create(input:{ownerId:string;clientIpHash:string;filename:string;pdf:Uint8Array;signers:string[]}):Promise<PublicProcess>;
 status(documentId:string,actor:string):Promise<ProcessStatus>;
 download(documentId:string,actor:string):Promise<{filename:string;pdf:Uint8Array}>;
 finalize(documentId:string,actor:string):Promise<ProcessStatus>;
}
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json'}});
const uuid=(value:string)=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const filename=(value:unknown):value is string=>typeof value==='string'&&/^[^\r\n/\\]{1,124}\.pdf$/i.test(value);
const statuses=['ready_for_signer','final_review','completed','failed'];
function publicProcess(value:unknown):PublicProcess{if(!record(value)||!exact(value,['id','filename','status','signerCount'])||typeof value.id!=='string'||!uuid(value.id)||!filename(value.filename)||!statuses.includes(String(value.status))||!Number.isInteger(value.signerCount)||Number(value.signerCount)<1||Number(value.signerCount)>20)throw Error();return value as PublicProcess;}
function processStatus(value:unknown):ProcessStatus{if(!record(value)||!exact(value,['id','filename','status','signatureCount','stages'])||typeof value.id!=='string'||!uuid(value.id)||!filename(value.filename)||!statuses.includes(String(value.status))||!Number.isInteger(value.signatureCount)||Number(value.signatureCount)<0||Number(value.signatureCount)>20||!Array.isArray(value.stages)||value.stages.length<1||value.stages.length>20)throw Error();if(!value.stages.every((stage,index)=>record(stage)&&exact(stage,['ordinal','status','current'])&&stage.ordinal===index+1&&['ready_for_signer','validated'].includes(String(stage.status))&&typeof stage.current==='boolean')||value.stages.filter(stage=>record(stage)&&stage.current===true).length>1)throw Error();return value as ProcessStatus;}
async function pdfBody(request:Request){
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/pdf'||!request.body)throw Error();
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;const signal=AbortSignal.any([request.signal,AbortSignal.timeout(15_000)]);let abort!:()=>void;
 const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(Error());};signal.addEventListener('abort',abort,{once:true});});
 try{if(signal.aborted)abort();while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.length;if(size>MAX_PDF_BYTES)throw Error();chunks.push(value);}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}if(result.length<5||new TextDecoder().decode(result.subarray(0,5))!=='%PDF-')throw Error();return result;}
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function metadata(request:Request){
 const rawFilename=request.headers.get('X-LeapSign-Filename')??'';const rawSigners=request.headers.get('X-LeapSign-Signers')??'';
 let filename:string,signers:unknown;
 try{filename=decodeURIComponent(rawFilename);const binary=atob(rawSigners.replace(/-/g,'+').replace(/_/g,'/'));signers=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,char=>char.charCodeAt(0))));}catch{throw Error();}
 if(!/^[^\r\n/\\]{1,124}\.pdf$/i.test(filename)||!Array.isArray(signers)||signers.length<1||signers.length>20||!signers.every(value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))||new Set(signers.map(value=>String(value).toLowerCase())).size!==signers.length)throw Error();
 return{filename,signers:signers.map(value=>String(value).toLowerCase())};
}
export function createProcessHandler(deps:ProcessDependencies){
 const origin=deps.origin??V2_STAGING_ORIGIN;assertV2Origin(origin);
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);if(url.origin!==origin||url.search)return json({code:'NOT_FOUND'},404);
  const match=/^\/api\/v2\/processes\/([a-f0-9-]{36})(\/pdf|\/finalize)?$/.exec(url.pathname);const creating=url.pathname==='/api/v2/processes'&&request.method==='POST';const finalizing=Boolean(match?.[2]==='/finalize'&&request.method==='POST');
  if(!creating&&!finalizing&&!(match&&match[2]!=='/finalize'&&request.method==='GET'))return json({code:'NOT_FOUND'},404);
  if(request.headers.get('X-LeapSign-Client')!=='v2'||((creating||finalizing)&&(request.headers.get('Origin')!==origin||(request.headers.has('Sec-Fetch-Site')&&request.headers.get('Sec-Fetch-Site')!=='same-origin'))))return json({code:'FORBIDDEN'},403);
  try{const actor=await deps.authenticate(request);if(!actor)return json({code:'UNAUTHENTICATED'},401);
   if(creating){await deps.reserve(actor,'create');const meta=metadata(request);const clientIpHash=await deps.clientRateKey(request);if(!/^[a-f0-9]{64}$/.test(clientIpHash))throw Error();const pdf=await pdfBody(request);return json(publicProcess(await deps.create({ownerId:actor,clientIpHash,...meta,pdf})),201);}
   const id=match![1];if(!uuid(id))throw Error();if(finalizing){await deps.reserve(actor,'finalize');return json(processStatus(await deps.finalize(id,actor)));}if(match![2]){await deps.reserve(actor,'download');const value=await deps.download(id,actor);if(!/^[^\r\n/\\]{1,124}\.pdf$/i.test(value.filename)||!(value.pdf instanceof Uint8Array)||value.pdf.length>MAX_PDF_BYTES)throw Error();return new Response(new Uint8Array(value.pdf),{headers:{...security,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(value.filename)}`}});}
   await deps.reserve(actor,'status');return json(processStatus(await deps.status(id,actor)));
  }catch{return json({code:'NOT_FOUND'},404);}
 };
}
