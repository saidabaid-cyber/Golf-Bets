"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "../../lib/supabase/client";

type Dashboard = {
  metrics: { users: { total: number; new7d: number; dau: number; wau: number; mau: number; retention7d: number; retention30d: number }; rounds: { total: number; completed: number; incomplete: number; averagePerUser: number }; ai: { questions30d: number; errors30d: number }; errors: { total24h: number; total7d: number }; sessions: { count: number; averageMinutes: number }; betFrequency: Record<string, number> };
  users: Array<{ id: string; email: string; displayName: string; provider: string; role: string; createdAt: string; lastLoginAt: string | null; lastSeenAt: string | null; profileComplete: boolean; handicap: number | null; rounds: number; completedRounds: number; groups: number; savedPlayers: number; consents: Array<{ type: string; version: string; acceptedAt: string }> }>;
  rounds: Array<{ roundId: string; userId: string; course: string; date: string; players: number; status: string; bets: string[]; lastSync: string | null }>;
  errors: Array<{ id: string; created_at: string; error_type: string; error_code?: string | null; message_sanitized: string; route?: string }>;
};

export default function AdminPage() {
  const [data, setData] = useState<Dashboard | null>(null); const [error, setError] = useState(""); const [token, setToken] = useState(""); const [selectedUser, setSelectedUser] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = getSupabaseBrowser(); const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (!session) { if (active) setError("Inicia sesión con una cuenta administradora."); return; }
      setToken(session.access_token);
      const response = await fetch("/api/admin/dashboard", { headers: { authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) setError(body.error || "No fue posible abrir la administración."); else setData(body);
    })().catch(() => { if (active) setError("No fue posible abrir la administración."); });
    return () => { active = false; };
  }, []);
  async function download(name: string) {
    const response = await fetch(`/api/admin/export/${name}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) { setError((await response.json().catch(() => ({}))).error || "No fue posible exportar."); return; }
    const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `backyard-${name}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  const user = data?.users.find(item => item.id === selectedUser);
  return <main className="adminShell">
    <header className="adminHeader"><div><span>THE BACKYARD</span><h1>Administración</h1><p>Analítica operativa, monitoreo y exportaciones de solo lectura.</p></div><Link href="/">Volver a la app</Link></header>
    {error && <div className="adminError" role="alert">{error}</div>}
    {!data && !error && <div className="adminLoading">Cargando métricas…</div>}
    {data && <>
      <section className="adminMetrics" aria-label="Indicadores">
        <article><span>Usuarios</span><b>{data.metrics.users.total}</b><small>+{data.metrics.users.new7d} en 7 días</small></article>
        <article><span>DAU / WAU / MAU</span><b>{data.metrics.users.dau} / {data.metrics.users.wau} / {data.metrics.users.mau}</b><small>Actividad por last_seen</small></article>
        <article><span>Retención 7d / 30d</span><b>{(data.metrics.users.retention7d*100).toFixed(0)}% / {(data.metrics.users.retention30d*100).toFixed(0)}%</b><small>Cohortes con antigüedad suficiente</small></article>
        <article><span>Rondas</span><b>{data.metrics.rounds.completed} completas</b><small>{data.metrics.rounds.incomplete} incompletas</small></article>
        <article><span>Sesiones</span><b>{data.metrics.sessions.count}</b><small>{data.metrics.sessions.averageMinutes.toFixed(1)} min promedio</small></article>
        <article><span>Preguntas IA · 30d</span><b>{data.metrics.ai.questions30d}</b><small>{data.metrics.ai.errors30d} errores</small></article>
        <article><span>Errores</span><b>{data.metrics.errors.total24h} · 24h</b><small>{data.metrics.errors.total7d} en 7 días</small></article>
      </section>
      <section className="adminCard"><header><div><h2>Exportaciones</h2><p>CSV protegido; no incluye secretos, tokens ni fotografías.</p></div><div className="adminActions">{["users", "rounds", "analytics", "errors"].map(name => <button key={name} onClick={() => download(name)}>CSV {name}</button>)}</div></header></section>
      <section className="adminCard"><header><div><h2>Usuarios</h2><p>Cuenta, actividad, perfil y rondas.</p></div></header><div className="adminTableWrap"><table><thead><tr><th>Usuario</th><th>Proveedor</th><th>Registro</th><th>Última actividad</th><th>Rondas</th></tr></thead><tbody>{data.users.map(item => <tr key={item.id} onClick={() => setSelectedUser(item.id)} tabIndex={0}><td><b>{item.displayName}</b><small>{item.email}</small></td><td>{item.provider}</td><td>{new Date(item.createdAt).toLocaleDateString("es-MX")}</td><td>{item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString("es-MX") : "Sin actividad"}</td><td>{item.completedRounds}/{item.rounds}</td></tr>)}</tbody></table></div>{user && <div className="adminDetail"><button aria-label="Cerrar detalle" onClick={() => setSelectedUser("")}>×</button><h3>{user.displayName}</h3><p>{user.email}</p><dl><dt>Rol</dt><dd>{user.role}</dd><dt>Perfil completo</dt><dd>{user.profileComplete ? "Sí" : "No"}</dd><dt>HCP</dt><dd>{user.handicap ?? "Sin capturar"}</dd><dt>Último acceso</dt><dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("es-MX") : "Sin registro"}</dd><dt>Rondas</dt><dd>{user.completedRounds} completas de {user.rounds}</dd><dt>Jugadores</dt><dd>{user.savedPlayers}</dd><dt>Grupos</dt><dd>{user.groups}</dd><dt>Consentimientos</dt><dd>{user.consents.length ? user.consents.map(item => `${item.type} · ${item.version}`).join(", ") : "Sin registro"}</dd></dl></div>}</section>
      <section className="adminCard"><header><div><h2>Rondas</h2><p>Inventario de solo lectura; no expone cálculos ni permite editar.</p></div></header><div className="adminTableWrap"><table><thead><tr><th>ID</th><th>Usuario</th><th>Campo</th><th>Fecha</th><th>Jugadores</th><th>Estado</th><th>Apuestas</th><th>Último sync</th></tr></thead><tbody>{data.rounds.map(round => <tr key={`${round.userId}:${round.roundId}`}><td><code>{round.roundId.slice(0, 12)}</code></td><td><code>{round.userId.slice(0, 12)}</code></td><td>{round.course}</td><td>{round.date}</td><td>{round.players}</td><td>{round.status}</td><td>{round.bets.join(", ") || "Ninguna"}</td><td>{round.lastSync ? new Date(round.lastSync).toLocaleString("es-MX") : "—"}</td></tr>)}</tbody></table></div></section>
      <section className="adminGrid"><section className="adminCard"><header><div><h2>Apuestas habilitadas</h2><p>Frecuencia de activación, sin montos.</p></div></header><div className="adminFrequency">{Object.entries(data.metrics.betFrequency).sort((a,b)=>b[1]-a[1]).map(([name,count]) => <div key={name}><span>{name}</span><b>{count}</b></div>)}</div></section><section className="adminCard"><header><div><h2>Errores recientes</h2><p>Mensajes sanitizados.</p></div></header><div className="adminErrors">{data.errors.slice(0, 50).map(item => <article key={item.id}><b>{item.error_type}</b><span>{new Date(item.created_at).toLocaleString("es-MX")}</span><p>{item.message_sanitized}</p><small>{item.route || "/"} {item.error_code ? `· ${item.error_code}` : ""}</small></article>)}</div></section></section>
    </>}
  </main>;
}
