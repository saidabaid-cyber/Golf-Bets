"use client";

import { useEffect, useRef, useState } from "react";
import { requestCourseLocation } from "../../lib/browser-course-location";
import {
  devicePermissionContext,
  locationPermissionPresentation,
  notificationPermissionPresentation,
  type DevicePermissionContext,
  type LocationPermissionUiState,
  type NotificationPermissionUiState,
} from "../../lib/device-permissions";
import { ModalShell } from "./modal-shell";

type HelpTopic = "location" | "notification" | "install" | null;

const DEFAULT_CONTEXT: DevicePermissionContext = { ios: false, standalone: false, notificationApi: false };

export function DevicePermissions({ kind = "all" }: { kind?: "all" | "location" | "notifications" }) {
  const [location, setLocation] = useState<LocationPermissionUiState>("checking");
  const [notification, setNotification] = useState<NotificationPermissionUiState>("checking");
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [helpTopic, setHelpTopic] = useState<HelpTopic>(null);
  const cancelLocation = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let permission: PermissionStatus | undefined;
    const refresh = async () => {
      if (!alive) return;
      const notificationApi = typeof Notification !== "undefined";
      const nextContext = devicePermissionContext({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        standaloneDisplayMode: window.matchMedia?.("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
        notificationApi,
      });
      setContext(nextContext);
      setNotification(notificationApi ? Notification.permission : "unavailable");
      if (!navigator.geolocation) { setLocation("geolocation-unavailable"); return; }
      if (!navigator.permissions?.query) { setLocation("query-unsupported"); return; }
      try {
        const value = await navigator.permissions.query({ name: "geolocation" });
        if (!alive) return;
        if (permission) permission.onchange = null;
        permission = value;
        setLocation(value.state);
        value.onchange = () => { if (alive) setLocation(value.state); };
      } catch {
        if (alive) setLocation("query-unsupported");
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      cancelLocation.current();
      if (permission) permission.onchange = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const locationView = locationPermissionPresentation(location);
  const notificationView = notificationPermissionPresentation(notification, context, false);

  function requestLocation() {
    cancelLocation.current();
    setLocation("requesting");
    cancelLocation.current = requestCourseLocation(navigator.geolocation, (result) => {
      if (result.status === "located") setLocation("granted");
      else if (result.status === "unsupported") setLocation("geolocation-unavailable");
      else setLocation(result.status);
    });
  }

  async function requestNotifications() {
    if (typeof Notification === "undefined") { setNotification("unavailable"); return; }
    setNotification("requesting");
    try { setNotification(await Notification.requestPermission()); }
    catch { setNotification(Notification.permission); }
  }

  function locationAction() {
    if (!locationView.action || !locationView.actionLabel) return null;
    if (locationView.action === "request" || locationView.action === "retry") {
      return <button type="button" className="secondary" onClick={requestLocation}>{locationView.actionLabel}</button>;
    }
    return <button type="button" className="secondary" onClick={() => setHelpTopic("location")}>{locationView.actionLabel}</button>;
  }

  function notificationAction() {
    if (!notificationView.action || !notificationView.actionLabel) return null;
    if (notificationView.action === "request") {
      return <button type="button" className="secondary" onClick={() => void requestNotifications()}>{notificationView.actionLabel}</button>;
    }
    return <button type="button" className="secondary" onClick={() => setHelpTopic(notificationView.action === "install-help" ? "install" : "notification")}>{notificationView.actionLabel}</button>;
  }

  return <div className="devicePermissions">
    {kind !== "notifications" && <section aria-labelledby="device-location-title">
      <h3 id="device-location-title">Ubicación</h3>
      <p>Se usa sólo cuando pides campos cercanos. No guardamos ni enviamos tus coordenadas.</p>
      <p role="status"><b>{locationView.status}</b>{locationView.detail && <><br />{locationView.detail}</>}</p>
      {locationAction()}
    </section>}
    {kind !== "location" && <section aria-labelledby="device-notification-title">
      <h3 id="device-notification-title">Permiso de notificaciones</h3>
      <p role="status"><b>{notificationView.status}</b>{notificationView.detail && <><br />{notificationView.detail}</>}</p>
      {notificationAction()}
    </section>}
    <small>Estos controles corresponden al dispositivo o navegador. Tus preferencias de avisos se guardan por separado y ningún permiso es obligatorio para jugar.</small>
    <ModalShell open={helpTopic !== null} onClose={() => setHelpTopic(null)} labelledBy="permission-help-title">
      <h2 id="permission-help-title">{helpTopic === "install" ? "Instalar The Backyard en iPhone" : helpTopic === "location" ? "Cambiar permiso de ubicación" : "Cambiar permiso de notificaciones"}</h2>
      {helpTopic === "install" ? <>
        <p>En Safari en iPhone:</p>
        <ol><li>Toca Compartir.</li><li>Elige Agregar a pantalla de inicio.</li><li>Abre The Backyard desde el nuevo icono.</li><li>Regresa a Permisos y solicita notificaciones.</li></ol>
      </> : helpTopic === "location" ? <>
        <p>The Backyard no puede cambiar ni revocar este permiso directamente.</p>
        {context.ios
          ? <p>En Safari, abre los ajustes del sitio desde la barra de dirección. También puedes revisar Ajustes &gt; Apps &gt; Safari &gt; Ubicación, según tu versión de iOS.</p>
          : <p>Abre la información o ajustes de este sitio desde la barra de dirección del navegador y busca Ubicación.</p>}
        <p>Si la ubicación no está disponible, siempre puedes buscar el campo por nombre.</p>
      </> : <>
        <p>The Backyard no puede volver a abrir un aviso bloqueado ni revocar el permiso directamente.</p>
        {context.ios
          ? <p>Abre The Backyard desde su icono y revisa Ajustes &gt; Notificaciones &gt; The Backyard.</p>
          : <p>Abre la información o ajustes de este sitio desde la barra de dirección del navegador y busca Notificaciones.</p>}
        <p>El permiso del dispositivo no activa por sí solo el servicio de envío push.</p>
      </>}
      <div className="dialogActions"><button type="button" className="primary" onClick={() => setHelpTopic(null)}>Entendido</button></div>
    </ModalShell>
  </div>;
}
