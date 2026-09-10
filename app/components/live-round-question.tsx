"use client";

import { useState } from "react";

import { classifyLiveQuestion, liveQuestionFacts, type LiveQuestionExplanation } from "../../features/ai/live-questions";
import type { LiveScoreboard } from "../../features/live-rounds/domain";
import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";

export type LiveRoundQuestionProps = {
  playerId: string;
  scoreboard: LiveScoreboard;
  putts?: number;
  gameFacts: Record<string, string | number | boolean | null>;
  consentOwnerId?: string;
  accessToken?: string | null;
};

const SUGGESTIONS = ["¿Cómo voy?", "¿Quién va ganando?", "¿Cuántos putts llevo?", "¿Quién lleva Skins?"];

export function LiveRoundQuestion({ playerId, scoreboard, putts, gameFacts, consentOwnerId, accessToken }: LiveRoundQuestionProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    const kind = classifyLiveQuestion(trimmed);
    if (!kind) { setMessage("Pregunta por tu score, balance, putts o el estado de un juego activo."); return; }
    if (!consentOwnerId || !hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), consentOwnerId, AI_PROVIDER_PROCESSING_CONSENT)) {
      setMessage("Activa Procesamiento IA en Mi Cuenta para pedir una explicación."); return;
    }
    setQuestion(trimmed); setBusy(true); setMessage(""); setAnswer("");
    try {
      const result = await requestBackyardAi<LiveQuestionExplanation>("/api/backyard-ai/live-question", { question: trimmed, facts: liveQuestionFacts({ kind, playerId, scoreboard, ...(putts === undefined ? {} : { putts }), gameFacts }), consent: backyardAiProviderConsent(AI_PROVIDER_PROCESSING_CONSENT) }, 25_000, accessToken);
      setAnswer(result.answer);
    } catch {
      setMessage("No pude explicar el estado ahora. El tablero calculado por Backyard sigue disponible arriba.");
    } finally { setBusy(false); }
  }

  return <section className="card liveRoundQuestion" aria-labelledby="live-question-title">
    <div className="sectionTitle"><div><h2 id="live-question-title">Pregúntale a Backyard</h2><p>Responde usando el score y los juegos ya calculados. No modifica la ronda.</p></div><span className="statusPill">{scoreboard.status === "FINAL" ? "FINAL" : "PROVISIONAL"}</span></div>
    <div className="liveQuestionSuggestions" aria-label="Preguntas rápidas">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} className="chip" disabled={busy} onClick={() => void ask(suggestion)}>{suggestion}</button>)}</div>
    <div className="liveQuestionComposer"><label className="srOnly" htmlFor="live-round-question">Pregunta sobre la ronda</label><input id="live-round-question" value={question} maxLength={180} placeholder="¿Cómo voy?" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void ask(); } }} /><button type="button" className="secondary" disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? "Revisando…" : "Preguntar"}</button></div>
    {answer && <p className="liveQuestionAnswer" role="status">{answer}</p>}
    {message && <p className="muted" role="status">{message}</p>}
  </section>;
}
