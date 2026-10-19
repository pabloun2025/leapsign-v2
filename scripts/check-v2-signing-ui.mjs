/** Local-only interaction and visual checks; never visits production. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {stdio: 'ignore'});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {const r = await fetch(origin + '/v2/lab/ui/'); if (r.ok) {ready = true; break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Local UI server did not start');
  const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH ?? '/workspace/firmador/v2/lab/node_modules/playwright/index.mjs').href);
  browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const results = [];
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({viewport: {width, height: 950}, acceptDownloads: true});
    const errors = []; const remoteRequests = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) {remoteRequests.push('blocked'); return route.abort();}
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', () => errors.push('pageerror'));
    await page.goto(origin + '/v2/lab/ui/');
    await page.getByRole('button', {name: 'Abrir documento'}).click();
    await page.getByRole('link', {name: 'Descargar documento PDF'}).waitFor();
    await page.getByText('Leer texto de esta página', {exact: true}).waitFor();
    const rendered = await page.getByRole('img', {name: 'Documento PDF, página 1'}).evaluate(canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i] < 100 && bytes[i + 1] < 100 && bytes[i + 2] < 100) dark++;
      return canvas.width > 100 && canvas.height > 100 && dark > 30;
    });
    assert(rendered, 'PDF was not actually rendered');
    await page.getByRole('button', {name: 'Página siguiente'}).click();
    await page.getByText('Área de firma', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Girar', exact: true}).click();
    await page.getByText('Área de firma', {exact: true}).waitFor();
    for (let step = 0; step < 3; step++) {await page.getByRole('button', {name: 'Girar', exact: true}).click(); await page.getByText('Área de firma', {exact: true}).waitFor();}
    await page.getByRole('button', {name: 'Ampliar PDF', exact: true}).click();
    await page.getByRole('button', {name: 'Reducir PDF', exact: true}).click();
    await page.getByRole('button', {name: 'Página anterior'}).click();
    await page.getByRole('img', {name: 'Documento PDF, página 1'}).waitFor();
    assert(await page.getByRole('button', {name: 'Firmar con certificado'}).isDisabled());
    await page.getByRole('link', {name: 'Descargar documento PDF'}).click();
    await page.getByRole('checkbox', {name: 'He revisado el PDF y quiero firmarlo.'}).check();
    await page.screenshot({path: `/tmp/leapsign-v2-signing-${width}.png`, fullPage: true});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    await page.getByRole('button', {name: 'Firmar con certificado'}).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await page.getByLabel('Certificado .p12 o .pfx', {exact: true}).setInputFiles({name: 'synthetic.p12', mimeType: 'application/x-pkcs12', buffer: Buffer.from('synthetic only')});
    await page.getByLabel('Contraseña del certificado', {exact: true}).fill('synthetic-password');
    await page.getByRole('button', {name: 'Mostrar', exact: true}).click();
    assert.equal(await page.getByLabel('Contraseña del certificado', {exact: true}).getAttribute('type'), 'text');
    await page.getByRole('button', {name: 'Ocultar', exact: true}).click();
    if (process.env.AXE_SCRIPT_PATH) {
      await page.addScriptTag({content: await readFile(process.env.AXE_SCRIPT_PATH, 'utf8')});
      const violations = await page.evaluate(async () => (await window.axe.run()).violations.map(value => value.id));
      assert.deepEqual(violations, [], 'Accessibility violations in certificate dialog');
    }
    await page.getByRole('button', {name: 'Firmar este documento'}).click();
    await page.getByRole('alert').filter({hasText: 'No se pudo firmar.'}).waitFor();
    assert.equal(await page.getByLabel('Contraseña del certificado', {exact: true}).inputValue(), '');
    assert.equal(await page.getByLabel('Certificado .p12 o .pfx', {exact: true}).inputValue(), '');
    assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
    results.push({width, interaction: 'passed', pdfCanvas: 'rendered', pageNavigation: 'passed', rotation: 'passed', horizontalOverflow: false, remoteRequests: 0});
    await context.close();
  }
  const fallbackContext = await browser.newContext();
  const fallbackPage = await fallbackContext.newPage();
  const fallbackErrors = []; fallbackPage.on('pageerror', () => fallbackErrors.push('pageerror'));
  await fallbackPage.addInitScript(() => {globalThis.Worker = class {constructor() {throw new Error('Workers blocked for synthetic fallback test');}};});
  await fallbackPage.goto(origin + '/v2/lab/ui/');
  await fallbackPage.getByRole('button', {name: 'Abrir documento'}).click();
  await fallbackPage.getByText('No se pudo mostrar este PDF. Puedes descargarlo para revisarlo.', {exact: true}).waitFor();
  assert(await fallbackPage.getByRole('checkbox', {name: 'He revisado el PDF y quiero firmarlo.'}).isDisabled());
  assert.deepEqual(fallbackErrors, []);
  await fallbackContext.close();
  process.stdout.write(JSON.stringify({syntheticOnly: true, results, workerBlockedFallback: 'passed'}) + '\n');
} finally {
  await browser?.close(); vite.kill('SIGTERM');
}
