"use client";

import { useEffect, useRef, useState } from "react";
import {
  devicePermissionContext,
  declineInitialNotifications,
  disableLocationForApp,
  disableNotificationsForApp,
  enableLocationForApp,
  enableNotificationsForApp,
  emptyDevicePermissionPreferences,
  finishInitialDevicePermissions,
  readDevicePermissionPreferences,
  refreshDevicePermissionStateWithoutPrompt,
  requestInitialLocation,
  requestInitialNotifications,
  type DevicePermissionPreferences,
  type NotificationPermissionApi,
} from "../../lib/device-permissions";

function locationStatusLabel(status: DevicePermissionPreferences["location"]) {
  if (status === "granted") return "Permitido en este dispositivo";
  if (status === "denied") return "Bloqueado en este dispositivo";
  if (status === "prompt") return "Todavía no decidido";
  if (status === "timeout") return "La última consulta agotó el tiempo";
  if (status === "unavailable") return "No podemos consultar este permiso";
  return "Sin configurar";
}

function notificationStatusLabel(value: DevicePermissionPreferences, available: boolean | null) {
  if (value.notifications === "granted") return "✓ Notificaciones activadas";
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

export function InitialDevicePermissions({ userId, onContinue }: { userId: string; onContinue: () => void }) {
  const [value, setValue] = useState(() => typeof window === "undefined" ? emptyDevicePermissionPreferences(userId) : readDevicePermissionPreferences(localStorage, userId));
  const [busy, setBusy] = useState<"location" | "notifications" | null>(null);
  const [notificationAvailable, setNotificationAvailable] = useState<boolean | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const locationController = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const api = currentNotificationApi();
      setNotificationAvailable(Boolean(api));
      void refreshDevicePermissionStateWithoutPrompt(localStorage, userId, navigator, api)
        .then((next) => { if (active) setValue(next); })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      locationController.current?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId]);

  async function location() {
    if (value.location === "granted") {
      setValue(enableLocationForApp(localStorage, userId));
      return;
    }
    locationController.current?.abort();
    const controller = new AbortController();
    locationController.current = controller;
    setBusy("location");
    try { const next = await requestInitialLocation(localStorage, userId, navigator.geolocation, { signal: controller.signal }); if (!controller.signal.aborted) setValue(next); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function notifications() {
    const api = currentNotificationApi();
    setNotificationAvailable(Boolean(api));
    setNotificationMessage("");
    setBusy("notifications");
    try {
      const next = await requestInitialNotifications(localStorage, userId, api);
      setValue(next);
      if (!api) setNotificationMessage("Perfecto. Las activaremos cuando uses la app de The Backyard.");
    }
    finally { setBusy(null); }
  }
  return <div className="devicePermissionChoices">
    <article><div><b>Ubicación</b><span aria-live="polite">{locationStatusLabel(value.location)}</span><small>Usaremos tu ubicación para mostrarte y ordenar campos cercanos, facilitar la selección del campo donde juegas y habilitar funciones basadas en ubicación durante tus rondas cuando correspondan. Es opcional y tú decides cuándo compartirla.</small></div>{value.location === "granted" && value.locationEnabled ? <strong aria-label="Ubicación permitida">✓</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : value.location === "granted" ? "Usar ubicación" : value.location === "denied" ? "Volver a comprobar" : "Permitir ubicación"}</button>}</article>
    <article><div><b>Notificaciones</b><span aria-live="polite">{notificationStatusLabel(value, notificationAvailable)}</span><small>Recibe mensajes de otros jugadores, invitaciones a rondas y grupos, avisos de tus partidas, recordatorios y actualizaciones importantes de The Backyard.</small>{notificationMessage && <small role="status">{notificationMessage}</small>}</div>{value.notifications === "granted" ? <strong aria-label="Notificaciones activadas">✓</strong> : value.notifications === "denied" ? <strong>Notificaciones no activadas</strong> : value.notificationPreference === "enabled" && notificationAvailable === false ? <strong>✓ Solicitud guardada</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Activando…" : "ACTIVAR NOTIFICACIONES"}</button>}</article>
    <button type="button" className="primary big" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Continuar</button>
    <button type="button" className="textButton" disabled={busy !== null} onClick={() => { declineInitialNotifications(localStorage, userId); setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>AHORA NO</button>
  </div>;
}

export function DevicePermissionSettings({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => typeof window === "undefined" ? emptyDevicePermissionPreferences(userId) : readDevicePermissionPreferences(localStorage, userId));
  const [busy, setBusy] = useState(false);
  const [notificationAvailable, setNotificationAvailable] = useState<boolean | null>(null);
  const locationController = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const api = currentNotificationApi();
      setNotificationAvailable(Boolean(api));
      void refreshDevicePermissionStateWithoutPrompt(localStorage, userId, navigator, api)
        .then((next) => { if (active) setValue(next); })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      locationController.current?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId]);
  async function enableLocation() {
    locationController.current?.abort();
    const controller = new AbortController();
    locationController.current = controller;
    setBusy(true);
    try {
      const refreshed = await refreshDevicePermissionStateWithoutPrompt(localStorage, userId);
      if (controller.signal.aborted) return;
      if (refreshed.location === "granted") setValue(enableLocationForApp(localStorage, userId));
      else setValue(await requestInitialLocation(localStorage, userId, navigator.geolocation, { signal: controller.signal }));
    }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function requestNotificationPermission() {
    const api = currentNotificationApi();
    setNotificationAvailable(Boolean(api));
    setBusy(true);
    try { setValue(await requestInitialNotifications(localStorage, userId, api)); }
    finally { setBusy(false); }
  }
  return <section className="card accountCompactCard"><h2>Permisos del dispositivo</h2>
    <div className="accountCompactRows"><div><span>Ubicación</span><b>{locationSystemStatus(value.location)}</b><small>Uso en The Backyard: {value.locationEnabled ? "activo" : "desactivado"}</small></div><div><span>Notificaciones</span><b>{notificationSystemStatus(value.notifications)}</b><small>Preferencia interna: {value.notificationPreference === "enabled" ? "activa" : value.notificationPreference === "disabled" ? "desactivada" : "pendiente"} · Registro de entrega: {value.pushSubscription === "registered" ? "registrado" : "no registrado"}</small></div></div>
    <p className="hint">Preferencia, permiso del sistema y entrega son estados distintos. Aquí puedes revisar o desactivar el uso interno. Si el sistema bloqueó un permiso, cámbialo desde los permisos de la app o del dispositivo.</p>
    <div className="accountInlineActions">{value.locationEnabled
      ? <button type="button" className="secondary" onClick={() => setValue(disableLocationForApp(localStorage, userId))}>Desactivar ubicación</button>
      : <button type="button" className="secondary" disabled={busy} onClick={() => void enableLocation()}>{busy ? "Comprobando…" : value.location === "denied" ? "Volver a comprobar ubicación" : "Volver a permitir ubicación"}</button>}
      {value.notificationPreference === "enabled"
        ? <button type="button" className="secondary" onClick={() => setValue(disableNotificationsForApp(localStorage, userId))}>Desactivar uso interno de notificaciones</button>
        : <button type="button" className="secondary" onClick={() => setValue(enableNotificationsForApp(localStorage, userId))}>Activar preferencia interna</button>}
      {value.notificationPreference === "enabled" && value.notifications !== "granted" && value.notifications !== "denied" && notificationAvailable !== false && <button type="button" className="secondary" disabled={busy} onClick={() => void requestNotificationPermission()}>{busy ? "Solicitando…" : "Solicitar permiso del sistema"}</button>}</div>
  </section>;
}
