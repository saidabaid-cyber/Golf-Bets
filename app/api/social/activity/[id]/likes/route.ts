import { mutateLike } from "../../../../../../lib/social-activity.server";
import { socialHttp, socialId, socialBody, requiredString } from "../../../../../../lib/social-http.server";
async function like(request: Request, route: { params: Promise<{ id: string }> }, liked: boolean) {
  return socialHttp(request, async (context) => {
    const body = await socialBody(request);
    return mutateLike(context, socialId((await route.params).id), { expectedHash: requiredString(body.expectedHash) }, liked);
  });
}
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) { return like(request, route, true); }
export async function DELETE(request: Request, route: { params: Promise<{ id: string }> }) { return like(request, route, false); }

