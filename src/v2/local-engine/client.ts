import type {SigningWorkerPort} from '../local-session';

export function createLocalEngineWorker(): SigningWorkerPort {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module', name: 'leapsign-local-signing-engine',
  });
}
