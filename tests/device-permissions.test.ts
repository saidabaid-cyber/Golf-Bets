import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDevicePermissionPreferences,
  declineInitialNotifications,
  devicePermissionsStorageKey,
  disableLocationForApp,
  emptyDevicePermissionPreferences,
  finishInitialDevicePermissions,
  NEARBY_LOCATION_CACHE_TTL_MS,
  readDevicePermissionPreferences,
  processPendingNotificationIntent,
  refreshDevicePermissionStateWithoutPrompt,
  resolveAuthorizedNearbyLocation,
  requestInitialLocation,
  requestInitialNotifications,
  saveDevicePermissionPreferences,
  storedNearbyCoordinates,
} from "../lib/device-permissions";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test("initial location permission is user-scoped, keeps device precision, and is reusable without another prompt", async () => {
  const storage = memoryStorage();
  let prompts = 0;
  let requestedOptions: PositionOptions | undefined;
  const geolocation = {
    getCurrentPosition(success: PositionCallback, _failure?: PositionErrorCallback | null, options?: PositionOptions) {
      prompts += 1;
      requestedOptions = options;
      success({ coords: { latitude: 19.123456, longitude: -98.987654, accuracy: 18.4 } } as GeolocationPosition);
    },
  } as Geolocation;
  const saved = await requestInitialLocation(storage, "user-a", geolocation);
  assert.equal(prompts, 1);
  assert.deepEqual(saved.coarseLocation && { latitude: saved.coarseLocation.latitude, longitude: saved.coarseLocation.longitude, accuracyMeters: saved.coarseLocation.accuracyMeters }, { latitude: 19.123456, longitude: -98.987654, accuracyMeters: 18 });
  assert.equal(requestedOptions?.enableHighAccuracy, true);
  assert.deepEqual(storedNearbyCoordinates(storage, "user-a"), saved.coarseLocation);
  assert.equal(storedNearbyCoordinates(storage, "user-b"), null);
  assert.ok(storage.getItem(devicePermissionsStorageKey("user-a")));
});

test("permission onboarding can finish with optional permissions denied", () => {
  const storage = memoryStorage();
  const complete = finishInitialDevicePermissions(storage, "user-a");
  assert.ok(complete.resolvedAt);
  assert.equal(complete.locationEnabled, false);
  assert.equal(complete.notificationsEnabled, false);
});

test("revoking location in app clears coordinates and nearby never reuses them", async () => {
  const storage = memoryStorage();
  await requestInitialLocation(storage, "user-a", { getCurrentPosition(success: PositionCallback) { success({ coords: { latitude: 20, longitude: -99 } } as GeolocationPosition); } } as Geolocation);
  const disabled = disableLocationForApp(storage, "user-a");
  assert.equal(disabled.locationEnabled, false);
  assert.equal(disabled.coarseLocation, undefined);
  assert.equal(storedNearbyCoordinates(storage, "user-a"), null);
  assert.equal(readDevicePermissionPreferences(storage, "user-a").location, "granted");
});

test("leaving initial permissions ignores a late native location response", async () => {
  const storage = memoryStorage();
  let success: PositionCallback | undefined;
  const controller = new AbortController();
  const pending = requestInitialLocation(storage, "user-a", {
    getCurrentPosition(next: PositionCallback) { success = next; },
  } as unknown as Geolocation, { signal: controller.signal });
  controller.abort();
  const afterAbort = await pending;
  assert.equal(afterAbort.locationEnabled, false);
  success?.({ coords: { latitude: 20, longitude: -99 } } as GeolocationPosition);
  assert.equal(readDevicePermissionPreferences(storage, "user-a").coarseLocation, undefined);
});

test("notification permission default requests once and persists the real granted result", async () => {
  const storage = memoryStorage();
  let prompts = 0;
  const saved = await requestInitialNotifications(storage, "user-a", {
    permission: "default",
    async requestPermission() { prompts += 1; return "granted"; },
  });
  assert.equal(prompts, 1);
  assert.equal(saved.notifications, "granted");
  assert.equal(saved.notificationPreference, "enabled");
  assert.equal(saved.pushSubscription, "not_registered");
  assert.equal(saved.notificationsEnabled, true);
});

