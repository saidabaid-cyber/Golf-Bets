import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES } from "../../../../lib/account-notification-preferences";
import { unavailablePushProvider } from "../../../../features/notifications/push-provider";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const COLUMNS = "push_notifications_enabled,email_notifications_enabled,round_notifications_enabled,reminders_enabled,updated_at";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

function response(row?: Record<string, unknown> | null) {
  const initialized = typeof row?.push_notifications_enabled === "boolean"
    && typeof row?.email_notifications_enabled === "boolean"
    && typeof row?.round_notifications_enabled === "boolean"
    && typeof row?.reminders_enabled === "boolean";
  return {
    initialized,
    preferences: {
      push: typeof row?.push_notifications_enabled === "boolean" ? row.push_notifications_enabled : DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.push,
      email: typeof row?.email_notifications_enabled === "boolean" ? row.email_notifications_enabled : DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.email,
      rounds: typeof row?.round_notifications_enabled === "boolean" ? row.round_notifications_enabled : DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.rounds,
      reminders: typeof row?.reminders_enabled === "boolean" ? row.reminders_enabled : DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.reminders,
      updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    },
    delivery: {
      // A preference and an OS grant never prove delivery. The repository has
      // no general notification mailer and its push provider is deliberately
      // fail-closed until a real provider/subscription store is connected.
      push: { configured: unavailablePushProvider.configured, state: unavailablePushProvider.configured ? "ready" : "not_configured" },
      email: { configured: false, state: "not_configured" },
    },
  };
}

function parsePreferences(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = ["push", "email", "rounds", "reminders"] as const;
  if (Object.keys(input).length !== keys.length || keys.some((key) => typeof input[key] !== "boolean")) return null;
  return {
    push_notifications_enabled: input.push as boolean,
    email_notifications_enabled: input.email as boolean,
    round_notifications_enabled: input.rounds as boolean,
    reminders_enabled: input.reminders as boolean,
  };
}

export async function GET(request: NextRequest) {
  try {
    const account = await authenticatedRequest(request);
    if (!account.ok) return json({ error: account.error }, account.status);
    const { data, error } = await account.client.from("user_preferences").select(COLUMNS)
      .eq("user_id", account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) return json({ error: "No pudimos consultar tus preferencias de notificaciones." }, 503);
    return json(response(data));
  } catch {
    return json({ error: "No pudimos consultar tus preferencias de notificaciones." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ error: "Solicitud no válida." }, 415);
  try {
    const account = await authenticatedRequest(request);
    if (!account.ok) return json({ error: account.error }, account.status);
    const body = await readJsonBodyWithLimit(request, 2_048);
    const preferences = body.ok ? parsePreferences(body.value) : null;
    if (!preferences) return json({ error: "Preferencias no válidas." }, 400);
    const row = { user_id: account.userId, ...preferences, updated_at: new Date().toISOString() };
    const { data, error } = await account.client.from("user_preferences").upsert(row, { onConflict: "user_id" })
      .select(COLUMNS).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error || !data) return json({ error: "No pudimos guardar tus preferencias de notificaciones." }, 503);
    const saved = response(data);
    if (saved.preferences.push !== row.push_notifications_enabled
      || saved.preferences.email !== row.email_notifications_enabled
      || saved.preferences.rounds !== row.round_notifications_enabled
      || saved.preferences.reminders !== row.reminders_enabled) {
      return json({ error: "No pudimos confirmar tus preferencias de notificaciones." }, 503);
    }
    return json(saved);
  } catch {
    return json({ error: "No pudimos guardar tus preferencias de notificaciones." }, 503);
  }
}
