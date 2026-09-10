"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PersonalActivity } from "../../lib/golf-insights";
import type { SocialProfile } from "../../features/social/domain";
import {
  deriveInternalNotifications,
  emptyInternalNotificationReadState,
  persistInternalNotificationReadState,
  readInternalNotificationReadState,
  markAllInternalNotificationsReadInStorage,
  setInternalNotificationRead,
  type InternalNotification,
  type InternalNotificationReadState,
} from "../../lib/internal-notifications";
import { SocialConnectionsPanel } from "./social-connections-panel";

export type SocialFeedProps = {
  activity: PersonalActivity[];
  identityUserId: string;
  accessToken?: string;
  knownProfiles: SocialProfile[];
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (value: boolean) => void;
  onOpenRound: (roundId: string) => void;
  onOpenGroup: (groupId: string) => void;
  onCreateRound: () => void;
  onOpenGroups: () => void;
};

function activityDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00-06:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = value.includes("T");
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "America/Mexico_City",
  }).format(date);
}

function openActivity(item: PersonalActivity, onOpenRound: (id: string) => void, onOpenGroup: (id: string) => void) {
  if (item.kind === "round" && item.roundId) onOpenRound(item.roundId);
  if (item.kind === "group" && item.groupId) onOpenGroup(item.groupId);
}

function canOpenActivity(item: PersonalActivity) {
  return (item.kind === "round" && Boolean(item.roundId)) || (item.kind === "group" && Boolean(item.groupId));
}

function InternalNotificationContent({ item }: { item: InternalNotification }) {
  return <>
    <span className="internalNotificationDot" aria-hidden="true" />
    <div><b>{item.title}</b><small>{item.detail}</small><time dateTime={item.occurredAt}>{activityDate(item.occurredAt)}</time></div>
    {canOpenActivity(item) && <strong className="betaFeedChevron" aria-hidden="true">›</strong>}
  </>;
}

type InternalNotificationListProps = {
  notifications: InternalNotification[];
  onOpen: (item: InternalNotification) => void;
  onReadChange: (item: InternalNotification, read: boolean) => void;
};

export function InternalNotificationList({ notifications, onOpen, onReadChange }: InternalNotificationListProps) {
  return <section className="card" aria-label="Avisos internos"><ol className="internalNotificationList">
    {notifications.map((item) => <li key={item.eventKey}>
      {canOpenActivity(item)
        ? <button type="button" className={`internalNotificationItem ${item.unread ? "unread" : ""}`} onClick={() => onOpen(item)} aria-label={`${item.unread ? "Nuevo: " : ""}${item.title} Abrir`}><InternalNotificationContent item={item} /></button>
        : <article className={`internalNotificationItem ${item.unread ? "unread" : ""}`}><InternalNotificationContent item={item} /></article>}
      <div className="internalNotificationActions">
        <button
          type="button"
          className="secondary"
          onClick={() => onReadChange(item, item.unread)}
          aria-label={`Marcar “${item.title}” como ${item.unread ? "leído" : "no leído"}`}
        >
          {item.unread ? "Marcar como leído" : "Marcar como no leído"}
        </button>
      </div>
    </li>)}
  </ol></section>;
}

