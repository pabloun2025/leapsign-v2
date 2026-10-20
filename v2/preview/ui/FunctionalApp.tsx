import {useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {SigningPanel} from '../../../src/v2/SigningPanel';
import {V2HttpSigningApi} from '../../../src/v2/http-api';
import type {SigningFlags} from '../../../src/v2/policy';
import {SigningWorkflow, type LocalSigner} from '../../../src/v2/signing-workflow';
import type {AuthPort, AuthenticatedUser} from './supabase-auth';
import type {CreatedProcess, FunctionalV2Client, ProcessStatus, Receipt} from './functional-client';
import {receiptPresentation, validateSignerEmails, type AppRoute} from './model';

export type FunctionalAppDependencies = {
  origin: string;
  client: FunctionalV2Client;
  auth: AuthPort;
  localSigner: LocalSigner;
  signingFlags: SigningFlags;
};

function FrogTrail() {
  return <div className="frog-trail" role="img" aria-label="Rana saltando entre documentos PDF">
    <span className="pdf-leaf" aria-hidden="true">PDF</span>
    <span className="hop-line" aria-hidden="true"/>
    <span className="frog-hop" aria-hidden="true">🐸</span>
    <span className="hop-line hop-line-last" aria-hidden="true"/>
    <span className="pdf-leaf pdf-leaf-next" aria-hidden="true">PDF</span>
  </div>;
}

function LoginView({dependencies, route, onSignedIn}: {
  dependencies: FunctionalAppDependencies;
  route: AppRoute;
  onSignedIn: (user: AuthenticatedUser) => void;
}) {
  const id = useId();
  const [recovering, setRecovering] = useState(route.kind === 'recovery');
  const [changingPassword, setChangingPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (route.kind !== 'recovery') return;
    let active = true;
    void dependencies.auth.hasRecoverySession().then(value => {if (active) setChangingPassword(value);}).catch(() => {});
    return () => {active = false;};
  }, [dependencies.auth, route.kind]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    try {
      if (changingPassword) {
        await dependencies.auth.updatePassword(String(data.get('new-password') ?? ''));
        setChangingPassword(false); setRecovering(false);
        setMessage('Contraseña actualizada. Ya puedes iniciar sesión.');
      } else if (recovering) {
        await dependencies.auth.sendRecovery(email, `${dependencies.origin}/recuperar`);
        setMessage('Si el correo pertenece a una cuenta, recibirás instrucciones para recuperar el acceso.');
      } else {
        const user = await dependencies.auth.signIn(email, String(data.get('password') ?? ''));
        await dependencies.client.exchangeSession(user.accessToken);
        onSignedIn(user);
      }
    } catch {
      setMessage(changingPassword ? 'No pudimos actualizar la contraseña. Solicita otro enlace.' : recovering
        ? 'No pudimos solicitar la recuperación. Inténtalo de nuevo.'
        : 'No pudimos iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
    } finally { setBusy(false); }
  };
  const signer = route.kind === 'signer';
  return <main className="auth-layout">
    <section className="auth-story" aria-labelledby={`${id}-welcome`}>
      <a className="wordmark" href="/" aria-label="LeapSign, inicio">Leap<span>Sign</span></a>
      <FrogTrail/>
      <p className="eyebrow">FIRMA SECUENCIAL DE PDF</p>
      <h1 id={`${id}-welcome`}>{signer ? 'Te han invitado a firmar' : 'Documentos que avanzan, firma a firma.'}</h1>
      <p>{signer
        ? 'Accede con el mismo correo de la invitación para revisar y firmar tu turno.'
        : 'Prepara un PDF, ordena a las personas firmantes y sigue cada salto hasta la versión final.'}</p>
      {signer && <p className="local-promise"><span aria-hidden="true">●</span> El certificado y su contraseña permanecen en este dispositivo.</p>}
    </section>
    <section className="auth-card" aria-labelledby={`${id}-form-title`}>
      <p className="step-kicker">ACCESO SEGURO · V2</p>
      <h2 id={`${id}-form-title`}>{changingPassword ? 'Crea una contraseña nueva' : recovering ? 'Recuperar acceso' : 'Inicia sesión'}</h2>
      <p>{changingPassword ? 'El enlace de recuperación está listo.' : recovering ? 'Te enviaremos un enlace al correo de tu cuenta.' : 'Usa tu cuenta de LeapSign v2.'}</p>
      <form onSubmit={submit}>
        {changingPassword ? <>
          <label htmlFor={`${id}-new-password`}>Nueva contraseña</label>
          <input id={`${id}-new-password`} name="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={4096}/>
        </> : <>
          <label htmlFor={`${id}-email`}>Correo</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254}/>
          {!recovering && <><label htmlFor={`${id}-password`}>Contraseña</label><input id={`${id}-password`} name="password" type="password" autoComplete="current-password" required maxLength={4096}/></>}
        </>}
        <button type="submit" disabled={busy}>{busy ? 'Espera un momento…' : changingPassword ? 'Guardar contraseña' : recovering ? 'Enviar enlace' : 'Entrar'}</button>
      </form>
      {!changingPassword && <button className="text-button" type="button" onClick={() => {setRecovering(value => !value); setMessage('');}}>
        {recovering ? 'Volver a iniciar sesión' : 'Recuperar acceso'}
      </button>}
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  </main>;
}

