"use client";

import { useEffect, useState } from "react";
import {
  disableLocationForApp,
  disableNotificationsForApp,
  emptyDevicePermissionPreferences,
  finishInitialDevicePermissions,
  readDevicePermissionPreferences,
  refreshDevicePermissionStateWithoutPrompt,
  requestInitialLocation,
  requestInitialNotifications,
  type DevicePermissionPreferences,
} from "../../lib/device-permissions";

function statusLabel(status: DevicePermissionPreferences["location"]) {
  if (status === "granted") return "Permitido en este dispositivo";
  if (status === "denied") return "Bloqueado en este dispositivo";
  if (status === "prompt") return "Todavía no decidido";
  if (status === "timeout") return "La última consulta agotó el tiempo";
  if (status === "unavailable") return "No podemos consultar este permiso";
  return "Sin configurar";
}

export function InitialDevicePermissions({ userId, onContinue }: { userId: string; onContinue: () => void }) {
  const [value, setValue] = useState(() => typeof window === "undefined" ? emptyDevicePermissionPreferences(userId) : readDevicePermissionPreferences(localStorage, userId));
  const [busy, setBusy] = useState<"location" | "notifications" | null>(null);

  async function location() {
    setBusy("location");
    try { setValue(await requestInitialLocation(localStorage, userId)); }
    finally { setBusy(null); }
  }
  async function notifications() {
    setBusy("notifications");
    try { setValue(await requestInitialNotifications(localStorage, userId)); }
    finally { setBusy(null); }
  }
  return <div className="devicePermissionChoices">
    <article><div><b>Ubicación</b><span>{statusLabel(value.location)}</span><small>Se usa una ubicación aproximada durante unos minutos para ordenar campos cercanos. Es opcional.</small></div>{value.location === "granted" ? <strong>✓</strong> : <button type="button" className="secondary" disabled={busy !== null} onClick={() => void location()}>{busy === "location" ? "Solicitando…" : value.location === "denied" ? "Volver a comprobar" : "Permitir ubicación"}</button>}</article>
    <article><div><b>Notificaciones</b><span>{statusLabel(value.notifications)}</span><small>El permiso del dispositivo es opcional y no activa por sí solo un servicio push.</small></div>{value.notifications === "granted" ? <strong>✓</strong> : <button type="button" className="secondary" disabled={busy !== null || value.notifications === "denied"} onClick={() => void notifications()}>{busy === "notifications" ? "Solicitando…" : value.notifications === "denied" ? "Bloqueadas" : "Permitir notificaciones"}</button>}</article>
    <button type="button" className="primary big" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Continuar</button>
    <button type="button" className="textButton" disabled={busy !== null} onClick={() => { setValue(finishInitialDevicePermissions(localStorage, userId)); onContinue(); }}>Ahora no</button>
  </div>;
}

export function DevicePermissionSettings({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => typeof window === "undefined" ? emptyDevicePermissionPreferences(userId) : readDevicePermissionPreferences(localStorage, userId));
  const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshDevicePermissionStateWithoutPrompt(localStorage, userId).then(setValue).catch(() => undefined); }, [userId]);
  async function enableLocation() {
    setBusy(true);
    try { setValue(await requestInitialLocation(localStorage, userId)); }
    finally { setBusy(false); }
  }
  return <section className="card accountCompactCard"><h2>Permisos del dispositivo</h2>
    <div className="accountCompactRows"><div><span>Ubicación</span><b>{value.locationEnabled ? statusLabel(value.location) : "Desactivada en The Backyard"}</b></div><div><span>Notificaciones</span><b>{value.notificationsEnabled ? statusLabel(value.notifications) : "Desactivadas en The Backyard"}</b></div></div>
    <p className="hint">Aquí revisas o desactivas el uso dentro de The Backyard. Si el sistema bloqueó un permiso, debes cambiarlo desde los permisos de la app o del dispositivo.</p>
    <div className="accountInlineActions">{value.locationEnabled
      ? <button type="button" className="secondary" onClick={() => setValue(disableLocationForApp(localStorage, userId))}>Desactivar ubicación</button>
      : <button type="button" className="secondary" disabled={busy || value.location === "denied"} onClick={() => void enableLocation()}>{busy ? "Comprobando…" : value.location === "denied" ? "Ubicación bloqueada" : "Volver a permitir ubicación"}</button>}
      {value.notificationsEnabled && <button type="button" className="secondary" onClick={() => setValue(disableNotificationsForApp(localStorage, userId))}>Desactivar notificaciones</button>}</div>
  </section>;
}
