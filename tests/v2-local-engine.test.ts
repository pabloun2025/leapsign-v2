import {readFile} from 'node:fs/promises';
import {describe, expect, it, vi, afterEach} from 'vitest';
import type {SigningIntent} from '../src/v2/contracts';
import type {LocalWorkerRequest, SigningWorkerPort} from '../src/v2/local-session';

const length = (value: number) => value < 128
  ? [value]
  : [0x81, value];
const tlv = (tag: number, bytes: number[]) => [tag, ...length(bytes.length), ...bytes];
const sequence = (...values: number[][]) => tlv(0x30, values.flat());
const set = (...values: number[][]) => tlv(0x31, values.flat());
const integer = (value: number) => tlv(0x02, [value]);
const oid = (...value: number[]) => tlv(0x06, value);
const utf8 = (value: string) => tlv(0x0c, [...new TextEncoder().encode(value)]);

/** Structurally sufficient X.509 fixture; it is synthetic and contains no key. */
const certificateWithCommonName = (commonName: string) => {
  const algorithm = sequence(oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b));
  const name = sequence(set(sequence(oid(0x55, 0x04, 0x03), utf8(commonName))));
  const validity = sequence(tlv(0x17, [...new TextEncoder().encode('261020000000Z')]), tlv(0x17, [...new TextEncoder().encode('271020000000Z')]));
  const subjectPublicKey = sequence(algorithm, tlv(0x03, [0]));
  const tbs = sequence(tlv(0xa0, integer(2)), integer(1), algorithm, name, validity, name, subjectPublicKey);
  return new Uint8Array(sequence(tbs, algorithm, tlv(0x03, [0])));
};

const request = (): LocalWorkerRequest => ({
  intent: {
    id: '00000000-0000-4000-8000-000000000001',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    state: 'signature_intent_issued',
  } as SigningIntent,
  pdf: new TextEncoder().encode('%PDF-base').buffer,
  certificate: new Uint8Array([1, 2]).buffer,
  password: 'synthetic-password', reason: 'Aprobación', location: 'Laboratorio',
});

afterEach(() => vi.unstubAllGlobals());

describe('maintainable local signing engine', () => {
  it('derives a safe visible label from the certificate subject', async () => {
    const module = await import('../src/v2/local-engine/certificate-subject');
    expect(module.certificateSubjectLabel(certificateWithCommonName('Pérsöna de (prueba)'))).toBe('PERSONA DE PRUEBA');
  });

  it('builds a FirmaEC-style legend and a non-secret audit QR payload', async () => {
    const module = await import('../src/v2/local-engine/appearance');
    expect(module.firmaEcAppearanceText('PERSONA DE PRUEBA')).toEqual([
      'Verificar en LeapSign.', 'Firmado electrónicamente por:', 'PERSONA DE PRUEBA',
    ]);
    const payload = module.signatureQrPayload('00000000-0000-4000-8000-000000000001');
    expect(payload).toBe('https://pruebas.leapsign.app/verificar/00000000-0000-4000-8000-000000000001');
    expect(payload).not.toContain('nonce');
    expect(() => module.firmaEcAppearanceText('ANA\nBT /F1 99 Tf')).toThrow('INVALID_SIGNER_NAME');
  });

  it('removes all browser network primitives from the dedicated signing worker', async()=>{
    const source=await readFile(new URL('../src/v2/local-engine/worker.ts',import.meta.url),'utf8');
    for(const primitive of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts'])expect(source).toMatch(new RegExp(`scope\\.${primitive}\\s*=`));
  });

  it('pins the reviewed LibPDF artifact before enabling visible signatures', async () => {
    const module = await import('../src/v2/local-engine/libpdf-visible-plugin');
    const source = await readFile(new URL('../node_modules/@libpdf/core/dist/index.mjs', import.meta.url), 'utf8');
    const patched = module.patchLibPdfVisibleSignatures(source);
    expect(patched).toContain('preserveAppearance: options.leapSignPreserveAppearance === true');
    expect(patched).toContain('if (options.preserveAppearance)');
    expect(() => module.patchLibPdfVisibleSignatures(`${source}\n`)).toThrow('Unexpected @libpdf/core artifact');
  });

  it('offers a public signer backed by a fresh dedicated module worker', async () => {
    const workers: Array<{url: URL | string; options?: WorkerOptions; port: SigningWorkerPort}> = [];
    class SyntheticWorker implements SigningWorkerPort {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(url: URL | string, options?: WorkerOptions) { workers.push({url, options, port: this}); }
      terminate = vi.fn();
      postMessage(value: LocalWorkerRequest) {
        queueMicrotask(() => this.onmessage?.({data: {
          type: 'signed', intentId: value.intent.id,
          pdf: new TextEncoder().encode('%PDF-synthetic-signed').buffer,
        }} as MessageEvent));
      }
    }
    vi.stubGlobal('Worker', SyntheticWorker);
    const {signWithLocalEngine} = await import('../src/v2/local-session');
    const result = await signWithLocalEngine(request(), new AbortController().signal);
    expect(new Uint8Array(result.pdf).length).toBeGreaterThan(5);
    expect(workers).toHaveLength(1);
    expect(workers[0].options).toEqual({type: 'module', name: 'leapsign-local-signing-engine'});
    expect(String(workers[0].url)).toContain('/local-engine/worker.ts');
    expect(workers[0].port.terminate).toHaveBeenCalledOnce();
  });
});
