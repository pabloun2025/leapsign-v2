/** Test generated static assets with their real CSP, on loopback only.
 * This does not upload, deploy, push, or expose a public preview URL.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const directory = resolve('v2/preview/dist');
const headersFile = await readFile(resolve(directory, '_headers'), 'utf8');
const security = Object.fromEntries(headersFile.split('\n').filter(line => line.startsWith('  ')).map(line => {const n = line.indexOf(':'); return [line.slice(2, n), line.slice(n + 1).trim()];}));
let posts = 0;
const server = createServer(async (request, response) => {
  if (request.method !== 'GET') {posts++; response.writeHead(405, security); response.end(); return;}
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(directory + '/')) throw new Error('Outside static root');
    const content = await readFile(target);
    const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.zip':'application/zip','.txt':'text/plain'}[extname(target)] ?? 'application/octet-stream';
    response.writeHead(200, {...security, 'Content-Type': mime}); response.end(content);
  } catch {response.writeHead(404, security); response.end();}
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const {chromium} = await import(pathToFileURL(resolve('v2/lab/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 390, height: 900}, serviceWorkers: 'block'});
  let remoteRequests = 0; const errors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {remoteRequests++; return route.abort();}
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', () => errors.push('pageerror'));
  const response = await page.goto(origin);
  assert(response.headers()['content-security-policy'].includes("connect-src 'none'"));
  await page.getByText('Laboratorio de interfaz', {exact: false}).waitFor();
  await page.getByRole('button', {name: 'Abrir documento'}).click();
  await page.getByText('Leer texto de esta página', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Página siguiente'}).click();
  await page.getByText('Área de firma', {exact: true}).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const blocked = await page.evaluate(async () => {
    try {await fetch('/api/v2/signing/submit', {method: 'POST', body: 'synthetic CSP probe'}); return false;}
    catch {return true;}
  });
  assert(blocked, 'CSP did not prevent API connections'); assert.equal(posts, 0); assert.equal(remoteRequests, 0);
  const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
  process.stdout.write(JSON.stringify({mode: release.mode, revision: release.revision, staticPdfRender: 'passed', cspBlocksSubmission: true, postRequests: posts, remoteRequests, published: false}) + '\n');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
