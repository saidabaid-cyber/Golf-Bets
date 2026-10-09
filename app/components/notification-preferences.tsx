"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationPreferenceType } from "../../features/notifications/domain";
import { notificationsChanged, type EventPreferencePage } from "../../features/notifications/client";
import type { SocialActivityPreferences } from "../../lib/social-activity-contract";
import { requestAccountNotificationPreferences, type AccountNotificationPreferenceResponse } from "../../lib/account-notification-preferences";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import styles from "./notification-center.module.css";

const EVENT_GROUPS: Array<{title:string;items:Array<[NotificationPreferenceType,string,string]>}> = [
  {title:"Amigos",items:[["friend_request","Solicitudes de amistad","Cuando alguien quiera ser tu amigo."],["friend_accepted","Solicitud aceptada","Cuando acepten tu solicitud de amistad."]]},
  {title:"Atest",items:[["attest_request","Solicitudes de Atest","Cuando un compañero te solicite revisar una tarjeta."]]},
  {title:"Grupos",items:[["group_invite","Invitaciones a grupos","Cuando te inviten a jugar con un grupo."]]},
  {title:"Rondas",items:[["round_invite","Invitaciones a rondas","Cuando te inviten a una ronda."],["round_started","Rondas iniciadas","Cuando un compañero inicie una ronda contigo."],["round_finished","Resultados de ronda","Cuando estén disponibles los resultados."],["scorecard_ready","Tarjetas para confirmar","Cuando puedas revisar tu tarjeta."]]},
];
const SOCIAL_ITEMS = [["notifyLike","Likes","Cuando reaccionen a tu actividad."],["notifyComment","Comentarios","Cuando comenten tu actividad."],["notifyAttest","Confirmaciones de tarjeta","Avísame cuando un compañero confirme una tarjeta."],["notifyFriendAchievement","Logros de amigos","Cuando tus amigos consigan nuevos logros."],["notifyEquipment","Actualizaciones de equipo","Cuando tus amigos actualicen su bolsa."]] as const;
const SOCIAL_EVENT = {notifyLike:'like',notifyComment:'comment',notifyAttest:'attest',notifyFriendAchievement:'friend_achievement',notifyEquipment:'equipment'} as const;
export function NotificationSwitch({label,copy,checked,disabled,onChange}:{label:string;copy:string;checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void}) {
  return <div className={styles.setting}><div><b>{label}</b><p>{copy}</p></div><button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={styles.switch} onClick={()=>onChange(!checked)}><span /></button></div>;
}
export function NotificationPreferenceControls({events,social,delivery,busy,onMaster,onEvent,onSocial}:{
  events:EventPreferencePage|null;social:SocialActivityPreferences|null;delivery:AccountNotificationPreferenceResponse|null;busy:boolean;
  onMaster:(value:boolean)=>void;onEvent:(type:NotificationPreferenceType,value:boolean)=>void;onSocial:(key:typeof SOCIAL_ITEMS[number][0],value:boolean)=>void;
}) {
  const disabled=busy || !events?.enabled;
  return <>
    {events && <div className={styles.master}><NotificationSwitch label="Recibir notificaciones en The Backyard" copy="Pausa los avisos sin perder tus preferencias individuales." checked={events.enabled} disabled={busy} onChange={onMaster}/></div>}
    {EVENT_GROUPS.map(group=><section key={group.title} className={styles.preferenceSection}><h2>{group.title}</h2><div className={styles.settings}>{group.items.map(([type,label,copy])=><NotificationSwitch key={type} label={label} copy={copy} checked={Boolean(events?.data.find(item=>item.type===type)?.inApp && (type!=="friend_request" || social?.notifyFriendRequest))} disabled={disabled || !events || (type==="friend_request" && !social)} onChange={value=>onEvent(type,value)}/>)}</div></section>)}
    <section className={styles.preferenceSection}><h2>Actividad social</h2><div className={styles.settings}>{SOCIAL_ITEMS.map(([key,label,copy])=><NotificationSwitch key={key} label={label} copy={copy} checked={social?.[key]===true && events?.data.find(item=>item.type===SOCIAL_EVENT[key])?.inApp!==false} disabled={disabled || !social} onChange={value=>onSocial(key,value)}/>)}</div></section>
    <section className={styles.preferenceSection}><h2>Entrega de avisos</h2><div className={styles.settings}>
      <NotificationSwitch label="Notificaciones push" copy={delivery?.delivery.push.configured ? "La configuración de entrega está disponible; consulta tus permisos en Configuración." : delivery ? "Push todavía no está disponible en este entorno." : "No pudimos comprobar la disponibilidad de push."} checked={false} disabled onChange={()=>{}}/>
      <NotificationSwitch label="Email" copy={delivery?.delivery.email.configured ? "Consulta las preferencias de entrega en Configuración." : delivery ? "La entrega por email todavía no está disponible." : "No pudimos comprobar la disponibilidad de email."} checked={false} disabled onChange={()=>{}}/>
    </div></section>
  </>;
}
export function NotificationPreferences({accessToken,onBack,onMasterChange}:{accessToken?:string;onBack:()=>void;onMasterChange:(enabled:boolean)=>Promise<boolean>}) {
  const [events,setEvents]=useState<EventPreferencePage|null>(null),[social,setSocial]=useState<SocialActivityPreferences|null>(null),[delivery,setDelivery]=useState<AccountNotificationPreferenceResponse|null>(null);
  const [message,setMessage]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const live=useRef(true),writing=useRef(false);
  const reload=useCallback(async(signal?:AbortSignal)=>{
    if (!accessToken) {setLoading(false);return false;}
    const result=await Promise.allSettled([
      socialRequest<EventPreferencePage>("/api/social/notification-preferences",accessToken,{signal}),
      socialRequest<{data:SocialActivityPreferences}>("/api/social/preferences",accessToken,{signal}),
      requestAccountNotificationPreferences(accessToken,undefined,signal),
    ]);
    if (!live.current || signal?.aborted) return false;
    if(result[0].status!=="fulfilled"||result[1].status!=="fulfilled"){setMessage("No pudimos confirmar tus preferencias. Puedes reintentar.");setLoading(false);return false;}
    if (result[0].status === "fulfilled") setEvents(result[0].value);
    if (result[1].status === "fulfilled") setSocial(result[1].value.data);
    if (result[2].status === "fulfilled") setDelivery(result[2].value);
    if (result.some(item=>item.status === "rejected")) setMessage("Parte de tus preferencias no está disponible. Puedes reintentar.");
    setLoading(false);
    return result.every(item=>item.status === "fulfilled");
  },[accessToken]);
  useEffect(()=>{live.current=true;const controller=new AbortController();void reload(controller.signal);return()=>{live.current=false;controller.abort();};},[reload]);
  async function save(operation:()=>Promise<unknown>) {
    if (writing.current) return; writing.current=true;setBusy(true);setMessage("");
    try {await operation();const verified=await reload();notificationsChanged();if(live.current && verified)setMessage("Preferencias guardadas.");}
    catch(error) {await reload();if(live.current)setMessage(socialErrorMessage(error));}
    finally {writing.current=false;if(live.current)setBusy(false);}
  }
  async function eventChange(type:NotificationPreferenceType,value:boolean) {
    if(!accessToken)return;
    await socialRequest<EventPreferencePage>("/api/social/notification-preferences",accessToken,{method:"PATCH",body:{type,inApp:value}});

  }
  return <section className={styles.screen} aria-label="Preferencias de notificaciones">
    <header className={styles.heading}><button type="button" className={styles.iconButton} aria-label="Volver a Notificaciones" onClick={onBack}>‹</button><div><span className={styles.eyebrow}>TUS PREFERENCIAS</span><h1>Notificaciones</h1></div></header>
    <p className={styles.intro}>Elige qué avisos quieres recibir en The Backyard.</p>
    {!accessToken ? <p>Inicia sesión para guardar tus preferencias.</p> : <>
      {loading && <div className={styles.skeleton} role="status" aria-label="Cargando preferencias" />}
      <NotificationPreferenceControls events={events} social={social} delivery={delivery} busy={busy}
        onMaster={value=>void save(async()=>{if(!await onMasterChange(value))throw new Error("No se pudo guardar la preferencia.");})}
        onEvent={(type,value)=>void save(()=>eventChange(type,value))}
        onSocial={(key,value)=>void save(()=>socialRequest('/api/social/notification-preferences',accessToken!,{method:'PATCH',body:{type:SOCIAL_EVENT[key],inApp:value}}))}/>
    </>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {!loading && ((message && message!=="Preferencias guardadas.") || !events || !social || !delivery) && accessToken && <button type="button" className={styles.secondary} onClick={()=>void reload()}>Reintentar</button>}
  </section>;
}
