"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NOTIFICATION_FILTERS, normalizeNotifications, notificationDestination, notificationTime, type NotificationFilter, type NotificationItem } from "../../features/notifications/presentation";
import { NOTIFICATIONS_CHANGED, notificationsChanged, type EventPreferencePage } from "../../features/notifications/client";
import type { SocialActivityCard, SocialNotification, SocialNotificationPage } from "../../lib/social-activity-contract";
import type { ConnectionPage } from "../../lib/social-connections";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import { useGroupInvitationInbox } from "./group-invitations";
import { useBackyardAccount } from "./account-provider";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { RoundParticipationCard } from "./round-participation-card";
import { SocialRoundActivityCard } from "./cloud-social-activity";
import { BackyardIcon } from "./backyard-icon";
import styles from "./notification-center.module.css";
import { useGolfNavigation } from "./golf-object-navigation";

type Detail = {kind:"round"|"activity"|"group";id:string};
function detailFromUrl(): Detail|null {
  const params=new URLSearchParams(location.search),kind=params.get("notice"),id=params.get("resource");
  return ["round","activity","group"].includes(kind||"") && id && /^[0-9a-f-]{36}$/i.test(id) ? {kind:kind as Detail["kind"],id} : null;
}
function writeDetail(detail:Detail|null) {
  const url=new URL(location.href);url.searchParams.delete("notice");url.searchParams.delete("resource");
  if(detail){url.searchParams.set("notice",detail.kind);url.searchParams.set("resource",detail.id);}
  window.history.replaceState(window.history.state,"",url);
}
export function NotificationRow({item,busy,onOpen,onRead,onFriend,onGroupAccept}:{item:NotificationItem;busy:boolean;onOpen:()=>void;onRead:(read:boolean)=>void;onFriend:(action:"ACCEPTED"|"REJECTED")=>void;onGroupAccept:()=>void}) {
  return <li className={`${styles.row} ${item.unread ? styles.unread : ""}`}>
    <span className={styles.avatar}>{item.avatar ? <ProfileAvatarMedia value={item.avatar} fallback={item.title[0]} /> : <BackyardIcon name={item.category === "Rondas" ? "flag" : item.category === "Grupos" ? "players" : item.type === "friend_achievement" ? "spark" : "players"}/>}</span>
    <div className={styles.rowBody}><button type="button" className={styles.openRow} disabled={busy} onClick={onOpen}><span className={styles.rowTitle}><b title={item.title}>{item.title}</b>{item.unread && <i aria-label="Sin leer" />}{item.createdAt && <time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time>}</span><span className={styles.message}>{item.message}</span></button>
      {item.type === "friend_request" && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={()=>onFriend("ACCEPTED")}>Aceptar</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>onFriend("REJECTED")}>Rechazar</button>{item.personId && <button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>Ver perfil</button>}</div>}
      {item.invitation && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={onGroupAccept}>Unirme</button><button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>Ver invitación</button></div>}
      {item.category === "Rondas" && <button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>{item.type === "scorecard_ready" ? "Revisar tarjeta" : item.type === "round_finished" ? "Ver resultados" : "Ver ronda"} ›</button>}
    </div>
    {item.readIds.length > 0 && <details className={styles.rowMenu}><summary aria-label={`Acciones de ${item.title}`}>⋯</summary><button type="button" disabled={busy} onClick={()=>onRead(item.unread)}>{item.unread ? "Marcar como leído" : "Marcar como no leído"}</button></details>}
  </li>;
}
export function NotificationCenter({viewerId,accessToken,onBack,onPreferences,onFriend}:{viewerId:string;accessToken?:string;onBack:()=>void;onPreferences:()=>void;onFriend:(id?:string)=>void}) {
  const navigation=useGolfNavigation();
  const {retryCloudSync}=useBackyardAccount();
  const [events,setEvents]=useState<SocialNotification[]>([]),[prefs,setPrefs]=useState<EventPreferencePage|null>(null),[cursor,setCursor]=useState<string|null>(null);
  const [filter,setFilter]=useState<NotificationFilter>("Todas"),[message,setMessage]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[loadingMore,setLoadingMore]=useState(false);
  const [detail,setDetail]=useState<Detail|null>(null),[activity,setActivity]=useState<SocialActivityCard|null>(null);
  const live=useRef(true),writing=useRef(false),revision=useRef(0),paging=useRef(false);
  const groups=useGroupInvitationInbox({accessToken,onAccepted:async()=>{await retryCloudSync();notificationsChanged();}});
  const groupReload=groups.reload;
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!accessToken){setLoading(false);return;}
    const current=++revision.current;
    const [page,preferences]=await Promise.allSettled([
      socialRequest<SocialNotificationPage>("/api/social/notifications",accessToken,{signal}),
      socialRequest<EventPreferencePage>("/api/social/notification-preferences",accessToken,{signal}),
    ]);
    if(!live.current||signal?.aborted||current!==revision.current)return;
    if(page.status === "fulfilled"){setEvents(page.value.data);setCursor(page.value.nextCursor);}
    if(preferences.status === "fulfilled")setPrefs(preferences.value);
    if(page.status === "rejected" || preferences.status === "rejected")setMessage("Esta información no está disponible por el momento. Puedes reintentar.");
    setLoading(false);
  },[accessToken]);
  useEffect(()=>{
    live.current=true;const controller=new AbortController();
    const update=()=>{if(document.visibilityState!=="hidden"){void refresh(controller.signal);void groupReload().catch(()=>{});}};
    void refresh(controller.signal);setDetail(detailFromUrl());
    const timer=setInterval(update,30_000);window.addEventListener("focus",update);document.addEventListener("visibilitychange",update);window.addEventListener(NOTIFICATIONS_CHANGED,update);
    return()=>{live.current=false;controller.abort();clearInterval(timer);window.removeEventListener("focus",update);document.removeEventListener("visibilitychange",update);window.removeEventListener(NOTIFICATIONS_CHANGED,update);};
  },[refresh,groupReload]);
  useEffect(()=>{
    if(!accessToken || detail?.kind!=="activity"){setActivity(null);return;}
    const controller=new AbortController();void socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${encodeURIComponent(detail.id)}`,accessToken,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setActivity(result.data);}).catch(error=>{if(!controller.signal.aborted)setMessage(socialErrorMessage(error));});
    return()=>controller.abort();
  },[accessToken,detail]);
  const items=useMemo(()=>normalizeNotifications(prefs?.enabled ? events : [],prefs?.enabled && prefs.data.find(item=>item.type==="group_invite")?.inApp ? groups.invitations : []),[events,prefs,groups.invitations]);
  const shown=filter === "Todas" ? items : items.filter(item=>item.category===filter);
  async function read(item:NotificationItem,read:boolean) {
    if(!accessToken)return;
    for(const id of item.readIds)await socialRequest("/api/social/notifications",accessToken,{method:"PATCH",body:{id,read}});
    await refresh();notificationsChanged();
  }
  async function act(operation:()=>Promise<unknown>) {
    if(writing.current)return;writing.current=true;setBusy(true);setMessage("");
    try{await operation();}catch(error){if(live.current)setMessage(socialErrorMessage(error));}
    finally{writing.current=false;if(live.current)setBusy(false);}
  }
  async function open(item:NotificationItem) {
    const kind=notificationDestination(item);
    if(item.unread)await read(item,true);
    if(kind === "friend"){if(navigation&&item.personId)navigation.open({kind:"player",id:item.personId});else onFriend(item.personId);return;}
    if(navigation && kind!=="group") { navigation.open(kind==="round"?{kind:"round",id:item.resourceId,source:"shared"}:{kind:"activity",id:item.resourceId}); return; }
    const next={kind,id:item.invitation?.id || item.resourceId};writeDetail(next);setDetail(next);
  }
  async function friend(item:NotificationItem,action:"ACCEPTED"|"REJECTED") {
    if(!accessToken)return;
    const result=await socialRequest<ConnectionPage>("/api/social/connections",accessToken,{method:"POST",body:{action,id:item.resourceId}});
    if(!result.requests.some(request=>request.id===item.resourceId && request.state===action))throw new Error("No pudimos confirmar el cambio de la solicitud.");
    await read(item,true);await refresh();notificationsChanged();
    if(live.current)setMessage(action === "ACCEPTED" ? "Solicitud aceptada. Ya pueden encontrarse en Amigos." : "Solicitud rechazada.");
  }
  async function loadMore() {
    if(!accessToken || !cursor || paging.current)return;paging.current=true;setLoadingMore(true);
    try{const page=await socialRequest<SocialNotificationPage>(`/api/social/notifications?cursor=${encodeURIComponent(cursor)}`,accessToken);
      if(live.current){setEvents(current=>[...new Map([...current,...page.data].map(item=>[item.id,item])).values()]);setCursor(page.nextCursor);}}
    catch(error){if(live.current)setMessage(socialErrorMessage(error));}finally{paging.current=false;if(live.current)setLoadingMore(false);}
  }
  function closeDetail(){writeDetail(null);setDetail(null);setActivity(null);}
  const invitation=detail?.kind==="group" ? groups.invitations.find(item=>item.id===detail.id) : null;
  return <section className={styles.screen} aria-label="Centro de notificaciones">
    <header className={styles.heading}><button type="button" className={styles.iconButton} aria-label={detail ? "Volver a Notificaciones" : "Volver"} onClick={detail ? closeDetail : onBack}>‹</button><div><h1>Notificaciones</h1><span className={styles.eyebrow}>GOLF MORE TOGETHER</span></div><button type="button" className={styles.iconButton} aria-label="Preferencias de notificaciones" onClick={onPreferences}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3h-4Zm2 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg></button></header>
    {!accessToken ? <div className={styles.empty}><h2>Tu centro de notificaciones</h2><p>Inicia sesión para ver tus avisos y actuar sobre ellos.</p></div> : detail ? <>
      {detail.kind === "round" && <RoundParticipationCard key={detail.id} roundId={detail.id} accessToken={accessToken} onConfirmed={async()=>{await retryCloudSync();await refresh();notificationsChanged();}}/>}
      {detail.kind === "activity" && (activity ? <SocialRoundActivityCard key={activity.id} card={activity} viewerId={viewerId} accessToken={accessToken} onRefresh={async()=>{const result=await socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${activity.id}`,accessToken);if(live.current)setActivity(result.data);await refresh();notificationsChanged();}}/> : !message && <div className={styles.skeleton} role="status" aria-label="Cargando actividad"/>)}
      {detail.kind === "group" && <div className={styles.settings}><h2>{invitation?.group_name || "Invitación de grupo"}</h2><p>{invitation ? "Juega y comparte más golf con este grupo." : "Esta invitación ya no está disponible."}</p>{invitation?.state === "PENDING" && Date.parse(invitation.expires_at)>Date.now() && <button type="button" className={styles.primary} disabled={groups.busy} onClick={()=>void groups.accept(invitation.id)}>Unirme</button>}</div>}
    </> : <>
      <nav className={styles.filters} aria-label="Filtros de notificaciones">{NOTIFICATION_FILTERS.map(label=><button type="button" key={label} aria-pressed={filter===label} onClick={()=>setFilter(label)}>{label}</button>)}</nav>
      <div className={styles.toolbar}><button type="button" className={styles.textButton} disabled={busy || !events.some(item=>!item.readAt)} onClick={()=>void act(async()=>{await socialRequest("/api/social/notifications",accessToken,{method:"PATCH",body:{all:true,read:true}});await refresh();notificationsChanged();})}>Marcar todas como leídas</button></div>
      {(loading || (!groups.loadedAt && !groups.message)) && <div className={styles.skeleton} role="status" aria-label="Cargando notificaciones"/>}
      {!loading && groups.loadedAt>0 && !shown.length && !message && !groups.message && <div className={styles.empty}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0v5l-3 4h18l-3-4V8M10 21h4"/></svg><h2>Todo al día</h2><p>{prefs?.enabled === false ? "Tus avisos están en pausa. Puedes activarlos en Preferencias." : "No tienes notificaciones pendientes. Sigue jugando y conectado con tus amigos."}</p></div>}
      <ol className={styles.list}>{shown.map(item=><NotificationRow key={item.key} item={item} busy={busy || groups.busy} onOpen={()=>void act(()=>open(item))} onRead={value=>void act(()=>read(item,value))} onFriend={action=>void act(()=>friend(item,action))} onGroupAccept={()=>void groups.accept(item.invitation!.id)}/>)}</ol>
      {cursor && <button type="button" className={styles.secondary} disabled={loadingMore || busy} onClick={()=>void loadMore()}>{loadingMore ? "Cargando…" : "Ver más notificaciones"}</button>}
    </>}
    {(message || groups.message) && <p role="status" className={styles.notice}>{message || groups.message}</p>}
    {message && accessToken && <button type="button" className={styles.secondary} disabled={busy} onClick={()=>{setMessage("");void refresh();void groupReload().catch(()=>{});}}>Actualizar</button>}
  </section>;
}
