import {createHash} from 'node:crypto';
import type {SigningIntent, SignatureValidationResult} from '../../src/v2/contracts';
import {signingFlags, MAX_PDF_BYTES, type SigningFlags} from '../../src/v2/policy';
import {assertValidationReport, SigningError, type PrivatePdfValidator} from './intents';

/** Server-only adapter. beforeValidation MUST reserve the shared atomic request
 * and validation budgets. There is deliberately no unmetered default. */
export class OfflineValidatorClient implements PrivatePdfValidator {
  constructor(private readonly config: {
    flags: SigningFlags; url: string; serviceToken: string;
    beforeValidation: () => Promise<void>; fetch: typeof fetch;
  }) {}

  async validate(canonical: Uint8Array, signed: Uint8Array, intent: SigningIntent): Promise<SignatureValidationResult> {
    if (!signingFlags(this.config.flags).external || !signingFlags(this.config.flags).firmaecProfile) throw new SigningError('V2_DISABLED');
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
    if (!report || typeof report!=='object' || Object.keys(report).some(key=>!['valid','policy','baseSha256','signedSha256','previousSignatureCount','signatureCount','certificate','revocation'].includes(key))) throw new SigningError('INVALID_VALIDATION_REPORT');
    const cert=report.certificate;
    if (!cert || Object.keys(cert).some(key=>!['subject','issuer','serial','notBefore','notAfter','fingerprint'].includes(key)) ||
        !['subject','issuer','serial','notBefore','notAfter','fingerprint'].every(key=>typeof cert[key as keyof typeof cert]==='string' && cert[key as keyof typeof cert].length<=4096)) throw new SigningError('INVALID_VALIDATION_REPORT');
    assertValidationReport(intent,createHash('sha256').update(signed).digest('hex'),report);
    return report;
  }
}