function AppHeader({user, onSignOut}: {user: AuthenticatedUser; onSignOut: () => void}) {
  return <header className="app-header">
    <a className="wordmark" href="/" aria-label="LeapSign, inicio">Leap<span>Sign</span></a>
    <nav aria-label="Cuenta"><span className="account-email">{user.email}</span><button className="text-button" type="button" onClick={onSignOut}>Salir</button></nav>
  </header>;
}

function StagePill({stage}: {stage: ProcessStatus['stages'][number]}) {
  const label = stage.status === 'validated' ? 'Firma guardada' : stage.current ? 'Turno actual' : 'En espera';
  return <li className={`stage-pill stage-${stage.status}${stage.current ? ' is-current' : ''}`}>
    <span className="stage-number" aria-hidden="true">{stage.ordinal}</span>
    <span><strong>Persona {stage.ordinal}</strong><small>{label}</small></span>
  </li>;
}

export function ProcessProgress({client, status}: {client: FunctionalV2Client; status: ProcessStatus}) {
  const complete = status.status === 'completed' || status.status === 'final_review';
  return <section className="progress-card" aria-labelledby="process-progress-title">
    <div className="section-heading">
      <div><p className="step-kicker">PROCESO {status.id.slice(0, 8).toUpperCase()}</p><h2 id="process-progress-title">{status.filename}</h2></div>
      <span className={`status-badge status-${status.status}`}>{status.status==='final_review'?'Listo para revisión':complete ? 'Completado' : status.status === 'failed' ? 'Necesita atención' : 'En curso'}</span>
    </div>
    <p className="progress-count"><strong>{status.signatureCount} de {status.stages.length}</strong> firmas guardadas</p>
    <div className="progress-meter" role="progressbar" aria-label="Firmas guardadas" aria-valuemin={0} aria-valuemax={status.stages.length} aria-valuenow={status.signatureCount}>
      <span style={{width: `${Math.round(status.signatureCount / status.stages.length * 100)}%`}}/>
    </div>
    <ol className="stage-list">{status.stages.map(stage => <StagePill key={stage.ordinal} stage={stage}/>)}</ol>
    {complete && <a className="button-link" href={client.processPdfUrl(status.id)} download>Descargar PDF final <span aria-hidden="true">↓</span></a>}
    <details className="quiet-details"><summary>Qué significa este estado</summary><p>LeapSign muestra únicamente turnos aceptados por el servidor. La validación técnica no sustituye una comprobación jurídica o de identidad.</p></details>
  </section>;
}

