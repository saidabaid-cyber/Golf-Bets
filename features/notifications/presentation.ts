import type { SocialNotification } from "../../lib/social-activity-contract";
import type { GroupInvitation } from "../../lib/group-invitations";

export const NOTIFICATION_FILTERS = ["Todas", "Amigos", "Grupos", "Rondas"] as const;
export type NotificationFilter = typeof NOTIFICATION_FILTERS[number];
export type NotificationItem = {
  key: string; type: SocialNotification["type"]; category: Exclude<NotificationFilter, "Todas">;
  title: string; message: string; avatar: string | null; createdAt: string | null;
  unread: boolean; pending: boolean; readIds: string[]; resourceId: string; personId?: string;
  invitation?: GroupInvitation;
};
export const NOTIFICATION_COPY: Record<SocialNotification["type"], string> = {
  friend_request: "Quiere ser tu amigo en The Backyard.", friend_accepted: "Aceptó tu solicitud de amistad.",
  group_invite: "Tienes una invitación a un grupo.", round_invite: "Te invitaron a una ronda.",
  round_started: "Inició una ronda contigo.", round_finished: "La ronda terminó. Resultados disponibles.",
  scorecard_ready: "Registraron una tarjeta contigo. Revísala y confirma tu participación.",
  like: "A alguien le gustó tu actividad.", comment: "Hay un nuevo comentario en tu actividad.",
  attest: "Un compañero confirmó tu tarjeta.", friend_achievement: "Un amigo consiguió un nuevo logro.", equipment: "Un amigo actualizó su equipo.",
};
export function notificationCategory(type: SocialNotification["type"]): NotificationItem["category"] {
  return type === "group_invite" ? "Grupos" : type.startsWith("round_") || type === "scorecard_ready" ? "Rondas" : "Amigos";
}
export function normalizeNotifications(events: readonly SocialNotification[], invitations: readonly GroupInvitation[], now = Date.now()): NotificationItem[] {
  const pending = invitations.filter(item => !item.outgoing && item.state === "PENDING" && Date.parse(item.expires_at) > now);
  const items = new Map<string, NotificationItem>();
  for (const event of events) {
    const invitation = event.type === "group_invite" ? pending.find(item => item.id === event.activityId || item.group_id === event.activityId) : undefined;
    const repeatable = ["like", "comment", "attest", "equipment", "friend_achievement"].includes(event.type);
    const key = invitation ? `group:${invitation.id}` : `event:${repeatable ? event.id : `${event.type}:${event.activityId}`}`;
    const previous = items.get(key);
    if (previous) { previous.readIds = [...new Set([...previous.readIds, event.id])]; previous.unread ||= !event.readAt; continue; }
    items.set(key, { key, type: event.type, category: notificationCategory(event.type),
      title: event.person?.displayName || (event.type === "friend_request" ? "Solicitud de amistad" : event.type === "group_invite" ? "Invitación a un grupo" : notificationCategory(event.type) === "Rondas" ? "Tu ronda" : "Actividad de tus compañeros"),
      message: `${NOTIFICATION_COPY[event.type]}${event.courseName ? ` · ${event.courseName}` : ""}`, avatar: event.person?.avatarUrl || null,
      createdAt: event.createdAt, unread: !event.readAt, pending: (event.type === "friend_request" && (!event.requestState || event.requestState === "PENDING")) || Boolean(invitation),
      readIds: [event.id], resourceId: event.activityId, personId: event.person?.userId, ...(invitation ? { invitation } : {}),
    });
  }
  for (const invite of pending) {
    const key = `group:${invite.id}`, existing = items.get(key);
    items.set(key, { key, type: "group_invite", category: "Grupos", title: "Invitación a un grupo", message: invite.group_name,
      avatar: null, createdAt: existing?.createdAt || null, unread: existing?.unread || false, pending: true,
      readIds: existing?.readIds || [], resourceId: invite.group_id, invitation: invite });
  }
  return [...items.values()].sort((a,b) => Date.parse(b.createdAt || "1970-01-01") - Date.parse(a.createdAt || "1970-01-01"));
}
export function notificationCounts(items: readonly NotificationItem[]) {
  const counts = { Todas: 0, Amigos: 0, Grupos: 0, Rondas: 0 };
  for (const item of items) if (item.unread) { counts.Todas++; counts[item.category]++; }
  return counts;
}
export function notificationTime(value: string | null, now = Date.now()) {
  if (!value) return "Invitación pendiente";
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) return "Fecha no disponible";
  const elapsed = Math.max(0, now - date.valueOf());
  if (elapsed < 60_000) return "Ahora";
  if (elapsed < 3_600_000) return `Hace ${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `Hace ${Math.floor(elapsed / 3_600_000)} h`;
  if (elapsed < 172_800_000) return "Ayer";
  return new Intl.DateTimeFormat("es-MX", { day:"numeric", month:"short", timeZone:"America/Mexico_City" }).format(date);
}
export function notificationDestination(item: NotificationItem): "friend" | "group" | "round" | "activity" {
  if (item.type === "friend_request" || item.type === "friend_accepted") return "friend";
  if (item.type === "group_invite") return "group";
  return item.category === "Rondas" ? "round" : "activity";
}
