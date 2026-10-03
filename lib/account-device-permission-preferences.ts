import {
  readDevicePermissionPreferences,
  saveDevicePermissionPreferences,
  type DevicePermissionPreferences,
  type LocationPreference,
} from "./device-permissions";
import type { OptionalAuthorizationState } from "./account-optional-authorizations";

export const LOCATION_USAGE_PREFERENCE_METADATA_KEY = "backyard_location_usage_preference_v1";
export const NOTIFICATION_USAGE_PREFERENCE_METADATA_KEY = "backyard_notification_usage_preference_v1";

export type AccountPermissionValue = Exclude<LocationPreference, "undecided">;

export type AccountPermissionRecord = {
  version: 1;
  value: AccountPermissionValue;
  changedAt: string;
};

export type AccountDevicePermissionPreferences = {
  location: AccountPermissionRecord | null;
  notifications: AccountPermissionRecord | null;
};

export type AccountPermissionPreferenceKind = keyof AccountDevicePermissionPreferences;

export type DevicePermissionReconciliation = {
  preferences: DevicePermissionPreferences;
  pending: Array<{ preference: AccountPermissionPreferenceKind; record: AccountPermissionRecord }>;
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

type ServerDecisionClock = {
  schemaVersion: 1;
  userId: string;
  scopes: Partial<Record<AccountPermissionPreferenceKind, AccountPermissionRecord>>;
};

const LEGACY_SERVER_DECISION_CLOCK_NAMESPACE = "the-backyard:account-device-permission-server-clock:v1";
const volatileServerClocks = new WeakMap<object, Map<string, ServerDecisionClock>>();

function serverDecisionClockKey(userId: string) {
  return `${LEGACY_SERVER_DECISION_CLOCK_NAMESPACE}:${encodeURIComponent(userId)}`;
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseAccountPermissionRecord(value: unknown): AccountPermissionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || (candidate.value !== "enabled" && candidate.value !== "disabled")
    || !validIsoTimestamp(candidate.changedAt)) return null;
  return { version: 1, value: candidate.value, changedAt: new Date(candidate.changedAt).toISOString() };
}

export function parseAccountDevicePermissionPreferences(value: unknown): AccountDevicePermissionPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const location = candidate.location === null ? null : parseAccountPermissionRecord(candidate.location);
  const notifications = candidate.notifications === null ? null : parseAccountPermissionRecord(candidate.notifications);
  if (location === null && candidate.location !== null) return null;
  if (notifications === null && candidate.notifications !== null) return null;
  return { location, notifications };
}

// These are internal product choices in the existing optional authorization
// ledger. They never represent a browser grant or access to a photo library.
export type AccountDeviceMediaPreferences = Record<"camera" | "photos", AccountPermissionRecord | null>;

export function parseAccountDeviceMediaPreferences(value: unknown): AccountDeviceMediaPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const camera = candidate.camera === null ? null : parseAccountPermissionRecord(candidate.camera);
  const photos = candidate.photos === null ? null : parseAccountPermissionRecord(candidate.photos);
  if ((camera === null && candidate.camera !== null) || (photos === null && candidate.photos !== null)) return null;
  return { camera, photos };
}

