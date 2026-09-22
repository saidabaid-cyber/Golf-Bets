import { NextRequest, NextResponse } from "next/server";

import {
  AI_PROCESSING_CONSENT_TABLE,
  AI_PROCESSING_CONSENT_SCOPES,
  AI_PROCESSING_CONSENT_DECISIONS_RPC,
  parseAiProcessingConsentScope,
  type AiProcessingConsentRow,
  type AiConsentDecisionInput,
  type AiConsentCheckpointSource,
} from "../../../../lib/backyard-ai/consent-record";
import {
  BACKYARD_AI_PROVIDER_CONSENT_VERSION,
  type BackyardAiProcessingConsentScope,
} from "../../../../lib/backyard-ai/privacy";
import {
  hasOnlyKeys,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { aiProcessingConsentLedgerAccess } from "../../../../lib/backyard-ai/server/config";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../../lib/supabase/server";
import { accountAccessFailure } from "../../../../lib/account-access.server";
import { authUserFailure } from "../../../../lib/auth-errors";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", pragma: "no-cache" };
const MAX_REQUEST_BYTES = 1_000;

const CONSENT_COLUMNS = "id,scope,policy_version,accepted_at,revoked_at,decision_status,source,decided_at";

function json(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...PRIVATE_HEADERS, ...init.headers } });
}

async function account(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, code: "auth_required", error: "Inicia sesión para guardar esta autorización." };
  const ledgerAccess = aiProcessingConsentLedgerAccess(process.env, true);
  if (!ledgerAccess.allowed) {
    return {
      ok: false as const,
      status: 503,
      code: "consent_environment_blocked",
      error: "El registro seguro de autorizaciones no está habilitado para cuentas en este Preview.",
    };
  }
  const admin = getSupabaseAdmin();
  const userClient = getSupabaseForUser(token);
  if (!userClient) return { ok: false as const, status: 503, code: "missing_config", error: "No pude conectar el registro seguro de autorizaciones." };
  const { data, error } = await userClient.auth.getUser(token);
  const failure = authUserFailure(error, !error && Boolean(data.user));
  if (failure) return { ok: false as const, ...failure };
  if (!data.user || data.user.is_anonymous) return { ok: false as const, status: 401, code: "auth_required", error: "La sesión terminó. Vuelve a iniciar sesión." };
  const accessFailure = await accountAccessFailure(userClient);
  if (accessFailure) return { ok: false as const, ...accessFailure };
  return { ok: true as const, admin, userClient, userId: data.user.id };
}

async function readLatestConsent(
  client: NonNullable<ReturnType<typeof getSupabaseForUser>>,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
) {
  return client
    .from(AI_PROCESSING_CONSENT_TABLE)
    .select(CONSENT_COLUMNS)
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("policy_version", BACKYARD_AI_PROVIDER_CONSENT_VERSION)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<AiProcessingConsentRow>();
}

async function readAllDecisions(
  client: NonNullable<ReturnType<typeof getSupabaseForUser>>,
  userId: string,
) {
  const { data, error } = await client
    .from(AI_PROCESSING_CONSENT_TABLE)
    .select(CONSENT_COLUMNS)
    .eq("user_id", userId)
    .eq("policy_version", BACKYARD_AI_PROVIDER_CONSENT_VERSION)
    .order("id", { ascending: false });
  return { data: data as AiProcessingConsentRow[] | null, error };
}

function consentResponse(row: AiProcessingConsentRow | null) {
  return {
    recordId: row ? String(row.id) : null,
    active: Boolean(row && row.decision_status === "accepted" && row.accepted_at && row.revoked_at === null),
    status: row?.decision_status ?? "missing",
    policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    acceptedAt: row?.accepted_at ?? null,
    revokedAt: row?.revoked_at ?? null,
    source: row?.source ?? null,
    decidedAt: row?.decided_at ?? null,
  };
}

function allDecisionsResponse(rows: AiProcessingConsentRow[]) {
  const decisions = AI_PROCESSING_CONSENT_SCOPES.map((scope) => ({
    ...consentResponse(rows.find((row) => row.scope === scope) ?? null), scope,
  }));
  return {
    policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    decisions,
    resolved: decisions.every((decision) => decision.status !== "missing"),
  };
}

