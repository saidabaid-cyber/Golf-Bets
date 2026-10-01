export const OPTIONAL_AUTHORIZATION_BUNDLE_VERSION = "optional-features-2026-09-30-v1";
export const OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT = "backyard:optional-authorizations-changed";
export const OPTIONAL_AUTHORIZATION_REQUEST_TIMEOUT_MS = 20_000;

export const OPTIONAL_AUTHORIZATION_SCOPES = [
  "AI_PROVIDER_PROCESSING_CONSENT",
  "AI_IMAGE_PROCESSING_CONSENT",
  "AI_LAUNCH_MONITOR_PROCESSING_CONSENT",
  "PERSONAL_MEMORY",
  "GLOBAL_LEARNING",
  "LOCATION_INTERNAL",
  "NOTIFICATION_INTERNAL",
] as const;

export const OPTIONAL_AUTHORIZATION_SETTINGS_SCOPES = [
  "PERSONAL_MEMORY",
  "GLOBAL_LEARNING",
  "LOCATION_INTERNAL",
  "NOTIFICATION_INTERNAL",
] as const;

export type OptionalAuthorizationScope = typeof OPTIONAL_AUTHORIZATION_SCOPES[number];
export type OptionalAuthorizationSettingsScope = typeof OPTIONAL_AUTHORIZATION_SETTINGS_SCOPES[number];
export type OptionalAuthorizationAction = "authorize_all" | "decline_all";
export type OptionalAuthorizationStatus = "accepted" | "declined" | "revoked" | "missing";

export const OPTIONAL_AUTHORIZATION_POLICY_VERSIONS = {
  AI_PROVIDER_PROCESSING_CONSENT: "2026-09-08-v2",
  AI_IMAGE_PROCESSING_CONSENT: "2026-09-08-v2",
  AI_LAUNCH_MONITOR_PROCESSING_CONSENT: "2026-09-08-v2",
  PERSONAL_MEMORY: "ai-first-phase1-v1",
  GLOBAL_LEARNING: "ai-first-phase1-v1",
  LOCATION_INTERNAL: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
  NOTIFICATION_INTERNAL: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
} as const satisfies Record<OptionalAuthorizationScope, string>;

export type OptionalAuthorizationScopeState = {
  active: boolean;
  status: OptionalAuthorizationStatus;
  policyVersion: string | null;
  source: string | null;
  decidedAt: string | null;
};

export type OptionalAuthorizationState = {
  bundleVersion: string;
  resolved: boolean;
  eligible: boolean;
  receipt: null | {
    action: OptionalAuthorizationAction;
    idempotencyKey: string;
    decidedAt: string;
  };
  scopes: Record<OptionalAuthorizationScope, OptionalAuthorizationScopeState>;
  profileVisibility: "private" | "friends" | "public";
  socialPrivacy: "PRIVATE" | "FRIENDS";
  socialProfilePrivacy: "PRIVATE" | "FRIENDS" | "PUBLIC";
  sharing: {
    enabledForFriends: boolean;
    rounds: boolean;
    achievements: boolean;
    equipment: boolean;
    courses: boolean;
  };
  notifications: {
    internal: boolean;
    master: boolean;
    push: boolean;
    email: boolean;
    rounds: boolean;
    reminders: boolean;
  };
};

