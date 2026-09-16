"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readRemoteAiConsentDecisions, saveRemoteAiConsentDecisions, type RemoteAiConsentDecisions } from "../../lib/backyard-ai/consent-client";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT, AI_LAUNCH_MONITOR_PROCESSING_CONSENT, type BackyardAiProcessingConsentScope } from "../../lib/backyard-ai/privacy";
import { BrandLockup } from "./brand-lockup";
import styles from "./account-consent-checkpoint.module.css";

const PURPOSES = [
  { scope: AI_PROVIDER_PROCESSING_CONSENT, label: "Autorizo el procesamiento del texto o dictado que yo decida enviar a Backyard AI para configurar o asistir mis rondas." },
  { scope: AI_IMAGE_PROCESSING_CONSENT, label: "Autorizo el procesamiento de las fotografías de scorecards que yo decida enviar para su lectura." },
  { scope: AI_LAUNCH_MONITOR_PROCESSING_CONSENT, label: "Autorizo el procesamiento de las fotografías de pantallas de launch monitor que yo decida enviar para leer mis datos de práctica." },
] as const;

/** A server-backed checkpoint, not a local first-use flag. Mount keyed by account. */
export function AccountConsentCheckpoint({ userId, accessToken, legalRequired, onAcceptLegal, onBack, children }: {
  userId: string;
  accessToken: string | null;
  legalRequired: boolean;
  onAcceptLegal: (betting: boolean) => Promise<void>;
  onBack: () => Promise<void>;
  children: ReactNode;
}) {
  const [source] = useState<"onboarding" | "account_update">(() => legalRequired ? "onboarding" : "account_update");
  const [remote, setRemote] = useState<RemoteAiConsentDecisions | null>(null);
  const [choices, setChoices] = useState<Partial<Record<BackyardAiProcessingConsentScope, boolean>>>({});
  const [terms, setTerms] = useState(false);
  const [rules, setRules] = useState(false);
  const [adult, setAdult] = useState(false);
  const [betting, setBetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  const decisionRevision = useRef(0);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const revision = decisionRevision.current;
    if (!accessToken) return () => controller.abort();
    void readRemoteAiConsentDecisions(accessToken, controller.signal).then((saved) => {
      if (controller.signal.aborted || revision !== decisionRevision.current) return;
      setRemote(saved);
      setError("");
    }).catch(() => {
      if (!controller.signal.aborted && revision === decisionRevision.current) setError("No pudimos consultar tus preferencias. Revisa tu conexión y vuelve a intentar. No se autorizó ningún envío a IA.");
    });
    return () => controller.abort();
  }, [accessToken, retry]);

  const missing = remote?.decisions.filter((decision) => decision.status === "missing") || [];
  const canSubmit = Boolean(remote && accessToken && (!legalRequired || (terms && rules && adult)));

  async function submit() {
    if (!canSubmit || submitting.current || !accessToken) return;
    submitting.current = true;
    decisionRevision.current += 1;
    setBusy(true);
    setError("");
    try {
      const saved = missing.length
        ? await saveRemoteAiConsentDecisions(accessToken, userId, missing.map(({ scope }) => ({ scope, accepted: choices[scope] === true })), source, lifetime.current?.signal)
        : remote;
      if (lifetime.current?.signal.aborted) return;
      if (!saved?.resolved) throw new Error("Unresolved consent decisions");
      if (legalRequired) await onAcceptLegal(betting);
      if (lifetime.current?.signal.aborted) return;
      setRemote(saved);
    } catch {
      if (!lifetime.current?.signal.aborted) setError("No pudimos guardar todas tus preferencias en tu cuenta. Tus selecciones siguen aquí; vuelve a intentar. No continuaremos hasta confirmar el guardado.");
    } finally {
      submitting.current = false;
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }

  if (remote?.resolved && !legalRequired) return children;

  return <main className={styles.screen}><section className={styles.card} aria-labelledby="account-consent-title" aria-busy={busy}>
    <BrandLockup compact />
    <h1 id="account-consent-title">{source === "onboarding" ? "ANTES DE EMPEZAR" : "ACTUALIZAMOS TUS PREFERENCIAS"}</h1>
    <p>{source === "onboarding" ? "Revisa estas autorizaciones para terminar de crear tu cuenta." : "Elige las autorizaciones que faltan en tu cuenta. No asumimos tu consentimiento."}</p>
    {!remote && !error && <p role="status">Consultando tus preferencias…</p>}
    {!accessToken && <p role="alert">Necesitas conexión y una sesión vigente para guardar tus preferencias.</p>}
    {remote && <fieldset className={styles.checks} disabled={busy}>
      <legend className={styles.legend}>Tus autorizaciones</legend>
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
    <p className={styles.hint}>Puedes cambiar tus autorizaciones en Perfil → Cuenta y privacidad → Privacidad / IA.</p>
    <details className={styles.legal}><summary>Sobre estas autorizaciones</summary><p>LEGAL_REVIEW_REQUIRED: texto jurídico definitivo y clasificación de autorizaciones obligatorias u opcionales pendientes de revisión. Por ahora, las autorizaciones de IA son opcionales y no están premarcadas.</p></details>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!remote && <button type="button" className="secondary" disabled={busy || !accessToken} onClick={() => { setError(""); setRetry((value) => value + 1); }}>Reintentar consulta</button>}
    {remote && <button type="button" className="primary big" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "Guardando…" : source === "onboarding" ? "CREAR CUENTA Y CONTINUAR" : "GUARDAR Y CONTINUAR"}</button>}
    <button type="button" className="textButton" disabled={busy} onClick={() => void onBack()}>Volver al acceso</button>
  </section></main>;
}
