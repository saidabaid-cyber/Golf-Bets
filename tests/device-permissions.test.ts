import assert from "node:assert/strict";
import test from "node:test";
import {
  devicePermissionsStorageKey,
  disableLocationForApp,
  emptyDevicePermissionPreferences,
  finishInitialDevicePermissions,
  NEARBY_LOCATION_CACHE_TTL_MS,
  readDevicePermissionPreferences,
  resolveAuthorizedNearbyLocation,
  requestInitialLocation,
  saveDevicePermissionPreferences,
  storedNearbyCoordinates,
} from "../lib/device-permissions";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

test("initial location permission is user-scoped, coarse, and reusable without another prompt", async () => {
  const storage = memoryStorage();
  let prompts = 0;
  const geolocation = {
    getCurrentPosition(success: PositionCallback) {
      prompts += 1;
      success({ coords: { latitude: 19.123456, longitude: -98.987654 } } as GeolocationPosition);
    },
  } as Geolocation;
  const saved = await requestInitialLocation(storage, "user-a", geolocation);
  assert.equal(prompts, 1);
  assert.deepEqual(saved.coarseLocation && { latitude: saved.coarseLocation.latitude, longitude: saved.coarseLocation.longitude }, { latitude: 19.12, longitude: -98.99 });
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
      success({ coords: { latitude: 20.123, longitude: -99.456 } } as GeolocationPosition);
    },
  } as Geolocation, { at });
  assert.equal(result.status, "located");
  if (result.status === "located") {
    assert.equal(result.source, "fresh");
    assert.deepEqual({ latitude: result.point.latitude, longitude: result.point.longitude }, { latitude: 20.12, longitude: -99.46 });
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
