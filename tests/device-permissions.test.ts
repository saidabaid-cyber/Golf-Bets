import assert from "node:assert/strict";
import test from "node:test";
import {
  devicePermissionsStorageKey,
  disableLocationForApp,
  finishInitialDevicePermissions,
  NEARBY_LOCATION_CACHE_TTL_MS,
  readDevicePermissionPreferences,
  requestInitialLocation,
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
