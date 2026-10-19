/** Real, small PDF fixture built in memory, ASCII text and no personal data.
 * Not a signature implementation, signed artifact or certificate fixture. */
export function samplePdf() {
  const streams = [
    'BT /F1 20 Tf 55 750 Td (Acuerdo de colaboracion) Tj 0 -40 Td /F1 12 Tf (Documento ficticio para revisar LeapSign v2.) Tj 0 -28 Td (Primera parte: objeto del acuerdo.) Tj ET',
    'BT /F1 20 Tf 55 750 Td (Condiciones y firma) Tj 0 -40 Td /F1 12 Tf (Documento de prueba sin datos personales.) Tj 0 -28 Td (Zona de firma al pie de esta pagina.) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /SigFlags 3 >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  ];
  let output = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => {offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`;});
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}
