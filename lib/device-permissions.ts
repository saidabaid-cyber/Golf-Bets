export const DEVICE_PERMISSIONS_VERSION = 1 as const;

export type DevicePermissionStatus = "unknown" | "prompt" | "granted" | "denied" | "unavailable";

export type DevicePermissionPreferences = {
  version: typeof DEVICE_PERMISSIONS_VERSION;
  userId: string;
  location: DevicePermissionStatus;
  notifications: DevicePermissionStatus;
  locationEnabled: boolean;
  notificationsEnabled: boolean;
  coarseLocation?: { latitude: number; longitude: number; capturedAt: string };
  resolvedAt: string | null;
  updatedAt: string;
};

type PermissionNavigator = Navigator & { permissions?: { query(input: PermissionDescriptor): Promise<PermissionStatus> } };

function now() { return new Date().toISOString(); }
function coordinate(value: number) { return Math.round(value * 100) / 100; }

export function devicePermissionsStorageKey(userId: string) {
  return `the-backyard:device-permissions:v${DEVICE_PERMISSIONS_VERSION}:${encodeURIComponent(userId)}`;
}

export function emptyDevicePermissionPreferences(userId: string, at = now()): DevicePermissionPreferences {
  return {
    version: DEVICE_PERMISSIONS_VERSION,
    userId,
    location: "unknown",
    notifications: "unknown",
    locationEnabled: false,
    notificationsEnabled: false,
    resolvedAt: null,
    updatedAt: at,
  };
}

export function normalizeDevicePermissionPreferences(value: unknown, userId: string): DevicePermissionPreferences {
  const fallback = emptyDevicePermissionPreferences(userId);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<DevicePermissionPreferences>;
  const valid = (status: unknown): status is DevicePermissionStatus => ["unknown", "prompt", "granted", "denied", "unavailable"].includes(String(status));
  const coarse = candidate.coarseLocation;
  const coarseLocation = coarse
    && Number.isFinite(coarse.latitude) && Number.isFinite(coarse.longitude)
    && Math.abs(coarse.latitude) <= 90 && Math.abs(coarse.longitude) <= 180
    && typeof coarse.capturedAt === "string" && Number.isFinite(Date.parse(coarse.capturedAt))
    ? { latitude: coordinate(coarse.latitude), longitude: coordinate(coarse.longitude), capturedAt: coarse.capturedAt }
    : undefined;
  return {
    version: DEVICE_PERMISSIONS_VERSION,
    userId,
    location: valid(candidate.location) ? candidate.location : "unknown",
    notifications: valid(candidate.notifications) ? candidate.notifications : "unknown",
    locationEnabled: candidate.locationEnabled === true,
    notificationsEnabled: candidate.notificationsEnabled === true,
    ...(coarseLocation ? { coarseLocation } : {}),
    resolvedAt: typeof candidate.resolvedAt === "string" && Number.isFinite(Date.parse(candidate.resolvedAt)) ? candidate.resolvedAt : null,
    updatedAt: typeof candidate.updatedAt === "string" && Number.isFinite(Date.parse(candidate.updatedAt)) ? candidate.updatedAt : fallback.updatedAt,
  };
}

export function readDevicePermissionPreferences(storage: Pick<Storage, "getItem">, userId: string) {
  try {
    return normalizeDevicePermissionPreferences(JSON.parse(storage.getItem(devicePermissionsStorageKey(userId)) || "null"), userId);
  } catch {
    return emptyDevicePermissionPreferences(userId);
  }
}

export function saveDevicePermissionPreferences(storage: Pick<Storage, "setItem">, preferences: DevicePermissionPreferences) {
  storage.setItem(devicePermissionsStorageKey(preferences.userId), JSON.stringify(preferences));
  return preferences;
}

export function finishInitialDevicePermissions(storage: Pick<Storage, "getItem" | "setItem">, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  const at = now();
  return saveDevicePermissionPreferences(storage, { ...current, resolvedAt: current.resolvedAt || at, updatedAt: at });
}