const scopeSet = new Set<string>(OPTIONAL_AUTHORIZATION_SCOPES);
const settingsScopeSet = new Set<string>(OPTIONAL_AUTHORIZATION_SETTINGS_SCOPES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOptionalAuthorizationScope(value: unknown): OptionalAuthorizationScope | null {
  return typeof value === "string" && scopeSet.has(value) ? value as OptionalAuthorizationScope : null;
}

export function parseOptionalAuthorizationSettingsScope(value: unknown): OptionalAuthorizationSettingsScope | null {
  return typeof value === "string" && settingsScopeSet.has(value) ? value as OptionalAuthorizationSettingsScope : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function scopeState(scope: OptionalAuthorizationScope, value: unknown): OptionalAuthorizationScopeState | null {
  const row = object(value);
  if (!row || typeof row.active !== "boolean"
    || !new Set(["accepted", "declined", "revoked", "missing"]).has(String(row.status))
    || row.policyVersion !== OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope]) return null;
  if (row.active !== (row.status === "accepted")) return null;
  const decidedAt = row.decidedAt === null ? null : iso(row.decidedAt);
  if (row.decidedAt !== null && !decidedAt) return null;
  if (row.status === "missing") {
    if (row.active || row.source !== null || row.decidedAt !== null) return null;
  } else if (!decidedAt || typeof row.source !== "string" || !row.source.trim()) return null;
  return {
    active: row.active,
    status: row.status as OptionalAuthorizationStatus,
    policyVersion: OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
    source: typeof row.source === "string" ? row.source : null,
    decidedAt,
  };
}

export function parseOptionalAuthorizationState(value: unknown): OptionalAuthorizationState | null {
  const body = object(value);
  const rawScopes = object(body?.scopes);
  const rawSharing = object(body?.sharing);
  const rawNotifications = object(body?.notifications);
  if (!body || body.bundleVersion !== OPTIONAL_AUTHORIZATION_BUNDLE_VERSION || !rawScopes || !rawSharing || !rawNotifications
    || typeof body.resolved !== "boolean" || typeof body.eligible !== "boolean"
    || !new Set(["private", "friends", "public"]).has(String(body.profileVisibility))
    || !new Set(["PRIVATE", "FRIENDS"]).has(String(body.socialPrivacy))
    || !new Set(["PRIVATE", "FRIENDS", "PUBLIC"]).has(String(body.socialProfilePrivacy))) return null;
  const rawScopeKeys = Object.keys(rawScopes);
  if (rawScopeKeys.length !== OPTIONAL_AUTHORIZATION_SCOPES.length
    || rawScopeKeys.some((scope) => !scopeSet.has(scope))) return null;

  const scopes = {} as Record<OptionalAuthorizationScope, OptionalAuthorizationScopeState>;
  for (const scope of OPTIONAL_AUTHORIZATION_SCOPES) {
    const parsed = scopeState(scope, rawScopes[scope]);
    if (!parsed) return null;
    scopes[scope] = parsed;
  }

  const booleanFields = (source: Record<string, unknown>, fields: readonly string[]) => fields.every((field) => typeof source[field] === "boolean");
  if (!booleanFields(rawSharing, ["enabledForFriends", "rounds", "achievements", "equipment", "courses"])
    || !booleanFields(rawNotifications, ["internal", "master", "push", "email", "rounds", "reminders"])) return null;

  let receipt: OptionalAuthorizationState["receipt"] = null;
  if (body.receipt !== null) {
    const rawReceipt = object(body.receipt);
    // The canonical Postgres getter includes the internal receipt UUID. Older
    // fixtures and clients predate that metadata, so accept exactly either
    // known shape while continuing to reject every other unexpected field.
    // The UUID is validated but intentionally omitted from the public client
    // state because callers only need the idempotency key and decision.
    const receiptKeys = ["action", "bundleVersion", "idempotencyKey", "decidedAt", "featureSet"] as const;
    const receiptKeysWithId = [...receiptKeys, "id"] as const;
    const receiptHasId = Boolean(rawReceipt && Object.prototype.hasOwnProperty.call(rawReceipt, "id"));
    const receiptHasKnownShape = Boolean(rawReceipt
      && (exactKeys(rawReceipt, receiptKeys) || exactKeys(rawReceipt, receiptKeysWithId)));
    const rawFeatureSet = object(rawReceipt?.featureSet);
    const rawFeatureScopes = rawFeatureSet?.scopes;
    const rawExcluded = rawFeatureSet?.excluded;
    const rawProjections = object(rawFeatureSet?.projections);
    const rawProjectionSharing = object(rawProjections?.sharing);
    const rawProjectionNotifications = object(rawProjections?.notifications);
    const decidedAt = iso(rawReceipt?.decidedAt);
    if (!rawReceipt || !receiptHasKnownShape
      || (rawReceipt.action !== "authorize_all" && rawReceipt.action !== "decline_all")
      || rawReceipt.bundleVersion !== OPTIONAL_AUTHORIZATION_BUNDLE_VERSION
      || typeof rawReceipt.idempotencyKey !== "string" || !UUID.test(rawReceipt.idempotencyKey) || !decidedAt
      || (receiptHasId && (typeof rawReceipt.id !== "string" || !UUID.test(rawReceipt.id)))
      || !rawFeatureSet || !exactKeys(rawFeatureSet, ["scopes", "excluded", "projections"])
      || !Array.isArray(rawFeatureScopes) || rawFeatureScopes.length !== OPTIONAL_AUTHORIZATION_SCOPES.length
      || !Array.isArray(rawExcluded) || rawExcluded.length !== 2
      || !rawExcluded.includes("MARKETING") || !rawExcluded.includes("FINANCIAL_PATRIMONIAL")
      || !rawProjections || !exactKeys(rawProjections, ["profileVisibility", "socialPrivacy", "socialProfilePrivacy", "sharing", "notifications"])
      || !rawProjectionSharing || !exactKeys(rawProjectionSharing, ["enabledForFriends", "rounds", "achievements", "equipment", "courses"])
      || !rawProjectionNotifications || !exactKeys(rawProjectionNotifications, ["internal", "master", "push", "email", "rounds", "reminders"])) return null;
    const receiptEnabled = rawReceipt.action === "authorize_all";
    if (rawProjections.profileVisibility !== (receiptEnabled ? "public" : "private")
      || rawProjections.socialPrivacy !== (receiptEnabled ? "FRIENDS" : "PRIVATE")
      || rawProjections.socialProfilePrivacy !== (receiptEnabled ? "PUBLIC" : "PRIVATE")
      || !Object.values(rawProjectionSharing).every((value) => value === receiptEnabled)
      || !Object.values(rawProjectionNotifications).every((value) => value === receiptEnabled)) return null;
    const receiptScopes = new Set<OptionalAuthorizationScope>();
    for (const rawFeatureScope of rawFeatureScopes) {
      const featureScope = object(rawFeatureScope);
      const scope = parseOptionalAuthorizationScope(featureScope?.scope);
      if (!featureScope || !exactKeys(featureScope, ["scope", "policyVersion"])
        || !scope || featureScope.policyVersion !== OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope]
        || receiptScopes.has(scope)) return null;
      receiptScopes.add(scope);
    }
    receipt = { action: rawReceipt.action, idempotencyKey: rawReceipt.idempotencyKey, decidedAt };
  }
  if (body.resolved !== Boolean(receipt)) return null;

  return {
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved: body.resolved,
    eligible: body.eligible,
    receipt,
    scopes,
    profileVisibility: body.profileVisibility as OptionalAuthorizationState["profileVisibility"],
    socialPrivacy: body.socialPrivacy as OptionalAuthorizationState["socialPrivacy"],
    socialProfilePrivacy: body.socialProfilePrivacy as OptionalAuthorizationState["socialProfilePrivacy"],
    sharing: {
      enabledForFriends: rawSharing.enabledForFriends as boolean,
      rounds: rawSharing.rounds as boolean,
      achievements: rawSharing.achievements as boolean,
      equipment: rawSharing.equipment as boolean,
      courses: rawSharing.courses as boolean,
    },
    notifications: {
      internal: rawNotifications.internal as boolean,
      master: rawNotifications.master as boolean,
      push: rawNotifications.push as boolean,
      email: rawNotifications.email as boolean,
      rounds: rawNotifications.rounds as boolean,
      reminders: rawNotifications.reminders as boolean,
    },
  };
}