test("notification permission granted or denied is never requested repeatedly", async () => {
  for (const permission of ["granted", "denied"] as const) {
    const storage = memoryStorage();
    let prompts = 0;
    const saved = await requestInitialNotifications(storage, "user-a", {
      permission,
      async requestPermission() { prompts += 1; return permission; },
    });
    assert.equal(prompts, 0);
    assert.equal(saved.notifications, permission);
    assert.equal(saved.notificationPreference, "enabled");
    assert.equal(saved.notificationsEnabled, true);
  }
});

test("notification API unavailable stores positive intent without faking permission or push registration", async () => {
  const storage = memoryStorage();
  const saved = await requestInitialNotifications(storage, "user-a", undefined);
  assert.equal(saved.notifications, "unavailable");
  assert.equal(saved.notificationPreference, "enabled");
  assert.equal(saved.notificationsEnabled, true);
  assert.equal(saved.notificationPromptAttemptedAt, null);
  assert.equal(saved.pushSubscription, "not_registered");
});

test("pending notification intent requests once on the first later compatible surface", async () => {
  const storage = memoryStorage();
  await requestInitialNotifications(storage, "user-a", undefined);
  let prompts = 0;
  const api = {
    permission: "default" as NotificationPermission,
    async requestPermission() { prompts += 1; return "granted" as NotificationPermission; },
  };
  const processed = await processPendingNotificationIntent(storage, "user-a", api);
  assert.equal(prompts, 1);
  assert.equal(processed.notifications, "granted");
  assert.ok(processed.notificationPromptAttemptedAt);
  assert.equal(processed.pushSubscription, "not_registered");
  await processPendingNotificationIntent(storage, "user-a", api);
  assert.equal(prompts, 1);
});

test("Ahora no stores a negative preference without changing device permission", () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, { ...emptyDevicePermissionPreferences("user-a"), notifications: "prompt" });
  const saved = declineInitialNotifications(storage, "user-a");
  assert.equal(saved.notificationPreference, "disabled");
  assert.equal(saved.notifications, "prompt");
  assert.equal(saved.notificationsEnabled, false);
  assert.equal(saved.pushSubscription, "not_registered");
});

test("re-entering permissions refreshes real device state without opening a prompt", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a"),
    location: "prompt",
    notifications: "denied",
  });
  let prompts = 0;
  const refreshed = await refreshDevicePermissionStateWithoutPrompt(storage, "user-a", permissionNavigator("granted"), {
    permission: "granted",
    async requestPermission() { prompts += 1; return "granted"; },
  });
  assert.equal(prompts, 0);
  assert.equal(refreshed.location, "granted");
  assert.equal(refreshed.notifications, "granted");
  assert.equal(readDevicePermissionPreferences(storage, "user-a").notifications, "granted");
});

test("account cleanup invalidates a pending location write and preserves another owner", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-b"),
    location: "granted",
    locationEnabled: true,
    coarseLocation: { latitude: 19.04, longitude: -98.2, capturedAt: new Date().toISOString() },
  });
  let success: PositionCallback | undefined;
  const pending = requestInitialLocation(storage, "user-a", {
    getCurrentPosition(next: PositionCallback) { success = next; },
  } as unknown as Geolocation);

  clearDevicePermissionPreferences(storage, "user-a");
  success?.({ coords: { latitude: 20, longitude: -99 } } as GeolocationPosition);

  const result = await pending;
  assert.equal(result.locationEnabled, false);
  assert.equal(result.coarseLocation, undefined);
  assert.equal(storage.getItem(devicePermissionsStorageKey("user-a")), null);
  assert.ok(storage.getItem(devicePermissionsStorageKey("user-b")));
  assert.equal(readDevicePermissionPreferences(storage, "user-b").coarseLocation?.latitude, 19.04);
});