export function SocialFeed({ activity, identityUserId, accessToken, knownProfiles, notificationsEnabled, onNotificationsEnabledChange, onOpenRound, onOpenGroup, onCreateRound, onOpenGroups }: SocialFeedProps) {
  const [view, setView] = useState<"activity" | "friends" | "notifications">("activity");
  const [readState, setReadState] = useState<InternalNotificationReadState>(emptyInternalNotificationReadState);
  const readStateRef = useRef<InternalNotificationReadState>(emptyInternalNotificationReadState());
  const [readStatus, setReadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [readMessage, setReadMessage] = useState("");

  useEffect(() => {
    setReadStatus("loading");
    setReadMessage("");
    const result = readInternalNotificationReadState(window.localStorage, identityUserId, activity);
    readStateRef.current = result.state;
    setReadState(result.state);
    if (result.ok) {
      setReadStatus("ready");
      if (result.recoveredMalformed) {
        const repair = persistInternalNotificationReadState(window.localStorage, identityUserId, result.state, activity);
        if (!repair.ok) {
          setReadStatus("error");
          setReadMessage("Restablecimos la lectura de avisos, pero el navegador no permitió conservar el cambio.");
        }
      }
      return;
    }
    setReadStatus("error");
    setReadMessage("No pudimos leer cuáles avisos habías visto. Tu actividad sigue disponible.");
  }, [activity, identityUserId]);

  const notifications = useMemo(() => deriveInternalNotifications(activity, readState), [activity, readState]);
  const unreadCount = notificationsEnabled ? notifications.filter((item) => item.unread).length : 0;

  function storeReadState(next: InternalNotificationReadState) {
    const result = persistInternalNotificationReadState(window.localStorage, identityUserId, next, activity);
    readStateRef.current = result.state;
    setReadState(result.state);
    if (result.ok) {
      setReadStatus("ready");
      setReadMessage("");
      return;
    }
    setReadStatus("error");
    setReadMessage("El aviso cambió en esta vista, pero el navegador no permitió guardar su estado de lectura.");
  }

  function openNotification(item: InternalNotification) {
    if (item.unread) storeReadState(setInternalNotificationRead(readStateRef.current, item, true));
    openActivity(item, onOpenRound, onOpenGroup);
  }

  function changeNotificationRead(item: InternalNotification, read: boolean) {
    storeReadState(setInternalNotificationRead(readStateRef.current, item, read));
  }

  function markAllRead() {
    const result = markAllInternalNotificationsReadInStorage(window.localStorage, identityUserId, activity);
    readStateRef.current = result.state;
    setReadState(result.state);
    if (result.ok) {
      setReadStatus("ready");
      setReadMessage("Todos los avisos quedaron marcados como leídos.");
      return;
    }
    setReadStatus("error");
    setReadMessage("Los avisos cambiaron en esta vista, pero el navegador no permitió guardar la lectura.");
  }

  return <section className="betaSocialScreen" aria-labelledby="beta-social-title">
    <section className="hero betaSocialHero"><div><span className="eyebrow">THE BACKYARD · SOCIAL</span><h1 id="beta-social-title">Social</h1><p>Tu actividad y avisos privados, basados sólo en datos guardados.</p></div></section>

    <aside className="betaPrivacyNotice"><span aria-hidden="true">●</span><p><b>Visible sólo en tu espacio.</b> Esta versión no publica actividad ni resultados a otros usuarios.</p></aside>

    <nav className="socialViewTabs" aria-label="Vistas de Social">
      <button type="button" className={`socialViewTab ${view === "activity" ? "active" : ""}`} aria-pressed={view === "activity"} onClick={() => setView("activity")}>Actividad</button>
      <button type="button" className={`socialViewTab ${view === "friends" ? "active" : ""}`} aria-pressed={view === "friends"} onClick={() => setView("friends")}>Amigos</button>
      <button type="button" className={`socialViewTab ${view === "notifications" ? "active" : ""}`} aria-pressed={view === "notifications"} onClick={() => setView("notifications")}>Avisos{unreadCount > 0 && <span className="socialUnreadBadge" aria-label={`${unreadCount} sin leer`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
    </nav>

    {view === "friends" && <SocialConnectionsPanel ownerId={identityUserId} accessToken={accessToken} directory={knownProfiles} />}

    {view === "activity" && (activity.length ? <section className="card betaFeedCard" aria-label="Actividad reciente">
      <ol className="betaFeedList">
        {activity.map((item) => {
          const canOpen = canOpenActivity(item);
          const content = <>
            <span className={`betaFeedIcon ${item.kind}`} aria-hidden="true">{item.kind === "round" ? "旗" : "●"}</span>
            <span className="betaFeedCopy"><b>{item.title}</b><small>{item.detail}</small><time dateTime={item.occurredAt}>{activityDate(item.occurredAt)}</time></span>
            {canOpen && <strong className="betaFeedChevron" aria-hidden="true">›</strong>}
          </>;
          const openLabel = item.kind === "group" ? "Abrir grupos" : "Abrir ronda";
          return <li key={item.id}>{canOpen ? <button type="button" onClick={() => openActivity(item, onOpenRound, onOpenGroup)} aria-label={`${item.title} ${openLabel}`}>{content}</button> : <div>{content}</div>}</li>;
        })}
      </ol>
    </section> : <section className="card betaSocialEmpty">
      <span className="betaEmptyFlag" aria-hidden="true">◎</span><h2>Aún no hay actividad.</h2><p>Al guardar una ronda o actualizar un grupo aparecerá aquí, sin publicar nada fuera de tu espacio.</p><div><button type="button" className="primary" onClick={onCreateRound}>Crear una ronda</button><button type="button" className="secondary" onClick={onOpenGroups}>Abrir grupos</button></div>
    </section>)}

    {view === "notifications" && !notificationsEnabled && <section className="card betaSocialEmpty">
      <span className="betaEmptyFlag" aria-hidden="true">○</span><h2>Avisos internos desactivados</h2><p>Puedes recibir aquí novedades de tus propias rondas y grupos. No pediremos permisos del teléfono.</p><div><button type="button" className="primary" onClick={() => onNotificationsEnabledChange(true)}>Activar avisos</button></div>
    </section>}

    {view === "notifications" && notificationsEnabled && <>
      {readStatus === "loading" ? <section className="card betaSocialEmpty" role="status"><h2>Cargando avisos…</h2><p>Estamos revisando qué actividad ya viste en este dispositivo.</p></section> : <>
        <div className="internalNotificationActions"><span className="hint" aria-live="polite">{unreadCount ? `${unreadCount} ${unreadCount === 1 ? "aviso nuevo" : "avisos nuevos"}` : "Todo al día"}</span><button type="button" className="secondary" disabled={unreadCount === 0} onClick={markAllRead}>Marcar todo como leído</button></div>
        {readMessage && <div className={readStatus === "error" ? "notice bad" : "notice"} role={readStatus === "error" ? "alert" : "status"}>{readMessage}</div>}
        {notifications.length ? <InternalNotificationList notifications={notifications} onOpen={openNotification} onReadChange={changeNotificationRead} /> : <section className="card betaSocialEmpty"><span className="betaEmptyFlag" aria-hidden="true">✓</span><h2>Aún no hay avisos.</h2><p>Cuando guardes una ronda o actualices un grupo, aparecerá aquí sin salir de tu espacio.</p></section>}
      </>}
    </>}
  </section>;
}
