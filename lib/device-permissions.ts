export const DEVICE_PERMISSIONS_VERSION = 1 as const;
export const NEARBY_LOCATION_CACHE_TTL_MS = 5 * 60_000;

export type DevicePermissionStatus = "unknown" | "prompt" | "granted" | "denied" | "timeout" | "unavailable";
export type LocationPermissionUiState = "checking" | "prompt" | "granted" | "denied" | "query-unsupported" | "geolocation-unavailable" | "requesting" | "timeout" | "unavailable";
export type NotificationPermissionUiState = "checking" | "default" | "granted" | "denied" | "unavailable" | "requesting";

export type DevicePermissionContext = { ios: boolean; standalone: boolean; notificationApi: boolean };
export type PermissionPresentation = { status: string; detail?: string; action: "request" | "retry" | "help" | null; actionLabel?: string };
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
type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function now() { return new Date().toISOString(); }
function coordinate(value: number) { return Math.round(value * 100) / 100; }

export function devicePermissionContext(input: { userAgent?: string; platform?: string; maxTouchPoints?: number; standaloneDisplayMode?: boolean; navigatorStandalone?: boolean; notificationApi?: boolean }): DevicePermissionContext {
  const ios = /iPad|iPhone|iPod/i.test(input.userAgent || "") || (input.platform === "MacIntel" && (input.maxTouchPoints || 0) > 1);
  return { ios, standalone: input.standaloneDisplayMode === true || input.navigatorStandalone === true, notificationApi: input.notificationApi === true };
}

export function locationPermissionPresentation(state: LocationPermissionUiState): PermissionPresentation {
  if (state === "checking") return { status: "Consultando permiso…", action: null };
  if (state === "requesting") return { status: "Solicitando permiso…", action: null };
  if (state === "prompt") return { status: "La ubicación todavía no se ha solicitado en este dispositivo.", action: "request", actionLabel: "Permitir ubicación" };
  if (state === "granted") return { status: "Ubicación permitida", detail: "The Backyard puede usarla cuando pidas campos cercanos. No puede revocar este permiso por ti.", action: "help", actionLabel: "Cómo cambiar este permiso" };
  if (state === "denied") return { status: "Ubicación bloqueada", detail: "Debes habilitarla desde los permisos de The Backyard en tu dispositivo.", action: "help", actionLabel: "Cómo habilitarla" };
  if (state === "query-unsupported") return { status: "No podemos consultar este permiso desde este navegador.", detail: "Puedes revisar los permisos de The Backyard en tu dispositivo. La búsqueda manual sigue disponible.", action: "help", actionLabel: "Cómo revisar este permiso" };
  if (state === "geolocation-unavailable") return { status: "La ubicación no está disponible en este dispositivo.", detail: "Puedes buscar campos manualmente.", action: "help", actionLabel: "Ver alternativas" };
  if (state === "timeout") return { status: "La ubicación tardó demasiado.", detail: "Esto no significa que hayas rechazado el permiso.", action: "retry", actionLabel: "Reintentar ubicación" };
  return { status: "No pudimos obtener la ubicación de este dispositivo.", detail: "Comprueba los permisos o busca el campo manualmente.", action: "retry", actionLabel: "Reintentar ubicación" };
}

export function notificationPermissionPresentation(state: NotificationPermissionUiState, context: DevicePermissionContext, pushBackendConfigured = false): PermissionPresentation {
  if (!context.notificationApi || state === "unavailable") return { status: "Las notificaciones no están disponibles en este dispositivo o contexto.", detail: "Puedes conservar tus preferencias; no se activará un servicio push inexistente.", action: "help", actionLabel: "Más información" };
  if (state === "checking") return { status: "Consultando permiso…", action: null };
  if (state === "requesting") return { status: "Solicitando permiso…", action: null };
  if (state === "default") return { status: "Las notificaciones todavía no se han solicitado en este dispositivo.", detail: "El sistema mostrará su aviso al tocar el botón.", action: "request", actionLabel: "Permitir notificaciones" };
  if (state === "granted") return { status: "Permitidas en este dispositivo", detail: pushBackendConfigured ? "El permiso está listo; tus preferencias deciden qué avisos recibir." : "El envío push de The Backyard todavía no está activado.", action: "help", actionLabel: "Cómo cambiar este permiso" };
  return { status: "Bloqueadas en este dispositivo", detail: "The Backyard no puede volver a abrir un aviso bloqueado automáticamente.", action: "help", actionLabel: "Cómo habilitarlas" };
}

export function devicePermissionsStorageKey(userId: string) { return `the-backyard:device-permissions:v${DEVICE_PERMISSIONS_VERSION}:${encodeURIComponent(userId)}`; }

export function emptyDevicePermissionPreferences(userId: string, at = now()): DevicePermissionPreferences {
  return { version: DEVICE_PERMISSIONS_VERSION, userId, location: "unknown", notifications: "unknown", locationEnabled: false, notificationsEnabled: false, resolvedAt: null, updatedAt: at };
}

