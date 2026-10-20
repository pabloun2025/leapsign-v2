import {describe, expect, it, vi} from 'vitest';
import {V2HttpSigningApi} from '../src/v2/http-api';
import {issueIntent} from '../server/v2/intents';
const flags = {EXTERNAL_SIGNATURE_ENABLED: 'true', FIRMAEC_COMPATIBILITY_PROFILE_ENABLED: 'true'};
const position = {page: 1, x: 320, y: 20, width: 250, height: 80};
const input = {documentId: 'd', profile: 'firmaec-qr-compatible' as const, position};
function metadata() {
  const intent = issueIntent({documentId: 'd', versionId: 'v', stageId: 's', signerId: 'p', role: 'approval', baseSha256: 'a'.repeat(64), pageCount: 1, pageWidth: 595, pageHeight: 842}, 'p', input.profile, position);
  return {intent, filename: 'Acuerdo.pdf', previousSignatureCount: 0, pdfPath: `/api/v2/signing/intents/${intent.id}/pdf`};
}
const report = () => ({valid: true, policy: 'leapsign-v2-strict-offline-1', baseSha256: 'a'.repeat(64), signedSha256: 'b'.repeat(64), previousSignatureCount: 0, signatureCount: 1, revocation: 'good', certificate: {subject: 'Test', issuer: 'Synthetic CA', serial: '1', fingerprint: 'c'.repeat(64), notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z'}});
const signal = () => new AbortController().signal;
const api = (fetcher: typeof fetch, extra = {}) => new V2HttpSigningApi({origin: 'https://leapsign.app', flags, fetch: fetcher, ...extra});
describe('v2 HTTP transport: no live services', () => {
  it('makes no requests when disabled', async () => {
    const fetcher = vi.fn(); await expect(api(fetcher, {flags: {}}).prepare(input, signal())).rejects.toMatchObject({code: 'DISABLED'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses v1 and arbitrary origins', () => {
    expect(() => api(vi.fn(), {origin: 'https://firma.veryfacil.org'})).toThrow();
    expect(() => api(vi.fn(), {origin: 'https://attacker.invalid'})).toThrow();
  });
  it('only sends whitelisted preparation data and fetches its bound PDF', async () => {
    const value = metadata();
    const fetcher = vi.fn(async (url, init) => {
      expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store');
      if (String(url).endsWith('/prepare')) {
        expect(JSON.parse(String(init?.body))).toEqual(input); return Response.json(value);
      }
      expect(String(url)).toBe('https://leapsign.app' + value.pdfPath);
      return new Response('%PDF-synthetic', {headers: {'Content-Type': 'application/pdf'}});
    }) as typeof fetch;
    const result = await api(fetcher).prepare({...input, password: 'must not travel', certificate: 'must not travel'} as typeof input, signal());
    expect(result.filename).toBe('Acuerdo.pdf'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['https://attacker.invalid/pdf', '/api/v2/signing/intents/other/pdf', '/api/v2/signing/intents/../pdf', '/private.pdf?token=x'])('rejects unbound PDF URL %s', async pdfPath => {
    const fetcher = vi.fn(async () => Response.json({...metadata(), pdfPath}));
    await expect(api(fetcher).prepare(input, signal())).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects arbitrary extra fields before downloading a PDF', async () => {
    const value = metadata(); const fetcher = vi.fn(async () => Response.json({...value, password: 'unexpected'}));
    await expect(api(fetcher).prepare(input, signal())).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('only uploads raw PDF bytes with the bound intent and nonce headers', async () => {
    const value = metadata();
    const fetcher = vi.fn(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/pdf');
      expect(headers.get('X-LeapSign-Intent')).toBe(value.intent.id);
      expect(headers.get('X-LeapSign-Nonce')).toBe(value.intent.nonce);
      expect(init?.body).toBeInstanceOf(Uint8Array);
      return Response.json(report());
    });
    await api(fetcher).submit({intentId: value.intent.id, nonce: value.intent.nonce, pdf: new TextEncoder().encode('%PDF-synthetic'), sha256: 'b'.repeat(64), password: 'never sent'} as Parameters<V2HttpSigningApi['submit']>[0], signal());
  });
  it.each([{signatureCount: 0}, {previousSignatureCount: -1}, {signatureCount: 1.5}, {certificate: {privateKey: 'unexpected'}}])('rejects malformed reports', async mutation => {
    const value = metadata(); const fetcher = vi.fn(async () => Response.json({...report(), ...mutation}));
    await expect(api(fetcher).submit({intentId: value.intent.id, nonce: value.intent.nonce, pdf: new TextEncoder().encode('%PDF-synthetic'), sha256: 'b'.repeat(64)}, signal())).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  });
  it('rejects oversized JSON and unexpected MIME types', async () => {
    for (const response of [new Response('x'.repeat(16385), {headers: {'Content-Type': 'application/json'}}), new Response('<html>login</html>', {headers: {'Content-Type': 'text/html'}})]) {
      await expect(api(vi.fn(async () => response)).prepare(input, signal())).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
    }
  });
  it('normalizes errors without echoing server response bodies', async () => {
    await expect(api(vi.fn(async () => new Response('private server detail', {status: 500}))).prepare(input, signal())).rejects.toMatchObject({code: 'UNAVAILABLE', message: 'UNAVAILABLE'});
  });
  it('does not start after cancellation', async () => {
    const controller = new AbortController(); controller.abort(); const fetcher = vi.fn();
    await expect(api(fetcher).prepare(input, controller.signal)).rejects.toMatchObject({code: 'ABORTED'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('times out a stalled response body and cancels the reader', async () => {
    const cancelled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({cancel: cancelled}), {headers: {'Content-Type': 'application/json'}}));
    await expect(api(fetcher, {timeoutMs: 15}).prepare(input, signal())).rejects.toMatchObject({code: 'ABORTED'});
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
