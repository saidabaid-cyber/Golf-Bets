import { listNotifications } from "../../../../lib/social-activity.server";
import { socialHttp, socialBody, socialId } from "../../../../lib/social-http.server";
export async function GET(request: Request) { return socialHttp(request, listNotifications); }
export async function PATCH(request: Request) {
  return socialHttp(request, async context => {
    const body = await socialBody(request);
    const id = socialId(body.id);
    const { error } = await context.client.from("notification_events_v2").update({ read_at: body.read === false ? null : new Date().toISOString() }).eq("id", id).eq("recipient_id", context.userId);
    if (error) throw error;
    return listNotifications(context);
  });
}
