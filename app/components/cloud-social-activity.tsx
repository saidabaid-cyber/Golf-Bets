"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialActivityCard, SocialActivityPage, SocialActivityPreferences, SocialComment, SocialNotification, SocialNotificationPage } from "../../lib/social-activity-contract";
import { socialErrorMessage, socialRequest } from "../../lib/social-activity-client";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./cloud-social-activity.module.css";

const preferenceLabels: Array<[keyof Omit<SocialActivityPreferences, "updatedAt">, string]> = [
  ["shareRounds", "Compartir rondas terminadas"], ["shareAchievements", "Compartir logros"],
  ["shareEquipment", "Compartir cambios de equipo"], ["shareCourses", "Compartir campos después de jugar"],
  ["notifyLike", "Avisarme de likes"], ["notifyComment", "Avisarme de comentarios"],
  ["notifyAttest", "Avisarme de attest"], ["notifyFriendAchievement", "Logros de amigos"], ["notifyEquipment", "Equipo de amigos"],
];

export function SocialSharingPreferences({ accessToken }: { accessToken: string }) {
  const [prefs, setPrefs] = useState<SocialActivityPreferences | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void socialRequest<{ data: SocialActivityPreferences }>("/api/social/preferences", accessToken, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setPrefs(result.data); })
      .catch((error) => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); });
    return () => { live.current = false; controller.abort(); };
  }, [accessToken]);
  async function change(key: keyof Omit<SocialActivityPreferences, "updatedAt">, value: boolean) {
    if (writing.current || !prefs) return;
    writing.current = true; setBusy(true); setMessage("");
    try {
      const result = await socialRequest<{ data: SocialActivityPreferences }>("/api/social/preferences", accessToken, { method: "PUT", body: { ...prefs, [key]: value } });
      if (live.current) { setPrefs(result.data); setMessage("Preferencias guardadas."); }
    } catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { writing.current = false; if (live.current) setBusy(false); }
  }
  return <details className={styles.preferences}><summary>Privacidad y avisos de Social</summary>
    <p>Compartir es opcional y respeta la privacidad de tu perfil. No publicamos ubicación en tiempo real.</p>
    {prefs ? <fieldset disabled={busy}>{preferenceLabels.map(([key, label]) => <label key={key}><input type="checkbox" checked={prefs[key]} onChange={(event) => void change(key, event.target.checked)} /><span>{label}</span></label>)}</fieldset> : !message && <p role="status">Cargando preferencias…</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}

function dateLabel(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(date);
}

