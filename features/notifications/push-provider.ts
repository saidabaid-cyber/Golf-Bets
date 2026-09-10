import type { NotificationEvent } from "./domain";

export type PushDeliveryResult = { delivered: boolean; code: "sent" | "not_configured" | "rejected" };

export interface PushNotificationProvider {
  readonly id: string;
  readonly configured: boolean;
  send(event: NotificationEvent): Promise<PushDeliveryResult>;
}

export const unavailablePushProvider: PushNotificationProvider = {
  id: "push-unavailable",
  configured: false,
  async send() { return { delivered: false, code: "not_configured" }; },
};
