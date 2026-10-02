import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ACCOUNT_DATA_EXPORT_LIMIT, buildLimitedAccountExport } from "../../../../lib/account-data-export";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { resolveCanonicalDataEnvironment } from "../../../../lib/runtime-environment";
import { advancedAdminRequest as authenticatedRequest } from "../../../../lib/admin-advanced.server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_BODY_BYTES = 8_192;
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const INPUT_KEYS = ["targetUserId", "reason", "ticketReference", "requestId"] as const;
const AUDIT_ACTION_SUCCESS = "ACCOUNT_DATA_EXPORT_SUCCESS";
const AUDIT_ACTION_FAILED = "ACCOUNT_DATA_EXPORT_FAILED";
const AUDIT_ENTITY_TYPE = "ACCOUNT_PRIVACY_EXPORT";
const AUDIT_ACCOUNT_FINGERPRINT_VERSION = "sha256:account-privacy-export:v1";

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

type ValidInput = {
  targetUserId: string;
  reason: string;
  ticketReference: string | null;
  requestId: string;
};

class ExportFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded<T>(operation: PromiseLike<T>, timeoutMs = 9_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(operation),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExportFailure(503, "ADMIN_EXPORT_TIMEOUT", "La exportación excedió el tiempo disponible.")), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function accountAuditFingerprint(accountId: string) {
  return createHash("sha256")
    .update(`the-backyard:account-privacy-export:v1:${accountId.toLocaleLowerCase("en-US")}`, "utf8")
    .digest("hex");
}

function parseInput(value: unknown): ValidInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, INPUT_KEYS)) return null;
  if (typeof value.targetUserId !== "string" || !UUID_PATTERN.test(value.targetUserId)) return null;
  if (typeof value.reason !== "string") return null;
  const reason = value.reason.trim();
  if (!reason || reason.length > 2_000) return null;

  let ticketReference: string | null = null;
  if (value.ticketReference !== undefined) {
    if (typeof value.ticketReference !== "string") return null;
    ticketReference = value.ticketReference.trim();
    if (!ticketReference || ticketReference.length > 240) return null;
  }

  let requestId: string = randomUUID();
  if (value.requestId !== undefined) {
    if (typeof value.requestId !== "string" || !UUID_PATTERN.test(value.requestId)) return null;
    requestId = value.requestId.toLocaleLowerCase("en-US");
  }

  return {
    targetUserId: value.targetUserId.toLocaleLowerCase("en-US"),
    reason,
    ticketReference,
    requestId,
  };
}

async function audit(
  admin: AdminClient,
  actorId: string,
  input: ValidInput,
  action: typeof AUDIT_ACTION_SUCCESS | typeof AUDIT_ACTION_FAILED,
  afterState: Record<string, unknown>,
) {
  return bounded(admin.from("admin_audit_log").insert({
    actor_id: actorId,
    actor_role: "SUPER_ADMIN",
    action,
    entity_type: AUDIT_ENTITY_TYPE,
    entity_id: input.targetUserId,
    before_state: null,
    after_state: {
      ...afterState,
      // Lifecycle deletion intentionally clears actor_id/entity_id. Keep a
      // deterministic, non-reversible correlation handle without retaining a
      // deleted account's raw UUID inside the append-only JSON evidence.
      accountFingerprintVersion: AUDIT_ACCOUNT_FINGERPRINT_VERSION,
      requesterAccountFingerprint: accountAuditFingerprint(actorId),
      subjectAccountFingerprint: accountAuditFingerprint(input.targetUserId),
      ticketReference: input.ticketReference,
    },
    reason: input.reason,
    request_id: input.requestId,
  }));
}

async function auditFailureBestEffort(
  admin: AdminClient,
  actorId: string,
  input: ValidInput,
  environment: ReturnType<typeof resolveCanonicalDataEnvironment>,
  failureCode: string,
) {
  try {
    await audit(admin, actorId, input, AUDIT_ACTION_FAILED, {
      result: "FAILED",
      environment,
      failureCode,
      scope: "limited_account_copy",
    });
  } catch {
    // The original failure remains the response. Audit payloads never include
    // raw provider errors, tokens, request headers, or exported user data.
  }
}

