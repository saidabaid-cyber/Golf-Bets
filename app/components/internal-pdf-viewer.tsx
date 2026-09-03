"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { OfficialRulesDocument } from "../../lib/rules-documents";

export function InternalPdfViewer({ document, initialPage = 1, onBack }: { document: OfficialRulesDocument; initialPage?: number; onBack: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(350);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [pageText, setPageText] = useState("");
  useEffect(() => {
    let disposed = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setError(""); setLoading(true);
    import("pdfjs-dist/legacy/build/pdf.mjs").then(async library => {
      if (disposed) return;
      library.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      let loadingTask = library.getDocument({ url: document.localUrl });
      task = loadingTask;
      let loaded: PDFDocumentProxy;
      try { loaded = await loadingTask.promise; }
      catch (error) {
        if (disposed) return;
        await loadingTask.destroy();
        if (disposed) return;
        // Some official CDNs reject server-side requests from Vercel. These
        // public PDFs permit CORS: retry from the device, still in our canvas
        // viewer, without navigating away or exposing server credentials.
        loadingTask = library.getDocument({ url: document.officialUrl });
        task = loadingTask;
        try { loaded = await loadingTask.promise; } catch { throw error; }
      }
      if (!disposed) { setPdf(loaded); setPage(Math.min(Math.max(1,initialPage),loaded.numPages)); }
    }).catch(() => { if (!disposed) { setError("No fue posible cargar este PDF. Reintenta la fuente oficial sin salir de The Backyard."); setLoading(false); } });
    return () => { disposed = true; void task?.destroy(); };
  }, [document.localUrl, document.officialUrl, initialPage, retry]);
  useEffect(() => {
    const previous = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    const update = () => setWidth(Math.max(200, (container.current?.clientWidth || window.innerWidth) - 20));
    update();
    window.addEventListener("resize", update);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", escape);
    return () => { window.document.body.style.overflow = previous; window.removeEventListener("resize", update); window.removeEventListener("keydown", escape); };
  }, [onBack]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    setLoading(true); setPageText("");
    pdf.getPage(page).then(async source => {
      if (cancelled || !canvas.current) return;
      const viewport = source.getViewport({ scale: width / source.getViewport({ scale: 1 }).width * zoom });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.current.width = Math.floor(viewport.width * pixelRatio); canvas.current.height = Math.floor(viewport.height * pixelRatio);
      canvas.current.style.width = `${viewport.width}px`; canvas.current.style.height = `${viewport.height}px`;
      render = source.render({ canvas: canvas.current, viewport, transform: [pixelRatio,0,0,pixelRatio,0,0] });
      await render.promise;
      if (!cancelled) { setLoading(false); const text = await source.getTextContent(); if (!cancelled) setPageText(text.items.map(item => "str" in item ? item.str : "").join(" ")); }
    }).catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") { setError("No pudimos mostrar esta página. Intenta otra página o reintenta la carga."); setLoading(false); } });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, zoom, width]);
  return <section className="pdfInternalViewer" role="dialog" aria-modal="true" aria-label={document.title}>
    <header className="pdfInternalHeader"><button autoFocus className="secondary" onClick={onBack}>← Regresar a Reglas</button><h2>{document.title}</h2>
      {pdf && <div className="pdfToolbar"><button className="secondary" aria-label="Página anterior" disabled={page === 1} onClick={() => setPage(page-1)}>‹</button><label>Página <input type="number" inputMode="numeric" min={1} max={pdf.numPages} value={page} onChange={event => { const next=Number(event.target.value); if (Number.isInteger(next) && next>=1 && next<=pdf.numPages) setPage(next); }} /></label><span>de {pdf.numPages}</span><button className="secondary" aria-label="Página siguiente" disabled={page === pdf.numPages} onClick={() => setPage(page+1)}>›</button><button className="secondary" aria-label="Reducir zoom" disabled={zoom <= 1} onClick={() => setZoom(zoom-.25)}>−</button><button className="secondary" aria-label="Ampliar zoom" disabled={zoom >= 2} onClick={() => setZoom(zoom+.25)}>+</button></div>}
    </header>
    {loading && <div className="pdfStatus" role="status">Cargando página…</div>}
    {error && <div className="pdfStatus" role="alert">{error}<button className="secondary" onClick={() => { setPdf(null); setRetry(retry+1); }}>Reintentar</button><a href={document.officialUrl} target="_blank" rel="noreferrer">Fuente oficial alternativa ↗</a></div>}
    <div className="pdfPages" ref={container}><div className="pdfCanvasWrap"><canvas ref={canvas} aria-label={`Página ${page} de ${document.title}`} /></div>{pageText && <details className="pdfPageText"><summary>Texto accesible de esta página</summary><p>{pageText}</p></details>}</div>
  </section>;
}
