"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SocialActivityCard, SocialComment } from "../../lib/social-activity-contract";
import { socialErrorMessage, socialRequest } from "../../lib/social-activity-client";
import { socialRelativeTime } from "../../lib/social-feed-presentation";
import { socialFeedViewFromSearch, socialFeedViewHref, type SocialFeedView } from "../../lib/social-feed-view";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { BackyardIcon } from "./backyard-icon";
import { useModalDialog } from "./use-modal-dialog";
import styles from "./social-feed-detail.module.css";

function FeedContent({ render, onOpen }: { render: (open:(kind:SocialFeedView["kind"],card:SocialActivityCard)=>void)=>ReactNode;onOpen:(kind:SocialFeedView["kind"],card:SocialActivityCard)=>void }) { return render(onOpen); }

function roundDate(value?: string) { if (!value) return ""; const date = new Date(value.length===10?`${value}T12:00:00Z`:value); return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-MX",{day:"numeric",month:"short",year:"numeric",timeZone:"America/Mexico_City"}).format(date); }

export function sameSocialActivity(expected: SocialActivityCard, actual: SocialActivityCard) {
  return actual.id === expected.id && actual.author.userId === expected.author.userId && actual.roundId === expected.roundId;
}

function RoundIdentity({ card }: { card: SocialActivityCard }) {
  return <div className={styles.roundIdentity}><ProfileAvatarMedia className={styles.avatar} value={card.author.avatarUrl} fallback={card.author.displayName[0] || "G"}/><div><b>{card.author.displayName}</b><span>{card.round?.courseName || "Actividad compartida"}</span><small>{roundDate(card.round?.date)} {card.round?.teeName && `· ${card.round.teeName}`}</small></div>{card.round?.ownerScore != null && <strong>{card.round.ownerScore}<small>{card.round.toPar === undefined ? "Score gross" : `${card.round.toPar > 0 ? "+" : ""}${card.round.toPar === 0 ? "E" : card.round.toPar}`}</small></strong>}</div>;
}

export function SocialRoundResults({ card, onClose, onOpenScorecard, onOpenProfile }: { card: SocialActivityCard; onClose: () => void; onOpenScorecard: () => void; onOpenProfile?: (id: string) => void }) {
  const modal = useModalDialog(true, onClose);
  return <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={modal} className={styles.results} role="dialog" aria-modal="true" aria-labelledby="round-results-title" tabIndex={-1}>
    <div className={styles.handle} aria-hidden="true"/><header className={styles.title}><h2 id="round-results-title">Resultados de la ronda</h2><button type="button" aria-label="Cerrar resultados" onClick={onClose}>×</button></header>
    <p className={styles.course}>{card.round?.courseName}<small>{roundDate(card.round?.date)} · {card.round?.teeName || "Tee no registrado"} · Score bruto</small></p>
    {card.round?.leaderboard?.length ? <ol className={styles.ranking}>{card.round.leaderboard.map((player, index) => <li key={player.userId}><span className={styles.rank}>{index + 1}</span><ProfileAvatarMedia className={styles.avatar} value={player.avatarUrl} fallback={player.name[0] || "G"}/>{onOpenProfile ? <button type="button" onClick={() => onOpenProfile(player.userId)}>{player.name}</button> : <b>{player.name}</b>}<strong>{player.score}</strong><small>{player.toPar === undefined ? `${player.holes} H` : player.toPar === 0 ? "E" : `${player.toPar > 0 ? "+" : ""}${player.toPar}`}</small></li>)}</ol> : <p>No hay resultados autorizados disponibles.</p>}
    {card.achievements.length > 0 && <p className={styles.achievement}><BackyardIcon name="trophy" size={20}/>{card.achievements[0]}</p>}
    {card.round && <button type="button" className={styles.primary} onClick={onOpenScorecard}>{card.round.totalOnly ? "Ver resumen de la ronda" : "Ver tarjeta completa"}</button>}<button type="button" className={styles.returnFeed} onClick={onClose}>Volver al Feed</button>
  </section></div>;
}

export function SocialActivityComments({ card, viewerId, accessToken, viewerName, viewerAvatarUrl, onRefresh, onClose, onOpenProfile }: { card: SocialActivityCard; viewerId: string; accessToken: string; viewerName?: string; viewerAvatarUrl?: string | null; onRefresh: () => Promise<void>; onClose: () => void; onOpenProfile?: (id: string) => void }) {
  const [comments, setComments] = useState<SocialComment[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [text, setText] = useState(""), [editing, setEditing] = useState<string | null>(null);
  const live = useRef(true), writing = useRef(false), input = useRef<HTMLTextAreaElement>(null);
  const base = `/api/social/activity/${encodeURIComponent(card.id)}/comments`;
  async function load(signal?: AbortSignal) {
    const result = await socialRequest<{ data: SocialComment[] }>(base, accessToken, { signal });
    if (live.current && !signal?.aborted) setComments(result.data);
  }
  useEffect(() => {
    live.current = true; const controller = new AbortController();
    void load(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { live.current = false; controller.abort(); };
    // Each mounted view belongs to a single activity and authenticated identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, accessToken]);
  async function act(operation: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setMessage("");
    try { await operation(); } catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { writing.current = false; if (live.current) setBusy(false); }
  }
  async function save() {
    const clean = text.trim(); if (!clean) return;
    await socialRequest(editing ? `${base}/${encodeURIComponent(editing)}` : base, accessToken, { method: editing ? "PATCH" : "POST", body: { text: clean, expectedHash: card.currentHash } });
    if (live.current) { setText(""); setEditing(null); }
    await load(); await onRefresh();
  }
  return <section className={styles.commentsView} data-feed-view="comments" aria-label="Comentarios de la publicación"><header className={styles.commentsTitle}><button type="button" aria-label="Volver al Feed" onClick={onClose}><BackyardIcon name="back" size={23}/></button><h2>Comentarios{card.round ? " · Ronda" : ""}</h2></header>
    <RoundIdentity card={card}/><div className={styles.commentList}>{loading && <p role="status">Cargando comentarios…</p>}{message && <p className={styles.notice} role="status">{message}<button type="button" disabled={busy} onClick={() => void act(async () => { await load(); setLoading(false); })}>Reintentar</button></p>}
      {!loading && !message && !comments.length && <p>Sé el primero en comentar.</p>}
      {comments.map(comment => <article className={styles.comment} key={comment.id}><ProfileAvatarMedia className={styles.avatar} value={comment.author.avatarUrl} fallback={comment.author.displayName[0] || "G"}/><div>{onOpenProfile ? <button type="button" className={styles.author} onClick={() => onOpenProfile(comment.author.userId)}>{comment.author.displayName}</button> : <b>{comment.author.displayName}</b>}<p>{comment.text}</p><small>{socialRelativeTime(comment.createdAt)}</small>{comment.author.userId === viewerId && <div className={styles.commentActions}><button type="button" disabled={busy} onClick={() => { setEditing(comment.id); setText(comment.text); input.current?.focus(); }}>Editar</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("¿Eliminar tu comentario?")) void act(async () => { await socialRequest(`${base}/${encodeURIComponent(comment.id)}`, accessToken, { method: "DELETE", body: { expectedHash: card.currentHash } }); if (editing === comment.id) { setEditing(null); setText(""); } await load(); await onRefresh(); }); }}>Eliminar</button></div>}</div></article>)}
    </div><form className={styles.composer} onSubmit={event => { event.preventDefault(); void act(save); }}><ProfileAvatarMedia className={styles.avatar} value={viewerAvatarUrl} fallback={viewerName?.[0] || "G"}/><label><span className={styles.srOnly}>Tu comentario</span><textarea ref={input} value={text} onChange={event => setText(event.target.value)} maxLength={500} rows={1} placeholder="Escribe un comentario…"/></label><button type="submit" disabled={busy || loading || !text.trim()}>{busy ? "Guardando…" : editing ? "Guardar" : "Enviar"}</button>{editing && <button type="button" className={styles.cancel} onClick={() => { setEditing(null); setText(""); }}>Cancelar edición</button>}</form>
  </section>;
}

/** Origin remains mounted: pagination, post state and scroll survive child destinations. */
export function SocialFeedViews({ children, accessToken, viewerId, viewerName, viewerAvatarUrl, onRefresh, onOpenScorecard, onOpenProfile }: { children: (open: (kind: SocialFeedView["kind"], card: SocialActivityCard) => void) => ReactNode; accessToken: string; viewerId: string; viewerName?: string; viewerAvatarUrl?: string | null; onRefresh: (id: string) => Promise<void>; onOpenScorecard: (card: SocialActivityCard) => void; onOpenProfile?: (id: string) => void }) {
  const [selected, setSelected] = useState<{ kind: SocialFeedView["kind"]; card: SocialActivityCard } | null>(null), [message, setMessage] = useState("");
  const cache = useRef(new Map<string, SocialActivityCard>()), origin = useRef({ scroll: 0, focus: null as HTMLElement | null }), request = useRef<AbortController | null>(null);
  useEffect(() => {
    const pop = () => {
      request.current?.abort(); const view = socialFeedViewFromSearch(window.location.search);
      if (!view) { setSelected(null); return; }
      const card = cache.current.get(view.id);
      if (card) { setSelected({ kind: view.kind, card }); return; }
      const controller = new AbortController(); request.current = controller;
      void socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(view.id)}`, accessToken, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted && result.data.id === view.id) { cache.current.set(view.id, result.data); setSelected({ kind: view.kind, card: result.data }); }
      }).catch(error => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); });
    };
    pop(); window.addEventListener("popstate", pop);
    return () => { request.current?.abort(); window.removeEventListener("popstate", pop); };
  }, [accessToken]);
  function open(kind: SocialFeedView["kind"], card: SocialActivityCard) {
    origin.current = { scroll: window.scrollY, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    cache.current.set(card.id, card); setMessage(""); setSelected({ kind, card });
    window.history.pushState({ ...window.history.state, backyardFeedDetail: card.id }, "", socialFeedViewHref(window.location.search, { id: card.id, kind }));
    if (kind === "comments") window.scrollTo(0, 0);
  }
  function close() {
    if (selected && window.history.state?.backyardFeedDetail === selected.card.id) window.history.back();
    else { window.history.replaceState(window.history.state, "", socialFeedViewHref(window.location.search, null)); setSelected(null); }
  }
  const previous = useRef(false);
  useEffect(() => {
    if (previous.current && !selected && !new URLSearchParams(window.location.search).has("card")) {
      window.scrollTo(0, origin.current.scroll); origin.current.focus?.focus({ preventScroll: true });
    }
    previous.current = !!selected;
  }, [selected]);
  return <><div hidden={selected?.kind === "comments"}><FeedContent render={children} onOpen={open}/></div>{message && <p role="status">{message}</p>}{selected?.kind === "results" && <SocialRoundResults card={selected.card} onClose={close} onOpenProfile={onOpenProfile} onOpenScorecard={() => { setSelected(null); onOpenScorecard(selected.card); }}/>} {selected?.kind === "comments" && <SocialActivityComments key={`${viewerId}:${selected.card.id}`} card={selected.card} viewerId={viewerId} accessToken={accessToken} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} onClose={close} onOpenProfile={onOpenProfile} onRefresh={() => onRefresh(selected.card.id)}/>}</>;
}
