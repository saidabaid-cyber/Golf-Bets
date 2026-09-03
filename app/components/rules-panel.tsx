"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GENTLEMEN_CODE, GENTLEMEN_CODE_DISCLAIMER, GENTLEMEN_CODE_FINAL_QUOTE } from "../../lib/gentlemen-code";
import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES } from "../../lib/local-rules";
import {
  OFFICIAL_RULES_SPANISH_URL,
  OFFICIAL_RULES_URL,
  OFFICIAL_RULES_VIDEOS_EMBED_URL,
  OFFICIAL_RULES_VIDEOS_URL,
} from "../../lib/rules-catalog";
import { OFFICIAL_RULES_DOCUMENTS, type OfficialRulesDocument } from "../../lib/rules-documents";
import { findNavigableRule, NAVIGABLE_GOLF_RULES, searchNavigableRules, type NavigableGolfRule, type NavigableRuleSection } from "../../lib/rules-navigation";
import type { RulesDocumentType, RulesSearchResult } from "../../lib/rules-search";
import { speechRecognitionConstructor, createDictationSession, DICTATION_FALLBACK } from "../../lib/speech-dictation";
import { InternalPdfViewer } from "./internal-pdf-viewer";
import { useSecondaryView } from "./use-secondary-view";
import type { LocalRule } from "../../lib/types";

