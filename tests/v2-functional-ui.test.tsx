import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {FunctionalV2Client, type FunctionalFetch} from '../v2/preview/ui/functional-client';
import {
  FunctionalApp, ProcessProgress, ReceiptRecovery, type FunctionalAppDependencies,
} from '../v2/preview/ui/FunctionalApp';
import {createSupabaseAuthPort, type SupabaseAuthClient} from '../v2/preview/ui/supabase-auth';
import {parseAppRoute, receiptPresentation, validateSignerEmails} from '../v2/preview/ui/model';
import {acceptedReport} from './helpers/validation-report';

const origin = 'https://pruebas.leapsign.app';
const processId = '22222222-2222-4222-8222-222222222222';
const intentId = '33333333-3333-4333-8333-333333333333';
const report = acceptedReport();

describe('v2 functional UI transport', () => {
  it('exchanges an in-memory Auth token for the strict same-origin session', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({code: 'SIGNED_IN'}));
    const client = new FunctionalV2Client({origin, fetch: fetcher as FunctionalFetch});

    await client.exchangeSession('a'.repeat(40));

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(origin + '/api/v2/session');
    expect(init).toMatchObject({method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    expect(new Headers(init?.headers).get('X-LeapSign-Client')).toBe('v2');
    expect(JSON.parse(String(init?.body))).toEqual({accessToken: 'a'.repeat(40)});
  });

  it('creates a process with only PDF bytes and bounded signer metadata', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      id: processId, filename: 'Acuerdo.pdf', status: 'ready_for_signer', signerCount: 2,
    }, {status: 201}));
    const client = new FunctionalV2Client({origin, fetch: fetcher as FunctionalFetch});
    const pdf = new File([new TextEncoder().encode('%PDF-functional')], 'Acuerdo.pdf', {type: 'application/pdf'});

    const created = await client.createProcess({pdf, signers: ['ana@example.test', 'bea@example.test']});

    expect(created.id).toBe(processId);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(origin + '/api/v2/processes');
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('%PDF-functional');
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/pdf');
    expect(decodeURIComponent(headers.get('X-LeapSign-Filename')!)).toBe('Acuerdo.pdf');
    expect(JSON.parse(Buffer.from(headers.get('X-LeapSign-Signers')!, 'base64url').toString('utf8'))).toEqual([
      'ana@example.test', 'bea@example.test',
    ]);
  });

  it('loads private progress and exposes only a same-origin final PDF URL', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: processId, filename: 'Acuerdo.pdf', status: 'completed', signatureCount: 2,
      stages: [
        {ordinal: 1, status: 'validated', current: false},
        {ordinal: 2, status: 'validated', current: false},
      ],
    }));
    const client = new FunctionalV2Client({origin, fetch: fetcher as FunctionalFetch});

    const status = await client.getProcess(processId);

    expect(status.signatureCount).toBe(2);
    expect(fetcher).toHaveBeenCalledWith(origin + `/api/v2/processes/${processId}`, expect.objectContaining({method: 'GET'}));
    expect(client.processPdfUrl(processId)).toBe(origin + `/api/v2/processes/${processId}/pdf`);
  });

  it('requests explicit same-origin owner finalization',async()=>{
    const value={id:processId,filename:'Acuerdo.pdf',status:'completed' as const,signatureCount:2,stages:[{ordinal:1,status:'validated' as const,current:false},{ordinal:2,status:'validated' as const,current:false}]};
    const fetcher=vi.fn(async()=>Response.json(value)) as FunctionalFetch;
    const client=new FunctionalV2Client({origin,fetch:fetcher});
    await expect(client.finalizeProcess(processId)).resolves.toEqual(value);
    expect(fetcher).toHaveBeenCalledWith(origin+`/api/v2/processes/${processId}/finalize`,expect.objectContaining({method:'POST'}));
  });

  it('recovers a validated receipt after the submit response is lost', async () => {
    const fetcher = vi.fn(async () => Response.json({state: 'validated', report})) as FunctionalFetch;
    const client = new FunctionalV2Client({origin, fetch: fetcher});

    const receipt = await client.getReceipt(intentId);

    expect(receipt).toEqual({state: 'validated', report});
    expect(fetcher).toHaveBeenCalledWith(origin + `/api/v2/signing/intents/${intentId}/receipt`, expect.objectContaining({method: 'GET'}));
  });

  it('rejects malformed server objects instead of rendering private or invented fields', async () => {
    const client = new FunctionalV2Client({origin, fetch: vi.fn(async () => Response.json({
      id: processId, filename: 'Acuerdo.pdf', status: 'completed', signerCount: 1, privateKey: 'never',
    }, {status: 201})) as FunctionalFetch});
    const pdf = new File(['%PDF-functional'], 'Acuerdo.pdf', {type: 'application/pdf'});

    await expect(client.createProcess({pdf, signers: ['ana@example.test']})).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  });
});

