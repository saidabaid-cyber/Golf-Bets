"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialProfile } from "../../features/social/domain";
import { connectionState, type ConnectionPage, type SocialPerson } from "../../lib/social-connections";
import { filterCurrentFriends, rankFriendResults } from "../../lib/friends-discovery";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { PersonalQr, SocialQrScanner } from "./social-qr";
import { useViewScrollReset } from "./use-view-scroll-reset";
import styles from "./friends-hub.module.css";
export type FriendsView = "list" | "add" | "search" | "nearby" | "requests" | "qr" | "scan";
type Person = SocialPerson & { club_name?: string | null };
type Nearby = Person & { area_label: string };
type Props = { ownerId: string; accessToken?: string; directory?: SocialProfile[]; targetId?: string | null; onCloseTarget?: () => void; onChanged?: () => void; initialView?: FriendsView; name?: string; username?: string; avatar?: string; embedded?: boolean; onViewChange?: (view:FriendsView)=>void };
const EMPTY: ConnectionPage = { people: [], requests: [], friends: [], blocked: [] };
function FriendRequestList({ requests, people, ownerId, sameClubIds, busy, onProfile, onAction }: {
  requests: ConnectionPage["requests"]; people: Person[]; ownerId: string; sameClubIds: Set<string>; busy: boolean;
  onProfile: (person: Person) => Promise<void>; onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  return <ul className={styles.requests}>{requests.map(request => {
    const received = request.addressee_id === ownerId;
    const person = people.find(p => p.user_id === (received ? request.requester_id : request.addressee_id));
    return <li key={request.id}>{person ? <button type="button" className={styles.person} onClick={() => void onProfile(person)}>
      <span className={styles.avatar}><ProfileAvatarMedia value={person.avatar_url} fallback={person.display_name[0] || "J"} /></span>
      <span className={styles.identity}><b>{person.display_name}</b><small>@{person.username}</small>{sameClubIds.has(person.user_id) && <small className={styles.club}>Mismo club</small>}</span>
    </button> : <p>Jugador no disponible</p>}<div className={styles.actions}>{received ? <>
      <button className={styles.primary} type="button" disabled={busy} onClick={() => void onAction({ action: "ACCEPTED", id: request.id })}>Aceptar</button>
      <button className={styles.secondary} type="button" disabled={busy} onClick={() => void onAction({ action: "REJECTED", id: request.id })}>Rechazar</button>
    </> : <><span className={styles.state}>Pendiente</span><button className={styles.secondary} type="button" disabled={busy} onClick={() => void onAction({ action: "CANCELLED", id: request.id })}>Cancelar solicitud</button></>}</div></li>;
  })}</ul>;
}
export function FriendsHub({ ownerId, accessToken, targetId, onCloseTarget, onChanged, initialView = "list", name = "Jugador", username = "", avatar = "", embedded=false, onViewChange }: Props) {
  const [data, setData] = useState<ConnectionPage>(EMPTY), [view, setView] = useState<FriendsView>(initialView);
  const [query, setQuery] = useState(""), [friendQuery, setFriendQuery] = useState(""), [results, setResults] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null), [sent, setSent] = useState<Person | null>(null);
  const [nearby, setNearby] = useState<Nearby[]>([]), [nearbyLabel, setNearbyLabel] = useState(""), [nearbyBusy, setNearbyBusy] = useState(true);
  const [message, setMessage] = useState(""), [loading, setLoading] = useState(true), [searching, setSearching] = useState(false), [busy, setBusy] = useState(false);
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useViewScrollReset(`${view}:${selected?.user_id ?? ""}:${sent?.user_id ?? ""}`);
  const refresh = useCallback(async () => { if (accessToken) { const next = await socialRequest<ConnectionPage>("/api/social/connections", accessToken); if (alive.current) setData(next); } }, [accessToken]);
  useEffect(() => {
    const controller = new AbortController();
    if (!accessToken) return;
    void socialRequest<ConnectionPage>("/api/social/connections", accessToken, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) setData(next); }).catch(e => { if (!controller.signal.aborted) setMessage(socialErrorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    // Independent, public coarse discovery supplies the same-club ranking signal.
    void socialRequest<{ users: Nearby[]; label: string }>("/api/social/connections?discovery=nearby", accessToken, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) { setNearby(next.users); setNearbyLabel(next.label); } }).catch(() => { if (!controller.signal.aborted) setNearbyLabel("No pudimos consultar tu club. Puedes buscar jugadores por nombre o @usuario."); }).finally(() => { if (!controller.signal.aborted) setNearbyBusy(false); });
    return () => controller.abort();
  }, [accessToken]);
  useEffect(() => {
    const controller = new AbortController();
    if (targetId && accessToken) void socialRequest<{ person: Person }>(`/api/social/connections?target=${encodeURIComponent(targetId)}`, accessToken, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) { setSelected(next.person); setMessage(""); } }).catch(e => { if (!controller.signal.aborted) setMessage(socialErrorMessage(e)); });
    return () => controller.abort();
  }, [targetId, accessToken]);
  useEffect(() => {
    setResults([]); setSearching(false);
    if (!accessToken || (view !== "search" && !(embedded && view === "add")) || query.trim().length < 2) return;
    const controller = new AbortController(); setSearching(true);
    const timer = setTimeout(() => { void socialRequest<{ users: Person[] }>(`/api/groups/users?q=${encodeURIComponent(query.trim())}`, accessToken, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) setResults(next.users); }).catch(e => { if (!controller.signal.aborted) setMessage(socialErrorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setSearching(false); }); }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accessToken, query, view, embedded]);
  async function action(body: Record<string, unknown>, requested?: Person) {
    if (!accessToken || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const next = await socialRequest<ConnectionPage>("/api/social/connections", accessToken, { method: "POST", body: { ...body, operationId: crypto.randomUUID() } });
      if (!alive.current) return;
      setData(next); onChanged?.(); if(typeof window!=="undefined")window.dispatchEvent(new Event("backyard:notifications-changed"));
      if (requested && connectionState(next, ownerId, requested.user_id) === "PENDING") { setSent(requested); setSelected(null); }
      else setMessage("Cambio guardado.");
    } catch (e) { if (alive.current) setMessage(socialErrorMessage(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const sameClubIds = new Set(nearby.map(person => person.user_id));
  const ranked = rankFriendResults(results, query, sameClubIds, ownerId, data.blocked);
  const friends = data.friends.flatMap(id => { const person = data.people.find(item => item.user_id === id); return person ? [person] : []; });
  const pending = data.requests.filter(request => request.state === "PENDING");
  const label = (person: Person) => <><span className={styles.avatar}><ProfileAvatarMedia value={person.avatar_url} fallback={person.display_name[0] || "J"} /></span><span className={styles.identity}><b>{person.display_name}</b><small>@{person.username}</small>{sameClubIds.has(person.user_id) && <small className={styles.club}>Mismo club</small>}</span></>;
  function open(next: FriendsView) { setSelected(null); setSent(null); setMessage(""); onCloseTarget?.(); setView(next); onViewChange?.(next); }
  const showProfile = useCallback(async (person: Person) => {
    setSelected(person); setMessage("");
    try { const next = await socialRequest<{ person: Person }>(`/api/social/connections?target=${encodeURIComponent(person.user_id)}`, accessToken!); if (alive.current) setSelected(current => current?.user_id === person.user_id ? next.person : current); }
    catch (e) { if (alive.current) setMessage(socialErrorMessage(e)); }
  }, [accessToken]);
  function relationship(person: Person) {
    const state = connectionState(data, ownerId, person.user_id);
    const request = pending.find(item => item.requester_id === person.user_id || item.addressee_id === person.user_id);
    if (state === "NONE") return <button type="button" className={styles.primary} disabled={busy || loading} onClick={() => void action({action:"request",target:person.user_id}, person)}>Agregar amigo</button>;
    if (state === "INCOMING" && request) return <><p>Solicitud recibida</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => void action({ action: "ACCEPTED", id: request.id })}>Aceptar</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void action({ action: "REJECTED", id: request.id })}>Rechazar</button></div></>;
    return <p className={styles.state}>{state === "FRIEND" ? "Amigos ✓" : state === "PENDING" ? "Solicitud enviada" : state === "SELF" ? "Este es tu perfil." : "Conexión bloqueada."}</p>;
  }
  const rows = (people: Person[], actions = false) => <ul className={styles.list}>{people.map(person => <li key={person.user_id}><button type="button" className={styles.person} onClick={() => void showProfile(person)} aria-label={`Ver perfil de ${person.display_name}`}>{label(person)}<span aria-hidden="true">›</span></button>{actions && <button type="button" className={styles.smallAction} disabled={busy || loading || connectionState(data, ownerId, person.user_id) !== "NONE"} onClick={() => void action({action:"request",target:person.user_id}, person)}>{connectionState(data, ownerId, person.user_id) === "FRIEND" ? "Amigos ✓" : connectionState(data, ownerId, person.user_id) === "INCOMING" ? "Recibida" : connectionState(data, ownerId, person.user_id) === "PENDING" ? "Enviada" : "Agregar"}</button>}</li>)}</ul>;
  if (!accessToken) return <section className={styles.screen}><h2>Mis amigos</h2><p>Inicia sesión para buscar y enviar solicitudes.</p></section>;
  const incoming=pending.filter(request=>request.addressee_id===ownerId), outgoing=pending.filter(request=>request.requester_id===ownerId);
  const suggestions=rankFriendResults(nearby,"",sameClubIds,ownerId,data.blocked).filter(person=>connectionState(data,ownerId,person.user_id)==="NONE");
  if(embedded && !selected && !sent && !["qr","scan"].includes(view)) return <section className={styles.screen} aria-label={view==="list"||view==="requests"?"Mis amigos":"Agregar amigos"}>
    {message&&<p className={styles.notice} role="status">{message}</p>}
    {view==="list"||view==="requests"?<>
      <label className={styles.search}><span><input type="search" aria-label="Buscar entre mis amigos" placeholder="Buscar entre mis amigos" value={friendQuery} onChange={e=>setFriendQuery(e.target.value)} /></span></label>
      <div className={styles.counts}><span><b>{data.friends.length}</b> amigos</span><span><b>{incoming.length}</b> solicitudes</span>{nearby.length>0&&<span><b>{nearby.length}</b> mismo club</span>}</div>
      {incoming.length>0&&<section className={styles.panel}><h3>Solicitudes ({incoming.length})</h3><FriendRequestList requests={incoming} people={data.people} ownerId={ownerId} sameClubIds={sameClubIds} busy={busy} onProfile={showProfile} onAction={action} /></section>}
      <section className={styles.panel}><h3>Mis amigos ({friends.length})</h3>{loading?<p role="status">Cargando amigos…</p>:friends.length?rows(filterCurrentFriends(friends,friendQuery)):<div className={styles.empty}><h3>Conecta con golfistas</h3><p>Encuentra compañeros para tu próxima ronda.</p><button type="button" className={styles.primary} onClick={()=>open("add")}>Buscar amigos</button></div>}</section>
      {suggestions.length>0&&<section className={`${styles.panel} ${styles.coarse}`}><h3>Cerca de ti</h3><p className={styles.caption}>Golfistas de tu mismo club.</p>{rows(suggestions.slice(0,4),true)}</section>}
    </>:<>
      <label className={styles.search}>Buscar jugador<span><input type="search" placeholder="Nombre, @usuario o correo exacto" value={query} onChange={e=>setQuery(e.target.value)} /></span></label>
      {query.trim().length>=2&&(searching?<p role="status">Buscando jugadores…</p>:ranked.length?rows(ranked,true):<p>No encontramos jugadores para esta búsqueda.</p>)}
      <nav className={styles.qrOptions} aria-label="Agregar con QR"><button type="button" onClick={()=>open("scan")}><span aria-hidden="true">▦</span><b>Escanear QR</b><small>Cámara o galería</small></button><button type="button" onClick={()=>open("qr")}><span aria-hidden="true">▦</span><b>Mi QR</b><small>Comparte tu perfil</small></button></nav>
      <section className={styles.panel}><h3>Sugeridos para ti</h3>{nearbyBusy?<p role="status">Consultando tu comunidad…</p>:suggestions.length?rows(suggestions.slice(0,6),true):<p className={styles.caption}>{nearbyLabel||"Encuentra jugadores por nombre o @usuario."}</p>}</section>
      {suggestions.length>0&&<section className={`${styles.panel} ${styles.coarse}`}><h3>Cerca de ti</h3><p className={styles.caption}>Mismo club · sin ubicación exacta.</p>{rows(suggestions.slice(0,2),true)}</section>}
      <section className={styles.panel}><h3>Solicitudes enviadas</h3>{outgoing.length?<FriendRequestList requests={outgoing} people={data.people} ownerId={ownerId} sameClubIds={sameClubIds} busy={busy} onProfile={showProfile} onAction={action} />:<p className={styles.caption}>Tus solicitudes pendientes aparecerán aquí.</p>}</section>
    </>}
  </section>;
  return <section className={styles.screen} aria-label="Amigos de Inicio">
    {message && <p className={styles.notice} role="status">{message}</p>}
    {sent ? <section className={styles.confirmation}><span className={styles.check} aria-hidden="true">✓</span><h2>¡Solicitud enviada!</h2><p>{sent.display_name} recibirá una notificación y podrá aceptarla.</p><button type="button" className={styles.primary} onClick={() => open("search")}>Buscar más amigos</button><button type="button" className={styles.secondary} onClick={() => { const person = sent; setSent(null); void showProfile(person); }}>Ver perfil</button></section> : selected ? <>
      <button type="button" className={styles.back} onClick={() => { setSelected(null); onCloseTarget?.(); }}>← Amigos</button>
      <section className={styles.profile} aria-label="Perfil del jugador"><span className={styles.profileAvatar}><ProfileAvatarMedia value={selected.avatar_url} fallback={selected.display_name[0] || "J"} /></span><h2>{selected.display_name}</h2><p>@{selected.username}</p>{selected.club_name && <p className={styles.profileClub}>{selected.club_name}</p>}{sameClubIds.has(selected.user_id) && <p className={styles.club}>Mismo club</p>}{relationship(selected)}{connectionState(data, ownerId, selected.user_id) === "PENDING" && <button type="button" className={styles.secondary} disabled={busy} onClick={() => { const request = pending.find(item => item.addressee_id === selected.user_id); if (request) void action({ action: "CANCELLED", id: request.id }); }}>Cancelar solicitud</button>}{connectionState(data, ownerId, selected.user_id) === "FRIEND" && <details className={styles.sensitive}><summary>Administrar conexión</summary><button type="button" disabled={busy} onClick={() => { if (confirm("¿Bloquear esta conexión? Se revocará la amistad y el acceso social entre ambos.")) void action({ action: "block", target: selected.user_id }); }}>Bloquear</button></details>}</section>
    </> : view === "qr" ? <PersonalQr userId={ownerId} name={name} username={username} avatar={avatar} backLabel="Amigos" onClose={() => open("add")} /> : view === "scan" ? <SocialQrScanner backLabel="Amigos" onFound={id => { void socialRequest<{ person: Person }>(`/api/social/connections?target=${encodeURIComponent(id)}`, accessToken).then(next => { if (alive.current) { setView("add"); setSelected(next.person); } }).catch(e => { if (alive.current) setMessage(socialErrorMessage(e)); }); }} onClose={() => open("add")} /> : <>
      {view !== "list" && <button type="button" className={styles.back} onClick={() => open(view === "add" || view === "requests" ? "list" : "add")}>← {view === "add" || view === "requests" ? "Mis amigos" : "Agregar amigos"}</button>}
      <header className={styles.heading}><span>TU COMUNIDAD</span><h2>{view === "list" ? "Mis amigos" : view === "add" ? "Agregar amigos" : view === "search" ? "Buscar jugadores" : view === "nearby" ? "Jugadores cerca de ti" : "Solicitudes pendientes"}</h2><p>{view === "list" ? "Conecta con golfistas, encuentra nuevos compañeros de juego y haz crecer tu red en The Backyard." : view === "add" ? "Encuentra golfistas de diferentes formas y amplía tu red." : view === "nearby" ? "Golfistas de tu mismo club. No compartimos ubicación exacta." : view === "search" ? "Encuentra jugadores por nombre, @usuario o correo exacto." : "Administra las invitaciones a tu red de amigos."}</p></header>
      {view === "list" && <><button type="button" className={styles.primary} onClick={() => open("add")}>＋ Agregar amigos</button><button type="button" className={styles.requestLink} onClick={() => open("requests")}>Solicitudes pendientes <b>{pending.length}</b><span aria-hidden="true">›</span></button><label className={styles.search}>Buscar en mis amigos<input type="search" value={friendQuery} onChange={event => setFriendQuery(event.target.value)} placeholder="Buscar en mis amigos…" /></label><h3 className={styles.sectionTitle}>Mis amigos · {data.friends.length}</h3>{loading ? <p role="status">Cargando amigos…</p> : !friends.length ? <section className={styles.empty}><span aria-hidden="true">♧</span><h3>Conecta con golfistas</h3><p>Encuentra y agrega amigos para jugar más golf juntos.</p><button type="button" className={styles.primary} onClick={() => open("search")}>Buscar amigos</button></section> : <>{rows(filterCurrentFriends(friends, friendQuery))}{!filterCurrentFriends(friends, friendQuery).length && <p>No hay amigos que coincidan con tu búsqueda.</p>}</>}<button type="button" className={styles.back} disabled={busy} onClick={() => void refresh().catch(e => setMessage(socialErrorMessage(e)))}>Actualizar amigos</button></>}
      {view === "add" && <nav className={styles.options} aria-label="Formas de agregar amigos">{([['search', '⌕', 'Buscar jugadores', 'Nombre, @usuario o correo exacto'], ['nearby', '⚑', 'Cerca de ti', 'Encuentra golfistas de tu mismo club'], ['scan', '▦', 'Escanear QR', 'Abre un perfil desde cámara o galería'], ['qr', '↗', 'Compartir mi QR', 'Comparte tu perfil para que te encuentren']] as const).map(([next, icon, title, copy]) => <button key={next} type="button" onClick={() => open(next)}><span className={styles.optionIcon} aria-hidden="true">{icon}</span><span><b>{title}</b><small>{copy}</small></span><span aria-hidden="true">›</span></button>)}</nav>}
      {view === "search" && <><label className={styles.search}>Nombre, @usuario o correo exacto<span><input type="search" placeholder="Buscar jugadores Backyard" value={query} onChange={event => { setQuery(event.target.value); setMessage(""); }} />{query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}>×</button>}</span></label><p className={styles.caption}>Los correos no se muestran. La búsqueda respeta privacidad y bloqueos.</p>{searching ? <p role="status">Buscando jugadores…</p> : query.trim().length < 2 ? <p className={styles.caption}>Escribe al menos dos caracteres.</p> : !ranked.length ? <p role="status">No encontramos jugadores para esta búsqueda.</p> : rows(ranked, true)}</>}
      {view === "nearby" && <>{nearbyBusy ? <p role="status">Buscando golfistas de tu club…</p> : <><p className={styles.caption} role="status">{nearbyLabel}</p>{rows(rankFriendResults(nearby, "", sameClubIds, ownerId, data.blocked), true)}{!nearby.length && <section className={styles.empty}><h3>Tu comunidad sigue creciendo</h3><p>También puedes encontrar jugadores por nombre o @usuario.</p><button type="button" className={styles.primary} onClick={() => open("search")}>Buscar jugadores</button></section>}</>}</>}
      {view === "requests" && <>{loading ? <p role="status">Cargando solicitudes…</p> : !pending.length ? <section className={styles.empty}><p>No hay solicitudes pendientes.</p><button type="button" className={styles.primary} onClick={() => open("search")}>Buscar jugadores</button></section> : <ul className={styles.requests}>{pending.map(request => { const incoming = request.addressee_id === ownerId, person = data.people.find(item => item.user_id === (incoming ? request.requester_id : request.addressee_id)); return <li key={request.id}>{person ? <button type="button" className={styles.person} onClick={() => void showProfile(person)}>{label(person)}</button> : <p>Usuario no disponible</p>}<p className={styles.caption}>{incoming ? "Te envió una solicitud" : "Solicitud enviada"}</p><div className={styles.actions}>{incoming ? <><button type="button" className={styles.primary} disabled={busy} onClick={() => void action({ action: "ACCEPTED", id: request.id })}>Aceptar</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void action({ action: "REJECTED", id: request.id })}>Rechazar</button></> : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void action({ action: "CANCELLED", id: request.id })}>Cancelar solicitud</button>}</div></li>; })}</ul>}</>}
    </>}
  </section>;
}
// Compatibility export: there is one implementation and one graph source.
export const SocialConnectionsPanel = FriendsHub;
