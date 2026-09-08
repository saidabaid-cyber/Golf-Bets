import { NextRequest, NextResponse } from "next/server";

import {
  AI_PROCESSING_CONSENT_TABLE,
  parseAiProcessingConsentScope,
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
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", pragma: "no-cache" };
const MAX_REQUEST_BYTES = 1_000;

type ConsentRow = {
  id: number;
  policy_version: string;
  accepted_at: string;
  revoked_at: string | null;
};

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
  if (!admin) return { ok: false as const, status: 503, code: "missing_config", error: "No pude conectar el registro seguro de autorizaciones." };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, code: "auth_required", error: "La sesión terminó. Vuelve a iniciar sesión." };
  return { ok: true as const, admin, userId: data.user.id };
}

async function readLatestConsent(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
) {
  return admin
    .from(AI_PROCESSING_CONSENT_TABLE)
    .select("id,policy_version,accepted_at,revoked_at")
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("policy_version", BACKYARD_AI_PROVIDER_CONSENT_VERSION)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<ConsentRow>();
}

async function readActiveConsent(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
) {
  return admin
    .from(AI_PROCESSING_CONSENT_TABLE)
    .select("id,policy_version,accepted_at,revoked_at")
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("policy_version", BACKYARD_AI_PROVIDER_CONSENT_VERSION)
    .is("revoked_at", null)
    .maybeSingle<ConsentRow>();
}

function consentResponse(row: ConsentRow | null) {
  return {
    active: Boolean(row && row.revoked_at === null),
    policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    acceptedAt: row?.accepted_at ?? null,
    revokedAt: row?.revoked_at ?? null,
  };
}

async function mutationScope(request: NextRequest) {
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
  const scope = parseAiProcessingConsentScope(body?.scope);
  if (!scope || !body || !hasOnlyKeys(body, ["scope"])) return { ok: false as const, status: 400, code: "invalid_scope", error: "Autorización inválida." };
  return { ok: true as const, scope };
}

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  const session = await account(request);
  if (!session.ok) return json({ error: session.error, code: session.code }, { status: session.status });
  const scope = parseAiProcessingConsentScope(request.nextUrl.searchParams.get("scope"));
  if (!scope) return json({ error: "Scope de autorización inválido.", code: "invalid_scope" }, { status: 400 });
  const { data, error } = await readLatestConsent(session.admin, session.userId, scope);
  if (error) return json({ error: "No pude consultar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  return json({ ...consentResponse(data), scope });
}

/** Only an explicit click in AiProcessingConsentPrompt calls this endpoint. */
export async function POST(request: NextRequest) {
  const parsed = await mutationScope(request);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
  const session = await account(request);
  if (!session.ok) return json({ error: session.error, code: session.code }, { status: session.status });
  const existing = await readActiveConsent(session.admin, session.userId, parsed.scope);
  if (existing.error) return json({ error: "No pude consultar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  if (existing.data) return json({ ...consentResponse(existing.data), scope: parsed.scope });

  const acceptedAt = new Date().toISOString();
  const { data, error } = await session.admin
    .from(AI_PROCESSING_CONSENT_TABLE)
    .insert({
      user_id: session.userId,
      scope: parsed.scope,
      policy_version: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
      accepted_at: acceptedAt,
      locale: "es-MX",
      updated_at: acceptedAt,
    })
    .select("id,policy_version,accepted_at,revoked_at")
    .single<ConsentRow>();
  if (error?.code === "23505") {
    const raced = await readActiveConsent(session.admin, session.userId, parsed.scope);
    if (!raced.error && raced.data) return json({ ...consentResponse(raced.data), scope: parsed.scope });
  }
  if (error || !data) return json({ error: "No pude guardar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  return json({ ...consentResponse(data), scope: parsed.scope });
}

/** Revocation is an auditable update; the acceptance row is never deleted. */
export async function PATCH(request: NextRequest) {
  const parsed = await mutationScope(request);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
  const session = await account(request);
  if (!session.ok) return json({ error: session.error, code: session.code }, { status: session.status });
  const existing = await readActiveConsent(session.admin, session.userId, parsed.scope);
  if (existing.error) return json({ error: "No pude consultar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  if (!existing.data) {
    const latest = await readLatestConsent(session.admin, session.userId, parsed.scope);
    if (latest.error) return json({ error: "No pude consultar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
    return json({ ...consentResponse(latest.data), active: false, scope: parsed.scope });
  }

  const revokedAt = new Date().toISOString();
  const { data, error } = await session.admin
    .from(AI_PROCESSING_CONSENT_TABLE)
    .update({ revoked_at: revokedAt, updated_at: revokedAt })
    .eq("id", existing.data.id)
    .eq("user_id", session.userId)
    .is("revoked_at", null)
    .select("id,policy_version,accepted_at,revoked_at")
    .maybeSingle<ConsentRow>();
  if (error) return json({ error: "No pude revocar la autorización de IA.", code: "consent_store_unavailable" }, { status: 503 });
  if (data) return json({ ...consentResponse(data), scope: parsed.scope });
  const raced = await readLatestConsent(session.admin, session.userId, parsed.scope);
  if (raced.error) return json({ error: "No pude confirmar la revocación de IA.", code: "consent_store_unavailable" }, { status: 503 });
  return json({ ...consentResponse(raced.data), active: false, scope: parsed.scope });
}
