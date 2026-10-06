import { NextRequest } from "next/server";
import { hasOnlyKeys, readJsonBodyWithLimit } from "../../../../../lib/backyard-ai/server/http-security";
import { GhinClientError } from "../../../../../lib/ghin/client";
import { SlidingWindowRateLimiter } from "../../../../../lib/ghin/core";
import { privateGhinJson } from "../../../../../lib/ghin/qa-access.server";
import { importGhinScores, importPage, readImportState } from "../../../../../lib/ghin/score-import.server";
import { ghinUserContext } from "../../../../../lib/ghin/user-access.server";
import { GHIN_SESSION_COOKIE_NAME, getGhinUserSession } from "../../../../../lib/ghin/user-session.server";
import { isolatedPreviewDatabaseEnabled } from "../../../../../lib/preview-database";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const limiter = new SlidingWindowRateLimiter<string>({limit:4,windowMs:10*60_000});

async function contextFor(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "integration/backyard-current"
    || !isolatedPreviewDatabaseEnabled()) return {ok:false as const,response:privateGhinJson({code:"DEV_ONLY"},404)};
  const context = await ghinUserContext(request);
  if (!context.ok) return context;
  const read = await context.client.from("player_handicap_provider_profiles").select("external_player_id,association_status")
    .eq("owner_id",context.userId).eq("provider","GHIN").maybeSingle();
  if (read.error) return {ok:false as const,response:privateGhinJson({code:"PROFILE_READ_FAILED"},503)};
  if (!read.data || read.data.association_status !== "VERIFIED") return {ok:false as const,response:privateGhinJson({code:"GHIN_NOT_VERIFIED"},409)};
  return {...context,golferId:read.data.external_player_id as string};
}

export async function GET(request: NextRequest) {
  const context = await contextFor(request);
  if (!context.ok) return context.response;
  const rawCursor = request.nextUrl.searchParams.get("cursor") ?? "0";
  if (!/^\d{1,4}$/.test(rawCursor) || Number(rawCursor)>1000) return privateGhinJson({code:"INVALID_CURSOR"},400);
  try {
    // RLS ownership on every read; persisted cards need no live GHIN session.
    return privateGhinJson(importPage(await readImportState(context.client,context.userId,context.golferId),Number(rawCursor)));
  } catch { return privateGhinJson({code:"GHIN_IMPORT_READ_FAILED"},503); }
}

export async function POST(request: NextRequest) {
  const context = await contextFor(request);
  if (!context.ok) return context.response;
  const body = await readJsonBodyWithLimit(request,512);
  if (!body.ok) return privateGhinJson({code:"INVALID_REQUEST"},400);
  const input = body.value;
  if (!input || typeof input !== "object" || Array.isArray(input) || !hasOnlyKeys(input as Record<string,unknown>,["operation"])
    || (input as Record<string,unknown>).operation !== "sync") return privateGhinJson({code:"INVALID_REQUEST"},400);
  if (!limiter.consume(context.userId).allowed) return privateGhinJson({code:"RATE_LIMITED"},429);
  const session = getGhinUserSession(context.userId,context.golferId,request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value);
  if (!session) return privateGhinJson({code:"REAUTH_REQUIRED",error:"Renueva autorización GHIN para sincronizar tarjetas."},409);
  const admin = getSupabaseAdmin();
  if (!admin) return privateGhinJson({code:"CLOUD_UNAVAILABLE"},503);
  try {
    session.client.invalidateScores(context.golferId);
    const record = await session.client.getScores(context.golferId,1000);
    const summary = await importGhinScores(admin,context.userId,context.golferId,record.data);
    // Return a bounded page and summary; never send the full provider bundle.
    const page = importPage(await readImportState(context.client,context.userId,context.golferId),0);
    return privateGhinJson({...page,summary,providerLimitReached:record.data.length>=1000});
  } catch (error) {
    const reauth = error instanceof GhinClientError && (error.code === "unauthorized" || error.code === "forbidden");
    return privateGhinJson({code:reauth?"REAUTH_REQUIRED":error instanceof GhinClientError?error.code.toUpperCase():"GHIN_IMPORT_FAILED",
      error:reauth?"Renueva autorización GHIN para sincronizar tarjetas.":"No se pudo completar la importación. Tus rondas Backyard se conservan."},reauth?409:503);
  }
}
