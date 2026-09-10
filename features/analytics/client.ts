"use client";

import { isProductEventName, sanitizeProductEventMetadata, type ProductEventMetadata, type ProductEventName } from "./domain";

export async function recordProductEvent(input: { eventId: string; eventName: ProductEventName; metadata?: ProductEventMetadata; accessToken?: string | null; occurredAt?: string }) {
  if (!input.accessToken || !isProductEventName(input.eventName)) return { recorded: false as const, reason: "AUTH_REQUIRED" as const };
  try {
    const response = await fetch("/api/analytics/events", { method: "POST", headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ eventId: input.eventId, eventName: input.eventName, metadata: sanitizeProductEventMetadata(input.metadata), occurredAt: input.occurredAt || new Date().toISOString() }) });
    return response.ok ? { recorded: true as const } : { recorded: false as const, reason: "SERVER_REJECTED" as const };
  } catch { return { recorded: false as const, reason: "OFFLINE" as const }; }
}
