"use client";
import { useVisualContent } from "./use-visual-content";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialActivityCard, SocialActivityPage, SocialActivityPreferences, SocialComment, SocialNotification, SocialNotificationPage } from "../../lib/social-activity-contract";
import { socialErrorMessage, socialRequest } from "../../lib/social-activity-client";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { BackyardIcon } from "./backyard-icon";
import styles from "./cloud-social-activity.module.css";
import { RoundParticipationCard } from "./round-participation-card";
import { useBackyardAccount } from "./account-provider";
import { NotificationSwitch } from "./notification-preferences";
import { notificationsChanged } from "../../features/notifications/client";
import Image from "next/image";
import { mergeSocialCards, socialRelativeTime, pullRefreshDistance } from "../../lib/social-feed-presentation";

const preferenceLabels: Array<[keyof Omit<SocialActivityPreferences, "updatedAt">, string]> = [
  ["enabledForFriends", "Permitir que mis amigos vean la actividad que elija compartir"],
  ["shareRounds", "Compartir rondas terminadas"], ["shareAchievements", "Compartir logros"],
  ["shareEquipment", "Compartir cambios de equipo"], ["shareCourses", "Compartir campos después de jugar"],
  ["notifyLike", "Avisarme de likes"], ["notifyComment", "Avisarme de comentarios"],
  ["notifyAttest", "Confirmaciones de tarjeta"], ["notifyFriendAchievement", "Logros de amigos"], ["notifyEquipment", "Equipo de amigos"],
  ["notifyFriendRequest", "Solicitudes de amistad"],
];

