"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getSupabaseBrowser } from "../../../lib/supabase/client";

type AdminMetrics = { users: number; activeUsers: number; rounds: number; groups: number; plans: Record<string, number>; events: Array<{ name: string; count: number }>; errors: Array<{ code: string; count: number }> };

export default function Phase2AdminPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [status, setStatus] = useState("Validando acceso…");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowser();
      if (!client) { if (!cancelled) setStatus("La conexión de cuenta no está configurada en este entorno."); return; }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { if (!cancelled) setStatus("Inicia sesión con una cuenta administradora."); return; }
      const response = await fetch("/api/admin/metrics", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => null) as { data?: AdminMetrics; error?: string } | null;
      if (cancelled) return;
      if (!response.ok) { setStatus(response.status === 403 ? "Esta cuenta no tiene acceso administrativo." : "No fue posible cargar las métricas."); return; }
      if (!body?.data) { setStatus("La respuesta de métricas no fue válida."); return; }
      setMetrics(body.data); setStatus("");
    })().catch(() => { if (!cancelled) setStatus("No fue posible validar el acceso."); });
    return () => { cancelled = true; };
  }, []);
  return <main className="shell"><section className="hero"><div><span className="eyebrow">THE BACKYARD · ADMIN</span><h1>Métricas agregadas.</h1><p>Esta vista no expone rondas ni contenido privado.</p></div><Link className="secondary" href="/">Volver</Link></section>{status && <section className="card" role="status">{status}</section>}{metrics && <><section className="provisionalGrid">{[["Usuarios", metrics.users], ["Activos", metrics.activeUsers], ["Rondas", metrics.rounds], ["Grupos", metrics.groups], ["Uso AI", metrics.events.filter((event) => event.name.includes("ai")).reduce((sum, event) => sum + event.count, 0)], ["Errores", metrics.errors.reduce((sum, error) => sum + error.count, 0)]].map(([label, value]) => <article className="stat" key={label}><span>{label}</span><b>{value}</b></article>)}</section><section className="card"><h2>Planes</h2><pre>{JSON.stringify(metrics.plans, null, 2)}</pre><h2>Uso de funciones</h2><pre>{JSON.stringify(metrics.events, null, 2)}</pre></section></>}</main>;
}
