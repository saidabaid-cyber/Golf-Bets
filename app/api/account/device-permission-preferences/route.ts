import type { NextRequest } from "next/server";

import {
  LOCATION_USAGE_PREFERENCE_METADATA_KEY,
  NOTIFICATION_USAGE_PREFERENCE_METADATA_KEY,
  parseAccountPermissionRecord,
  type AccountPermissionPreferenceKind,
  type AccountPermissionRecord,
} from "../../../../lib/account-device-permission-preferences";
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
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

function metadataKey(preference: AccountPermissionPreferenceKind) {
  return preference === "location"
    ? LOCATION_USAGE_PREFERENCE_METADATA_KEY
    : NOTIFICATION_USAGE_PREFERENCE_METADATA_KEY;
}

function response(metadata: Record<string, unknown> | null | undefined) {
  return {
    location: parseAccountPermissionRecord(metadata?.[LOCATION_USAGE_PREFERENCE_METADATA_KEY]),
    notifications: parseAccountPermissionRecord(metadata?.[NOTIFICATION_USAGE_PREFERENCE_METADATA_KEY]),
  };
}

function inputRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["preference", "version", "value", "changedAt"])) return null;
  if (source.preference !== "location" && source.preference !== "notifications") return null;
  const record = parseAccountPermissionRecord(source);
  if (!record || Date.parse(record.changedAt) > Date.now() + MAX_CLOCK_SKEW_MS) return null;
  return { preference: source.preference, record } as {
    preference: AccountPermissionPreferenceKind;
    record: AccountPermissionRecord;
  };
}

async function writeAuthMetadata(token: string, key: string, record: AccountPermissionRecord) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !publishableKey) return false;
  const write = await fetch(new URL("/auth/v1/user", supabaseUrl), {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ data: { [key]: record } }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  return write.ok;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) return json({ error: "Solicitud no válida." }, 400);
  try {
    const account = await authenticatedRequest(request);
    if (!account.ok) return json({ error: account.error }, account.status);
    return json(response(account.userMetadata));
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
    const key = metadataKey(input.preference);
    const current = parseAccountPermissionRecord(account.userMetadata?.[key]);
    if (current && Date.parse(current.changedAt) > Date.parse(input.record.changedAt)) {
      return json(response(account.userMetadata));
    }
    if (!current || current.value !== input.record.value || current.changedAt !== input.record.changedAt) {
      if (!await writeAuthMetadata(account.token, key, input.record)) {
        return json({ error: "No pudimos guardar tu preferencia de permisos." }, 503);
      }
    }
    const verified = await account.client.auth.getUser(account.token);
    if (verified.error || verified.data.user?.id !== account.userId) {
      return json({ error: "No pudimos confirmar tu preferencia de permisos." }, 503);
    }
    const confirmed = response(verified.data.user.user_metadata);
    const saved = confirmed[input.preference];
    if (!saved || saved.value !== input.record.value || Date.parse(saved.changedAt) < Date.parse(input.record.changedAt)) {
      return json({ error: "No pudimos confirmar tu preferencia de permisos." }, 503);
    }
    return json(confirmed);
  } catch {
    return json({ error: "No pudimos guardar tu preferencia de permisos." }, 503);
  }
}