test("nearby coordinates expire instead of following the user indefinitely", async () => {
  const storage = memoryStorage();
  const saved = await requestInitialLocation(storage, "user-a", { getCurrentPosition(success: PositionCallback) { success({ coords: { latitude: 20, longitude: -99 } } as GeolocationPosition); } } as Geolocation);
  const capturedAt = Date.parse(saved.coarseLocation!.capturedAt);
  assert.ok(storedNearbyCoordinates(storage, "user-a", capturedAt + NEARBY_LOCATION_CACHE_TTL_MS));
  assert.equal(storedNearbyCoordinates(storage, "user-a", capturedAt + NEARBY_LOCATION_CACHE_TTL_MS + 1), null);
});

test("location timeout remains retryable and is not persisted as a denial", async () => {
  const storage = memoryStorage();
  const timedOut = await requestInitialLocation(storage, "user-a", { getCurrentPosition(_success: PositionCallback, failure: PositionErrorCallback) { failure({ code: 3, TIMEOUT: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError); } } as Geolocation);
  assert.equal(timedOut.location, "timeout");
  assert.notEqual(timedOut.location, "denied");
});

test("a transient location timeout never disables a previously enabled preference", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a"),
    location: "granted",
    locationPreference: "enabled",
    locationPreferenceUpdatedAt: "2026-09-29T12:00:00.000Z",
    locationEnabled: true,
  });
  const timedOut = await requestInitialLocation(storage, "user-a", {
    getCurrentPosition(_success: PositionCallback, failure: PositionErrorCallback) {
      failure({ code: 3, TIMEOUT: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    },
  } as Geolocation);
  assert.equal(timedOut.location, "timeout");
  assert.equal(timedOut.locationEnabled, true);
  assert.equal(timedOut.locationPreference, "enabled");
});

test("a stale permission refresh cannot overwrite a newer explicit choice", async () => {
  const storage = memoryStorage();
  const userId = "permission-race-user";
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences(userId),
    location: "granted",
    locationPreference: "enabled",
    locationEnabled: true,
    locationPreferenceUpdatedAt: "2026-09-29T18:00:00.000Z",
  });
  let releaseQuery!: (value: PermissionStatus) => void;
  let current = true;
  const refresh = refreshDevicePermissionStateWithoutPrompt(storage, userId, {
    permissions: {
      query: () => new Promise<PermissionStatus>((resolve) => { releaseQuery = resolve; }),
    },
  } as unknown as Navigator, undefined, { shouldCommit: () => current });

  disableLocationForApp(storage, userId);
  current = false;
  releaseQuery({ state: "granted" } as PermissionStatus);
  await refresh;

  const saved = readDevicePermissionPreferences(storage, userId);
  assert.equal(saved.locationPreference, "disabled");
  assert.equal(saved.locationEnabled, false);
});

test("location denial is persisted as denied without enabling location", async () => {
  const storage = memoryStorage();
  const denied = await requestInitialLocation(storage, "user-a", {
    getCurrentPosition(_success: PositionCallback, failure: PositionErrorCallback) {
      failure({ code: 1, TIMEOUT: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    },
  } as Geolocation);
  assert.equal(denied.location, "denied");
  assert.equal(denied.locationEnabled, false);
});

function permissionNavigator(state: PermissionState) {
  return {
    permissions: {
      async query() { return { state } as PermissionStatus; },
    },
  } as unknown as Navigator;
}

test("authorized nearby lookup reuses only a fresh five-minute cache", async () => {
  const storage = memoryStorage();
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
    location: "granted",
    locationEnabled: true,
    coarseLocation: { latitude: 19.04, longitude: -98.2, capturedAt: new Date(at - 60_000).toISOString() },
  });
  let locationCalls = 0;
  const result = await resolveAuthorizedNearbyLocation(storage, "user-a", permissionNavigator("granted"), {
    getCurrentPosition() { locationCalls += 1; },
  } as unknown as Geolocation, { at });
  assert.equal(result.status, "located");
  if (result.status === "located") assert.equal(result.source, "cache");
  assert.equal(locationCalls, 0);
});

