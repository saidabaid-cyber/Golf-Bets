import { attestRound } from "../../../../../../lib/social-activity.server";
import { socialHttp, socialId, socialBody, requiredString } from "../../../../../../lib/social-http.server";
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return socialHttp(request, async (context) => {
    const body = await socialBody(request);
    return attestRound(context, socialId((await route.params).id), { targetUserId: socialId(body.targetUserId), expectedVersion: Number(body.expectedVersion), expectedHash: requiredString(body.expectedHash) });
  });
}

