"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheAccountDevicePermissionPreferences,
  failClosedAccountDevicePermissionPreferences,
  readAccountDevicePermissionPreferences,
  requestAccountDevicePermissionPreferences,
  saveAccountDevicePermissionPreference,
  type AccountPermissionValue,
  type AccountPermissionPreferenceKind,
} from "../../lib/account-device-permission-preferences";
import {
  devicePermissionContext,
  devicePermissionReviewStatus,
  emptyDevicePermissionPreferences,
  finishInitialDevicePermissions,
  readDevicePermissionPreferences,
  refreshDevicePermissionStateWithoutPrompt,
  requestInitialLocation,
  requestInitialNotifications,
  type DevicePermissionPreferences,
  type NotificationPermissionApi,
} from "../../lib/device-permissions";
import { OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT } from "../../lib/account-optional-authorizations";
import { pendingOnboardingDevicePermissions } from "../../lib/onboarding-privacy";

function locationStatusLabel(status: DevicePermissionPreferences["location"]) {
  if (status === "granted") return "Permitido en este dispositivo";
  if (status === "denied") return "Bloqueado en este dispositivo";
  if (status === "prompt") return "Todavía no decidido";
  if (status === "timeout") return "La última consulta agotó el tiempo";
  if (status === "unavailable") return "No podemos consultar este permiso";
  return "Sin configurar";
}

function notificationStatusLabel(value: DevicePermissionPreferences, available: boolean | null) {
  if (value.notifications === "granted" && value.notificationPreference === "enabled") return "✓ Notificaciones activadas";
  if (value.notifications === "granted") return "Permitido en este dispositivo · uso interno pendiente";
  if (value.notifications === "denied") return "Notificaciones no activadas";
  if (value.notificationPreference === "enabled" && available === false) return "Pendientes en este dispositivo";
  return available === null ? "Preparando…" : "Opcionales";
}

function currentNotificationApi(): NotificationPermissionApi | undefined {
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function" || !window.isSecureContext) return undefined;
  const context = devicePermissionContext({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standaloneDisplayMode: window.matchMedia?.("(display-mode: standalone)").matches,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    notificationApi: true,
  });
  return context.notificationApi ? Notification : undefined;
}

