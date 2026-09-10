"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createFriendRequest,
  emptySocialGraph,
  normalizeUsernameSearch,
  removeFriend,
  type SocialGraph,
  type SocialProfile,
} from "../../features/social/domain";
import { createLocalSocialRepository } from "../../features/social/local-repository";

export function SocialConnectionsPanel({ ownerId, accessToken, directory }: {
  ownerId: string;
  accessToken?: string;
  directory: SocialProfile[];
}) {
  const repository = useMemo(() => typeof window === "undefined" ? null : createLocalSocialRepository(window.localStorage, directory), [directory]);
  const [graph, setGraph] = useState<SocialGraph>(() => emptySocialGraph(ownerId));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SocialProfile[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void repository?.loadGraph(ownerId).then((loaded) => { if (!cancelled) setGraph(loaded); });
    return () => { cancelled = true; };
  }, [ownerId, repository]);

  async function persist(next: SocialGraph) {
    setGraph(next);
    try { await repository?.saveGraph(next); }
    catch { setStatus("El cambio se ve aquí, pero el navegador no permitió guardarlo."); }
  }

  async function search() {
    const normalized = normalizeUsernameSearch(query);
    if (normalized.length < 2) { setStatus("Escribe al menos dos caracteres del usuario."); return; }
    setLoading(true); setStatus("");
    try {
      if (accessToken) {
        const response = await fetch(`/api/social/search?username=${encodeURIComponent(normalized)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        const body = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>>; error?: string } | null;
        if (response.ok && Array.isArray(body?.data)) {
          setResults(body.data.map((row) => ({
            userId: String(row.user_id || ""), username: String(row.username || ""), displayName: String(row.display_name || "Golfista"),
            avatar: typeof row.avatar_url === "string" ? row.avatar_url : null,
            handicap: typeof row.handicap === "number" ? row.handicap : null,
            clubName: typeof row.club_name === "string" ? row.club_name : null,
            privacy: (row.privacy === "FRIENDS" ? "FRIENDS" : "PRIVATE") as SocialProfile["privacy"],
          })).filter((profile) => profile.userId && profile.username));
          setLoading(false); return;
        }
        setStatus(body?.error || "La búsqueda cloud no está disponible; revisé tus jugadores vinculados.");
      }
      const local = await repository?.searchProfiles(normalized, ownerId, 20) ?? [];
      setResults(local);
    } finally { setLoading(false); }
  }

  function request(profile: SocialProfile) {
    const next = createFriendRequest(graph, {
      requesterId: ownerId,
      addresseeId: profile.userId,
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (next === graph) { setStatus("Ya existe una amistad o solicitud con este jugador."); return; }
    void persist(next); setStatus(`Solicitud preparada para @${profile.username}. Se sincronizará cuando el esquema Social esté disponible.`);
  }

  const friendIds = new Set(graph.friendships.flatMap((friendship) => friendship.userIds).filter((id) => id !== ownerId));
  const friends = directory.filter((profile) => friendIds.has(profile.userId));
  const pending = graph.requests.filter((request) => request.state === "PENDING" && request.requesterId === ownerId);

  return <section className="socialConnections" aria-label="Amigos de Backyard">
    <section className="card socialSearchCard"><div className="sectionTitle"><div><h2>Buscar amigos</h2><p>Busca por username. El correo nunca es público.</p></div></div>
      <div className="socialSearchRow"><label><span className="srOnly">Username</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="@usuario" autoComplete="off" /></label><button type="button" className="primary" disabled={loading} onClick={() => void search()}>{loading ? "Buscando…" : "Buscar"}</button></div>
      {status && <p className="hint" role="status">{status}</p>}
      {results.length > 0 && <ul className="socialProfileResults">{results.map((profile) => <li key={profile.userId}><span className="socialProfileAvatar">{profile.avatar || profile.displayName[0] || "G"}</span><span><b>{profile.displayName}</b><small>@{profile.username}{profile.clubName ? ` · ${profile.clubName}` : ""}</small></span><button type="button" className="secondary" onClick={() => request(profile)}>Agregar</button></li>)}</ul>}
    </section>

    <section className="card"><div className="sectionTitle"><div><h2>Amigos</h2><p>{friends.length ? "Jugadores conectados." : "Todavía no tienes amistades confirmadas."}</p></div><b>{friends.length}</b></div>
      {friends.length > 0 && <ul className="socialProfileResults">{friends.map((profile) => <li key={profile.userId}><span className="socialProfileAvatar">{profile.avatar || profile.displayName[0] || "G"}</span><span><b>{profile.displayName}</b><small>@{profile.username}</small></span><button type="button" className="dangerGhost" onClick={() => void persist(removeFriend(graph, ownerId, profile.userId))}>Eliminar</button></li>)}</ul>}
    </section>

    {pending.length > 0 && <section className="card"><h2>Solicitudes enviadas</h2><ul className="socialPendingList">{pending.map((request) => <li key={request.id}><span>{directory.find((profile) => profile.userId === request.addresseeId)?.username || "Usuario"}</span><b>Pendiente</b></li>)}</ul></section>}
  </section>;
}
