"use client";

import { useEffect, useRef, useState } from "react";

import { requestBackyardAi } from "../../../lib/backyard-ai/client-api";
import { backyardAiProviderConsent } from "../../../lib/backyard-ai/privacy";
import { readGroupPreferences } from "../../../lib/backyard-ai/memory/group-memory";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, readLearningConsent, writeLearningConsent } from "../../../lib/backyard-ai/memory/learning-events";
import { readUserPreferences } from "../../../lib/backyard-ai/memory/personal-memory";
import { parseUnknownPlayerClarification } from "../../../lib/backyard-ai/runtime/clarification";
import { validateCanonicalRoundCommand } from "../../../lib/backyard-ai/runtime/canonical-command-guard";
import type { RoundSetupMemoryContext } from "../../../lib/backyard-ai/runtime/context-resolver";
import { roundSetupAnswerCommand } from "../../../lib/backyard-ai/runtime/answer-command";
import { planRoundSetup, type RoundSetupPlan } from "../../../lib/backyard-ai/runtime/round-setup";
import type { RoundSetupDraft } from "../../../lib/backyard-ai/schemas/round-setup";
import { createDictationSession, DICTATION_FALLBACK, speechRecognitionConstructor } from "../../../lib/speech-dictation";
import type { FrequentPlayer } from "../../../lib/types";
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
  onConfirm: (draft: RoundSetupDraft, plan: RoundSetupPlan) => void;
  onManualEdit: (draft: RoundSetupDraft) => void;
  onCancel: () => void;
  bettingConsentGranted: boolean;
  onRequireBettingConsent: (resume: () => void) => void;
  onPlanned?: (event: AiRoundSetupTelemetry) => void;
};

const EXAMPLES = [
  "Jugamos Said, Pedro, Juan y Carlos. Skins de 100 y Nassau de 500.",
  "Los mismos del domingo pero skins a 200.",
  "Bola Amiga Said/Juan contra Pedro/Carlos.",
  "Todos juegan Skins menos Carlos.",
];

const MIN_MODEL_CONFIRMATION_CONFIDENCE = 0.7;

