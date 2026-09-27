"use client";

import { useEffect, useRef, useState } from "react";
import {
  devicePermissionContext,
  disableLocationForApp,
  disableNotificationsForApp,
  enableLocationForApp,
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

function notificationStatusLabel(status: DevicePermissionPreferences["notifications"], available: boolean | null) {
  if (available === null) return "Consultando permiso…";
  if (!available || status === "unavailable") return "No disponible en este navegador";
  if (status === "granted") return "✓ Permitido en este dispositivo";
  if (status === "denied") return "No permitido";
  if (status === "prompt") return "Todavía no decidido";
  return "Sin solicitar";
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
  const locationController = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const api = currentNotificationApi();
      setNotificationAvailable(Boolean(api));
      void refreshDevicePermissionStateWithoutPrompt(localStorage, userId, navigator, api).then((next) => { if (active) setValue(next); }).catch(() => undefined);
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
    setBusy("notifications");
    try { setValue(await requestInitialNotifications(localStorage, userId, api)); }
    finally { setBusy(null); }
  }
  return <div className="devicePermissionChoices">
    <article><div><b>Ubicación</b><span aria-live="polite">{locationStatusLabel(value.location)}</span><small>Usaremos tu ubicación para mostrarte y ordenar campos cercanos, facilitar la selección del campo donde juegas y habilitar funciones basadas en ubicación durante tus rondas cuando correspondan. Es opcional y tú decides cuándo compartirla.</small></div>{value.location === "granted" ? <strong aria-label="Ubicación permitida">✓</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : value.location === "denied" ? "Volver a comprobar" : "Permitir ubicación"}</button>}</article>
    <article><div><b>Notificaciones</b><span aria-live="polite">{notificationStatusLabel(value.notifications, notificationAvailable)}</span><small>Actívalas para recibir mensajes de otros jugadores, invitaciones a rondas y grupos, avisos de tus partidas, recordatorios y otras actualizaciones importantes de The Backyard.</small><small>El permiso del dispositivo no registra por sí solo una suscripción push ni cambia tus preferencias internas de avisos.</small>{value.notifications === "denied" && <small>Puedes cambiar este permiso después desde los ajustes de The Backyard en tu dispositivo o navegador.</small>}{notificationAvailable === false && <small>Estarán disponibles cuando uses The Backyard en un navegador o app compatible. Puedes continuar normalmente.</small>}</div>{notificationAvailable && value.notifications === "granted" ? <strong aria-label="Notificaciones permitidas">✓</strong> : notificationAvailable && value.notifications !== "denied" ? <button type="button" className="secondary" disabled={busy !== null} onClick={() => void notifications()}>{busy === "notifications" ? "Solicitando…" : "Permitir notificaciones"}</button> : null}</article>
    <button type="button" className="primary big" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Continuar</button>
    <button type="button" className="textButton" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Ahora no</button>
  </div>;
}

export function DevicePermissionSettings({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => typeof window === "undefined" ? emptyDevicePermissionPreferences(userId) : readDevicePermissionPreferences(localStorage, userId));
  const [busy, setBusy] = useState(false);
  const locationController = useRef<AbortController | null>(null);
  useEffect(() => { void refreshDevicePermissionStateWithoutPrompt(localStorage, userId).then(setValue).catch(() => undefined); }, [userId]);
  useEffect(() => () => locationController.current?.abort(), [userId]);
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
  return <section className="card accountCompactCard"><h2>Permisos del dispositivo</h2>
    <div className="accountCompactRows"><div><span>Ubicación</span><b>{value.locationEnabled ? locationStatusLabel(value.location) : "Desactivada en The Backyard"}</b></div><div><span>Notificaciones</span><b>{value.notificationsEnabled ? notificationStatusLabel(value.notifications, true) : "Desactivadas en The Backyard"}</b></div></div>
    <p className="hint">Aquí revisas o desactivas el uso dentro de The Backyard. Si el sistema bloqueó un permiso, debes cambiarlo desde los permisos de la app o del dispositivo.</p>
    <div className="accountInlineActions">{value.locationEnabled
      ? <button type="button" className="secondary" onClick={() => setValue(disableLocationForApp(localStorage, userId))}>Desactivar ubicación</button>
      : <button type="button" className="secondary" disabled={busy} onClick={() => void enableLocation()}>{busy ? "Comprobando…" : value.location === "denied" ? "Volver a comprobar ubicación" : "Volver a permitir ubicación"}</button>}
      {value.notificationsEnabled && <button type="button" className="secondary" onClick={() => setValue(disableNotificationsForApp(localStorage, userId))}>Desactivar notificaciones</button>}</div>
  </section>;
}