export function SocialSharingPreferences({ accessToken, section = 'all' }: { accessToken: string; section?: 'all' | 'sharing' | 'notifications' }) {
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
      if (live.current) { setPrefs(result.data); setMessage("Preferencias guardadas."); notificationsChanged(); }
    } catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { writing.current = false; if (live.current) setBusy(false); }
  }
  const labels = preferenceLabels.filter(([key]) => section === 'all' || (key.startsWith('notify') ? section === 'notifications' : section === 'sharing'));
  return <section className={styles.preferences}><h3>{section === 'notifications' ? 'Avisos de Social' : section === 'sharing' ? 'Actividad que comparto' : 'Privacidad y avisos de Social'}</h3>
    {section !== 'notifications' && <p>Compartir es opcional. Activa el acceso de tus amigos y elige los tipos de actividad. Un perfil público por sí solo no comparte rondas. No publicamos ubicación en tiempo real.</p>}
    {prefs ? <fieldset disabled={busy}>{labels.map(([key, label]) => key.startsWith("notify")
      ? <NotificationSwitch key={key} label={label} copy={key === "notifyAttest" ? "Avísame cuando un compañero confirme una tarjeta." : "Avisos dentro de The Backyard."} checked={prefs[key]===true} disabled={busy} onChange={value=>void change(key,value)} />
      : <label key={key}><input type="checkbox" checked={prefs[key]} onChange={(event) => void change(key, event.target.checked)} /><span>{label}</span></label>)}</fieldset> : !message && <p role="status">Cargando preferencias…</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

function dateLabel(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(date);
}

export function SocialFeedSkeleton() {
  return <div className={styles.feedSkeleton} role="status" aria-label="Cargando actividad">
    {[0,1,2].map(i=><div className={styles.skeletonPost} key={i} aria-hidden="true"><div className={styles.skeletonAuthor}><span/><div><span/><span/></div></div><span className={styles.skeletonLine}/><div className={styles.skeletonMetrics}>{[0,1,2,3].map(n=><span key={n}/>)}</div><div className={styles.skeletonActions}><span/><span/></div></div>)}
  </div>;
}

export function ScoreSummary({round}:{round:NonNullable<SocialActivityCard["round"]>}) {
  return <div className={styles.roundStats} aria-label="Resumen de score"><div className={styles.mainScore}><small>Score</small><strong>{round.ownerScore ?? "—"}</strong>{round.toPar!==undefined&&<span aria-label={`${round.toPar} contra par`}>{round.toPar>0?"+":""}{round.toPar===0?"E":round.toPar}</span>}</div>{([['Putts',round.putts],['GIR',round.girPct],['FIR',round.firPct]] as const).filter(([,value])=>value!==undefined).map(([label,value])=><div key={label}><small>{label}</small><b>{value}{label!=="Putts"?"%":""}</b></div>)}</div>;
}

export function SocialRoundActivityCard({ card, viewerId, accessToken, onRefresh, onOpenAchievements, onOpenProfile, viewerName, viewerAvatarUrl }: {
  card: SocialActivityCard; viewerId: string; accessToken: string; onRefresh: () => Promise<void>; onOpenAchievements?: () => void;
  onOpenProfile?: (userId:string)=>void; viewerName?:string; viewerAvatarUrl?:string|null;
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
  const [showBag,setShowBag]=useState(false);
  const [showPlayers,setShowPlayers]=useState(false), [attestInfo,setAttestInfo]=useState(false);
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
  const highlighted=card.achievements.length>0;
  function openScorecard() {
    if (expanded) { setExpanded(false); return; }
    void act(async () => { const result = await socialRequest<{ data: SocialActivityCard }>(base, accessToken); if (live.current) { setDetail(result.data); setExpanded(true); } });
  }
  return <article className={`${styles.card} ${highlighted?styles.highlight:""}`} aria-label={`${card.type === "EQUIPMENT_UPDATED" ? "Equipo" : "Ronda"} de ${card.author.displayName}`}>
    <header className={styles.author}><ProfileAvatarMedia className={styles.avatar} value={card.author.avatarUrl} fallback={card.author.displayName[0] || "G"} /><div>{onOpenProfile?<button type="button" className={styles.authorLink} onClick={()=>onOpenProfile(card.author.userId)}>{card.author.displayName}</button>:<b>{card.author.displayName}</b>}<small>{card.type==="EQUIPMENT_UPDATED"?"Actualizó su bolsa de golf":card.round?`jugó en ${card.round.courseName}`:"Consiguió un logro"}</small><small>{socialRelativeTime(card.createdAt)} · {card.audience === "OWNER" ? "Privado" : "Amigos"}</small></div><details className={styles.postMenu}><summary aria-label={`Acciones de la publicación de ${card.author.displayName}`}><BackyardIcon name="more" size={23}/></summary><div>{onOpenProfile&&<button type="button" onClick={()=>onOpenProfile(card.author.userId)}>Ver perfil</button>}{card.round&&<button type="button" disabled={busy} onClick={openScorecard}>{expanded?"Cerrar tarjeta":"Ver scorecard"}</button>}<span>{dateLabel(card.createdAt)} · {card.audience==="OWNER"?"Sólo tú":"Compartido con amigos"}</span></div></details></header>
    {highlighted&&<p className={styles.highlightLabel}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8"/></svg>{card.achievements[0]}</p>}
    {card.round && <><ScoreSummary round={card.round}/><button type="button" className={styles.scorecardLink} disabled={busy} aria-expanded={expanded} onClick={openScorecard}><span>{card.round.holesPlayed} hoyos{card.round.totalOnly?" · Total declarado":""}{card.round.teeName?` · ${card.round.teeName}`:""}</span><span>{expanded?"Cerrar":"Ver tarjeta"} <BackyardIcon name="chevron" size={14}/></span></button></>}
    {card.type==="EQUIPMENT_UPDATED"&&<section className={styles.bag}><h3>Mi bolsa de golf</h3><small>EQUIPO ACTUAL</small>{card.equipment?.items.length?<>{(showBag?card.equipment.items:card.equipment.items.slice(0,3)).map(item=><div className={styles.bagItem} key={item.id}>{item.imageUrl?<Image src={item.imageUrl} alt={`${item.brand} ${item.model}`} width={56} height={56} loading="lazy" />:<span className={styles.clubIcon}><BackyardIcon name={item.category==="Bola"?"ball":"club"} size={30}/></span>}<small>{item.category}</small><b>{item.brand} {item.model}</b></div>)}{card.equipment.items.length>3&&<button type="button" className={styles.bagLink} aria-expanded={showBag} onClick={()=>setShowBag(v=>!v)}>{showBag?"Mostrar menos":"Ver bolsa"} ›</button>}</>:<p>El resumen del equipo no está disponible por el momento.</p>}</section>}
    {card.round?.leaderboard&&<section className={styles.leaderboard}><header><div><h3>Resultados de la ronda</h3><small>{card.round.leaderboard.length} jugadores · Score bruto</small></div>{card.round.leaderboard.length>3&&<button type="button" className={styles.bagLink} aria-expanded={showPlayers} onClick={()=>setShowPlayers(v=>!v)}>{showPlayers?"Ver menos":"Ver todos"} <BackyardIcon name="chevron" size={14}/></button>}</header><ol>{(showPlayers?card.round.leaderboard:card.round.leaderboard.slice(0,3)).map((player,i)=><li key={player.userId}><span>{i+1}</span><ProfileAvatarMedia className={styles.miniAvatar} value={player.avatarUrl} fallback={player.name[0]} /><b>{player.name}</b><strong>{player.score}</strong><small>{player.toPar===undefined?`${player.holes} H`:player.toPar===0?"E":`${player.toPar>0?"+":""}${player.toPar}`}</small></li>)}</ol></section>}
    {card.courseEvent && <p>Nuevo campo jugado · fuera de su Home Club</p>}
    {card.achievements.length > 0 && <>{card.achievements.length > 1 && <ul className={styles.achievements}>{card.achievements.slice(1,4).map((item) => <li key={item}>{item}</li>)}</ul>}{card.author.userId === viewerId && onOpenAchievements && <button type="button" className="textButton" onClick={onOpenAchievements}>Ver en Logros</button>}</>}
    {card.round && <div className={styles.attest}><span>{card.attestCount ? `Atestada por ${card.attestCount} ${card.attestCount === 1 ? "jugador" : "jugadores"}` : "Pendiente de atest"}</span><button type="button" aria-label="Qué significa Atest" aria-expanded={attestInfo} onClick={()=>setAttestInfo(v=>!v)}><BackyardIcon name="info" size={16}/></button>{attestInfo&&<p>Confirmación de compañeros. No es certificación GHIN/WHS.</p>}</div>}
    <div className={styles.reactions} aria-label="Reacciones de la publicación"><span><BackyardIcon name="heart" size={20}/>{card.likesCount} me gusta</span><span><BackyardIcon name="comment" size={19}/>{card.commentsCount}</span></div>
    <div className={styles.actions}>
      <button type="button" disabled={busy} aria-pressed={card.likedByMe} onClick={() => void act(like)}><BackyardIcon name="heart" size={23}/><span>Me gusta</span></button>
      <button type="button" disabled={busy} aria-expanded={showComments} onClick={() => { const next = !showComments; setShowComments(next); if (next) void act(loadComments); }}><BackyardIcon name="comment" size={23}/><span>Comentar</span></button>
    </div>
    {expanded && detailedRound && <section className={styles.roundDetails} aria-label="Tarjeta de la ronda"><h4>Tarjeta guardada</h4><p>{detailedRound.teeName || "Tee no registrado"} · Par {detailedRound.coursePar ?? "—"}</p>{detailedRound.scorecard?.length ? <table><thead><tr><th>Hoyo</th><th>Par</th><th>Score</th></tr></thead><tbody>{detailedRound.scorecard.map((hole) => <tr key={hole.hole}><th>{hole.hole}</th><td>{hole.par}</td><td>{hole.score ?? "—"}</td></tr>)}</tbody></table> : <p>No hay captura suficiente para mostrar el detalle.</p>}</section>}
    {card.canAttest && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que esta tarjeta corresponde a la ronda que jugué con este jugador. No es una certificación oficial.")) void act(attest, "Attest guardado para esta versión de la tarjeta."); }}>Atestar esta tarjeta</button>}
    {card.isAttestedByMe && <p className={styles.attest}>Ya atestaste esta versión de la tarjeta.</p>}
    {card.requiresParticipantConfirmation && card.participantPlayerKey && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que participé en esta ronda con mi cuenta. Esto no atesta todavía la tarjeta de otro jugador.")) void act(async () => { await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/links`, accessToken, { method: "POST", body: { playerKey: card.participantPlayerKey, expectedVersion: card.sourceVersion, expectedHash: card.currentHash } }); await onRefresh(); }, "Participación confirmada. Ya puedes revisar y atestar la tarjeta."); }}>Confirmar mi participación</button>}
    {showComments && <section className={styles.comments} aria-label="Comentarios">
      {comments.map((comment) => <article key={comment.id}><b>{comment.author.displayName}</b><p>{comment.text}</p>{comment.author.userId === viewerId && <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setEditing(comment.id); setText(comment.text); }}>Editar</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("¿Eliminar tu comentario?")) void act(async () => { await socialRequest(`${base}/comments/${encodeURIComponent(comment.id)}`, accessToken, { method: "DELETE", body: { expectedHash: card.currentHash } }); await loadComments(); await onRefresh(); }); }}>Eliminar</button></div>}</article>)}
      {!comments.length && !busy && <p>Sé el primero en comentar.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void act(saveComment, "Comentario guardado."); }}><div className={styles.composer}><ProfileAvatarMedia className={styles.miniAvatar} value={viewerAvatarUrl} fallback={viewerName?.[0]||"G"}/><label>Tu comentario<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={500} rows={2} placeholder="Escribe un comentario…" /></label></div><div className={styles.actions}><button type="submit" disabled={busy || !text.trim()}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Enviar"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setText(""); }}>Cancelar edición</button>}</div></form>
    </section>}
    {message && <p className={styles.notice} role="status">{message}</p>}
  </article>;
}

