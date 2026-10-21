/**
 * Session boundary for the dedicated v2 API.  The browser obtains an access
 * token from the dedicated v2 Auth project, but the token is never retained in
 * Web Storage by this API: it is exchanged for a host-only HTTP-only cookie.
 */
export interface SessionDependencies {
  verifyAccessToken(token: string, signal: AbortSignal): Promise<string | null>;
  resolveSession?(request:Request,signal:AbortSignal):Promise<{id:string;email:string}|null>;
}

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const response = (code: string, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({code}), {status, headers: {...securityHeaders, ...headers}});

async function body(request: Request): Promise<string> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !request.body) throw Error('INVALID');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  let cancel!: () => void;
  const stopped = new Promise<never>((_, reject) => {cancel = () => {void reader.cancel().catch(() => {}); reject(Error('INVALID'));}; signal.addEventListener('abort', cancel, {once: true});});
  try {
    if (signal.aborted) cancel();
    while (true) {
      const {done, value} = await Promise.race([reader.read(), stopped]);
      if (done) break;
      size += value.length;
      if (size > 8_192) throw Error('INVALID');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function accessToken(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'accessToken') throw Error('INVALID');
  const token = (parsed as {accessToken?: unknown}).accessToken;
  // Supabase JWTs are compact tokens.  Reject controls and oversized values
  // before making an Auth request or reflecting them in Set-Cookie.
  if (typeof token !== 'string' || token.length < 20 || token.length > 8_000 || !/^[A-Za-z0-9._-]+$/.test(token)) throw Error('INVALID');
  return token;
}

/** This is intentionally not mounted in v1.  The host must additionally route
 * only the dedicated v2 origins to it. */
export function createSessionHandler(deps: SessionDependencies, origin: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== origin || url.search || url.pathname !== '/api/v2/session') return response('NOT_FOUND', 404);
    if(request.method==='GET'){
      if(request.headers.get('X-LeapSign-Client')!=='v2')return response('FORBIDDEN',403);
      const user=await deps.resolveSession?.(request,AbortSignal.any([request.signal,AbortSignal.timeout(5_000)]));
      return user?new Response(JSON.stringify({code:'SESSION',id:user.id,email:user.email}),{headers:securityHeaders}):response('UNAUTHENTICATED',401);
    }
    if (request.method === 'DELETE') {
      if (request.headers.get('Origin') !== origin || request.headers.get('X-LeapSign-Client') !== 'v2') return response('FORBIDDEN', 403);
      return response('SIGNED_OUT', 200, {'Set-Cookie': '__Host-leapsign-v2=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});
    }
    if (request.method !== 'POST' || request.headers.get('Origin') !== origin || request.headers.get('X-LeapSign-Client') !== 'v2' || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) return response('FORBIDDEN', 403);
    try {
      const token = accessToken(await body(request));
      const actor = await deps.verifyAccessToken(token, AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]));
      if (!actor) return response('UNAUTHENTICATED', 401);
      return response('SIGNED_IN', 200, {'Set-Cookie': `__Host-leapsign-v2=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`});
    } catch {return response('INVALID_REQUEST', 400);}
  };
}
