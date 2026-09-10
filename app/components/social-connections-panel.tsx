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
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";
import { ProfileAvatarMedia } from "./profile-avatar-media";

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

  async function search(searchValue = query, signal?: AbortSignal) {
    const normalized = normalizeUsernameSearch(searchValue);
    if (normalized.length < 2) { setResults([]); setStatus(""); return; }
    setLoading(true); setStatus("");
    try {
      if (accessToken) {
        const response = await fetch(`/api/social/search?username=${encodeURIComponent(normalized)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal });
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
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("No pudimos completar la búsqueda. Intenta de nuevo.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const normalized = normalizeUsernameSearch(query);
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void search(query, controller.signal); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // Search dependencies intentionally describe the directory/provider boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, ownerId, query, repository]);

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
    setResults((current) => current.filter((candidate) => candidate.userId !== profile.userId));
  }

  const friendIds = new Set(graph.friendships.flatMap((friendship) => friendship.userIds).filter((id) => id !== ownerId));
  const friends = directory.filter((profile) => friendIds.has(profile.userId));
  const pending = graph.requests.filter((request) => request.state === "PENDING" && request.requesterId === ownerId);

  return <section className="socialConnections" aria-label="Amigos de Backyard">
    <section className="card socialSearchCard"><div className="sectionTitle"><div><h2>Buscar amigos</h2><p>Busca por username. El correo nunca es público.</p></div></div>
      <AnchoredSearch label="Username" value={query} onChange={(value) => { setQuery(value); if (normalizeUsernameSearch(value).length < 2) { setResults([]); setLoading(false); } }} placeholder="@usuario" expanded={results.length > 0} status={loading ? "Buscando…" : query.trim().length > 0 && normalizeUsernameSearch(query).length < 2 ? "Escribe al menos dos caracteres." : undefined}>
        {results.map((profile) => <AnchoredSearchOption key={profile.userId} label={`Agregar a @${profile.username}`} onSelect={() => request(profile)}><span className="socialSearchOption"><span className="socialProfileAvatar"><ProfileAvatarMedia value={profile.avatar} fallback={profile.displayName[0] || "G"} /></span><span><b>{profile.displayName}</b><small>@{profile.username}{profile.clubName ? ` · ${profile.clubName}` : ""}</small></span><strong>Agregar</strong></span></AnchoredSearchOption>)}
      </AnchoredSearch>
      {status && <p className="hint" role="status">{status}</p>}
    </section>

    <section className="card"><div className="sectionTitle"><div><h2>Amigos</h2><p>{friends.length ? "Jugadores conectados." : "Todavía no tienes amistades confirmadas."}</p></div><b>{friends.length}</b></div>
      {friends.length > 0 && <ul className="socialProfileResults">{friends.map((profile) => <li key={profile.userId}><span className="socialProfileAvatar"><ProfileAvatarMedia value={profile.avatar} fallback={profile.displayName[0] || "G"} /></span><span><b>{profile.displayName}</b><small>@{profile.username}</small></span><button type="button" className="dangerGhost" onClick={() => void persist(removeFriend(graph, ownerId, profile.userId))}>Eliminar</button></li>)}</ul>}
    </section>

    {pending.length > 0 && <section className="card"><h2>Solicitudes enviadas</h2><ul className="socialPendingList">{pending.map((request) => <li key={request.id}><span>{directory.find((profile) => profile.userId === request.addresseeId)?.username || "Usuario"}</span><b>Pendiente</b></li>)}</ul></section>}
  </section>;
}