function requestFailure(value: unknown) {
  const body = object(value);
  return new Error(typeof body?.error === "string" ? body.error : "No pudimos confirmar tus autorizaciones opcionales.");
}

async function optionalAuthorizationRequest(
  accessToken: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
  timeoutMs = OPTIONAL_AUTHORIZATION_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = globalThis.setTimeout(abort, Math.max(1, timeoutMs));
  try {
    const response = await transport("/api/account/optional-authorizations", {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload: unknown = await response.json().catch(() => null);
    const parsed = parseOptionalAuthorizationState(payload);
    if (!response.ok || !parsed) throw requestFailure(payload);
    return parsed;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function requestOptionalAuthorizationState(accessToken: string, signal?: AbortSignal, transport?: typeof fetch, timeoutMs?: number) {
  return optionalAuthorizationRequest(accessToken, "GET", undefined, signal, transport, timeoutMs);
}

export function resolveOptionalAuthorizationBundle(
  accessToken: string,
  action: OptionalAuthorizationAction,
  idempotencyKey: string,
  signal?: AbortSignal,
  transport?: typeof fetch,
  timeoutMs?: number,
) {
  return optionalAuthorizationRequest(accessToken, "POST", {
    action,
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    idempotencyKey,
  }, signal, transport, timeoutMs);
}

export function saveOptionalAuthorizationScope(
  accessToken: string,
  scope: OptionalAuthorizationSettingsScope,
  enabled: boolean,
  idempotencyKey: string,
  signal?: AbortSignal,
  transport?: typeof fetch,
  timeoutMs?: number,
) {
  return optionalAuthorizationRequest(accessToken, "PATCH", { scope, enabled, idempotencyKey }, signal, transport, timeoutMs);
}

export function isCompleteBundleResolution(state: OptionalAuthorizationState, action: OptionalAuthorizationAction) {
  if (!state.resolved || state.receipt?.action !== action) return false;
  const accepted = action === "authorize_all";
  if (OPTIONAL_AUTHORIZATION_SCOPES.some((scope) => state.scopes[scope].active !== accepted)) return false;
  return accepted
    ? state.profileVisibility === "public"
      && state.socialPrivacy === "FRIENDS"
      && state.socialProfilePrivacy === "PUBLIC"
      && Object.values(state.sharing).every(Boolean)
      && Object.values(state.notifications).every(Boolean)
    : state.profileVisibility === "private"
      && state.socialPrivacy === "PRIVATE"
      && state.socialProfilePrivacy === "PRIVATE"
      && Object.values(state.sharing).every((value) => !value)
      && Object.values(state.notifications).every((value) => !value);
}
