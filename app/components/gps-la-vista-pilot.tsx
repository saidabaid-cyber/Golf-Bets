"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mountPilot, type PilotTarget } from "../../lib/gps-pilot-la-vista-1/view.mjs";
import "../../lib/gps-pilot-la-vista-1/pilot.css";
import { getSupabaseBrowser } from "../../lib/supabase/client";

export function GpsLaVistaPilot() {
  const root = useRef<HTMLElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [target, setTarget] = useState<PilotTarget | null>(null);
  const [message, setMessage] = useState("Comprobando la sesión de The Backyard…");
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) { setMessage("Inicia sesión en The Backyard para abrir esta prueba restringida."); return; }
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (active) { setToken(session?.access_token || null); if (!session) setMessage("Inicia sesión en The Backyard con una cuenta autorizada."); }
    });
    void client.auth.getSession().then(({ data }) => {
      if (active) { setToken(data.session?.access_token || null); if (!data.session) setMessage("Inicia sesión en The Backyard con una cuenta autorizada."); }
    }).catch(() => { if (active) setMessage("No pudimos comprobar la sesión. Vuelve a Inicio e inicia sesión."); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    setTarget(null);
    if (!token) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      if (active) setMessage("La comprobación de acceso tardó demasiado. Vuelve a abrir esta pantalla.");
      controller.abort();
    }, 12000);
    setMessage("Comprobando el permiso para esta prueba…");
    void fetch("/api/gps-pilot/la-vista-1", { headers: { authorization: `Bearer ${token}` },
      cache: "no-store", signal: controller.signal }).then(async response => {
      if (!active || controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(response.status === 403 ? "Esta prueba está restringida a cuentas con permiso de administración de campos." :
          response.status === 401 ? "Tu sesión terminó. Vuelve a Inicio e inicia sesión." : "La prueba GPS no está disponible en este momento.");
        return;
      }
      const body = await response.json();
      if (!controller.signal.aborted) setTarget(body.target);
    }).catch(() => { if (active && !controller.signal.aborted) setMessage("No pudimos comprobar el acceso. Vuelve a abrir esta pantalla."); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [token]);
  useEffect(() => {
    if (!root.current || !target) return;
    return mountPilot(root.current, { target, imageUrl: "/gps-pilot-la-vista-1/reference.png" });
  }, [target]);
  return target ? <main key="pilot" ref={root} aria-label="Piloto GPS La Vista hoyo 1" /> :
    <main key="access" className="gpsPilot"><header className="gpsPilotHeader"><Link href="/">← The Backyard</Link><span>PRUEBA GPS</span></header>
      <h1>La Vista — Hoyo 1</h1><p className="gpsPilotWarning">Objetivo provisional; pendiente de comprobar en campo</p>
      <p role="status">{message}</p><Link href="/">Volver a Inicio</Link></main>;
}
