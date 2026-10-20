/** Build the product local worker with synthetic laboratory dependencies. */
import {build} from 'vite';
import {writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {libPdfVisibleSignaturePlugin} from '../src/v2/local-engine/libpdf-visible-plugin.ts';
const [engine, qr, output] = process.argv.slice(2);
if (!engine || !qr || !output) throw new Error('Supply experimental engine, QR module and output paths');
const relativeOutput = relative(resolve('.'), resolve(output));
if (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput)) throw new Error('Laboratory output must be outside the application checkout');
const result = await build({
  configFile: false, logLevel: 'warn',
  plugins: [libPdfVisibleSignaturePlugin()],
  resolve: {alias: {'@libpdf/core': resolve(engine), 'qrcode': resolve(qr)}},
  build: {write: false, minify: false, target: 'es2022',
    lib: {entry: resolve('src/v2/local-engine/worker.ts'), formats: ['es']},
    rolldownOptions: {output: {codeSplitting: false}}},
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
const chunks = outputs.filter(item => item.type === 'chunk');
if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) throw new Error('Worker is not self-contained');
await writeFile(output, chunks[0].code);
process.stdout.write('Built isolated browser laboratory worker.\n');
