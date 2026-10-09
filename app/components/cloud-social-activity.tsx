"use client";
import { useVisualContent } from "./use-visual-content";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SocialActivityCard, SocialActivityPage, SocialActivityPreferences, SocialNotification, SocialNotificationPage } from "../../lib/social-activity-contract";
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
import { socialPremiumScorecard } from "../../lib/social-premium-scorecard";
import { ScorecardNavigationBoundary, type ScorecardDestination } from "./scorecard-boundary";
import { SocialFeedViews, SocialActivityComments, SocialRoundResults, sameSocialActivity } from "./social-feed-detail";
import type { SocialFeedView } from "../../lib/social-feed-view";
import { AttestRequestDialog } from './attest-request-dialog';

function SocialPostContent({ render, onOpen }: { render:(open:(destination?:ScorecardDestination)=>void)=>ReactNode;onOpen:(destination?:ScorecardDestination)=>void }) { return render(onOpen); }

export function socialScorecardDestination(card: SocialActivityCard,initialPlayerId?:string): ScorecardDestination {
  const premium = socialPremiumScorecard(card);
  const id = `social:${card.id}`;
  return premium ? { id, card: {...premium,initialPlayerId:premium.players.some(p=>p.id===initialPlayerId)?initialPlayerId:undefined} } : { id, summary: <div className="premiumCardIdentity"><div className="premiumIdentityText"><h2>{card.round?.courseName}</h2><p>{card.round?.date} · {card.round?.teeName || "Tee no registrado"}</p><b>{card.author.displayName}</b><p>{card.round?.holesPlayed} hoyos · {card.round?.totalOnly ? "Total declarado" : "Actividad compartida"}</p><p>No hay datos autorizados por hoyo para mostrar una tarjeta detallada.</p></div><div className="premiumScoreSummary"><span>Score gross</span><strong>{card.round?.ownerScore ?? "—"}</strong></div></div> };
}

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
  const knownPar = typeof round.toPar === "number" && Number.isFinite(round.toPar);
  const result = !knownPar ? "unknown" : round.toPar! < 0 ? "under" : round.toPar! > 0 ? "over" : "even";
  return <div className={styles.roundStats} data-result={result} aria-label="Resumen de score"><div className={styles.metrics}><div className={styles.mainScore}><small>Score</small><strong>{round.ownerScore ?? "—"}</strong></div>{([['Putts',round.putts],['GIR',round.girPct],['FIR',round.firPct]] as const).filter(([,value])=>typeof value === "number" && Number.isFinite(value)).map(([label,value])=><div className={styles.metric} data-metric={label} key={label}><small>{label}</small><b>{value}{label!=="Putts"?"%":""}</b></div>)}</div>{knownPar&&<div className={styles.toPar}><small>Vs par</small><b aria-label={`${round.toPar} contra par`}>{round.toPar!>0?"+":""}{round.toPar===0?"E":round.toPar}</b></div>}</div>;
}

