import { getPreferences, updatePreferences } from "../../../../lib/social-activity.server";
import { socialHttp, socialBody } from "../../../../lib/social-http.server";
export async function GET(request: Request) { return socialHttp(request, getPreferences); }
export async function PUT(request: Request) { return socialHttp(request, async (context) => updatePreferences(context, await socialBody(request))); }

