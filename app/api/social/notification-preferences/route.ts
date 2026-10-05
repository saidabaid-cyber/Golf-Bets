import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from "../../../../features/notifications/domain";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:BACKYARD_AI_PRIVATE_HEADERS});
async function read(account: Extract<Awaited<ReturnType<typeof authenticatedRequest>>, {ok:true}>) {
  const [events, master] = await Promise.all([
    account.client.from("notification_preferences_v2").select("event_type,in_app,push,updated_at").eq("user_id",account.userId).abortSignal(AbortSignal.timeout(8_000)),
    account.client.from("user_preferences").select("notifications_enabled").eq("user_id",account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle(),
  ]);
  if (events.error || master.error) throw new Error("NOTIFICATION_PREFERENCES_UNAVAILABLE");
  return {enabled:master.data?.notifications_enabled === true, data:NOTIFICATION_EVENT_TYPES.map(type => {
    const row = events.data?.find(item => item.event_type === type);
    return {type, inApp:row ? row.in_app === true : true, push:row?.push === true, updatedAt:row?.updated_at || null};
  })};
}
export async function GET(request: NextRequest) {
  try { const account = await authenticatedRequest(request); if (!account.ok) return json({error:account.error},account.status); return json(await read(account)); }
  catch { return json({error:"No pudimos consultar tus preferencias."},503); }
}
export async function PATCH(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({error:"Solicitud no permitida."},403);
  if (!isJsonRequest(request)) return json({error:"Solicitud no válida."},415);
  try {
    const account = await authenticatedRequest(request); if (!account.ok) return json({error:account.error},account.status);
    const body = await readJsonBodyWithLimit(request,1_024);
    const value = body.ok && body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value as Record<string,unknown> : null;
    if (!value || Object.keys(value).some(key => !["type","inApp","push"].includes(key))
      || !NOTIFICATION_EVENT_TYPES.includes(value.type as NotificationEventType)
      || (!Object.hasOwn(value,"inApp") && !Object.hasOwn(value,"push"))
      || (["inApp","push"] as const).some(key => Object.hasOwn(value,key) && typeof value[key] !== "boolean")) return json({error:"Preferencia no válida."},400);
    // Initialize legacy missing rows without replacing an existing choice.
    const initialized = await account.client.from("notification_preferences_v2")
      .upsert({user_id:account.userId,event_type:value.type,in_app:true,push:false},
        {onConflict:"user_id,event_type",ignoreDuplicates:true}).abortSignal(AbortSignal.timeout(8_000));
    if (initialized.error) throw new Error("NOT_CONFIRMED");
    // Update only the requested channel; another device's push choice is retained.
    const patch = { ...(typeof value.inApp === "boolean" ? {in_app:value.inApp} : {}),
      ...(typeof value.push === "boolean" ? {push:value.push} : {}), updated_at:new Date().toISOString() };
    const saved = await account.client.from("notification_preferences_v2").update(patch)
      .eq("user_id",account.userId).eq("event_type",value.type).select("event_type,in_app,push,updated_at")
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (saved.error || !saved.data || (Object.hasOwn(patch,"in_app") && saved.data.in_app !== patch.in_app)
      || (Object.hasOwn(patch,"push") && saved.data.push !== patch.push)) throw new Error("NOT_CONFIRMED");
    return json(await read(account));
  } catch { return json({error:"No pudimos confirmar el cambio de preferencia."},503); }
}