export function SocialRoundActivityCard({ card, viewerId, accessToken, onRefresh, onOpenAchievements, onOpenProfile, viewerName, viewerAvatarUrl, onOpenScorecard, onOpenDetail }: {
  card: SocialActivityCard; viewerId: string; accessToken: string; onRefresh: () => Promise<void>; onOpenAchievements?: () => void;
  onOpenProfile?: (userId:string)=>void; viewerName?:string; viewerAvatarUrl?:string|null;
  onOpenScorecard?: (card: SocialActivityCard, playerId?:string) => void;
  onOpenDetail?: (kind: SocialFeedView["kind"], card: SocialActivityCard) => void;
}) {
  const [detail, setDetail] = useState<{kind:SocialFeedView["kind"];card:SocialActivityCard}|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const [showBag,setShowBag]=useState(false);
  const [attestInfo,setAttestInfo]=useState(false);
  const [requesting,setRequesting]=useState(false),[pendingRequests,setPendingRequests]=useState<number|null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const base = `/api/social/activity/${encodeURIComponent(card.id)}`;
  async function act(operation: () => Promise<void>, success = "") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await operation(); if (live.current && success) setMessage(success); }
    catch (error) { if (live.current) setMessage(socialErrorMessage(error)); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  }
  async function like() {
    await socialRequest(`${base}/likes`, accessToken, { method: card.likedByMe ? "DELETE" : "POST", body: { expectedHash: card.currentHash } });
    await onRefresh();
  }
  async function attest() {
    await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/attest`, accessToken, { method: "POST", body: { targetUserId: card.targetUserId, expectedVersion: card.sourceVersion, expectedHash: card.currentHash } });
    await onRefresh();
  }
  const highlighted=card.achievements.length>0;
  function openScorecard(open: (destination?: ScorecardDestination) => void,initialPlayerId?:string) {
    void act(async () => { const result = await socialRequest<{ data: SocialActivityCard }>(base, accessToken); if (live.current) {
      if (!sameSocialActivity(card, result.data) || !result.data.round) throw new Error("La tarjeta ya no está disponible.");
      if (onOpenScorecard) onOpenScorecard(result.data,initialPlayerId); else open(socialScorecardDestination(result.data,initialPlayerId));
    } });
  }
  function openDetail(kind: SocialFeedView["kind"]) {
    void act(async () => { const result = await socialRequest<{data:SocialActivityCard}>(base, accessToken);
      if (!sameSocialActivity(card, result.data)) throw new Error("La publicación ya no está disponible.");
      if (live.current) { if (onOpenDetail) onOpenDetail(kind, result.data); else setDetail({kind,card:result.data}); }
    });
  }
  async function share() {
    const url = new URL("/", window.location.origin); if (card.round) url.searchParams.set("card", `social:${card.id}`); else { url.searchParams.set("feedActivity",card.id);url.searchParams.set("feedView","comments"); }
    if (navigator.share) { try { await navigator.share({title:`The Backyard · ${card.author.displayName}`,url:url.href}); } catch(error) { if (!(error instanceof Error && error.name === "AbortError")) throw error; } }
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url.href); if(live.current)setMessage("Enlace copiado. El acceso conserva los permisos de la publicación."); }
    else throw new Error("No se pudo compartir el enlace en este navegador.");
  }
  const renderPost = (open: (destination?: ScorecardDestination) => void) => <article className={`${styles.card} ${highlighted?styles.highlight:""}`} aria-label={`${card.type === "EQUIPMENT_UPDATED" ? "Equipo" : "Ronda"} de ${card.author.displayName}`}>
    <header className={styles.author}><button type="button" className={styles.avatarLink} disabled={!onOpenProfile} aria-label={`Ver perfil de ${card.author.displayName}`} onClick={()=>onOpenProfile?.(card.author.userId)}><ProfileAvatarMedia className={styles.avatar} value={card.author.avatarUrl} fallback={card.author.displayName[0] || "G"} /></button><div>{onOpenProfile?<button type="button" className={styles.authorLink} onClick={()=>onOpenProfile(card.author.userId)}>{card.author.displayName}</button>:<b>{card.author.displayName}</b>}<small>{card.type==="EQUIPMENT_UPDATED"?"Actualizó su bolsa de golf":card.round?`jugó en ${card.round.courseName}`:"Consiguió un logro"}</small><small>{socialRelativeTime(card.createdAt)}{card.round?.teeName ? ` · ${card.round.teeName}` : ""} · {card.audience === "OWNER" ? "Privado" : "Amigos"}</small></div><details className={styles.postMenu}><summary aria-label={`Acciones de la publicación de ${card.author.displayName}`}><BackyardIcon name="more" size={23}/></summary><div>{onOpenProfile&&<button type="button" onClick={()=>onOpenProfile(card.author.userId)}>Ver perfil</button>}{card.round&&<button type="button" disabled={busy} onClick={() => openScorecard(open)}>Ver scorecard</button>}<span>{dateLabel(card.createdAt)} · {card.audience==="OWNER"?"Sólo tú":"Compartido con amigos"}</span></div></details></header>
    {highlighted&&<p className={styles.highlightLabel}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8"/></svg>{card.achievements[0]}</p>}
    {card.round && <><div className={styles.statsHeading}><span>ESTADÍSTICAS DE RONDA</span><small>{card.round.holesPlayed} hoyos{card.round.totalOnly?" · Total declarado":""}</small></div><ScoreSummary round={card.round}/><div className={styles.roundLinks}>{!!card.round.leaderboard?.length && <button type="button" disabled={busy} onClick={() => openDetail("results")}><BackyardIcon name="players" size={17}/><span>{card.round.leaderboard.length} {card.round.leaderboard.length===1?"jugador":"jugadores"} · <b>Ver resultados</b></span><BackyardIcon name="chevron" size={13}/></button>}<button type="button" className={styles.scorecardLink} disabled={busy} onClick={() => openScorecard(open)}><span>{card.round.totalOnly ? "Ver resumen" : "Ver tarjeta"}</span><BackyardIcon name="chevron" size={14}/></button></div></>}
    {card.type==="EQUIPMENT_UPDATED"&&<section className={styles.bag}><h3>Mi bolsa de golf</h3><small>EQUIPO ACTUAL</small>{card.equipment?.items.length?<>{(showBag?card.equipment.items:card.equipment.items.slice(0,3)).map(item=><div className={styles.bagItem} key={item.id}>{item.imageUrl?<Image src={item.imageUrl} alt={`${item.brand} ${item.model}`} width={56} height={56} loading="lazy" />:<span className={styles.clubIcon}><BackyardIcon name={item.category==="Bola"?"ball":"club"} size={30}/></span>}<small>{item.category}</small><b>{item.brand} {item.model}</b></div>)}{card.equipment.items.length>3&&<button type="button" className={styles.bagLink} aria-expanded={showBag} onClick={()=>setShowBag(v=>!v)}>{showBag?"Mostrar menos":"Ver bolsa"} ›</button>}</>:<p>El resumen del equipo no está disponible por el momento.</p>}</section>}

    {card.courseEvent && <p>Nuevo campo jugado · fuera de su Home Club</p>}
    {card.achievements.length > 0 && <>{card.achievements.length > 1 && <ul className={styles.achievements}>{card.achievements.slice(1,4).map((item) => <li key={item}>{item}</li>)}</ul>}{card.author.userId === viewerId && onOpenAchievements && <button type="button" className="textButton" onClick={onOpenAchievements}>Ver en Logros</button>}</>}
    {card.round && <div className={styles.attest}><button type="button" className={styles.attestStatus} aria-label="Qué significa Atest" aria-expanded={attestInfo} onClick={()=>setAttestInfo(v=>!v)}>{card.isAttestedByMe ? '✓ Atestada por ti' : card.attestCount ? `✓ Atestada por ${card.attestCount} ${card.attestCount===1?'compañero':'compañeros'}` : (pendingRequests??card.pendingAttestRequests??0) ? 'Solicitud pendiente' : 'Atest pendiente'}</button>{card.author.userId===viewerId&&card.remainingAttestCompanions!==0&&<button type="button" className={styles.requestAttest} onClick={()=>setRequesting(true)}>{card.attestCount>0||(pendingRequests??card.pendingAttestRequests??0)>0?'Solicitar a otro compañero':'Solicitar Atest'}</button>}{attestInfo&&<p>{card.attestCount} {card.attestCount===1?'compañero confirmó':'compañeros confirmaron'} · Versión {card.sourceVersion}.{card.author.userId===viewerId&&<> {pendingRequests??card.pendingAttestRequests??0} solicitudes pendientes. {card.remainingAttestCompanions===0?'Sin más compañeros disponibles.':card.remainingAttestCompanions!==undefined?`${card.remainingAttestCompanions} compañeros disponibles para solicitar.`:''}</>} Confirmación de compañeros. No es certificación GHIN/WHS.</p>}</div>}
    <div className={styles.postActions} aria-label="Reacciones de la publicación">
      <button type="button" disabled={busy} aria-label={`Me gusta · ${card.likesCount}`} aria-pressed={card.likedByMe} onClick={() => void act(like)}><BackyardIcon name="heart" size={23}/><span>{card.likesCount}</span></button>
      <button type="button" disabled={busy} aria-label={`Comentar · ${card.commentsCount}`} onClick={() => openDetail("comments")}><BackyardIcon name="comment" size={23}/><span>{card.commentsCount}</span></button>
      <button type="button" className={styles.share} disabled={busy} onClick={() => void act(share)}><svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m3 10 18-7-7 18-3-8-8-3ZM11 13 21 3"/></svg><span>Compartir</span></button>
    </div>
    {card.canAttest && !card.isAttestedByMe && card.author.userId!==viewerId && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que esta tarjeta corresponde a la ronda que jugué con este jugador. No es una certificación oficial.")) void act(attest, "Atest guardado para esta versión de la tarjeta."); }}>Atestar</button>}

    {card.requiresParticipantConfirmation && card.participantPlayerKey && <button type="button" className={styles.attestButton} disabled={busy} onClick={() => { if (window.confirm("Confirmo que participé en esta ronda con mi cuenta. Esto no atesta todavía la tarjeta de otro jugador.")) void act(async () => { await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/links`, accessToken, { method: "POST", body: { playerKey: card.participantPlayerKey, expectedVersion: card.sourceVersion, expectedHash: card.currentHash } }); await onRefresh(); }, "Participación confirmada. Ya puedes revisar y atestar la tarjeta."); }}>Confirmar mi participación</button>}

    {message && <p className={styles.notice} role="status">{message}</p>}
    {requesting&&<AttestRequestDialog card={card} accessToken={accessToken} onClose={()=>setRequesting(false)} onSent={pending=>{setPendingRequests(pending);void onRefresh().then(()=>{if(live.current)setPendingRequests(null);}).catch(error=>{if(live.current)setMessage(socialErrorMessage(error));});}}/>}
  </article>;
  const render = (open:(destination?:ScorecardDestination)=>void) => detail ? <><div hidden={detail.kind==="comments"}>{renderPost(open)}</div>{detail.kind==="comments" ? <SocialActivityComments card={detail.card} viewerId={viewerId} accessToken={accessToken} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} onRefresh={onRefresh} onClose={()=>setDetail(null)} onOpenProfile={onOpenProfile}/> : <SocialRoundResults card={detail.card} onClose={()=>setDetail(null)} onOpenProfile={onOpenProfile} onOpenScorecard={playerId=>{setDetail(null);openScorecard(open,playerId);}}/>}</> : renderPost(open);
  return onOpenScorecard ? <SocialPostContent render={render} onOpen={()=>undefined}/> : <ScorecardNavigationBoundary originLabel="publicación">{open=><SocialPostContent render={render} onOpen={open}/>}</ScorecardNavigationBoundary>;
}

