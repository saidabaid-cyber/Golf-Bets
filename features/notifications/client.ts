import type { NotificationEventType } from "./domain";
import type { SocialNotification, SocialNotificationPage } from "../../lib/social-activity-contract";
import { socialRequest } from "../../lib/social-activity-client";
export type EventPreferencePage = {enabled:boolean;data:Array<{type:NotificationEventType;inApp:boolean;push:boolean;updatedAt:string|null}>};
export const NOTIFICATIONS_CHANGED = "backyard:notifications-changed";
export function notificationsChanged() { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); }
export async function unreadNotificationEvents(token: string, signal?: AbortSignal) {
  const events: SocialNotification[] = []; let cursor: string | null = null;
  for (let page=0;page<20;page++) {
    const result: SocialNotificationPage = await socialRequest(`/api/social/notifications?unreadOnly=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,token,{signal});
    events.push(...result.data); if (!result.nextCursor) return events;
    if (result.nextCursor === cursor) throw new Error("No pudimos actualizar los avisos."); cursor=result.nextCursor;
  }
  throw new Error("No pudimos confirmar todos los avisos pendientes.");
}
