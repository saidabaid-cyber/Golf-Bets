"use client";

import { useEffect, useRef, useState } from "react";

import { classifyLiveQuestion, liveQuestionFacts, type LiveQuestionExplanation } from "../../features/ai/live-questions";
import type { LiveScoreboard } from "../../features/live-rounds/domain";
import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";

export type LiveRoundQuestionProps = {
  playerId: string;
  scoreboard: LiveScoreboard;
  putts?: number;
  gameFacts: Record<string, string | number | boolean | null>;
  consentOwnerId?: string;
  accessToken?: string | null;
  requiresRemoteConsent?: boolean;
};

const SUGGESTIONS = ["¿Cómo voy?", "¿Quién va ganando?", "¿Cuántos putts llevo?", "¿Quién lleva Skins?"];

export function LiveRoundQuestion({ playerId, scoreboard, putts, gameFacts, consentOwnerId, accessToken, requiresRemoteConsent = false }: LiveRoundQuestionProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function ask(nextQuestion = question) {
    if (inFlight.current) return;
    const trimmed = nextQuestion.trim();
    const kind = classifyLiveQuestion(trimmed);
    if (!kind) { setMessage("Pregunta por tu score, balance, putts o el estado de un juego activo."); return; }
    if (!consentOwnerId) { setMessage("Revisa tu autorización en Perfil → Cuenta y privacidad → Privacidad / IA."); return; }
    inFlight.current = true;
    setQuestion(trimmed); setBusy(true); setMessage(""); setAnswer("");
    try {
      const authority = accessToken ? await resolveAuthoritativeAiProcessingConsent({
        accessToken, userId: consentOwnerId, scope: AI_PROVIDER_PROCESSING_CONSENT, storage: browserAiProcessingConsentStorage(),
      }) : null;
      if (!mounted.current) return;
      const allowed = authority
        ? !authority.discarded && authority.active && !authority.pendingLocalRevocation
        : !requiresRemoteConsent && hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), consentOwnerId, AI_PROVIDER_PROCESSING_CONSENT);
      if (!allowed) { setMessage("Instrucciones Backyard AI está desactivado. Puedes autorizarlo en Perfil → Cuenta y privacidad → Privacidad / IA."); return; }
      const result = await requestBackyardAi<LiveQuestionExplanation>("/api/backyard-ai/live-question", { question: trimmed, facts: liveQuestionFacts({ kind, playerId, scoreboard, ...(putts === undefined ? {} : { putts }), gameFacts }), consent: backyardAiProviderConsent(AI_PROVIDER_PROCESSING_CONSENT) }, 25_000, accessToken);
      if (mounted.current) setAnswer(result.answer);
    } catch {
      if (mounted.current) setMessage("No pude verificar la autorización o explicar el estado ahora. El tablero calculado por Backyard sigue disponible arriba.");
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="card liveRoundQuestion" aria-labelledby="live-question-title">
    <div className="sectionTitle"><div><h2 id="live-question-title">Pregúntale a Backyard</h2><p>Responde usando el score y los juegos ya calculados. No modifica la ronda.</p></div><span className="statusPill">{scoreboard.status === "FINAL" ? "FINAL" : "PROVISIONAL"}</span></div>
    <div className="liveQuestionSuggestions" aria-label="Preguntas rápidas">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} className="chip" disabled={busy} onClick={() => void ask(suggestion)}>{suggestion}</button>)}</div>
    <div className="liveQuestionComposer"><label className="srOnly" htmlFor="live-round-question">Pregunta sobre la ronda</label><input id="live-round-question" value={question} maxLength={180} placeholder="¿Cómo voy?" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void ask(); } }} /><button type="button" className="secondary" disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? "Revisando…" : "Preguntar"}</button></div>
    {answer && <p className="liveQuestionAnswer" role="status">{answer}</p>}
    {message && <p className="muted" role="status">{message}</p>}
  </section>;
}
