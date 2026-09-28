import { NextRequest } from "next/server";

import { hasOnlyKeys, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";
import { GhinClientError } from "../../../../lib/ghin/client";
import { SlidingWindowRateLimiter, type GhinErrorCode, type NormalizedGhinGolfer } from "../../../../lib/ghin/core";
import {
  diagnosticFailure,
  logGhinProfileStage,
  traceGhinRead,
  type GhinProfileOperation,
} from "../../../../lib/ghin/profile-diagnostics.server";
import { failedAttemptStatus, providerRowToProfile, verifiedProviderWrite, type GhinProviderProfileRow } from "../../../../lib/ghin/profile-persistence";
import { ghinProfileRefreshPolicy } from "../../../../lib/ghin/profile-refresh-policy";
import { privateGhinJson } from "../../../../lib/ghin/qa-access.server";
import { ghinUserContext } from "../../../../lib/ghin/user-access.server";
import {
  activateGhinSession,
  beginGhinAuthorization,
  cancelGhinAuthorization,
  clearGhinUserSession,
  consumeGhinAuthorization,
  GHIN_SESSION_COOKIE_NAME,
  getGhinUserSession,
  reauthorizeGhinSession,
  sealGhinUserSession,
  type GhinUserSession,
} from "../../../../lib/ghin/user-session.server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;
const GHIN_SESSION_COOKIE_PATH = "/api/profile/ghin";
const authLimiter = new SlidingWindowRateLimiter<string>({ limit: 5, windowMs: 15 * 60_000 });
const actionLimiter = new SlidingWindowRateLimiter<string>({ limit: 12, windowMs: 10 * 60_000 });
const PROFILE_COLUMNS = "external_player_id,association_status,provider_player_name,provider_club_name,provider_home_club_name,provider_player_status,handicap_index,handicap_effective_at,provider_updated_at,last_successful_sync_at,last_attempted_sync_at,last_attempt_status,last_error_code";

type UserContext = Extract<Awaited<ReturnType<typeof ghinUserContext>>, { ok: true }>;

function profilePayload(profile: ReturnType<typeof providerRowToProfile> | null, refreshPolicy?: ReturnType<typeof ghinProfileRefreshPolicy>) {
  return {
    available: true,
    linkState: profile ? "GHIN_LINKED" as const : "GHIN_NOT_LINKED" as const,
    profile,
    ...(refreshPolicy ? { refreshPolicy } : {}),
  };
}

function withGhinSessionCookie(response: ReturnType<typeof privateGhinJson>, session: GhinUserSession) {
  const sealed = sealGhinUserSession(session);
  response.cookies.set({
    name: GHIN_SESSION_COOKIE_NAME,
    value: sealed.value,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: GHIN_SESSION_COOKIE_PATH,
    maxAge: Math.max(1, Math.floor((sealed.expiresAt - Date.now()) / 1_000)),
    priority: "high",
  });
  return response;
}

function withoutGhinSessionCookie(response: ReturnType<typeof privateGhinJson>) {
  response.cookies.set({
    name: GHIN_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: GHIN_SESSION_COOKIE_PATH,
    maxAge: 0,
    priority: "high",
  });
  return response;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function credentials(input: Record<string, unknown>) {
  if (typeof input.login !== "string" || typeof input.password !== "string") return null;
  const login = input.login.trim();
  if (login.length < 5 || login.length > 254 || input.password.length < 1 || input.password.length > 254) return null;
  return { login, password: input.password };
}

function challengeId(input: Record<string, unknown>) {
  return typeof input.challengeId === "string" && input.challengeId.length >= 80 && input.challengeId.length <= 3_000
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.challengeId)
    ? input.challengeId
    : null;
}

function clientError(error: unknown): { code: GhinErrorCode | "unknown"; status: number } {
  if (!(error instanceof GhinClientError)) return { code: "unknown", status: 502 };
  if (error.code === "invalid_credentials") return { code: error.code, status: 401 };
  if (error.code === "rate_limited") return { code: error.code, status: 429 };
  if (error.code === "unauthorized" || error.code === "forbidden") return { code: error.code, status: 403 };
  return { code: error.code, status: 502 };
}

function safeUpstreamMessage(code: GhinErrorCode | "unknown") {
  if (code === "invalid_credentials") return "GHIN no aceptó esas credenciales.";
  if (code === "rate_limited") return "GHIN pidió esperar antes de intentar de nuevo.";
  if (code === "unauthorized" || code === "forbidden") return "La sesión GHIN no corresponde a esta cuenta.";
  return "GHIN no está disponible en este momento.";
}

async function readProfile(context: UserContext) {
  const read = await context.client
    .from("player_handicap_provider_profiles")
    .select(PROFILE_COLUMNS)
    .eq("owner_id", context.userId)
    .eq("provider", "GHIN")
    .eq("association_status", "VERIFIED")
    .maybeSingle();
  if (read.error) throw new Error("PROFILE_READ_FAILED");
  return read.data ? providerRowToProfile(read.data as unknown as GhinProviderProfileRow) : null;
}

function persistenceCode(error: unknown) {
  if (!(error instanceof Error)) return "unknown";
  if (error.message === "CLOUD_UNAVAILABLE") return "cloud_unavailable";
  if (error.message === "PROFILE_READ_FAILED") return "profile_read_failed";
  if (error.message === "PROFILE_WRITE_FAILED") return "profile_write_failed";
  if (error.message === "OWNER_ALREADY_LINKED") return "owner_already_linked";
  if (error.message === "GHIN_ALREADY_LINKED") return "ghin_already_linked";
  return "unknown";
}

async function persistVerifiedGolfer(
  ownerId: string,
  golfer: NormalizedGhinGolfer,
  attemptedAt: string,
  operation: "authorize" | "reauthorize" | "refresh",
) {
  const startedAt = Date.now();
  try {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error("CLOUD_UNAVAILABLE");

    const existingOwner = await admin
      .from("player_handicap_provider_profiles")
      .select("external_player_id")
      .eq("owner_id", ownerId)
      .eq("provider", "GHIN")
      .maybeSingle();
    if (existingOwner.error) throw new Error("PROFILE_READ_FAILED");
    if (existingOwner.data && existingOwner.data.external_player_id !== golfer.ghinNumber) {
      throw new Error("OWNER_ALREADY_LINKED");
    }

    const existingGhin = await admin
      .from("player_handicap_provider_profiles")
      .select("owner_id")
      .eq("provider", "GHIN")
      .eq("external_player_id", golfer.ghinNumber)
      .eq("association_status", "VERIFIED")
      .limit(1);
    if (existingGhin.error) throw new Error("PROFILE_READ_FAILED");
    if (existingGhin.data?.some((row) => row.owner_id !== ownerId)) throw new Error("GHIN_ALREADY_LINKED");

    const write = verifiedProviderWrite(ownerId, golfer, attemptedAt);
    const persisted = await admin
      .from("player_handicap_provider_profiles")
      .upsert(write, { onConflict: "owner_id,provider" })
      .select(PROFILE_COLUMNS)
      .single();
    if (persisted.error?.code === "23505") throw new Error("GHIN_ALREADY_LINKED");
    if (persisted.error || !persisted.data) throw new Error("PROFILE_WRITE_FAILED");
    const profile = providerRowToProfile(persisted.data as unknown as GhinProviderProfileRow);
    logGhinProfileStage({
      operation,
      stage: "profile_persistence",
      endpoint: "/db/player_handicap_provider_profiles",
      httpStatus: null,
      code: null,
      retryable: false,
      durationMs: Date.now() - startedAt,
    });
    return profile;
  } catch (error) {
    logGhinProfileStage({
      operation,
      stage: "profile_persistence",
      ...diagnosticFailure(error, "/db/player_handicap_provider_profiles", persistenceCode(error)),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function recordFailedAttempt(ownerId: string, attemptedAt: string, code: GhinErrorCode | "unknown") {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  const existing = await admin
    .from("player_handicap_provider_profiles")
    .select("owner_id")
    .eq("owner_id", ownerId)
    .eq("provider", "GHIN")
    .maybeSingle();
  if (!existing.data) return;
  await admin
    .from("player_handicap_provider_profiles")
    .update({
      last_attempted_sync_at: attemptedAt,
      last_attempt_status: failedAttemptStatus(code),
      last_error_code: code.toUpperCase(),
    })
    .eq("owner_id", ownerId)
    .eq("provider", "GHIN");
}

export async function GET(request: NextRequest) {
  const context = await ghinUserContext(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.search) return privateGhinJson({ error: "Solicitud inválida.", code: "SELECTORS_REJECTED" }, 400);
  try {
    const profile = await readProfile(context);
    const session = profile ? getGhinUserSession(
      context.userId,
      profile.ghinNumber,
      request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value,
    ) : null;
    return privateGhinJson(profilePayload(profile, ghinProfileRefreshPolicy({
      lastSuccessfulSyncAt: profile?.lastSyncedAt ?? null,
      hasUsableSession: Boolean(session),
    })));
  } catch {
    return privateGhinJson({ error: "No fue posible leer el vínculo GHIN.", code: "PROFILE_READ_FAILED" }, 503);
  }
}

export async function POST(request: NextRequest) {
  const context = await ghinUserContext(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.search) return privateGhinJson({ error: "Solicitud inválida.", code: "SELECTORS_REJECTED" }, 400);

  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  const input = parsed.ok ? record(parsed.value) : null;
  const operation = input && typeof input.operation === "string" ? input.operation : "";
  if (!input || !operation) return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);

  if (operation === "authorize" || operation === "reauthorize") {
    if (!hasOnlyKeys(input, ["operation", "login", "password"])) {
      return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
    }
    const supplied = credentials(input);
    if (!supplied) return privateGhinJson({ error: "Completa tus credenciales GHIN.", code: "INVALID_REQUEST" }, 400);
    const decision = authLimiter.consume(context.userId);
    if (!decision.allowed) {
      return privateGhinJson({ error: "Espera antes de intentar autenticarte nuevamente.", code: "RATE_LIMITED" }, 429, { "retry-after": String(Math.ceil(decision.retryAfterMs / 1_000)) });
    }

    if (operation === "authorize") {
      try {
        const authorization = await beginGhinAuthorization(context.userId, supplied);
        return withGhinSessionCookie(privateGhinJson({
          authorization: { challengeId: authorization.challengeId, golfer: authorization.candidate },
          safety: { readOnly: true, scorePostingCalls: 0 },
        }), authorization.session);
      } catch (error) {
        const failure = clientError(error);
        return privateGhinJson({ error: safeUpstreamMessage(failure.code), code: failure.code.toUpperCase() }, failure.status);
      }
    }

    let linked;
    try {
      linked = await readProfile(context);
    } catch {
      logGhinProfileStage({
        operation: "reauthorize",
        stage: "profile_persistence",
        endpoint: "/db/player_handicap_provider_profiles",
        httpStatus: null,
        code: "profile_read_failed",
        retryable: false,
        durationMs: 0,
      });
      return privateGhinJson({ error: "No fue posible leer el vínculo GHIN.", code: "PROFILE_READ_FAILED" }, 503);
    }
    if (!linked) return privateGhinJson({ error: "Primero vincula una cuenta GHIN.", code: "GHIN_NOT_LINKED" }, 409);
    const attemptedAt = new Date().toISOString();
    try {
      const result = await reauthorizeGhinSession(context.userId, linked.ghinNumber, supplied);
      const profile = await persistVerifiedGolfer(context.userId, result.golfer, attemptedAt, "reauthorize");
      return withGhinSessionCookie(
        privateGhinJson({ ...profilePayload(profile), reauthorized: true, safety: { readOnly: true, scorePostingCalls: 0 } }),
        result.session,
      );
    } catch (error) {
      const failure = clientError(error);
      await recordFailedAttempt(context.userId, attemptedAt, failure.code);
      return privateGhinJson({ error: safeUpstreamMessage(failure.code), code: failure.code.toUpperCase() }, failure.status);
    }
  }

  const decision = actionLimiter.consume(context.userId);
  if (!decision.allowed) {
    return privateGhinJson({ error: "Espera antes de intentar de nuevo.", code: "RATE_LIMITED" }, 429, { "retry-after": String(Math.ceil(decision.retryAfterMs / 1_000)) });
  }

  if (operation === "cancel") {
    if (!hasOnlyKeys(input, ["operation", "challengeId"])) return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
    const challenge = challengeId(input);
    if (challenge) cancelGhinAuthorization(context.userId, challenge);
    return withoutGhinSessionCookie(privateGhinJson({ cancelled: true }));
  }

  if (operation === "confirm") {
    if (!hasOnlyKeys(input, ["operation", "challengeId"])) return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
    const challenge = challengeId(input);
    if (!challenge) return privateGhinJson({ error: "Confirmación inválida o vencida.", code: "AUTHORIZATION_EXPIRED" }, 409);
    const pending = consumeGhinAuthorization(context.userId, challenge);
    if (!pending) return privateGhinJson({ error: "La autorización venció. Vuelve a iniciar sesión en GHIN.", code: "AUTHORIZATION_EXPIRED" }, 409);
    const session = pending.session ?? getGhinUserSession(
      context.userId,
      pending.golfer.ghinNumber,
      request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value,
    );
    if (!session) {
      return withoutGhinSessionCookie(privateGhinJson({
        error: "La sesión de autorización venció. Vuelve a iniciar sesión en GHIN.",
        code: "AUTHORIZATION_EXPIRED",
      }, 409));
    }
    try {
      const profile = await persistVerifiedGolfer(context.userId, pending.golfer, new Date().toISOString(), "authorize");
      activateGhinSession(session);
      return withGhinSessionCookie(
        privateGhinJson({ ...profilePayload(profile), safety: { readOnly: true, scorePostingCalls: 0 } }),
        session,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROFILE_WRITE_FAILED";
      if (code === "GHIN_ALREADY_LINKED") {
        return privateGhinJson({ error: "Ese número GHIN ya está vinculado a otra cuenta Backyard.", code }, 409);
      }
      if (code === "OWNER_ALREADY_LINKED") {
        return privateGhinJson({ error: "Desvincula tu cuenta GHIN actual antes de vincular otra.", code }, 409);
      }
      return privateGhinJson({ error: "No se pudo guardar el vínculo GHIN.", code: "PROFILE_WRITE_FAILED" }, 503);
    }
  }

  if (operation === "unlink") {
    if (!hasOnlyKeys(input, ["operation", "confirmed"]) || input.confirmed !== true) {
      return privateGhinJson({ error: "Confirma la desvinculación.", code: "CONFIRMATION_REQUIRED" }, 400);
    }
    const admin = getSupabaseAdmin();
    if (!admin) return privateGhinJson({ error: "La persistencia de Preview no está disponible.", code: "CLOUD_UNAVAILABLE" }, 503);
    const removed = await admin.rpc("unlink_ghin_profile_v1", { p_owner_id: context.userId });
    if (removed.error) return privateGhinJson({ error: "No se pudo desvincular GHIN.", code: "UNLINK_FAILED" }, 503);
    clearGhinUserSession(context.userId);
    return withoutGhinSessionCookie(privateGhinJson({ ...profilePayload(null), unlinked: Boolean(removed.data) }));
  }

  if (operation !== "refresh" && operation !== "scores") {
    return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
  }
  if (!hasOnlyKeys(input, ["operation"])) return privateGhinJson({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);

  let linked;
  try {
    linked = await readProfile(context);
  } catch {
    logGhinProfileStage({
      operation: operation as GhinProfileOperation,
      stage: "profile_persistence",
      endpoint: "/db/player_handicap_provider_profiles",
      httpStatus: null,
      code: "profile_read_failed",
      retryable: false,
      durationMs: 0,
    });
    return privateGhinJson({ error: "No fue posible leer el vínculo GHIN.", code: "PROFILE_READ_FAILED" }, 503);
  }
  if (!linked) return privateGhinJson({ error: "Primero vincula una cuenta GHIN.", code: "GHIN_NOT_LINKED" }, 409);
  const session = getGhinUserSession(
    context.userId,
    linked.ghinNumber,
    request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) {
    logGhinProfileStage({
      operation: operation as GhinProfileOperation,
      stage: operation === "scores" ? "scores" : "lookup_by_ghin",
      endpoint: operation === "scores" ? "/scores.json" : "/golfers/search.json",
      httpStatus: null,
      code: "reauth_required",
      retryable: false,
      durationMs: 0,
    });
    return privateGhinJson({ error: "Tu sesión GHIN terminó. Reautoriza para continuar.", code: "REAUTH_REQUIRED" }, 409);
  }

  if (operation === "scores") {
    try {
      session.client.invalidateScores(linked.ghinNumber);
      const result = await traceGhinRead("scores", "scores", "/scores.json", () => session.client.getScores(linked.ghinNumber, 1_000));
      return privateGhinJson({
        available: true,
        count: result.data.length,
        fetchedAt: result.fetchedAt,
        httpStatus: result.httpStatus,
        items: result.data.slice(0, 20),
        truncated: result.data.length > 20,
        safety: { readOnly: true, scorePostingCalls: 0 },
      });
    } catch (error) {
      const failure = clientError(error);
      if (failure.code === "unauthorized" || failure.code === "forbidden") clearGhinUserSession(context.userId);
      const requiresAuth = failure.code === "unauthorized" || failure.code === "forbidden";
      const response = privateGhinJson({ error: requiresAuth ? "Tu sesión GHIN terminó. Reautoriza para continuar." : safeUpstreamMessage(failure.code), code: requiresAuth ? "REAUTH_REQUIRED" : failure.code.toUpperCase() }, requiresAuth ? 409 : failure.status);
      return requiresAuth ? withoutGhinSessionCookie(response) : response;
    }
  }

  const attemptedAt = new Date().toISOString();
  try {
    session.client.invalidateGolfer(linked.ghinNumber);
    const lookup = await traceGhinRead("refresh", "lookup_by_ghin", "/golfers/search.json", () => session.client.lookupGolfer(linked.ghinNumber));
    if (lookup.data.ghinNumber !== linked.ghinNumber) {
      logGhinProfileStage({
        operation: "refresh",
        stage: "identity_validation",
        endpoint: "/identity",
        httpStatus: lookup.httpStatus,
        code: "identity_mismatch",
        retryable: false,
        durationMs: 0,
      });
      throw new Error("IDENTITY_MISMATCH");
    }
    logGhinProfileStage({
      operation: "refresh",
      stage: "identity_validation",
      endpoint: "/identity",
      httpStatus: lookup.httpStatus,
      code: null,
      retryable: false,
      durationMs: 0,
    });
    const profile = await persistVerifiedGolfer(context.userId, lookup.data, attemptedAt, "refresh");
    return privateGhinJson({ ...profilePayload(profile), safety: { readOnly: true, scorePostingCalls: 0 } });
  } catch (error) {
    const failure = clientError(error);
    await recordFailedAttempt(context.userId, attemptedAt, failure.code);
    if (failure.code === "unauthorized" || failure.code === "forbidden") clearGhinUserSession(context.userId);
    const requiresAuth = failure.code === "unauthorized" || failure.code === "forbidden";
    const response = privateGhinJson({ error: requiresAuth ? "Tu sesión GHIN terminó. Reautoriza para continuar." : "No se pudo actualizar GHIN. Conservamos el último índice válido.", code: requiresAuth ? "REAUTH_REQUIRED" : failure.code.toUpperCase() }, requiresAuth ? 409 : failure.status);
    return requiresAuth ? withoutGhinSessionCookie(response) : response;
  }
}
