export const NOTIFICATION_EVENT_TYPES = ["friend_request", "friend_accepted", "group_invite", "round_invite", "round_started", "round_finished", "scorecard_ready"] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationChannel = "IN_APP" | "PUSH";

export type NotificationPreference = { userId: string; type: NotificationEventType; inApp: boolean; push: boolean; updatedAt: string };
export type NotificationEvent = { id: string; recipientId: string; type: NotificationEventType; resourceType: "FRIEND" | "GROUP" | "ROUND" | "SCORECARD"; resourceId: string; createdAt: string; readAt?: string | null };

export function defaultNotificationPreferences(userId: string, updatedAt: string): NotificationPreference[] {
  return NOTIFICATION_EVENT_TYPES.map((type) => ({ userId, type, inApp: true, push: false, updatedAt }));
}

export function deliveryChannels(event: NotificationEvent, preferences: readonly NotificationPreference[], pushConfigured: boolean): NotificationChannel[] {
  const preference = preferences.find((candidate) => candidate.userId === event.recipientId && candidate.type === event.type);
  if (!preference) return ["IN_APP"];
  return [...(preference.inApp ? ["IN_APP" as const] : []), ...(preference.push && pushConfigured ? ["PUSH" as const] : [])];
}
