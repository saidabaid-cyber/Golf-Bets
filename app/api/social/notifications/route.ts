import { listNotifications } from "../../../../lib/social-activity.server";
import { socialHttp } from "../../../../lib/social-http.server";
export async function GET(request: Request) { return socialHttp(request, listNotifications); }

