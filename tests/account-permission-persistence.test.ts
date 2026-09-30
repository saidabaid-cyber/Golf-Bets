import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  reconcileAccountDevicePermissionPreferences,
  type AccountDevicePermissionPreferences,
} from "../lib/account-device-permission-preferences";
import {
  emptyDevicePermissionPreferences,
  readDevicePermissionPreferences,
  refreshDevicePermissionStateWithoutPrompt,
  saveDevicePermissionPreferences,
} from "../lib/device-permissions";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

const NONE: AccountDevicePermissionPreferences = { location: null, notifications: null };

test("granted legacy location is inferred as enabled and queued for durable account sync", () => {
  const local = { ...emptyDevicePermissionPreferences("owner"), location: "granted" as const };
  const result = reconcileAccountDevicePermissionPreferences(local, NONE, "2026-09-29T12:00:00.000Z");
  assert.equal(result.preferences.locationPreference, "enabled");
  assert.equal(result.preferences.locationEnabled, true);
  assert.deepEqual(result.pending, [{
    preference: "location",
    record: { version: 1, value: "enabled", changedAt: "2026-09-29T12:00:00.000Z" },
  }]);
});

test("cloud location intent survives missing local storage and unavailable permission reads", () => {
  const local = { ...emptyDevicePermissionPreferences("owner"), location: "unavailable" as const };
  const result = reconcileAccountDevicePermissionPreferences(local, {
    location: { version: 1, value: "enabled", changedAt: "2026-09-28T12:00:00.000Z" },
    notifications: null,
  });
  assert.equal(result.preferences.locationPreference, "enabled");
  assert.equal(result.preferences.locationEnabled, true);
  assert.equal(result.pending.length, 0);
});

test("newer explicit decisions win while stale or missing reads never become false", () => {
  const localEnabled = {
    ...emptyDevicePermissionPreferences("owner"),
    location: "granted" as const,
    locationPreference: "enabled" as const,
    locationEnabled: true,
    locationPreferenceUpdatedAt: "2026-09-29T12:00:00.000Z",
  };
  const staleDisabled = reconcileAccountDevicePermissionPreferences(localEnabled, {
    location: { version: 1, value: "disabled", changedAt: "2026-09-28T12:00:00.000Z" },
    notifications: null,
  });
  assert.equal(staleDisabled.preferences.locationEnabled, true);
  assert.equal(staleDisabled.pending[0]?.record.value, "enabled");

  const explicitDisabled = reconcileAccountDevicePermissionPreferences(localEnabled, {
    location: { version: 1, value: "disabled", changedAt: "2026-09-30T12:00:00.000Z" },
    notifications: null,
  });
  assert.equal(explicitDisabled.preferences.locationPreference, "disabled");
  assert.equal(explicitDisabled.preferences.locationEnabled, false);
});

test("notification preference remains enabled while push registration is independently pending", () => {
  const result = reconcileAccountDevicePermissionPreferences(
    { ...emptyDevicePermissionPreferences("owner"), notifications: "unavailable" },
    {
      location: null,
      notifications: { version: 1, value: "enabled", changedAt: "2026-09-29T12:00:00.000Z" },
    },
  );
  assert.equal(result.preferences.notificationPreference, "enabled");
  assert.equal(result.preferences.notificationsEnabled, true);
  assert.equal(result.preferences.pushSubscription, "not_registered");
});

test("focus refresh preserves enabled location on unsupported APIs and only an OS denial disables effective use", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("owner"),
    location: "granted",
    locationPreference: "enabled",
    locationPreferenceUpdatedAt: "2026-09-29T12:00:00.000Z",
    locationEnabled: true,
  });
  const unavailable = await refreshDevicePermissionStateWithoutPrompt(storage, "owner", {} as Navigator, undefined);
  assert.equal(unavailable.locationEnabled, true);
  assert.equal(readDevicePermissionPreferences(storage, "owner").locationPreference, "enabled");

  const denied = await refreshDevicePermissionStateWithoutPrompt(storage, "owner", {
    permissions: { async query() { return { state: "denied" } as PermissionStatus; } },
  } as unknown as Navigator, undefined);
  assert.equal(denied.locationEnabled, false);
  assert.equal(denied.locationPreference, "enabled", "OS denial changes effective access, not the user's recorded intent");
});

test("account preference endpoint is owner-authenticated and updates only private Auth metadata", () => {
  const route = readFileSync("app/api/account/device-permission-preferences/route.ts", "utf8");
  assert.match(route, /authenticatedRequest\(request\)/);
  assert.match(route, /\/auth\/v1\/user/);
  assert.match(route, /authorization: `Bearer \$\{token\}`/);
  assert.match(route, /data: \{ \[key\]: record \}/);
  assert.match(route, /Date\.parse\(current\.changedAt\) > Date\.parse\(input\.record\.changedAt\)/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("an explicit permission choice invalidates stale hydration responses", () => {
  const settings = readFileSync("app/components/device-permission-settings.tsx", "utf8");
  const persistence = settings.slice(settings.indexOf("const persistPreference"), settings.indexOf("return { value"));
  assert.match(persistence, /refreshController\.current\?\.abort\(\)/);
  assert.match(persistence, /\+\+refreshRevision\.current/);
  assert.match(settings, /const latest = readDevicePermissionPreferences\(localStorage, userId\)/);
  assert.match(settings, /revision !== refreshRevision\.current/);
  assert.match(settings, /shouldCommit: \(\) => !controller\.signal\.aborted && revision === refreshRevision\.current/);
});
