/** Build a self-contained lab worker outside the application output. */
import {build} from 'vite';
import {writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
const [engine, qr, output] = process.argv.slice(2);
if (!engine || !qr || !output) throw new Error('Supply experimental engine, QR module and output paths');
const relativeOutput = relative(resolve('.'), resolve(output));
if (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput)) throw new Error('Laboratory output must be outside the application checkout');
const result = await build({
  configFile: false, logLevel: 'warn',
  resolve: {alias: {'leapsign-local-engine-lab': resolve(engine), 'leapsign-qr-lab': resolve(qr)}},
  build: {write: false, minify: false, target: 'es2022',
    lib: {entry: resolve('scripts/v2-browser-worker-lab.mjs'), formats: ['es']},
    rolldownOptions: {output: {codeSplitting: false}}},
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
const chunks = outputs.filter(item => item.type === 'chunk');
if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) throw new Error('Worker is not self-contained');
await writeFile(output, chunks[0].code);
process.stdout.write('Built isolated browser laboratory worker.\n');