export async function requestAccountDeviceMediaPreferences(
  accessToken: string,
  decision?: { preference: keyof AccountDeviceMediaPreferences; enabled: boolean; idempotencyKey: string },
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const response = await transport("/api/account/device-permission-preferences?media=true", {
    method: decision ? "PATCH" : "GET",
    headers: { authorization: `Bearer ${accessToken}`, ...(decision ? { "content-type": "application/json" } : {}) },
    ...(decision ? { body: JSON.stringify(decision) } : {}),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const parsed = parseAccountDeviceMediaPreferences(await response.json().catch(() => null));
  if (!response.ok || !parsed || (decision && parsed[decision.preference]?.value !== (decision.enabled ? "enabled" : "disabled"))) {
    throw new Error("No pudimos confirmar tus decisiones de Cámara y Fotos / Fototeca.");
  }
  return parsed;
}

function readServerDecisionClock(storage: PreferenceStorage, userId: string): ServerDecisionClock {
  const volatile = volatileServerClocks.get(storage)?.get(userId);
  return {
    schemaVersion: 1,
    userId,
    scopes: {
      location: volatile?.scopes.location,
      notifications: volatile?.scopes.notifications,
    },
  };
}

function writeServerDecisionClock(storage: PreferenceStorage, clock: ServerDecisionClock) {
  let clocks = volatileServerClocks.get(storage);
  if (!clocks) {
    clocks = new Map();
    volatileServerClocks.set(storage, clocks);
  }
  clocks.set(clock.userId, clock);
}

/** Remove the in-memory authority and any legacy durable clock. Browser
 * storage is editable by the client and is never trusted as consent evidence. */
export function clearAccountDevicePermissionServerClock(
  storage: Pick<Storage, "removeItem">,
  userId: string,
) {
  const clocks = volatileServerClocks.get(storage);
  clocks?.delete(userId);
  if (clocks?.size === 0) volatileServerClocks.delete(storage);
  try { storage.removeItem(serverDecisionClockKey(userId)); } catch { /* Best effort during account cleanup. */ }
}

/**
 * Reconciles durable account intent with one device's OS state. Any explicit
 * server decision is canonical, regardless of the device clock. Missing cloud
 * data is not a negative choice and preserves a local cache, but never turns an
 * OS grant (or that cache) into consent that should be uploaded automatically.
 */
export function reconcileAccountDevicePermissionPreferences(
  local: DevicePermissionPreferences,
  remote: AccountDevicePermissionPreferences,
  at = new Date().toISOString(),
): DevicePermissionReconciliation {
  const location = remote.location;
  const notifications = remote.notifications;
  const next: DevicePermissionPreferences = {
    ...local,
    ...(location ? {
      locationPreference: location.value,
      locationPreferenceUpdatedAt: location.changedAt,
      // Runtime location is usable only when both the durable in-app intent
      // and this device's OS permission are positive.
      locationEnabled: location.value === "enabled" && local.location === "granted",
      ...(location.value === "disabled" ? { coarseLocation: undefined } : {}),
    } : {}),
    ...(notifications ? {
      notificationPreference: notifications.value,
      notificationPreferenceUpdatedAt: notifications.changedAt,
      notificationsEnabled: notifications.value === "enabled",
    } : {}),
    updatedAt: location || notifications ? at : local.updatedAt,
  };
  return { preferences: next, pending: [] };
}

export function persistReconciledDevicePermissionPreferences(
  storage: PreferenceStorage,
  reconciliation: DevicePermissionReconciliation,
) {
  return saveDevicePermissionPreferences(storage, reconciliation.preferences);
}

/** Applies server-confirmed account intent with an in-memory per-scope response
 * clock. Browser storage remains only a UI cache and cannot authorize use. */
export function cacheAccountDevicePermissionPreferences(
  storage: PreferenceStorage,
  userId: string,
  remote: AccountDevicePermissionPreferences,
  at = new Date().toISOString(),
) {
  const clock = readServerDecisionClock(storage, userId);
  const canonical: AccountDevicePermissionPreferences = { location: null, notifications: null };
  let current = readDevicePermissionPreferences(storage, userId);
  for (const preference of ["location", "notifications"] as const) {
    const incoming = remote[preference];
    const previous = clock.scopes[preference];
    if (!incoming) {
      if (previous) canonical[preference] = previous;
      else if (preference === "location") {
        const withoutCoordinates = { ...current };
        delete withoutCoordinates.coarseLocation;
        current = {
          ...withoutCoordinates,
          locationPreference: "undecided",
          locationPreferenceUpdatedAt: null,
          locationEnabled: false,
        };
      } else {
        current = {
          ...current,
          notificationPreference: "undecided",
          notificationPreferenceUpdatedAt: null,
          notificationsEnabled: false,
        };
      }
      continue;
    }
    if (!previous || Date.parse(incoming.changedAt) >= Date.parse(previous.changedAt)) {
      clock.scopes[preference] = incoming;
      canonical[preference] = incoming;
    } else {
      canonical[preference] = previous;
    }
  }
  const reconciliation = reconcileAccountDevicePermissionPreferences(current, canonical, at);
  // Keep the server clock before attempting a durable mirror. The canonical
  // runtime decision must survive Safari private mode or a full storage quota.
  writeServerDecisionClock(storage, clock);
  try {
    return persistReconciledDevicePermissionPreferences(storage, reconciliation);
  } catch {
    return reconciliation.preferences;
  }
}

/** A failed canonical read is not permission to trust legacy local ON values.
 * This keeps only per-scope states backed by a prior server response clock. */
export function failClosedAccountDevicePermissionPreferences(
  storage: PreferenceStorage,
  userId: string,
) {
  return cacheAccountDevicePermissionPreferences(storage, userId, {
    location: null,
    notifications: null,
  });
}

/** Runtime read for an authenticated account. It applies the latest
 * server-confirmed volatile clock even when the local mirror could not be
 * written, preventing an older cached ON value from authorizing use. */
export function readAccountDevicePermissionPreferences(
  storage: PreferenceStorage,
  userId: string,
) {
  return failClosedAccountDevicePermissionPreferences(storage, userId);
}

/** Mirrors server decisions into one device without minting a newer local
 * timestamp. The ledger is canonical even when a device clock is ahead; a
 * missing scope preserves the cache and never fabricates acceptance. */
export function hydrateOptionalDevicePermissionPreferences(
  storage: PreferenceStorage,
  userId: string,
  state: OptionalAuthorizationState,
) {
  const location = state.scopes.LOCATION_INTERNAL;
  const notifications = state.scopes.NOTIFICATION_INTERNAL;
  return cacheAccountDevicePermissionPreferences(storage, userId, {
    location: location.status !== "missing" && location.decidedAt
      ? { version: 1, value: location.active ? "enabled" : "disabled", changedAt: location.decidedAt }
      : null,
    notifications: notifications.status !== "missing" && notifications.decidedAt
      ? { version: 1, value: notifications.active ? "enabled" : "disabled", changedAt: notifications.decidedAt }
      : null,
  });
}

function accountPreferenceFailure(value: unknown) {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return new Error(typeof body?.error === "string" ? body.error : "No pudimos sincronizar esta preferencia de cuenta.");
}

export async function requestAccountDevicePermissionPreferences(
  accessToken: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const response = await transport("/api/account/device-permission-preferences", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = parseAccountDevicePermissionPreferences(body);
  if (!response.ok || !parsed) throw accountPreferenceFailure(body);
  return parsed;
}

export async function saveAccountDevicePermissionPreference(
  accessToken: string,
  preference: AccountPermissionPreferenceKind,
  record: AccountPermissionRecord,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const response = await transport("/api/account/device-permission-preferences", {
    method: "PATCH",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ preference, ...record }),
    cache: "no-store",
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = parseAccountDevicePermissionPreferences(body);
  if (!response.ok || !parsed) throw accountPreferenceFailure(body);
  const confirmed = parsed[preference];
  // The server is canonical for its own timestamp. Comparing client and server
  // clocks can turn a successful write into a false failure under clock skew.
  if (!confirmed || confirmed.value !== record.value) {
    throw new Error("La nube no confirmó la preferencia más reciente.");
  }
  return parsed;
}

/**
 * Records the legacy in-app notification switch in the canonical
 * NOTIFICATION_INTERNAL scope before mirroring it into this device. The
 * device permission and delivery registration are intentionally preserved:
 * this function records product intent only.
 */
export async function saveCanonicalAccountNotificationPreference(
  storage: PreferenceStorage,
  userId: string,
  accessToken: string,
  enabled: boolean,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const remote = await saveAccountDevicePermissionPreference(accessToken, "notifications", {
    version: 1,
    value: enabled ? "enabled" : "disabled",
    changedAt: new Date().toISOString(),
  }, signal, transport);
  const preferences = cacheAccountDevicePermissionPreferences(storage, userId, remote);
  const confirmed = preferences.notificationPreference === "enabled";
  if (confirmed !== enabled) throw new Error("La nube no confirmó la preferencia interna de notificaciones.");
  return preferences;
}
