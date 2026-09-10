"use client";

import { useEffect, useRef, useState } from "react";

import { requestBackyardAi } from "../../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../../lib/backyard-ai/consent-client";
import {
  browserAiProcessingConsentStorage,
  hasActiveAiProcessingConsent,
} from "../../../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../../lib/backyard-ai/privacy";
import { readGroupPreferences } from "../../../lib/backyard-ai/memory/group-memory";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, readLearningConsent, writeLearningConsent } from "../../../lib/backyard-ai/memory/learning-events";
import { readUserPreferences } from "../../../lib/backyard-ai/memory/personal-memory";
import { parseUnknownPlayerClarification } from "../../../lib/backyard-ai/runtime/clarification";
import { validateCanonicalRoundCommand } from "../../../lib/backyard-ai/runtime/canonical-command-guard";
import type { RoundSetupMemoryContext } from "../../../lib/backyard-ai/runtime/context-resolver";
import { roundSetupAnswerCommand } from "../../../lib/backyard-ai/runtime/answer-command";
import { planRoundSetup, type RoundSetupPlan } from "../../../lib/backyard-ai/runtime/round-setup";
import type { RoundSetupQuestion } from "../../../lib/backyard-ai/schemas/actions";
import type { RoundSetupDraft } from "../../../lib/backyard-ai/schemas/round-setup";
import { frequentPersonalSuggestions, personalBetFromFrequentTemplate } from "../../../lib/personal-modes";
import { createDictationSession, DICTATION_FALLBACK, speechRecognitionConstructor } from "../../../lib/speech-dictation";
import type { FrequentPlayer, SavedPersonalRival } from "../../../lib/types";
import { AiProcessingConsentPrompt } from "./ai-processing-consent";
import { AiRoundReview } from "./ai-round-review";
import styles from "./backyard-ai.module.css";

type RoundSetupAiResponse = {
  canonicalCommand: string;
  confidence: number;
  clarification: string | null;
};

export type AiRoundSetupTelemetry = {
  input: string;
  previousDraft: RoundSetupDraft;
  success: boolean;
  questionCount: number;
  durationMs: number;
  usedModel: boolean;
  confidence: number;
  isCorrection: boolean;
  plan: RoundSetupPlan;
};

export type AiRoundSetupProps = {
  initialDraft: RoundSetupDraft;
  memoryContext: Omit<RoundSetupMemoryContext, "activeDraft">;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
  savedPersonalRivals?: SavedPersonalRival[];
  onConfirm: (draft: RoundSetupDraft, plan: RoundSetupPlan) => void;
  onManualEdit: (draft: RoundSetupDraft) => void;
  onCancel: () => void;
  onPlanned?: (event: AiRoundSetupTelemetry) => void;
};

const EXAMPLES = [
  "Jugamos Said, Pedro, Juan y Carlos. Skins de 100 y Nassau de 500.",
  "Los mismos del domingo pero skins a 200.",
  "Bola Amiga Said/Juan contra Pedro/Carlos.",
  "Todos juegan Skins menos Carlos.",
];

const MIN_MODEL_CONFIRMATION_CONFIDENCE = 0.7;

function parsedHandicapInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  const numeric = Number(normalized);
  const handicap = normalized.startsWith("+") ? -Math.abs(numeric) : numeric;
  return Number.isFinite(handicap) && handicap >= -15 ? Math.min(36, handicap) : null;
}

