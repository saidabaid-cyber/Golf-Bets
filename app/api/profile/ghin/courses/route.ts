import { NextRequest } from "next/server";
import { readJsonBodyWithLimit } from "../../../../../lib/backyard-ai/server/http-security";
import { resolveGhinPreviewCapabilities } from "../../../../../lib/ghin/config";
import { SlidingWindowRateLimiter } from "../../../../../lib/ghin/core";
import { lookupGhinCourse, parseCourseLookupInput } from "../../../../../lib/ghin/course-lookup";
import { privateGhinJson } from "../../../../../lib/ghin/qa-access.server";
import { ghinUserContext } from "../../../../../lib/ghin/user-access.server";
import { getGhinUserSession, GHIN_SESSION_COOKIE_NAME } from "../../../../../lib/ghin/user-session.server";
import { isolatedPreviewDatabaseEnabled } from "../../../../../lib/preview-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const limiter = new SlidingWindowRateLimiter<string>({ limit: 6, windowMs: 10 * 60_000 });

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "integration/backyard-current"
    || !isolatedPreviewDatabaseEnabled() || !resolveGhinPreviewCapabilities(process.env).courseLookup) {
    return privateGhinJson({ code: "DEV_ONLY" }, 404);
  }
  const account = await ghinUserContext(request);
  if (!account.ok) return account.response;
  const body = await readJsonBodyWithLimit(request, 512);
  const input = body.ok ? parseCourseLookupInput(body.value) : null;
  if (!input) return privateGhinJson({ code: "INVALID_REQUEST" }, 400);
  const profile = await account.client.from("player_handicap_provider_profiles").select("external_player_id,association_status")
    .eq("owner_id", account.userId).eq("provider", "GHIN").maybeSingle();
  if (profile.error) return privateGhinJson({ code: "PROFILE_READ_FAILED" }, 503);
  if (!profile.data || profile.data.association_status !== "VERIFIED") return privateGhinJson({ code: "GHIN_NOT_VERIFIED" }, 409);
  const session = getGhinUserSession(account.userId, profile.data.external_player_id, request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value);
  if (!session) return privateGhinJson({ code: "REAUTH_REQUIRED", error: "Renueva autorización GHIN para consultar campos." }, 409);
  if (!limiter.consume(account.userId).allowed) return privateGhinJson({ code: "RATE_LIMITED" }, 429);
  const start = session.client.getTrace().length;
  const result = await lookupGhinCourse(session.client, input, profile.data.external_player_id);
  const trace = session.client.getTrace().slice(start).map(({ endpoint, method, httpStatus, outcome, durationMs }) =>
    ({ endpoint: endpoint.split("?")[0], method, httpStatus, outcome, durationMs }));
  console.info("backyard_ghin_course_lookup", JSON.stringify({ operation: input.operation, trace }));
  return privateGhinJson({ ...result, trace });
}
