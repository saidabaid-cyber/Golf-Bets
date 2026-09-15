import { listActivity } from "../../../../lib/social-activity.server";
import { socialHttp } from "../../../../lib/social-http.server";
export async function GET(request: Request) {
  return socialHttp(request, (context) => {
    const query = new URL(request.url).searchParams;
    return listActivity(context, { localRoundId: query.get("localRoundId") || undefined, limit: 30, cursor: query.get("cursor") || undefined });
  });
}