export function AiRoundSetup({ initialDraft, memoryContext, onConfirm, onManualEdit, onCancel, bettingConsentGranted, onRequireBettingConsent, onPlanned }: AiRoundSetupProps) {
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [plan, setPlan] = useState<RoundSetupPlan | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [lastCommand, setLastCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [dictationStatus, setDictationStatus] = useState("");
  const [dictationSupported, setDictationSupported] = useState(false);
  const [providerConsent, setProviderConsent] = useState(false);
  const [personalMemoryEnabled, setPersonalMemoryEnabled] = useState(() => {
    const ownerId = memoryContext.profile?.userId;
    return Boolean(ownerId && typeof window !== "undefined" && readLearningConsent(window.localStorage, ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent.personalMemoryEnabled);
  });
  const [sessionPlayers, setSessionPlayers] = useState<FrequentPlayer[]>([]);
  const recognitionRef = useRef<ReturnType<typeof createDictationSession> | null>(null);
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

  function changeInput(next: string) {
    setInput(next);
    setProviderConsent(false);
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

  async function submit(consentAlreadyGranted = false) {
    const raw = input.trim();
    if (raw.length < 2 || busy) return;
    if (!consentAlreadyGranted && !bettingConsentGranted) {
      onRequireBettingConsent(() => { void submit(true); });
      return;
    }
    const allowProvider = providerConsent;
    setProviderConsent(false);
    recognitionRef.current?.dispose();
    recognitionRef.current = null;
    setListening(false);
    const focusedQuestion = plan?.questions[0];
    const clarifiedPlayer = parseUnknownPlayerClarification(focusedQuestion, raw);
    if (focusedQuestion?.code === "unknown_player" && !clarifiedPlayer) {
      setNotice("Escribe el handicap entre +15 y 54. Ejemplo: “Carlos HCP 18”.");
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
        const response = await requestBackyardAi<RoundSetupAiResponse>("/api/backyard-ai/round-setup", { input: command, consent: backyardAiProviderConsent() });
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
      } finally {
        if (mounted.current && generation === submissionGeneration.current) setProviderConsent(false);
      }
    } else if (!clarifiedPlayer) {
      setNotice("Interpretación local activa: esta instrucción no se envió al proveedor de IA.");
    }
    const nextSessionPlayers = clarifiedPlayer ? [...sessionPlayers, {
      id: `ai-session-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      name: clarifiedPlayer.name,
      handicap: clarifiedPlayer.handicap,
      uses: 0,
      updatedAt: new Date().toISOString(),
    }] : sessionPlayers;
    const ownerId = memoryContext.profile?.userId;
    const consent = ownerId ? readLearningConsent(localStorage, ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent : null;
    const personalMemoryEnabled = Boolean(ownerId && consent?.personalMemoryEnabled);
    const userPreferences = personalMemoryEnabled
      ? readUserPreferences(localStorage, ownerId!).document.items
      : [];
    const groupPreferences = personalMemoryEnabled
      ? readGroupPreferences(localStorage, ownerId!).document.items
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
    setConfidence(modelConfidence ?? planned.interpretation.confidence);
    setLastCommand(canonicalCommand);
    if (clarifiedPlayer) setSessionPlayers(nextSessionPlayers);
    setInput("");
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
    const current = readLearningConsent(localStorage, ownerId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
    const now = new Date().toISOString();
    const previousGrantedAt = current.grantedAt;
    const base = { ...current };
    delete base.grantedAt;
    delete base.revokedAt;
    const next = enabled
      ? { ...base, personalMemoryEnabled: true, updatedAt: now, grantedAt: previousGrantedAt ?? now }
      : { ...base, personalMemoryEnabled: false, updatedAt: now, revokedAt: now };
    const result = writeLearningConsent(localStorage, next);
    if (!result.ok) { setNotice("No pude guardar la preferencia de memoria en este dispositivo."); return; }
    setPersonalMemoryEnabled(enabled);
  }

  const question = plan?.questions[0];
  const showComposer = !plan || editing || Boolean(question);
  return <section className={styles.screen} aria-labelledby="backyard-ai-setup-title">
    <section className={styles.hero}>
      <span className="eyebrow">BACKYARD AI · MÉXICO</span>
      <h1 id="backyard-ai-setup-title">Dime cómo juegan.</h1>
      <p>Habla o escribe como lo dirías en el grupo. Backyard recupera lo que ya conoce, prepara una ronda real y te deja confirmar antes de empezar.</p>
    </section>

    {question && <section className={styles.question}><b>Una sola pregunta</b><span role="status">{question.prompt}</span>{question.candidates?.length ? <div className={styles.suggestions}>{question.candidates.map((candidate) => <button type="button" key={candidate.id} disabled={busy} onClick={() => changeInput(candidate.label)}>{candidate.label}</button>)}</div> : null}</section>}

    {showComposer && <section className={styles.composer}>
      <textarea autoFocus aria-label="Describe la ronda" placeholder={question ? "Responde sólo este dato…" : "Ej. Hoy jugamos Said, Pedro, Juan y Carlos en La Vista. Skins de $200 y Nassau de $500…"} value={input} maxLength={2_400} disabled={busy} onChange={(event) => changeInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit(); }} />
      {!plan && <div className={styles.suggestions}>{EXAMPLES.map((example) => <button type="button" key={example} disabled={busy} onClick={() => changeInput(example)}>{example}</button>)}</div>}
      <div className={styles.composerActions}>
        <button type="button" className="primary big" disabled={busy || input.trim().length < 2} onClick={() => void submit()}>{busy ? "Entendiendo…" : question ? "Confirmar respuesta" : editing ? "Aplicar cambio" : "Preparar mi ronda"}</button>
        <button type="button" className={styles.voiceButton} data-listening={listening} disabled={busy || (!dictationSupported && Boolean(dictationStatus))} onClick={toggleDictation}>{listening ? "■ Detener" : "🎙 Hablar"}</button>
      </div>
      <label className={styles.consent}><input type="checkbox" checked={providerConsent} disabled={busy} onChange={(event) => setProviderConsent(event.target.checked)} /><span>Autorizo enviar esta instrucción a OpenAI, incluidos los nombres, campo, modalidades y montos que yo escriba, únicamente para interpretarla.</span></label>
      <label className={styles.consent}><input type="checkbox" checked={personalMemoryEnabled} disabled={busy} onChange={(event) => changePersonalMemory(event.target.checked)} /><span>Recordar en mi espacio privado las preferencias que confirme para facilitar rondas futuras. Esto no habilita training global.</span></label>
      {dictationStatus && <p className={styles.contextNote} role="status">{dictationStatus}</p>}
      {notice && <p className={styles.contextNote} role="status">{notice}</p>}
      <p className={styles.privacyNote}>Sin esta autorización se usa el intérprete local. Nunca se envían tu histórico ni tus memorias personales; esos datos se resuelven en el dispositivo.</p>
    </section>}

    {plan && <>
      {plan.memory.length > 0 && <p className={styles.contextNote}>Usé contexto existente: {plan.memory.map((item) => item.label).join(" · ")}.</p>}
      <AiRoundReview draft={draft} confidence={confidence} issues={plan.configurationIssues} canConfirm={plan.canConfirm} busy={busy} onConfirm={() => onConfirm(draft, plan)} onConversationalChange={() => { setEditing(true); changeInput(""); }} onManualEdit={() => onManualEdit(draft)} />
    </>}

    {!plan && <button type="button" className="secondary" disabled={busy} onClick={() => onManualEdit(draft)}>Configurar manualmente</button>}
    <button type="button" className="textButton" onClick={cancel}>Cancelar</button>
  </section>;
}