test("stored app consent never opens a browser location prompt when permission state cannot be queried", async () => {
  const storage = memoryStorage();
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
    location: "granted",
    locationEnabled: true,
  });
  let locationCalls = 0;
  const result = await resolveAuthorizedNearbyLocation(storage, "user-a", {} as Navigator, {
    getCurrentPosition() { locationCalls += 1; },
  } as unknown as Geolocation, { at });
  assert.deepEqual(result, { status: "query-unsupported" });
  assert.equal(locationCalls, 0, "getCurrentPosition could prompt after the browser permission was reset");
});

test("fresh authorized coordinates remain usable when the Permissions API is unavailable", async () => {
  const storage = memoryStorage();
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
    location: "granted",
    locationEnabled: true,
    coarseLocation: { latitude: 19.04, longitude: -98.2, capturedAt: new Date(at - 60_000).toISOString() },
  });
  let locationCalls = 0;
  const result = await resolveAuthorizedNearbyLocation(storage, "user-a", {} as Navigator, {
    getCurrentPosition() { locationCalls += 1; },
  } as unknown as Geolocation, { at });
  assert.equal(result.status, "located");
  if (result.status === "located") assert.equal(result.source, "cache");
  assert.equal(locationCalls, 0);
});

test("expired nearby cache obtains a current position and replaces the stale value", async () => {
  const storage = memoryStorage();
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
    location: "granted",
    locationEnabled: true,
    coarseLocation: { latitude: 19.04, longitude: -98.2, capturedAt: new Date(at - NEARBY_LOCATION_CACHE_TTL_MS - 1).toISOString() },
  });
  let locationCalls = 0;
  const result = await resolveAuthorizedNearbyLocation(storage, "user-a", permissionNavigator("granted"), {
    getCurrentPosition(success: PositionCallback) {
      locationCalls += 1;
      success({ coords: { latitude: 20.123456, longitude: -99.456789, accuracy: 240 } } as GeolocationPosition);
    },
  } as Geolocation, { at });
  assert.equal(result.status, "located");
  if (result.status === "located") {
    assert.equal(result.source, "fresh");
    assert.deepEqual({ latitude: result.point.latitude, longitude: result.point.longitude, accuracyMeters: result.point.accuracyMeters }, { latitude: 20.123456, longitude: -99.456789, accuracyMeters: 240 });
  }
  assert.equal(locationCalls, 1);
});

test("disabled app location never invokes geolocation from a course entry", async () => {
  const storage = memoryStorage();
  let locationCalls = 0;
  const result = await resolveAuthorizedNearbyLocation(storage, "user-a", permissionNavigator("granted"), {
    getCurrentPosition() { locationCalls += 1; },
  } as unknown as Geolocation);
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(locationCalls, 0);
});

test("revocation cancels an in-flight location and ignores its late response", async () => {
  const storage = memoryStorage();
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
    location: "granted",
    locationEnabled: true,
  });
  let success: PositionCallback | undefined;
  const pending = resolveAuthorizedNearbyLocation(storage, "user-a", permissionNavigator("granted"), {
    getCurrentPosition(next: PositionCallback) { success = next; },
  } as unknown as Geolocation, { at });
  await Promise.resolve();
  await Promise.resolve();
  disableLocationForApp(storage, "user-a");
  assert.ok(success);
  success?.({ coords: { latitude: 21, longitude: -100 } } as GeolocationPosition);
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.equal(storedNearbyCoordinates(storage, "user-a", at), null);
  assert.equal(readDevicePermissionPreferences(storage, "user-a").locationEnabled, false);
});

test("permission denial and timeout remain distinct and manual search stays possible", async () => {
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  for (const scenario of [
    { state: "denied" as PermissionState, expected: "denied" },
    { state: "granted" as PermissionState, expected: "timeout" },
  ]) {
    const storage = memoryStorage();
    saveDevicePermissionPreferences(storage, {
      ...emptyDevicePermissionPreferences("user-a", new Date(at).toISOString()),
      location: "granted",
      locationEnabled: true,
    });
    const result = await resolveAuthorizedNearbyLocation(storage, "user-a", permissionNavigator(scenario.state), {
      getCurrentPosition(_success: PositionCallback, failure: PositionErrorCallback) {
        failure({ code: 3, TIMEOUT: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError);
      },
    } as Geolocation, { at });
    assert.equal(result.status, scenario.expected);
  }
});
