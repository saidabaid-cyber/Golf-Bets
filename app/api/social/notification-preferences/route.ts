import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { NOTIFICATION_PREFERENCE_TYPES, type NotificationPreferenceType } from "../../../../features/notifications/domain";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:BACKYARD_AI_PRIVATE_HEADERS});
async function read(account: Extract<Awaited<ReturnType<typeof authenticatedRequest>>, {ok:true}>) {
  const [events, master, social] = await Promise.all([
    account.client.from("notification_preferences_v2").select("event_type,in_app,push,updated_at").eq("user_id",account.userId).abortSignal(AbortSignal.timeout(8_000)),
    account.client.from("user_preferences").select("notifications_enabled,notification_internal_enabled").eq("user_id",account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle(),
    account.client.from('social_activity_preferences_v3').select('notify_like,notify_comment,notify_attest,notify_friend_request,notify_friend_achievement,notify_equipment').eq('user_id',account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle(),
  ]);
  if (events.error || master.error || social.error) throw new Error("NOTIFICATION_PREFERENCES_UNAVAILABLE");
  const gates:Record<string,boolean|undefined|null>={like:social.data?.notify_like,comment:social.data?.notify_comment,attest:social.data?.notify_attest,attest_request:social.data?.notify_attest,friend_request:social.data?.notify_friend_request,friend_achievement:social.data?.notify_friend_achievement,equipment:social.data?.notify_equipment};
  return {enabled:master.data?.notifications_enabled === true && master.data?.notification_internal_enabled !== false, data:NOTIFICATION_PREFERENCE_TYPES.map(type => {
    const row = events.data?.find(item => item.event_type === type);
    const legacy=gates[type]??!['friend_achievement','equipment'].includes(type);
    return {type, inApp:(row ? row.in_app === true : true)&&legacy, push:row?.push === true, updatedAt:row?.updated_at || null};
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
      || !NOTIFICATION_PREFERENCE_TYPES.includes(value.type as NotificationPreferenceType)
      || (!Object.hasOwn(value,"inApp") && !Object.hasOwn(value,"push"))
      || (["inApp","push"] as const).some(key => Object.hasOwn(value,key) && typeof value[key] !== "boolean")) return json({error:"Preferencia no válida."},400);
    // The RPC updates both existing gates in one transaction under this JWT's RLS.
    const saved=await account.client.rpc('set_my_notification_event_preference_v1',{
      requested_type:value.type,requested_in_app:typeof value.inApp==='boolean'?value.inApp:null,
      requested_push:typeof value.push==='boolean'?value.push:null,
    }).abortSignal(AbortSignal.timeout(8_000));
    if(saved.error)throw new Error('NOT_CONFIRMED');
    const verified=await read(account),row=verified.data.find(item=>item.type===value.type);
    if(!row||(typeof value.inApp==='boolean'&&row.inApp!==value.inApp)||(typeof value.push==='boolean'&&row.push!==value.push))throw new Error('NOT_CONFIRMED');
    return json(verified);

  } catch { return json({error:"No pudimos confirmar el cambio de preferencia."},503); }
}
