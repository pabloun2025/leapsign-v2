import type {SignatureValidationResult} from '../../../src/v2/contracts';
import {MAX_PDF_BYTES, assertV2Origin} from '../../../src/v2/policy';
import {isPublicValidationReport} from '../../../src/v2/public-data';
import {isProcessId, validateSignerEmails} from './model';

export type FunctionalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type CreatedProcess = {
  id: string;
  filename: string;
  status: 'ready_for_signer' | 'final_review' | 'completed' | 'failed';
  signerCount: number;
};
export type ProcessStatus = {
  id: string;
  filename: string;
  status: CreatedProcess['status'];
  signatureCount: number;
  stages: Array<{ordinal: number; status: 'ready_for_signer' | 'validated'; current: boolean}>;
};
export type Receipt =
  | {state: 'validated'; report: SignatureValidationResult}
  | {state: 'signature_intent_issued' | 'signed_pending_validation' | 'rejected' | 'expired' | 'failed'};
export type PublicVerification={processId:string;receiptId:string;signedSha256:string;signer:string;validatedAt:string;accepted:true;checks:SignatureValidationResult['checks'];revocation:'good';legalOutcome:'not_determined_by_software'};
export type GuestSession={actorId:string;documentId:string;email:string};
export type AdminUser={id:string;email:string;status:'active'|'suspended'|'unconfirmed';createdAt:string;lastSignInAt:string|null};
export type AdminAudit={id:number;administratorId:string;action:string;targetUserId:string|null;targetEmail:string|null;createdAt:string};

