"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  isCompleteBundleResolution,
  OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT,
  requestOptionalAuthorizationState,
  resolveOptionalAuthorizationBundle,
  type OptionalAuthorizationState,
} from "../../lib/account-optional-authorizations";
import { cacheAccountLearningConsent, ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT } from "../../lib/account-learning-consent-cache";
import { hydrateOptionalDevicePermissionPreferences } from "../../lib/account-device-permission-preferences";
import { LEGAL_EVIDENCE_DEFINITIONS } from "../../lib/legal-evidence";
import { STORAGE_KEYS } from "../../lib/round-utils";
import styles from "./account-consent-checkpoint.module.css";

type Decision = "pending" | "accepted" | "skipped";

/** Required documents and optional product functions are separate explicit
 * decisions. The optional bundle is committed by one server transaction; UI
 * success is shown only after the complete canonical snapshot is verified. */
export function InitialOnboardingConsents({
  userId,
  accessToken,
  legalRequired,
  canContinue,
  onAcceptRequired,
  onContinue,
  requiredOnly = false,
}: {
  userId: string;
  accessToken: string | null;
  legalRequired: boolean;
  canContinue: boolean;
  onAcceptRequired: () => Promise<void>;
  onContinue: () => void;
  requiredOnly?: boolean;
}) {
  const [remote, setRemote] = useState<OptionalAuthorizationState | null>(null);
  const [required, setRequired] = useState<Decision>(legalRequired ? "pending" : "accepted");
  const [optional, setOptional] = useState<Decision>("pending");
  const [busy, setBusy] = useState<"required" | "optional" | "continue" | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const authorizationRequestKey = useRef<string | null>(null);
  const declineRequestKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (requiredOnly) return () => controller.abort();
    if (!accessToken) {
      setError("No pudimos consultar las autorizaciones opcionales. Reintenta para decidir antes de continuar.");
      return () => controller.abort();
    }
    void requestOptionalAuthorizationState(accessToken, controller.signal).then((saved) => {
      if (controller.signal.aborted) return;
      setRemote(saved);
      setError("");
      if (saved.resolved && saved.receipt) {
        setOptional(saved.receipt.action === "authorize_all" ? "accepted" : "skipped");
      } else if (!saved.eligible) {
        // Accounts created before this version keep every prior explicit
        // choice. Absence is never rewritten into historical acceptance.
        setOptional("skipped");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("No pudimos consultar las autorizaciones opcionales. Reintenta para decidir antes de continuar.");
    });
    return () => controller.abort();
  }, [accessToken, retry, userId, requiredOnly]);

  const resolved = required === "accepted" && optional !== "pending";

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

  function mirrorAcceptedBundle(saved: OptionalAuthorizationState) {
    // These are runtime caches only. Canonical server success must never be
    // reported as failure merely because private browsing blocked storage.
    cacheAccountLearningConsent(localStorage, userId, saved);
    const devicePreferences = hydrateOptionalDevicePermissionPreferences(localStorage, userId, saved);
    const notificationsEnabled = devicePreferences.notificationPreference === "enabled";
    try { localStorage.setItem(STORAGE_KEYS.notifications, String(notificationsEnabled)); }
    catch { /* Best-effort mirror; the server receipt is authoritative. */ }
    try {
      window.dispatchEvent(new CustomEvent(ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT, { detail: { userId } }));
      window.dispatchEvent(new CustomEvent("backyard:account-notifications-hydrated", {
        detail: { userId, enabled: notificationsEnabled },
      }));
      window.dispatchEvent(new Event(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT));
    } catch { /* Best-effort mirror; the server receipt is authoritative. */ }
  }

  async function resolveOptional(accepted: boolean) {
    if (busy || !accessToken || !remote || required !== "accepted" || !canContinue) return;
    const key = accepted
      ? authorizationRequestKey.current ??= crypto.randomUUID()
      : declineRequestKey.current ??= crypto.randomUUID();
    setBusy("optional"); setError("");
    try {
      const action = accepted ? "authorize_all" as const : "decline_all" as const;
      const saved = await resolveOptionalAuthorizationBundle(accessToken, action, key, lifetime.current?.signal);
      if (!isCompleteBundleResolution(saved, action)) throw new Error("incomplete_optional_authorization");
      mirrorAcceptedBundle(saved);
      if (!lifetime.current?.signal.aborted) {
        setRemote(saved);
        setOptional(accepted ? "accepted" : "skipped");
        setBusy("continue");
        onContinue();
      }
    } catch {
      if (!lifetime.current?.signal.aborted) {
        // Another tab or an older checkpoint can record a narrower explicit
        // choice after this screen loaded. Re-read the canonical state so the
        // stale tab does not keep offering a bundle the server correctly
        // refuses to broaden. A true storage failure remains recoverable.
        try {
          const latest = await requestOptionalAuthorizationState(accessToken, lifetime.current?.signal);
          if (lifetime.current?.signal.aborted) return;
          setRemote(latest);
          if (latest.resolved && latest.receipt) {
            mirrorAcceptedBundle(latest);
            setOptional(latest.receipt.action === "authorize_all" ? "accepted" : "skipped");
            setBusy("continue");
            onContinue();
            return;
          }
          if (!latest.eligible) {
            mirrorAcceptedBundle(latest);
            setOptional("skipped");
            setError("Otra decisión explícita ya fue registrada. La conservamos sin ampliarla; puedes continuar y revisarla después en Configuración.");
            setBusy(null);
            return;
          }
        } catch { /* Keep the original recoverable error below. */ }
        if (!lifetime.current?.signal.aborted) {
          setError("No pudimos confirmar si el conjunto se guardó. Reintenta: usaremos la misma solicitud y no duplicaremos decisiones.");
          setBusy(null);
        }
      }
    }
  }

  return <section className={styles.embedded} aria-labelledby="initial-consent-title" aria-busy={Boolean(busy)}>
    <div><h2 id="initial-consent-title">Consentimientos de cuenta</h2><p>Los términos requeridos y las funciones opcionales se deciden por separado.</p></div>

    <section className={styles.decision} aria-labelledby="required-consents-title">
      <div><span className={styles.eyebrow}>REQUERIDOS</span><h3 id="required-consents-title">CONSENTIMIENTOS REQUERIDOS</h3></div>
      <p>Para crear tu cuenta debes aceptar los términos, confirmar la mayoría de edad y reconocer el alcance del Árbitro de Reglas. En competencia, el Comité o árbitro oficial tiene la decisión final.</p>
      <p className={styles.links}><Link href="/legal/terms?returnTo=onboarding">Términos y Condiciones</Link><Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad</Link></p>
      {required === "accepted" ? <p className={styles.resolved} role="status">✓ Consentimientos requeridos aceptados y registrados.</p> : <div className={styles.actions}>
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void acceptRequired()}>{busy === "required" ? "REGISTRANDO…" : "ACEPTAR REQUERIDOS"}</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => { setRequired("pending"); setError("Para crear una cuenta de The Backyard debes aceptar los consentimientos requeridos."); }}>NO ACEPTO</button>
      </div>}
    </section>

    {!requiredOnly && <section className={styles.decision} aria-labelledby="optional-consent-title">
      <div><span className={styles.eyebrow}>OPCIONAL</span><h3 id="optional-consent-title">FUNCIONES OPCIONALES DE THE BACKYARD</h3></div>
      <p>Al autorizar todo activas expresamente:</p>
      <ul>
        <li>Backyard AI para texto o dictado, fotos e imágenes y lectura de datos de práctica o launch monitor que decidas enviar.</li>
        <li>Memoria personal privada y learning global futuro con datos desidentificados y revisados.</li>
        <li>Actividad compartida con la audiencia y relaciones actuales de Social. Tu perfil nace público; puedes cambiarlo después en Configuración.</li>
        <li>Uso interno de ubicación y notificaciones; el permiso del dispositivo y la entrega se muestran y solicitan por separado.</li>
        <li>{LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements.accepted}</li>
        <li>{LEGAL_EVIDENCE_DEFINITIONS.marketing.statements.accepted}</li>
      </ul>
      <p className={styles.hint}>Apuestas, resultados y gastos, marketing y cada autorización de IA conservan evidencia separada. Puedes continuar sin autorizarlos.</p>
      {!remote && <div className={styles.actions}><button type="button" className="secondary" disabled={Boolean(busy) || !accessToken} onClick={() => { setError(""); setRetry((value) => value + 1); }}>REINTENTAR</button></div>}
      {remote && optional !== "pending" ? <><p className={styles.resolved} role="status">{optional === "accepted"
        ? isCompleteBundleResolution(remote, "authorize_all")
          ? "✓ Todas las funciones incluidas están autorizadas y registradas."
          : "✓ Autorización inicial registrada; conservamos tus cambios posteriores."
        : remote.eligible ? "Ahora no · las funciones opcionales permanecen desactivadas." : "Conservamos las decisiones previas de esta cuenta sin sobrescribirlas."}</p><div className={styles.actions}><button type="button" className="primary" disabled={!resolved || !canContinue || Boolean(busy)} onClick={() => { setBusy("continue"); onContinue(); }}>CONTINUAR</button></div></> : remote && <div className={styles.actions}>
        <button type="button" className="primary" disabled={Boolean(busy) || required !== "accepted" || !canContinue} onClick={() => void resolveOptional(true)}>{busy === "optional" ? "REGISTRANDO TODO…" : "AUTORIZAR TODO Y CONTINUAR"}</button>
        <button type="button" className="secondary" disabled={Boolean(busy) || required !== "accepted" || !canContinue} onClick={() => void resolveOptional(false)}>CONTINUAR SIN AUTORIZAR</button>
      </div>}
    </section>}

    {requiredOnly && <button type="button" className="primary" disabled={required !== "accepted" || !canContinue || Boolean(busy)} onClick={onContinue}>Continuar: permisos y privacidad</button>}
    {!canContinue && <p className={styles.hint}>Elige antes una configuración Rápida o Completa.</p>}
    <p className={styles.hint}>Después puedes revisar o revocar individualmente estas elecciones en Perfil → Configuración → Privacidad y permisos.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
