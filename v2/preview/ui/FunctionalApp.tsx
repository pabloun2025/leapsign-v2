import {useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {SigningPanel} from '../../../src/v2/SigningPanel';
import {V2HttpSigningApi} from '../../../src/v2/http-api';
import type {SigningFlags} from '../../../src/v2/policy';
import {SigningWorkflow, type LocalSigner} from '../../../src/v2/signing-workflow';
import type {AuthPort, AuthenticatedUser} from './supabase-auth';
import type {AdminAudit,AdminUser,Contact,CreatedProcess,FunctionalV2Client,ProcessStatus,ProcessSummary,ProcessVersion,Receipt} from './functional-client';
import {receiptPresentation, validateSignerEmails, type AppRoute} from './model';
import {QueueArcade} from './QueueArcade';
import frogBrand from '../../../public/frog-brand.webp?url';
import frogSigning from '../../../public/frog-signing.webp?url';

export type FunctionalAppDependencies = {
  origin: string;
  client: FunctionalV2Client;
  auth: AuthPort;
  localSigner: LocalSigner;
  signingFlags: SigningFlags;
};
const sha256=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

function FrogTrail() {
  return <div className="frog-trail" role="img" aria-label="Rana saltando entre documentos PDF">
    <span className="pdf-leaf" aria-hidden="true">PDF</span>
    <span className="hop-line" aria-hidden="true"/>
    <img className="frog-hop" src={frogSigning} alt="" aria-hidden="true"/>
    <span className="hop-line hop-line-last" aria-hidden="true"/>
    <span className="pdf-leaf pdf-leaf-next" aria-hidden="true">PDF</span>
  </div>;
}

function Brand() {
  return <a className="wordmark" href="/" aria-label="LeapSign, inicio">
    <span className="brand-mark"><img src={frogBrand} alt=""/></span><span className="brand-name">LeapSign</span>
  </a>;
}

function LoginView({dependencies, route, onSignedIn}: {
  dependencies: FunctionalAppDependencies;
  route: AppRoute;
  onSignedIn: (user: AuthenticatedUser) => void;
}) {
  const id = useId();
  const registering = route.kind === 'register';
  const confirming = route.kind === 'confirmation';
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
  useEffect(()=>{if(!confirming)return;let active=true;void dependencies.auth.restore().then(async restored=>{if(!active)return;if(!restored){setMessage('El enlace de confirmación expiró o ya fue utilizado. Solicita uno nuevo desde el registro.');return;}await dependencies.client.exchangeSession(restored.accessToken);if(active)onSignedIn(restored);}).catch(()=>{if(active)setMessage('El enlace de confirmación expiró o ya fue utilizado. Solicita uno nuevo desde el registro.');});return()=>{active=false;};},[confirming,dependencies.auth,dependencies.client,onSignedIn]);
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
      } else if (registering) {
        await dependencies.auth.signUp({email,password:String(data.get('password')??''),firstName:String(data.get('first-name')??''),lastName:String(data.get('last-name')??'')},`${dependencies.origin}/confirmar`);
        setMessage('Revisa tu correo para confirmar la cuenta. El enlace puede usarse una sola vez.');
      } else if (recovering) {
        await dependencies.auth.sendRecovery(email, `${dependencies.origin}/recuperar`);
        setMessage('Si el correo pertenece a una cuenta, recibirás instrucciones para recuperar el acceso.');
      } else {
        const user = await dependencies.auth.signIn(email, String(data.get('password') ?? ''));
        await dependencies.client.exchangeSession(user.accessToken);
        onSignedIn(user);
      }
    } catch {
      setMessage(changingPassword ? 'No pudimos actualizar la contraseña. Solicita otro enlace.' : registering
        ? 'No pudimos completar el registro. Revisa los campos o inténtalo más tarde.' : recovering
        ? 'No pudimos solicitar la recuperación. Inténtalo de nuevo.'
        : 'No pudimos iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
    } finally { setBusy(false); }
  };
  const signer = route.kind === 'signer';
  return <main className="auth-layout">
    <section className="auth-story" aria-labelledby={`${id}-welcome`}>
      <Brand/>
      <FrogTrail/>
      <p className="eyebrow">FIRMA SECUENCIAL DE PDF</p>
      <h1 id={`${id}-welcome`}>{signer ? 'Te han invitado a firmar' : registering ? 'Tu cuenta para dar el primer salto.' : confirming ? 'Confirma tu correo para continuar.' : 'Documentos que avanzan, firma a firma.'}</h1>
      <p>{signer
        ? 'Accede con el mismo correo de la invitación para revisar y firmar tu turno.'
        : 'Prepara un PDF, ordena a las personas firmantes y sigue cada salto hasta la versión final.'}</p>
      {signer && <p className="local-promise"><span aria-hidden="true">●</span> El certificado y su contraseña permanecen en este dispositivo.</p>}
    </section>
    <section className="auth-card" aria-labelledby={`${id}-form-title`}>
      <p className="step-kicker">ACCESO SEGURO · V2</p>
      <h2 id={`${id}-form-title`}>{changingPassword ? 'Crea una contraseña nueva' : recovering ? 'Recuperar acceso' : registering ? 'Crea tu cuenta' : confirming ? 'Correo confirmado' : 'Inicia sesión'}</h2>
      <p>{changingPassword ? 'El enlace de recuperación está listo.' : recovering ? 'Te enviaremos un enlace al correo de tu cuenta.' : 'Usa tu cuenta de LeapSign v2.'}</p>
      {confirming ? <><p>{message||'Comprobando el enlace de confirmación…'}</p><a className="button-link" href="/">Ir al inicio de sesión</a></> : <form onSubmit={submit}>
        {changingPassword ? <>
          <label htmlFor={`${id}-new-password`}>Nueva contraseña</label>
          <input id={`${id}-new-password`} name="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={4096}/>
        </> : <>
          {registering && <div className="name-fields"><div><label htmlFor={`${id}-first-name`}>Nombres</label><input id={`${id}-first-name`} name="first-name" autoComplete="given-name" required maxLength={80}/></div><div><label htmlFor={`${id}-last-name`}>Apellidos</label><input id={`${id}-last-name`} name="last-name" autoComplete="family-name" required maxLength={120}/></div></div>}
          <label htmlFor={`${id}-email`}>Correo</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254}/>
          {!recovering && <><label htmlFor={`${id}-password`}>Contraseña</label><input id={`${id}-password`} name="password" type="password" autoComplete={registering?'new-password':'current-password'} required minLength={registering?12:1} maxLength={4096}/>{registering&&<small>12 caracteres como mínimo, con mayúscula, minúscula y número.</small>}</>}
        </>}
        <button type="submit" disabled={busy}>{busy ? 'Espera un momento…' : changingPassword ? 'Guardar contraseña' : recovering ? 'Enviar enlace' : registering ? 'Crear cuenta' : 'Entrar'}</button>
      </form>}
      {!changingPassword && !registering && !confirming && <button className="text-button" type="button" onClick={() => {setRecovering(value => !value); setMessage('');}}>
        {recovering ? 'Volver a iniciar sesión' : 'Recuperar acceso'}
      </button>}
      {!changingPassword&&!recovering&&!confirming&&<p className="auth-switch">{registering?'¿Ya tienes cuenta?':'¿Aún no tienes cuenta?'} <a href={registering?'/':'/registro'}>{registering?'Inicia sesión':'Crear cuenta'}</a></p>}
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  </main>;
}

