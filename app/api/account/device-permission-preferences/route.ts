import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseAccountPermissionRecord,
  type AccountPermissionPreferenceKind,
  type AccountPermissionRecord,
} from "../../../../lib/account-device-permission-preferences";
import { parseOptionalAuthorizationState } from "../../../../lib/account-optional-authorizations";
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
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

function response(state?: ReturnType<typeof parseOptionalAuthorizationState>) {
  const canonical = (preference: AccountPermissionPreferenceKind) => {
    const scope = preference === "location" ? state?.scopes.LOCATION_INTERNAL : state?.scopes.NOTIFICATION_INTERNAL;
    return scope && scope.status !== "missing" && scope.decidedAt
      ? { version: 1 as const, value: scope.active ? "enabled" as const : "disabled" as const, changedAt: scope.decidedAt }
      : null;
  };
  return {
    location: canonical("location"),
    notifications: canonical("notifications"),
  };
}

function inputRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["preference", "version", "value", "changedAt"])) return null;
  if (source.preference !== "location" && source.preference !== "notifications") return null;
  const record = parseAccountPermissionRecord(source);
  if (!record) return null;
  return { preference: source.preference, record } as {
    preference: AccountPermissionPreferenceKind;
    record: AccountPermissionRecord;
  };
}

async function state(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_optional_authorization_state_v1");
  return { data: parseOptionalAuthorizationState(data), error };
}

async function stableIdempotencyKey(userId: string, preference: AccountPermissionPreferenceKind, record: AccountPermissionRecord) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${preference}:${record.value}:${record.changedAt}`));
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) return json({ error: "Solicitud no válida." }, 400);
  try {
    const account = await authenticatedRequest(request);
    if (!account.ok) return json({ error: account.error }, account.status);
    const remote = await state(account.client);
    if (remote.error || !remote.data) return json({ error: "No pudimos consultar tus preferencias de permisos." }, 503);
    return json(response(remote.data));
  } catch {
    return json({ error: "No pudimos consultar tus preferencias de permisos." }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (request.nextUrl.search || !isJsonRequest(request)) return json({ error: "Solicitud no válida." }, request.nextUrl.search ? 400 : 415);
  try {
    const account = await authenticatedRequest(request);
    if (!account.ok) return json({ error: account.error }, account.status);
    const body = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
    const input = body.ok ? inputRecord(body.value) : null;
    if (!input) return json({ error: "Preferencia no válida." }, 400);
    const currentState = await state(account.client);
    if (currentState.error || !currentState.data) return json({ error: "No pudimos consultar tu preferencia de permisos." }, 503);
    // A client clock is not an authority for ordering explicit user actions.
    // The server ledger serializes and timestamps this tap canonically.
    const { data, error } = await account.client.rpc("set_optional_authorization_scope_v1", {
      requested_scope: input.preference === "location" ? "LOCATION_INTERNAL" : "NOTIFICATION_INTERNAL",
      requested_enabled: input.record.value === "enabled",
      requested_idempotency_key: await stableIdempotencyKey(account.userId, input.preference, input.record),
    });
    const savedState = parseOptionalAuthorizationState(data);
    if (error || !savedState) return json({ error: "No pudimos guardar tu preferencia de permisos." }, 503);
    const confirmed = response(savedState);
    const savedRecord = confirmed[input.preference];
    if (!savedRecord || savedRecord.value !== input.record.value) {
      return json({ error: "No pudimos confirmar tu preferencia de permisos." }, 503);
    }
    return json(confirmed);
  } catch {
    return json({ error: "No pudimos guardar tu preferencia de permisos." }, 503);
  }
}
