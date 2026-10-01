"use client";
import { useCallback, useEffect, useState } from "react";
type User = { user_id: string; display_name: string; username: string | null; email: string | null; role: string; account_status: string; role_changed_at: string | null };
export function AdminAdministrators({ token, readOnly = false }: { token: string; readOnly?: boolean }) {
  const [query, setQuery] = useState(""); const [users, setUsers] = useState<User[]>([]); const [error, setError] = useState("");
  const [selection, setSelection] = useState<User | null>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`${readOnly ? "/api/admin/simple?module=users&q=" : "/api/admin/administrators?q="}${encodeURIComponent(query)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "No pudimos cargar los usuarios.");
    setUsers(body.items || []); setError("");
  }, [token, query, readOnly]);
  useEffect(() => { const timer = setTimeout(() => { void load().catch(e => setError(e.message)); }, 250); return () => clearTimeout(timer); }, [load]);
  async function save() {
    if (!selection || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/administrators", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ userId: selection.user_id, expectedRole: selection.role, role: selection.role === "PLAYER" ? "ADMIN" : "PLAYER", reason, operationId: crypto.randomUUID() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSelection(null); setReason(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se cambió el rol."); } finally { setBusy(false); }
  }
  return <section className="adminV2Stack"><label>Buscar por nombre, username{!readOnly && " o email"}<input type="search" value={query} maxLength={160} onChange={e => setQuery(e.target.value)} placeholder="Buscar usuario existente" /></label>
    {error && <p role="alert" className="notice bad">{error}</p>}
    {!users.length && !error && <p className="notice">No hay usuarios que coincidan con tu búsqueda.</p>}
    {users.map(user => <article className="card adminV2ListItem" key={user.user_id}><div><h3>{user.display_name}</h3><p>{user.username ? `@${user.username}` : "Sin username"}{user.email && ` · ${user.email}`}</p><small>{user.role} · {user.account_status}{user.role_changed_at && ` · Último cambio: ${new Date(user.role_changed_at).toLocaleDateString("es-MX")}`}</small></div>{!readOnly && user.role !== "SUPER_ADMIN" && user.account_status === "Activo" && <button className="secondary" onClick={() => { setSelection(user); setReason(""); }}> {user.role === "PLAYER" ? "Asignar administrador" : "Quitar administrador"}</button>}{user.role === "SUPER_ADMIN" && <span>Cuenta protegida</span>}</article>)}
    {selection && <section className="card adminV2Confirmation" aria-label="Confirmar cambio de rol"><h3>Confirmar cambio</h3><p>{selection.display_name}: {selection.role} → {selection.role === "PLAYER" ? "ADMIN" : "PLAYER"}</p><label>Motivo<input value={reason} minLength={3} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><p>El cambio quedará registrado en auditoría.</p><div className="adminV2Actions"><button className="secondary" disabled={busy} onClick={() => setSelection(null)}>Cancelar</button><button className="primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? "Guardando…" : "Confirmar cambio"}</button></div></section>}
  </section>;
}
