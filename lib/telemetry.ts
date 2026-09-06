export const ANALYTICS_EVENT_NAMES = [
  "app_opened", "signup_completed", "login_completed", "logout", "profile_opened", "profile_updated",
  "round_started", "round_resumed", "round_completed", "round_deleted", "player_added", "group_created",
  "bet_enabled", "bet_disabled", "results_opened", "history_opened", "rules_ai_opened", "rules_ai_question",
  "rules_ai_success", "rules_ai_error", "sync_success", "sync_error",
] as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];
export type TelemetryStorage = Pick<Storage, "getItem" | "setItem">;

const EVENT_SET = new Set<string>(ANALYTICS_EVENT_NAMES);
const SESSION_KEY = "backyard-analytics-session-v1";
const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
const MAX_METADATA_KEYS = 12;
let telemetryIdentity: { userId: string | null; accessToken: string | null } = { userId: null, accessToken: null };
let appOpenedSent = false;

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && EVENT_SET.has(value);
}

export function eventCategory(name: AnalyticsEventName) {
  if (name.startsWith("round_")) return "round";
  if (name.startsWith("rules_ai_")) return "rules_ai";
  if (name.startsWith("sync_")) return "sync";
  if (name.startsWith("bet_")) return "bet";
  if (["signup_completed", "login_completed", "logout"].includes(name)) return "auth";
  if (name.startsWith("profile_") || name === "player_added" || name === "group_created") return "account";
  return "navigation";
}

function safePrimitive(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, 120);
  return undefined;
}

export function sanitizeTelemetryMetadata(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const blocked = /amount|email|name|token|secret|password|question|score|photo|avatar|ip|hcp/i;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, candidate] of Object.entries(source).slice(0, MAX_METADATA_KEYS)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || blocked.test(key)) continue;
    const safe = safePrimitive(candidate);
    if (safe !== undefined) clean[key] = safe;
  }
  return clean;
}

export function sanitizeOperationalMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value || "Error operativo");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(?:sk|eyJ)[-_A-Za-z0-9.]{12,}/g, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500) || "Error operativo";
}

export function getTelemetrySession(storage: TelemetryStorage, now = Date.now(), makeId = () => crypto.randomUUID()) {
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_KEY) || "null") as { id?: string; lastActivity?: number } | null;
    const reusable = parsed?.id && Number.isFinite(parsed.lastActivity) && now - Number(parsed.lastActivity) <= SESSION_INACTIVITY_MS;
    const session = { id: reusable ? String(parsed?.id) : makeId(), lastActivity: now };
    storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session.id;
  } catch {
    return makeId();
  }
}

export function setTelemetryIdentity(userId: string | null, accessToken: string | null) {
  telemetryIdentity = { userId, accessToken };
}

function clientContext() {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent || "";
  return {
    sessionId: getTelemetrySession(window.localStorage),
    deviceType: /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop",
    platform: /iPhone|iPad/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : /Windows/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "macos" : "web",
  };
}

async function send(path: string, payload: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (telemetryIdentity.accessToken) headers.authorization = `Bearer ${telemetryIdentity.accessToken}`;
  await fetch(path, { method: "POST", headers, body: JSON.stringify(payload), keepalive: true }).catch(() => undefined);
}

export function trackEvent(name: AnalyticsEventName, options: { roundId?: string | null; metadata?: unknown } = {}) {
  if (name === "app_opened") { if (appOpenedSent) return; appOpenedSent = true; }
  const context = clientContext();
  if (!context) return;
  void send("/api/telemetry/events", {
    eventName: name,
    sessionId: context.sessionId,
    roundId: options.roundId || null,
    metadata: sanitizeTelemetryMetadata(options.metadata),
    deviceType: context.deviceType,
    platform: context.platform,
  });
}

export function trackOperationalError(errorType: string, error: unknown, options: { code?: string; route?: string; metadata?: unknown } = {}) {
  const context = clientContext();
  if (!context) return;
  void send("/api/telemetry/errors", {
    errorType: errorType.slice(0, 80), errorCode: String(options.code || "").slice(0, 80) || null,
    message: sanitizeOperationalMessage(error), route: String(options.route || window.location.pathname).slice(0, 160),
    sessionId: context.sessionId, metadata: sanitizeTelemetryMetadata(options.metadata),
  });
}