function usePersistentDevicePermissions(userId: string, accessToken: string | null) {
  const [value, setValue] = useState(() => typeof window === "undefined"
    ? emptyDevicePermissionPreferences(userId)
    : accessToken
      ? readAccountDevicePermissionPreferences(localStorage, userId)
      : readDevicePermissionPreferences(localStorage, userId));
  const [notificationAvailable, setNotificationAvailable] = useState<boolean | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [ready, setReady] = useState(false);
  const refreshController = useRef<AbortController | null>(null);
  const refreshRevision = useRef(0);

  const synchronize = useCallback(() => {
    const revision = ++refreshRevision.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const api = currentNotificationApi();
    setNotificationAvailable(Boolean(api));
    const device = refreshDevicePermissionStateWithoutPrompt(localStorage, userId, navigator, api ?? null, {
      shouldCommit: () => !controller.signal.aborted && revision === refreshRevision.current,
    });
    const account = accessToken
      ? requestAccountDevicePermissionPreferences(accessToken, controller.signal)
      : Promise.resolve(null);
    void Promise.all([device, account]).then(([, remote]) => {
      if (controller.signal.aborted || revision !== refreshRevision.current) return;
      if (!remote) {
        setValue(readDevicePermissionPreferences(localStorage, userId));
        setReady(true);
        return;
      }
      // Re-read after both async sources settle. A newer explicit tap may have
      // updated local storage while an older OS/cloud read was in flight.
      const saved = cacheAccountDevicePermissionPreferences(localStorage, userId, remote);
      setValue(saved);
      setSyncMessage("");
      setReady(true);
    }).catch(() => {
      if (controller.signal.aborted || revision !== refreshRevision.current) return;
      // Authenticated legacy caches are not consent evidence. On an outage,
      // retain only values backed by a previous canonical response clock.
      const saved = accessToken
        ? failClosedAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      setValue(saved);
      setReady(true);
      setSyncMessage("No pudimos confirmar la preferencia en la nube. Sólo mantenemos activa una decisión previamente confirmada.");
    });
  }, [accessToken, userId]);

  useEffect(() => {
    synchronize();
    const refreshWhenFocused = () => synchronize();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") synchronize(); };
    window.addEventListener("focus", refreshWhenFocused);
    window.addEventListener("online", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      refreshController.current?.abort();
      refreshRevision.current += 1;
      window.removeEventListener("focus", refreshWhenFocused);
      window.removeEventListener("online", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [synchronize]);

  const beginExplicitAction = useCallback(() => {
    refreshController.current?.abort();
    refreshRevision.current += 1;
  }, []);

  const persistPreference = useCallback(async (preference: AccountPermissionPreferenceKind, requestedValue: AccountPermissionValue) => {
    // An explicit user choice invalidates every older hydration response.
    refreshController.current?.abort();
    const revision = ++refreshRevision.current;
    setSyncMessage("");
    if (!accessToken) {
      setSyncMessage("No pudimos confirmar esta autorización. Inicia sesión y vuelve a intentar.");
      return null;
    }
    const record = { version: 1 as const, value: requestedValue, changedAt: new Date().toISOString() };
    try {
      const remote = await saveAccountDevicePermissionPreference(accessToken, preference, record);
      if (revision !== refreshRevision.current) return null;
      const saved = cacheAccountDevicePermissionPreferences(localStorage, userId, remote);
      setValue(saved);
      setSyncMessage("");
      window.dispatchEvent(new Event(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT));
      return saved;
    } catch {
      if (revision !== refreshRevision.current) return null;
      // Legal/product intent is server-canonical. Keep the exact prior local
      // state when the server did not confirm the explicit action.
      setValue(readAccountDevicePermissionPreferences(localStorage, userId));
      setSyncMessage("No pudimos guardar la autorización. Conservamos el estado anterior; vuelve a intentar.");
      return null;
    }
  }, [accessToken, userId]);

  return { value, setValue, notificationAvailable, syncMessage, beginExplicitAction, persistPreference, ready };
}

export function InitialDevicePermissions({ userId, accessToken, onContinue, onboardingChoices }: { userId: string; accessToken: string | null; onContinue: () => void; onboardingChoices?: { location: boolean; notifications: boolean } }) {
  const { value, setValue, notificationAvailable, syncMessage, beginExplicitAction, persistPreference, ready } = usePersistentDevicePermissions(userId, accessToken);
  const [busy, setBusy] = useState<"location" | "notifications" | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const locationController = useRef<AbortController | null>(null);
  const continued = useRef(false);
  const pending = onboardingChoices ? pendingOnboardingDevicePermissions(onboardingChoices, value, { location: typeof navigator !== "undefined" && Boolean(navigator.geolocation), notifications: Boolean(notificationAvailable) }) : { location: false, notifications: false };
  const needsLocation = pending.location, needsNotifications = pending.notifications;
  useEffect(() => () => locationController.current?.abort(), []);
  useEffect(() => {
    if (!onboardingChoices || !ready || busy || needsLocation || needsNotifications || continued.current) return;
    continued.current = true;
    finishInitialDevicePermissions(localStorage, userId);
    onContinue();
  }, [onboardingChoices, ready, busy, needsLocation, needsNotifications, userId, onContinue]);

  async function location() {
    beginExplicitAction();
    locationController.current?.abort();
    const controller = new AbortController();
    locationController.current = controller;
    setBusy("location");
    try {
      const current = accessToken
        ? readAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      const authorized = current.locationPreference === "enabled"
        ? current
        : onboardingChoices ? null : await persistPreference("location", "enabled");
      if (!authorized || controller.signal.aborted) return;
      const next = await requestInitialLocation(localStorage, userId, navigator.geolocation, { signal: controller.signal });
      if (!controller.signal.aborted) setValue(next);
    }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function notifications() {
    beginExplicitAction();
    const api = currentNotificationApi();
    setNotificationMessage("");
    setBusy("notifications");
    try {
      if (onboardingChoices && (!onboardingChoices.notifications || readAccountDevicePermissionPreferences(localStorage, userId).notificationPreference !== "enabled")) return;
      if (!api) {
        setNotificationMessage("Puedes continuar sin notificaciones en este navegador.");
        return;
      }
      // Invoke the OS prompt before any cloud await: Safari requires the tap's
      // transient user activation. Product intent is still confirmed remotely.
      const permission = requestInitialNotifications(localStorage, userId, api);
      const current = readAccountDevicePermissionPreferences(localStorage, userId);
      const authorized = current.notificationPreference === "enabled"
        ? current : await persistPreference("notifications", "enabled");
      await permission;
      if (authorized) setValue(readAccountDevicePermissionPreferences(localStorage, userId));
    }
    finally { setBusy(null); }
  }
  async function skipNotifications() {
    setBusy("notifications");
    try {
      // Skipping the OS prompt is not a revocation of the separately recorded
      // in-app preference. The preceding consent checkpoint owns that choice.
      setValue(finishInitialDevicePermissions(localStorage, userId));
      onContinue();
    } finally {
      setBusy(null);
    }
  }
  if (onboardingChoices) return <div className="devicePermissionChoices">
    {!ready ? <p role="status">Comprobando permisos del dispositivo…</p> : <>
      {(needsLocation || needsNotifications) && <h2>Permisos del dispositivo</h2>}
      {needsLocation && <article><div><b>Ubicación</b><small>Permite mostrar campos cercanos.</small></div><button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : "PERMITIR UBICACIÓN"}</button></article>}
      {needsNotifications && <article><div><b>Notificaciones</b><small>Recibe avisos de rondas, amigos y actividad.</small></div><button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Solicitando…" : "PERMITIR NOTIFICACIONES"}</button></article>}
      {syncMessage && <p className="hint" role="status">{syncMessage}</p>}
      {(needsLocation || needsNotifications) && <button type="button" className="primary big" disabled={busy !== null} onClick={() => { if (continued.current) return; continued.current = true; finishInitialDevicePermissions(localStorage, userId); onContinue(); }}>CONTINUAR</button>}
    </>}
  </div>;
  return <div className="devicePermissionChoices">
    <article><div><b>Ubicación</b><span aria-live="polite">{locationStatusLabel(value.location)}</span><small>Usaremos tu ubicación para mostrarte y ordenar campos cercanos, facilitar la selección del campo donde juegas y habilitar funciones basadas en ubicación durante tus rondas cuando correspondan. Es opcional y tú decides cuándo compartirla.</small></div>{value.location === "granted" && value.locationEnabled ? <strong aria-label="Ubicación permitida">✓</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : value.location === "granted" ? "Usar ubicación" : value.location === "denied" ? "Volver a comprobar" : "Permitir ubicación"}</button>}</article>
    <article><div><b>Notificaciones</b><span aria-live="polite">{notificationStatusLabel(value, notificationAvailable)}</span><small>Recibe mensajes de otros jugadores, invitaciones a rondas y grupos, avisos de tus partidas, recordatorios y actualizaciones importantes de The Backyard.</small>{notificationMessage && <small role="status">{notificationMessage}</small>}</div>{value.notificationPreference === "enabled" && value.notifications === "granted" ? <strong aria-label="Notificaciones activadas">✓</strong> : notificationAvailable === false ? <small>Puedes continuar sin notificaciones en este navegador.</small> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Solicitando…" : "Permitir notificaciones"}</button>}</article>
    {syncMessage ? <p className="hint" role="status">{syncMessage}</p> : null}
    <button type="button" className="primary big" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Continuar</button>
    <button type="button" className="textButton" disabled={busy !== null} onClick={() => void skipNotifications()}>AHORA NO</button>
  </div>;
}

export function DevicePermissionSettings({ userId, accessToken }: { userId: string; accessToken: string | null }) {
  const { value, syncMessage, beginExplicitAction, persistPreference } = usePersistentDevicePermissions(userId, accessToken);
  const [busy, setBusy] = useState(false);
  async function deactivate(preference: AccountPermissionPreferenceKind) {
    beginExplicitAction();
    setBusy(true);
    try { await persistPreference(preference, "disabled"); }
    finally { setBusy(false); }
  }
  return <section className="card accountCompactCard"><h2>Permisos del dispositivo</h2>
    <div className="accountCompactRows">
      <div><span>Ubicación</span><b>{devicePermissionReviewStatus(value, "location")}</b></div>
      <div><span>Notificaciones</span><b>{devicePermissionReviewStatus(value, "notifications")}</b></div>
    </div>
    <p className="hint">Aquí puedes revisar o desactivar estos permisos en The Backyard. Los permisos del dispositivo se cambian desde sus ajustes.</p>
    {syncMessage ? <p className="hint" role="status">{syncMessage}</p> : null}
    <div className="accountInlineActions">
      {value.locationPreference === "enabled" && <button type="button" className="secondary" disabled={busy} onClick={() => void deactivate("location")}>Desactivar ubicación</button>}
      {value.notificationPreference === "enabled" && <button type="button" className="secondary" disabled={busy} onClick={() => void deactivate("notifications")}>Desactivar notificaciones</button>}
    </div>
  </section>;
}
