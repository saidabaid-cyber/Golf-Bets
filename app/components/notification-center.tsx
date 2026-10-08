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
import {AttestCardReview} from './attest-card-review';
import {SocialActivityComments} from './social-feed-detail';

type Detail = {kind:"round"|"activity"|"group";id:string;view?:'comments';commentId?:string};
function detailFromUrl(): Detail|null {
  const params=new URLSearchParams(location.search),kind=params.get("notice"),id=params.get("resource");
  const comment=params.get('comment');
  return ["round","activity","group"].includes(kind||"") && id && /^[0-9a-f-]{36}$/i.test(id) ? {kind:kind as Detail["kind"],id,...(params.get('noticeView')==='comments'?{view:'comments' as const,...(comment&&/^[0-9a-f-]{36}$/i.test(comment)?{commentId:comment}:{})}:{})} : null;
}
function writeDetail(detail:Detail|null) {
  const url=new URL(location.href);url.searchParams.delete("notice");url.searchParams.delete("resource");
  url.searchParams.delete('noticeView');url.searchParams.delete('comment');
  if(!detail){url.searchParams.delete('card');url.searchParams.delete('cardHole');url.searchParams.delete('cardPlayer');}
  if(detail){url.searchParams.set("notice",detail.kind);url.searchParams.set("resource",detail.id);}
  if(detail?.view){url.searchParams.set('noticeView',detail.view);if(detail.commentId)url.searchParams.set('comment',detail.commentId);}
  window.history.replaceState(window.history.state,"",url);
}
export function NotificationRow({item,busy,onOpen,onRead,onFriend,onGroupAccept}:{item:NotificationItem;busy:boolean;onOpen:()=>void;onRead:(read:boolean)=>void;onFriend:(action:"ACCEPTED"|"REJECTED")=>void;onGroupAccept:()=>void}) {
  return <li className={`${styles.row} ${item.unread ? styles.unread : ""}`}>
    <span className={styles.avatar} data-notice-type={item.type}>{item.avatar ? <ProfileAvatarMedia value={item.avatar} fallback={item.title[0]} /> : <BackyardIcon name={item.type==='like'?'heart':item.type==='comment'?'comment':item.category==='Atest'?'check':item.category === "Rondas" ? "flag" : item.category === "Grupos" ? "players" : item.type === "friend_achievement" ? "spark" : "players"}/>}</span>
    <div className={styles.rowBody}><button type="button" className={styles.openRow} disabled={busy} onClick={onOpen}><span className={styles.rowTitle}><b title={item.title}>{item.title}</b>{item.unread && <i aria-label="Sin leer" />}{item.createdAt && <time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time>}</span><span className={styles.message}>{item.message}</span></button>
      {item.type === "friend_request" && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={()=>onFriend("ACCEPTED")}>Aceptar</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>onFriend("REJECTED")}>Rechazar</button>{item.personId && <button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>Ver perfil</button>}</div>}
      {item.invitation && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={onGroupAccept}>Unirme</button><button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>Ver invitación</button></div>}
      {(item.category === "Rondas"||item.category==='Atest'||item.category==='Social') && <button type="button" className={styles.textButton} disabled={busy} onClick={onOpen}>{item.type==='comment'?'Ver comentario':item.type === "scorecard_ready" || item.category==='Atest' ? "Revisar tarjeta" : item.type === "round_finished" ? "Ver resultados" : item.category==='Social'?'Ver publicación':"Ver ronda"} ›</button>}
    </div>
    {item.readIds.length > 0 && <details className={styles.rowMenu}><summary aria-label={`Acciones de ${item.title}`}>⋯</summary><button type="button" disabled={busy} onClick={()=>onRead(item.unread)}>{item.unread ? "Marcar como leído" : "Marcar como no leído"}</button></details>}
  </li>;
}
export function NotificationCenter({viewerId,accessToken,onBack,onPreferences,onFriend}:{viewerId:string;accessToken?:string;onBack:()=>void;onPreferences:()=>void;onFriend:(id?:string)=>void}) {
  const {retryCloudSync}=useBackyardAccount();
  const [events,setEvents]=useState<SocialNotification[]>([]),[prefs,setPrefs]=useState<EventPreferencePage|null>(null),[cursor,setCursor]=useState<string|null>(null);
  const [filter,setFilter]=useState<NotificationFilter>("Todas"),[message,setMessage]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[loadingMore,setLoadingMore]=useState(false);
  const [detail,setDetail]=useState<Detail|null>(null),[activity,setActivity]=useState<SocialActivityCard|null>(null);
  const [requests,setRequests]=useState<SocialNotification[]>([]);
  const [requestCursor,setRequestCursor]=useState<string|null>(null);
  const [reviewHash,setReviewHash]=useState<string|null>(null);
  const live=useRef(true),writing=useRef(false),revision=useRef(0),paging=useRef(false);
  const groups=useGroupInvitationInbox({accessToken,onAccepted:async()=>{await retryCloudSync();notificationsChanged();}});
  const groupReload=groups.reload;
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!accessToken){setLoading(false);return;}
    const current=++revision.current;
    const [page,preferences,inbox]=await Promise.allSettled([
      socialRequest<SocialNotificationPage>("/api/social/notifications",accessToken,{signal}),
      socialRequest<EventPreferencePage>("/api/social/notification-preferences",accessToken,{signal}),
      socialRequest<SocialNotificationPage>("/api/social/attest-requests",accessToken,{signal}),
    ]);
    if(!live.current||signal?.aborted||current!==revision.current)return;
    if(page.status === "fulfilled"){setEvents(page.value.data);setCursor(page.value.nextCursor);}
    if(preferences.status === "fulfilled")setPrefs(preferences.value);
    if(inbox.status==='fulfilled'){setRequests(inbox.value.data);setRequestCursor(inbox.value.nextCursor);}
    if(inbox.status==='rejected')setMessage('No pudimos consultar las solicitudes de Atest. Actualiza para reintentar.');
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
  const items=useMemo(()=>normalizeNotifications([...requests,...(prefs?.enabled ? events : [])],prefs?.enabled && prefs.data.find(item=>item.type==="group_invite")?.inApp ? groups.invitations : []),[events,prefs,groups.invitations,requests]);
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
    if(kind === "friend"){onFriend(item.personId);return;}
    const request=[...requests,...events].find(r=>r.type==='attest_request'&&r.activityId===item.resourceId);
    setReviewHash(item.type==='attest_request'?request?.attestRequest?.expectedHash??null:null);
    const next:Detail={kind,id:item.invitation?.id || item.resourceId,...(item.type==='comment'?{view:'comments',...(item.commentId?{commentId:item.commentId}:{})}:{})};writeDetail(next);setDetail(next);
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
  async function loadMoreRequests(){
    if(!accessToken||!requestCursor||paging.current)return;paging.current=true;setLoadingMore(true);
    try{const page=await socialRequest<SocialNotificationPage>(`/api/social/attest-requests?cursor=${encodeURIComponent(requestCursor)}`,accessToken);if(page.nextCursor===requestCursor)throw new Error('No pudimos continuar las solicitudes.');if(live.current){setRequests(current=>[...new Map([...page.data,...current].map(r=>[r.activityId,r])).values()]);setRequestCursor(page.nextCursor);}}
    catch(e){if(live.current)setMessage(socialErrorMessage(e));}finally{paging.current=false;if(live.current)setLoadingMore(false);}
  }
  function closeDetail(){writeDetail(null);setDetail(null);setActivity(null);setReviewHash(null);}
  const invitation=detail?.kind==="group" ? groups.invitations.find(item=>item.id===detail.id) : null;
  const attestRequest=detail?.kind==='activity'?[...requests,...events].find(r=>r.type==='attest_request'&&r.activityId===detail.id):undefined;
  return <section className={styles.screen} aria-label="Centro de notificaciones">
    <header className={styles.heading}><button type="button" className={styles.iconButton} aria-label={detail ? "Volver a Notificaciones" : "Volver"} onClick={detail ? closeDetail : onBack}>‹</button><div><h1>Notificaciones</h1><span className={styles.eyebrow}>GOLF MORE TOGETHER</span></div><button type="button" className={styles.iconButton} aria-label="Preferencias de notificaciones" onClick={onPreferences}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3h-4Zm2 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg></button></header>
    {!accessToken ? <div className={styles.empty}><h2>Tu centro de notificaciones</h2><p>Inicia sesión para ver tus avisos y actuar sobre ellos.</p></div> : detail ? <>
      {detail.kind === "round" && <RoundParticipationCard key={detail.id} roundId={detail.id} accessToken={accessToken} onConfirmed={async()=>{await retryCloudSync();await refresh();notificationsChanged();}}/>}
      {detail.kind === "activity" && (activity ? detail.view==='comments' ? <SocialActivityComments card={activity} viewerId={viewerId} accessToken={accessToken} initialCommentId={detail.commentId} originLabel="Notificaciones" onRefresh={refresh} onClose={closeDetail}/> : (reviewHash!==null||attestRequest) ? <AttestCardReview card={activity} viewerId={viewerId} accessToken={accessToken} expectedHash={reviewHash??attestRequest?.attestRequest?.expectedHash} onBack={closeDetail} onRefresh={async()=>{const r=await socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${activity.id}`,accessToken);if(live.current)setActivity(r.data);await refresh();notificationsChanged();}}/> : <SocialRoundActivityCard key={activity.id} card={activity} viewerId={viewerId} accessToken={accessToken} onRefresh={async()=>{const result=await socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${activity.id}`,accessToken);if(live.current)setActivity(result.data);await refresh();notificationsChanged();}}/> : !message && <div className={styles.skeleton} role="status" aria-label="Cargando actividad"/>)}
      {detail.kind === "group" && <div className={styles.settings}><h2>{invitation?.group_name || "Invitación de grupo"}</h2><p>{invitation ? "Juega y comparte más golf con este grupo." : "Esta invitación ya no está disponible."}</p>{invitation?.state === "PENDING" && Date.parse(invitation.expires_at)>Date.now() && <button type="button" className={styles.primary} disabled={groups.busy} onClick={()=>void groups.accept(invitation.id)}>Unirme</button>}</div>}
    </> : <>
      <nav className={styles.filters} aria-label="Filtros de notificaciones">{NOTIFICATION_FILTERS.map(label=><button type="button" key={label} aria-pressed={filter===label} onClick={()=>setFilter(label)}>{label}</button>)}</nav>
      {requests.length>0&&<p className={styles.message}>Solicitudes de Atest: siguen pendientes aunque leas el aviso. Revisa y confirma únicamente la tarjeta vigente.</p>}
      <div className={styles.toolbar}><button type="button" className={styles.textButton} disabled={busy || !events.some(item=>!item.readAt)} onClick={()=>void act(async()=>{await socialRequest("/api/social/notifications",accessToken,{method:"PATCH",body:{all:true,read:true}});await refresh();notificationsChanged();})}>Marcar todas como leídas</button></div>
      {(loading || (!groups.loadedAt && !groups.message)) && <div className={styles.skeleton} role="status" aria-label="Cargando notificaciones"/>}
      {!loading && groups.loadedAt>0 && !shown.length && !message && !groups.message && <div className={styles.empty}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0v5l-3 4h18l-3-4V8M10 21h4"/></svg><h2>Todo al día</h2><p>{prefs?.enabled === false ? "Tus avisos están en pausa. Puedes activarlos en Preferencias." : "No tienes notificaciones pendientes. Sigue jugando y conectado con tus amigos."}</p></div>}
      <ol className={styles.list}>{shown.map(item=><NotificationRow key={item.key} item={item} busy={busy || groups.busy} onOpen={()=>void act(()=>open(item))} onRead={value=>void act(()=>read(item,value))} onFriend={action=>void act(()=>friend(item,action))} onGroupAccept={()=>void groups.accept(item.invitation!.id)}/>)}</ol>
      {cursor && <button type="button" className={styles.secondary} disabled={loadingMore || busy} onClick={()=>void loadMore()}>{loadingMore ? "Cargando…" : "Ver más notificaciones"}</button>}
      {requestCursor&&<button type="button" className={styles.secondary} disabled={loadingMore||busy} onClick={()=>void loadMoreRequests()}>{loadingMore?'Cargando…':'Ver más solicitudes de Atest'}</button>}
    </>}
    {(message || groups.message) && <p role="status" className={styles.notice}>{message || groups.message}</p>}
    {message && accessToken && <button type="button" className={styles.secondary} disabled={busy} onClick={()=>{setMessage("");void refresh();void groupReload().catch(()=>{});}}>Actualizar</button>}
  </section>;
}