export function SocialRoundActivityCard({ card, viewerId, accessToken, onRefresh }: {
  card: SocialActivityCard; viewerId: string; accessToken: string; onRefresh: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<SocialActivityCard | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const base = `/api/social/activity/${encodeURIComponent(card.id)}`;
  const detailedRound = detail?.currentHash === card.currentHash ? detail.round : card.round;
  async function loadComments() {
    const result = await socialRequest<{ data: SocialComment[] }>(`${base}/comments`, accessToken);
    if (live.current) setComments(result.data);
  }
  async function act(operation: () => Promise<void>, success = "") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await operation(); if (live.current) setMessage(success); }
    catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  }
  async function like() {
    await socialRequest(`${base}/likes`, accessToken, { method: card.likedByMe ? "DELETE" : "POST", body: { expectedHash: card.currentHash } });
    await onRefresh();
  }
  async function saveComment() {
    const clean = text.trim(); if (!clean) return;
    await socialRequest(editing ? `${base}/comments/${encodeURIComponent(editing)}` : `${base}/comments`, accessToken, { method: editing ? "PATCH" : "POST", body: { text: clean, expectedHash: card.currentHash } });
    if (live.current) { setText(""); setEditing(null); }
    await loadComments(); await onRefresh();
  }
  async function attest() {
    await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/attest`, accessToken, { method: "POST", body: { targetUserId: card.targetUserId, expectedVersion: card.sourceVersion, expectedHash: card.currentHash } });
    await onRefresh();
  }
  return <article className={styles.card} aria-label={`${card.type === "EQUIPMENT_UPDATED" ? "Equipo" : "Ronda"} de ${card.author.displayName}`}>
    <header className={styles.author}><ProfileAvatarMedia className={styles.avatar} value={card.author.avatarUrl} fallback={card.author.displayName[0] || "G"} /><div><b>{card.author.displayName}</b><small>{dateLabel(card.round?.date || card.createdAt)} · {card.audience === "OWNER" ? "Privado" : "Amigos"}</small></div></header>
    {card.round ? <><h3>{card.round.courseName}</h3><p className={styles.score}>{card.round.ownerScore ?? "—"}<span>golpes · {card.round.holesPlayed} hoyos</span></p></> : <h3>{card.type === "EQUIPMENT_UPDATED" ? "Actualizó su bolsa." : "Logros de ronda"}</h3>}
    {card.achievements.length > 0 && <ul className={styles.achievements}>{card.achievements.map((item) => <li key={item}>{item}</li>)}</ul>}
    {card.round && <p className={styles.attest}>{card.attestCount ? `Atestada por ${card.attestCount} ${card.attestCount === 1 ? "jugador" : "jugadores"}` : "Sin atestar"}<small>Confirmación de compañeros. No es certificación GHIN/WHS.</small></p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} aria-pressed={card.likedByMe} onClick={() => void act(like)}>{card.likedByMe ? "♥" : "♡"} Like · {card.likesCount}</button>
      <button type="button" disabled={busy} aria-expanded={showComments} onClick={() => { const next = !showComments; setShowComments(next); if (next) void act(loadComments); }}>Comentar · {card.commentsCount}</button>
      {card.round && <button type="button" disabled={busy} aria-expanded={expanded} onClick={() => { if (expanded) { setExpanded(false); return; } void act(async () => { const result = await socialRequest<{ data: SocialActivityCard }>(base, accessToken); if (live.current) { setDetail(result.data); setExpanded(true); } }); }}>{expanded ? "Cerrar tarjeta" : "Ver ronda"}</button>}
    </div>
    {expanded && detailedRound && <section className={styles.roundDetails} aria-label="Tarjeta de la ronda"><h4>Tarjeta guardada</h4><p>{detailedRound.teeName || "Tee no registrado"} · Par {detailedRound.coursePar ?? "—"}</p>{detailedRound.scorecard?.length ? <table><thead><tr><th>Hoyo</th><th>Par</th><th>Score</th></tr></thead><tbody>{detailedRound.scorecard.map((hole) => <tr key={hole.hole}><th>{hole.hole}</th><td>{hole.par}</td><td>{hole.score ?? "—"}</td></tr>)}</tbody></table> : <p>No hay captura suficiente para mostrar el detalle.</p>}</section>}
    {card.canAttest && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que esta tarjeta corresponde a la ronda que jugué con este jugador. No es una certificación oficial.")) void act(attest, "Attest guardado para esta versión de la tarjeta."); }}>Atestar esta tarjeta</button>}
    {card.isAttestedByMe && <p className={styles.attest}>Ya atestaste esta versión de la tarjeta.</p>}
    {card.requiresParticipantConfirmation && card.participantPlayerKey && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que participé en esta ronda con mi cuenta. Esto no atesta todavía la tarjeta de otro jugador.")) void act(async () => { await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/links`, accessToken, { method: "POST", body: { playerKey: card.participantPlayerKey, expectedVersion: card.sourceVersion, expectedHash: card.currentHash } }); await onRefresh(); }, "Participación confirmada. Ya puedes revisar y atestar la tarjeta."); }}>Confirmar mi participación</button>}
    {showComments && <section className={styles.comments} aria-label="Comentarios">
      {comments.map((comment) => <article key={comment.id}><b>{comment.author.displayName}</b><p>{comment.text}</p>{comment.author.userId === viewerId && <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setEditing(comment.id); setText(comment.text); }}>Editar</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("¿Eliminar tu comentario?")) void act(async () => { await socialRequest(`${base}/comments/${encodeURIComponent(comment.id)}`, accessToken, { method: "DELETE", body: { expectedHash: card.currentHash } }); await loadComments(); await onRefresh(); }); }}>Eliminar</button></div>}</article>)}
      {!comments.length && !busy && <p>Sé el primero en comentar.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void act(saveComment, "Comentario guardado."); }}><label>Tu comentario<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={500} rows={3} placeholder="Escribe un comentario" /></label><div className={styles.actions}><button type="submit" disabled={busy || !text.trim()}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Enviar"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setText(""); }}>Cancelar edición</button>}</div></form>
    </section>}
    {message && <p className={styles.notice} role="status">{message}</p>}
  </article>;
}

const notificationLabels: Record<SocialNotification["type"], string> = { like: "Recibiste un like", comment: "Nuevo comentario", attest: "Un compañero atestó tu tarjeta", friend_achievement: "Un amigo consiguió un logro", equipment: "Un amigo actualizó su bolsa" };

