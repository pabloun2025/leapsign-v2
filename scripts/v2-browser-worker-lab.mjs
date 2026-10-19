/** SYNTHETIC laboratory entry point. Not imported by or exposed in v1/v2 UI. */
import {PDF, P12Signer, PdfDict, PdfName, PdfNumber, PdfArray, PdfStream} from 'leapsign-local-engine-lab';
import QRCode from 'leapsign-qr-lab';
import {prepareSyntheticAppearance, reserveCanonicalObjectNumbers} from './v2-synthetic-appearance.mjs';

globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED'); };
let used = false;
self.onmessage = async event => {
  if (used) return;
  used = true;
  let input = event.data;
  let signer;
  let pdf;
  try {
    if (input.syntheticOnly !== true || !(input.p12 instanceof Uint8Array) || !(input.pdf instanceof Uint8Array)) throw new Error('LAB_ONLY');
    signer = await P12Signer.create(input.p12, input.password, {buildChain: false});
    pdf = await PDF.load(input.pdf);
    reserveCanonicalObjectNumbers(pdf);
    if (input.visible) prepareSyntheticAppearance(pdf, input, {PdfDict, PdfName, PdfNumber, PdfArray, PdfStream}, QRCode);
    const result = await pdf.sign({signer, fieldName: input.fieldName,
      reason: 'Synthetic browser interoperability probe', location: 'Local laboratory',
      subFilter: 'ETSI.CAdES.detached', level: 'B-B', digestAlgorithm: 'SHA-256',
      estimatedSize: input.estimatedSize ?? 16384, leapSignPreserveAppearance: input.visible === true});
    if (result.warnings.length) throw new Error('ENGINE_WARNING');
    const bytes = new Uint8Array(result.bytes);
    self.postMessage({ok: true, pdf: bytes.buffer}, [bytes.buffer]);
  } catch {
    self.postMessage({ok: false, error: 'LOCAL_ENGINE_REJECTED'});
  } finally {
    input?.p12?.fill(0);
    input = null; signer = null; pdf = null;
    self.close();
  }
};
