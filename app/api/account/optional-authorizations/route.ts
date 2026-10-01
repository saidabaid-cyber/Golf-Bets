import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
  isCompleteBundleResolution,
  parseOptionalAuthorizationSettingsScope,
  parseOptionalAuthorizationState,
  type OptionalAuthorizationAction,
} from "../../../../lib/account-optional-authorizations";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { authenticatedRequest } from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

function objectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : [];
}

function reportCanonicalStateFailure(
  operation: "get" | "resolve" | "scope",
  data: unknown,
  error: { code?: string; message?: string } | null,
) {
  const record = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  console.error("[optional-authorizations] canonical state unavailable", {
    operation,
    dbErrorCode: error?.code ?? null,
    hasDbError: Boolean(error),
    topLevelKeys: objectKeys(data),
    receiptKeys: objectKeys(record?.receipt),
  });
}

function mappedFailure(error: { code?: string; message?: string } | null) {
  const message = error?.message || "";
  if (message.includes("optional_authorization_bundle_not_eligible")) return json({ error: "Esta decisión inicial ya no está disponible para la cuenta.", code: "NOT_ELIGIBLE" }, 409);
  if (message.includes("optional_authorization_bundle_already_resolved") || message.includes("optional_authorization_partial_decision_exists")) {
    return json({ error: "Esta decisión ya fue resuelta por otra acción explícita.", code: "ALREADY_RESOLVED" }, 409);
  }
  if (message.includes("optional_authorization_idempotency_conflict") || message.includes("idempotency_key_reused")) return json({ error: "La solicitud ya se usó con otra decisión.", code: "IDEMPOTENCY_CONFLICT" }, 409);
  if (error?.code === "22023") return json({ error: "Autorización no válida.", code: "INVALID_REQUEST" }, 400);
  return json({ error: "No pudimos guardar todas las autorizaciones. No se aplicó un estado parcial.", code: "CONSENT_STORE_UNAVAILABLE" }, 503);
}

async function body(request: NextRequest) {
  if (isCrossSiteRequest(request)) return { ok: false as const, response: json({ error: "Solicitud no permitida.", code: "CROSS_SITE" }, 403) };
  if (!isJsonRequest(request)) return { ok: false as const, response: json({ error: "La solicitud debe usar JSON.", code: "UNSUPPORTED_MEDIA_TYPE" }, 415) };
  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { ok: false as const, response: json({ error: "Autorización no válida.", code: "INVALID_REQUEST" }, parsed.ok ? 400 : parsed.reason === "too_large" ? 413 : 400) };
  }
  return { ok: true as const, value: parsed.value as Record<string, unknown> };
}

async function state(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_optional_authorization_state_v1");
  const parsed = parseOptionalAuthorizationState(data);
  if (error || !parsed) reportCanonicalStateFailure("get", data, error);
  return { parsed, error };
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) return json({ error: "Solicitud no válida.", code: "INVALID_REQUEST" }, 400);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const result = await state(account.client);
  if (result.error || !result.parsed) return json({ error: "No pudimos consultar tus autorizaciones.", code: "CONSENT_STORE_UNAVAILABLE" }, 503);
  return json(result.parsed);
}

export async function POST(request: NextRequest) {
  const parsedBody = await body(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.value;
  const action = input.action as OptionalAuthorizationAction;
  if (!hasOnlyKeys(input, ["action", "bundleVersion", "idempotencyKey"])
    || (action !== "authorize_all" && action !== "decline_all")
    || input.bundleVersion !== OPTIONAL_AUTHORIZATION_BUNDLE_VERSION
    || typeof input.idempotencyKey !== "string" || !UUID.test(input.idempotencyKey)) {
    return json({ error: "Autorización no válida.", code: "INVALID_REQUEST" }, 400);
  }
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const { data, error } = await account.client.rpc("resolve_optional_authorization_bundle_v1", {
    requested_action: action,
    requested_bundle_version: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    requested_idempotency_key: input.idempotencyKey,
  });
  const saved = parseOptionalAuthorizationState(data);
  if (error) {
    reportCanonicalStateFailure("resolve", data, error);
    return mappedFailure(error);
  }
  if (!saved || !isCompleteBundleResolution(saved, action)) {
    reportCanonicalStateFailure("resolve", data, null);
    return json({ error: "No pudimos confirmar todas las autorizaciones. No mostramos un éxito parcial.", code: "CONSENT_CONFIRMATION_FAILED" }, 503);
  }
  return json(saved);
}

export async function PATCH(request: NextRequest) {
  const parsedBody = await body(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.value;
  const scope = parseOptionalAuthorizationSettingsScope(input.scope);
  if (!hasOnlyKeys(input, ["scope", "enabled", "idempotencyKey"])
    || !scope || typeof input.enabled !== "boolean"
    || typeof input.idempotencyKey !== "string" || !UUID.test(input.idempotencyKey)) {
    return json({ error: "Autorización no válida.", code: "INVALID_REQUEST" }, 400);
  }
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const { data, error } = await account.client.rpc("set_optional_authorization_scope_v1", {
    requested_scope: scope,
    requested_enabled: input.enabled,
    requested_idempotency_key: input.idempotencyKey,
  });
  const saved = parseOptionalAuthorizationState(data);
  if (error) {
    reportCanonicalStateFailure("scope", data, error);
    return mappedFailure(error);
  }
  if (!saved || saved.scopes[scope].active !== input.enabled) {
    reportCanonicalStateFailure("scope", data, null);
    return json({ error: "No pudimos confirmar esta elección.", code: "CONSENT_CONFIRMATION_FAILED" }, 503);
  }
  return json(saved);
}
