"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FrequentGroup, FrequentGroupMember } from "../../lib/types";
import { invitationStatus, normalizedInvitationEmail, parseGroupInvitationLink, type BackyardGroupUser, type GroupInvitation } from "../../lib/group-invitations";
import { useBackyardAccount } from "./account-provider";
import styles from "./group-invitations.module.css";

async function api(token: string, body?: Record<string, unknown>, signal?: AbortSignal, localGroupId?: string) {
  const response = await fetch(`/api/groups/invitations${localGroupId ? `?localGroupId=${encodeURIComponent(localGroupId)}` : ""}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(25_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No pudimos confirmar la invitación.");
  return data;
}

export function GroupInviteManager({ group, accessToken, onAcceptedMembers }: { group: FrequentGroup; accessToken?: string | null; onAcceptedMembers?: (members: FrequentGroupMember[]) => void }) {
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState<BackyardGroupUser[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const inFlight = useRef(false);
  const acceptedCallback = useRef(onAcceptedMembers);
  useEffect(() => { acceptedCallback.current = onAcceptedMembers; }, [onAcceptedMembers]);
  const reload = useCallback(async () => {
    if (!accessToken) return;
    const data = await api(accessToken, undefined, undefined, group.id);
    setInvitations((data.invitations || []).filter((item: GroupInvitation) => item.outgoing));
    if (data.acceptedMembers?.length) acceptedCallback.current?.(data.acceptedMembers);
  }, [accessToken, group.id]);
  useEffect(() => { void reload().catch(() => undefined); }, [reload]);
  useEffect(() => {
    setUsers([]);
    if (!accessToken || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/groups/users?q=${encodeURIComponent(query.trim())}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) { setUsers(data.users || []); setMessage(data.users?.length ? "" : "Sin coincidencias visibles. Puedes enviar una invitación por correo."); }
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No pudimos buscar usuarios."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, accessToken]);
  async function send(target: { email?: string; targetUserId?: string; invitationId?: string }) {
    if (!accessToken || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      let result;
      if (target.invitationId) result = await api(accessToken, { action: "retry", invitationId: target.invitationId });
      else {
        const ensured = await api(accessToken, { action: "ensure", group });
        result = await api(accessToken, { action: "create", groupId: ensured.groupId, ...target });
      }
      setMessage(result.alreadyMember ? "Esta cuenta ya es integrante del grupo." : result.deliveryStatus === "ACCEPTED_BY_PROVIDER"
        ? "El proveedor aceptó el correo. La recepción aún no está confirmada; la invitación está pendiente de aceptar."
        : "La invitación está pendiente. Revisa el estado del envío.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se confirmó el envío."); }
    finally { await reload().catch(() => undefined); inFlight.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Usuarios Backyard e invitaciones">
    <h3>Usuarios Backyard</h3><p>Busca nombre, @usuario o correo exacto. Solo aparecen identidades permitidas por su privacidad; no publicamos correos privados.</p>
    {!accessToken ? <p>Inicia sesión para buscar usuarios y enviar invitaciones.</p> : <>
      <label>Buscar usuarios<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, @usuario o correo exacto" autoComplete="off" /></label>
      {searching && <p role="status">Buscando…</p>}
      <ul className={styles.results}>{users.map(user => <li key={user.user_id}><span><b>{user.display_name}</b><small>@{user.username}{user.is_friend ? " · Amigo" : " · Usuario Backyard"}</small></span><button type="button" className="secondary" disabled={busy || !group.name.trim()} onClick={() => void send({ targetUserId: user.user_id })}>Invitar</button></li>)}</ul>
      <form onSubmit={event => { event.preventDefault(); const normalized = normalizedInvitationEmail(email); if (normalized) void send({ email: normalized }); }}>
        <label>Invitar por correo<input type="email" inputMode="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} placeholder="persona@correo.com" /></label>
        <button type="submit" className="secondary" disabled={busy || !normalizedInvitationEmail(email) || !group.name.trim()}>{busy ? "Procesando…" : "Enviar invitación"}</button>
      </form>
      <p>La persona se incorpora al grupo cuando acepta con su cuenta verificada. Invitación no equivale a integrante.</p>
      {invitations.length > 0 && <ul className={styles.results}>{invitations.map(invite => <li key={invite.id}><span><b>{invite.recipient_label}</b><small>{invitationStatus(invite)}</small></span>{invite.state === "PENDING" && ["FAILED", "NOT_SENT"].includes(invite.delivery_status) && <button type="button" className="secondary" disabled={busy} onClick={() => void send({ invitationId: invite.id })}>Reintentar</button>}</li>)}</ul>}
      <button type="button" className="textButton" disabled={busy} onClick={() => void reload().catch(error => setMessage(error.message))}>Actualizar invitaciones e integrantes</button>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}

export function GroupInvitationInbox({ accessToken, onAccepted }: { accessToken?: string | null; onAccepted?: () => void | Promise<void> }) {
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const pending = useRef(false);
  const reload = useCallback(async () => {
    if (!accessToken) return;
    const data = await api(accessToken); setInvitations(data.invitations || []); setLoadedAt(Date.now());
  }, [accessToken]);
  useEffect(() => { void reload().catch(error => setMessage(error.message)); }, [reload]);
  async function accept(invitationId: string) {
    if (!accessToken || pending.current) return;
    pending.current = true; setBusy(true);
    try { await api(accessToken, { action: "accept", invitationId }); await reload(); await onAccepted?.(); setMessage("Invitación aceptada. El grupo está guardado en tu cuenta."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos aceptar."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={styles.panel}><h2>Invitaciones</h2>{!accessToken ? <p>Inicia sesión para consultar tus invitaciones.</p> : <>
    {!invitations.length && <p>No hay invitaciones para esta cuenta.</p>}
    <ul className={styles.results}>{invitations.map(invite => <li key={invite.id}><span><b>{invite.group_name}</b><small>{invite.outgoing ? `Para ${invite.recipient_label} · ` : "Recibida · "}{invitationStatus(invite)}</small></span>{!invite.outgoing && invite.state === "PENDING" && Date.parse(invite.expires_at) > loadedAt && <button type="button" className="primary" disabled={busy} onClick={() => void accept(invite.id)}>Aceptar</button>}</li>)}</ul>
    <button type="button" className="textButton" disabled={busy} onClick={() => void reload().catch(error => setMessage(error.message))}>Actualizar invitaciones</button>
  </>}{message && <p role="status">{message}</p>}</section>;
}

const pendingKey = "backyard-pending-group-invitation-v1";
/** Outside the Auth gate: preserves a voluntary link across OAuth/onboarding. */
export function CaptureGroupInvitationLink() {
  useEffect(() => {
    const link = parseGroupInvitationLink(window.location.hash);
    if (!link) return;
    try { sessionStorage.setItem(pendingKey, JSON.stringify(link)); window.history.replaceState(null, "", window.location.pathname + window.location.search); }
    catch { /* Keep the original fragment if browser session storage is unavailable. */ }
  }, []);
  return null;
}
export function PendingGroupInvitation() {
  const { identity, retryCloudSync } = useBackyardAccount();
  const [link, setLink] = useState<{ invitationId: string; token: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  useEffect(() => { try { setLink(JSON.parse(sessionStorage.getItem(pendingKey) || "null") || parseGroupInvitationLink(window.location.hash)); } catch { setLink(parseGroupInvitationLink(window.location.hash)); } }, []);
  if (!link || identity.mode !== "authenticated") return null;
  return <aside className={styles.linkNotice} aria-label="Invitación de grupo"><h2>Te invitaron a un grupo</h2><p>Acepta únicamente si esperabas esta invitación. Debes usar el mismo correo al que se envió.</p>
    <button type="button" className="primary" disabled={busy} onClick={async () => {
      if (!identity.accessToken || pending.current) return; pending.current = true; setBusy(true);
      try { await api(identity.accessToken, { action: "accept", ...link }); sessionStorage.removeItem(pendingKey); await retryCloudSync(); setLink(null); }
      catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos aceptar."); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? "Aceptando…" : "Aceptar invitación"}</button>
    <button type="button" className="textButton" disabled={busy} onClick={() => { sessionStorage.removeItem(pendingKey); setLink(null); }}>Ahora no</button>
    {message && <p role="alert">{message}</p>}
  </aside>;
}
