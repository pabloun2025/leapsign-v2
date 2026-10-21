import type {ValidationChecks} from '../../src/v2/contracts';
import {V2_STAGING_ORIGIN,assertV2Origin} from '../../src/v2/policy';

export type PublicVerification={processId:string;receiptId:string;signedSha256:string;signer:string;validatedAt:string;accepted:true;checks:ValidationChecks;revocation:'good';legalOutcome:'not_determined_by_software'};
export interface VerificationDependencies{origin?:string;authenticate(request:Request):Promise<string|null>;reserve(actor:string,operation:'receipt'):Promise<void>;load(receiptId:string,actor:string):Promise<PublicVerification>;}
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json'}});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function publicValue(value:unknown):PublicVerification{
 if(!object(value)||Object.keys(value).sort().join(',')!==['accepted','checks','legalOutcome','processId','receiptId','revocation','signedSha256','signer','validatedAt'].sort().join(',')||!uuid(value.processId)||!uuid(value.receiptId)||!hash(value.signedSha256)||typeof value.signer!=='string'||value.signer.length<1||value.signer.length>4096||typeof value.validatedAt!=='string'||!Number.isFinite(Date.parse(value.validatedAt))||value.accepted!==true||value.revocation!=='good'||value.legalOutcome!=='not_determined_by_software'||!object(value.checks))throw Error();
 const checks=value.checks;const names=['cryptographicIntegrity','cmsSignature','documentMatch','oneNewSignature','previousSignatures','chainBuilt','trusted','certificateValidity','revocation'];
 if(Object.keys(checks).sort().join(',')!==[...names].sort().join(',')||names.slice(0,-1).some(name=>checks[name]!=='passed')||checks.revocation!=='good')throw Error();
 return value as PublicVerification;
}
export function createVerificationHandler(deps:VerificationDependencies){
 const origin=deps.origin??V2_STAGING_ORIGIN;assertV2Origin(origin);
 return async(request:Request)=>{const url=new URL(request.url);const match=/^\/api\/v2\/verifications\/([a-f0-9-]{36})$/.exec(url.pathname);if(url.origin!==origin||url.search||request.method!=='GET'||!match)return json({code:'NOT_FOUND'},404);if(request.headers.get('X-LeapSign-Client')!=='v2')return json({code:'FORBIDDEN'},403);try{const actor=await deps.authenticate(request);if(!actor)return json({code:'UNAUTHENTICATED'},401);await deps.reserve(actor,'receipt');return json(publicValue(await deps.load(match[1],actor)));}catch{return json({code:'NOT_FOUND'},404);}};
}
