"use client";

import { type FormEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { OfficialRulesDocument } from "../../lib/rules-documents";
import { countPdfTextMatches, pdfPixelRatio, withPdfDeadline } from "../../lib/pdf-viewer-utils";

type SearchMatch = { page: number; count: number };

function PdfPage({ pdf, pageNumber, width, zoom, title, scrollRoot, highlighted, onVisible }: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  zoom: number;
  title: string;
  scrollRoot: RefObject<HTMLDivElement | null>;
  highlighted: boolean;
  onVisible: (page: number) => void;
}) {
  const host = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [aspectRatio, setAspectRatio] = useState(1.294);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element || !("IntersectionObserver" in window)) { setNearViewport(true); return; }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== element) continue;
        setNearViewport(entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio > .15) onVisible(pageNumber);
      }
    }, { root: scrollRoot.current, rootMargin: "900px 0px", threshold: [0, .15, .55] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible, pageNumber, scrollRoot]);

  useEffect(() => {
    if (!nearViewport || !canvas.current) {
      if (canvas.current) { canvas.current.width = 1; canvas.current.height = 1; }
      return;
    }
    let cancelled = false;
    let render: RenderTask | undefined;
    setError(false);
    withPdfDeadline(pdf.getPage(pageNumber), 12_000).then(async (source) => {
      if (cancelled || !canvas.current) return;
      const base = source.getViewport({ scale: 1 });
      setAspectRatio(base.height / base.width);
      const viewport = source.getViewport({ scale: Math.max(.45, (width / base.width) * zoom) });
      const ratio = pdfPixelRatio(viewport.width, viewport.height, window.devicePixelRatio || 1);
      canvas.current.width = Math.floor(viewport.width * ratio);
      canvas.current.height = Math.floor(viewport.height * ratio);
      canvas.current.style.width = `${viewport.width}px`;
      canvas.current.style.height = `${viewport.height}px`;
      render = source.render({ canvas: canvas.current, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await withPdfDeadline(render.promise, 12_000);
    }).catch((reason) => {
      if (!cancelled && reason?.name !== "RenderingCancelledException") setError(true);
    });
    return () => { cancelled = true; render?.cancel(); };
  }, [nearViewport, pageNumber, pdf, width, zoom]);

  const pageWidth = Math.max(200, width * zoom);
  return <article ref={host} id={`pdf-page-${pageNumber}`} className={`pdfDocumentPage ${highlighted ? "searchMatch" : ""}`} style={{ minHeight: Math.round(pageWidth * aspectRatio) }}>
    <div className="pdfPageLabel">Página {pageNumber}</div>
    {error ? <div className="pdfPageError" role="alert">No se pudo dibujar esta página.</div> : <canvas ref={canvas} aria-label={`Página ${pageNumber} de ${title}`} />}
  </article>;
}

export function InternalPdfViewer({ document, initialPage = 1, onBack }: { document: OfficialRulesDocument; initialPage?: number; onBack: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const searchGeneration = useRef(0);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(350);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [textUnavailable, setTextUnavailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setError(""); setLoading(true); setPdf(null); setMatches([]); setTextUnavailable(false); setSearchCompleted(false);
    import("pdfjs-dist/legacy/build/pdf.mjs").then(async (library) => {
      if (disposed) return;
      library.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      let loadingTask = library.getDocument({ url: document.localUrl });
      task = loadingTask;
      let loaded: PDFDocumentProxy;
      try {
        loaded = await withPdfDeadline(loadingTask.promise, 20_000);
      } catch {
        if (disposed) return;
        void loadingTask.destroy().catch(() => undefined);
        loadingTask = library.getDocument({ url: document.officialUrl });
        task = loadingTask;
        loaded = await withPdfDeadline(loadingTask.promise, 20_000);
      }
      if (!disposed) {
        setPdf(loaded);
        setCurrentPage(Math.min(Math.max(1, initialPage), loaded.numPages));
        setLoading(false);
      }
    }).catch(() => {
      if (!disposed) { setError("Este navegador no pudo abrir el PDF dentro de The Backyard."); setLoading(false); }
    });
    return () => {
      disposed = true;
      searchGeneration.current += 1;
      void task?.destroy();
    };
  }, [document.localUrl, document.officialUrl, initialPage, retry]);

  useEffect(() => {
    const previous = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    const update = () => setWidth(Math.max(220, (container.current?.clientWidth || window.innerWidth) - 28));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (container.current) observer?.observe(container.current);
    window.addEventListener("resize", update);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", escape);
    return () => {
      window.document.body.style.overflow = previous;
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", escape);
    };
  }, [onBack]);

  const highlightedPages = useMemo(() => new Set(matches.map((match) => match.page)), [matches]);
  const totalMatches = matches.reduce((sum, match) => sum + match.count, 0);
  const markVisible = useCallback((pageNumber: number) => setCurrentPage(pageNumber), []);
  const scrollToPage = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
    window.requestAnimationFrame(() => window.document.getElementById(`pdf-page-${pageNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  useEffect(() => {
    if (!pdf) return;
    const timer = window.setTimeout(() => scrollToPage(Math.min(Math.max(1, initialPage), pdf.numPages)), 80);
    return () => window.clearTimeout(timer);
  }, [initialPage, pdf, scrollToPage]);

  async function searchDocument(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!pdf || !query) { setMatches([]); setTextUnavailable(false); setSearchCompleted(false); return; }
    const generation = ++searchGeneration.current;
    setSearching(true); setSearchProgress(0); setMatches([]); setMatchIndex(0); setTextUnavailable(false); setSearchCompleted(false);
    let extractedCharacters = 0;
    const found: SearchMatch[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (generation !== searchGeneration.current) return;
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ");
        extractedCharacters += text.trim().length;
        const count = countPdfTextMatches(text, query);
        if (count) found.push({ page: pageNumber, count });
        if (pageNumber % 5 === 0 || pageNumber === pdf.numPages) setSearchProgress(pageNumber);
        if (pageNumber % 12 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (generation !== searchGeneration.current) return;
      setMatches(found);
      setTextUnavailable(extractedCharacters === 0);
      if (found[0]) scrollToPage(found[0].page);
    } catch {
      if (generation === searchGeneration.current) setTextUnavailable(true);
    } finally {
      if (generation === searchGeneration.current) { setSearching(false); setSearchCompleted(true); }
    }
  }

  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    scrollToPage(matches[next].page);
  }

  return <section className="pdfInternalViewer" role="dialog" aria-modal="true" aria-label={document.title}>
    <header className="pdfInternalHeader">
      <div className="pdfHeaderTop"><button autoFocus className="secondary" onClick={onBack}>← Regresar a Reglas</button><div><h2>{document.title}</h2>{pdf && <small>Página visible {currentPage} de {pdf.numPages}</small>}</div></div>
      {pdf && <div className="pdfToolbar"><button className="secondary" aria-label="Reducir zoom" disabled={zoom <= .75} onClick={() => setZoom((value) => Math.max(.75, value - .25))}>−</button><b>{Math.round(zoom * 100)}%</b><button className="secondary" aria-label="Ampliar zoom" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + .25))}>+</button><form className="pdfSearch" onSubmit={searchDocument}><label className="srOnly" htmlFor="pdf-search">Buscar en documento</label><input id="pdf-search" type="search" value={search} placeholder="Buscar en documento" onChange={(event) => { setSearch(event.target.value); setSearchCompleted(false); }} /><button className="primary" disabled={searching || !search.trim()}>{searching ? `${searchProgress}/${pdf.numPages}` : "Buscar"}</button></form></div>}
      {(textUnavailable || matches.length > 0 || searchCompleted) && <div className="pdfSearchResults" role="status">{textUnavailable ? "Este PDF no ofrece texto extraíble; la búsqueda no está disponible." : matches.length ? <><span>{totalMatches} coincidencia{totalMatches === 1 ? "" : "s"} en {matches.length} página{matches.length === 1 ? "" : "s"}</span><div><button className="secondary" onClick={() => moveMatch(-1)}>‹ Anterior</button><button className="secondary" onClick={() => moveMatch(1)}>Siguiente ›</button></div></> : "Sin coincidencias."}</div>}
    </header>
    {loading && <div className="pdfStatus" role="status">Cargando documento…</div>}
    {error && <div className="pdfStatus" role="alert">{error}<button className="secondary" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></div>}
    <a className={error ? "primary pdfOfficialFallback" : "pdfOfficialFallback"} href={document.officialUrl} target="_blank" rel="noopener noreferrer">Ver fuente oficial ↗</a>
    <div className="pdfPages" ref={container}>
      {pdf && !error && Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} width={width} zoom={zoom} title={document.title} scrollRoot={container} highlighted={highlightedPages.has(index + 1)} onVisible={markVisible} />)}
    </div>
  </section>;
}
