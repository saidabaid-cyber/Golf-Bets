"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";
import { GENTLEMEN_CODE, GENTLEMEN_CODE_DISCLAIMER, GENTLEMEN_CODE_FINAL_QUOTE } from "../../lib/gentlemen-code";
import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES } from "../../lib/local-rules";
import {
  OFFICIAL_RULES_SPANISH_URL,
  OFFICIAL_RULES_URL,
  OFFICIAL_RULES_VIDEOS_EMBED_URL,
  OFFICIAL_RULES_VIDEOS_URL,
  golfRulesCatalog,
  RULES_COMMON_SITUATIONS,
  RULE_SITUATION_VIDEOS,
  type RuleSituation,
} from "../../lib/rules-catalog";
import { OFFICIAL_RULES_DOCUMENTS, type OfficialRulesDocument } from "../../lib/rules-documents";
import { findNavigableRule, NAVIGABLE_GOLF_RULES, searchNavigableRules, type NavigableGolfRule, type NavigableRuleSection } from "../../lib/rules-navigation";
import type { RulesDocumentType, RulesSearchResult } from "../../lib/rules-search";
import type { RulesEvidenceReference } from "../../lib/rules-ai";
import { speechRecognitionConstructor, createDictationSession, DICTATION_FALLBACK } from "../../lib/speech-dictation";
import { useBackyardAccount } from "./account-provider";
import { AiProcessingConsentPrompt, AiProcessingConsentRequired } from "./backyard-ai/ai-processing-consent";
import { InternalPdfViewer } from "./internal-pdf-viewer";
import { useSecondaryView } from "./use-secondary-view";
import type { LocalRule } from "../../lib/types";
import { BackyardIcon } from "./backyard-icon";
import { BottomBackAction } from "./bottom-back-action";
import styles from "./rules-panel.module.css";

type RuleVisualKind = RuleSituation["visual"] | "book" | "search" | "play" | "check" | "ban";

