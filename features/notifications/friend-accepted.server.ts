import type { SupabaseClient } from "@supabase/supabase-js";

type NotificationContext = { userId: string; client: SupabaseClient; admin: SupabaseClient };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Notification-only adapter. The canonical friendship transition remains authoritative. */
export async function notifyFriendAccepted(ctx: NotificationContext, requestId: string) {
  if (!UUID.test(requestId)) return "NOT_ELIGIBLE";
  const signal = AbortSignal.timeout(4_000);
  try {
    const request = await ctx.client.from("friend_requests").select("id,requester_id,addressee_id,state")
      .eq("id", requestId).eq("addressee_id", ctx.userId).eq("state", "ACCEPTED")
      .abortSignal(signal).maybeSingle();
    const row = request.data;
    if (request.error || !row || row.id !== requestId || row.addressee_id !== ctx.userId
      || row.state !== "ACCEPTED" || !UUID.test(row.requester_id) || row.requester_id === ctx.userId) return "NOT_ELIGIBLE";
    const preference = await ctx.admin.from("notification_preferences_v2").select("user_id,event_type,in_app")
      .eq("user_id", row.requester_id).eq("event_type", "friend_accepted")
      .abortSignal(signal).maybeSingle();
    if (preference.error) return "DELIVERY_UNAVAILABLE";
    if (preference.data?.in_app === false) return "MUTED";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`friend-accepted-v1:${row.requester_id}:${requestId}`));
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${((parseInt(hex[16],16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const saved = await ctx.admin.from("notification_events_v2").upsert({id,recipient_id:row.requester_id,
      event_type:"friend_accepted",resource_type:"FRIEND",resource_id:requestId},
      {onConflict:"recipient_id,id",ignoreDuplicates:true}).abortSignal(signal);
    return saved.error ? "DELIVERY_UNAVAILABLE" : "PERSISTED";
  } catch { return "DELIVERY_UNAVAILABLE"; }
}