export function normalizeDevicePermissionPreferences(value: unknown, userId: string): DevicePermissionPreferences {
  const fallback = emptyDevicePermissionPreferences(userId);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<DevicePermissionPreferences>;
  const valid = (status: unknown): status is DevicePermissionStatus => ["unknown", "prompt", "granted", "denied", "timeout", "unavailable"].includes(String(status));
  const coarse = candidate.coarseLocation;
  const coarseLocation = coarse && Number.isFinite(coarse.latitude) && Number.isFinite(coarse.longitude) && Math.abs(coarse.latitude) <= 90 && Math.abs(coarse.longitude) <= 180 && typeof coarse.capturedAt === "string" && Number.isFinite(Date.parse(coarse.capturedAt))
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

export function readDevicePermissionPreferences(storage: ReadableStorage, userId: string) {
  try { return normalizeDevicePermissionPreferences(JSON.parse(storage.getItem(devicePermissionsStorageKey(userId)) || "null"), userId); }
  catch { return emptyDevicePermissionPreferences(userId); }
}

export function saveDevicePermissionPreferences(storage: WritableStorage, preferences: DevicePermissionPreferences) {
  storage.setItem(devicePermissionsStorageKey(preferences.userId), JSON.stringify(preferences));
  return preferences;
}

export function finishInitialDevicePermissions(storage: ReadableStorage & WritableStorage, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  const at = now();
  return saveDevicePermissionPreferences(storage, { ...current, resolvedAt: current.resolvedAt || at, updatedAt: at });
}

export function disableLocationForApp(storage: ReadableStorage & WritableStorage, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  return saveDevicePermissionPreferences(storage, {
    ...current,
    coarseLocation: undefined,
    locationEnabled: false,
    updatedAt: now(),
  });
}

export function disableNotificationsForApp(storage: ReadableStorage & WritableStorage, userId: string) {
  const current = readDevicePermissionPreferences(storage, userId);
  return saveDevicePermissionPreferences(storage, { ...current, notificationsEnabled: false, updatedAt: now() });
}

export async function queryBrowserPermissionState(kind: "geolocation" | "notifications", navigatorValue: Navigator = navigator): Promise<DevicePermissionStatus> {
  const permissions = (navigatorValue as PermissionNavigator).permissions;
  if (!permissions?.query) return "unavailable";
  try {
    const result = await permissions.query({ name: kind === "geolocation" ? "geolocation" : "notifications" } as PermissionDescriptor);
    return result.state === "default" ? "prompt" : result.state;
  } catch { return "unavailable"; }
}

export function requestInitialLocation(storage: ReadableStorage & WritableStorage, userId: string, geolocation: Geolocation | undefined = navigator.geolocation): Promise<DevicePermissionPreferences> {
  const current = readDevicePermissionPreferences(storage, userId);
  if (!geolocation) return Promise.resolve(saveDevicePermissionPreferences(storage, { ...current, location: "unavailable", updatedAt: now() }));
  return new Promise(resolve => {
    geolocation.getCurrentPosition(position => {
      const latest = readDevicePermissionPreferences(storage, userId);
      const capturedAt = now();
      resolve(saveDevicePermissionPreferences(storage, { ...latest, location: "granted", locationEnabled: true, coarseLocation: { latitude: coordinate(position.coords.latitude), longitude: coordinate(position.coords.longitude), capturedAt }, updatedAt: capturedAt }));
    }, error => {
      const latest = readDevicePermissionPreferences(storage, userId);
      const at = now();
      if (error.code === error.PERMISSION_DENIED) {
        const { coarseLocation: _coarseLocation, ...rest } = latest;
        resolve(saveDevicePermissionPreferences(storage, { ...rest, location: "denied", locationEnabled: false, updatedAt: at }));
        return;
      }
      resolve(saveDevicePermissionPreferences(storage, { ...latest, location: error.code === error.TIMEOUT ? "timeout" : "unavailable", updatedAt: at }));
    }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 0 });
  });
}

export async function requestInitialNotifications(storage: ReadableStorage & WritableStorage, userId: string, notificationApi: Pick<typeof Notification, "permission" | "requestPermission"> | undefined = globalThis.Notification) {
  const current = readDevicePermissionPreferences(storage, userId);
  if (!notificationApi) return saveDevicePermissionPreferences(storage, { ...current, notifications: "unavailable", notificationsEnabled: false, updatedAt: now() });
  const permission = notificationApi.permission === "default" ? await notificationApi.requestPermission() : notificationApi.permission;
  return saveDevicePermissionPreferences(storage, { ...current, notifications: permission === "default" ? "prompt" : permission, notificationsEnabled: permission === "granted", updatedAt: now() });
}

export async function refreshDevicePermissionStateWithoutPrompt(storage: ReadableStorage & WritableStorage, userId: string, navigatorValue: Navigator = navigator) {
  const current = readDevicePermissionPreferences(storage, userId);
  const [location, notifications] = await Promise.all([queryBrowserPermissionState("geolocation", navigatorValue), queryBrowserPermissionState("notifications", navigatorValue)]);
  const notificationPermission = typeof Notification === "undefined" ? "unavailable" as const : Notification.permission === "default" ? "prompt" as const : Notification.permission;
  const nextLocation = location === "unavailable" ? current.location : location;
  const nextNotifications = notifications === "unavailable" ? notificationPermission : notifications;
  const locationDisabled = nextLocation === "denied";
  const next = { ...current, location: nextLocation, notifications: nextNotifications, locationEnabled: locationDisabled ? false : current.locationEnabled, notificationsEnabled: current.notificationsEnabled && nextNotifications === "granted", updatedAt: now() };
  if (!locationDisabled) return saveDevicePermissionPreferences(storage, next);
  const { coarseLocation: _coarseLocation, ...withoutCoordinates } = next;
  return saveDevicePermissionPreferences(storage, withoutCoordinates);
}

export function storedNearbyCoordinates(storage: ReadableStorage, userId: string, at = Date.now(), maxAgeMs = NEARBY_LOCATION_CACHE_TTL_MS) {
  const current = readDevicePermissionPreferences(storage, userId);
  if (!current.locationEnabled || current.location !== "granted" || !current.coarseLocation) return null;
  const capturedAt = Date.parse(current.coarseLocation.capturedAt);
  if (!Number.isFinite(capturedAt) || at - capturedAt > maxAgeMs || capturedAt - at > 60_000) return null;
  return current.coarseLocation;
}
