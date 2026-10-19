import {afterEach, describe, expect, it, vi} from 'vitest';
import {runLocalSigningSession, type LocalWorkerRequest, type SigningWorkerPort} from '../src/v2/local-session';
import type {SigningIntent} from '../src/v2/contracts';

const request = (): LocalWorkerRequest => ({
  intent: {id: 'intent', expiresAt: new Date(Date.now() + 300_000).toISOString(), state: 'signature_intent_issued'} as SigningIntent,
  pdf: new TextEncoder().encode('%PDF-base').buffer,
  certificate: new Uint8Array([1, 2]).buffer, password: 'synthetic-only', reason: '', location: '',
});
const port = (): SigningWorkerPort => ({postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null});
const success = (worker: SigningWorkerPort, extra = {}) => worker.onmessage?.({data: {
  type: 'signed', intentId: 'intent', pdf: new TextEncoder().encode('%PDF-unvalidated-test').buffer, ...extra,
}} as MessageEvent);
afterEach(() => vi.useRealTimers());
describe('local signing worker lifecycle, not cryptographic validation', () => {
  it('transfers both input buffers and terminates on an unvalidated result', async () => {
    const worker = port(); const input = request();
    const pending = runLocalSigningSession(input, {createWorker: () => worker});
    expect(worker.postMessage).toHaveBeenCalledWith(input, [input.pdf, input.certificate]);
    success(worker);
    expect((await pending).intentId).toBe('intent');
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull();
  });
  it('does not create a worker after cancellation', async () => {
    const controller = new AbortController(); controller.abort(); const factory = vi.fn();
    await expect(runLocalSigningSession(request(), {createWorker: factory, signal: controller.signal})).rejects.toMatchObject({code: 'CANCELLED'});
    expect(factory).not.toHaveBeenCalled();
  });
  it('cancels and closes an active worker', async () => {
    const worker = port(); const controller = new AbortController();
    const pending = runLocalSigningSession(request(), {createWorker: () => worker, signal: controller.signal});
    controller.abort(); await expect(pending).rejects.toMatchObject({code: 'CANCELLED'});
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('limits execution time', async () => {
    vi.useFakeTimers(); const worker = port();
    const pending = runLocalSigningSession(request(), {createWorker: () => worker, timeoutMs: 50});
    const assertion = expect(pending).rejects.toMatchObject({code: 'TIMEOUT'});
    await vi.advanceTimersByTimeAsync(50); await assertion; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not accept a result after intent expiry', async () => {
    const worker = port(); let now = Date.now(); const input = request();
    const pending = runLocalSigningSession(input, {createWorker: () => worker, now: () => now});
    now = Date.parse(input.intent.expiresAt); success(worker);
    await expect(pending).rejects.toMatchObject({code: 'EXPIRED'});
  });
  it.each([{intentId: 'another'}, {password: 'never-echo'}, {pdf: new Uint8Array([1]).buffer}, {type: 'error'}])('rejects unexpected worker messages', async extra => {
    const worker = port(); const pending = runLocalSigningSession(request(), {createWorker: () => worker});
    success(worker, extra); await expect(pending).rejects.toMatchObject({code: 'LOCAL_FAILURE'});
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('suppresses raw worker errors', async () => {
    const worker = port(); const pending = runLocalSigningSession(request(), {createWorker: () => worker});
    const preventDefault = vi.fn(); worker.onerror?.({message: 'synthetic-secret', preventDefault} as unknown as ErrorEvent);
    await expect(pending).rejects.not.toThrow('synthetic-secret'); expect(preventDefault).toHaveBeenCalledOnce();
  });
  it('rejects oversized inputs before worker creation', async () => {
    const factory = vi.fn(); const input = request(); input.certificate = new ArrayBuffer(1_048_577);
    await expect(runLocalSigningSession(input, {createWorker: factory})).rejects.toMatchObject({code: 'INVALID_INPUT'});
    expect(factory).not.toHaveBeenCalled();
  });
  it('normalizes worker startup failure', async () => {
    await expect(runLocalSigningSession(request(), {createWorker: () => {throw Error('private detail');}})).rejects.toMatchObject({code: 'LOCAL_FAILURE'});
  });
});
