import { NextRequest } from "next/server";

import { hasOnlyKeys, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";
import { GhinClientError } from "../../../../lib/ghin/client";
import { SlidingWindowRateLimiter } from "../../../../lib/ghin/core";
import { GHIN_QA_NUMBER } from "../../../../lib/ghin/profile";
import { failedAttemptStatus, providerRowToProfile, successfulProviderWrite, type GhinProviderProfileRow } from "../../../../lib/ghin/profile-persistence";
import { ghinQaContext, privateGhinJson } from "../../../../lib/ghin/qa-access.server";
import { resolveGhinRuntime } from "../../../../lib/ghin/runtime.server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPECTED_NAME = "Said Abaid Taja";
const EXPECTED_CLUB = "La Vista Country Club";
const MAX_BODY_BYTES = 512;
const limiter = new SlidingWindowRateLimiter<string>({ limit: 4, windowMs: 10 * 60_000 });
const PROFILE_COLUMNS = "external_player_id,association_status,provider_player_name,provider_club_name,provider_player_status,handicap_index,handicap_effective_at,provider_updated_at,last_successful_sync_at,last_attempted_sync_at,last_attempt_status,last_error_code";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identity(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

async function readProfile(context: Awaited<ReturnType<typeof ghinQaContext>> & { ok: true }) {
  const read = await context.client
    .from("player_handicap_provider_profiles")
    .select(PROFILE_COLUMNS)
    .eq("owner_id", context.userId)
    .eq("provider", "GHIN")
    .maybeSingle();
  if (read.error) throw new Error("PROFILE_READ_FAILED");
  return read.data ? providerRowToProfile(read.data as unknown as GhinProviderProfileRow) : null;
}

export async function GET(request: NextRequest) {
  const context = await ghinQaContext(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.search) return privateGhinJson({ error: "Solicitud inválida.", code: "SELECTORS_REJECTED" }, 400);
  try {
    return privateGhinJson({ available: true, profile: await readProfile(context) });
  } catch {
    return privateGhinJson({ error: "No fue posible leer el vínculo GHIN.", code: "PROFILE_READ_FAILED" }, 503);
  }
}

export async function POST(request: NextRequest) {
  const context = await ghinQaContext(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.search) return privateGhinJson({ error: "Solicitud inválida.", code: "SELECTORS_REJECTED" }, 400);

  const decision = limiter.consume(context.userId);
  if (!decision.allowed) {
    const seconds = Math.ceil(decision.retryAfterMs / 1_000);
    return privateGhinJson({ error: "Espera antes de actualizar GHIN nuevamente.", code: "RATE_LIMITED" }, 429, { "retry-after": String(seconds) });
  }
  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  const input = parsed.ok ? record(parsed.value) : null;
  if (!input || !hasOnlyKeys(input, ["operation"]) || input.operation !== "refresh") {
    return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
  }

  const runtimeState = resolveGhinRuntime();
  if (!runtimeState.ok || !runtimeState.capabilities.golferLookup) {
    return privateGhinJson({ error: "GHIN no está disponible en este Preview.", code: "GHIN_DISABLED" }, 503);
  }
  const admin = getSupabaseAdmin();
  if (!admin) return privateGhinJson({ error: "La persistencia de Preview no está disponible.", code: "CLOUD_UNAVAILABLE" }, 503);

  const attemptedAt = new Date().toISOString();
  try {
    const auth = await runtimeState.client.authenticate();
    runtimeState.client.invalidateGolfer(GHIN_QA_NUMBER);
    const lookup = await runtimeState.client.lookupGolfer(GHIN_QA_NUMBER);
    const golfer = lookup.data;
    const club = golfer.homeClubName ?? golfer.clubName;
    const valid = golfer.ghinNumber === GHIN_QA_NUMBER
      && identity(golfer.name) === identity(EXPECTED_NAME)
      && identity(club) === identity(EXPECTED_CLUB)
      && golfer.status === "active"
      && Boolean(golfer.name);
    if (!valid) {
      return privateGhinJson({ error: "La identidad GHIN no coincide con la cuenta QA autorizada.", code: "IDENTITY_MISMATCH" }, 409);
    }

    const write = successfulProviderWrite(context.userId, golfer, attemptedAt);
    const persisted = await admin
      .from("player_handicap_provider_profiles")
      .upsert(write, { onConflict: "owner_id,provider" })
      .select(PROFILE_COLUMNS)
      .single();
    if (persisted.error || !persisted.data) throw new Error("PROFILE_WRITE_FAILED");
    const verified = await readProfile(context);
    if (!verified || verified.ghinNumber !== GHIN_QA_NUMBER
      || Date.parse(verified.lastAttemptedAt) !== Date.parse(attemptedAt)) {
      throw new Error("PROFILE_VERIFY_FAILED");
    }
    return privateGhinJson({
      available: true,
      profile: verified,
      upstream: {
        firebaseSessionHttpStatus: auth.firebaseHttpStatus,
        golferLoginHttpStatus: auth.httpStatus,
        golferLookupHttpStatus: lookup.httpStatus,
      },
      safety: { readOnly: true, scorePostingCalls: 0 },
    });
  } catch (error) {
    const code = error instanceof GhinClientError ? error.code : "unknown";
    const existing = await admin
      .from("player_handicap_provider_profiles")
      .select("owner_id")
      .eq("owner_id", context.userId)
      .eq("provider", "GHIN")
      .maybeSingle();
    if (existing.data) {
      await admin
        .from("player_handicap_provider_profiles")
        .update({
          last_attempted_sync_at: attemptedAt,
          last_attempt_status: failedAttemptStatus(code),
          last_error_code: code.toUpperCase(),
        })
        .eq("owner_id", context.userId)
        .eq("provider", "GHIN");
    }
    return privateGhinJson({ error: "No se pudo actualizar GHIN. Conservamos el último índice válido.", code: code.toUpperCase() }, 502);
  }
}
