import {describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {SigningWorkflow, type SigningWorkflowApi, type LocalSigner} from '../src/v2/signing-workflow';
import {issueIntent} from '../server/v2/intents';
import type {SignatureValidationResult} from '../src/v2/contracts';
const base = new TextEncoder().encode('%PDF-synthetic canonical');
const candidate = new TextEncoder().encode('%PDF-synthetic canonical\n% not a real signature');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const position = {page: 1, x: 320, y: 20, width: 250, height: 80};
const input = {documentId: 'document', profile: 'firmaec-qr-compatible' as const, position};
const certificate = () => new File(['synthetic-only'], 'test.p12');
const flags = {DIRECT_P12_SIGNING_ENABLED: 'true', EXTERNAL_SIGNATURE_ENABLED: 'true', FIRMAEC_COMPATIBILITY_PROFILE_ENABLED: 'true'};
function fixture(options: {flags?: typeof flags; localSigner?: LocalSigner} = {}) {
  const intent = issueIntent({documentId: 'document', versionId: 'v0', stageId: 'stage', signerId: 'person', role: 'approval', baseSha256: hash(base), pageCount: 1, pageWidth: 595, pageHeight: 842}, 'person', input.profile, position);
  const prepared = {intent, pdf: base, filename: 'Contrato.pdf', previousSignatureCount: 0};
  const report: SignatureValidationResult = {valid: true, policy: 'leapsign-v2-strict-offline-1', baseSha256: hash(base), signedSha256: hash(candidate), previousSignatureCount: 0, signatureCount: 1, revocation: 'good', certificate: {subject: 'Synthetic', issuer: 'Test only', serial: '1', fingerprint: 'a'.repeat(64), notBefore: new Date().toISOString(), notAfter: new Date(Date.now() + 86400_000).toISOString()}};
  const api: SigningWorkflowApi = {prepare: vi.fn(async () => prepared), submit: vi.fn(async () => report)};
  const localSigner = options.localSigner ?? vi.fn(async () => ({intentId: intent.id, pdf: candidate}));
  const flow = new SigningWorkflow({api, localSigner, flags: options.flags ?? flags, actorId: 'person', origin: 'https://leapsign.app'});
  return {flow, api, localSigner, intent, prepared, report};
}
describe('v2 UI workflow (mocks are not cryptographic evidence)', () => {
  it('is disabled by default, without any API or worker operation', async () => {
    const {api, flow, localSigner} = fixture({flags: {} as typeof flags});
    await expect(flow.prepare(input)).rejects.toMatchObject({code: 'DISABLED'});
    expect(api.prepare).not.toHaveBeenCalled(); expect(localSigner).not.toHaveBeenCalled();
  });
  it('does not run on the v1 origin', () => {
    const {api, localSigner} = fixture();
    expect(() => new SigningWorkflow({api, localSigner, flags, origin: 'https://firma.veryfacil.org', actorId: 'person'})).toThrow();
  });
  it('only sends the signed PDF, intent, nonce and hash to the API', async () => {
    const {flow, api} = fixture(); await flow.prepare(input);
    await flow.signLocal({certificate: certificate(), password: 'synthetic-secret', reason: 'Test', location: 'Lab'});
    const payload = vi.mocked(api.submit).mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['intentId', 'nonce', 'pdf', 'sha256']);
    expect(flow.getSnapshot().phase).toBe('validated');
    expect(JSON.stringify(flow.getSnapshot())).not.toContain('synthetic-secret');
    expect(flow.canonicalCopy()).toBeUndefined();
  });
  it.each(['actor', 'hash', 'position', 'expiry', 'filename', 'count'])('rejects invalid preparation: %s', async kind => {
    const {flow, prepared} = fixture();
    if (kind === 'actor') prepared.intent.signerId = 'other';
    if (kind === 'hash') prepared.intent.baseSha256 = '0'.repeat(64);
    if (kind === 'position') prepared.intent.position = {...position, x: 0};
    if (kind === 'expiry') prepared.intent.expiresAt = new Date(0).toISOString();
    if (kind === 'filename') prepared.filename = '../file.pdf';
    if (kind === 'count') prepared.previousSignatureCount = 20;
    await expect(flow.prepare(input)).rejects.toMatchObject({code: 'PREPARATION_FAILED'});
    expect(flow.canonicalCopy()).toBeUndefined();
  });
  it('blocks repeated clicks while the worker is running', async () => {
    let finish!: (value: {intentId: string; pdf: Uint8Array}) => void;
    const localSigner = vi.fn(() => new Promise<{intentId: string; pdf: Uint8Array}>(resolve => {finish = resolve;}));
    const {flow, api, intent} = fixture({localSigner}); await flow.prepare(input);
    const pending = flow.signLocal({certificate: certificate(), password: '', reason: '', location: ''});
    await vi.waitFor(() => expect(localSigner).toHaveBeenCalledOnce());
    await expect(flow.submitExternal(candidate)).rejects.toMatchObject({code: 'BUSY'});
    finish({intentId: intent.id, pdf: candidate}); await pending;
    expect(api.submit).toHaveBeenCalledOnce();
  });
  it('cancellation prevents a late worker result being submitted', async () => {
    let finish!: (value: {intentId: string; pdf: Uint8Array}) => void;
    const localSigner = vi.fn(() => new Promise<{intentId: string; pdf: Uint8Array}>(resolve => {finish = resolve;}));
    const {flow, api, intent} = fixture({localSigner}); await flow.prepare(input);
    const pending = flow.signLocal({certificate: certificate(), password: '', reason: '', location: ''});
    await vi.waitFor(() => expect(localSigner).toHaveBeenCalledOnce());
    expect(flow.cancel()).toBe(true); finish({intentId: intent.id, pdf: candidate});
    await expect(pending).rejects.toMatchObject({code: 'CANCELLED'});
    expect(flow.getSnapshot().phase).toBe('cancelled'); expect(api.submit).not.toHaveBeenCalled();
  });
  it('does not promise cancellation once a server submission has started', async () => {
    const {flow, api, report} = fixture();
    let finish!: (value: SignatureValidationResult) => void;
    vi.mocked(api.submit).mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    await flow.prepare(input); const pending = flow.submitExternal(candidate);
    await vi.waitFor(() => expect(flow.getSnapshot().phase).toBe('validating'));
    expect(flow.cancel()).toBe(false); finish(report); await pending;
    expect(flow.getSnapshot().phase).toBe('validated');
  });
  it('does not auto-retry an uncertain submission or reuse its intent', async () => {
    const {flow, api} = fixture(); vi.mocked(api.submit).mockRejectedValue(Error('internal private detail'));
    await flow.prepare(input);
    await expect(flow.submitExternal(candidate)).rejects.toMatchObject({code: 'SUBMISSION_UNCONFIRMED'});
    expect(flow.getSnapshot().message).not.toContain('private');
    expect(api.submit).toHaveBeenCalledOnce(); expect(flow.canonicalCopy()).toBeUndefined();
    await expect(flow.prepare(input)).rejects.toMatchObject({code: 'SUBMISSION_UNCONFIRMED'});
    expect(api.prepare).toHaveBeenCalledOnce();
  });
  it('does not accept a report for a different hash', async () => {
    const {flow, report} = fixture(); report.signedSha256 = '0'.repeat(64); await flow.prepare(input);
    await expect(flow.submitExternal(candidate)).rejects.toMatchObject({code: 'SIGNATURE_REJECTED'});
    expect(flow.getSnapshot().phase).toBe('failed');
  });
  it('rejects changed bytes before any API submission', async () => {
    const {flow, api} = fixture(); await flow.prepare(input);
    await expect(flow.submitExternal(new TextEncoder().encode('%PDF-unrelated longer document'))).rejects.toMatchObject({code: 'DOCUMENT_MISMATCH'});
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('allows correcting a local certificate failure without consuming an intent', async () => {
    const {flow, api, localSigner} = fixture(); await flow.prepare(input);
    await expect(flow.signLocal({certificate: new File(['bad'], 'bad.txt'), password: '', reason: '', location: ''})).rejects.toMatchObject({code: 'CERTIFICATE_INVALID'});
    expect(flow.getSnapshot().phase).toBe('ready'); expect(api.submit).not.toHaveBeenCalled(); expect(localSigner).not.toHaveBeenCalled();
  });
});
