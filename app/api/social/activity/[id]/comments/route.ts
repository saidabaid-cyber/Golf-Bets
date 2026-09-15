import { listComments, createComment } from "../../../../../../lib/social-activity.server";
import { socialHttp, socialId, socialBody, requiredString } from "../../../../../../lib/social-http.server";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Route) { return socialHttp(request, async (context) => listComments(context, socialId((await route.params).id))); }
export async function POST(request: Request, route: Route) {
  return socialHttp(request, async (context) => {
    const body = await socialBody(request);
    return createComment(context, socialId((await route.params).id), { text: requiredString(body.text, 500), expectedHash: requiredString(body.expectedHash) });
  });
}