export class FunctionalClientError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'ABORTED') {
    super(code);
  }
}
type ClientOptions = {origin: string; fetch?: FunctionalFetch; timeoutMs?: number};
const exact = (value: object, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const filenamePattern = /^[^\r\n/\\]{1,124}\.pdf$/i;

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createdProcess(value: unknown): CreatedProcess {
  if (!object(value) || !exact(value, ['id', 'filename', 'status', 'signerCount']) ||
      typeof value.id !== 'string' || !isProcessId(value.id) ||
      typeof value.filename !== 'string' || !filenamePattern.test(value.filename) ||
      !['ready_for_signer', 'final_review', 'completed', 'failed'].includes(String(value.status)) ||
      !Number.isInteger(value.signerCount) || Number(value.signerCount) < 1 || Number(value.signerCount) > 20) {
    throw new FunctionalClientError('INVALID_RESPONSE');
  }
  return value as CreatedProcess;
}

function processStatus(value: unknown): ProcessStatus {
  if (!object(value) || !exact(value, ['id', 'filename', 'status', 'signatureCount', 'stages']) ||
      typeof value.id !== 'string' || !isProcessId(value.id) ||
      typeof value.filename !== 'string' || !filenamePattern.test(value.filename) ||
      !['ready_for_signer', 'final_review', 'completed', 'failed'].includes(String(value.status)) ||
      !Number.isInteger(value.signatureCount) || Number(value.signatureCount) < 0 || Number(value.signatureCount) > 20 ||
      !Array.isArray(value.stages) || value.stages.length < 1 || value.stages.length > 20) {
    throw new FunctionalClientError('INVALID_RESPONSE');
  }
  const stages = value.stages;
  if (!stages.every((stage, index) => object(stage) && exact(stage, ['ordinal', 'status', 'current']) &&
      stage.ordinal === index + 1 && ['ready_for_signer', 'validated'].includes(String(stage.status)) &&
      typeof stage.current === 'boolean') || stages.filter(stage => stage.current).length > 1) {
    throw new FunctionalClientError('INVALID_RESPONSE');
  }
  return value as ProcessStatus;
}

function receipt(value: unknown): Receipt {
  if (!object(value) || typeof value.state !== 'string') throw new FunctionalClientError('INVALID_RESPONSE');
  if (value.state === 'validated') {
    if (!exact(value, ['state', 'report']) || !isPublicValidationReport(value.report)) throw new FunctionalClientError('INVALID_RESPONSE');
    return value as Receipt;
  }
  if (!exact(value, ['state']) || !['signature_intent_issued', 'signed_pending_validation', 'rejected', 'expired', 'failed'].includes(value.state)) {
    throw new FunctionalClientError('INVALID_RESPONSE');
  }
  return value as Receipt;
}

export class FunctionalV2Client {
  private readonly fetcher: FunctionalFetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    assertV2Origin(options.origin);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new FunctionalClientError('INVALID_INPUT');
    }
  }

  private signal(caller?: AbortSignal) {
    return caller ? AbortSignal.any([caller, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
  }

  private async request(path: string, init: RequestInit, caller?: AbortSignal) {
    const signal = this.signal(caller);
    if (signal.aborted) throw new FunctionalClientError('ABORTED');
    try {
      const response = await this.fetcher(this.options.origin + path, {
        ...init,
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {...init.headers, 'X-LeapSign-Client': 'v2'},
      });
      if (response.redirected || !response.ok) {
        await response.body?.cancel();
        throw new FunctionalClientError(response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE');
      }
      return response;
    } catch (error) {
      if (error instanceof FunctionalClientError) throw error;
      throw new FunctionalClientError(signal.aborted ? 'ABORTED' : 'UNAVAILABLE');
    }
  }

  private async json(response: Response) {
    if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      await response.body?.cancel();
      throw new FunctionalClientError('INVALID_RESPONSE');
    }
    const text = await response.text();
    if (text.length > 65_536) throw new FunctionalClientError('INVALID_RESPONSE');
    try { return JSON.parse(text) as unknown; }
    catch { throw new FunctionalClientError('INVALID_RESPONSE'); }
  }

  async exchangeSession(accessToken: string, signal?: AbortSignal) {
    if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 8_000 || !/^[A-Za-z0-9._-]+$/.test(accessToken)) {
      throw new FunctionalClientError('INVALID_INPUT');
    }
    const value = await this.json(await this.request('/api/v2/session', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({accessToken}),
    }, signal));
    if (!object(value) || !exact(value, ['code']) || value.code !== 'SIGNED_IN') throw new FunctionalClientError('INVALID_RESPONSE');
  }

  async deleteSession(signal?: AbortSignal) {
    const value = await this.json(await this.request('/api/v2/session', {method: 'DELETE'}, signal));
    if (!object(value) || !exact(value, ['code']) || value.code !== 'SIGNED_OUT') throw new FunctionalClientError('INVALID_RESPONSE');
  }
  async restoreOwnerSession(signal?:AbortSignal){const value=await this.json(await this.request('/api/v2/session',{method:'GET'},signal));if(!object(value)||!exact(value,['code','id','email'])||value.code!=='SESSION'||typeof value.id!=='string'||!isProcessId(value.id)||typeof value.email!=='string'||value.email.length>254)throw new FunctionalClientError('INVALID_RESPONSE');return{id:value.id,email:value.email,accessToken:'server-session'};}

  private guestSession(value:unknown,code:'GUEST_SIGNED_IN'|'GUEST_SESSION'):GuestSession{
    if(!object(value)||!exact(value,['code','actorId','documentId','email'])||value.code!==code||typeof value.actorId!=='string'||!isProcessId(value.actorId)||typeof value.documentId!=='string'||!isProcessId(value.documentId)||typeof value.email!=='string'||value.email.length>254)return (()=>{throw new FunctionalClientError('INVALID_RESPONSE');})();
    return{actorId:value.actorId,documentId:value.documentId,email:value.email};
  }

  async exchangeGuest(invitation:string,signal?:AbortSignal){
    if(!/^invite_[A-Za-z0-9_-]{43}$/.test(invitation))throw new FunctionalClientError('INVALID_INPUT');
    return this.guestSession(await this.json(await this.request('/api/v2/guest-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation})},signal)),'GUEST_SIGNED_IN');
  }

  async restoreGuest(signal?:AbortSignal){return this.guestSession(await this.json(await this.request('/api/v2/guest-session',{method:'GET'},signal)),'GUEST_SESSION');}
  async deleteGuestSession(signal?:AbortSignal){await this.request('/api/v2/guest-session',{method:'DELETE'},signal);}

  async listAdminUsers(page=1,search='',signal?:AbortSignal){
    if(!Number.isInteger(page)||page<1||search.length>254)throw new FunctionalClientError('INVALID_INPUT');
    const query=new URLSearchParams({page:String(page),...(search?{search}:{})});const value=await this.json(await this.request(`/api/v2/admin/users?${query}`,{method:'GET'},signal));
    if(!object(value)||!exact(value,['users','page','total'])||!Array.isArray(value.users)||value.page!==page||!Number.isInteger(value.total)||!value.users.every(user=>object(user)&&exact(user,['id','email','status','createdAt','lastSignInAt'])&&typeof user.id==='string'&&isProcessId(user.id)&&typeof user.email==='string'&&['active','suspended','unconfirmed'].includes(String(user.status))&&typeof user.createdAt==='string'&&(user.lastSignInAt===null||typeof user.lastSignInAt==='string')))throw new FunctionalClientError('INVALID_RESPONSE');
    return value as {users:AdminUser[];page:number;total:number};
  }
  async inviteAdminUser(email:string,signal?:AbortSignal){if(email.length>254||!email.includes('@'))throw new FunctionalClientError('INVALID_INPUT');await this.request('/api/v2/admin/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})},signal);}
  async adminUserAction(id:string,action:'resend'|'recover'|'suspend'|'reactivate',signal?:AbortSignal){if(!isProcessId(id))throw new FunctionalClientError('INVALID_INPUT');await this.request(`/api/v2/admin/users/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},signal);}
  async listAdminAudit(page=1,signal?:AbortSignal){const value=await this.json(await this.request(`/api/v2/admin/audit?page=${page}`,{method:'GET'},signal));if(!object(value)||!exact(value,['events','page'])||value.page!==page||!Array.isArray(value.events)||!value.events.every(event=>object(event)&&exact(event,['id','administratorId','action','targetUserId','targetEmail','createdAt'])&&Number.isInteger(event.id)&&typeof event.administratorId==='string'&&typeof event.action==='string'&&typeof event.createdAt==='string'))throw new FunctionalClientError('INVALID_RESPONSE');return value.events as AdminAudit[];}

  async createProcess(input: {pdf: File; signers: string[]}, signal?: AbortSignal) {
    const checked = validateSignerEmails(input.signers);
    if (!checked.ok || !(input.pdf instanceof File) || !filenamePattern.test(input.pdf.name) ||
        input.pdf.size < 5 || input.pdf.size > MAX_PDF_BYTES || (input.pdf.type && input.pdf.type !== 'application/pdf')) {
      throw new FunctionalClientError('INVALID_INPUT');
    }
    const pdf = new Uint8Array(await input.pdf.arrayBuffer());
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') throw new FunctionalClientError('INVALID_INPUT');
    const value = await this.json(await this.request('/api/v2/processes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-LeapSign-Filename': encodeURIComponent(input.pdf.name),
        'X-LeapSign-Signers': base64Url(JSON.stringify(checked.emails)),
      },
      body: pdf,
    }, signal));
    return createdProcess(value);
  }

  async getProcess(id: string, signal?: AbortSignal) {
    if (!isProcessId(id)) throw new FunctionalClientError('INVALID_INPUT');
    return processStatus(await this.json(await this.request(`/api/v2/processes/${id.toLowerCase()}`, {method: 'GET'}, signal)));
  }

  async finalizeProcess(id:string,signal?:AbortSignal){
    if(!isProcessId(id))throw new FunctionalClientError('INVALID_INPUT');
    return processStatus(await this.json(await this.request(`/api/v2/processes/${id.toLowerCase()}/finalize`,{method:'POST'},signal)));
  }

  processPdfUrl(id: string) {
    if (!isProcessId(id)) throw new FunctionalClientError('INVALID_INPUT');
    return `${this.options.origin}/api/v2/processes/${id.toLowerCase()}/pdf`;
  }

  async getReceipt(id: string, signal?: AbortSignal) {
    if (!isProcessId(id)) throw new FunctionalClientError('INVALID_INPUT');
    return receipt(await this.json(await this.request(`/api/v2/signing/intents/${id.toLowerCase()}/receipt`, {method: 'GET'}, signal)));
  }
  async getVerification(id:string,signal?:AbortSignal){
    if(!isProcessId(id))throw new FunctionalClientError('INVALID_INPUT');
    const value=await this.json(await this.request(`/api/v2/verifications/${id.toLowerCase()}`,{method:'GET'},signal));
    const names=['cryptographicIntegrity','cmsSignature','documentMatch','oneNewSignature','previousSignatures','chainBuilt','trusted','certificateValidity','revocation'];
    const checks=object(value)&&object(value.checks)?value.checks:undefined;
    if(!object(value)||!exact(value,['processId','receiptId','signedSha256','signer','validatedAt','accepted','checks','revocation','legalOutcome'])||typeof value.processId!=='string'||!isProcessId(value.processId)||value.receiptId!==id.toLowerCase()||typeof value.signedSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.signedSha256)||typeof value.signer!=='string'||typeof value.validatedAt!=='string'||!Number.isFinite(Date.parse(value.validatedAt))||value.accepted!==true||value.revocation!=='good'||value.legalOutcome!=='not_determined_by_software'||!checks||!exact(checks,names)||names.slice(0,-1).some(name=>checks[name]!=='passed')||checks.revocation!=='good')throw new FunctionalClientError('INVALID_RESPONSE');
    return value as PublicVerification;
  }
}
