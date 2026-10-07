"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mountPilot, type PilotTarget } from "../../lib/gps-pilot-la-vista-1/view.mjs";
import "../../lib/gps-pilot-la-vista-1/pilot.css";
import { getSupabaseBrowser } from "../../lib/supabase/client";
import { GPS_PILOT_LOGIN_PATH, gpsReturnStorage, rememberGpsPilotReturn } from "../../lib/gps-pilot-la-vista-1/auth-return";
import { watchGpsPilotSession, type PilotSessionState } from "../../lib/gps-pilot-la-vista-1/session";
import imageReference from "../../lib/gps-pilot-la-vista-1/image-reference.json";

type Access = { session: PilotSessionState; target: PilotTarget | null; status: "ready" | "denied" | "login" | "error"; message: string };
export function GpsLaVistaPilot() {
  const root = useRef<HTMLElement>(null);
  const [session, setSession] = useState<PilotSessionState>({ status: "checking", token: null });
  const [access, setAccess] = useState<Access | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) { setSession({ status: "error", token: null }); return; }
    return watchGpsPilotSession(client.auth, setSession);
  }, [retry]);
  useEffect(() => {
    if (session.status !== "authenticated") return;
    const token = session.token;
    let active = true;
    const controller = new AbortController();
    const fail = (message: string) => setAccess({ session, target: null, status: "error", message });
    const timeout = window.setTimeout(() => {
      if (active) fail("La comprobación de acceso tardó demasiado. Puedes reintentar.");
      controller.abort();
    }, 12000);
    void fetch("/api/gps-pilot/la-vista-1", { headers: { authorization: `Bearer ${token}` },
      cache: "no-store", signal: controller.signal }).then(async response => {
      if (!active || controller.signal.aborted) return;
      if (!response.ok) {
        setAccess({ session, target: null, status: response.status === 403 ? "denied" : response.status === 401 ? "login" : "error",
          message: response.status === 403 ? "Esta cuenta no tiene acceso a la prueba GPS. Solo pueden abrirla los probadores autorizados." :
            response.status === 401 ? "Tu sesión terminó. Inicia sesión para regresar a este piloto." : "No pudimos comprobar el permiso. Puedes reintentar." });
        return;
      }
      const body = await response.json();
      if (active && !controller.signal.aborted) setAccess({ session, target: body.target, status: "ready", message: "" });
    }).catch(() => { if (active && !controller.signal.aborted) fail("No pudimos comprobar el acceso. Puedes reintentar."); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [session]);
  // A permission result for a previous token cannot flash after sign-out/rotation.
  const currentAccess = session.status === "authenticated" && access?.session === session ? access : null;
  const target = currentAccess?.status === "ready" ? currentAccess.target : null;
  useEffect(() => {
    if (!root.current || !target) return;
    return mountPilot(root.current, { target, imageUrl: imageReference.imageUrl, imageReference });
  }, [target]);
  const needsLogin = session.status === "anonymous" || currentAccess?.status === "login";
  const hasError = session.status === "error" || currentAccess?.status === "error";
  const message = session.status === "checking" ? "Comprobando la sesión de The Backyard…" :
    session.status === "anonymous" ? "Inicia sesión con tu cuenta autorizada. Volverás automáticamente a este piloto." :
    session.status === "error" ? "No pudimos comprobar la sesión. Reintenta antes de continuar." :
    currentAccess?.message || "Comprobando el permiso para esta prueba…";
  return target ? <main key="pilot" ref={root} aria-label="Piloto GPS La Vista hoyo 1" /> :
    <main key="access" className="gpsPilot"><header className="gpsPilotHeader"><Link href="/">← The Backyard</Link><span>PRUEBA GPS</span></header>
      <h1>La Vista — Hoyo 1</h1><p className="gpsPilotWarning">Objetivo provisional; pendiente de comprobar en campo</p>
      <p role="status">{message}</p>
      {needsLogin && <Link className="primary linkButton" prefetch={false} href={GPS_PILOT_LOGIN_PATH}
        onClick={() => rememberGpsPilotReturn(gpsReturnStorage(), window.location.host)}>Iniciar sesión y volver al piloto</Link>}
      {hasError && <button type="button" onClick={() => { setSession({ status: "checking", token: null }); setAccess(null); setRetry(value => value + 1); }}>Reintentar</button>}
    </main>;
}
