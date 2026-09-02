"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { GENTLEMEN_CODE, GENTLEMEN_CODE_DISCLAIMER, GENTLEMEN_CODE_FINAL_QUOTE } from "../../lib/gentlemen-code";
import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES } from "../../lib/local-rules";
import {
  OFFICIAL_RULES_SPANISH_URL,
  OFFICIAL_RULES_URL,
  OFFICIAL_RULES_VIDEOS_EMBED_URL,
  OFFICIAL_RULES_VIDEOS_URL,
  golfRulesCatalog,
  searchGolfRules,
} from "../../lib/rules-catalog";
import { OFFICIAL_RULES_DOCUMENTS, type OfficialRulesDocument } from "../../lib/rules-documents";
import type { RulesSearchResult } from "../../lib/rules-search";
import { speechRecognitionConstructor, speechRecognitionErrorMessage, type SpeechRecognitionLike } from "../../lib/speech-dictation";
import type { LocalRule } from "../../lib/types";

export function RulesPanel({
  courseName,
  localRules,
  localRulesUpdatedAt,
}: {
  courseName: string;
  localRules?: LocalRule[];
  localRulesUpdatedAt?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RulesSearchResult[]>(() => golfRulesCatalog.slice(0, 4).map((entry) => ({ ...entry, source: "Reglas de Golf" })));
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [dictationSupported, setDictationSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [dictationMessage, setDictationMessage] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<OfficialRulesDocument | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const localRulesApply = isLaVistaCourse(courseName);
  const visibleLocalRules = useMemo(
    () => localRulesApply ? activeLocalRules(Array.isArray(localRules) ? localRules : LA_VISTA_LOCAL_RULES) : [],
    [localRules, localRulesApply],
  );

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
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(golfRulesCatalog.slice(0, 4).map((entry) => ({ ...entry, source: "Reglas de Golf" })));
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
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setResults(searchGolfRules(trimmed).map((entry) => ({ ...entry, source: "Reglas de Golf" })));
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & { SpeechRecognition?: Parameters<typeof speechRecognitionConstructor>[0]["SpeechRecognition"]; webkitSpeechRecognition?: Parameters<typeof speechRecognitionConstructor>[0]["webkitSpeechRecognition"] };
    const Recognition = speechRecognitionConstructor(speechWindow);
    if (!Recognition) {
      setDictationSupported(false);
      setDictationMessage("Dictado no disponible en este dispositivo.");
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "es-MX";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { setListening(true); setDictationMessage("Escuchando…"); };
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || "";
      if (transcript) setQuestion((current) => `${current.trim()}${current.trim() ? " " : ""}${transcript}`);
      setDictationMessage(transcript ? "Texto dictado. Puedes revisarlo antes de consultar." : "No escuchamos voz. Intenta nuevamente.");
    };
    recognition.onerror = (event) => setDictationMessage(speechRecognitionErrorMessage(event));
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setDictationMessage("No fue posible iniciar el dictado.");
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

  return <>
    <section className="hero rulesHero">
      <div><div className="eyebrow">REGLAS DE GOLF</div><h1>Resuelve la situación.</h1><p>Busca primero en la guía rápida y consulta siempre la fuente oficial.</p></div>
    </section>

    {courseName && <section className={`rulesCourseContext ${localRulesApply ? "active" : ""}`}>
      <b>📍 {courseName}</b>
      <span>{localRulesApply ? (courseName === "La Vista Temporal" ? "Reglas Locales de La Vista activas" : "Reglas Locales activas") : "Solo Reglas generales de Golf"}</span>
    </section>}

    <section className="card rulesHub" aria-label="Accesos de Reglas">
      <h2>Consulta rápida</h2>
      <div className="rulesHubGrid">
        <a href="#buscar-regla">Buscar Regla</a>
        <a href="#preguntar-ia">Preguntar a IA</a>
        <a href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">Reglamento USGA ↗</a>
        {localRulesApply && <a href="#reglas-locales">Reglas Locales · La Vista</a>}
        <a href="#codigo-caballeros">Código de Caballeros</a>
        <a href="#videos-reglas">Videos de Reglas</a>
      </div>
    </section>

    <section className="card" id="buscar-regla">
      <div className="sectionTitle"><div><h2>Buscar Regla</h2><p>Números y explicaciones verificables, sin inventar referencias.</p></div></div>
      <label htmlFor="rules-search">Buscar en las Reglas de Golf</label>
      <input id="rules-search" type="search" value={query} placeholder="Ej. bola movida, camino, estaca roja…" onChange={(event) => setQuery(event.target.value)} />
      {searching && <div className="hint" role="status">Buscando en los tres documentos oficiales…</div>}
      <div className="rulesResults">
        {!searching && !results.length && <div className="empty">No hay una coincidencia segura. <button className="textButton" onClick={() => { setQuestion(query); document.getElementById("preguntar-ia")?.scrollIntoView({ behavior: "smooth" }); }}>Preguntar a IA sobre esta situación</button></div>}
        {results.slice(0, query ? 12 : 4).map((entry) => <article className="ruleResult" key={entry.id}>
          <div className="row between"><b>{entry.rule === "Fuente oficial" ? entry.rule : `Regla ${entry.rule}`}</b><span className="pillSmall">{entry.source}{entry.page ? ` · p. ${entry.page}` : ""}</span></div>
          <h3>{entry.title}</h3>
          <p>{entry.explanation}</p>
          <a className="textButton" href={entry.sourceUrl} target="_blank" rel="noreferrer">Ver regla / fuente ↗</a>
        </article>)}
      </div>
    </section>

    <section className="card" id="preguntar-ia">
      <div className="sectionTitle"><div><h2>Preguntar a IA</h2><p>{localRulesApply ? "Consulta las fuentes oficiales y las Reglas Locales aplicables a esta ronda." : "Consulta la Guía Oficial, Procedimientos y aclaraciones vigentes sin asumir Reglas Locales."}</p></div><span className={`statusPill ${aiEnabled ? "ready" : ""}`}>{aiEnabled === null ? "Verificando…" : aiEnabled ? "IA activa" : "IA no configurada"}</span></div>
      <form onSubmit={ask}>
        <label htmlFor="rules-question">Describe qué pasó</label>
        <div className="dictationField"><textarea id="rules-question" rows={4} maxLength={1200} value={question} placeholder="Mi bola está fuera del camino pero mis pies están sobre el camino…" onChange={(event) => setQuestion(event.target.value)} /><button type="button" className={`dictationButton ${listening ? "listening" : ""}`} aria-pressed={listening} aria-label={listening ? "Detener dictado" : "Iniciar dictado"} disabled={dictationSupported === false} onClick={toggleDictation}>{listening ? "🔴 Detener" : "🎙"}</button></div>
        {dictationSupported === false && <div className="hint">Dictado no disponible en este dispositivo.</div>}
        {dictationMessage && dictationSupported !== false && <div className="hint" role="status">{dictationMessage}</div>}
        <button className="primary" type="submit" disabled={asking || question.trim().length < 8}>{asking ? "Consultando…" : "Consultar reglamento"}</button>
      </form>
      {error && <div className="notice">{error} La búsqueda manual sigue disponible.</div>}
      {answer && <div className="aiAnswer" aria-live="polite">{answer}</div>}
      <div className="hint">En competencia, el Comité o árbitro tiene la decisión final.</div>
    </section>

    <section className="card officialLinks" id="reglamento-usga">
      <h2>Reglamento USGA</h2>
      <a className="secondary" href={OFFICIAL_RULES_SPANISH_URL} target="_blank" rel="noreferrer">USGA · recursos en español ↗</a>
      <a className="secondary" href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">Abrir Reglamento USGA ↗</a>
      <div className="officialDocuments">
        <div className="sectionTitle"><div><h3>Documentos oficiales</h3><p>Los tres documentos indexados para Preguntar a IA.</p></div></div>
        <div className="officialDocumentGrid">{OFFICIAL_RULES_DOCUMENTS.map((document) => <article key={document.id}>
          <span className="pillSmall">{document.type}</span>
          <h4>{document.title}</h4>
          <p>{document.edition}</p>
          <small>Archivo: {document.sourceFileName}</small>
          <b className="sourceUsed">Documento indexado para IA ✓</b>
          <div className="documentActions"><button className="primary" onClick={() => setSelectedDocument(document)}>Abrir documento</button></div>
        </article>)}</div>
      </div>
      <div className="aiSources">
        <h3>Fuentes de la IA</h3>
        <ul>
          <li>✓ Reglas de Golf / Guía Oficial</li>
          <li>✓ Procedimientos del Comité</li>
          <li>✓ Aclaraciones julio 2026</li>
          {localRulesApply && <li>✓ Reglas Locales · La Vista</li>}
          <li>✓ Código de Caballeros <small>Etiqueta y cultura — no es una Regla oficial USGA</small></li>
        </ul>
      </div>
    </section>

    {localRulesApply && <section className="card" id="reglas-locales">
      <div className="sectionTitle"><div><h2>Reglas Locales · La Vista</h2><p>Aplican únicamente cuando la ronda o la consulta corresponde a La Vista.</p></div>{localRulesUpdatedAt && <span className="statusPill">Actualizadas {localRulesUpdatedAt}</span>}</div>
      <div className="localRulesList">{visibleLocalRules.map((rule) => <article key={rule.id}><span>{rule.hole ? `Hoyo ${rule.hole}` : "General"}</span><h3>{rule.title}</h3><p>{rule.text}</p></article>)}</div>
    </section>}

    <section className="card" id="codigo-caballeros">
      <h2>Código de Caballeros</h2>
      <p className="muted">Etiqueta y cultura de juego</p>
      <div className="gentlemenGrid">{GENTLEMEN_CODE.map((section) => <article key={section.id}><h3>{section.title}</h3><ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
      <blockquote>{GENTLEMEN_CODE_FINAL_QUOTE}</blockquote>
      <div className="notice">{GENTLEMEN_CODE_DISCLAIMER}</div>
    </section>

    <section className="card videosCard" id="videos-reglas">
      <div className="sectionTitle"><div><h2>Videos de Reglas</h2><p>Playlist de consulta para móvil y escritorio.</p></div></div>
      <div className="videoFrame"><iframe src={OFFICIAL_RULES_VIDEOS_EMBED_URL} title="Playlist Videos de Reglas" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
      <a className="primary big" href={OFFICIAL_RULES_VIDEOS_URL} target="_blank" rel="noreferrer">Ver videos de Reglas ↗</a>
    </section>

    {selectedDocument && <div className="rulesDocumentBackdrop" role="presentation"><section className="rulesDocumentViewer" role="dialog" aria-modal="true" aria-labelledby="rules-document-title">
      <header className="rulesDocumentHeader"><button className="secondary" onClick={() => setSelectedDocument(null)}>← Volver a Reglas</button><div><span className="pillSmall">{selectedDocument.type}</span><h2 id="rules-document-title">{selectedDocument.title}</h2></div><a className="primary" href={selectedDocument.officialUrl} target="_blank" rel="noreferrer">Abrir en navegador ↗</a></header>
      <div className="rulesDocumentFrame"><iframe src={selectedDocument.localUrl} title={selectedDocument.title} /><div className="rulesDocumentFallback">Si Safari no muestra el PDF dentro de la app, usa “Abrir en navegador”. THE BACKYARD permanecerá disponible para regresar.</div></div>
    </section></div>}
  </>;
}
