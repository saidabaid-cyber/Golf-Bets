import { socialHttp, requiredString, socialId } from "../../../../../lib/social-http.server";
import { readSharedRoundCard } from "../../../../../lib/shared-round-participants.server";

export async function GET(request: Request) {
  return socialHttp(request, context => {
    const params = new URL(request.url).searchParams;
    const localId = params.get("localRoundId");
    return readSharedRoundCard(context, localId ? requiredString(localId, 120) : socialId(params.get("roundId")), Boolean(localId));
  });
}
