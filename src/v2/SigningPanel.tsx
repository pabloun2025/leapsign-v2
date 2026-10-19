import {useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode} from 'react';
import type {PrepareSigningInput} from './contracts';
import {SigningWorkflow} from './signing-workflow';
import {PdfPreview} from './PdfPreview';
import './signing-panel.css';

/** Reusable v2 screen; not mounted in v1. A trusted PDF renderer may be supplied
 * by the v2 host. No unsafe HTML, PDF scripts or third-party iframe is embedded.
 * Without a renderer, the honest fallback is explicit review by download. */
export function SigningPanel({flow, preparation, title, preview}: {
  flow: SigningWorkflow; preparation: PrepareSigningInput; title: string; preview?: ReactNode;
}) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const [url, setUrl] = useState<string>();
  const [downloaded, setDownloaded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [fileError, setFileError] = useState('');
  const [canonical, setCanonical] = useState<Uint8Array>();
  const [previewReady, setPreviewReady] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const certInput = useRef<HTMLInputElement>(null);
  const externalInput = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const id = useId();
  const ready = state.phase === 'ready';
  const busy = ['preparing', 'signing', 'validating'].includes(state.phase);
  const enabled = state.directEnabled || state.externalEnabled;

  useEffect(() => {
    const bytes = flow.canonicalCopy();
    setDownloaded(false); setReviewed(false); setPreviewReady(false); setCanonical(bytes);
    if (!bytes) {setUrl(undefined); return;}
    const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], {type: 'application/pdf'}));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [flow, state.intentId]);
  useEffect(() => {
    if (state.message || fileError) status.current?.focus();
  }, [state.message, fileError]);
  // The host owns the controller. Cancellation also supports StrictMode's
  // effect remount without permanently disposing a host-owned instance.
  useEffect(() => () => {flow.cancel();}, [flow]);
  const clearCertificate = () => {setPassword(''); setVisible(false); if (certInput.current) certInput.current.value = '';};
  const closeCertificate = () => {clearCertificate(); dialog.current?.close();};
  const prepare = () => {setFileError(''); void flow.prepare(preparation).catch(() => {});};
  const local = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const certificate = certInput.current?.files?.[0];
    if (!certificate) return;
    const data = new FormData(event.currentTarget);
    const operation = flow.signLocal({certificate, password, reason: String(data.get('reason') ?? ''), location: String(data.get('location') ?? '')});
    closeCertificate(); // Clear DOM/state immediately, not after the API returns.
    void operation.catch(() => {});
  };
  const external = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFileError('');
    const file = externalInput.current?.files?.[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || file.size < 5 || file.size > 10 * 1024 * 1024) {setFileError('Selecciona un PDF firmado de hasta 10 MB.'); return;}
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await flow.submitExternal(bytes);
    } catch {
      if (flow.getSnapshot().phase === 'ready' && !flow.getSnapshot().message) setFileError('No se pudo leer el PDF. Selecciónalo de nuevo.');
    } finally {if (externalInput.current) externalInput.current.value = '';}
  };
  const feedback = <div ref={status} tabIndex={-1} className={`ls-v2-feedback${state.phase === 'validated' ? ' ls-v2-feedback-success' : ''}`} role={state.phase === 'validated' ? 'status' : 'alert'}>{fileError || state.message || ''}</div>;
  return <section className="ls-v2" aria-labelledby={`${id}-title`}>
    <header className="ls-v2-header">
      <div><p className="ls-v2-eyebrow">LEAPSIGN · FIRMA DE DOCUMENTOS</p><h1 id={`${id}-title`}>{title}</h1></div>
      <span className="ls-v2-badge">{state.phase === 'validated' ? 'Firma completada' : 'Tu turno de firma'}</span>
    </header>
    <ol className="ls-v2-steps" aria-label="Pasos de firma">
      {['Revisar documento', 'Firmar', 'Validar y guardar'].map((label, index) => <li key={label} aria-current={(busy && state.phase !== 'preparing' ? index === (state.phase === 'validating' ? 2 : 1) : index === 0) && state.phase !== 'validated' ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}
    </ol>
    {!enabled ? <p className="ls-v2-notice" role="status">La firma de documentos todavía no está habilitada.</p> : <>
      {!state.outcomeUnknown && ['idle', 'cancelled', 'expired', 'failed'].includes(state.phase) && <div className="ls-v2-start"><p>Abre el PDF para revisar el documento antes de firmarlo.</p><button type="button" onClick={prepare}>Abrir documento</button></div>}
      {state.phase === 'preparing' && <p className="ls-v2-notice" role="status">Preparando tu documento…</p>}
      {url && !['cancelled', 'expired', 'failed'].includes(state.phase) && <div className="ls-v2-layout">
        <div className="ls-v2-document">
          <div className="ls-v2-document-title"><span>Documento para revisar</span><span>PDF</span></div>
          {preview ?? (canonical && <PdfPreview pdf={canonical} position={preparation.position} onReviewedPage={() => setPreviewReady(true)} onUnavailable={() => setPreviewReady(false)}/>)}
          <a className="ls-v2-download" href={url} download={state.filename} onClick={() => setDownloaded(true)}>Descargar documento PDF <span aria-hidden="true">↓</span></a>
        </div>
        <div className="ls-v2-actions">
          {state.phase === 'validated' ? <div className="ls-v2-success"><span aria-hidden="true">✓</span><h2>Tu firma está guardada</h2><p>Ya puedes cerrar esta página.</p></div> : <>
            <h2>Firma el documento</h2>
            <label className="ls-v2-review"><input type="checkbox" checked={reviewed} disabled={!ready || (!preview && !previewReady && !downloaded)} onChange={event => setReviewed(event.target.checked)}/><span>He revisado el PDF y quiero firmarlo.</span></label>
            {state.directEnabled && <div className="ls-v2-method"><h3>Con tu certificado</h3><p>Usa un archivo .p12 o .pfx. No necesitas descargar y volver a subir el PDF firmado.</p><button type="button" disabled={!ready || !reviewed} onClick={() => {clearCertificate(); dialog.current?.showModal();}}>Firmar con certificado</button><small>El certificado y su contraseña no se envían al servidor. No admite tokens físicos.</small></div>}
            {state.externalEnabled && <form className="ls-v2-method ls-v2-external" onSubmit={external}><h3>{state.directEnabled ? 'O usa tu aplicación de firma' : 'Con tu aplicación de firma'}</h3><p>Firma el PDF descargado con FirmaEC, Adobe u otra herramienta y carga el resultado.</p><label htmlFor={`${id}-external`}>PDF firmado</label><input id={`${id}-external`} ref={externalInput} type="file" accept=".pdf,application/pdf" required disabled={!ready || !reviewed || !downloaded}/><button type="submit" disabled={!ready || !reviewed || !downloaded}>Subir y validar firma</button></form>}
            {busy && <p className="ls-v2-progress" role="status"><span aria-hidden="true"/>{state.phase === 'validating' ? 'Comprobando la firma y guardando el documento…' : 'Firmando en este dispositivo…'}</p>}
            {feedback}
            <button className="ls-v2-secondary" type="button" disabled={state.phase === 'validating'} onClick={() => flow.cancel()}>Cancelar</button>
          </>}
        </div>
      </div>}
      {(!url || ['cancelled', 'expired', 'failed', 'validated'].includes(state.phase)) && feedback}
    </>}
    <footer className="ls-v2-footer">La firma se completa cuando el servidor valida y guarda el PDF. LeapSign no sustituye la comprobación de identidad ni determina por sí solo su validez jurídica.</footer>
    <dialog className="ls-v2-dialog" ref={dialog} aria-labelledby={`${id}-certificate-title`} onCancel={closeCertificate}>
      <form onSubmit={local}>
        <div className="ls-v2-dialog-heading"><h2 id={`${id}-certificate-title`}>Firma con certificado</h2><button type="button" className="ls-v2-secondary" aria-label="Cerrar" onClick={closeCertificate}>×</button></div>
        <p>Selecciona tu certificado en este dispositivo.</p>
        <label htmlFor={`${id}-cert`}>Certificado .p12 o .pfx</label><input id={`${id}-cert`} type="file" ref={certInput} accept=".p12,.pfx" required/>
        <label htmlFor={`${id}-password`}>Contraseña del certificado</label><div className="ls-v2-password"><input id={`${id}-password`} type={visible ? 'text' : 'password'} value={password} maxLength={4096} autoComplete="off" onChange={event => setPassword(event.target.value)}/><button type="button" className="ls-v2-secondary" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? 'Ocultar' : 'Mostrar'}</button></div>
        <label htmlFor={`${id}-reason`}>Motivo <small>Opcional</small></label><input id={`${id}-reason`} name="reason" maxLength={500}/>
        <label htmlFor={`${id}-location`}>Lugar <small>Opcional</small></label><input id={`${id}-location`} name="location" maxLength={200}/>
        <p className="ls-v2-privacy">El certificado y la contraseña se usan sólo en memoria y se descartan al terminar. No se guardan para la próxima firma.</p>
        <button type="submit">Firmar este documento</button>
      </form>
    </dialog>
  </section>;
}
