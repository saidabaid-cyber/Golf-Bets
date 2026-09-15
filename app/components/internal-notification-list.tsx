"use client";
import type { InternalNotification } from "../../lib/internal-notifications";

export function InternalNotificationList({ notifications, onOpen, onReadChange }: {
  notifications: InternalNotification[];
  onOpen: (item: InternalNotification) => void;
  onReadChange: (item: InternalNotification, read: boolean) => void;
}) {
  return <section className="card" aria-label="Avisos internos"><ol className="internalNotificationList">{notifications.map((item) => {
    const canOpen = (item.kind === "round" && Boolean(item.roundId)) || (item.kind === "group" && Boolean(item.groupId));
    const date = new Date(item.occurredAt.length === 10 ? `${item.occurredAt}T12:00:00-06:00` : item.occurredAt);
    const label = Number.isNaN(date.valueOf()) ? item.occurredAt : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", ...(item.occurredAt.includes("T") ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: "America/Mexico_City" }).format(date);
    const content = <><span className="internalNotificationDot" aria-hidden="true" /><div><b>{item.title}</b><small>{item.detail}</small><time dateTime={item.occurredAt}>{label}</time></div>{canOpen && <strong className="betaFeedChevron" aria-hidden="true">›</strong>}</>;
    return <li key={item.eventKey}>{canOpen ? <button type="button" className={`internalNotificationItem ${item.unread ? "unread" : ""}`} onClick={() => onOpen(item)} aria-label={`${item.unread ? "Nuevo: " : ""}${item.title} Abrir`}>{content}</button> : <article className={`internalNotificationItem ${item.unread ? "unread" : ""}`}>{content}</article>}<div className="internalNotificationActions"><button type="button" className="secondary" onClick={() => onReadChange(item, item.unread)} aria-label={`Marcar “${item.title}” como ${item.unread ? "leído" : "no leído"}`}>{item.unread ? "Marcar como leído" : "Marcar como no leído"}</button></div></li>;
  })}</ol></section>;
}
