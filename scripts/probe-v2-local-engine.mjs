/** Isolated laboratory only, not a server endpoint or production signing path.
 * Input/output pipes contain ONLY synthetic test material. Real P12 containers
 * must never be sent to this Node process: production signing belongs in-browser.
 * The engine path is operator-supplied, pinned separately and never downloaded here.
 */
import {pathToFileURL} from 'node:url';
import {prepareSyntheticAppearance, reserveCanonicalObjectNumbers} from './v2-synthetic-appearance.mjs';

globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED'); };
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('INPUT_LIMIT');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (input.syntheticOnly !== true || !process.env.LIBPDF_MODULE_PATH) throw new Error('LAB_ONLY');
  const engine = await import(pathToFileURL(process.env.LIBPDF_MODULE_PATH).href);
  const {PDF, P12Signer} = engine;
  const signer = await P12Signer.create(new Uint8Array(Buffer.from(input.p12, 'base64')), input.password, {buildChain: false});
  const pdf = await PDF.load(new Uint8Array(Buffer.from(input.pdf, 'base64')));
  reserveCanonicalObjectNumbers(pdf);
  if (input.visible) {
    let QRCode;
    if (input.qr) {
      if (!process.env.QRCODE_MODULE_PATH) throw new Error('QR_LAB_NOT_CONFIGURED');
      QRCode = (await import(pathToFileURL(process.env.QRCODE_MODULE_PATH).href)).default;
    }
    prepareSyntheticAppearance(pdf, input, engine, QRCode);
  }
  const result = await pdf.sign({
    signer, fieldName: input.fieldName, reason: 'Synthetic interoperability probe',
    location: 'Local laboratory', subFilter: 'ETSI.CAdES.detached', level: 'B-B',
    digestAlgorithm: 'SHA-256', estimatedSize: input.estimatedSize ?? 16384,
    leapSignPreserveAppearance: input.visible === true,
  });
  if (result.warnings.length) throw new Error('ENGINE_WARNING');
  process.stdout.write(JSON.stringify({ok: true, pdf: Buffer.from(result.bytes).toString('base64')}));
} catch {
  // Never echo ASN.1/P12 errors, passwords or input data, even in this lab.
  process.stdout.write(JSON.stringify({ok: false, error: 'LOCAL_ENGINE_REJECTED'}));
  process.exitCode = 1;
}