function AppHeader({user,guest,onSignOut}: {user: AuthenticatedUser;guest?:boolean; onSignOut: () => void}) {
  return <header className="app-header">
    <Brand/>
    <nav aria-label="Cuenta">{!guest&&<><a href="/">Procesos</a><a href="/perfil">Perfil</a><a href="/administracion">Administración</a></>}<span className="account-email">{user.email}</span><button className="text-button" type="button" onClick={onSignOut}>Salir</button></nav>
  </header>;
}

function StagePill({stage}: {stage: ProcessStatus['stages'][number]}) {
  const label = stage.status === 'validated' ? 'Firma guardada' : stage.current ? 'Turno actual' : 'En espera';
  return <li className={`stage-pill stage-${stage.status}${stage.current ? ' is-current' : ''}`}>
    <span className="stage-number" aria-hidden="true">{stage.ordinal}</span>
    <span><strong>Persona {stage.ordinal}</strong><small>{label}</small></span>
  </li>;
}

export function ProcessProgress({client, status,onFinalize}: {client: FunctionalV2Client; status: ProcessStatus;onFinalize?:()=>void}) {
  const complete = status.status === 'completed';
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
    {status.status==='final_review'&&onFinalize&&<button type="button" onClick={onFinalize}>Aprobar y cerrar proceso</button>}
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
  const[mode,setMode]=useState<'directed'|'open_queue'>('directed');const[processMessage,setProcessMessage]=useState('');const[expected,setExpected]=useState('');const[accessSecret,setAccessSecret]=useState('');const[contacts,setContacts]=useState<Contact[]>([]);const[saveContacts,setSaveContacts]=useState(false);
  const[processes,setProcesses]=useState<ProcessSummary[]>([]);useEffect(()=>{void Promise.all([dependencies.client.listContacts().then(setContacts),dependencies.client.listProcesses().then(setProcesses)]).catch(()=>{});},[dependencies.client]);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('');
    const checked = mode==='open_queue'?{ok:true as const,emails:[]}:validateSignerEmails(signers);
    const pdf = file.current?.files?.[0];
    if (!checked.ok) {setMessage(checked.message); return;}
    if (!pdf) {setMessage('Selecciona el PDF que quieres firmar.'); return;}
    setBusy(true);
    try {
      const value = await dependencies.client.createProcess({pdf,signers:checked.emails,mode,message:processMessage,expectedSignatures:mode==='open_queue'&&expected?Number(expected):null,accessSecretHash:mode==='open_queue'&&accessSecret?await sha256(accessSecret):null});
      if(mode==='directed'&&saveContacts)await Promise.allSettled(checked.emails.map(email=>dependencies.client.saveContact(email,'')));
      setCreated(value);
      setStatus({id: value.id, filename: value.filename, status: value.status, signatureCount: 0,
        stages: checked.emails.length?checked.emails.map((_email,index)=>({ordinal:index+1,status:'ready_for_signer' as const,current:index===0})):[{ordinal:1,status:'ready_for_signer',current:false}]});
      setMessage(mode==='open_queue'?'Ronda abierta creada. Comparte el enlace para que cada persona tome un turno.':'Proceso creado. Las invitaciones se enviarán en el orden indicado.');
    } catch {setMessage('No pudimos crear el proceso. Revisa el PDF y vuelve a intentarlo.');}
    finally {setBusy(false);}
  };
  const signingUrl = created ? `${dependencies.origin}/${mode==='open_queue'?'ronda':'procesos'}/${created.id}` : '';
  return <main className="workspace-main">
    <section className="workspace-intro">
      <div><p className="eyebrow">MESA DOCUMENTAL</p><h1>Un PDF. Dos maneras de hacerlo avanzar.</h1><p>Organiza firmas dirigidas o abre una ronda; cada firmante elige certificado local o firma externa.</p></div>
      <FrogTrail/>
    </section>
    <div className="workspace-grid">
      <details className="task-card creation-card" open={!created}>
        <summary><span><small>PASO 1</small> Crear un proceso</span><span aria-hidden="true">＋</span></summary>
        <form onSubmit={create}>
          <label htmlFor={`${id}-pdf`}>Documento PDF</label>
          <input ref={file} id={`${id}-pdf`} type="file" accept=".pdf,application/pdf" required onChange={event => setSelectedName(event.target.files?.[0]?.name ?? '')}/>
          <p className="field-help">{selectedName || 'PDF de hasta 10 MB. El original se conserva como primera versión.'}</p>
          <fieldset className="mode-picker"><legend>Tipo de proceso</legend><label><input type="radio" name="mode" checked={mode==='directed'} onChange={()=>setMode('directed')}/> Firma dirigida</label><label><input type="radio" name="mode" checked={mode==='open_queue'} onChange={()=>setMode('open_queue')}/> Ronda abierta</label></fieldset>
          <label htmlFor={`${id}-message`}>Mensaje para las personas firmantes <small>Opcional</small></label><textarea id={`${id}-message`} maxLength={2000} value={processMessage} onChange={event=>setProcessMessage(event.target.value)}/>
          {mode==='directed'?<fieldset><legend>Personas firmantes, en orden</legend>
            {signers.map((value, index) => <div className="signer-row" key={index}>
              <span className="signer-order" aria-hidden="true">{index + 1}</span>
              <label className="sr-only" htmlFor={`${id}-signer-${index}`}>Correo de la persona {index + 1}</label>
              <input id={`${id}-signer-${index}`} type="email" value={value} placeholder={`Correo de la persona ${index + 1}`} required maxLength={254} onChange={event => setSigners(current => current.map((email, at) => at === index ? event.target.value : email))}/>
              {signers.length > 1 && <button className="icon-button" type="button" aria-label={`Quitar persona ${index + 1}`} onClick={() => setSigners(current => current.filter((_email, at) => at !== index))}>×</button>}
            </div>)}
          </fieldset>:<fieldset><legend>Configuración de la ronda</legend><label htmlFor={`${id}-expected`}>Número previsto de firmas <small>Opcional</small></label><input id={`${id}-expected`} type="number" min="1" max="20" value={expected} onChange={event=>setExpected(event.target.value)}/><label htmlFor={`${id}-access`}>Clave de acceso <small>Opcional</small></label><input id={`${id}-access`} type="password" autoComplete="new-password" maxLength={200} value={accessSecret} onChange={event=>setAccessSecret(event.target.value)}/><small>Solo se envía un hash; conserva la clave para compartirla.</small></fieldset>}
          {mode==='directed'&&<><button className="secondary-button" type="button" disabled={signers.length >= 20} onClick={() => setSigners(current => [...current, ''])}>Añadir otra persona</button><label className="save-contact"><input type="checkbox" checked={saveContacts} onChange={event=>setSaveContacts(event.target.checked)}/> Guardar en contactos frecuentes</label>{contacts.length>0&&<details className="contact-agenda"><summary>Elegir contactos frecuentes ({contacts.length})</summary><div>{contacts.map(contact=><button className="contact-chip" type="button" key={contact.id} onClick={()=>setSigners(current=>current.includes(contact.email)?current:[...current.filter(Boolean),contact.email])}>{contact.displayName||contact.email}</button>)}</div></details>}</>}
          <button type="submit" disabled={busy}>{busy ? 'Creando proceso…' : 'Crear proceso'}</button>
        </form>
      </details>
      <section className={`task-card share-card${created ? ' is-active' : ' is-inactive'}`} aria-labelledby={`${id}-share-title`}>
        <p className="step-kicker">PASO 2</p><h2 id={`${id}-share-title`}>Compartir y seguir</h2>
        {created ? <>
          <p>{mode==='open_queue'?'Quien tenga este enlace podrá entrar a la cola y tomar un turno cuando llegue a la primera posición.':'Las invitaciones personales se envían por correo; este enlace abre el seguimiento del propietario.'}</p>
          <label htmlFor={`${id}-link`}>Enlace de firma</label><div className="copy-row"><input id={`${id}-link`} value={signingUrl} readOnly/><button type="button" onClick={() => {void navigator.clipboard?.writeText(signingUrl).then(() => setMessage('Enlace copiado.')).catch(() => setMessage('Copia el enlace manualmente.'));}}>Copiar</button></div>
          <div className="share-actions"><a className="button-link secondary-link" href={`/procesos/${created.id}`}>Abrir seguimiento</a><a className="button-link whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Firma ${created.filename}: ${signingUrl}`)}`}>Compartir por WhatsApp</a><a className="button-link secondary-link" href={`mailto:?subject=${encodeURIComponent('Firma pendiente en LeapSign')}&body=${encodeURIComponent(signingUrl)}`}>Compartir por correo</a></div>
        </> : <p>Esta sección se activará cuando el PDF y la lista estén listos.</p>}
      </section>
    </div>
    {message && <p className="workspace-message" role="status">{message}</p>}
    {status && <ProcessProgress client={dependencies.client} status={status}/>}
    <section className="task-card process-board"><div className="section-heading"><div><p className="step-kicker">MIS PROCESOS</p><h2>Agenda y seguimiento</h2></div><span className="status-badge">{processes.length} procesos</span></div>{processes.length?<div className="process-list">{processes.map(process=><a key={process.id} href={`/procesos/${process.id}`}><span><strong>{process.filename}</strong><small>{process.mode==='open_queue'?'Ronda abierta':'Firma dirigida'} · {new Date(process.createdAt).toLocaleDateString('es-EC')}</small></span><span>{process.signatureCount} firmas · {process.status}</span></a>)}</div>:<p>Tus procesos nuevos aparecerán aquí para continuar el seguimiento.</p>}</section>
    <details className="quiet-details owner-help"><summary>Privacidad y límites de la validación</summary><p>Los certificados se usan en el dispositivo de cada firmante. LeapSign recibe el PDF resultante y aplica su política técnica; no promete compatibilidad o validez universal.</p></details>
  </main>;
}

