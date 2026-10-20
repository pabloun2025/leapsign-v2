/** Chromium laboratory with synthetic keys only. The ephemeral HTTP server
 * serves static test assets, has no upload endpoint and logs no requests.
 * Certificate bytes travel via Playwright IPC and Worker.postMessage, not HTTP.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

let browser;
let server;
try {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('INPUT_LIMIT');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (input.syntheticOnly !== true || !process.env.PLAYWRIGHT_MODULE_PATH || !process.env.BROWSER_WORKER_LAB_PATH) throw new Error('LAB_ONLY');
  const bundle = await readFile(process.env.BROWSER_WORKER_LAB_PATH);
  let requests = 0; let violations = 0;
  server = createServer((req, res) => {
    requests++;
    if (req.method !== 'GET' || !['/', '/worker.js'].includes(req.url)) {
      violations++; res.writeHead(403); res.end(); return;
    }
    const isWorker = req.url === '/worker.js';
    res.writeHead(200, {
      'Content-Type': isWorker ? 'text/javascript' : 'text/html',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'",
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(isWorker ? bundle : '<!doctype html><html lang="es"><title>Synthetic signing laboratory</title></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) throw new Error('PLAYWRIGHT_CHROMIUM_UNAVAILABLE');
  browser = await chromium.launch({headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox']});
  const context = await browser.newContext({serviceWorkers: 'block'});
  await context.route('**/*', route => {
    const req = route.request();
    if (req.method() !== 'GET' || ![origin + '/', origin + '/worker.js'].includes(req.url())) {
      violations++; return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(origin);
  const result = await page.evaluate(async payload => {
    const worker = new Worker('/worker.js', {type: 'module'});
    const decode = value => Uint8Array.from(atob(value), letter => letter.charCodeAt(0));
    const certificate = decode(payload.p12);
    const pdf = decode(payload.pdf);
    const suffix = String(payload.number ?? 1).padStart(12, '0');
    const intentId = `00000000-0000-4000-8000-${suffix}`;
    let request = {
      intent: {
        id: intentId, documentId: 'synthetic-document', versionId: 'synthetic-version',
        stageId: 'synthetic-stage', signerId: 'synthetic-person', role: 'approval',
        profile: 'firmaec-qr-compatible', position: {
          page: 2, x: 320, y: 20 + 90 * ((payload.number ?? 1) - 1), width: 250, height: 80,
        },
        issuedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2099-10-20T00:05:00.000Z',
        nonce: 'synthetic-only', state: 'signature_intent_issued',
        correlationId: 'synthetic-correlation', baseSha256: '0'.repeat(64),
      },
      pdf: pdf.buffer, certificate: certificate.buffer, password: payload.password,
      reason: 'Synthetic browser interoperability probe', location: 'Local laboratory',
    };
    return new Promise(resolve => {
      const timeout = setTimeout(() => {worker.terminate(); resolve({ok: false, error: 'LOCAL_ENGINE_REJECTED'});}, 20_000);
      const finish = result => {clearTimeout(timeout); worker.terminate(); resolve(result);};
      worker.onerror = event => {event.preventDefault(); finish({ok: false, error: 'LOCAL_ENGINE_REJECTED'});};
      worker.onmessage = event => {
        const result = event.data;
        if (result?.type === 'signed' && result.intentId === intentId && result.pdf instanceof ArrayBuffer) {
          const bytes = new Uint8Array(result.pdf);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          finish({ok: true, pdf: btoa(binary)});
        } else finish({ok: false, error: 'LOCAL_ENGINE_REJECTED'});
      };
      worker.postMessage(request, [request.pdf, request.certificate]);
      payload.password = ''; payload = null; request = null;
    });
  }, input);
  const persisted = await page.evaluate(() => localStorage.length + sessionStorage.length);
  if (violations || persisted || requests !== 2) throw new Error('ISOLATION_CHECK_FAILED');
  // Proof is bounded to this worker execution, not a universal security claim.
  process.stdout.write(JSON.stringify({...result, isolation: {staticGetRequests: requests, violations, webStorageEntries: persisted}}));
} catch {
  process.stdout.write(JSON.stringify({ok: false, error: 'BROWSER_LAB_FAILED'}));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
