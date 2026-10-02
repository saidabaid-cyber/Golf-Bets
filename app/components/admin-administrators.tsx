"use client";
import { useCallback, useEffect, useState } from "react";
const roleLabel=(role:string)=>({PLAYER:"Jugador",ADMIN:"Administrador",SUPER_ADMIN:"Superadministrador"}[role]||role);
type User = { user_id: string; display_name: string; username: string | null; email: string | null; role: string; account_status: string; role_changed_at: string | null };
export function AdminAdministrators({ token, readOnly = false }: { token: string; readOnly?: boolean }) {
  const [query, setQuery] = useState(""); const [users, setUsers] = useState<User[]>([]); const [error, setError] = useState("");
  const [selection, setSelection] = useState<User | null>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const [offset,setOffset]=useState(0);const [detail,setDetail]=useState<User|null>(null),[message,setMessage]=useState("");
  const load = useCallback(async () => {
    const response = await fetch(`${readOnly ? "/api/admin/simple?module=users&q=" : "/api/admin/administrators?q="}${encodeURIComponent(query)}&offset=${offset}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "No pudimos cargar los usuarios.");
    setUsers(body.items || []); setError("");
  }, [token, query, readOnly,offset]);
  useEffect(() => { const timer = setTimeout(() => { void load().catch(e => setError(e.message)); }, 250); return () => clearTimeout(timer); }, [load]);
  async function save() {
    if (!selection || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/administrators", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ userId: selection.user_id, expectedRole: selection.role, role: selection.role === "PLAYER" ? "ADMIN" : "PLAYER", reason, operationId: crypto.randomUUID() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSelection(null); setReason("");setMessage("Permisos guardados"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se cambió el rol."); } finally { setBusy(false); }
  }
  return <section className="adminV2Stack"><label>Buscar por nombre, username{!readOnly && " o email"}<input type="search" value={query} maxLength={160} onChange={e => {setQuery(e.target.value);setOffset(0);}} placeholder="Buscar usuario…" /></label>
    {message&&<p className="adminV2Feedback" role="status">{message}</p>}{error && <p role="alert" className="notice bad">{error}</p>}
    {!users.length && !error && <p className="notice">No hay usuarios que coincidan con tu búsqueda.</p>}
    {users.map(user => <article className="card adminV2ListItem" key={user.user_id}><div><h3>{user.display_name}</h3><p>{user.username ? `@${user.username}` : "Sin username"}{user.email && ` · ${user.email}`}</p><small>{roleLabel(user.role)} · {user.account_status}{user.role_changed_at && ` · Último cambio: ${new Date(user.role_changed_at).toLocaleDateString("es-MX")}`}</small></div><button className="secondary" onClick={()=>setDetail(user)}>Ver ›</button>{!readOnly && user.role !== "SUPER_ADMIN" && user.account_status === "Activo" && <button className="secondary" onClick={() => { setSelection(user); setReason(""); }}> {user.role === "PLAYER" ? "Asignar ADMIN" : "Revocar ADMIN"}</button>}{user.role === "SUPER_ADMIN" && <span>Cuenta protegida</span>}</article>)}
    <div className="adminV2Actions"><button className="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-40))}>Anterior</button><button className="secondary" disabled={users.length<40} onClick={()=>setOffset(offset+40)}>Siguiente</button></div>
    {detail&&<section className="card adminV2Confirmation"><h3>{detail.display_name}</h3><p>{detail.username?("@"+detail.username):"Sin username"}</p>{detail.email&&<p>{detail.email}</p>}<p>{roleLabel(detail.role)} · {detail.account_status}</p><button className="secondary" onClick={()=>setDetail(null)}>Cerrar detalle</button></section>}
    {selection && <section className="card adminV2Confirmation" aria-label="Confirmar cambio de rol"><h3>Confirmar cambio</h3><p>{selection.display_name}: {selection.role} → {selection.role === "PLAYER" ? "ADMIN" : "PLAYER"}</p><label>Motivo<input value={reason} minLength={3} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><p>El cambio quedará registrado en auditoría.</p><div className="adminV2Actions"><button className="secondary" disabled={busy} onClick={() => setSelection(null)}>Cancelar</button><button className="primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? "Guardando…" : "Confirmar cambio"}</button></div></section>}
  </section>;
}