export function AiRoundSetup({ initialDraft, memoryContext, accessToken, requiresRemoteConsent, savedPersonalRivals = [], onConfirm, onManualEdit, onCancel, onPlanned }: AiRoundSetupProps) {
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [plan, setPlan] = useState<RoundSetupPlan | null>(null);
  const [lastCommand, setLastCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [dictationStatus, setDictationStatus] = useState("");
  const [dictationSupported, setDictationSupported] = useState(false);
  const [showProviderConsent, setShowProviderConsent] = useState(false);
  const [pendingProviderInput, setPendingProviderInput] = useState("");
  const [localInterpreterOnly, setLocalInterpreterOnly] = useState(false);
  const [consentStorageWarning, setConsentStorageWarning] = useState("");
  const [personalMemoryEnabled, setPersonalMemoryEnabled] = useState(() => {
    const ownerId = memoryContext.profile?.userId;
    return Boolean(ownerId && typeof window !== "undefined" && readLearningConsent(browserAiProcessingConsentStorage(), ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent.personalMemoryEnabled);
  });
  const [sessionPlayers, setSessionPlayers] = useState<FrequentPlayer[]>([]);
  const [dismissedPersonalSuggestions, setDismissedPersonalSuggestions] = useState<string[]>([]);
  const [handicapAnswers, setHandicapAnswers] = useState<Record<string, string>>({});
  const recognitionRef = useRef<ReturnType<typeof createDictationSession> | null>(null);
  const composerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handicapInputRef = useRef<HTMLInputElement | null>(null);
  const dictationPrefix = useRef("");
  const mounted = useRef(true);
  const submissionGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const speechWindow = window as typeof window & Parameters<typeof speechRecognitionConstructor>[0];
    setDictationSupported(Boolean(speechRecognitionConstructor(speechWindow)));
    return () => {
      mounted.current = false;
      submissionGeneration.current += 1;
      recognitionRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  function changeInput(next: string) {
    setInput(next);
  }

  function resolveQuestion(selected: RoundSetupQuestion) {
    setPlan((current) => {
      if (!current) return current;
      const selectedIndex = current.questions.findIndex((question) => question === selected
        || (question.code === selected.code && question.field === selected.field));
      if (selectedIndex <= 0) return current;
      const questions = [...current.questions];
      const [question] = questions.splice(selectedIndex, 1);
      return { ...current, questions: [question, ...questions] };
    });
    setEditing(false);
    setInput("");
    setHandicapAnswers({});
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (selected.code === "missing_player_handicaps") handicapInputRef.current?.focus({ preventScroll: true });
      else textareaRef.current?.focus({ preventScroll: true });
    });
  }

  function toggleDictation() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const Recognition = speechRecognitionConstructor(window as typeof window & Parameters<typeof speechRecognitionConstructor>[0]);
    if (!Recognition) { setDictationStatus(DICTATION_FALLBACK); return; }
    recognitionRef.current?.dispose();
    dictationPrefix.current = input.trim();
    const session = createDictationSession(Recognition, {
      transcript: (text) => changeInput([dictationPrefix.current, text].filter(Boolean).join(" ")),
      status: setDictationStatus,
      listening: setListening,
      fallback: () => setDictationSupported(false),
    });
    recognitionRef.current = session;
    session.start();
  }

  async function submit(submittedInput?: string, providerConsentJustAccepted = false, useLocalInterpreter = false) {
    if (!mounted.current) return;
    const raw = (submittedInput ?? input).trim();
    if (raw.length < 2 || busy) return;
    const processingConsentOwnerId = memoryContext.profile?.userId || initialDraft.ownerId;
    const remoteConsentUnavailable = requiresRemoteConsent && !accessToken;
    let allowProvider = providerConsentJustAccepted && !remoteConsentUnavailable;
    if (!allowProvider && !remoteConsentUnavailable && !localInterpreterOnly && !useLocalInterpreter && processingConsentOwnerId && typeof window !== "undefined") {
      if (accessToken) {
        setBusy(true);
        setNotice("Verificando tu autorización de IA…");
        try {
          const authority = await resolveAuthoritativeAiProcessingConsent({
            accessToken,
            storage: browserAiProcessingConsentStorage(),
            userId: processingConsentOwnerId,
            scope: AI_PROVIDER_PROCESSING_CONSENT,
          });
          if (!mounted.current) return;
          allowProvider = !authority.discarded && authority.active && !authority.pendingLocalRevocation;
        } catch {
          allowProvider = false;
        } finally {
          setBusy(false);
          setNotice("");
        }
      } else {
        try {
          allowProvider = hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), processingConsentOwnerId, AI_PROVIDER_PROCESSING_CONSENT);
        } catch {
          allowProvider = false;
        }
      }
    }
    if (!mounted.current) return;
    if (!allowProvider && !remoteConsentUnavailable && !localInterpreterOnly && !useLocalInterpreter && processingConsentOwnerId) {
      setPendingProviderInput(raw);
      setShowProviderConsent(true);
      return;
    }
    recognitionRef.current?.dispose();
    recognitionRef.current = null;
    setListening(false);
    const focusedQuestion = editing ? undefined : plan?.questions[0];
    const clarifiedPlayer = parseUnknownPlayerClarification(focusedQuestion, raw);
    if (focusedQuestion?.code === "unknown_player" && !clarifiedPlayer) {
      setNotice("Escribe el handicap entre +15 y 36. Si capturas más de 36, lo ajustaremos a 36.");
      return;
    }
    const generation = ++submissionGeneration.current;
    const started = performance.now();
    setBusy(true);
    setNotice("");
    const command = clarifiedPlayer && lastCommand ? lastCommand : roundSetupAnswerCommand(focusedQuestion, raw, plan, lastCommand);
    let canonicalCommand = command;
    let modelConfidence: number | null = null;
    let clarification: string | null = null;
    let usedModel = false;
    if (!clarifiedPlayer && allowProvider) {
      try {
        const response = await requestBackyardAi<RoundSetupAiResponse>("/api/backyard-ai/round-setup", { input: command, consent: backyardAiProviderConsent(AI_PROVIDER_PROCESSING_CONSENT) }, 30_000, accessToken);
        if (!mounted.current || generation !== submissionGeneration.current) return;
        const integrity = validateCanonicalRoundCommand(command, response.canonicalCommand);
        if (integrity.ok) {
          canonicalCommand = integrity.command;
          modelConfidence = response.confidence;
          clarification = response.clarification;
          usedModel = true;
        } else {
          canonicalCommand = command;
          setNotice("La respuesta del proveedor cambió datos explícitos, así que la descarté. Continuamos con el intérprete local seguro; revisa Tu ronda antes de iniciar.");
        }
      } catch {
        if (!mounted.current || generation !== submissionGeneration.current) return;
        setNotice("Continuamos con el intérprete local seguro. Puedes usar el modo manual en cualquier momento.");
      }
    } else if (!clarifiedPlayer) {
      setNotice(remoteConsentUnavailable
        ? "Tu cuenta necesita recuperar la sesión para usar el proveedor. Esta instrucción no se envió y continuamos con el intérprete local seguro."
        : "Interpretación local activa: esta instrucción no se envió al proveedor de IA.");
    }
    const nextSessionPlayers = clarifiedPlayer ? [...sessionPlayers, {
      id: `ai-session-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      name: clarifiedPlayer.name,
      handicap: clarifiedPlayer.handicap,
      uses: 0,
      updatedAt: new Date().toISOString(),
    }] : sessionPlayers;
    const ownerId = memoryContext.profile?.userId;
    const clientStorage = browserAiProcessingConsentStorage();
    const consent = ownerId ? readLearningConsent(clientStorage, ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent : null;
    const personalMemoryEnabled = Boolean(ownerId && consent?.personalMemoryEnabled);
    const userPreferences = personalMemoryEnabled
      ? readUserPreferences(clientStorage, ownerId!).document.items
      : [];
    const groupPreferences = personalMemoryEnabled
      ? readGroupPreferences(clientStorage, ownerId!).document.items
      : [];
    const next = planRoundSetup(canonicalCommand, {
      ...memoryContext,
      frequentPlayers: [...(memoryContext.frequentPlayers || []), ...nextSessionPlayers],
      userPreferences,
      groupPreferences,
      activeDraft: plan || editing ? draft : null,
    });
    const lowConfidenceQuestion = modelConfidence !== null
      && modelConfidence < MIN_MODEL_CONFIRMATION_CONFIDENCE
      && !clarification
      && next.questions.length === 0
      ? [{
          code: "ambiguous_bet" as const,
          field: "ai.confidence",
          prompt: "No tengo suficiente confianza para iniciar todavía. ¿Qué dato de la ronda debo corregir?",
        }]
      : [];
    const planned = clarification
      ? {
          ...next,
          questions: [{ code: "ambiguous_bet" as const, field: "ai.clarification", prompt: clarification }, ...next.questions],
          canConfirm: false,
        }
      : lowConfidenceQuestion.length
        ? { ...next, questions: lowConfidenceQuestion, canConfirm: false }
        : next;
    setPlan(planned);
    setDraft(planned.draft);
    setLastCommand(canonicalCommand);
    if (clarifiedPlayer) setSessionPlayers(nextSessionPlayers);
    setInput("");
    setHandicapAnswers({});
    setEditing(false);
    setBusy(false);
    onPlanned?.({ input: raw, previousDraft: draft, success: planned.canConfirm, questionCount: planned.questions.length, durationMs: Math.round(performance.now() - started), usedModel, confidence: modelConfidence ?? planned.interpretation.confidence, isCorrection: Boolean(plan || editing), plan: planned });
  }

  function cancel() {
    submissionGeneration.current += 1;
    recognitionRef.current?.dispose();
    onCancel();
  }

  function changePersonalMemory(enabled: boolean) {
    const ownerId = memoryContext.profile?.userId;
    if (!ownerId) { setNotice("No hay una identidad local donde guardar esta preferencia."); return; }
    const clientStorage = browserAiProcessingConsentStorage();
    const current = readLearningConsent(clientStorage, ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
    const now = new Date().toISOString();
    const previousGrantedAt = current.grantedAt;
    const base = { ...current };
    delete base.grantedAt;
    delete base.revokedAt;
    const next = enabled
      ? { ...base, personalMemoryEnabled: true, updatedAt: now, grantedAt: previousGrantedAt ?? now }
      : { ...base, personalMemoryEnabled: false, updatedAt: now, revokedAt: now };
    const result = writeLearningConsent(clientStorage, next);
    if (!result.ok) { setNotice("No pude guardar la preferencia de memoria en este dispositivo."); return; }
    setPersonalMemoryEnabled(enabled);
  }

  function addFrequentPersonal(template: SavedPersonalRival) {
    const rival = draft.players.find((player) => player.name.trim().toLocaleLowerCase("es-MX") === template.name.trim().toLocaleLowerCase("es-MX"));
    if (!rival) return draft;
    const owner = draft.players.find((player) => player.id === draft.ownerId);
    const personalBetId = memoryContext.idFactory?.() ?? `personal-${template.id}-${draft.personalBets.length + 1}`;
    const personalBet = personalBetFromFrequentTemplate({ template, owner, rival, id: personalBetId, effectiveAt: draft.date });
    const nextDraft = { ...draft, personalBets: [...draft.personalBets, personalBet] };
    setDraft(nextDraft);
    setPlan((current) => current ? { ...current, draft: nextDraft } : current);
    setDismissedPersonalSuggestions((current) => [...new Set([...current, template.id])]);
    setNotice(`Personal frecuente con ${template.name} agregada. Revísala antes de iniciar.`);
    return nextDraft;
  }

  const question = plan?.questions[0];
  const handicapTargets = question?.code === "missing_player_handicaps" ? question.playerTargets ?? [] : [];
  const handicapAnswer = handicapTargets.map((target) => `${target.label} HCP ${parsedHandicapInput(handicapAnswers[target.id] ?? "") ?? ""}`).join(", ");
  const handicapAnswerReady = handicapTargets.length > 0 && handicapTargets.every((target) => parsedHandicapInput(handicapAnswers[target.id] ?? "") !== null);
  const usesHandicapForm = !editing && handicapTargets.length > 0;
  const showComposer = !plan || editing || Boolean(question);
  const personalSuggestions = frequentPersonalSuggestions(savedPersonalRivals, draft.players).filter(({ template }) => (
    !dismissedPersonalSuggestions.includes(template.id)
    && !draft.personalBets.some((bet) => bet.enabled !== false && (bet.externalRivalId === template.id || bet.rivalName.trim().toLocaleLowerCase("es-MX") === template.name.trim().toLocaleLowerCase("es-MX")))
  ));
  return <section className={styles.screen} aria-labelledby="backyard-ai-setup-title">
    <section className={styles.hero}>
      <span className="eyebrow">BACKYARD AI · MÉXICO</span>
      <h1 id="backyard-ai-setup-title">Dime cómo juegan.</h1>
      <p>Habla o escribe como lo dirías en el grupo. Backyard recupera lo que ya conoce, prepara una ronda real y te deja confirmar antes de empezar.</p>
    </section>

    {question && <section className={styles.question}><b>Una sola pregunta</b><span role="status">{question.prompt}</span>{question.candidates?.length ? <div className={styles.suggestions}>{question.candidates.map((candidate) => <button type="button" key={candidate.id} disabled={busy} onClick={() => changeInput(candidate.label)}>{candidate.label}</button>)}</div> : null}</section>}

    {showComposer && <section className={styles.composer} ref={composerRef}>
      {editing && <h2 className={styles.composerTitle}>¿Qué quieres cambiar?</h2>}
      {usesHandicapForm ? <div className={styles.handicapGrid}>
        {handicapTargets.map((target, index) => <label key={target.id}><span>{target.label}</span><input ref={index === 0 ? handicapInputRef : undefined} autoFocus={index === 0} aria-label={`HCP de ${target.label}`} inputMode="decimal" placeholder="HCP" value={handicapAnswers[target.id] ?? ""} disabled={busy} onChange={(event) => setHandicapAnswers((current) => ({ ...current, [target.id]: event.target.value }))} onBlur={() => { const value = parsedHandicapInput(handicapAnswers[target.id] ?? ""); if (value !== null) setHandicapAnswers((current) => ({ ...current, [target.id]: String(value) })); }} /></label>)}
      </div> : <textarea ref={textareaRef} autoFocus aria-label={editing ? "¿Qué quieres cambiar?" : "Describe la ronda"} placeholder={question ? "Responde sólo este dato…" : "Ej. Hoy jugamos Said, Pedro, Juan y Carlos en La Vista. Skins de $200 y Nassau de $500…"} value={input} maxLength={2_400} disabled={busy} onChange={(event) => changeInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit(); }} />}
      {!plan && <div className={styles.suggestions}>{EXAMPLES.map((example) => <button type="button" key={example} disabled={busy} onClick={() => changeInput(example)}>{example}</button>)}</div>}
      <div className={styles.composerActions}>
        <button type="button" className="primary big" disabled={busy || (usesHandicapForm ? !handicapAnswerReady : input.trim().length < 2)} onClick={() => void submit(usesHandicapForm ? handicapAnswer : undefined)}>{busy ? "Entendiendo…" : editing ? "Aplicar cambio" : question ? "Confirmar respuesta" : "Preparar mi ronda"}</button>
        {!usesHandicapForm && <button type="button" className={styles.voiceButton} data-listening={listening} disabled={busy || (!dictationSupported && Boolean(dictationStatus))} onClick={toggleDictation}>{listening ? "■ Detener" : "🎙 Hablar"}</button>}
      </div>
      <label className={styles.consent}><input type="checkbox" checked={personalMemoryEnabled} disabled={busy} onChange={(event) => changePersonalMemory(event.target.checked)} /><span>Recordar en mi espacio privado las preferencias que confirme para facilitar rondas futuras. Esto no habilita training global.</span></label>
      {dictationStatus && <p className={styles.contextNote} role="status">{dictationStatus}</p>}
      {notice && <p className={styles.contextNote} role="status">{notice}</p>}
      <p className={styles.privacyNote}>La autorización para procesar instrucciones con IA se solicita una sola vez y puede revocarse en Perfil → Privacidad / IA. Nunca se envían tu histórico ni tus memorias personales; esos datos se resuelven en el dispositivo.</p>
    </section>}

    {plan && <>
      {plan.memory.length > 0 && <p className={styles.contextNote}>Usé contexto existente: {plan.memory.map((item) => item.label).join(" · ")}.</p>}
      {personalSuggestions.map(({ template, message }) => <section className={styles.question} key={template.id}><b>Personal frecuente</b><span>{message}</span><div className={styles.suggestions}><button type="button" onClick={() => addFrequentPersonal(template)}>SÍ</button><button type="button" onClick={() => setDismissedPersonalSuggestions((current) => [...new Set([...current, template.id])])}>NO</button><button type="button" onClick={() => onManualEdit(addFrequentPersonal(template))}>EDITAR</button></div></section>)}
      <AiRoundReview draft={draft} questions={plan.questions} issues={plan.configurationIssues} canConfirm={plan.canConfirm} busy={busy} onConfirm={() => onConfirm(draft, plan)} onConversationalChange={() => { setEditing(true); changeInput(""); }} onResolveQuestion={resolveQuestion} onManualEdit={() => onManualEdit(draft)} />
    </>}

    {consentStorageWarning && <p className={styles.contextNote} role="status">{consentStorageWarning}</p>}

    {!plan && <button type="button" className="secondary" disabled={busy} onClick={() => onManualEdit(draft)}>Configurar manualmente</button>}
    <button type="button" className="textButton" onClick={cancel}>Cancelar</button>
    {showProviderConsent && (memoryContext.profile?.userId || initialDraft.ownerId) && <AiProcessingConsentPrompt
      userId={memoryContext.profile?.userId || initialDraft.ownerId}
      accessToken={accessToken}
      requiresRemoteConsent={requiresRemoteConsent}
      scope={AI_PROVIDER_PROCESSING_CONSENT}
      onAccepted={(_consent, persistence) => {
        setShowProviderConsent(false);
        setLocalInterpreterOnly(false);
        if (!persistence.localPersisted) {
          setConsentStorageWarning(persistence.accountPersisted
            ? "La autorización está guardada en tu cuenta, pero este navegador no permitió guardar una copia local. Puedes continuar."
            : "Este navegador no permitió guardar la autorización; estará vigente sólo durante esta sesión.");
        }
        void submit(pendingProviderInput, true);
      }}
      onCancel={() => {
        setShowProviderConsent(false);
        setLocalInterpreterOnly(true);
        setNotice("Continuamos con el intérprete local seguro; puedes habilitar el procesamiento con IA después desde Perfil → Privacidad / IA.");
        void submit(pendingProviderInput, false, true);
      }}
    />}
  </section>;
}