const notificationLabels: Record<SocialNotification["type"], string> = { like: "Recibiste un like", comment: "Nuevo comentario", attest: "Un compañero atestó tu tarjeta", attest_request:"Te solicitan atestar una ronda", friend_achievement: "Un amigo consiguió un logro", equipment: "Un amigo actualizó su bolsa", friend_request: "Nueva solicitud de amistad", friend_accepted:"Solicitud aceptada",group_invite:"Invitación a un grupo",round_invite:"Invitación a una ronda",round_finished:"Resultados de ronda disponibles", round_started: "Un compañero inició una ronda contigo · Ver ronda", scorecard_ready: "Registraron tu tarjeta · Revisar tarjeta" };

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
export function CloudSocialActivity({ viewerId, accessToken, localRoundId, friendsOnly = false, includeOwn = false, authorId, onOpenAchievements, onOpenProfile, viewerName, viewerAvatarUrl }: { viewerId: string; accessToken?: string; localRoundId?: string; friendsOnly?: boolean; includeOwn?: boolean; authorId?:string; onOpenAchievements?: () => void; onOpenProfile?:(userId:string)=>void;viewerName?:string;viewerAvatarUrl?:string|null }) {
  const emptyCopy=useVisualContent().find(c=>c.target_key==="home_empty_feed")?.values;
  const [cards, setCards] = useState<SocialActivityCard[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [destination, setDestination] = useState<ScorecardDestination>();
  const [scorecardOrigin, setScorecardOrigin] = useState("Feed");
  const paging = useRef(false);
  const refreshRevision=useRef(0);
  const live = useRef(true);
  const feed=useRef<HTMLElement>(null), sentinel=useRef<HTMLDivElement>(null);
  const [pull,setPull]=useState(0),[refreshing,setRefreshing]=useState(false);
  const path = `/api/social/activity${localRoundId ? `?localRoundId=${encodeURIComponent(localRoundId)}` : friendsOnly ? `?friendsOnly=true${includeOwn?"&includeOwn=true":""}` : authorId ? `?authorId=${encodeURIComponent(authorId)}` : ""}`;
  const invalidateRefresh=useCallback(()=>{refreshRevision.current++;paging.current=false;},[]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken || paging.current) return;
    const revision=++refreshRevision.current;paging.current=true;setRefreshing(true);
    try { const result = await socialRequest<SocialActivityPage>(path, accessToken, { signal });
      if (live.current && !signal?.aborted) { setCards(mergeSocialCards([],result.data)); setNextCursor(result.nextCursor); setMessage(""); }
    } finally {if(revision===refreshRevision.current){paging.current=false;if(live.current)setRefreshing(false);}}
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
    return () => { live.current = false; controller.abort();invalidateRefresh(); };
  }, [accessToken, refresh,invalidateRefresh]);
    useEffect(() => {
      if (!accessToken) return;
      const params=new URLSearchParams(window.location.search);
      // A profile owns its child card; the background Home feed must not restore it too.
      if(params.get('player')&&(!authorId||params.get('playerTab')!=='activity'))return;
      const id = new URLSearchParams(window.location.search).get("card")?.match(/^social:([0-9a-f-]{36})$/i)?.[1];
    if (!id) return;
    const controller = new AbortController();
    void socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(id)}`, accessToken, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && result.data.id === id && result.data.round && (!authorId||result.data.author.userId===authorId)) { setScorecardOrigin(authorId?'perfil del jugador':new URLSearchParams(window.location.search).get("feedView")==="results"?"resultados":"Feed"); setDestination(socialScorecardDestination(result.data)); } })
      .catch(error => { if (!controller.signal.aborted) setMessage(socialErrorMessage(error)); });
    return () => controller.abort();
    }, [accessToken,authorId]);
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
  return <ScorecardNavigationBoundary destination={destination} originLabel={scorecardOrigin}>{open => <SocialFeedViews accessToken={accessToken} viewerId={viewerId} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} onRefresh={refreshCard} onOpenProfile={onOpenProfile} onOpenScorecard={(detail,playerId) => { const next = socialScorecardDestination(detail,playerId); setScorecardOrigin("resultados"); setDestination(next); open(next); }}>{openDetail => <section ref={feed} className={styles.feed} aria-label="Actividad social guardada">
    {!localRoundId && <header className={styles.feedHeading}><span>ACTIVIDAD DE AMIGOS</span><small>Más recientes</small></header>}
    {(pull>0||refreshing&&!loading)&&<div className={styles.pullIndicator} role="status">{refreshing?"Actualizando…":pull>=64?"Suelta para actualizar":"Desliza para actualizar"}</div>}
    {loading && <SocialFeedSkeleton/>}
    {message && <div className={styles.notice} role="status"><p>{message}</p><button type="button" onClick={() => void refresh().catch((error) => setMessage(socialErrorMessage(error)))}>Reintentar</button></div>}
    {!loading && !message && !cards.length && <div className={styles.empty}><h2>{localRoundId ? "Tarjeta social pendiente" : emptyCopy?.active!==false&&emptyCopy?.title ? emptyCopy.title : "Aún no hay actividad compartida"}</h2><p>{localRoundId ? "Estará disponible cuando la ronda termine y su sincronización cloud se confirme." : emptyCopy?.active!==false&&emptyCopy?.body ? emptyCopy.body : "Tus preferencias controlan qué compartes. No publicamos rondas en tiempo real."}</p></div>}
    {cards.map((card) => <SocialRoundActivityCard key={`${viewerId}:${card.id}`} card={card} viewerId={viewerId} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} accessToken={accessToken} onRefresh={()=>refreshCard(card.id)} onOpenAchievements={onOpenAchievements} onOpenProfile={onOpenProfile} onOpenDetail={openDetail} onOpenScorecard={(detail,playerId) => { const next = socialScorecardDestination(detail,playerId); setScorecardOrigin("Feed"); setDestination(next); open(next); }} />)}
    {nextCursor && <div ref={sentinel} className={styles.loadMore} role="status">{loadingMore?"Cargando más actividad…":""}<button type="button" className={styles.accessibleMore} disabled={loadingMore||refreshing} onClick={()=>void loadMore()}>Cargar siguiente página</button></div>}
  </section>}</SocialFeedViews>}</ScorecardNavigationBoundary>;
}
