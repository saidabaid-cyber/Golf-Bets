"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readRemoteAiConsentDecisions, saveRemoteAiConsentDecisions, type RemoteAiConsentDecisions } from "../../lib/backyard-ai/consent-client";
import { AI_PROCESSING_CONSENT_SCOPES } from "../../lib/backyard-ai/privacy";
import styles from "./account-consent-checkpoint.module.css";

type Decision = "pending" | "accepted" | "skipped";

/** One visible decision per category; legal documents and AI scopes remain
 * individually versioned and persisted by their existing server ledgers. */
export function InitialOnboardingConsents({
  userId,
  accessToken,
  legalRequired,
  initialBettingDecision,
  canContinue,
  onAcceptRequired,
  onResolveBetting,
  onContinue,
}: {
  userId: string;
  accessToken: string | null;
  legalRequired: boolean;
  initialBettingDecision: Decision;
  canContinue: boolean;
  onAcceptRequired: () => Promise<void>;
  onResolveBetting: (accepted: boolean) => Promise<void>;
  onContinue: () => void;
}) {
  const [remote, setRemote] = useState<RemoteAiConsentDecisions | null>(null);
  const [required, setRequired] = useState<Decision>(legalRequired ? "pending" : "accepted");
  const [betting, setBetting] = useState<Decision>(initialBettingDecision);
  const [ai, setAi] = useState<Decision>("pending");
  const [busy, setBusy] = useState<"required" | "betting" | "ai" | "continue" | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (!accessToken) {
      setError("No pudimos consultar las autorizaciones de IA. Reintenta para decidir antes de continuar.");
      return () => controller.abort();
    }
    void readRemoteAiConsentDecisions(accessToken, controller.signal).then((saved) => {
      if (controller.signal.aborted) return;
      setRemote(saved);
      setError("");
      if (saved.resolved) {
        setAi(saved.decisions.every((decision) => decision.status === "accepted") ? "accepted" : "skipped");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("No pudimos consultar las autorizaciones de IA. Reintenta para decidir antes de continuar.");
    });
    return () => controller.abort();
  }, [accessToken, retry, userId]);

  useEffect(() => {
    if (initialBettingDecision !== "pending") setBetting(initialBettingDecision);
  }, [initialBettingDecision]);

  const resolved = required === "accepted" && betting !== "pending" && ai !== "pending";

  async function acceptRequired() {
    if (busy) return;
    setBusy("required"); setError("");
    try {
      await onAcceptRequired();
      if (!lifetime.current?.signal.aborted) setRequired("accepted");
    } catch {
      if (!lifetime.current?.signal.aborted) setError("No pudimos registrar los consentimientos requeridos. Reintenta antes de continuar.");
    } finally { if (!lifetime.current?.signal.aborted) setBusy(null); }
  }

  async function resolveBetting(accepted: boolean) {
    if (busy) return;
    setBusy("betting"); setError("");
    try {
      await onResolveBetting(accepted);
      if (!lifetime.current?.signal.aborted) setBetting(accepted ? "accepted" : "skipped");
    } catch {
      if (!lifetime.current?.signal.aborted) setError("No pudimos guardar tu decisión sobre apuestas. Reintenta antes de continuar.");
    } finally { if (!lifetime.current?.signal.aborted) setBusy(null); }
  }

  async function resolveAi(accepted: boolean) {
    if (busy || !accessToken || !remote) return;
    setBusy("ai"); setError("");
    try {
      const decisions = AI_PROCESSING_CONSENT_SCOPES.map((scope) => ({ scope, accepted }));
      const saved = await saveRemoteAiConsentDecisions(accessToken, userId, decisions, "onboarding", lifetime.current?.signal);
      if (!saved.resolved) throw new Error("unresolved_ai_consent");
      if (!lifetime.current?.signal.aborted) {
        setRemote(saved);
        setAi(accepted ? "accepted" : "skipped");
      }
    } catch {
      if (!lifetime.current?.signal.aborted) setError("No pudimos guardar tu decisión de Backyard AI. Reintenta antes de continuar.");
    } finally { if (!lifetime.current?.signal.aborted) setBusy(null); }
  }

  return <section className={styles.embedded} aria-labelledby="initial-consent-title" aria-busy={Boolean(busy)}>
    <div><h2 id="initial-consent-title">Consentimientos de cuenta</h2><p>Tres decisiones claras. Ninguna autorización opcional se acepta automáticamente.</p></div>

    <section className={styles.decision} aria-labelledby="required-consents-title">
      <div><span className={styles.eyebrow}>REQUERIDOS</span><h3 id="required-consents-title">CONSENTIMIENTOS REQUERIDOS</h3></div>
      <p>Para crear tu cuenta debes aceptar los términos, confirmar la mayoría de edad y reconocer el alcance del Árbitro de Reglas. En competencia, el Comité o árbitro oficial tiene la decisión final.</p>
      <p className={styles.links}><Link href="/legal/terms?returnTo=onboarding">Términos y Condiciones</Link><Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad</Link></p>
      {required === "accepted" ? <p className={styles.resolved} role="status">✓ Consentimientos requeridos aceptados y registrados.</p> : <div className={styles.actions}>
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void acceptRequired()}>{busy === "required" ? "REGISTRANDO…" : "ACEPTAR TODO Y CONTINUAR"}</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => { setRequired("pending"); setError("Para crear una cuenta de The Backyard debes aceptar los consentimientos requeridos."); }}>NO ACEPTO</button>
      </div>}
    </section>

    <section className={styles.decision} aria-labelledby="betting-consent-title">
      <div><span className={styles.eyebrow}>OPCIONAL</span><h3 id="betting-consent-title">FUNCIONES DE APUESTAS</h3></div>
      <p>Autoriza por separado el tratamiento de datos de apuestas, resultados y gastos. Puedes usar el resto de The Backyard sin activarlas.</p>
      {betting !== "pending" ? <p className={styles.resolved} role="status">{betting === "accepted" ? "✓ Apuestas activadas." : "Ahora no · puedes activarlas después."}</p> : <div className={styles.actions}>
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void resolveBetting(true)}>{busy === "betting" ? "GUARDANDO…" : "ACTIVAR APUESTAS"}</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void resolveBetting(false)}>AHORA NO</button>
      </div>}
    </section>

    <section className={styles.decision} aria-labelledby="ai-consent-title">
      <div><span className={styles.eyebrow}>OPCIONAL</span><h3 id="ai-consent-title">AUTORIZACIONES DE BACKYARD AI</h3></div>
      <p>Permite usar Backyard AI para procesar el texto o dictado, imágenes/scorecards y fotos de launch monitor que tú decidas enviar.</p>
      {!remote && <div className={styles.actions}><button type="button" className="secondary" disabled={Boolean(busy) || !accessToken} onClick={() => { setError(""); setRetry((value) => value + 1); }}>REINTENTAR</button></div>}
      {remote && ai !== "pending" ? <p className={styles.resolved} role="status">{ai === "accepted" ? "✓ Las tres funciones de IA están autorizadas." : "Ahora no · se pedirá autorización contextual al usar IA."}</p> : remote && <div className={styles.actions}>
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void resolveAi(true)}>{busy === "ai" ? "GUARDANDO…" : "AUTORIZAR LAS 3 FUNCIONES DE IA"}</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void resolveAi(false)}>AHORA NO</button>
      </div>}
    </section>

    <p className={styles.hint}>Después puedes revisar o revocar estas decisiones en Perfil → Configuración → Privacidad y permisos.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.continueBar}><button type="button" className="primary big" disabled={!resolved || !canContinue || Boolean(busy)} onClick={() => { setBusy("continue"); onContinue(); }}>CONTINUAR</button>{!canContinue && <small>Elige antes una configuración Rápida o Completa.</small>}</div>
  </section>;
}
