import { getActivity } from "../../../../../lib/social-activity.server";
import { socialHttp, socialId } from "../../../../../lib/social-http.server";
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  return socialHttp(request, async (context) => getActivity(context, socialId((await route.params).id)));
}

