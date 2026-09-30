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
  if (value.notificationPreference === "enabled" && available === false) return "Solicitud guardada";
  return available === null ? "Preparando…" : "Opcionales";
}

function locationSystemStatus(status: DevicePermissionPreferences["location"]) {
  if (status === "granted") return "Permitido";
  if (status === "denied") return "No permitido";
  if (status === "prompt" || status === "unknown") return "Pendiente";
  return "No disponible";
}

function notificationSystemStatus(status: DevicePermissionPreferences["notifications"]) {
  if (status === "granted") return "Permitido";
  if (status === "denied") return "No permitido";
  if (status === "prompt" || status === "unknown") return "Pendiente";
  return "No disponible";
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
  const refreshController = useRef<AbortController | null>(null);
  const refreshRevision = useRef(0);

  const synchronize = useCallback(() => {
    const revision = ++refreshRevision.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const api = currentNotificationApi();
    setNotificationAvailable(Boolean(api));
    const device = refreshDevicePermissionStateWithoutPrompt(localStorage, userId, navigator, api, {
      shouldCommit: () => !controller.signal.aborted && revision === refreshRevision.current,
    });
    const account = accessToken
      ? requestAccountDevicePermissionPreferences(accessToken, controller.signal)
      : Promise.resolve(null);
    void Promise.all([device, account]).then(([, remote]) => {
      if (controller.signal.aborted || revision !== refreshRevision.current) return;
      if (!remote) {
        setValue(readDevicePermissionPreferences(localStorage, userId));
        return;
      }
      // Re-read after both async sources settle. A newer explicit tap may have
      // updated local storage while an older OS/cloud read was in flight.
      const saved = cacheAccountDevicePermissionPreferences(localStorage, userId, remote);
      setValue(saved);
      setSyncMessage("");
    }).catch(() => {
      if (controller.signal.aborted || revision !== refreshRevision.current) return;
      // Authenticated legacy caches are not consent evidence. On an outage,
      // retain only values backed by a previous canonical response clock.
      const saved = accessToken
        ? failClosedAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      setValue(saved);
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

  return { value, setValue, notificationAvailable, syncMessage, beginExplicitAction, persistPreference };
}

export function InitialDevicePermissions({ userId, accessToken, onContinue }: { userId: string; accessToken: string | null; onContinue: () => void }) {
  const { value, setValue, notificationAvailable, syncMessage, beginExplicitAction, persistPreference } = usePersistentDevicePermissions(userId, accessToken);
  const [busy, setBusy] = useState<"location" | "notifications" | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const locationController = useRef<AbortController | null>(null);

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
        : await persistPreference("location", "enabled");
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
      const current = accessToken
        ? readAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      const authorized = current.notificationPreference === "enabled"
        ? current
        : await persistPreference("notifications", "enabled");
      if (!authorized) return;
      const next = await requestInitialNotifications(localStorage, userId, api);
      setValue(next);
      if (!api) setNotificationMessage("Perfecto. Las activaremos cuando uses la app de The Backyard.");
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
  return <div className="devicePermissionChoices">
    <article><div><b>Ubicación</b><span aria-live="polite">{locationStatusLabel(value.location)}</span><small>Usaremos tu ubicación para mostrarte y ordenar campos cercanos, facilitar la selección del campo donde juegas y habilitar funciones basadas en ubicación durante tus rondas cuando correspondan. Es opcional y tú decides cuándo compartirla.</small></div>{value.location === "granted" && value.locationEnabled ? <strong aria-label="Ubicación permitida">✓</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : value.location === "granted" ? "Usar ubicación" : value.location === "denied" ? "Volver a comprobar" : "Permitir ubicación"}</button>}</article>
    <article><div><b>Notificaciones</b><span aria-live="polite">{notificationStatusLabel(value, notificationAvailable)}</span><small>Recibe mensajes de otros jugadores, invitaciones a rondas y grupos, avisos de tus partidas, recordatorios y actualizaciones importantes de The Backyard.</small>{notificationMessage && <small role="status">{notificationMessage}</small>}</div>{value.notificationPreference !== "enabled" ? <button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Activando…" : "ACTIVAR NOTIFICACIONES"}</button> : value.notifications === "granted" ? <strong aria-label="Notificaciones activadas">✓</strong> : value.notifications === "denied" ? <strong>Notificaciones no activadas</strong> : notificationAvailable === false ? <strong>✓ Solicitud guardada</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Activando…" : "ACTIVAR NOTIFICACIONES"}</button>}</article>
    {syncMessage ? <p className="hint" role="status">{syncMessage}</p> : null}
    <button type="button" className="primary big" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Continuar</button>
    <button type="button" className="textButton" disabled={busy !== null} onClick={() => void skipNotifications()}>AHORA NO</button>
  </div>;
}

export function DevicePermissionSettings({ userId, accessToken }: { userId: string; accessToken: string | null }) {
  const { value, setValue, notificationAvailable, syncMessage, beginExplicitAction, persistPreference } = usePersistentDevicePermissions(userId, accessToken);
  const [busy, setBusy] = useState(false);
  const locationController = useRef<AbortController | null>(null);
  useEffect(() => () => locationController.current?.abort(), []);
  async function changePreference(preference: AccountPermissionPreferenceKind, requestedValue: AccountPermissionValue) {
    beginExplicitAction();
    setBusy(true);
    try { await persistPreference(preference, requestedValue); }
    finally { setBusy(false); }
  }
  async function requestLocationPermission() {
    beginExplicitAction();
    locationController.current?.abort();
    const controller = new AbortController();
    locationController.current = controller;
    setBusy(true);
    try {
      const current = accessToken
        ? readAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      if (current.locationPreference !== "enabled") {
        setValue(current);
        return;
      }
      const next = await requestInitialLocation(localStorage, userId, navigator.geolocation, { signal: controller.signal });
      if (!controller.signal.aborted) setValue(next);
    }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function requestNotificationPermission() {
    beginExplicitAction();
    const api = currentNotificationApi();
    setBusy(true);
    try {
      const current = accessToken
        ? readAccountDevicePermissionPreferences(localStorage, userId)
        : readDevicePermissionPreferences(localStorage, userId);
      if (current.notificationPreference !== "enabled") {
        setValue(current);
        return;
      }
      const next = await requestInitialNotifications(localStorage, userId, api);
      setValue(next);
    }
    finally { setBusy(false); }
  }
  return <section className="card accountCompactCard"><h2>Permisos del dispositivo</h2>
    <div className="accountCompactRows"><div><span>Ubicación</span><b>{locationSystemStatus(value.location)}</b><small>Uso en The Backyard: {value.locationPreference === "enabled" ? "activo" : value.locationPreference === "disabled" ? "desactivado" : "pendiente"}</small></div><div><span>Notificaciones</span><b>{notificationSystemStatus(value.notifications)}</b><small>Preferencia interna: {value.notificationPreference === "enabled" ? "activa" : value.notificationPreference === "disabled" ? "desactivada" : "pendiente"} · Registro de entrega: {value.pushSubscription === "registered" ? "registrado" : "no registrado"}</small></div></div>
    <p className="hint">Preferencia, permiso del sistema y entrega son estados distintos. Aquí puedes revisar o desactivar el uso interno. Si el sistema bloqueó un permiso, cámbialo desde los permisos de la app o del dispositivo.</p>
    {syncMessage ? <p className="hint" role="status">{syncMessage}</p> : null}
    <div className="accountInlineActions">{value.locationPreference === "enabled"
      ? <button type="button" className="secondary" disabled={busy} onClick={() => void changePreference("location", "disabled")}>Desactivar uso interno de ubicación</button>
      : <button type="button" className="secondary" disabled={busy} onClick={() => void changePreference("location", "enabled")}>Activar uso interno de ubicación</button>}
      {value.locationPreference === "enabled" && value.location !== "granted" && <button type="button" className="secondary" disabled={busy} onClick={() => void requestLocationPermission()}>{busy ? "Comprobando…" : value.location === "denied" ? "Volver a comprobar permiso" : "Solicitar permiso del dispositivo"}</button>}
      {value.notificationPreference === "enabled"
        ? <button type="button" className="secondary" disabled={busy} onClick={() => void changePreference("notifications", "disabled")}>Desactivar uso interno de notificaciones</button>
        : <button type="button" className="secondary" disabled={busy} onClick={() => void changePreference("notifications", "enabled")}>Activar preferencia interna</button>}
      {value.notificationPreference === "enabled" && value.notifications !== "granted" && value.notifications !== "denied" && notificationAvailable !== false && <button type="button" className="secondary" disabled={busy} onClick={() => void requestNotificationPermission()}>{busy ? "Solicitando…" : "Solicitar permiso del sistema"}</button>}</div>
  </section>;
}
