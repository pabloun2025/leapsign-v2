import {useEffect, useRef, useState} from 'react';
import {getDocument, PDFWorker, type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {SignaturePosition} from './contracts';
import {MAX_PDF_BYTES} from './policy';

class NoNetworkPdfDataFactory {
  async fetch() {throw new Error('External PDF resources are disabled');}
}

/** Canvas/text only: no PDF JavaScript, attachments, interactive annotations,
 * iframes, external URL loading, telemetry or certificate material. PDF.js gets
 * a COPY of canonical bytes; the signing source is never modified or detached.
 */
export function PdfPreview({pdf, position, onReviewedPage, onUnavailable}: {
  pdf: Uint8Array; position?: SignaturePosition; onReviewedPage?: () => void; onUnavailable?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({onReviewedPage, onUnavailable});
  callbacks.current = {onReviewedPage, onUnavailable};
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageNumber, setPageNumber] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [text, setText] = useState('');
  const [marker, setMarker] = useState<{left: number; top: number; width: number; height: number}>();

  useEffect(() => {
    if (!container.current) return;
    if (typeof ResizeObserver !== 'function') {setWidth(Math.max(160, container.current.clientWidth)); return;}
    const observer = new ResizeObserver(entries => {setWidth(Math.max(160, Math.floor(entries[0].contentRect.width)));});
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setDocument(undefined); setPageNumber(1); setError(false); setBusy(true); setText('');
    if (pdf.length < 5 || pdf.length > MAX_PDF_BYTES) {setError(true); setBusy(false); callbacks.current.onUnavailable?.(); return;}
    let port: Worker | undefined; let worker: PDFWorker | undefined; let loading: PDFDocumentLoadingTask;
    try {
      port = new Worker(workerUrl, {type: 'module'});
      worker = PDFWorker.create({port, verbosity: 0});
      loading = getDocument({
        data: new Uint8Array(pdf), worker, verbosity: 0, stopAtErrors: true,
        enableXfa: false, useWorkerFetch: false, useWasm: false,
        BinaryDataFactory: NoNetworkPdfDataFactory,
        disableAutoFetch: true, disableRange: true, disableStream: true,
        useSystemFonts: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 24_000_000,
      });
    } catch {
      worker?.destroy(); port?.terminate(); setError(true); setBusy(false); callbacks.current.onUnavailable?.(); return;
    }
    const fail = () => {if (active) {setError(true); setBusy(false); callbacks.current.onUnavailable?.();} void loading.destroy().catch(() => {}); port?.terminate();};
    loading.onPassword = fail; // Encrypted canonical PDFs are unsupported, not a second credential form.
    const timeout = setTimeout(fail, 15_000);
    void loading.promise.then(doc => {
      clearTimeout(timeout);
      if (!active) return;
      if (doc.numPages < 1 || doc.numPages > 500) {fail(); return;}
      setDocument(doc);
    }).catch(fail);
    return () => {active = false; clearTimeout(timeout); void loading.destroy().catch(() => {}); worker?.destroy(); port?.terminate();};
  }, [pdf]);

  useEffect(() => {
    if (!document || !canvas.current || error) return;
    let active = true; let render: RenderTask | undefined;
    setBusy(true); setText(''); setMarker(undefined);
    const timeout = setTimeout(() => {if (active) {render?.cancel(); setBusy(false); setError(true); callbacks.current.onUnavailable?.();}}, 10_000);
    void document.getPage(pageNumber).then(async page => {
      if (!active || !canvas.current) return;
      const base = page.getViewport({scale: 1, rotation: (page.rotate + rotation) % 360});
      if (![base.width, base.height].every(Number.isFinite) || base.width < 1 || base.height < 1 || base.width > 14400 || base.height > 14400) throw new Error('Preview geometry limit');
      const scale = Math.min(width / base.width, 2) * zoom;
      const viewport = page.getViewport({scale, rotation: (page.rotate + rotation) % 360});
      if (viewport.height > 16000 || viewport.width > 16000) throw new Error('Preview dimension limit');
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2, 8192 / viewport.width, 8192 / viewport.height, Math.sqrt(6_000_000 / (viewport.width * viewport.height)));
      canvas.current.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.current.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.current.style.width = `${viewport.width}px`; canvas.current.style.height = `${viewport.height}px`;
      render = page.render({canvas: canvas.current, viewport, transform: ratio === 1 ? undefined : [ratio,0,0,ratio,0,0]});
      await render.promise;
      if (!active) return;
      if (position?.page === pageNumber) {
        const start = viewport.convertToViewportPoint(position.x, position.y);
        const end = viewport.convertToViewportPoint(position.x + position.width, position.y + position.height);
        const rect = [start[0], start[1], end[0], end[1]];
        setMarker({left: Math.min(rect[0], rect[2]), top: Math.min(rect[1], rect[3]), width: Math.abs(rect[2] - rect[0]), height: Math.abs(rect[3] - rect[1])});
      }
      callbacks.current.onReviewedPage?.();
      setBusy(false); clearTimeout(timeout);
      const content = await page.getTextContent();
      if (active) setText(content.items.map(item => 'str' in item ? item.str : '').join(' ').slice(0, 65536));
    }).catch(() => {if (active) {setBusy(false); setError(true); callbacks.current.onUnavailable?.();}});
    return () => {active = false; clearTimeout(timeout); render?.cancel();};
  }, [document, pageNumber, rotation, zoom, width, error, position?.page, position?.x, position?.y, position?.width, position?.height]);

  return <div className="ls-v2-pdf" ref={container}>
    {error ? <p role="status">No se pudo mostrar este PDF. Puedes descargarlo para revisarlo.</p> : <>
      <nav className="ls-v2-pdf-toolbar" aria-label="Páginas del documento">
        <button type="button" className="ls-v2-secondary" aria-label="Página anterior" disabled={!document || pageNumber <= 1 || busy} onClick={() => setPageNumber(n => n - 1)}>←</button>
        <span aria-live="polite">Página {pageNumber}{document ? ` de ${document.numPages}` : ''}</span>
        <button type="button" className="ls-v2-secondary" aria-label="Página siguiente" disabled={!document || pageNumber >= document.numPages || busy} onClick={() => setPageNumber(n => n + 1)}>→</button>
        <button type="button" className="ls-v2-secondary" disabled={!document || busy} onClick={() => setRotation(n => (n + 90) % 360)}>Girar</button>
        <button type="button" className="ls-v2-secondary" aria-label="Reducir PDF" disabled={!document || busy || zoom <= 1} onClick={() => setZoom(n => n - .25)}>−</button>
        <button type="button" className="ls-v2-secondary" aria-label="Ampliar PDF" disabled={!document || busy || zoom >= 2} onClick={() => setZoom(n => n + .25)}>+</button>
      </nav>
      {busy && <p className="ls-v2-pdf-loading" role="status">Mostrando documento…</p>}
      <div className="ls-v2-pdf-scroll"><div className="ls-v2-pdf-page"><canvas ref={canvas} aria-label={`Documento PDF, página ${pageNumber}`} role="img"/>{marker && !busy && <span className="ls-v2-signature-marker" style={marker}>Área de firma</span>}</div></div>
      {text && <details className="ls-v2-pdf-text"><summary>Leer texto de esta página</summary><p>{text}</p></details>}
    </>}
  </div>;
}