export function disableLocationForApp(storage: Pick<Storage, "getItem" | "setItem">, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  return saveDevicePermissionPreferences(storage, {
    ...current,
    coarseLocation: undefined,
    locationEnabled: false,
    updatedAt: now(),
  });
}

export function disableNotificationsForApp(storage: Pick<Storage, "getItem" | "setItem">, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  return saveDevicePermissionPreferences(storage, { ...current, notificationsEnabled: false, updatedAt: now() });
}

export async function queryBrowserPermissionState(kind: "geolocation" | "notifications", navigatorValue: Navigator = navigator): Promise<DevicePermissionStatus> {
  const permissions = (navigatorValue as PermissionNavigator).permissions;
  if (!permissions?.query) return "unavailable";
  try {
    const result = await permissions.query({ name: kind === "geolocation" ? "geolocation" : "notifications" } as PermissionDescriptor);
    return result.state;
  } catch {
    return "unavailable";
  }
}

export function requestInitialLocation(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  geolocation: Geolocation | undefined = navigator.geolocation,
): Promise<DevicePermissionPreferences> {
  if (!geolocation) {
    const current = readDevicePermissionPreferences(storage, userId);
    return Promise.resolve(saveDevicePermissionPreferences(storage, { ...current, location: "unavailable", locationEnabled: false, updatedAt: now() }));
  }
  return new Promise(resolve => {
    geolocation.getCurrentPosition(position => {
      const current = readDevicePermissionPreferences(storage, userId);
      const capturedAt = now();
      resolve(saveDevicePermissionPreferences(storage, {
        ...current,
        location: "granted",
        locationEnabled: true,
        coarseLocation: { latitude: coordinate(position.coords.latitude), longitude: coordinate(position.coords.longitude), capturedAt },
        updatedAt: capturedAt,
      }));
    }, error => {
      const current = readDevicePermissionPreferences(storage, userId);
      const denied = error.code === error.PERMISSION_DENIED;
      resolve(saveDevicePermissionPreferences(storage, {
        ...current,
        location: denied ? "denied" : "unavailable",
        locationEnabled: false,
        updatedAt: now(),
      }));
    }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 });
  });
}

export async function requestInitialNotifications(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  notificationApi: Pick<typeof Notification, "permission" | "requestPermission"> | undefined = globalThis.Notification,
) {
  const current = readDevicePermissionPreferences(storage, userId);
  if (!notificationApi) return saveDevicePermissionPreferences(storage, { ...current, notifications: "unavailable", notificationsEnabled: false, updatedAt: now() });
  const permission = notificationApi.permission === "default" ? await notificationApi.requestPermission() : notificationApi.permission;
  return saveDevicePermissionPreferences(storage, {
    ...current,
    notifications: permission === "default" ? "prompt" : permission,
    notificationsEnabled: permission === "granted",
    updatedAt: now(),
  });
}

export async function refreshDevicePermissionStateWithoutPrompt(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  navigatorValue: Navigator = navigator,
) {
  const current = readDevicePermissionPreferences(storage, userId);
  const [location, notifications] = await Promise.all([
    queryBrowserPermissionState("geolocation", navigatorValue),
    queryBrowserPermissionState("notifications", navigatorValue),
  ]);
  const notificationPermission = typeof Notification === "undefined"
    ? "unavailable" as const
    : Notification.permission === "default" ? "prompt" as const : Notification.permission;
  const nextLocation = location === "unavailable" ? current.location : location;
  const nextNotifications = notifications === "unavailable" ? notificationPermission : notifications;
  return saveDevicePermissionPreferences(storage, {
    ...current,
    location: nextLocation,
    notifications: nextNotifications,
    locationEnabled: current.locationEnabled && nextLocation === "granted",
    notificationsEnabled: current.notificationsEnabled && nextNotifications === "granted",
    updatedAt: now(),
  });
}

export function storedNearbyCoordinates(storage: Pick<Storage, "getItem">, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  return current.locationEnabled && current.location === "granted" ? current.coarseLocation ?? null : null;
}