function RulesDisclosure({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="rulesDisclosure" id={id}>
    <h2><button className="rulesDisclosureToggle" aria-expanded={open} aria-controls={id + "-body"} onClick={onToggle}>{title}<span aria-hidden="true">{open ? "▲" : "▼"}</span></button></h2>
    {open && <div id={id + "-body"} className="rulesDisclosureBody">{children}</div>}
  </section>;
}

type DictationTarget = "search" | "question";
type RuleDetail = { chapter: NavigableGolfRule; section: NavigableRuleSection };

const CLARIFICATION_RULES = new Set([4, 5, 8, 10, 11, 14, 16, 25]);
const COMMITTEE_TOPICS = [
  "Rol del Comité",
  "Marcación del campo",
  "Reglas Locales Modelo",
  "Condiciones de la competencia",
  "Preparación del campo",
  "Ritmo y suspensión del juego",
  "Registro y validación de scores",
  "Decisiones y situaciones especiales",
];

function resultLabel(type: RulesDocumentType) {
  if (type === "clarification") return "ACLARACIÓN";
  if (type === "committee") return "COMITÉ";
  return "REGLAS DE GOLF";
}

function fallbackSearchResults(query: string): RulesSearchResult[] {
  return searchNavigableRules(query).map(({ rule, section }) => ({
    id: `navigation-${section?.number || rule.number}`,
    rule: section?.number || rule.number,
    title: section?.title || rule.title,
    explanation: section?.summary || rule.summary,
    source: "Reglas de Golf",
    sourceId: "official-guide-part-1",
    documentType: "rules",
    sourceUrl: rule.sourceUrl,
  }));
}

export function RulesPanel({
  courseName,
  localRules,
  localRulesUpdatedAt,
  onBack,
  active = true,
}: {
  courseName: string;
  localRules?: LocalRule[];
  localRulesUpdatedAt?: string;
  onBack: () => void;
  active?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RulesSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [detail, setDetail] = useSecondaryView<RuleDetail>("rulesDetail");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [dictationSupported, setDictationSupported] = useState<boolean | null>(null);
  const [listeningTarget, setListeningTarget] = useState<DictationTarget | null>(null);
  const [dictationMessage, setDictationMessage] = useState("");
  const [selectedDocument, setSelectedDocument] = useSecondaryView<OfficialRulesDocument>("rulesDocument");
  const [documentPage, setDocumentPage] = useState(1);
  const [visibleResults, setVisibleResults] = useState(20);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [resourceResults, setResourceResults] = useState<Partial<Record<"clarification" | "committee", RulesSearchResult[]>>>({});
  const [resourceLoading, setResourceLoading] = useState<Partial<Record<"clarification" | "committee", boolean>>>({});
  const recognitionRef = useRef<ReturnType<typeof createDictationSession> | null>(null);
  const localRulesApply = isLaVistaCourse(courseName);
  useEffect(() => {
    if (!active) {
      recognitionRef.current?.dispose();
      recognitionRef.current = null;
      setListeningTarget(null);
    }
  }, [active]);
  const visibleLocalRules = useMemo(
    () => localRulesApply ? activeLocalRules(Array.isArray(localRules) ? localRules : LA_VISTA_LOCAL_RULES) : [],
    [localRules, localRulesApply],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/rules/ask")
      .then((response) => response.json())
      .then((payload: { enabled?: boolean }) => { if (active) setAiEnabled(Boolean(payload.enabled)); })
      .catch(() => { if (active) setAiEnabled(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: Parameters<typeof speechRecognitionConstructor>[0]["SpeechRecognition"]; webkitSpeechRecognition?: Parameters<typeof speechRecognitionConstructor>[0]["webkitSpeechRecognition"] };
    setDictationSupported(Boolean(speechRecognitionConstructor(speechWindow)));
    return () => {
      recognitionRef.current?.dispose();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    setVisibleResults(20);
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/rules/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const payload = await response.json() as { results?: RulesSearchResult[] };
        if (!response.ok) throw new Error("search failed");
        setResults(payload.results || []);
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) setResults(fallbackSearchResults(trimmed));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  function toggleDictation(target: DictationTarget) {
    if (listeningTarget) { recognitionRef.current?.stop(); setListeningTarget(null); return; }
    const Recognition = speechRecognitionConstructor(window as typeof window & Parameters<typeof speechRecognitionConstructor>[0]);
    const focusInput = () => document.getElementById(target === "search" ? "rules-search" : "rules-question")?.focus();
    if (!Recognition) { setDictationSupported(false); setDictationMessage(DICTATION_FALLBACK); focusInput(); return; }
    if (!window.isSecureContext) { setDictationMessage("El micrófono requiere HTTPS. Abre el enlace seguro de The Backyard."); return; }
    recognitionRef.current?.dispose();
    const prefix = target === "question" ? question.trim() : "";
    try {
      const session = createDictationSession(Recognition, {
        transcript: text => target === "search" ? setQuery(text) : setQuestion(`${prefix}${prefix ? " " : ""}${text}`),
        fallback: focusInput,
        status: setDictationMessage,
        listening: value => setListeningTarget(value ? target : null),
      });
      recognitionRef.current = session;
      session.start();
    } catch { setListeningTarget(null); setDictationMessage(DICTATION_FALLBACK); focusInput(); }
  }

  function scrollToSection(id: string) {
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function prepareAi(prompt = query) {
    if (prompt.trim()) setQuestion(prompt.trim());
    setOpenSections(current => ({ ...current, ai: true }));
    setDetail(null);
    scrollToSection("preguntar-ia");
  }

  function openRuleReference(reference: string, sourceId: OfficialRulesDocument["id"] = "official-guide-part-1", page?: number) {
    if (sourceId !== "official-guide-part-1") { const source = OFFICIAL_RULES_DOCUMENTS.find(entry => entry.id === sourceId); if (source) { setDocumentPage(page || 1); setSelectedDocument(source); } return; }
    const location = findNavigableRule(reference);
    if (location?.section) {
      setDetail({ chapter: location.chapter, section: location.section });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (location?.chapter) {
      setOpenSections(current => ({ ...current, directory: true }));
      setExpandedRule(location.chapter.number);
      scrollToSection(`regla-${location.chapter.number}`);
      return;
    }
    const document = OFFICIAL_RULES_DOCUMENTS.find((entry) => entry.id === sourceId);
    if (document) setSelectedDocument(document);
  }

  function toggleSection(key: string) {
    setOpenSections(current => ({ ...current, [key]: !current[key] }));
  }

  async function toggleResource(kind: "clarification" | "committee", forceOpen = false) {
    const next = forceOpen || !openSections[kind];
    setOpenSections(current => ({ ...current, [kind]: next }));
    if (!next || resourceResults[kind] || resourceLoading[kind]) return;
    setResourceLoading(current => ({ ...current, [kind]: true }));
    const source = kind === "clarification" ? "clarifications-july-2026" : "committee-procedures-part-2";
    try {
      const response = await fetch(`/api/rules/search?source=${source}`);
      const payload = await response.json() as { results?: RulesSearchResult[] };
      if (!response.ok) throw new Error("resource failed");
      setResourceResults(current => ({ ...current, [kind]: payload.results || [] }));
    } catch {
      setResourceResults(current => ({ ...current, [kind]: [] }));
    } finally {
      setResourceLoading(current => ({ ...current, [kind]: false }));
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 8) return;
    setAsking(true);
    setAnswer("");
    setError("");
    try {
      const response = await fetch("/api/rules/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, courseName, localRules: visibleLocalRules }),
      });
      const payload = await response.json() as { answer?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible consultar.");
      setAnswer(payload.answer || "No se encontró una respuesta suficiente.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar.");
    } finally {
      setAsking(false);
    }
  }

  if (detail) return <>
    <header className="rulesPageHeader">
      <button className="rulesBackButton" onClick={() => setDetail(null)}>← Regresar a Regla {detail.chapter.number}</button>
      <div><span>THE BACKYARD</span><h1>Reglas de Golf</h1></div>
    </header>
    <section className="card ruleDetail" aria-labelledby="rule-detail-title">
      <div className="ruleDetailNumber">REGLA {detail.section.number}</div>
      <h2 id="rule-detail-title">{detail.section.title}</h2>
      <p className="ruleDetailLead">{detail.section.summary || `Esta subregla desarrolla “${detail.section.title}” dentro de la Regla ${detail.chapter.number}.`}</p>
      <div className="ruleDetailGrid">
        <article><span>RESUMEN PRÁCTICO</span><p>{detail.chapter.summary}</p></article>
        <article><span>QUÉ PERMITE</span><p>{detail.chapter.allows}</p></article>
        <article><span>QUÉ NO PERMITE</span><p>{detail.chapter.forbids}</p></article>
      </div>
      {detail.section.penalty && <div className="rulePenalty"><b>Penalidad</b><p>{detail.section.penalty}</p></div>}
      {!detail.section.penalty && <div className="hint">La consecuencia depende de los hechos y de la modalidad. Confírmala en la fuente oficial antes de aplicarla.</div>}
      <div className="ruleSource"><span>Fuente</span><b>Reglas de Golf · Regla {detail.chapter.number}</b></div>
      <div className="ruleDetailActions">
        <button className="primary" onClick={() => prepareAi(`Tengo una pregunta sobre la Regla ${detail.section.number}: ${detail.section.title}.`)}>Preguntar a IA sobre esta regla</button>
        <a className="secondary" href={detail.chapter.sourceUrl} target="_blank" rel="noreferrer">Ver fuente oficial ↗</a>
      </div>
      <div className="notice">Resumen práctico de THE BACKYARD. En competencia, el Comité o árbitro oficial tiene la decisión final.</div>
    </section>
  </>;

  return <>
    <header className="rulesPageHeader">
      <button className="rulesBackButton" onClick={onBack}>← Regresar</button>
      <div><span>THE BACKYARD</span><h1>Reglas de Golf</h1></div>
    </header>

    <RulesDisclosure id="preguntar-ia" title="🤖 Preguntar a la IA" open={Boolean(openSections.ai)} onToggle={() => toggleSection("ai")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Preguntar a la IA</h2><p>{localRulesApply ? "Consulta fuentes oficiales y las Reglas Locales aplicables." : "Consulta Guía Oficial, Procedimientos y Aclaraciones sin asumir Reglas Locales."}</p></div><span className={`statusPill ${aiEnabled ? "ready" : ""}`}>{aiEnabled === null ? "Verificando…" : aiEnabled ? "IA activa" : "IA no configurada"}</span></div>
      <form onSubmit={ask}>
        <label htmlFor="rules-question">Describe qué pasó</label>
        <div className="dictationField"><textarea id="rules-question" rows={4} maxLength={1200} value={question} placeholder="Mi bola está fuera del camino pero mis pies están sobre el camino…" onChange={(event) => setQuestion(event.target.value)} /><button type="button" className={`dictationButton ${listeningTarget === "question" ? "listening" : ""}`} aria-pressed={listeningTarget === "question"} aria-label={listeningTarget === "question" ? "Detener dictado" : "Iniciar dictado"} onClick={() => toggleDictation("question")}>{listeningTarget === "question" ? "🔴 Detener" : "🎙"}</button></div>
        <button className="primary" type="submit" disabled={asking || question.trim().length < 8}>{asking ? "Consultando…" : "Consultar reglamento"}</button>
      </form>
      {dictationMessage && <div className="rulesSearchStatus" role="status">{dictationMessage}</div>}
      {error && <div className="notice">{error} La búsqueda manual sigue disponible.</div>}
      {answer && <div className="aiAnswer" aria-live="polite">{answer}</div>}
      <div className="hint">La búsqueda del reglamento nunca llama a OpenAI. En competencia, el Comité o árbitro oficial tiene la decisión final.</div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="reglamento-navegable" title="📖 Reglamento navegable" open={Boolean(openSections.directory)} onToggle={() => toggleSection("directory")}>
<section className="rulesSearchHero" id="buscar-regla">
      <label className="srOnly" htmlFor="rules-search">Buscar en las Reglas</label>
      <div className="rulesSearchField">
        <span className="rulesSearchIcon" aria-hidden="true">⌕</span>
        <input id="rules-search" type="search" autoComplete="off" value={query} placeholder="Buscar en las Reglas" onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className={`rulesMicButton ${listeningTarget === "search" ? "listening" : ""}`} aria-pressed={listeningTarget === "search"} aria-label={listeningTarget === "search" ? "Detener dictado de búsqueda" : "Dictar búsqueda"} onClick={() => toggleDictation("search")}>{listeningTarget === "search" ? <><span aria-hidden="true">🔴</span><b>Detener</b></> : <span aria-hidden="true">🎙</span>}</button>
      </div>
      {dictationSupported === false && <div className="rulesSearchStatus">{DICTATION_FALLBACK}</div>}
      {dictationMessage && dictationSupported !== false && <div className="rulesSearchStatus" role="status">{dictationMessage}</div>}
    </section>
{query && <section className="card rulesSearchResults" aria-live="polite">
      <div className="sectionTitle"><div><h2>Resultados</h2><p>Búsqueda local en Reglas, Procedimientos del Comité y Aclaraciones 2026.</p></div>{searching && <span className="statusPill">Buscando…</span>}</div>
      {!searching && !results.length && <div className="empty">No hay una coincidencia suficiente para “{query}”. <button className="textButton" onClick={() => prepareAi(query)}>Preguntar a IA</button></div>}
      <div className="rulesResults">{results.slice(0, visibleResults).map((entry) => <article className="ruleResult" key={entry.id}>
        <button className="ruleResultOpen" onClick={() => openRuleReference(entry.rule, entry.sourceId, entry.page)}>
          <span className={`rulesSourceBadge ${entry.documentType}`}>{resultLabel(entry.documentType)}</span>
          <b>{entry.rule === "Fuente oficial" ? entry.rule : `Regla ${entry.rule}`}</b>
          <h3>{entry.title}</h3>
          <p>{entry.explanation}</p>
          <small>{entry.source}{entry.page ? ` · p. ${entry.page}` : ""}</small>
          <span className="ruleOpenLabel">Abrir referencia →</span>
        </button>
      </article>)}</div>
      {results.length > visibleResults && <button className="secondary big" onClick={() => setVisibleResults(count => count + 20)}>Mostrar más · {visibleResults} de {results.length} coincidencias</button>}
      {!searching && <p className="muted">{results.length} coincidencias · ninguna se descarta por límite</p>}
      {!searching && <div className="rulesAiFallback"><span>¿No encontraste lo que buscabas?</span><button className="textButton" onClick={() => prepareAi(query)}>Preguntar a IA</button></div>}
    </section>}
<section className="card rulesDirectory" id="reglas-de-golf">
      <div className="sectionTitle"><div><div className="eyebrow">REGLAS DE GOLF</div><h2>Reglamento navegable</h2><p>25 reglas · toca una para ver sus subreglas.</p></div></div>
      <div className="rulesAccordion">{NAVIGABLE_GOLF_RULES.map((entry) => {
        const open = expandedRule === entry.number;
        return <article className={`ruleChapter ${open ? "open" : ""}`} id={`regla-${entry.number}`} key={entry.number}>
          <h3><button aria-expanded={open} aria-controls={`contenido-regla-${entry.number}`} onClick={() => setExpandedRule(open ? null : entry.number)}><span className="ruleChapterNumber">{entry.number}</span><span>{entry.title}</span><span className="ruleChevron" aria-hidden="true">⌄</span></button></h3>
          {open && <div className="ruleChapterBody" id={`contenido-regla-${entry.number}`}>
            <p>{entry.summary}</p>
            <div className="ruleSections">{entry.sections.map((child) => <button key={child.number} onClick={() => { setDetail({ chapter: entry, section: child }); window.scrollTo({ top: 0, behavior: "smooth" }); }}><b>{child.number}</b><span>{child.title}</span><strong aria-hidden="true">›</strong></button>)}</div>
            <div className="ruleChapterLinks"><a href={entry.sourceUrl} target="_blank" rel="noreferrer">Ver fuente oficial ↗</a>{CLARIFICATION_RULES.has(Number(entry.number)) && <button className="textButton" onClick={async () => { await toggleResource("clarification", true); scrollToSection("aclaraciones"); }}>Aclaraciones relacionadas</button>}</div>
          </div>}
        </article>;
      })}</div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="procedimientos-comite" title="📋 Procedimientos / Comité" open={Boolean(openSections.committee)} onToggle={() => toggleResource("committee")}>
<section className="card rulesResourceSection">
      <div className="sectionTitle"><div><span className="rulesSourceBadge committee">COMITÉ</span><h2>Procedimientos del Comité</h2><p>Guía separada para quienes administran el campo o una competencia.</p></div></div>
      <div className="committeeTopics">{COMMITTEE_TOPICS.map((topic) => <span key={topic}>{topic}</span>)}</div>
      <div className="resourceIndex">
        {resourceLoading.committee && <div className="empty">Cargando índice local…</div>}
        {!resourceLoading.committee && resourceResults.committee?.map((entry) => <button className="resourceRow" key={entry.id} onClick={() => openRuleReference(entry.rule, entry.sourceId, entry.page)}><span><b>{entry.title}</b><small>{entry.explanation}</small></span><strong>{entry.rule === "Fuente oficial" ? "Fuente" : `Regla ${entry.rule}`} →</strong></button>)}
      </div>
      <button className="secondary big" onClick={() => setSelectedDocument(OFFICIAL_RULES_DOCUMENTS[1])}>Abrir Procedimientos oficiales</button>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="aclaraciones" title="📄 Aclaraciones" open={Boolean(openSections.clarification)} onToggle={() => toggleResource("clarification")}>
    <section className="card rulesResourceSection">
      <div className="sectionTitle"><div><span className="rulesSourceBadge clarification">ACLARACIONES</span><h2>Aclaraciones vigentes 2026</h2><p>Las 13 páginas del documento vigente están indexadas y también participan en la búsqueda superior.</p></div></div>
      {resourceLoading.clarification && <div className="empty">Cargando índice local…</div>}
      {!resourceLoading.clarification && resourceResults.clarification?.map((entry) => <button className="resourceRow" key={entry.id} onClick={() => openRuleReference(entry.rule, entry.sourceId, entry.page)}><span><b>{entry.title}</b><small>{entry.explanation}</small></span><strong>{entry.rule === "Fuente oficial" ? "Fuente" : `Regla ${entry.rule}`} →</strong></button>)}
      {!resourceLoading.clarification && resourceResults.clarification?.length === 0 && <div className="empty">El índice no está disponible. El documento oficial sigue accesible.</div>}
      <button className="secondary big" onClick={() => setSelectedDocument(OFFICIAL_RULES_DOCUMENTS[2])}>Abrir Aclaraciones oficiales</button>
    </section>
    </RulesDisclosure>

    {localRulesApply && <RulesDisclosure id="reglas-locales" title="⛳ Reglas Locales · La Vista" open={Boolean(openSections.local)} onToggle={() => toggleSection("local")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Reglas Locales · La Vista</h2><p>Solo lectura. Aplican únicamente a La Vista y La Vista Temporal.</p></div>{localRulesUpdatedAt && <span className="statusPill">Actualizadas {localRulesUpdatedAt}</span>}</div>
      <div className="localRulesList">{visibleLocalRules.map((entry) => <article key={entry.id}><span>{entry.hole ? `Hoyo ${entry.hole}` : "General"}</span><h3>{entry.title}</h3><p>{entry.text}</p></article>)}</div>
    </section>
    </RulesDisclosure>}

    <RulesDisclosure id="codigo-caballeros" title="🤝 Código de Caballeros" open={Boolean(openSections.gentlemen)} onToggle={() => toggleSection("gentlemen")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Código de Caballeros</h2><p>Etiqueta y cultura de juego</p></div><span className="statusPill">NO OFICIAL</span></div>
      <div className="gentlemenGrid">{GENTLEMEN_CODE.map((entry) => <article key={entry.id}><h3>{entry.title}</h3><ul>{entry.points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
      <blockquote>{GENTLEMEN_CODE_FINAL_QUOTE}</blockquote>
      <div className="notice">{GENTLEMEN_CODE_DISCLAIMER}</div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="documentos-oficiales" title="📄 Documentos oficiales" open={Boolean(openSections.documents)} onToggle={() => toggleSection("documents")}>
<section className="card officialLinks">
      <div className="sectionTitle"><div><h2>Documentos oficiales</h2><p>Fuentes completas usadas por el buscador y Preguntar a IA.</p></div></div>
      <div className="officialDocumentGrid">{OFFICIAL_RULES_DOCUMENTS.map((document) => <article key={document.id}>
        <span className="pillSmall">{document.type}</span>
        <h3>{document.title}</h3>
        <p>{document.edition}</p>
        <b className="sourceUsed">Documento indexado para IA ✓</b>
        <div className="documentActions"><button className="primary" onClick={() => setSelectedDocument(document)}>Abrir documento</button></div>
      </article>)}</div>
      <div className="officialLinkRow"><a className="secondary" href={OFFICIAL_RULES_SPANISH_URL} target="_blank" rel="noreferrer">Recursos USGA en español ↗</a><a className="secondary" href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">Rules Hub USGA ↗</a></div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="videos-reglas" title="🎥 Videos" open={Boolean(openSections.videos)} onToggle={() => toggleSection("videos")}>
<section className="card videosCard">
      <div className="sectionTitle"><div><h2>Videos de Reglas</h2><p>Playlist existente de consulta para móvil y escritorio.</p></div></div>
      <div className="videoFrame"><iframe src={OFFICIAL_RULES_VIDEOS_EMBED_URL} title="Playlist Videos de Reglas" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
      <a className="primary big" href={OFFICIAL_RULES_VIDEOS_URL} target="_blank" rel="noreferrer">Ver videos de Reglas ↗</a>
    </section>
    </RulesDisclosure>

    {selectedDocument && <InternalPdfViewer document={selectedDocument} initialPage={documentPage} onBack={() => { setSelectedDocument(null); setDocumentPage(1); }} />}
  </>;
}