describe('v2 functional routes and validation', () => {
  it('routes owner, tracking, recovery and token-bound signer views', () => {
    expect(parseAppRoute('/')).toEqual({kind: 'owner'});
    expect(parseAppRoute(`/procesos/${processId}`)).toEqual({kind: 'tracking', processId});
    expect(parseAppRoute(`/firmar/${processId}`)).toEqual({kind: 'signer', token: processId});
    expect(parseAppRoute('/recuperar')).toEqual({kind: 'recovery'});
    expect(parseAppRoute('/firmar/../../private')).toEqual({kind: 'not-found'});
    expect(parseAppRoute(`/verificar/${intentId}`)).toEqual({kind:'verification',receiptId:intentId});
  });

  it('renders the authenticated LeapSign QR verification dimensions',()=>{
    const verificationDependencies:FunctionalAppDependencies={origin,client:new FunctionalV2Client({origin,fetch:vi.fn(async()=>Response.json({code:'UNUSED'})) as FunctionalFetch}),auth:{} as FunctionalAppDependencies['auth'],localSigner:vi.fn(),signingFlags:{DIRECT_P12_SIGNING_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'}};
    const html=renderToStaticMarkup(<FunctionalApp dependencies={verificationDependencies} route={{kind:'verification',receiptId:intentId}} initialUser={{id:'actor',email:'owner@example.test',accessToken:'memory-only'}}/>);
    expect(html).toContain('Verificación técnica LeapSign');
    expect(html).toContain(intentId);
    expect(html).toContain('Confianza de cadena');
    expect(html).toContain('Revocación');
  });

  it('normalizes 1–20 unique signer emails and explains bad input locally', () => {
    expect(validateSignerEmails([' ANA@example.test ', 'bea@example.test'])).toEqual({
      ok: true, emails: ['ana@example.test', 'bea@example.test'],
    });
    expect(validateSignerEmails(['ana@example.test', 'ANA@example.test'])).toEqual({
      ok: false, message: 'Cada firmante debe tener un correo distinto.',
    });
    expect(validateSignerEmails([])).toMatchObject({ok: false});
    expect(validateSignerEmails(Array.from({length: 21}, (_, index) => `p${index}@example.test`))).toMatchObject({ok: false});
  });

  it('turns receipt states into cautious recovery copy', () => {
    expect(receiptPresentation({state: 'signed_pending_validation'})).toEqual({
      tone: 'pending', title: 'El envío llegó y sigue en validación.', canRetry: true,
    });
    expect(receiptPresentation({state: 'validated', report})).toEqual({
      tone: 'success', title: 'El servidor confirmó y guardó la firma.', canRetry: false,
    });
    expect(receiptPresentation({state: 'rejected'})).toMatchObject({tone: 'error', canRetry: false});
  });
});

describe('v2 ephemeral Supabase Auth adapter', () => {
  it('keeps the Auth session in memory and maps only the fields the UI needs', async () => {
    const client = {
      auth: {
        signInWithPassword: vi.fn(async () => ({data: {user: {id: 'actor', email: 'ana@example.test'}, session: {access_token: 'a'.repeat(40)}}, error: null})),
        resetPasswordForEmail: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(),
      },
    } as unknown as SupabaseAuthClient;
    const factory = vi.fn(() => client);
    const auth = createSupabaseAuthPort({url: 'https://v2.supabase.co', publishableKey: 'public-key'}, factory);

    await expect(auth.signIn('ana@example.test', 'only-in-memory')).resolves.toEqual({
      id: 'actor', email: 'ana@example.test', accessToken: 'a'.repeat(40),
    });
    expect(factory).toHaveBeenCalledWith('https://v2.supabase.co', 'public-key', {auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: true,
    }});
  });

  it('supports requesting and completing password recovery without exposing provider errors', async () => {
    const client = {
      auth: {
        signInWithPassword: vi.fn(),
        resetPasswordForEmail: vi.fn(async () => ({data: {}, error: null})),
        getSession: vi.fn(async () => ({data: {session: {access_token: 'a'.repeat(40)}}, error: null})),
        updateUser: vi.fn(async () => ({data: {}, error: null})),
      },
    } as unknown as SupabaseAuthClient;
    const auth = createSupabaseAuthPort({url: 'https://v2.supabase.co', publishableKey: 'public-key'}, () => client);

    await auth.sendRecovery('ana@example.test', origin + '/recuperar');
    await expect(auth.hasRecoverySession()).resolves.toBe(true);
    await auth.updatePassword('new-password-with-length');
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('ana@example.test', {redirectTo: origin + '/recuperar'});
    expect(client.auth.updateUser).toHaveBeenCalledWith({password: 'new-password-with-length'});
  });
});

describe('v2 functional app shell', () => {
  const dependencies: FunctionalAppDependencies = {
    origin,
    client: new FunctionalV2Client({origin, fetch: vi.fn(async()=>Response.json({code:'UNUSED'})) as FunctionalFetch}),
    auth: {} as FunctionalAppDependencies['auth'],
    localSigner: vi.fn(),
    signingFlags: {DIRECT_P12_SIGNING_ENABLED: 'true', FIRMAEC_COMPATIBILITY_PROFILE_ENABLED: 'true'},
  };

  it('renders an accessible login and recovery path without mock/laboratory claims', () => {
    const html = renderToStaticMarkup(<FunctionalApp dependencies={dependencies} route={{kind: 'owner'}}/>);
    expect(html).toContain('Inicia sesión');
    expect(html).toContain('Recuperar acceso');
    expect(html).toMatch(/auto[Cc]omplete="email"/);
    expect(html).not.toMatch(/laboratorio|datos ficticios/i);
  });

  it('keeps the token-bound destination and frog-over-PDF identity visible before login', () => {
    const html = renderToStaticMarkup(<FunctionalApp dependencies={dependencies} route={{kind: 'signer', token: processId}}/>);
    expect(html).toContain('Te han invitado a firmar');
    expect(html).toContain('aria-label="Rana saltando entre documentos PDF"');
    expect(html).toContain('El certificado y su contraseña permanecen en este dispositivo');
  });

  it('does not claim universal legal, trust or revocation validation', () => {
    const html = renderToStaticMarkup(<FunctionalApp dependencies={dependencies} route={{kind: 'owner'}}/>);
    expect(html).toContain('Compatibilidad inicial: certificados encadenados a BCE');
    expect(html).toContain('Integridad criptográfica, confianza de la cadena y revocación son resultados distintos');
    expect(html).toContain('CHAIN_NOT_TRUSTED');
    expect(html).toContain('emisor detectado');
    expect(html).toContain('no subas el certificado por separado');
    expect(html).toContain('no determina por sí sola la identidad, la confianza ni la validez jurídica');
    expect(html).not.toMatch(/firma (100% )?(válida|legal)|validez garantizada/i);
  });

  it('renders the real owner creation task after login and never renders the access token', () => {
    const html = renderToStaticMarkup(<FunctionalApp dependencies={dependencies} route={{kind: 'owner'}} initialUser={{
      id: 'actor', email: 'owner@example.test', accessToken: 'secret-access-token-never-render',
    }}/>);
    expect(html).toContain('Crear un proceso');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".pdf,application/pdf"');
    expect(html).toContain('Correo de la persona 1');
    expect(html).toContain('Añadir otra persona');
    expect(html).toContain('<details');
    expect(html).not.toContain('secret-access-token-never-render');
  });

  it('renders the token-bound local P12/PFX flow through the injected signer port', () => {
    const html = renderToStaticMarkup(<FunctionalApp dependencies={dependencies} route={{kind: 'signer', token: processId}} initialUser={{
      id: 'actor', email: 'signer@example.test', accessToken: 'memory-only',
    }}/>);
    expect(html).toContain('Tu turno de firma');
    expect(html).toContain('Abrir documento');
    expect(html).toContain('accept=".p12,.pfx"');
    expect(html).toContain('El certificado y la contraseña se usan sólo en memoria');
  });

  it('shows sequential progress and final download without signer identifiers', () => {
    const html = renderToStaticMarkup(<ProcessProgress client={dependencies.client} status={{
      id: processId, filename: 'Acuerdo.pdf', status: 'completed', signatureCount: 2,
      stages: [
        {ordinal: 1, status: 'validated', current: false},
        {ordinal: 2, status: 'validated', current: false},
      ],
    }}/>);
    expect(html.replace(/<[^>]+>/g, '')).toContain('2 de 2 firmas guardadas');
    expect(html).toContain('Descargar PDF final');
    expect(html).toContain(`/api/v2/processes/${processId}/pdf`);
    expect(html).not.toContain('@');
  });

  it('does not present final review as completed and requires the owner action',()=>{
    const html=renderToStaticMarkup(<ProcessProgress client={dependencies.client} onFinalize={()=>{}} status={{id:processId,filename:'Acuerdo.pdf',status:'final_review',signatureCount:2,stages:[{ordinal:1,status:'validated',current:false},{ordinal:2,status:'validated',current:false}]}}/>);
    expect(html).toContain('Aprobar y cerrar proceso');
    expect(html).not.toContain('Descargar PDF final');
    expect(html).not.toContain('status-completed');
  });

  it('offers explicit receipt lookup after an uncertain submission', () => {
    const html = renderToStaticMarkup(<ReceiptRecovery client={dependencies.client} intentId={intentId}/>);
    expect(html).toContain('No vuelvas a firmar todavía');
    expect(html).toContain('Consultar resultado');
  });
});
