"use client";
import { recordProductEvent } from "./client";
import type { ProductEventName } from "./domain";
export function recordCareerEvent(eventName:ProductEventName,feature:string,accessToken?:string|null) {
  if(!accessToken)return;
  void recordProductEvent({eventId:`career_${crypto.randomUUID()}`,eventName,accessToken,metadata:{surface:"career",feature}});
}
