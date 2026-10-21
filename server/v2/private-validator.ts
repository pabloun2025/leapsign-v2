import {createHash} from 'node:crypto';
import type {SigningIntent, SignatureValidationResult} from '../../src/v2/contracts';
import {signingFlags, MAX_PDF_BYTES, type SigningFlags} from '../../src/v2/policy';
import {assertValidationReport, SigningError, type PrivatePdfValidator} from './intents';
import {isPublicValidationReport} from '../../src/v2/public-data';

export type PreparedPdf={pdf:Uint8Array;sha256:string;byteSize:number;pageCount:number;lastPageWidth:number;lastPageHeight:number;signatureCount:number};

/** Server-only adapter. beforeValidation MUST reserve the shared atomic request
 * and validation budgets. There is deliberately no unmetered default. */
export class OfflineValidatorClient implements PrivatePdfValidator {
  constructor(private readonly config: {
    flags: SigningFlags; url: string; serviceToken: string;
    beforeValidation: () => Promise<void>; fetch: typeof fetch;
  }) {}

  async prepare(pdf:Uint8Array):Promise<PreparedPdf>{
    const flags=signingFlags(this.config.flags);
    if((!flags.external&&!flags.direct)||!flags.firmaecProfile)throw new SigningError('V2_DISABLED');
    const configured=new URL(this.config.url);
    if((configured.protocol!=='https:'&&!(configured.protocol==='http:'&&configured.hostname==='127.0.0.1'))||configured.username||configured.password||configured.search||configured.hash||configured.pathname!=='/validate'||this.config.serviceToken.length<32)throw new SigningError('VALIDATOR_CONFIGURATION_REQUIRED');
    if(!(pdf instanceof Uint8Array)||pdf.length<5||pdf.length>MAX_PDF_BYTES||new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw new SigningError('DOCUMENT_MISMATCH');
    await this.config.beforeValidation();
    const target=new URL('/prepare',configured);
    const response=await this.config.fetch(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${this.config.serviceToken}`,'Content-Type':'application/json'},body:JSON.stringify({pdf:Buffer.from(pdf).toString('base64')})});
    if(!response.ok||!response.body||response.redirected||response.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new SigningError('PREPARATION_UNAVAILABLE');
    const limit=15*1024*1024;const length=response.headers.get('Content-Length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw new SigningError('INVALID_PREPARATION_REPORT');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new SigningError('INVALID_PREPARATION_REPORT');}chunks.push(value);}}finally{reader.releaseLock();}
    let value:unknown;
    try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SigningError('INVALID_PREPARATION_REPORT');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new SigningError('INVALID_PREPARATION_REPORT');
    const result=value as Record<string,unknown>;const keys=['pdf','sha256','byteSize','pageCount','lastPageWidth','lastPageHeight','signatureCount'];
    if(Object.keys(result).sort().join(',')!==keys.sort().join(',')||typeof result.pdf!=='string'||result.pdf.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.pdf)||typeof result.sha256!=='string'||!/^[a-f0-9]{64}$/.test(result.sha256)||!Number.isInteger(result.byteSize)||!Number.isInteger(result.pageCount)||!Number.isInteger(result.signatureCount)||![result.lastPageWidth,result.lastPageHeight].every(item=>typeof item==='number'&&Number.isFinite(item)))throw new SigningError('INVALID_PREPARATION_REPORT');
    const canonical=Buffer.from(result.pdf,'base64');
    if(canonical.toString('base64')!==result.pdf||canonical.length!==result.byteSize||canonical.length<5||canonical.length>MAX_PDF_BYTES||canonical.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(canonical).digest('hex')!==result.sha256||Number(result.pageCount)<1||Number(result.pageCount)>500||Number(result.signatureCount)<0||Number(result.signatureCount)>20||Number(result.lastPageWidth)<=0||Number(result.lastPageWidth)>14400||Number(result.lastPageHeight)<=0||Number(result.lastPageHeight)>14400)throw new SigningError('INVALID_PREPARATION_REPORT');
    return{pdf:new Uint8Array(canonical),sha256:result.sha256,byteSize:Number(result.byteSize),pageCount:Number(result.pageCount),lastPageWidth:Number(result.lastPageWidth),lastPageHeight:Number(result.lastPageHeight),signatureCount:Number(result.signatureCount)};
  }

  async validate(canonical: Uint8Array, signed: Uint8Array, intent: SigningIntent): Promise<SignatureValidationResult> {
    const flags = signingFlags(this.config.flags);
    if ((!flags.external && !flags.direct) || !flags.firmaecProfile) throw new SigningError('V2_DISABLED');
    const url = new URL(this.config.url);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash || url.pathname !== '/validate' || this.config.serviceToken.length < 32) throw new SigningError('VALIDATOR_CONFIGURATION_REQUIRED');
    if (canonical.length > MAX_PDF_BYTES || signed.length > MAX_PDF_BYTES) throw new SigningError('DOCUMENT_TOO_LARGE');
    await this.config.beforeValidation();
    const response = await this.config.fetch(url, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(20_000),
      headers:{'Authorization':`Bearer ${this.config.serviceToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({previous:Buffer.from(canonical).toString('base64'),candidate:Buffer.from(signed).toString('base64'),baseSha256:intent.baseSha256,position:intent.position,...(intent.expectedFingerprint ? {expectedFingerprint:intent.expectedFingerprint} : {})}),
    });
    if (!response.ok || !response.body) throw new SigningError('VALIDATION_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size=0;
    try {
      while (true) {
        const {done,value}=await reader.read(); if(done)break;
        size+=value.byteLength;
        if(size>65536){await reader.cancel();throw new SigningError('INVALID_VALIDATION_REPORT');}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const data=Buffer.concat(chunks).toString('utf8');
    let report: SignatureValidationResult;
    try {report=JSON.parse(data);} catch {throw new SigningError('INVALID_VALIDATION_REPORT');}
    // Enforce the public-only audit shape; no arbitrary validator error dump.
    if (!isPublicValidationReport(report)) throw new SigningError('INVALID_VALIDATION_REPORT');
    if(report.accepted)assertValidationReport(intent,createHash('sha256').update(signed).digest('hex'),report);
    return report;
  }
}
