"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readRemoteAiConsentDecisions, saveRemoteAiConsentDecisions, type RemoteAiConsentDecisions } from "../../lib/backyard-ai/consent-client";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT, AI_LAUNCH_MONITOR_PROCESSING_CONSENT, type BackyardAiProcessingConsentScope } from "../../lib/backyard-ai/privacy";
import styles from "./account-consent-checkpoint.module.css";

const PURPOSES = [
  { scope: AI_PROVIDER_PROCESSING_CONSENT, label: "Autorizo el procesamiento del texto o dictado que yo decida enviar a Backyard AI para configurar o asistir mis rondas." },
  { scope: AI_IMAGE_PROCESSING_CONSENT, label: "Autorizo el procesamiento de las fotografías de scorecards que yo decida enviar para su lectura." },
  { scope: AI_LAUNCH_MONITOR_PROCESSING_CONSENT, label: "Autorizo el procesamiento de las fotografías de pantallas de launch monitor que yo decida enviar para leer mis datos de práctica." },
] as const;

/** Initial-account consent uses the existing server-backed consent APIs but
 * lives inside the first onboarding step. It is not a second entry gate. */
export function InitialOnboardingConsents({ userId, accessToken, legalRequired, onAcceptLegal, onReadyChange }: {
  userId: string;
  accessToken: string | null;
  legalRequired: boolean;
  onAcceptLegal: (betting: boolean) => Promise<void>;
  onReadyChange: (ready: boolean) => void;
}) {
  const [remote, setRemote] = useState<RemoteAiConsentDecisions | null>(null);
  const [choices, setChoices] = useState<Partial<Record<BackyardAiProcessingConsentScope, boolean>>>({});
  const [terms, setTerms] = useState(false);
  const [rules, setRules] = useState(false);
  const [adult, setAdult] = useState(false);
  const [betting, setBetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    onReadyChange(false);
    return () => controller.abort();
  }, [userId, onReadyChange]);

  useEffect(() => {
    const controller = new AbortController();
    if (!accessToken) {
      setAiUnavailable(true);
      setError("Tus preferencias de IA no pudieron cargarse. Puedes revisarlas después en Configuración; ninguna función de IA queda autorizada.");
      return () => controller.abort();
    }
    void readRemoteAiConsentDecisions(accessToken, controller.signal).then((saved) => {
      if (controller.signal.aborted) return;
      setRemote(saved);
      setAiUnavailable(false);
      setError("");
      if (saved.resolved && !legalRequired) {
        setReady(true);
        onReadyChange(true);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setAiUnavailable(true);
        setError("Tus preferencias de IA no pudieron cargarse. Puedes continuar y revisarlas después en Configuración; ninguna función de IA queda autorizada.");
      }
    });
    return () => controller.abort();
  }, [accessToken, legalRequired, onReadyChange, retry]);

  const missing = remote?.decisions.filter((decision) => decision.status === "missing") || [];
  const requiredAccepted = !legalRequired || (terms && rules && adult);
  const canSubmit = Boolean(remote && accessToken && requiredAccepted);

  function markReady() {
    if (lifetime.current?.signal.aborted) return;
    setReady(true);
    onReadyChange(true);
  }

  function selectAllAvailable() {
    if (legalRequired) {
      setTerms(true);
      setRules(true);
      setAdult(true);
      setBetting(true);
    }
    setChoices((current) => ({ ...current, ...Object.fromEntries(missing.map(({ scope }) => [scope, true])) }));
  }

  async function continueWithoutAi() {
    if (submitting.current || !requiredAccepted) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (legalRequired) await onAcceptLegal(betting);
      markReady();
    } catch {
      if (!lifetime.current?.signal.aborted) setError("No pudimos guardar la aceptación de los términos. Reintenta; tus autorizaciones de IA no se han cambiado.");
    } finally {
      submitting.current = false;
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }

  async function submit() {
    if (!canSubmit || submitting.current || !accessToken) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let aiSaved = false;
    try {
      const saved = missing.length
        ? await saveRemoteAiConsentDecisions(accessToken, userId, missing.map(({ scope }) => ({ scope, accepted: choices[scope] === true })), "onboarding", lifetime.current?.signal)
        : remote;
      if (lifetime.current?.signal.aborted) return;
      if (!saved?.resolved) throw new Error("Unresolved consent decisions");
      aiSaved = true;
      setRemote(saved);
      if (legalRequired) await onAcceptLegal(betting);
      markReady();
    } catch {
      if (!lifetime.current?.signal.aborted) {
        if (!aiSaved) setAiUnavailable(true);
        setError(aiSaved
          ? "No pudimos guardar la aceptación de los términos. Reintenta; tus preferencias de IA ya están guardadas."
          : "No pudimos guardar tus preferencias de IA. Puedes continuar sin IA y revisarlas después en Configuración.");
      }
    } finally {
      submitting.current = false;
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }

  if (ready) return <section className={styles.saved} role="status"><b>Autorizaciones guardadas</b><span>Puedes continuar con tu configuración.</span></section>;

  return <section className={styles.embedded} aria-labelledby="initial-consent-title" aria-busy={busy}>
    <div><h2 id="initial-consent-title">Autorizaciones iniciales</h2><p>Revisa lo necesario para tu cuenta y decide qué funciones opcionales deseas habilitar.</p></div>
    {!remote && !error && <p role="status">Consultando tus preferencias…</p>}
    {(remote || legalRequired) && <fieldset className={styles.checks} disabled={busy}>
      <legend className={styles.legend}>Tus autorizaciones</legend>
      <button type="button" className={styles.selectAll} onClick={selectAllAvailable}>Seleccionar todo</button>
      {legalRequired && <>
        <label className={styles.check}><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /><span>Acepto los <Link href="/legal/terms?returnTo=onboarding">Términos y Condiciones</Link> y confirmo haber leído el <Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad</Link>.</span></label>
        <label className={styles.check}><input type="checkbox" checked={rules} onChange={(event) => setRules(event.target.checked)} /><span>Entiendo que el Árbitro de Reglas es una referencia acordada entre participantes; en competencias prevalece el Comité o árbitro oficial.</span></label>
        <label className={styles.check}><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} /><span>Confirmo que tengo 18 años o más.</span></label>
        <label className={styles.check}><input type="checkbox" checked={betting} onChange={(event) => setBetting(event.target.checked)} /><span>Consiento el tratamiento de datos de apuestas, resultados y gastos conforme al Aviso de Privacidad. <small>Opcional para las demás funciones.</small></span></label>
      </>}
      {PURPOSES.filter(({ scope }) => missing.some((decision) => decision.scope === scope)).map(({ scope, label }) => <label className={styles.check} key={scope}>
        <input type="checkbox" checked={choices[scope] === true} onChange={(event) => setChoices((current) => ({ ...current, [scope]: event.target.checked }))} />
        <span>{label}<small>Opcional. Sin autorización, esta función de IA permanece desactivada.</small></span>
      </label>)}
    </fieldset>}
    <p className={styles.hint}>Después puedes cambiar estas decisiones en Perfil → Configuración → Privacidad y permisos.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {aiUnavailable && <button type="button" className="secondary" disabled={busy || !requiredAccepted} onClick={() => void continueWithoutAi()}>{busy ? "Guardando…" : "Continuar sin IA"}</button>}
    {(!remote || aiUnavailable) && <button type="button" className="textButton" disabled={busy || !accessToken} onClick={() => { setError(""); setAiUnavailable(false); setRetry((value) => value + 1); }}>Reintentar consulta</button>}
    {remote && !aiUnavailable && <button type="button" className="secondary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Guardar autorizaciones"}</button>}
  </section>;
}
