/// <reference lib="webworker" />
import type {LocalWorkerRequest} from '../local-session';
import {signPdfLocally} from './sign';

type LocalWorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown, transfer: Transferable[]): void;
  close(): void;
  fetch: typeof fetch;
};

const scope = globalThis as unknown as LocalWorkerScope;
scope.fetch = (() => { throw new Error('NETWORK_DISABLED'); }) as typeof fetch;
let used = false;

scope.onmessage = async event => {
  if (used) return;
  used = true;
  let input = event.data as LocalWorkerRequest | undefined;
  try {
    if(!input)throw new Error('INVALID_LOCAL_REQUEST');
    const intentId=input.intent.id;
    const output = await signPdfLocally(input);
    scope.postMessage({type: 'signed', intentId, pdf: output.buffer}, [output.buffer]);
  } catch {
    scope.postMessage({type: 'error'}, []);
  } finally {
    if (input?.certificate instanceof ArrayBuffer && input.certificate.byteLength) new Uint8Array(input.certificate).fill(0);
    if (input) input.password = '';
    input = undefined;
    scope.close();
  }
};