export function CloudSocialNotifications({ viewerId, accessToken }: { viewerId: string; accessToken?: string }) {
  const [items, setItems] = useState<SocialNotification[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<SocialActivityCard | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const result = await socialRequest<SocialNotificationPage>("/api/social/notifications", accessToken);
    if (live.current) setItems(result.data);
  }, [accessToken]);
  useEffect(() => { live.current = true; void refresh().catch((error) => { if (live.current) setMessage(socialErrorMessage(error)); }); return () => { live.current = false; }; }, [refresh]);
  if (!accessToken) return null;
  return <section className={styles.feed} aria-label="Notificaciones sociales"><h2>De tus compañeros</h2>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {!message && !items.length && <p>No hay notificaciones sociales nuevas.</p>}
    {items.map((item) => <button type="button" className={styles.notification} disabled={busy} key={item.id} onClick={() => {
      if (busy) return; setBusy(true);
      void socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(item.activityId)}`, accessToken)
        .then((result) => { if (live.current) setSelected(result.data); })
        .catch((error) => { if (live.current) setMessage(socialErrorMessage(error)); })
        .finally(() => { if (live.current) setBusy(false); });
    }}><b>{notificationLabels[item.type]}</b><small>{dateLabel(item.createdAt)}</small></button>)}
    {selected && <><button type="button" className="secondary" onClick={() => setSelected(null)}>Cerrar tarjeta</button><SocialRoundActivityCard key={selected.id} card={selected} viewerId={viewerId} accessToken={accessToken} onRefresh={async () => {
      const result = await socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(selected.id)}`, accessToken);
      if (live.current) setSelected(result.data); await refresh();
    }} /></>}
  </section>;
}

/** Key this component by authenticated identity; never carry another account's feed across login. */
export function CloudSocialActivity({ viewerId, accessToken, localRoundId }: { viewerId: string; accessToken?: string; localRoundId?: string }) {
  const [cards, setCards] = useState<SocialActivityCard[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const paging = useRef(false);
  const live = useRef(true);
  const path = `/api/social/activity${localRoundId ? `?localRoundId=${encodeURIComponent(localRoundId)}` : ""}`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    const result = await socialRequest<SocialActivityPage>(path, accessToken, { signal });
    if (live.current && !signal?.aborted) { setCards(result.data); setNextCursor(result.nextCursor); setMessage(""); }
  }, [accessToken, path]);
  async function loadMore() {
    if (!accessToken || !nextCursor || paging.current) return;
    paging.current = true; setLoadingMore(true);
    try {
      const result = await socialRequest<SocialActivityPage>(`${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(nextCursor)}`, accessToken);
      if (live.current) {
        setCards((current) => [...new Map([...current, ...result.data].map((card) => [card.id, card])).values()]);
        setNextCursor(result.nextCursor); setMessage("");
      }
    } catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { paging.current = false; if (live.current) setLoadingMore(false); }
  }
  useEffect(() => {
    live.current = true; const controller = new AbortController();
    if (accessToken) void refresh(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    else setLoading(false);
    return () => { live.current = false; controller.abort(); };
  }, [accessToken, refresh]);
  if (!accessToken) return <section className={styles.empty}><h2>Rondas y amigos</h2><p>Inicia sesión para compartir, comentar o confirmar tarjetas. Tu actividad local sigue siendo privada.</p></section>;
  return <section className={styles.feed} aria-label="Actividad social guardada">
    {!localRoundId && <SocialSharingPreferences key={viewerId} accessToken={accessToken} />}
    {loading && <p role="status">Cargando actividad…</p>}
    {message && <div className={styles.notice} role="status"><p>{message}</p><button type="button" onClick={() => void refresh().catch((error) => setMessage(socialErrorMessage(error)))}>Reintentar</button></div>}
    {!loading && !message && !cards.length && <div className={styles.empty}><h2>{localRoundId ? "Tarjeta social pendiente" : "Aún no hay actividad compartida"}</h2><p>{localRoundId ? "Estará disponible cuando la ronda termine y su sincronización cloud se confirme." : "Tus preferencias controlan qué compartes. No publicamos rondas en tiempo real."}</p></div>}
    {cards.map((card) => <SocialRoundActivityCard key={`${viewerId}:${card.id}`} card={card} viewerId={viewerId} accessToken={accessToken} onRefresh={refresh} />)}
    {nextCursor && <div className={styles.actions}><button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Cargando…" : "Ver más actividad"}</button></div>}
  </section>;
}