const notificationLabels: Record<SocialNotification["type"], string> = { like: "Recibiste un like", comment: "Nuevo comentario", attest: "Un compañero atestó tu tarjeta", friend_achievement: "Un amigo consiguió un logro", equipment: "Un amigo actualizó su bolsa", friend_request: "Nueva solicitud de amistad", friend_accepted:"Solicitud aceptada",group_invite:"Invitación a un grupo",round_invite:"Invitación a una ronda",round_finished:"Resultados de ronda disponibles", round_started: "Un compañero inició una ronda contigo · Ver ronda", scorecard_ready: "Registraron tu tarjeta · Revisar tarjeta" };

export function CloudSocialNotifications({ viewerId, accessToken, onFriends, onReadChange }: { viewerId: string; accessToken?: string; onFriends?: () => void; onReadChange?: () => void }) {
  const { retryCloudSync } = useBackyardAccount();
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
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
      void (async () => {
        const read = await socialRequest<SocialNotificationPage>("/api/social/notifications", accessToken, { method: "PATCH", body: { id: item.id, read: true } });
        if (live.current) { setItems(read.data); onReadChange?.(); }
        if (item.type === "friend_request") { onFriends?.(); return; }
        if (item.type === "round_started" || item.type === "scorecard_ready") { if (live.current) { setSelected(null); setSelectedRound(item.activityId); } return; }
        const result = await socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(item.activityId)}`, accessToken);
        if (live.current) setSelected(result.data);
      })()
        .catch((error) => { if (live.current) setMessage(socialErrorMessage(error)); })
        .finally(() => { if (live.current) setBusy(false); });
    }}><b>{!item.readAt && "● "}{notificationLabels[item.type]}</b><small>{dateLabel(item.createdAt)} · {item.readAt ? "Leída" : "Sin leer"}</small></button>)}
    {selectedRound && <><button type="button" className="secondary" onClick={() => setSelectedRound(null)}>Cerrar tarjeta compartida</button><RoundParticipationCard key={selectedRound} accessToken={accessToken} roundId={selectedRound} onConfirmed={async () => { await retryCloudSync(); await refresh(); onReadChange?.(); }} /></>}
    {selected && <><button type="button" className="secondary" onClick={() => setSelected(null)}>Cerrar tarjeta</button><SocialRoundActivityCard key={selected.id} card={selected} viewerId={viewerId} accessToken={accessToken} onRefresh={async () => {
      const result = await socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(selected.id)}`, accessToken);
      if (live.current) setSelected(result.data); await refresh();
    }} /></>}
  </section>;
}

