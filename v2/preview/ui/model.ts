export type AppRoute =
  | {kind: 'owner'}
  | {kind: 'signer'; token: string}
  | {kind: 'tracking'; processId: string}
  | {kind: 'recovery'}
  | {kind: 'not-found'};

const processIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const signerTokenPattern = /^[A-Za-z0-9_-]{1,128}$/;

export function parseAppRoute(pathname: string): AppRoute {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { return {kind: 'not-found'}; }
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length === 0) return {kind: 'owner'};
  if (parts.length === 1 && parts[0] === 'recuperar') return {kind: 'recovery'};
  if (parts.length === 2 && parts[0] === 'procesos' && processIdPattern.test(parts[1])) {
    return {kind: 'tracking', processId: parts[1].toLowerCase()};
  }
  if (parts.length === 2 && parts[0] === 'firmar' && signerTokenPattern.test(parts[1])) {
    return {kind: 'signer', token: parts[1]};
  }
  return {kind: 'not-found'};
}
export type SignerEmailValidation =
  | {ok: true; emails: string[]}
  | {ok: false; message: string};

export function validateSignerEmails(values: string[]): SignerEmailValidation {
  const emails = values.map(value => value.trim().toLowerCase()).filter(Boolean);
  if (emails.length < 1) return {ok: false, message: 'Añade al menos una persona firmante.'};
  if (emails.length > 20) return {ok: false, message: 'Puedes añadir hasta 20 firmantes.'};
  if (emails.some(value => value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
    return {ok: false, message: 'Revisa los correos de las personas firmantes.'};
  }
  if (new Set(emails).size !== emails.length) {
    return {ok: false, message: 'Cada firmante debe tener un correo distinto.'};
  }
  return {ok: true, emails};
}

export function isProcessId(value: string) {
  return processIdPattern.test(value);
}

export type ReceiptPresentation = {tone: 'pending' | 'success' | 'error' | 'neutral'; title: string; canRetry: boolean};

export function receiptPresentation(receipt: {state: string;report?:unknown}): ReceiptPresentation {
  switch (receipt.state) {
    case 'signed_pending_validation':
      return {tone: 'pending', title: 'El envío llegó y sigue en validación.', canRetry: true};
    case 'validated':
      return {tone: 'success', title: 'El servidor confirmó y guardó la firma.', canRetry: false};
    case 'signature_intent_issued':
      return {tone: 'neutral', title: 'No hay una firma guardada para este intento.', canRetry: false};
    case 'rejected':
      return {tone: 'error', title: 'La firma fue rechazada y el turno no avanzó.', canRetry: false};
    case 'expired':
      return {tone: 'error', title: 'El intento caducó sin completar el turno.', canRetry: false};
    default:
      return {tone: 'error', title: 'El intento no pudo completarse.', canRetry: false};
  }
}
