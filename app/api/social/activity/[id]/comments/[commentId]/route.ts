import { updateComment, deleteComment } from "../../../../../../../lib/social-activity.server";
import { socialHttp, socialId, socialBody, requiredString } from "../../../../../../../lib/social-http.server";
type Route = { params: Promise<{ id: string; commentId: string }> };
export async function PATCH(request: Request, route: Route) {
  return socialHttp(request, async (context) => {
    const body = await socialBody(request); const { id, commentId } = await route.params;
    return updateComment(context, socialId(id), socialId(commentId), { text: requiredString(body.text, 500), expectedHash: requiredString(body.expectedHash) });
  });
}
export async function DELETE(request: Request, route: Route) {
  return socialHttp(request, async (context) => {
    const body = await socialBody(request); const { id, commentId } = await route.params;
    return deleteComment(context, socialId(id), socialId(commentId), { expectedHash: requiredString(body.expectedHash) });
  });
}