/** Key this component by authenticated identity; never carry another account's feed across login. */
export function CloudSocialActivity({ viewerId, accessToken, localRoundId, friendsOnly = false, onOpenAchievements, onOpenProfile, viewerName, viewerAvatarUrl }: { viewerId: string; accessToken?: string; localRoundId?: string; friendsOnly?: boolean; onOpenAchievements?: () => void; onOpenProfile?:(userId:string)=>void;viewerName?:string;viewerAvatarUrl?:string|null }) {
  const emptyCopy=useVisualContent().find(c=>c.target_key==="home_empty_feed")?.values;
  const [cards, setCards] = useState<SocialActivityCard[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const paging = useRef(false);
  const live = useRef(true);
  const feed=useRef<HTMLElement>(null), sentinel=useRef<HTMLDivElement>(null);
  const [pull,setPull]=useState(0),[refreshing,setRefreshing]=useState(false);
  const path = `/api/social/activity${localRoundId ? `?localRoundId=${encodeURIComponent(localRoundId)}` : friendsOnly ? "?friendsOnly=true" : ""}`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken || paging.current) return;
    paging.current=true;setRefreshing(true);
    try { const result = await socialRequest<SocialActivityPage>(path, accessToken, { signal });
      if (live.current && !signal?.aborted) { setCards(mergeSocialCards([],result.data)); setNextCursor(result.nextCursor); setMessage(""); }
    } finally {paging.current=false;if(live.current)setRefreshing(false);}
  }, [accessToken, path]);
  const loadMore=useCallback(async()=> {
    if (!accessToken || !nextCursor || paging.current) return;
    paging.current = true; setLoadingMore(true);
    try {
      const result = await socialRequest<SocialActivityPage>(`${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(nextCursor)}`, accessToken);
      if (live.current) {
        if(result.nextCursor===nextCursor)throw Error("No pudimos continuar la actividad.");
        setCards((current) => mergeSocialCards(current,result.data));
        setNextCursor(result.nextCursor); setMessage("");
      }
    } catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { paging.current = false; if (live.current) setLoadingMore(false); }
  },[accessToken,nextCursor,path]);
  async function refreshCard(id:string) {const result=await socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${encodeURIComponent(id)}`,accessToken!);if(live.current)setCards(current=>current.map(card=>card.id===id?result.data:card));}
  useEffect(() => {
    live.current = true; const controller = new AbortController();
    if (accessToken) void refresh(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    else setLoading(false);
    return () => { live.current = false; controller.abort(); };
  }, [accessToken, refresh]);
  useEffect(()=>{
    if(!accessToken||localRoundId)return;
    const foreground=()=>{if(document.visibilityState==="visible")void refresh().catch(error=>setMessage(socialErrorMessage(error)));};
    document.addEventListener("visibilitychange",foreground);window.addEventListener("pageshow",foreground);
    return()=>{document.removeEventListener("visibilitychange",foreground);window.removeEventListener("pageshow",foreground);};
  },[accessToken,localRoundId,refresh]);
  useEffect(()=>{
    const node=sentinel.current;if(!node||!nextCursor||loading||refreshing||typeof IntersectionObserver==="undefined")return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMore();},{rootMargin:"480px"});observer.observe(node);return()=>observer.disconnect();
  },[nextCursor,loading,refreshing,loadMore]);
  useEffect(()=>{
    const node=feed.current;if(!node||localRoundId||!accessToken)return;
    let start:number|null=null,startX=0,distance=0;
    const begin=(event:TouchEvent)=>{if(event.touches.length!==1||window.scrollY>0||paging.current||(event.target instanceof Element&&event.target.closest("input,textarea,button")))return;start=event.touches[0].clientY;startX=event.touches[0].clientX;};
    const move=(event:TouchEvent)=>{if(start===null||event.touches.length!==1)return;const touch=event.touches[0];if(Math.abs(touch.clientX-startX)>Math.abs(touch.clientY-start)){start=null;distance=0;setPull(0);return;}distance=pullRefreshDistance(start,touch.clientY,window.scrollY);if(distance>8&&event.cancelable)event.preventDefault();setPull(distance);};
    const end=()=>{const shouldRefresh=distance>=64;start=null;distance=0;setPull(0);if(shouldRefresh)void refresh().catch(error=>setMessage(socialErrorMessage(error)));};
    const cancel=()=>{start=null;distance=0;setPull(0);};
    node.addEventListener("touchstart",begin,{passive:true});node.addEventListener("touchmove",move,{passive:false});node.addEventListener("touchend",end);node.addEventListener("touchcancel",cancel);
    return()=>{node.removeEventListener("touchstart",begin);node.removeEventListener("touchmove",move);node.removeEventListener("touchend",end);node.removeEventListener("touchcancel",cancel);};
  },[accessToken,localRoundId,refresh]);
  if (!accessToken) return <section className={styles.empty}><h2>Rondas y amigos</h2><p>Inicia sesión para compartir, comentar o confirmar tarjetas. Tu actividad local sigue siendo privada.</p></section>;
  return <section ref={feed} className={styles.feed} aria-label="Actividad social guardada">
    {(pull>0||refreshing&&!loading)&&<div className={styles.pullIndicator} role="status">{refreshing?"Actualizando…":pull>=64?"Suelta para actualizar":"Desliza para actualizar"}</div>}
    {loading && <SocialFeedSkeleton/>}
    {message && <div className={styles.notice} role="status"><p>{message}</p><button type="button" onClick={() => void refresh().catch((error) => setMessage(socialErrorMessage(error)))}>Reintentar</button></div>}
    {!loading && !message && !cards.length && <div className={styles.empty}><h2>{localRoundId ? "Tarjeta social pendiente" : emptyCopy?.active!==false&&emptyCopy?.title ? emptyCopy.title : "Aún no hay actividad compartida"}</h2><p>{localRoundId ? "Estará disponible cuando la ronda termine y su sincronización cloud se confirme." : emptyCopy?.active!==false&&emptyCopy?.body ? emptyCopy.body : "Tus preferencias controlan qué compartes. No publicamos rondas en tiempo real."}</p></div>}
    {cards.map((card) => <SocialRoundActivityCard key={`${viewerId}:${card.id}`} card={card} viewerId={viewerId} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} accessToken={accessToken} onRefresh={()=>refreshCard(card.id)} onOpenAchievements={onOpenAchievements} onOpenProfile={onOpenProfile} />)}
    {nextCursor && <div ref={sentinel} className={styles.loadMore} role="status">{loadingMore?"Cargando más actividad…":""}<button type="button" className={styles.accessibleMore} disabled={loadingMore||refreshing} onClick={()=>void loadMore()}>Cargar siguiente página</button></div>}
  </section>;
}
