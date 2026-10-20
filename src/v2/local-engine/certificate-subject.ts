type DerElement = {tag: number; start: number; end: number; next: number};

const readElement = (bytes: Uint8Array, offset: number, limit = bytes.length): DerElement => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > limit) throw new Error('INVALID_CERTIFICATE_SUBJECT');
  const tag = bytes[offset];
  const firstLength = bytes[offset + 1];
  let length = firstLength;
  let header = 2;
  if (firstLength & 0x80) {
    const octets = firstLength & 0x7f;
    if (octets < 1 || octets > 4 || offset + 2 + octets > limit) throw new Error('INVALID_CERTIFICATE_SUBJECT');
    length = 0;
    for (let index = 0; index < octets; index++) length = length * 256 + bytes[offset + 2 + index];
    header += octets;
  }
  const start = offset + header;
  const end = start + length;
  if (!Number.isSafeInteger(end) || end > limit) throw new Error('INVALID_CERTIFICATE_SUBJECT');
  return {tag, start, end, next: end};
};

const sameBytes = (bytes: Uint8Array, element: DerElement, expected: readonly number[]) => {
  if (element.end - element.start !== expected.length) return false;
  return expected.every((value, index) => bytes[element.start + index] === value);
};

const decodeAttribute = (bytes: Uint8Array, element: DerElement) => {
  const value = bytes.subarray(element.start, element.end);
  if (element.tag === 0x0c) return new TextDecoder('utf-8', {fatal: true}).decode(value);
  if ([0x12, 0x13, 0x14, 0x16].includes(element.tag)) {
    return Array.from(value, byte => String.fromCharCode(byte)).join('');
  }
  if (element.tag === 0x1e && value.length % 2 === 0) {
    let result = '';
    for (let index = 0; index < value.length; index += 2) result += String.fromCharCode(value[index] * 256 + value[index + 1]);
    return result;
  }
  throw new Error('INVALID_CERTIFICATE_SUBJECT');
};

const commonName = (certificate: Uint8Array) => {
  const root = readElement(certificate, 0);
  if (root.tag !== 0x30 || root.next !== certificate.length) throw new Error('INVALID_CERTIFICATE_SUBJECT');
  const tbs = readElement(certificate, root.start, root.end);
  if (tbs.tag !== 0x30) throw new Error('INVALID_CERTIFICATE_SUBJECT');
  let cursor = tbs.start;
  let field = readElement(certificate, cursor, tbs.end);
  if (field.tag === 0xa0) {
    cursor = field.next;
    field = readElement(certificate, cursor, tbs.end);
  }
  // serialNumber, signature, issuer and validity precede subject in TBSCertificate.
  for (let index = 0; index < 4; index++) {
    cursor = field.next;
    field = readElement(certificate, cursor, tbs.end);
  }
  if (field.tag !== 0x30) throw new Error('INVALID_CERTIFICATE_SUBJECT');
  let rdnCursor = field.start;
  while (rdnCursor < field.end) {
    const rdn = readElement(certificate, rdnCursor, field.end);
    if (rdn.tag !== 0x31) throw new Error('INVALID_CERTIFICATE_SUBJECT');
    let attributeCursor = rdn.start;
    while (attributeCursor < rdn.end) {
      const attribute = readElement(certificate, attributeCursor, rdn.end);
      if (attribute.tag !== 0x30) throw new Error('INVALID_CERTIFICATE_SUBJECT');
      const identifier = readElement(certificate, attribute.start, attribute.end);
      const value = readElement(certificate, identifier.next, attribute.end);
      if (value.next !== attribute.end) throw new Error('INVALID_CERTIFICATE_SUBJECT');
      // 2.5.4.3 — X.509 commonName.
      if (identifier.tag === 0x06 && sameBytes(certificate, identifier, [0x55, 0x04, 0x03])) return decodeAttribute(certificate, value);
      attributeCursor = attribute.next;
    }
    rdnCursor = rdn.next;
  }
  throw new Error('CERTIFICATE_SUBJECT_UNAVAILABLE');
};

/** Visual-only certificate label. Cryptographic identity remains server-validated. */
export function certificateSubjectLabel(certificate: Uint8Array) {
  const label = commonName(certificate)
    .normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^A-Z0-9 .,'-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 96).trim();
  if (label.length < 3) throw new Error('CERTIFICATE_SUBJECT_UNAVAILABLE');
  return label;
}