function OwnerWorkspace({dependencies}: {dependencies: FunctionalAppDependencies}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [signers, setSigners] = useState(['']);
  const [selectedName, setSelectedName] = useState('');
  const [created, setCreated] = useState<CreatedProcess>();
  const [status, setStatus] = useState<ProcessStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('');
    const checked = validateSignerEmails(signers);
    const pdf = file.current?.files?.[0];
    if (!checked.ok) {setMessage(checked.message); return;}
    if (!pdf) {setMessage('Selecciona el PDF que quieres firmar.'); return;}
    setBusy(true);
    try {
      const value = await dependencies.client.createProcess({pdf, signers: checked.emails});
      setCreated(value);
      setStatus({id: value.id, filename: value.filename, status: value.status, signatureCount: 0,
        stages: checked.emails.map((_email, index) => ({ordinal: index + 1, status: 'ready_for_signer', current: index === 0}))});
      setMessage('Proceso creado. Comparte el enlace con las personas firmantes en el orden indicado.');
    } catch {setMessage('No pudimos crear el proceso. Revisa el PDF y vuelve a intentarlo.');}
    finally {setBusy(false);}
  };
  const signingUrl = created ? `${dependencies.origin}/firmar/${created.id}` : '';
  return <main className="workspace-main">
    <section className="workspace-intro">
      <div><p className="eyebrow">PANEL DE PROPIETARIO</p><h1>Un PDF. Un turno cada vez.</h1><p>Define el orden y conserva un enlace de seguimiento privado.</p></div>
      <FrogTrail/>
    </section>
    <div className="workspace-grid">
      <details className="task-card creation-card" open={!created}>
        <summary><span><small>PASO 1</small> Crear un proceso</span><span aria-hidden="true">＋</span></summary>
        <form onSubmit={create}>
          <label htmlFor={`${id}-pdf`}>Documento PDF</label>
          <input ref={file} id={`${id}-pdf`} type="file" accept=".pdf,application/pdf" required onChange={event => setSelectedName(event.target.files?.[0]?.name ?? '')}/>
          <p className="field-help">{selectedName || 'PDF de hasta 10 MB. El original se conserva como primera versión.'}</p>
          <fieldset><legend>Personas firmantes, en orden</legend>
            {signers.map((value, index) => <div className="signer-row" key={index}>
              <span className="signer-order" aria-hidden="true">{index + 1}</span>
              <label className="sr-only" htmlFor={`${id}-signer-${index}`}>Correo de la persona {index + 1}</label>
              <input id={`${id}-signer-${index}`} type="email" value={value} placeholder={`Correo de la persona ${index + 1}`} required maxLength={254} onChange={event => setSigners(current => current.map((email, at) => at === index ? event.target.value : email))}/>
              {signers.length > 1 && <button className="icon-button" type="button" aria-label={`Quitar persona ${index + 1}`} onClick={() => setSigners(current => current.filter((_email, at) => at !== index))}>×</button>}
            </div>)}
          </fieldset>
          <button className="secondary-button" type="button" disabled={signers.length >= 20} onClick={() => setSigners(current => [...current, ''])}>Añadir otra persona</button>
          <button type="submit" disabled={busy}>{busy ? 'Creando proceso…' : 'Crear proceso'}</button>
        </form>
      </details>
      <section className={`task-card share-card${created ? ' is-active' : ' is-inactive'}`} aria-labelledby={`${id}-share-title`}>
        <p className="step-kicker">PASO 2</p><h2 id={`${id}-share-title`}>Compartir y seguir</h2>
        {created ? <>
          <p>Envía este enlace únicamente a las personas incluidas. El correo autenticado decide quién puede usar cada turno.</p>
          <label htmlFor={`${id}-link`}>Enlace de firma</label><div className="copy-row"><input id={`${id}-link`} value={signingUrl} readOnly/><button type="button" onClick={() => {void navigator.clipboard?.writeText(signingUrl).then(() => setMessage('Enlace copiado.')).catch(() => setMessage('Copia el enlace manualmente.'));}}>Copiar</button></div>
          <a className="button-link secondary-link" href={`/procesos/${created.id}`}>Abrir seguimiento</a>
        </> : <p>Esta sección se activará cuando el PDF y la lista estén listos.</p>}
      </section>
    </div>
    {message && <p className="workspace-message" role="status">{message}</p>}
    {status && <ProcessProgress client={dependencies.client} status={status}/>}
    <details className="quiet-details owner-help"><summary>Privacidad y límites de la validación</summary><p>Los certificados se usan en el dispositivo de cada firmante. LeapSign recibe el PDF resultante y aplica su política técnica; no promete compatibilidad o validez universal.</p></details>
  </main>;
}

function TrackingWorkspace({dependencies, processId}: {dependencies: FunctionalAppDependencies; processId: string}) {
  const [status, setStatus] = useState<ProcessStatus>();
  const [message, setMessage] = useState('Cargando seguimiento…');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {setStatus(await dependencies.client.getProcess(processId, signal)); setMessage('');}
    catch {if (!signal?.aborted) setMessage('No pudimos actualizar el proceso. Comprueba el enlace e inténtalo de nuevo.');}
  }, [dependencies.client, processId]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => {void refresh();}, 20_000);
    return () => {controller.abort(); window.clearInterval(timer);};
  }, [refresh]);
  return <main className="workspace-main narrow-workspace">
    <div className="tracking-heading"><div><p className="eyebrow">SEGUIMIENTO PRIVADO</p><h1>Así avanza el documento</h1></div><button className="secondary-button" type="button" onClick={() => {void refresh();}}>Actualizar</button></div>
    {message && <p className="workspace-message" role="status">{message}</p>}
    {status && <ProcessProgress client={dependencies.client} status={status}/>}
    <details className="quiet-details"><summary>Identificador del proceso</summary><code>{processId}</code></details>
  </main>;
}

