import {PdfArray, PdfDict, PdfName, PdfNumber, PdfStream, type PDF} from '@libpdf/core';
import QRCode from 'qrcode';
import type {SigningIntent} from '../contracts';

const safeName = /^[A-Z0-9 .,'-]{3,96}$/;
const safeIntentId = /^[a-zA-Z0-9_-]{1,128}$/;

export function firmaEcAppearanceText(subject: string): [string, string, string] {
  if (!safeName.test(subject)) throw new Error('INVALID_SIGNER_NAME');
  return ['Validar únicamente en FirmaEC.', 'Firmado electrónicamente por:', subject];
}

export function signatureQrPayload(intentId: string) {
  if (!safeIntentId.test(intentId)) throw new Error('INVALID_INTENT_ID');
  return `urn:leapsign:signature:${intentId}`;
}

export function signatureFieldName(intentId: string) {
  if (!safeIntentId.test(intentId)) throw new Error('INVALID_INTENT_ID');
  return `LeapSign_${intentId}`;
}

export function reserveCanonicalObjectNumbers(pdf: PDF) {
  const size = pdf.context.info.trailer.getNumber('Size')?.value;
  const registry = pdf.context.registry;
  if (!Number.isSafeInteger(size) || size === undefined || size < 1 || size - registry.nextObjectNumber > 1024) {
    throw new Error('UNSUPPORTED_OBJECT_RESERVATION');
  }
  while (registry.nextObjectNumber < size) registry.allocateRef();
}

const escapePdfText = (value: string) => value.replace(/([()\\])/g, '\\$1');
const latin1 = (value: string) => {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 255) throw new Error('UNSUPPORTED_APPEARANCE_TEXT');
    bytes[index] = code;
  }
  return bytes;
};

/** Prepare a merged signature widget before LibPDF hashes and signs the revision. */
export function prepareSignatureAppearance(pdf: PDF, intent: SigningIntent, subject: string) {
  const {page, x, y, width, height} = intent.position;
  if (![page, x, y, width, height].every(Number.isFinite) || !Number.isInteger(page) || page < 1 ||
      x < 0 || y < 0 || width < 100 || height < 50) throw new Error('INVALID_SIGNATURE_POSITION');
  const target = pdf.getPages()[page - 1];
  if (!target) throw new Error('INVALID_SIGNATURE_POSITION');

  const field = pdf.getOrCreateForm().createSignatureField(signatureFieldName(intent.id));
  const dict = field.getDict();
  const number = (value: number) => PdfNumber.of(value);
  const [verification, signedBy, signer] = firmaEcAppearanceText(subject);
  const qr = QRCode.create(signatureQrPayload(intent.id), {errorCorrectionLevel: 'M'}).modules;
  const qrBox = Math.min(height - 8, width * 0.32, 72);
  const cell = qrBox / (qr.size + 8);
  const textX = qrBox + 8;
  const top = height - 18;
  let graphic = `q 1 1 1 rg 0 0 ${width} ${height} re f 0 0 0 rg BT /F1 6 Tf ${textX.toFixed(3)} ${top.toFixed(3)} Td (${escapePdfText(verification)}) Tj 0 -9 Td (${escapePdfText(signedBy)}) Tj /F1 10 Tf 0 -11 Td (${escapePdfText(signer)}) Tj ET q 0 0 0 rg `;
  for (let row = 0; row < qr.size; row++) {
    for (let column = 0; column < qr.size; column++) {
      if (qr.get(row, column)) {
        graphic += `${(4 + (column + 4) * cell).toFixed(5)} ${(4 + (qr.size + 3 - row) * cell).toFixed(5)} ${cell.toFixed(5)} ${cell.toFixed(5)} re f `;
      }
    }
  }
  graphic += 'Q Q';

  const font = pdf.context.registry.register(PdfDict.of({
    Type: PdfName.of('Font'), Subtype: PdfName.of('Type1'), BaseFont: PdfName.of('Helvetica'),
  }));
  const appearance = pdf.context.registry.register(PdfStream.fromDict({
    Type: PdfName.of('XObject'), Subtype: PdfName.of('Form'),
    BBox: new PdfArray([number(0), number(0), number(width), number(height)]),
    Resources: PdfDict.of({Font: PdfDict.of({F1: font})}),
  }, latin1(graphic)));

  dict.set('Type', PdfName.of('Annot'));
  dict.set('Subtype', PdfName.of('Widget'));
  dict.set('F', number(132));
  dict.set('P', target.ref);
  dict.set('Rect', new PdfArray([number(x), number(y), number(x + width), number(y + height)]));
  dict.set('AP', PdfDict.of({N: appearance}));
  const resolve = pdf.context.registry.resolve.bind(pdf.context.registry);
  let annotations = target.dict.getArray('Annots', resolve);
  if (!annotations) {
    annotations = new PdfArray([]);
    target.dict.set('Annots', annotations);
  }
  const fieldRef=field.getRef();
  if(!fieldRef)throw new Error('INVALID_SIGNATURE_FIELD');
  annotations.push(fieldRef);
}
