"use client";
import { useEffect, useRef, useState } from "react";
import { EMPTY_PRIVACY_CHOICES, PRIVACY_GROUPS, readOnboardingPrivacy, saveOnboardingPrivacy, type PrivacyChoices } from "../../lib/onboarding-privacy";
import { OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT } from "../../lib/account-optional-authorizations";
import styles from "./account-consent-checkpoint.module.css";
import { hydrateOptionalDevicePermissionPreferences } from "../../lib/account-device-permission-preferences";
import { InitialDevicePermissions } from "./device-permission-settings";

export function OnboardingPrivacyChoices({ userId, accessToken, onContinue, resolveDevicePermissions = false }: { userId: string; accessToken: string | null; onContinue: () => void; resolveDevicePermissions?: boolean }) {
  const [choices, setChoices] = useState<PrivacyChoices>({ ...EMPTY_PRIVACY_CHOICES });
  const [loaded, setLoaded] = useState(false);
  const [previousAuthorization, setPreviousAuthorization] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [deviceChoices, setDeviceChoices] = useState<{ location: boolean; notifications: boolean } | null>(null);
  const keys = useRef(new Map<string, string>());
  const inflight = useRef(false);
  const edited = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    if (accessToken) void readOnboardingPrivacy(accessToken, controller.signal).then(result => {
      if (!controller.signal.aborted) { if (!edited.current) setChoices(result.choices); setPreviousAuthorization(result.state.receipt?.action === "authorize_all"); setLoaded(true); setBusy(false); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("No pudimos consultar tus permisos. Reintenta antes de continuar."); });
    return () => controller.abort();
  }, [userId, accessToken, retry]);
  async function save() {
    if (inflight.current || !accessToken || !loaded) return;
    const controller = lifetime.current;
    inflight.current = true; setBusy(true); setError("");
    try {
      const saved = await saveOnboardingPrivacy(accessToken, userId, { ...choices }, keys.current, controller?.signal);
      if (!controller?.signal.aborted) {
        hydrateOptionalDevicePermissionPreferences(localStorage, userId, saved);
        window.dispatchEvent(new Event(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT));
        if (resolveDevicePermissions) setDeviceChoices({ location: choices.location, notifications: choices.notifications && choices.push });
        else onContinue();
      }
    } catch { if (!controller?.signal.aborted) setError("No se confirmaron todas tus decisiones. Conservamos la selección; reintenta para continuar."); }
    finally { inflight.current = false; if (!controller?.signal.aborted) setBusy(false); }
  }
  if (deviceChoices) return <section className={styles.embedded}><InitialDevicePermissions userId={userId} accessToken={accessToken} onboardingChoices={deviceChoices} onContinue={onContinue} /></section>;
  if (!loaded) return <section className={styles.embedded} aria-busy={!error}><p role="status">Consultando tus autorizaciones guardadas…</p>{error && <><p role="alert" className={styles.error}>{error}</p><button type="button" className="secondary" onClick={() => { setError(""); setRetry(value => value + 1); }}>Reintentar</button></>}</section>;
  return <section className={styles.embedded} aria-busy={busy}>
    <p>{previousAuthorization ? "Todo es opcional. Ya autorizaste estas funciones. Si no quieres alguna, desmárcala antes de continuar. Puedes cambiar tus decisiones después en Configuración." : "Todo es opcional. Marca sólo lo que autorizas. Puedes cambiar tus decisiones después en Configuración."}</p>
    {PRIVACY_GROUPS.map(group => <details className={styles.decision} key={group.title}><summary>{group.title}<small> · {group.choices.filter(([key]) => choices[key]).length} seleccionadas</small></summary><fieldset className={styles.privacyFields} disabled={busy}><legend className="sr-only">{group.title}</legend>{group.choices.map(([key, label, description]) => <label className={styles.privacyChoice} key={key}><input type="checkbox" checked={choices[key]} onChange={event => { edited.current = true; const checked = event.target.checked; setChoices(current => ({ ...current, [key]: checked, ...(key === "sharing" ? { shareRounds: checked, shareAchievements: checked, shareEquipment: checked, shareCourses: checked } : {}) })); }} /><span><b>{label}</b><small>{description}</small></span></label>)}</fieldset></details>)}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.continueBar}><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Guardando decisiones…" : "GUARDAR Y CONTINUAR"}</button><small>Después puedes revisarlas o revocarlas en Configuración.</small></div>
  </section>;
}