export function ReceiptRecovery({client, intentId}: {client: FunctionalV2Client; intentId: string}) {
  const [value, setValue] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recover = useCallback(async () => {
    setBusy(true); setError('');
    try {setValue(await client.getReceipt(intentId));}
    catch {setError('No pudimos consultar el recibo. Inténtalo de nuevo antes de volver a firmar.');}
    finally {setBusy(false);}
  }, [client, intentId]);
  useEffect(() => {void recover();}, [recover]);
  const presentation = value ? receiptPresentation(value) : undefined;
  return <aside className="receipt-recovery" aria-labelledby="receipt-title">
    <p className="step-kicker">RECUPERACIÓN DE ENVÍO</p><h2 id="receipt-title">No vuelvas a firmar todavía</h2>
    <p>La respuesta se interrumpió y el servidor puede haber guardado la firma. Consulta el recibo del mismo intento.</p>
    {presentation && <p className={`receipt-result tone-${presentation.tone}`} role="status">{presentation.title}</p>}
    {value?.state === 'validated' && <p className="receipt-detail">Se guardó la firma número {value.report.signatureCount}. La política técnica aceptó el PDF; este recibo no certifica por sí solo identidad o validez jurídica.</p>}
    {error && <p className="form-message" role="alert">{error}</p>}
    {(!presentation || presentation.canRetry) && <button type="button" disabled={busy} onClick={() => {void recover();}}>{busy ? 'Consultando…' : 'Consultar resultado'}</button>}
  </aside>;
}

function SignerWorkspace({dependencies, user, token}: {dependencies: FunctionalAppDependencies; user: AuthenticatedUser; token: string}) {
  const flow = useMemo(() => new SigningWorkflow({
    actorId: user.id,
    origin: dependencies.origin,
    flags: dependencies.signingFlags,
    api: new V2HttpSigningApi({origin: dependencies.origin, flags: dependencies.signingFlags}),
    localSigner: dependencies.localSigner,
  }), [dependencies.localSigner, dependencies.origin, dependencies.signingFlags, user.id]);
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  return <main className="signer-workspace">
    <div className="signer-context"><p><span aria-hidden="true">●</span> Sesión de {user.email}</p><p>El P12/PFX y su contraseña no salen de este dispositivo.</p></div>
    <SigningPanel flow={flow} preparation={{documentId: token, profile: 'firmaec-qr-compatible', position: {page: 0, x: 0, y: 0, width: 250, height: 82}}} title="Documento para firma"/>
    {state.outcomeUnknown && state.intentId && <ReceiptRecovery client={dependencies.client} intentId={state.intentId}/>}
  </main>;
}

function NotFound() {
  return <main className="not-found"><FrogTrail/><p className="eyebrow">ENLACE NO DISPONIBLE</p><h1>Esta ruta no corresponde a un proceso.</h1><a className="button-link" href="/">Volver al inicio</a></main>;
}

export function FunctionalApp({dependencies, route, initialUser}: {
  dependencies: FunctionalAppDependencies;
  route: AppRoute;
  initialUser?: AuthenticatedUser;
}) {
  const [user, setUser] = useState<AuthenticatedUser | undefined>(initialUser);
  const signOut = async () => {try {await dependencies.client.deleteSession();} finally {setUser(undefined);}};
  if (route.kind === 'not-found') return <div className="leapsign-app"><NotFound/></div>;
  return <div className="leapsign-app">
    {user ? <>
      <AppHeader user={user} onSignOut={() => {void signOut();}}/>
      {route.kind === 'signer' ? <SignerWorkspace dependencies={dependencies} user={user} token={route.token}/>
        : route.kind === 'tracking' ? <TrackingWorkspace dependencies={dependencies} processId={route.processId}/>
        : <OwnerWorkspace dependencies={dependencies}/>}
    </> : <LoginView dependencies={dependencies} route={route} onSignedIn={setUser}/>}
    <footer className="legal-note">La validación técnica comprueba el PDF recibido según la política publicada; no determina por sí sola la identidad, la confianza ni la validez jurídica.</footer>
  </div>;
}

export type {AuthenticatedUser};
