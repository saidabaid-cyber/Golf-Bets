import {
  saveDevicePermissionPreferences,
  type DevicePermissionPreferences,
  type LocationPreference,
  type NotificationPreference,
} from "./device-permissions";

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

type PreferenceStorage = Pick<Storage, "setItem">;

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

function localRecord(value: LocationPreference | NotificationPreference, changedAt: string | null) {
  return value !== "undecided" && validIsoTimestamp(changedAt)
    ? { version: 1 as const, value, changedAt: new Date(changedAt).toISOString() }
    : null;
}

function newer(left: AccountPermissionRecord | null, right: AccountPermissionRecord | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left.changedAt) > Date.parse(right.changedAt) ? left : right;
}

/**
 * Reconciles durable account intent with one device's OS state. Missing cloud
 * data is not a negative choice. A granted OS permission without any recorded
 * app-level decision is the legacy signal that this account had opted in.
 */
export function reconcileAccountDevicePermissionPreferences(
  local: DevicePermissionPreferences,
  remote: AccountDevicePermissionPreferences,
  at = new Date().toISOString(),
): DevicePermissionReconciliation {
  const inferredLocation = local.locationPreference === "undecided" && local.location === "granted"
    ? { version: 1 as const, value: "enabled" as const, changedAt: at }
    : null;
  const inferredNotifications = local.notificationPreference === "undecided" && local.notifications === "granted"
    ? { version: 1 as const, value: "enabled" as const, changedAt: at }
    : null;
  const localLocation = localRecord(local.locationPreference, local.locationPreferenceUpdatedAt) ?? inferredLocation;
  const localNotifications = localRecord(local.notificationPreference, local.notificationPreferenceUpdatedAt) ?? inferredNotifications;
  const location = newer(localLocation, remote.location);
  const notifications = newer(localNotifications, remote.notifications);
  const pending: DevicePermissionReconciliation["pending"] = [];
  if (location && (!remote.location || Date.parse(location.changedAt) > Date.parse(remote.location.changedAt))) {
    pending.push({ preference: "location", record: location });
  }
  if (notifications && (!remote.notifications || Date.parse(notifications.changedAt) > Date.parse(remote.notifications.changedAt))) {
    pending.push({ preference: "notifications", record: notifications });
  }
  const next: DevicePermissionPreferences = {
    ...local,
    ...(location ? {
      locationPreference: location.value,
      locationPreferenceUpdatedAt: location.changedAt,
      locationEnabled: location.value === "enabled" && local.location !== "denied",
    } : {}),
    ...(notifications ? {
      notificationPreference: notifications.value,
      notificationPreferenceUpdatedAt: notifications.changedAt,
      notificationsEnabled: notifications.value === "enabled",
    } : {}),
    updatedAt: at,
  };
  return { preferences: next, pending };
}

export function persistReconciledDevicePermissionPreferences(
  storage: PreferenceStorage,
  reconciliation: DevicePermissionReconciliation,
) {
  return saveDevicePermissionPreferences(storage, reconciliation.preferences);
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
  if (!confirmed || confirmed.value !== record.value || Date.parse(confirmed.changedAt) < Date.parse(record.changedAt)) {
    throw new Error("La nube no confirmó la preferencia más reciente.");
  }
  return parsed;
}