function RuleVisual({ kind }: { kind: RuleVisualKind }) {
  if (kind === "ball") return <BackyardIcon name="ball" />;
  const paths: Record<Exclude<RuleVisualKind, "ball">, string> = {
    bunker: "M3 17c0-3 18-3 18 0s-18 3-18 0Zm7-3V9a3 3 0 0 1 6 0v5",
    bounds: "M6 21V3m0 0h12l-3 4 3 4H6",
    relief: "M3 20h18M8 20c0-6-1-9-3-12m7 12V5m4 15c0-5 2-8 4-10",
    penalty: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
    obstruction: "M5 4h5v16H5zM16 8h5v12h-5M3 21h19",
    drop: "M15 3v6m-4-6v6m-4-6v8c0 4 2 6 5 6h5l4-7-3-1-3 4M8 21h.01",
    book: "M12 5c-3-2-7-2-10-1v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16",
    search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6",
    play: "m9 5 10 7-10 7V5Z",
    check: "m5 12 4 4L19 6",
    ban: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 6l12 12",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function resultVisual(reference: string): RuleVisualKind {
  const chapter = findNavigableRule(reference)?.chapter.number;
  if (chapter === "12") return "bunker";
  if (chapter === "14") return "drop";
  if (chapter === "15") return "obstruction";
  if (chapter === "16") return "relief";
  if (chapter === "17") return "penalty";
  if (chapter === "18") return "bounds";
  return chapter && ["4", "6", "7", "9"].includes(chapter) ? "ball" : "book";
}

function RulesDisclosure({ id, title, icon = "score", open, onToggle, children }: { id: string; title: string; icon?: "spark" | "players" | "score"; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="rulesDisclosure" id={id}>
    <h2><button className="rulesDisclosureToggle" aria-expanded={open} aria-controls={id + "-body"} onClick={onToggle}><span className="rulesDisclosureLabel"><BackyardIcon name={icon} />{title}</span><span aria-hidden="true">{open ? "▲" : "▼"}</span></button></h2>
    {open && <div id={id + "-body"} className="rulesDisclosureBody">{children}</div>}
  </section>;
}

type DictationTarget = "search" | "question";
type RuleDetail = { chapter: NavigableGolfRule; section: NavigableRuleSection };
type RulesHomeView = { kind: "topics" } | { kind: "situation"; situation: RuleSituation };

const SITUATION_PHOTOS: Record<string, string> = {
  bunker: "bunker", out_of_bounds: "bounds", lost_ball: "lost-ball", free_relief: "relief",
  penalty_area: "penalty", obstructions: "obstruction", drop: "drop",
};

// Practical paraphrases of R&A 12.1/12.2; touching sand is not a blanket prohibition.
const BUNKER_SUMMARY: readonly { title: string; text: string; icon: RuleVisualKind; reference: string }[] = [
  { title: "Qué significa", text: "La bola está en el búnker cuando toca la arena dentro de su margen, o reposa en los supuestos de la Regla 12.1.", icon: "search", reference: "12.1" },
  { title: "Qué sí puedes hacer", text: "Puedes jugarla como está, retirar impedimentos sueltos y obstrucciones movibles, y afirmar los pies para tomar tu stance. El alivio depende de la regla aplicable.", icon: "check", reference: "12.2" },
  { title: "Qué no puedes hacer", text: "No pruebes la arena, ni la toques con el palo justo delante o detrás de la bola, en un swing de práctica o en el backswing. No mejores las condiciones del golpe.", icon: "ban", reference: "12.2" },
  { title: "Cuándo aplica penalidad", text: "Por infringir 12.2: penalidad general, dos golpes en stroke play o pérdida del hoyo en match play. Otras situaciones tienen sus propias penalidades.", icon: "penalty", reference: "12.2" },
];

const CLARIFICATION_RULES = new Set([4, 5, 8, 10, 11, 14, 16, 25]);

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
  const { identity } = useBackyardAccount();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RulesSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [detail, setDetail] = useSecondaryView<RuleDetail>("rulesDetail");
  const [homeView, setHomeView] = useSecondaryView<RulesHomeView>("rulesHomeView");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerEvidence, setAnswerEvidence] = useState<RulesEvidenceReference[]>([]);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [accountConsentRequired, setAccountConsentRequired] = useState(false);
  const [aiState, setAiState] = useState<"checking" | "ready" | "disabled" | "missing_config" | "unavailable">("checking");
  const [, setDictationSupported] = useState<boolean | null>(null);
  const [listeningTarget, setListeningTarget] = useState<DictationTarget | null>(null);
  const [dictationMessage, setDictationMessage] = useState("");
  const [selectedDocument, setSelectedDocument] = useSecondaryView<OfficialRulesDocument>("rulesDocument");
  const [documentPage, setDocumentPage] = useState(1);
  const [visibleResults, setVisibleResults] = useState(20);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const recognitionRef = useRef<ReturnType<typeof createDictationSession> | null>(null);
  const askInFlight = useRef(false);
  const pendingQuestion = useRef("");
  const pendingAiNavigation = useRef(false);
  const localRulesApply = isLaVistaCourse(courseName);
  const hasQuery = query.trim().length > 0;
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
      .then((payload: { enabled?: boolean; state?: "ready" | "disabled" | "missing_config" }) => { if (active) setAiState(payload.state || (payload.enabled ? "ready" : "missing_config")); })
      .catch(() => { if (active) setAiState("unavailable"); });
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

  useEffect(() => {
    if (!pendingAiNavigation.current || detail) return;
    if (homeView) { setHomeView(null); return; }
    pendingAiNavigation.current = false;
    scrollToSection("preguntar-ia");
  }, [detail, homeView, setHomeView]);

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
    setOpenSections(current => ({ ...current, resources: true, ai: true }));
    pendingAiNavigation.current = true;
    if (detail) setDetail(null);
    else if (homeView) setHomeView(null);
    else { pendingAiNavigation.current = false; scrollToSection("preguntar-ia"); }
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
      setOpenSections(current => ({ ...current, resources: true, directory: true }));
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

  function clearSearch() {
    setQuery("");
    setResults([]);
    setSearching(false);
    setVisibleResults(20);
    setExpandedRule(null);
    setOpenSections(current => ({ ...current, resources: false, directory: false }));
  }

  async function requestRulesAnswer(nextQuestion = pendingQuestion.current) {
    if (askInFlight.current || nextQuestion.trim().length < 8) return;
    askInFlight.current = true;
    setAsking(true);
    setShowConsent(false);
    setAccountConsentRequired(false);
    setAnswer("");
    setAnswerEvidence([]);
    setError("");
    try {
      const payload = await requestBackyardAi<{ answer?: string; evidence?: RulesEvidenceReference[] }>("/api/rules/ask", {
        question: nextQuestion.trim(),
        courseName,
        consent: backyardAiProviderConsent(AI_PROVIDER_PROCESSING_CONSENT),
      }, 30_000, identity.accessToken);
      setAnswer(payload.answer || "No se encontró una respuesta suficiente.");
      setAnswerEvidence(Array.isArray(payload.evidence) ? payload.evidence : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar.");
    } finally {
      askInFlight.current = false;
      setAsking(false);
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (nextQuestion.length < 8 || askInFlight.current) return;
    pendingQuestion.current = nextQuestion;
    setError("");
    setAccountConsentRequired(false);
    try {
      if (identity.accessToken) {
        const authority = await resolveAuthoritativeAiProcessingConsent({
          accessToken: identity.accessToken,
          storage: browserAiProcessingConsentStorage(),
          userId: identity.userId,
          scope: AI_PROVIDER_PROCESSING_CONSENT,
        });
        if (authority.discarded || !authority.active || authority.pendingLocalRevocation) {
          setAccountConsentRequired(true);
          return;
        }
      } else if (identity.mode === "authenticated") {
        setError("Recupera tu sesión antes de enviar la consulta al proveedor de IA.");
        return;
      } else if (!hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), identity.userId, AI_PROVIDER_PROCESSING_CONSENT)) {
        setShowConsent(true);
        return;
      }
    } catch {
      setError("No pude verificar tu autorización de IA. No se envió la consulta.");
      return;
    }
    await requestRulesAnswer(nextQuestion);
  }

  function closeRuleDetail() {
    setDetail(null);
  }

  if (detail) return <>
    <header className="rulesPageHeader">
      <button className="rulesBackButton" onClick={closeRuleDetail}>{homeView?.kind === "situation" ? `← ${homeView.situation.id === "bunker" ? "Búnker" : "Situación"}` : `← Regresar a Regla ${detail.chapter.number}`}</button>
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
      <BottomBackAction label={homeView?.kind === "situation" ? `← ${homeView.situation.id === "bunker" ? "Búnker" : "Situación"}` : `← Regresar a Regla ${detail.chapter.number}`} onBack={closeRuleDetail} />
    </section>
  </>;

  if (homeView?.kind === "topics") return <div className={styles.scope}>
    <button type="button" className={styles.back} onClick={() => setHomeView(null)}>← Reglas</button>
    <section className={styles.allTopics} aria-labelledby="all-rules-topics-title">
      <h2 id="all-rules-topics-title">Todos los temas</h2>
      {golfRulesCatalog.map(topic => <button type="button" key={topic.id} onClick={() => { setHomeView(null); setQuery(`Regla ${topic.rule}`); }}><span className={styles.smallVisual}><RuleVisual kind={resultVisual(topic.rule)} /></span><span><b>{topic.title}</b><small>Regla {topic.rule}</small></span><span aria-hidden="true">›</span></button>)}
    </section>
  </div>;

  if (homeView?.kind === "situation") {
    const situation = homeView.situation;
    const videos = RULE_SITUATION_VIDEOS[situation.id] || [];
    if (situation.id === "bunker") {
      const recommended = videos[1];
      const rule = findNavigableRule("12.2");
      const clips = [
        { video: videos[0], title: "Qué sí puedes hacer", description: "Alivio cuando hay agua en el búnker." },
        { video: videos[1], title: "Penalidades", description: "Bola injugable: cuatro opciones de alivio." },
        { video: videos[2], title: "Ejemplo rápido", description: "Del green al búnker: golpe y distancia." },
      ];
      return <div className={`${styles.scope} ${styles.bunkerDetail}`}>
        <button type="button" className={styles.back} onClick={() => setHomeView(null)}>← Reglas</button>
        <header className={styles.bunkerHeading}><h2>La bola en un búnker</h2><p>Qué se puede y qué no se puede hacer, y cuándo hay penalidad.</p></header>
        <figure className={styles.bunkerPhoto} role="img" aria-label="Bola de golf en la arena de un búnker"><figcaption>El conocimiento también<br />te lleva más lejos.</figcaption></figure>
        <section className={styles.bunkerVideos} aria-labelledby="situation-videos-title">
          <h2 id="situation-videos-title" className="srOnly">Videos</h2>
          {recommended && <a className={styles.recommendedVideo} href={`https://www.youtube.com/shorts/${recommended.id}`} target="_blank" rel="noreferrer" title={recommended.title}>
            <span className={styles.recommendedThumb} style={{ backgroundImage: `url(https://i.ytimg.com/vi/${recommended.id}/hqdefault.jpg)` }}><span className={styles.playOverlay}><RuleVisual kind="play" /></span><small className={styles.duration}>{recommended.duration}</small></span>
            <span className={styles.recommendedContent}><small className={styles.editorialLabel}>VIDEO RECOMENDADO</small><b>La bola en un búnker</b><span>Opciones de alivio para una bola injugable. Regla 19.3.</span><small className={styles.videoSource}>YouTube | Reglas de Golf · USGA</small><span className={styles.videoAction}>Ver video →</span></span>
          </a>}
          <div className={styles.miniClips}>{clips.map(({ video, title, description }) => video && <a key={video.id} href={`https://www.youtube.com/shorts/${video.id}`} target="_blank" rel="noreferrer" title={video.title}>
            <span className={styles.clipThumb} style={{ backgroundImage: `url(https://i.ytimg.com/vi/${video.id}/hqdefault.jpg)` }}><span className={styles.playOverlay}><RuleVisual kind="play" /></span><small className={styles.duration}>{video.duration}</small></span><b>{title}</b><small>{description}</small>
          </a>)}</div>
        </section>
        <section className={styles.bunkerSummary} aria-labelledby="bunker-summary-title"><h2 id="bunker-summary-title">Resumen de la situación</h2>{BUNKER_SUMMARY.map(item => <button type="button" key={item.title} onClick={() => openRuleReference(item.reference)}><span className={`${styles.summaryIcon} ${styles[item.icon]}`}><RuleVisual kind={item.icon} /></span><span><b>{item.title}</b><small>{item.text}</small></span><span aria-hidden="true">›</span></button>)}</section>
        {rule?.section && <section className={styles.bunkerReference} aria-labelledby="situation-rules-title"><h2 id="situation-rules-title" className="srOnly">Regla relacionada</h2><span className={styles.smallVisual}><RuleVisual kind="book" /></span><div><small className={styles.editorialLabel}>REGLAS DE GOLF</small><b>Regla {rule.section.number}</b><h3>{rule.section.title}</h3><p>Texto oficial, aclaraciones y diagramas.</p><button type="button" onClick={() => openRuleReference("12.2")}>Abrir referencia ↗</button></div></section>}
        <section className={styles.bunkerAi}><span className={styles.smallVisual}><BackyardIcon name="spark" /></span><div><h3>¿Quieres una explicación más simple?</h3><p>Pregúntale a la IA.</p></div><button type="button" onClick={() => prepareAi("Quiero una explicación más simple de la Regla 12.2: qué puedo hacer en un búnker y cuándo hay penalidad.")}>Preguntar ahora</button></section>
      </div>;
    }
    return <div className={`${styles.scope} ${styles.situationView}`}>
      <button type="button" className={styles.back} onClick={() => setHomeView(null)}>← {situation.id === "bunker" ? "Búnker" : "Reglas"}</button>
      <section className={styles.situationHero} aria-labelledby="situation-title">
        <span className={styles.heroVisual}><RuleVisual kind={situation.visual} /></span>
        <div><h2 id="situation-title">{situation.title}</h2><p>{situation.description}</p><span className={styles.situationBadge}><RuleVisual kind="ball" />Situación común</span></div>
      </section>
      <section className={styles.situationVideos} aria-labelledby="situation-videos-title">
        <h2 id="situation-videos-title">Videos</h2>
        {videos.length ? videos.map(video => <a className={styles.videoCard} key={video.id} href={`https://www.youtube.com/shorts/${video.id}`} target="_blank" rel="noreferrer" title={video.title}>
          <span className={styles.videoThumb} style={{ backgroundImage: `url(https://i.ytimg.com/vi/${video.id}/hqdefault.jpg)` }} aria-hidden="true"><span><RuleVisual kind="play" /></span></span>
          <span><b>{video.displayTitle}</b><small>{video.description}</small></span><span aria-hidden="true">›</span>
        </a>) : <a className={styles.videoCard} href={OFFICIAL_RULES_VIDEOS_URL} target="_blank" rel="noreferrer"><span className={styles.smallVisual}><RuleVisual kind="play" /></span><b>Ver videos relacionados de Reglas</b><span aria-hidden="true">›</span></a>}
      </section>
      <section className={styles.relatedRules} aria-labelledby="situation-rules-title">
        <h2 id="situation-rules-title">Regla relacionada</h2>
        {situation.references.map(reference => {
          const rule = findNavigableRule(reference);
          if (!rule?.section) return null;
          return <article className={styles.relatedCard} key={reference}><span className={styles.smallVisual}><RuleVisual kind="book" /></span><div><small>Regla {rule.section.number}</small><h3>{rule.section.title}</h3><p>{rule.section.summary || rule.chapter.summary}</p><button type="button" onClick={() => openRuleReference(reference)}>Abrir referencia ↗</button></div></article>;
        })}
      </section>
    </div>;
  }

  return <div className={`rulesHome ${styles.scope}`}>
    {!hasQuery && <><section className={styles.aiHero} aria-labelledby="rules-ai-hero-title">
      <div className={styles.aiHeroContent}><span className={styles.aiEyebrow}>REGLAS DE GOLF, MÁS CLARAS</span><h2 id="rules-ai-hero-title">Pregúntale al juez de Reglas <em>Backyard IA</em></h2><p>Resuelve dudas de reglas y situaciones del campo en segundos.</p><button type="button" onClick={() => prepareAi("")}><BackyardIcon name="spark" />Preguntar a la IA<span aria-hidden="true">›</span></button></div><p className={styles.aiHeroQuote}>El golf se disfruta más cuando sabes las reglas.</p>
    </section><p className={styles.aiDisclaimer}>ⓘ La IA puede equivocarse. Verifica la regla oficial.</p></>}
<section className="rulesSearchHero" id="buscar-regla">
      <label className="srOnly" htmlFor="rules-search">Buscar en las Reglas</label>
      <div className="rulesSearchField">
        <span className="rulesSearchIcon" aria-hidden="true"><RuleVisual kind="search" /></span>
        <input id="rules-search" type="search" autoComplete="off" value={query} placeholder="Buscar una regla, situación o palabra clave…" onChange={(event) => setQuery(event.target.value)} />
        {hasQuery && <button type="button" className={styles.clearSearch} aria-label="Limpiar búsqueda" onClick={clearSearch}><span aria-hidden="true">×</span></button>}
      </div>
    </section>
{hasQuery && <section className="card rulesSearchResults" aria-live="polite">
      <div className="sectionTitle"><div><h2>Resultados</h2><p>Búsqueda local en Reglas, Procedimientos del Comité y Aclaraciones 2026.</p></div>{searching && <span className="statusPill">Buscando…</span>}</div>
      {!searching && !results.length && <div className="empty">No hay una coincidencia suficiente para “{query}”. <button className="textButton" onClick={() => prepareAi(query)}>Preguntar a IA</button></div>}
      <div className="rulesResults">{results.slice(0, visibleResults).map((entry) => <article className="ruleResult" key={entry.id}>
        <button className="ruleResultOpen" onClick={() => openRuleReference(entry.rule, entry.sourceId, entry.page)}>
          <span className={styles.resultVisual}><RuleVisual kind={resultVisual(entry.rule)} /></span>
          <span className={styles.resultContent}>
          <span className={`rulesSourceBadge ${entry.documentType}`}>{resultLabel(entry.documentType)}</span>
          <b>{entry.rule === "Fuente oficial" ? entry.rule : `Regla ${entry.rule}`}</b>
          <h3>{entry.title}</h3>
          <p>{entry.explanation}</p>
          <small>{entry.source}{entry.page ? ` · p. ${entry.page}` : ""}</small>
          <span className="ruleOpenLabel">Abrir referencia →</span>
          </span>
        </button>
      </article>)}</div>
      {results.length > visibleResults && <button className="secondary big" onClick={() => setVisibleResults(count => count + 20)}>Mostrar más · {visibleResults} de {results.length} coincidencias</button>}
      {!searching && <p className="muted">{results.length} coincidencias · ninguna se descarta por límite</p>}
      {!searching && <div className="rulesAiFallback"><span>¿No encontraste lo que buscabas?</span><button className="textButton" onClick={() => prepareAi(query)}>Preguntar a IA</button></div>}
    </section>}

    {!hasQuery && <>
      <section className="rulesTopics" aria-labelledby="rules-topics-title"><div className="rulesHomeSectionTitle"><h2 id="rules-topics-title">Temas principales</h2><button type="button" onClick={() => setHomeView({ kind: "topics" })}>Ver todos ›</button></div><div className="rulesTopicGrid">{[{ label: "Bolas", visual: "ball", query: "bola" }, { label: "Alivio", visual: "relief", query: "alivio" }, { label: "Búnker", visual: "bunker", situation: "bunker" }, { label: "Fuera de límites", visual: "bounds", situation: "out_of_bounds" }, { label: "Penalidades", visual: "penalty", query: "penalidad" }].map(topic => <button type="button" key={topic.label} onClick={() => {
        const situation = RULES_COMMON_SITUATIONS.find(entry => entry.id === topic.situation);
        if (situation) setHomeView({ kind: "situation", situation });
        else setQuery(topic.query || topic.label);
      }}><span className={`${styles.topicPhoto} ${topic.visual === "ball" ? styles.brandedBall : styles[topic.visual]}`} style={topic.visual === "ball" ? undefined : { backgroundImage: `url(/rules/${topic.visual}.webp)` }} aria-hidden="true" /><b>{topic.label}</b></button>)}</div></section>
      <section className="rulesCommon" aria-labelledby="rules-common-title"><h2 id="rules-common-title">Situaciones comunes</h2>{RULES_COMMON_SITUATIONS.map(situation => <button type="button" className={styles.situationCard} key={situation.id} onClick={() => setHomeView({ kind: "situation", situation })}><span className={styles.situationThumb} style={{ backgroundImage: `url(/rules/${SITUATION_PHOTOS[situation.id]}.webp)` }} aria-hidden="true">{RULE_SITUATION_VIDEOS[situation.id]?.length > 0 && <span className={styles.playOverlay}><RuleVisual kind="play" /></span>}</span><span><b>{situation.title}</b><small>{situation.description}</small></span><span aria-hidden="true">›</span></button>)}</section>
      <aside className="rulesPromise"><span className={styles.smallVisual}><RuleVisual kind="book" /></span><p><b>Reglas explicadas, juego más simple.</b><br />Respuestas claras para que disfrutes más el golf.</p></aside>
    </>}
    <RulesDisclosure id="rules-more-resources" title="Más recursos" open={Boolean(openSections.resources)} onToggle={() => toggleSection("resources")}>
    <RulesDisclosure id="preguntar-ia" title="Preguntar a la IA" icon="spark" open={Boolean(openSections.ai)} onToggle={() => toggleSection("ai")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Preguntar a la IA</h2><p>{localRulesApply ? "Consulta fuentes oficiales y las Reglas Locales aplicables." : "Consulta Guía Oficial, Procedimientos y Aclaraciones sin asumir Reglas Locales."}</p></div><span className={`statusPill ${aiState === "ready" ? "ready" : ""}`}>{aiState === "checking" ? "Verificando…" : aiState === "ready" ? "IA activa" : aiState === "disabled" ? "IA no activada" : aiState === "unavailable" ? "Estado no disponible" : "Falta configuración"}</span></div>
      <p className={styles.aiNotice}>La IA puede equivocarse y no sustituye la regla oficial. Verifica la regla oficial.</p>
      <form onSubmit={ask}>
        <label htmlFor="rules-question">Describe qué pasó</label>
        <div className="dictationField"><textarea id="rules-question" rows={4} maxLength={1200} value={question} placeholder="Mi bola está fuera del camino pero mis pies están sobre el camino…" onChange={(event) => setQuestion(event.target.value)} /><button type="button" className={`dictationButton ${listeningTarget === "question" ? "listening" : ""}`} aria-pressed={listeningTarget === "question"} aria-label={listeningTarget === "question" ? "Detener dictado" : "Iniciar dictado"} onClick={() => toggleDictation("question")}>{listeningTarget === "question" ? "🔴 Detener" : "🎙"}</button></div>
        <button className="primary" type="submit" disabled={asking || aiState !== "ready" || question.trim().length < 8}>{asking ? "Consultando…" : "Consultar reglamento"}</button>
      </form>
      {dictationMessage && <div className="rulesSearchStatus" role="status">{dictationMessage}</div>}
      {error && <div className="notice">{error} La búsqueda manual sigue disponible.</div>}
      {answer && <div className="aiAnswer" aria-live="polite">{answer}</div>}
      {answerEvidence.length > 0 && <section className="rulesAiEvidence" aria-labelledby="rules-ai-evidence-title">
        <h3 id="rules-ai-evidence-title">Evidencia citada</h3>
        <ul>{answerEvidence.map((entry) => <li key={`${entry.citation}:${entry.sourceId}:${entry.page || ""}:${entry.rule}`}>
          <b>{entry.citation} · {entry.rule || "Referencia oficial"}</b>
          <span>{entry.title}</span>
          {entry.sourceUrl
            ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.source}{entry.page ? ` · p. ${entry.page}` : ""} ↗</a>
            : <small>{entry.source}{entry.page ? ` · p. ${entry.page}` : ""}</small>}
        </li>)}</ul>
      </section>}
      {accountConsentRequired && <AiProcessingConsentRequired scope={AI_PROVIDER_PROCESSING_CONSENT} />}
      {showConsent && identity.mode !== "authenticated" && <AiProcessingConsentPrompt
        userId={identity.userId}
        accessToken={identity.accessToken}
        requiresRemoteConsent={false}
        scope={AI_PROVIDER_PROCESSING_CONSENT}
        onAccepted={() => void requestRulesAnswer()}
        onCancel={() => setShowConsent(false)}
      />}
      <div className="hint">La búsqueda del reglamento nunca llama a OpenAI. En competencia, el Comité o árbitro oficial tiene la decisión final.</div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="reglamento-navegable" title="Reglamento navegable" open={Boolean(openSections.directory)} onToggle={() => toggleSection("directory")}>
<section className="card rulesDirectory" id="reglas-de-golf">
      <div className="sectionTitle"><div><div className="eyebrow">REGLAS DE GOLF</div><h2>Reglamento navegable</h2><p>25 reglas · toca una para ver sus subreglas.</p></div></div>
      <div className="rulesAccordion">{NAVIGABLE_GOLF_RULES.map((entry) => {
        const open = expandedRule === entry.number;
        return <article className={`ruleChapter ${open ? "open" : ""}`} id={`regla-${entry.number}`} key={entry.number}>
          <h3><button aria-expanded={open} aria-controls={`contenido-regla-${entry.number}`} onClick={() => setExpandedRule(open ? null : entry.number)}><span className="ruleChapterNumber">{entry.number}</span><span>{entry.title}</span><span className="ruleChevron" aria-hidden="true">⌄</span></button></h3>
          {open && <div className="ruleChapterBody" id={`contenido-regla-${entry.number}`}>
            <p>{entry.summary}</p>
            <div className="ruleSections">{entry.sections.map((child) => <button key={child.number} onClick={() => { setDetail({ chapter: entry, section: child }); window.scrollTo({ top: 0, behavior: "smooth" }); }}><b>{child.number}</b><span>{child.title}</span><strong aria-hidden="true">›</strong></button>)}</div>
            <div className="ruleChapterLinks"><a href={entry.sourceUrl} target="_blank" rel="noreferrer">Ver fuente oficial ↗</a>{CLARIFICATION_RULES.has(Number(entry.number)) && <button className="textButton" onClick={() => { setDocumentPage(1); setSelectedDocument(OFFICIAL_RULES_DOCUMENTS[2]); }}>Abrir Aclaraciones relacionadas</button>}</div>
          </div>}
        </article>;
      })}</div>
    </section>
    </RulesDisclosure>

    <section className="card rulesResourceShortcut" id="procedimientos-comite">
      <div className="sectionTitle"><div><span className="rulesSourceBadge committee">COMITÉ</span><h2>Procedimientos oficiales</h2><p>Guía separada para quienes administran el campo o una competencia.</p></div></div>
      <button className="primary big" onClick={() => { setDocumentPage(1); setSelectedDocument(OFFICIAL_RULES_DOCUMENTS[1]); }}>Abrir Procedimientos oficiales</button>
    </section>

    <section className="card rulesResourceShortcut" id="aclaraciones">
      <div className="sectionTitle"><div><span className="rulesSourceBadge clarification">ACLARACIONES</span><h2>Aclaraciones</h2><p>Documento vigente 2026; también participa en la búsqueda del reglamento.</p></div></div>
      <button className="primary big" onClick={() => { setDocumentPage(1); setSelectedDocument(OFFICIAL_RULES_DOCUMENTS[2]); }}>Abrir Aclaraciones</button>
    </section>

    {localRulesApply && <RulesDisclosure id="reglas-locales" title="⛳ Reglas Locales · La Vista" open={Boolean(openSections.local)} onToggle={() => toggleSection("local")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Reglas Locales · La Vista</h2><p>Solo lectura. Aplican únicamente a La Vista y La Vista Temporal.</p></div>{localRulesUpdatedAt && <span className="statusPill">Actualizadas {localRulesUpdatedAt}</span>}</div>
      <div className="localRulesList">{visibleLocalRules.map((entry) => <article key={entry.id}><span>{entry.hole ? `Hoyo ${entry.hole}` : "General"}</span><h3>{entry.title}</h3><p>{entry.text}</p></article>)}</div>
    </section>
    </RulesDisclosure>}

    <RulesDisclosure id="codigo-caballeros" title="Código de Caballeros" icon="players" open={Boolean(openSections.gentlemen)} onToggle={() => toggleSection("gentlemen")}>
<section className="card">
      <div className="sectionTitle"><div><h2>Código de Caballeros</h2><p>Etiqueta y cultura de juego</p></div><span className="statusPill">NO OFICIAL</span></div>
      <div className="gentlemenGrid">{GENTLEMEN_CODE.map((entry) => <article key={entry.id}><h3>{entry.title}</h3><ul>{entry.points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
      <blockquote>{GENTLEMEN_CODE_FINAL_QUOTE}</blockquote>
      <div className="notice">{GENTLEMEN_CODE_DISCLAIMER}</div>
    </section>
    </RulesDisclosure>

    <RulesDisclosure id="documentos-oficiales" title="Documentos oficiales" open={Boolean(openSections.documents)} onToggle={() => toggleSection("documents")}>
<section className="card officialLinks">
      <div className="sectionTitle"><div><h2>Documentos oficiales</h2><p>Fuentes completas usadas por el buscador y Preguntar a IA.</p></div></div>
      <div className="officialDocumentGrid">{OFFICIAL_RULES_DOCUMENTS.slice(0, 1).map((document) => <article key={document.id}>
        <span className="pillSmall">{document.type}</span>
        <h3>{document.title}</h3>
        <p>{document.edition}</p>
        <b className="sourceUsed">Documento indexado para IA ✓</b>
        <div className="documentActions"><button className="primary" onClick={() => setSelectedDocument(document)}>Abrir documento</button></div>
      </article>)}</div>
      <div className="officialLinkRow"><a className="secondary" href={OFFICIAL_RULES_SPANISH_URL} target="_blank" rel="noreferrer">Recursos USGA en español ↗</a><a className="secondary" href={OFFICIAL_RULES_URL} target="_blank" rel="noreferrer">Rules Hub USGA ↗</a></div>
    </section>
    </RulesDisclosure>

    <section className="card videosCard" id="videos-reglas">
      <div className="sectionTitle"><div><h2>Videos de Reglas</h2><p>Playlist existente de consulta para móvil y escritorio.</p></div></div>
      <div className="videoFrame"><iframe src={OFFICIAL_RULES_VIDEOS_EMBED_URL} title="Playlist Videos de Reglas" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>
      <a className="primary big" href={OFFICIAL_RULES_VIDEOS_URL} target="_blank" rel="noreferrer">Ver videos de Reglas ↗</a>
    </section>
    </RulesDisclosure>

    <BottomBackAction label="← Regresar" onBack={onBack} />

    {selectedDocument && <InternalPdfViewer document={selectedDocument} initialPage={documentPage} onBack={() => { setSelectedDocument(null); setDocumentPage(1); }} />}
  </div>;
}