async function mutationBody(request: NextRequest) {
  if (isCrossSiteRequest(request)) return { ok: false as const, status: 403, code: "cross_site", error: "Solicitud no permitida." };
  if (!isJsonRequest(request)) return { ok: false as const, status: 415, code: "unsupported_media_type", error: "La solicitud debe usar JSON." };
  const parsed = await readJsonBodyWithLimit(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return {
    ok: false as const,
    status: parsed.reason === "too_large" ? 413 : 400,
    code: parsed.reason === "too_large" ? "request_too_large" : "invalid_request",
    error: "Autorización inválida.",
  };
  const body = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : null;
  if (!body) return { ok: false as const, status: 400, code: "invalid_request", error: "Autorización inválida." };
  return { ok: true as const, body };
}

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  const session = await account(request);
  if (!session.ok) return json({ error: session.error, code: session.code }, { status: session.status });
  if (!request.nextUrl.searchParams.has("scope")) {
    const { data, error } = await readAllDecisions(session.userClient, session.userId);
    if (error) return json({ error: "No pude consultar tus preferencias de IA. Inténtalo nuevamente.", code: "consent_store_unavailable" }, { status: 503 });
    return json(allDecisionsResponse(data ?? []));
  }
  const scope = parseAiProcessingConsentScope(request.nextUrl.searchParams.get("scope"));
  if (!scope) return json({ error: "Scope de autorización inválido.", code: "invalid_scope" }, { status: 400 });
  const { data, error } = await readLatestConsent(session.userClient, session.userId, scope);
  if (error) return json({ error: "No pude consultar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  return json({ ...consentResponse(data), scope });
}

/** An affirmative onboarding/settings action, never a feature-use side effect. */
async function writeDecisions(request: NextRequest, revoke: boolean) {
  const parsed = await mutationBody(request);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
  let decisions: AiConsentDecisionInput[];
  let source: AiConsentCheckpointSource | "settings";
  const scope = parseAiProcessingConsentScope(parsed.body.scope);
  if (scope && hasOnlyKeys(parsed.body, ["scope"])) {
    source = "settings";
    decisions = [{ scope, accepted: !revoke }];
  } else {
    const input = parsed.body.decisions;
    const checkpointSource = parsed.body.source;
    if (revoke || !hasOnlyKeys(parsed.body, ["decisions", "source"])
      || !Array.isArray(input) || input.length < 1 || input.length > AI_PROCESSING_CONSENT_SCOPES.length
      || (checkpointSource !== "onboarding" && checkpointSource !== "account_update")) {
      return json({ error: "Autorización inválida.", code: "invalid_request" }, { status: 400 });
    }
    decisions = [];
    for (const value of input) {
      const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const choiceScope = parseAiProcessingConsentScope(item?.scope);
      if (!item || !choiceScope || !hasOnlyKeys(item, ["scope", "accepted"]) || typeof item.accepted !== "boolean"
        || decisions.some((decision) => decision.scope === choiceScope)) {
        return json({ error: "Autorización inválida.", code: "invalid_request" }, { status: 400 });
      }
      decisions.push({ scope: choiceScope, accepted: item.accepted });
    }
    source = checkpointSource;
  }
  const session = await account(request);
  if (!session.ok) return json({ error: session.error, code: session.code }, { status: session.status });
  if (!session.admin) return json({ error: "No pude conectar el registro seguro de autorizaciones.", code: "missing_config" }, { status: 503 });
  const { data, error } = await session.admin.rpc(AI_PROCESSING_CONSENT_DECISIONS_RPC, {
    p_user_id: session.userId,
    p_policy_version: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    p_decisions: decisions,
    p_source: source,
  });
  if (error || !Array.isArray(data)) return json({ error: "No pude guardar tus preferencias de IA. Inténtalo nuevamente.", code: "consent_store_unavailable" }, { status: 503 });
  const rows = data as AiProcessingConsentRow[];
  return scope ? json({ ...consentResponse(rows.find((row) => row.scope === scope) ?? null), scope }) : json(allDecisionsResponse(rows));
}

export async function POST(request: NextRequest) {
  return writeDecisions(request, false);
}

/** Revocation is an auditable transaction; no acceptance history is deleted. */
export async function PATCH(request: NextRequest) {
  return writeDecisions(request, true);
}