function source(result: { data: unknown; error: unknown }) {
  if (result.error) throw new ExportFailure(503, "ADMIN_EXPORT_READ_FAILED", "No pudimos leer todas las fuentes autorizadas.");
  return { available: true, data: result.data };
}

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "CROSS_SITE_REQUEST" }, 403);

  let account: Awaited<ReturnType<typeof authenticatedRequest>>;
  try {
    account = await bounded(authenticatedRequest(request));
  } catch {
    return json({ error: "No pudimos validar la sesión.", code: "AUTH_UNAVAILABLE" }, 503);
  }
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);

  const body = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) {
    const status = body.reason === "too_large" ? 413 : body.reason === "unsupported_media_type" ? 415 : 400;
    return json({ error: "La solicitud de exportación no es válida.", code: "INVALID_BODY" }, status);
  }
  const input = parseInput(body.value);
  if (!input) return json({ error: "La solicitud de exportación no es válida.", code: "INVALID_BODY" }, 400);

  const membership = await (async () => {
    try {
      return await bounded(account.client
        .from("admin_memberships")
        .select("id")
        .eq("user_id", account.userId)
        .eq("role", "SUPER_ADMIN")
        .eq("scope_type", "GLOBAL")
        .is("scope_id", null)
        .eq("active", true)
        .limit(1));
    } catch {
      return null;
    }
  })();
  if (!membership) return json({ error: "No pudimos comprobar la autorización administrativa.", code: "ADMIN_AUTHORIZATION_UNAVAILABLE" }, 503);
  if (membership.error) return json({ error: "No pudimos comprobar la autorización administrativa.", code: "ADMIN_AUTHORIZATION_UNAVAILABLE" }, 503);
  if (!membership.data?.length) return json({ error: "No tienes autorización para generar esta exportación.", code: "ADMIN_EXPORT_FORBIDDEN" }, 403);

  const admin = getSupabaseAdmin("cloud", 9_000);
  if (!admin) return json({ error: "La exportación administrativa no está disponible.", code: "ADMIN_EXPORT_UNAVAILABLE" }, 503);

  const environment = resolveCanonicalDataEnvironment();
  try {
    const maximum = ACCOUNT_DATA_EXPORT_LIMIT + 1;
    const profile = await bounded(admin.from("profiles")
      .select("display_name,given_name,family_name,username,avatar_url,default_handicap,home_club,preferred_tee,handedness,bio,profile_visibility,social_privacy,city,state,country,onboarding_completed_at,created_at,updated_at")
      .eq("id", input.targetUserId).maybeSingle());
    if (profile.error) throw new ExportFailure(503, "ADMIN_EXPORT_READ_FAILED", "No pudimos leer todas las fuentes autorizadas.");
    if (!profile.data) throw new ExportFailure(404, "ADMIN_EXPORT_TARGET_NOT_FOUND", "No encontramos la cuenta objetivo.");

    const [
      socialProfile,
      preferences,
      socialActivityPreferences,
      legalAcceptances,
      legalEvidence,
      aiProcessingConsents,
      optionalAuthorizationEvents,
      optionalAuthorizationReceipts,
    ] = await bounded(Promise.all([
      admin.from("social_profiles")
        .select("username,display_name,avatar_url,handicap,club_name,privacy,updated_at")
        .eq("user_id", input.targetUserId).maybeSingle(),
      admin.from("user_preferences")
        .select("high_contrast,locale,default_handicap,notifications_enabled,push_notifications_enabled,email_notifications_enabled,round_notifications_enabled,reminders_enabled,personal_memory_enabled,global_learning_enabled,location_internal_enabled,notification_internal_enabled,created_at,updated_at")
        .eq("user_id", input.targetUserId).maybeSingle(),
      admin.from("social_activity_preferences_v3")
        .select("share_rounds,share_achievements,share_equipment,share_courses,notify_like,notify_comment,notify_attest,notify_friend_achievement,notify_equipment,notify_friend_request,updated_at")
        .eq("user_id", input.targetUserId).maybeSingle(),
      admin.from("legal_acceptances")
        .select("type,version,accepted_at,locale,created_at")
        .eq("user_id", input.targetUserId).order("accepted_at", { ascending: true }).limit(maximum),
      admin.from("legal_evidence_events")
        .select("environment,document_key,purpose_key,document_version,document_hash,statement_key,statement_text,statement_hash,action,locale,origin,client_occurred_at,server_received_at,idempotency_key")
        .eq("user_id", input.targetUserId).eq("environment", environment).order("server_received_at", { ascending: true }).limit(maximum),
      admin.from("ai_processing_consents")
        .select("scope,policy_version,decision_status,source,decided_at,accepted_at,revoked_at,locale,created_at,updated_at")
        .eq("user_id", input.targetUserId).order("id", { ascending: true }).limit(maximum),
      admin.from("optional_authorization_events")
        .select("scope,decision_status,policy_version,source,bundle_version,idempotency_key,decided_at,created_at")
        .eq("user_id", input.targetUserId).order("id", { ascending: true }).limit(maximum),
      admin.from("optional_authorization_bundle_receipts")
        .select("bundle_version,action,idempotency_key,feature_set,decided_at,created_at")
        .eq("user_id", input.targetUserId).order("created_at", { ascending: true }).limit(maximum),
    ]));

    const payload = buildLimitedAccountExport({
      userId: input.targetUserId,
      environment,
      profile: source(profile),
      socialProfile: source(socialProfile),
      preferences: source(preferences),
      socialActivityPreferences: source(socialActivityPreferences),
      legalAcceptances: source(legalAcceptances),
      legalEvidence: source(legalEvidence),
      aiProcessingConsents: source(aiProcessingConsents),
      optionalAuthorizationEvents: source(optionalAuthorizationEvents),
      optionalAuthorizationReceipts: source(optionalAuthorizationReceipts),
    });
    const serialized = JSON.stringify(payload);
    const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
    const byteLength = Buffer.byteLength(serialized, "utf8");
    const auditResult = await audit(admin, account.userId, input, AUDIT_ACTION_SUCCESS, {
      result: "SUCCESS",
      environment,
      scope: payload.scope,
      exportVersion: payload.exportVersion,
      sha256,
      byteLength,
    });
    if (auditResult.error) {
      throw new ExportFailure(503, "ADMIN_EXPORT_AUDIT_FAILED", "No pudimos registrar la auditoría obligatoria.");
    }

    return new NextResponse(serialized, {
      status: 200,
      headers: {
        ...BACKYARD_AI_PRIVATE_HEADERS,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="the-backyard-admin-account-export-${payload.generatedAt.slice(0, 10)}.json"`,
        "x-content-sha256": sha256,
      },
    });
  } catch (error) {
    const failure = error instanceof ExportFailure
      ? error
      : new ExportFailure(503, "ADMIN_EXPORT_FAILED", "No pudimos preparar la exportación administrativa.");
    await auditFailureBestEffort(admin, account.userId, input, environment, failure.code);
    return json({ error: failure.message, code: failure.code }, failure.status);
  }
}
