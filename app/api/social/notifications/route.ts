import { listNotifications } from "../../../../lib/social-activity.server";
import { socialHttp, socialBody, socialId } from "../../../../lib/social-http.server";
import { NOTIFICATION_EVENT_TYPES } from "../../../../features/notifications/domain";
const centerTypes = [...NOTIFICATION_EVENT_TYPES,"like","comment","attest","friend_achievement","equipment"];
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, cursor = params.get("cursor") || "0";
  if (!/^\d{1,6}$/.test(cursor) || Number(cursor) > 100_000) return Response.json({error:"Página inválida."},{status:400,headers:{"cache-control":"private, no-store"}});
  return socialHttp(request, ctx => listNotifications(ctx,{offset:Number(cursor),unreadOnly:params.get("unreadOnly") === "true"}));
}
export async function PATCH(request: Request) {
  return socialHttp(request, async context => {
    const body = await socialBody(request);
    if (Object.keys(body).some(key=>!["read","id","all"].includes(key)) || typeof body.read !== "boolean"
      || (body.all !== true && typeof body.id !== "string")) throw Object.assign(new Error(),{code:"INVALID_REQUEST",status:400});
    let query = context.client.from("notification_events_v2").update({ read_at: body.read ? new Date().toISOString() : null })
      .eq("recipient_id", context.userId).in("event_type",centerTypes);
    if (body.all === true) { if (!body.read) throw Object.assign(new Error(),{code:"INVALID_REQUEST",status:400}); query = query.is("read_at",null); }
    else query = query.eq("id",socialId(body.id));
    const { data, error } = await query.select("id").abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    if (body.all !== true && !data?.length) throw Object.assign(new Error(),{code:"NOT_FOUND",status:404});
    return listNotifications(context);
  });
}
