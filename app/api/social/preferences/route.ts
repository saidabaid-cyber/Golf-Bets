import { getPreferences, updatePreferences } from "../../../../lib/social-activity.server";
import { socialHttp, socialBody } from "../../../../lib/social-http.server";
const ownerScoped = { ownerScoped: true } as const;
export async function GET(request: Request) { return socialHttp(request, getPreferences, ownerScoped); }
export async function PUT(request: Request) { return socialHttp(request, async (context) => updatePreferences(context, await socialBody(request)), ownerScoped); }