function TrackingWorkspace({dependencies, processId}: {dependencies: FunctionalAppDependencies; processId: string}) {
  const [status, setStatus] = useState<ProcessStatus>();
  const[versions,setVersions]=useState<ProcessVersion[]>([]);const[shareUrl,setShareUrl]=useState('');
  const [message, setMessage] = useState('Cargando seguimiento…');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {const[next,history]=await Promise.all([dependencies.client.getProcess(processId,signal),dependencies.client.listVersions(processId,signal)]);setStatus(next);setVersions(history);setMessage('');}
    catch {if (!signal?.aborted) setMessage('No pudimos actualizar el proceso. Comprueba el enlace e inténtalo de nuevo.');}
  }, [dependencies.client, processId]);
  const finalize=useCallback(async()=>{setMessage('Cerrando el proceso…');try{setStatus(await dependencies.client.finalizeProcess(processId));setMessage('Proceso cerrado. El PDF final ya está disponible.');}catch{setMessage('No pudimos cerrar el proceso. Confirma que todas las firmas estén guardadas.');}},[dependencies.client,processId]);
  const action=useCallback(async(value:'pause'|'resume'|'release_turn'|'cancel'|'purge')=>{setMessage('Aplicando acción…');try{await dependencies.client.processAction(processId,value);await refresh();setMessage('Acción registrada en el historial.');}catch{setMessage('No pudimos completar la acción.');}},[dependencies.client,processId,refresh]);
  const rollback=useCallback(async(versionId:string)=>{setMessage('Restaurando versión…');try{await dependencies.client.processAction(processId,'rollback',versionId,'Restauración solicitada por el propietario');await refresh();setMessage('Versión restaurada; los intentos anteriores quedaron invalidados.');}catch{setMessage('No pudimos restaurar esa versión.');}},[dependencies.client,processId,refresh]);
  const share=useCallback(async()=>{try{const value=await dependencies.client.createFinalShare(processId);setShareUrl(value.url);setMessage('Enlace final creado por 48 horas.');}catch{setMessage('El enlace final solo está disponible para un proceso completado.');}},[dependencies.client,processId]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => {void refresh();}, 20_000);
    return () => {controller.abort(); window.clearInterval(timer);};
  }, [refresh]);
  return <main className="workspace-main narrow-workspace">
    <div className="tracking-heading"><div><p className="eyebrow">SEGUIMIENTO PRIVADO</p><h1>Así avanza el documento</h1></div><button className="secondary-button" type="button" onClick={() => {void refresh();}}>Actualizar</button></div>
    {message && <p className="workspace-message" role="status">{message}</p>}
    {status && <ProcessProgress client={dependencies.client} status={status} onFinalize={status.status==='final_review'?()=>{void finalize();}:undefined}/>}
    {status&&<section className="task-card lifecycle-card"><p className="step-kicker">CONTROL DEL PROCESO</p><h2>Agenda, incidencias e historial</h2><div className="lifecycle-actions"><button className="secondary-button" onClick={()=>void action('pause')}>Pausar</button><button className="secondary-button" onClick={()=>void action('resume')}>Reanudar</button><button className="secondary-button" onClick={()=>void action('release_turn')}>Liberar turno</button><button className="danger-button" onClick={()=>void action('cancel')}>Cancelar</button></div><details open><summary>Historial de versiones ({versions.length})</summary><ol className="version-list">{versions.map(version=><li key={version.id}><span><strong>Firma {version.signatureCount}</strong><small>{new Date(version.createdAt).toLocaleString('es-EC')} · {version.sha256.slice(0,12)}…</small></span>{version.current?<em>Actual</em>:<button className="text-button" onClick={()=>void rollback(version.id)}>Restaurar</button>}</li>)}</ol></details>{status.status==='completed'&&<div className="final-share"><button onClick={()=>void share()}>Crear enlace final</button>{shareUrl&&<><input readOnly value={shareUrl}/><a className="button-link whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Documento final: ${shareUrl}`)}`}>WhatsApp</a></>}</div>}<details><summary>Zona de eliminación</summary><p>La purga se procesa de forma segura y conserva el registro técnico mínimo.</p><button className="danger-button" onClick={()=>void action('purge')}>Solicitar eliminación</button></details></section>}
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

function RoundWorkspace({dependencies,processId,onClaimed}:{dependencies:FunctionalAppDependencies;processId:string;onClaimed:(user:AuthenticatedUser)=>void}){const[id]=useState(processId),[access,setAccess]=useState(''),[round,setRound]=useState<Awaited<ReturnType<FunctionalV2Client['roundAccess']>>>(),[queue,setQueue]=useState<Awaited<ReturnType<FunctionalV2Client['queueState']>>>(),[message,setMessage]=useState('Consulta la ronda para entrar en la cola.');const load=async()=>{try{const hash=access?await sha256(access):null;setRound(await dependencies.client.roundAccess(id,hash));setMessage('Ronda disponible.');}catch{setMessage('La ronda no está disponible o la clave no es correcta.');}};const join=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const hash=access?await sha256(access):null;setQueue(await dependencies.client.joinQueue(id,{email:String(data.get('email')||'').trim().toLowerCase()||null,displayName:String(data.get('name')||'').trim()||null,accessSecretHash:hash}));setMessage('Ya estás en la cola. Esta página actualizará tu posición.');}catch{setMessage('No fue posible entrar en la cola.');}};useEffect(()=>{if(!queue||queue.status!=='waiting')return;const timer=window.setInterval(()=>{void dependencies.client.queueState(id).then(setQueue).catch(()=>{});},8000);return()=>window.clearInterval(timer);},[dependencies.client,id,queue]);const claim=async()=>{try{await dependencies.client.claimTurn(id);const guest=await dependencies.client.restoreGuest();onClaimed({id:guest.actorId,email:guest.email,accessToken:'guest-session'});history.replaceState(null,'',`/firmar/proceso/${id}`);}catch{setMessage('El turno aún no está disponible. Mantén esta página abierta.');}};return <main className="workspace-main narrow-workspace"><p className="eyebrow">RONDA ABIERTA</p><h1>{round?.filename??'Mesa de firmas'}</h1>{round?.message&&<blockquote>{round.message}</blockquote>}<p role="status" className="workspace-message">{message}</p>{!round?<section className="task-card"><label htmlFor="round-access">Clave de acceso <small>Si fue configurada</small></label><input id="round-access" type="password" autoComplete="off" value={access} onChange={event=>setAccess(event.target.value)}/><button onClick={()=>void load()}>Consultar ronda</button></section>:!queue?<form className="task-card" onSubmit={join}><h2>Entrar en la cola</h2><label htmlFor="queue-name">Nombre visible <small>Opcional</small></label><input id="queue-name" name="name" maxLength={120}/><label htmlFor="queue-email">Correo <small>Para avisarte del turno</small></label><input id="queue-email" name="email" type="email" maxLength={254}/><button>Tomar un lugar</button></form>:<><section className="progress-card"><p className="step-kicker">TU POSICIÓN</p><h2>{queue.status==='active'?'Tu turno está listo':`Lugar ${queue.position} en la cola`}</h2><p>{round.signatureCount} firmas recibidas{round.expectedSignatures?` de ${round.expectedSignatures} previstas`:''}.</p><button disabled={queue.status!=='active'&&queue.position!==1} onClick={()=>void claim()}>Abrir mi turno de firma</button><button className="secondary-button" onClick={()=>void dependencies.client.releaseTurn(id).then(()=>setMessage('Saliste de la cola.'))}>Salir de la cola</button></section><QueueArcade client={dependencies.client}/></>}</main>}

function FinalDownloadWorkspace({dependencies,shareId}:{dependencies:FunctionalAppDependencies;shareId:string}){const[message,setMessage]=useState('Preparando el documento final…');useEffect(()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token')??'';void dependencies.client.downloadFinalShare(shareId,token).then(bytes=>{const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download='LeapSign-final.pdf';link.click();URL.revokeObjectURL(url);setMessage('Descarga iniciada. El enlace es temporal y no muestra datos de participantes.');}).catch(()=>setMessage('El enlace final expiró, fue revocado o no es válido.'));},[dependencies.client,shareId]);return <main className="not-found"><FrogTrail/><p className="eyebrow">DOCUMENTO FINAL</p><h1>Descarga privada</h1><p role="status">{message}</p></main>}

function LegalWorkspace({page}:{page:'privacidad'|'seguridad'|'condiciones'}){const copy={privacidad:['Privacidad','Los PDFs se almacenan de forma privada. El P12/PFX y su contraseña permanecen en el navegador y nunca se incluyen en solicitudes, registros ni telemetría.'],seguridad:['Seguridad','El P12/PFX y su contraseña permanecen en el navegador. Cada firma se valida contra el PDF vigente, conserva las firmas anteriores y usa idempotencia para evitar duplicados. La revocación desconocida o inaccesible falla cerrado.'],condiciones:['Condiciones de uso','LeapSign informa por separado integridad criptográfica, confianza de cadena, vigencia y revocación. El software no determina por sí solo el resultado jurídico.']}[page];return <main className="workspace-main narrow-workspace"><p className="eyebrow">LEAPSIGN V2</p><h1>{copy[0]}</h1><section className="task-card"><p>{copy[1]}</p><p><strong>Compatibilidad inicial:</strong> certificados encadenados a BCE.</p><a href="/">Volver a LeapSign</a></section></main>}

function NotFound() {
  return <main className="not-found"><FrogTrail/><p className="eyebrow">ENLACE NO DISPONIBLE</p><h1>Esta ruta no corresponde a un proceso.</h1><a className="button-link" href="/">Volver al inicio</a></main>;
}

function ProfileWorkspace({user}:{user:AuthenticatedUser}){return <main className="workspace-main narrow-workspace"><p className="eyebrow">MI CUENTA</p><h1>Perfil</h1><section className="task-card"><h2>Datos de acceso</h2><p><strong>Correo:</strong> {user.email}</p><p>La contraseña se administra con Supabase Auth y nunca es visible para LeapSign.</p><a className="button-link" href="/recuperar">Cambiar contraseña</a></section></main>}
function AdministrationWorkspace({client}:{client:FunctionalV2Client}){const[users,setUsers]=useState<AdminUser[]>([]);const[audit,setAudit]=useState<AdminAudit[]>([]);const[search,setSearch]=useState('');const[page,setPage]=useState(1);const[total,setTotal]=useState(0);const[message,setMessage]=useState('Cargando usuarios autorizados…');const load=useCallback(async()=>{setMessage('Cargando usuarios autorizados…');try{const[result,events]=await Promise.all([client.listAdminUsers(page,search),client.listAdminAudit(1)]);setUsers(result.users);setTotal(result.total);setAudit(events);setMessage(result.users.length?'':'No hay usuarios para esta búsqueda.');}catch{setMessage('No tienes acceso administrativo o el servicio no está disponible.');}},[client,page,search]);useEffect(()=>{void load();},[load]);const invite=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget;const email=String(new FormData(form).get('email')??'');try{await client.inviteAdminUser(email);form.reset();setMessage('Invitación enviada sin establecer contraseña.');await load();}catch{setMessage('No pudimos enviar la invitación.');}};const act=async(id:string,action:'resend'|'recover'|'suspend'|'reactivate')=>{try{await client.adminUserAction(id,action);setMessage('Acción registrada.');await load();}catch{setMessage('No pudimos completar la acción.');}};return <main className="workspace-main"><p className="eyebrow">ACCESO RESTRINGIDO</p><h1>Administración de usuarios</h1><section className="task-card"><h2>Usuarios de LeapSign v2</h2><p>Los permisos se verifican con el rol administrativo del servidor. Ningún administrador puede ver ni establecer contraseñas.</p><form className="admin-invite" onSubmit={invite}><label htmlFor="admin-invite-email">Invitar por correo</label><input id="admin-invite-email" name="email" type="email" required maxLength={254}/><button type="submit">Enviar invitación</button></form><label htmlFor="admin-search">Buscar por correo</label><div className="copy-row"><input id="admin-search" type="search" value={search} onChange={event=>setSearch(event.target.value)}/><button type="button" onClick={()=>{setPage(1);void load();}}>Buscar</button></div><p role="status">{message}</p><div className="admin-table" role="region" aria-label="Usuarios" tabIndex={0}><table><thead><tr><th>Correo</th><th>Estado</th><th>Creado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody>{users.map(item=><tr key={item.id}><td>{item.email}</td><td>{item.status}</td><td>{new Date(item.createdAt).toLocaleDateString('es-EC')}</td><td>{item.lastSignInAt?new Date(item.lastSignInAt).toLocaleDateString('es-EC'):'—'}</td><td><button type="button" className="text-button" onClick={()=>void act(item.id,'recover')}>Recuperar</button><button type="button" className="text-button" onClick={()=>void act(item.id,item.status==='suspended'?'reactivate':'suspend')}>{item.status==='suspended'?'Reactivar':'Suspender'}</button></td></tr>)}</tbody></table></div><nav className="admin-pagination" aria-label="Paginación"><button type="button" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page}</span><button type="button" disabled={page*50>=total} onClick={()=>setPage(value=>value+1)}>Siguiente</button></nav><details className="quiet-details"><summary>Auditoría administrativa</summary><ul>{audit.map(event=><li key={event.id}>{event.action} · {event.targetEmail??event.targetUserId??'usuario'} · {new Date(event.createdAt).toLocaleString('es-EC')}</li>)}</ul></details></section></main>}
function ErrorWorkspace({status}:{status:401|403|503}){const copy=status===401?'Tu sesión expiró. Inicia sesión otra vez.':status===403?'No tienes permiso para abrir esta sección.':'El servicio no está disponible por el momento.';return <main className="not-found"><FrogTrail/><p className="eyebrow">ERROR {status}</p><h1>{copy}</h1><a className="button-link" href="/">Volver al inicio</a></main>}

function VerificationWorkspace({dependencies,receiptId}:{dependencies:FunctionalAppDependencies;receiptId:string}){
 const[value,setValue]=useState<Awaited<ReturnType<FunctionalV2Client['getVerification']>>>();const[message,setMessage]=useState('Consultando el recibo técnico…');
 useEffect(()=>{const controller=new AbortController();void dependencies.client.getVerification(receiptId,controller.signal).then(result=>{setValue(result);setMessage('');}).catch(()=>{if(!controller.signal.aborted)setMessage('No pudimos verificar este recibo con la sesión actual.');});return()=>controller.abort();},[dependencies.client,receiptId]);
 return <main className="workspace-main narrow-workspace"><div className="tracking-heading"><div><p className="eyebrow">RECIBO {receiptId.slice(0,8).toUpperCase()}</p><h1>Verificación técnica LeapSign</h1></div></div>{message&&<p className="workspace-message" role="status">{message}</p>}<section className="progress-card"><h2>Resultado del PDF</h2><dl><dt>Proceso</dt><dd>{value?.processId??'—'}</dd><dt>Hash SHA-256</dt><dd><code>{value?.signedSha256??'—'}</code></dd><dt>Firmante</dt><dd>{value?.signer??'—'}</dd><dt>Fecha de validación</dt><dd>{value?.validatedAt??'—'}</dd><dt>Integridad criptográfica</dt><dd>{value?.checks.cryptographicIntegrity??'—'}</dd><dt>Confianza de cadena</dt><dd>{value?.checks.trusted??'—'}</dd><dt>Revocación</dt><dd>{value?.revocation??'—'}</dd><dt>Recibo</dt><dd>{receiptId}</dd></dl><p>Este resultado técnico no determina por sí solo validez jurídica.</p></section></main>;
}

export function FunctionalApp({dependencies, route, initialUser}: {
  dependencies: FunctionalAppDependencies;
  route: AppRoute;
  initialUser?: AuthenticatedUser;
}) {
  const [user, setUser] = useState<AuthenticatedUser | undefined>(initialUser);
  const [signerDocument,setSignerDocument]=useState(route.kind==='signer-session'?route.processId:route.kind==='signer'&&initialUser?route.token:'');
  const [sessionMessage,setSessionMessage]=useState('');
  useEffect(()=>{
    if(initialUser)return;let active=true;const restore=async()=>{try{
      if(route.kind==='signer'){await dependencies.client.deleteSession().catch(()=>{});const guest=await dependencies.client.exchangeGuest(route.token);if(!active)return;setUser({id:guest.actorId,email:guest.email,accessToken:'guest-session'});setSignerDocument(guest.documentId);history.replaceState(null,'',`/firmar/proceso/${guest.documentId}`);return;}
      if(route.kind==='signer-session'){const guest=await dependencies.client.restoreGuest();if(!active)return;setUser({id:guest.actorId,email:guest.email,accessToken:'guest-session'});setSignerDocument(guest.documentId);return;}
      if(route.kind==='verification'){try{const owner=await dependencies.client.restoreOwnerSession();if(active){setUser(owner);return;}}catch{}try{const guest=await dependencies.client.restoreGuest();if(active){setUser({id:guest.actorId,email:guest.email,accessToken:'guest-session'});return;}}catch{}}
      if(route.kind==='recovery'||route.kind==='confirmation'||route.kind==='register')return;
      try{const serverUser=await dependencies.client.restoreOwnerSession();if(active){setUser(serverUser);return;}}catch{}
      const restored=await dependencies.auth.restore();if(restored&&active){await dependencies.client.exchangeSession(restored.accessToken);setUser(restored);}
    }catch{if(active&&(route.kind==='signer'||route.kind==='signer-session'))setSessionMessage('La invitación expiró, ya fue utilizada o el turno todavía no está disponible.');}};void restore();const stop=dependencies.auth.subscribe?.((next,event)=>{if(!active)return;if(next&&event==='TOKEN_REFRESHED')void dependencies.client.exchangeSession(next.accessToken).then(()=>setUser(next)).catch(()=>setUser(undefined));if(!next&&event==='SIGNED_OUT'){setUser(undefined);void dependencies.client.deleteSession().catch(()=>{});}});return()=>{active=false;stop?.();};
  },[dependencies.auth,dependencies.client,initialUser,route]);
  const guest=user?.accessToken==='guest-session';
  const signOut = async () => {try {if(guest)await dependencies.client.deleteGuestSession();else try{await dependencies.auth.signOut();}finally{await dependencies.client.deleteSession();}} finally {setUser(undefined);}};
  if (route.kind === 'not-found') return <div className="leapsign-app"><NotFound/></div>;
  return <div className="leapsign-app">
    <aside className="compatibility-notice" role="note"><strong>Compatibilidad inicial: certificados encadenados a BCE.</strong> Integridad criptográfica, confianza de la cadena y revocación son resultados distintos. LeapSign no declara por sí solo validez jurídica.</aside>
    {route.kind==='legal'?<LegalWorkspace page={route.page}/>:route.kind==='final'?<FinalDownloadWorkspace dependencies={dependencies} shareId={route.shareId}/>:route.kind==='round'&&!signerDocument?<RoundWorkspace dependencies={dependencies} processId={route.processId} onClaimed={next=>{setUser(next);setSignerDocument(route.processId);}}/>:user ? <>
      <AppHeader user={user} guest={guest} onSignOut={() => {void signOut();}}/>
      {(route.kind === 'signer'||route.kind==='signer-session'||route.kind==='round')&&signerDocument ? <SignerWorkspace dependencies={dependencies} user={user} token={signerDocument}/>
        : route.kind === 'tracking' ? <TrackingWorkspace dependencies={dependencies} processId={route.processId}/>
        : route.kind === 'verification' ? <VerificationWorkspace dependencies={dependencies} receiptId={route.receiptId}/>
        : route.kind==='profile'?<ProfileWorkspace user={user}/>
        : route.kind==='administration'?<AdministrationWorkspace client={dependencies.client}/>
        : route.kind==='error'?<ErrorWorkspace status={route.status}/>
        : <OwnerWorkspace dependencies={dependencies}/>}
    </> : sessionMessage?<main className="not-found"><FrogTrail/><h1>Enlace de firma no disponible</h1><p role="alert">{sessionMessage}</p></main>:route.kind==='error'?<ErrorWorkspace status={route.status}/>:<LoginView dependencies={dependencies} route={route} onSignedIn={setUser}/>}
    <footer className="legal-note"><p>La validación técnica comprueba el PDF recibido según la política publicada; no determina por sí sola la identidad, la confianza ni la validez jurídica. Para otros emisores se mostrará CHAIN_NOT_TRUSTED y el emisor detectado desde el PDF firmado; no subas el certificado por separado.</p><nav aria-label="Información legal"><a href="/privacidad">Privacidad</a><a href="/seguridad">Seguridad</a><a href="/condiciones">Condiciones</a></nav></footer>
  </div>;
}

export type {AuthenticatedUser};
