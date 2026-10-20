/** Laboratory graphic, not a production certificate appearance or FirmaEC logo.
 * Fixed synthetic content only. Public low-level PDF APIs; never edit the output
 * of pdf.sign(). The explicit experimental engine extension retains this widget.
 */
export function reserveCanonicalObjectNumbers(pdf) {
  // Upstream 0.5.3 starts at max(xref)+1, which can be below trailer /Size
  // after a valid incremental revision containing reserved object numbers.
  // Use the PUBLIC allocation API to skip those reserved numbers before adding
  // anything. Do not rewrite the canonical PDF or relax independent diff checks.
  const size = pdf.context.info.trailer.getNumber('Size')?.value;
  const registry = pdf.context.registry;
  if (!Number.isSafeInteger(size) || size < 1 || size - registry.nextObjectNumber > 1024) throw new Error('UNSUPPORTED_OBJECT_RESERVATION');
  while (registry.nextObjectNumber < size) registry.allocateRef();
}

/** Text matching the compact FirmaEC-style layout. It is visual metadata only;
 * the CMS signature and independent validator remain authoritative. */
export function firmaecAppearanceText(subject) {
  if (typeof subject !== 'string' || !/^[A-ZÁÉÍÓÚÜÑ0-9 .,'-]{3,96}$/.test(subject)) throw new Error('INVALID_SIGNER_NAME');
  return ['Validar únicamente en FirmaEC.', 'Firmado electrónicamente por:', subject];
}

export function prepareSyntheticAppearance(pdf, input, engine, QRCode) {
  const {PdfDict, PdfName, PdfNumber, PdfArray, PdfStream} = engine;
  const page = pdf.getPages().at(-1);
  const y = 20 + 90 * ((input.number ?? 1) - 1);
  const field = pdf.getOrCreateForm().createSignatureField(input.fieldName);
  const dict = field.getDict();
  const n = value => PdfNumber.of(value);
  const [verification, signedBy, subject] = firmaecAppearanceText(input.signerName ?? 'FIRMANTE SINTÉTICO');
  const escape = value => value.replace(/([()\\])/g, '\\$1');
  let graphic = `q 1 1 1 rg 0 0 250 80 re f 0 0 0 rg BT /F1 6 Tf 84 62 Td (${escape(verification)}) Tj 0 -9 Td (${escape(signedBy)}) Tj /F1 10 Tf 0 -11 Td (${escape(subject)}) Tj ET Q`;
  if (input.qr) {
    if (!QRCode || input.qr !== 'urn:leapsign:signature:00000000-0000-4000-8000-000000000001') throw new Error('SYNTHETIC_QR_ONLY');
    const matrix = QRCode.create(input.qr, {errorCorrectionLevel: 'M'}).modules;
    const cell = 72 / (matrix.size + 8);
    graphic += ' q 0 0 0 rg ';
    for (let row = 0; row < matrix.size; row++) {
      for (let column = 0; column < matrix.size; column++) {
        if (matrix.get(row, column)) {
          graphic += `${(4 + (column + 4) * cell).toFixed(5)} ${(4 + (matrix.size + 3 - row) * cell).toFixed(5)} ${cell.toFixed(5)} ${cell.toFixed(5)} re f `;
        }
      }
    }
    graphic += 'Q';
  }
  const font = pdf.context.registry.register(PdfDict.of({Type: PdfName.of('Font'), Subtype: PdfName.of('Type1'), BaseFont: PdfName.of('Helvetica')}));
  const appearance = pdf.context.registry.register(PdfStream.fromDict({
    Type: PdfName.of('XObject'), Subtype: PdfName.of('Form'),
    BBox: new PdfArray([n(0), n(0), n(250), n(80)]),
    Resources: PdfDict.of({Font: PdfDict.of({F1: font})}),
  }, new TextEncoder().encode(graphic)));
  dict.set('Type', PdfName.of('Annot')); dict.set('Subtype', PdfName.of('Widget'));
  dict.set('F', n(132)); dict.set('P', page.ref);
  dict.set('Rect', new PdfArray([n(320), n(y), n(570), n(y + 80)]));
  dict.set('AP', PdfDict.of({N: appearance}));
  const resolve = pdf.context.registry.resolve.bind(pdf.context.registry);
  let annotations = page.dict.getArray('Annots', resolve);
  if (!annotations) { annotations = new PdfArray([]); page.dict.set('Annots', annotations); }
  annotations.push(field.getRef());
}
