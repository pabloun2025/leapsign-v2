export type SigningFlags = { DIRECT_P12_SIGNING_ENABLED?: string; EXTERNAL_SIGNATURE_ENABLED?: string; FIRMAEC_COMPATIBILITY_PROFILE_ENABLED?: string };
export const V2_ORIGIN = 'https://leapsign.app';
export const V2_STAGING_ORIGIN = 'https://pruebas.leapsign.app';
export const MAX_CERTIFICATE_BYTES = 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const INTENT_LIFETIME_MS = 5 * 60_000;
export function signingFlags(env: SigningFlags = {}) {
  return {
    direct: env.DIRECT_P12_SIGNING_ENABLED === 'true',
    external: env.EXTERNAL_SIGNATURE_ENABLED === 'true',
    firmaecProfile: env.FIRMAEC_COMPATIBILITY_PROFILE_ENABLED === 'true',
  };
}
export function validateCertificateFile(file: { name: string; size: number }) {
  if (!/\.(p12|pfx)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_CERTIFICATE_BYTES) {
    throw new Error('Selecciona un certificado .p12 o .pfx de hasta 1 MB.');
  }
}
export function assertV2Origin(origin: string) {
  if (origin !== V2_ORIGIN && origin !== V2_STAGING_ORIGIN) throw new Error('Esta función solo está disponible en LeapSign v2.');
}
