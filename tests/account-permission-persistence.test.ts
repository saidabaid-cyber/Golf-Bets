import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cacheAccountDevicePermissionPreferences,
  clearAccountDevicePermissionServerClock,
  failClosedAccountDevicePermissionPreferences,
  hydrateOptionalDevicePermissionPreferences,
  readAccountDevicePermissionPreferences,
  reconcileAccountDevicePermissionPreferences,
  saveAccountDevicePermissionPreference,
  saveCanonicalAccountNotificationPreference,
  type AccountDevicePermissionPreferences,
} from "../lib/account-device-permission-preferences";
import { OPTIONAL_AUTHORIZATION_BUNDLE_VERSION, OPTIONAL_AUTHORIZATION_SCOPES, type OptionalAuthorizationState } from "../lib/account-optional-authorizations";
import {
  emptyDevicePermissionPreferences,
  devicePermissionsStorageKey,
  readDevicePermissionPreferences,
  refreshDevicePermissionStateWithoutPrompt,
  requestInitialLocation,
  requestInitialNotifications,
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

function optionalState(decidedAt: string): OptionalAuthorizationState {
  return {
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved: true,
    eligible: false,
    receipt: { action: "authorize_all", idempotencyKey: "550e8400-e29b-41d4-a716-446655440000", decidedAt },
    scopes: Object.fromEntries(OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
      active: true,
      status: "accepted",
      policyVersion: "test-v1",
      source: "onboarding_authorize_all",
      decidedAt,
    }])) as OptionalAuthorizationState["scopes"],
    profileVisibility: "public",
    socialPrivacy: "FRIENDS",
    socialProfilePrivacy: "PUBLIC",
    sharing: { enabledForFriends: true, rounds: true, achievements: true, equipment: true, courses: true },
    notifications: { internal: true, master: true, push: true, email: true, rounds: true, reminders: true },
  };
}

test("an OS grant never infers or queues app-level consent", () => {
  const local = { ...emptyDevicePermissionPreferences("owner"), location: "granted" as const };
  const result = reconcileAccountDevicePermissionPreferences(local, NONE, "2026-09-29T12:00:00.000Z");
  assert.equal(result.preferences.locationPreference, "undecided");
  assert.equal(result.preferences.locationEnabled, false);
  assert.deepEqual(result.pending, []);
});

test("volatile canonical permission decision defeats stale local ON when storage writes fail", () => {
  const stale = {
    ...emptyDevicePermissionPreferences("owner-quota"),
    location: "granted" as const,
    notifications: "granted" as const,
    locationPreference: "enabled" as const,
    notificationPreference: "enabled" as const,
    locationEnabled: true,
    notificationsEnabled: true,
  };
  const values = new Map([[devicePermissionsStorageKey("owner-quota"), JSON.stringify(stale)]]);
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem() { throw new Error("quota"); },
    removeItem(key: string) { values.delete(key); },
  };
  const remote = {
    location: { version: 1 as const, value: "disabled" as const, changedAt: "2026-09-30T18:00:00.000Z" },
    notifications: { version: 1 as const, value: "disabled" as const, changedAt: "2026-09-30T18:00:00.000Z" },
  };
  const projected = cacheAccountDevicePermissionPreferences(storage as unknown as Storage, "owner-quota", remote);
  assert.equal(projected.locationEnabled, false);
  assert.equal(projected.notificationsEnabled, false);
  const runtime = readAccountDevicePermissionPreferences(storage as unknown as Storage, "owner-quota");
  assert.equal(runtime.locationEnabled, false);
  assert.equal(runtime.notificationsEnabled, false);
});

test("client-authored durable device clocks never authorize location or notifications", () => {
  const storage = memoryStorage();
  const ownerId = "forged-device-owner";
  const changedAt = "2099-01-01T00:00:00.000Z";
  storage.setItem(`the-backyard:account-device-permission-server-clock:v1:${encodeURIComponent(ownerId)}`, JSON.stringify({
    schemaVersion: 1,
    userId: ownerId,
    scopes: {
      location: { version: 1, value: "enabled", changedAt },
      notifications: { version: 1, value: "enabled", changedAt },
    },
  }));
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences(ownerId),
    location: "granted",
    notifications: "granted",
    locationPreference: "enabled",
    locationPreferenceUpdatedAt: changedAt,
    locationEnabled: true,
    notificationPreference: "enabled",
    notificationPreferenceUpdatedAt: changedAt,
    notificationsEnabled: true,
  });

  const runtime = readAccountDevicePermissionPreferences(storage, ownerId);
  assert.equal(runtime.locationPreference, "undecided");
  assert.equal(runtime.locationEnabled, false);
  assert.equal(runtime.notificationPreference, "undecided");
  assert.equal(runtime.notificationsEnabled, false);
});

test("missing volatile evidence neutralizes inconsistent effective permission caches", () => {
  for (const [index, preference] of (["undecided", "disabled"] as const).entries()) {
    const ownerId = `inconsistent-device-owner-${index}`;
    const storage = memoryStorage();
    saveDevicePermissionPreferences(storage, {
      ...emptyDevicePermissionPreferences(ownerId),
      location: "granted",
      notifications: "granted",
      locationPreference: preference,
      locationPreferenceUpdatedAt: preference === "disabled" ? "2026-09-01T10:00:00.000Z" : null,
      locationEnabled: true,
      coarseLocation: { latitude: 19.4, longitude: -99.1, capturedAt: "2026-09-01T10:00:00.000Z" },
      notificationPreference: preference,
      notificationPreferenceUpdatedAt: preference === "disabled" ? "2026-09-01T10:00:00.000Z" : null,
      notificationsEnabled: true,
    });

    const runtime = readAccountDevicePermissionPreferences(storage, ownerId);
    assert.equal(runtime.locationPreference, "undecided");
    assert.equal(runtime.locationPreferenceUpdatedAt, null);
    assert.equal(runtime.locationEnabled, false);
    assert.equal(runtime.coarseLocation, undefined);
    assert.equal(runtime.notificationPreference, "undecided");
    assert.equal(runtime.notificationPreferenceUpdatedAt, null);
    assert.equal(runtime.notificationsEnabled, false);
  }
});

test("server-confirmed device intent remains available in this execution when durable writes fail", () => {
  const ownerId = "confirmed-device-owner";
  const stale = {
    ...emptyDevicePermissionPreferences(ownerId),
    location: "granted" as const,
    notifications: "granted" as const,
    locationPreference: "disabled" as const,
    notificationPreference: "disabled" as const,
    locationEnabled: false,
    notificationsEnabled: false,
  };
  const values = new Map([[devicePermissionsStorageKey(ownerId), JSON.stringify(stale)]]);
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem() { throw new Error("quota"); },
    removeItem(key: string) { values.delete(key); },
  };
  const confirmed = {
    location: { version: 1 as const, value: "enabled" as const, changedAt: "2026-09-30T18:00:00.000Z" },
    notifications: { version: 1 as const, value: "enabled" as const, changedAt: "2026-09-30T18:00:00.000Z" },
  };

  const projected = cacheAccountDevicePermissionPreferences(storage as unknown as Storage, ownerId, confirmed);
  assert.equal(projected.locationEnabled, true);
  assert.equal(projected.notificationsEnabled, true);
  const runtime = readAccountDevicePermissionPreferences(storage as unknown as Storage, ownerId);
  assert.equal(runtime.locationEnabled, true);
  assert.equal(runtime.notificationsEnabled, true);
});

test("cloud location intent survives while unavailable OS permission keeps runtime access OFF", () => {
  const local = { ...emptyDevicePermissionPreferences("owner"), location: "unavailable" as const };
  const result = reconcileAccountDevicePermissionPreferences(local, {
    location: { version: 1, value: "enabled", changedAt: "2026-09-28T12:00:00.000Z" },
    notifications: null,
  });
  assert.equal(result.preferences.locationPreference, "enabled");
  assert.equal(result.preferences.locationEnabled, false);
  assert.equal(result.pending.length, 0);
});

test("account hydration preserves the server timestamp and never appends a duplicate decision", () => {
  const storage = memoryStorage();
  const decidedAt = "2026-09-30T12:00:00.000Z";
  const first = hydrateOptionalDevicePermissionPreferences(storage, "owner", optionalState(decidedAt));
  assert.equal(first.locationPreference, "enabled");
  assert.equal(first.locationPreferenceUpdatedAt, decidedAt);
  assert.equal(first.notificationPreferenceUpdatedAt, decidedAt);
  assert.equal(first.locationEnabled, false, "server intent does not fabricate an OS grant");

  const replay = hydrateOptionalDevicePermissionPreferences(storage, "owner", optionalState(decidedAt));
  assert.equal(replay.locationPreferenceUpdatedAt, decidedAt);
  assert.equal(replay.notificationPreferenceUpdatedAt, decidedAt);

  saveDevicePermissionPreferences(storage, {
    ...replay,
    locationPreference: "disabled",
    locationPreferenceUpdatedAt: "2026-09-30T13:00:00.000Z",
    updatedAt: "2026-09-30T13:00:00.000Z",
  });
  const canonicalReplay = hydrateOptionalDevicePermissionPreferences(storage, "owner", optionalState(decidedAt));
  assert.equal(canonicalReplay.locationPreference, "enabled", "a device clock cannot outrank the server ledger");
  assert.equal(canonicalReplay.locationPreferenceUpdatedAt, decidedAt);
});

test("server decisions are canonical while a missing scope preserves cache without upload", () => {
  const localEnabled = {
    ...emptyDevicePermissionPreferences("owner"),
    location: "granted" as const,
    locationPreference: "enabled" as const,
    locationEnabled: true,
    locationPreferenceUpdatedAt: "2026-09-29T12:00:00.000Z",
    coarseLocation: { latitude: 19.4, longitude: -99.1, capturedAt: "2026-09-29T12:00:00.000Z" },
  };
  const staleDisabled = reconcileAccountDevicePermissionPreferences(localEnabled, {
    location: { version: 1, value: "disabled", changedAt: "2026-09-28T12:00:00.000Z" },
    notifications: null,
  });
  assert.equal(staleDisabled.preferences.locationPreference, "disabled");
  assert.equal(staleDisabled.preferences.locationEnabled, false);
  assert.equal(staleDisabled.preferences.coarseLocation, undefined);
  assert.deepEqual(staleDisabled.pending, []);

  const missing = reconcileAccountDevicePermissionPreferences(localEnabled, NONE);
  assert.equal(missing.preferences.locationPreference, "enabled");
  assert.equal(missing.preferences.locationEnabled, true);
  assert.deepEqual(missing.pending, []);
});

test("a late account GET cannot overwrite a newer confirmed device-intent PATCH in the active execution", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };

  const afterPatch = cacheAccountDevicePermissionPreferences(storage, "owner", {
    location: { version: 1, value: "disabled", changedAt: "2026-09-30T13:00:00.000Z" },
    notifications: { version: 1, value: "enabled", changedAt: "2026-09-30T13:00:00.000Z" },
  });
  assert.equal(afterPatch.locationPreference, "disabled");
  assert.equal(afterPatch.notificationPreference, "enabled");

  const afterLateGet = cacheAccountDevicePermissionPreferences(storage, "owner", {
    location: { version: 1, value: "enabled", changedAt: "2026-09-30T12:00:00.000Z" },
    notifications: { version: 1, value: "disabled", changedAt: "2026-09-30T12:00:00.000Z" },
  });
  assert.equal(afterLateGet.locationPreference, "disabled");
  assert.equal(afterLateGet.locationPreferenceUpdatedAt, "2026-09-30T13:00:00.000Z");
  assert.equal(afterLateGet.notificationPreference, "enabled");
  assert.equal(afterLateGet.notificationPreferenceUpdatedAt, "2026-09-30T13:00:00.000Z");
});

test("missing server evidence disables a legacy positive cache without inventing a revocation", () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("legacy-owner"),
    location: "granted",
    locationPreference: "enabled",
    locationPreferenceUpdatedAt: "2026-09-01T10:00:00.000Z",
    locationEnabled: true,
    coarseLocation: { latitude: 19.4, longitude: -99.1, capturedAt: "2026-09-01T10:00:00.000Z" },
    notificationPreference: "enabled",
    notificationPreferenceUpdatedAt: "2026-09-01T10:00:00.000Z",
    notificationsEnabled: true,
  });
  const reconciled = failClosedAccountDevicePermissionPreferences(storage, "legacy-owner");
  assert.equal(reconciled.locationPreference, "undecided");
  assert.equal(reconciled.locationEnabled, false);
  assert.equal(reconciled.coarseLocation, undefined);
  assert.equal(reconciled.notificationPreference, "undecided");
  assert.equal(reconciled.notificationsEnabled, false);
});

test("account cleanup removes the volatile and durable device decision clock", () => {
  const storage = memoryStorage();
  const accepted = cacheAccountDevicePermissionPreferences(storage, "deleted-owner", {
    location: { version: 1, value: "enabled", changedAt: "2026-09-30T13:00:00.000Z" },
    notifications: { version: 1, value: "enabled", changedAt: "2026-09-30T13:00:00.000Z" },
  });
  assert.equal(accepted.locationPreference, "enabled");
  clearAccountDevicePermissionServerClock(storage, "deleted-owner");
  const afterDeletion = failClosedAccountDevicePermissionPreferences(storage, "deleted-owner");
  assert.equal(afterDeletion.locationPreference, "undecided");
  assert.equal(afterDeletion.notificationPreference, "undecided");
});

test("native permission prompts update device state without minting internal consent", async () => {
  const storage = memoryStorage();
  const preferenceAt = "2026-09-30T10:00:00.000Z";
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("owner"),
    locationPreference: "disabled",
    locationPreferenceUpdatedAt: preferenceAt,
    notificationPreference: "disabled",
    notificationPreferenceUpdatedAt: preferenceAt,
  });

  const location = await requestInitialLocation(storage, "owner", {
    getCurrentPosition(success: PositionCallback) {
      success({ coords: { latitude: 19.4, longitude: -99.1, accuracy: 10 } } as GeolocationPosition);
    },
  } as Geolocation);
  assert.equal(location.location, "granted");
  assert.equal(location.locationPreference, "disabled");
  assert.equal(location.locationPreferenceUpdatedAt, preferenceAt);
  assert.equal(location.locationEnabled, false);
  assert.equal(location.coarseLocation, undefined);

  const notifications = await requestInitialNotifications(storage, "owner", {
    permission: "granted",
    async requestPermission() { return "granted"; },
  });
  assert.equal(notifications.notifications, "granted");
  assert.equal(notifications.notificationPreference, "disabled");
  assert.equal(notifications.notificationPreferenceUpdatedAt, preferenceAt);
  assert.equal(notifications.notificationsEnabled, false);
});

test("a late notification prompt re-reads storage and cannot revive a revocation", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("owner"),
    notificationPreference: "enabled",
    notificationPreferenceUpdatedAt: "2026-09-30T10:00:00.000Z",
    notificationsEnabled: true,
  });
  let resolvePermission!: (permission: NotificationPermission) => void;
  const pending = requestInitialNotifications(storage, "owner", {
    permission: "default",
    requestPermission: () => new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve; }),
  });
  saveDevicePermissionPreferences(storage, {
    ...readDevicePermissionPreferences(storage, "owner"),
    notificationPreference: "disabled",
    notificationPreferenceUpdatedAt: "2026-09-30T11:00:00.000Z",
    notificationsEnabled: false,
  });
  resolvePermission("granted");
  const result = await pending;
  assert.equal(result.notifications, "granted");
  assert.equal(result.notificationPreference, "disabled");
  assert.equal(result.notificationPreferenceUpdatedAt, "2026-09-30T11:00:00.000Z");
  assert.equal(result.notificationsEnabled, false);
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

test("account permission endpoint uses the owner-bound canonical consent RPC", () => {
  const route = readFileSync("app/api/account/device-permission-preferences/route.ts", "utf8");
  assert.match(route, /authenticatedRequest\(request\)/);
  assert.match(route, /get_optional_authorization_state_v2/);
  assert.match(route, /set_optional_authorization_scope_v1/);
  assert.match(route, /"LOCATION_INTERNAL" : "NOTIFICATION_INTERNAL"/);
  assert.match(route, /stableIdempotencyKey\(account\.userId, input\.preference, input\.record\)/);
  assert.match(route, /A client clock is not an authority for ordering explicit user actions/);
  assert.doesNotMatch(route, /Date\.parse\(current\.changedAt\)\s*[>=]/);
  assert.doesNotMatch(route, /MAX_CLOCK_SKEW|Date\.now\(\).*changedAt|changedAt.*Date\.now\(\)/);
  assert.doesNotMatch(route, /\/auth\/v1\/user|service_role|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /requested_user_id|userId:\s*input/);
});

test("a skewed device clock cannot block a server-timestamped permission decision", async () => {
  let capturedChangedAt: unknown;
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedChangedAt = (JSON.parse(String(init?.body)) as Record<string, unknown>).changedAt;
    return Response.json({
      location: { version: 1, value: "enabled", changedAt: "2026-09-30T13:00:00.000Z" },
      notifications: null,
    });
  }) as typeof fetch;
  const remote = await saveAccountDevicePermissionPreference("token", "location", {
    version: 1,
    value: "enabled",
    changedAt: "2099-01-01T00:00:00.000Z",
  }, undefined, transport);
  assert.equal(remote.location?.value, "enabled");
  assert.equal(capturedChangedAt, "2099-01-01T00:00:00.000Z");
});

test("legacy in-app notification switch waits for NOTIFICATION_INTERNAL evidence and preserves OS/provider state", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("owner"),
    notifications: "denied",
    pushSubscription: "registered",
  });
  let requestBody = "";
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body);
    return Response.json({
      location: null,
      notifications: { version: 1, value: "enabled", changedAt: "2026-09-30T19:00:00.000Z" },
    });
  }) as typeof fetch;

  const pending = saveCanonicalAccountNotificationPreference(
    storage as unknown as Storage,
    "owner",
    "account-token",
    true,
    undefined,
    transport,
  );
  assert.equal(readDevicePermissionPreferences(storage, "owner").notificationPreference, "undecided",
    "the local switch must not move before the canonical response");
  const saved = await pending;
  const sent = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(sent.preference, "notifications");
  assert.equal(sent.value, "enabled");
  assert.equal(saved.notificationPreference, "enabled");
  assert.equal(saved.notificationsEnabled, true);
  assert.equal(saved.notifications, "denied", "canonical app intent must not fabricate an OS grant");
  assert.equal(saved.pushSubscription, "registered", "canonical app intent must not rewrite provider registration");
});

test("a rejected NOTIFICATION_INTERNAL write leaves the legacy in-app switch unchanged", async () => {
  const storage = memoryStorage();
  saveDevicePermissionPreferences(storage, {
    ...emptyDevicePermissionPreferences("owner-failed"),
    notifications: "granted",
    notificationPreference: "disabled",
    notificationPreferenceUpdatedAt: "2026-09-30T18:00:00.000Z",
    notificationsEnabled: false,
  });
  const transport = (async () => Response.json({ error: "unavailable" }, { status: 503 })) as typeof fetch;
  await assert.rejects(() => saveCanonicalAccountNotificationPreference(
    storage as unknown as Storage,
    "owner-failed",
    "account-token",
    true,
    undefined,
    transport,
  ));
  const unchanged = readDevicePermissionPreferences(storage, "owner-failed");
  assert.equal(unchanged.notificationPreference, "disabled");
  assert.equal(unchanged.notificationsEnabled, false);
  assert.equal(unchanged.notifications, "granted");
});

test("legacy notification controls use one server-confirmed writer and block duplicate taps", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const profilePanel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  const legacyPanel = readFileSync("app/components/account-panel.tsx", "utf8");
  const handler = page.slice(page.indexOf("const changeNotifications"), page.indexOf("const applyStatisticsReset"));
  assert.match(handler, /await saveCanonicalAccountNotificationPreference/);
  assert.ok(handler.indexOf("await saveCanonicalAccountNotificationPreference") < handler.indexOf("setNotificationsEnabled(enabled)"));
  assert.match(handler, /account\.mode !== "authenticated" \|\| !account\.accessToken/);
  assert.match(handler, /OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT/);
  assert.doesNotMatch(handler, /setNotificationsEnabled\(value\)/);
  assert.match(page, /readAccountDevicePermissionPreferences\(localStorage, identity\.userId\)\.notificationPreference === "enabled"/);
  for (const panel of [profilePanel, legacyPanel]) {
    assert.match(panel, /disabled=\{internalNotificationsSaving \|\| identity\.mode !== "authenticated"\}/);
    assert.match(panel, /void onNotificationsEnabledChange\(event\.target\.checked\)/);
    assert.match(panel, /no (?:cambia|activa).*permiso del dispositivo/i);
  }
});

test("canonical device intent never falls back to editable legacy metadata", () => {
  const route = readFileSync("app/api/account/device-permission-preferences/route.ts", "utf8");
  assert.match(route, /scope\.status !== "missing" && scope\.decidedAt/);
  assert.doesNotMatch(route, /LOCATION_USAGE_PREFERENCE_METADATA_KEY|NOTIFICATION_USAGE_PREFERENCE_METADATA_KEY/);
  assert.match(route, /location: canonical\("location"\)/);
  assert.match(route, /notifications: canonical\("notifications"\)/);
});

test("an explicit permission choice invalidates stale hydration responses", () => {
  const settings = readFileSync("app/components/device-permission-settings.tsx", "utf8");
  const persistence = settings.slice(settings.indexOf("const persistPreference"), settings.indexOf("return { value"));
  assert.match(persistence, /refreshController\.current\?\.abort\(\)/);
  assert.match(persistence, /\+\+refreshRevision\.current/);
  assert.match(persistence, /await saveAccountDevicePermissionPreference/);
  assert.ok(persistence.indexOf("await saveAccountDevicePermissionPreference") < persistence.indexOf("setValue(saved)"));
  assert.doesNotMatch(persistence.slice(0, persistence.indexOf("await saveAccountDevicePermissionPreference")), /setValue\(/);
  assert.match(persistence, /Conservamos el estado anterior/);
  assert.match(settings, /cacheAccountDevicePermissionPreferences\(localStorage, userId, remote\)/);
  assert.match(settings, /revision !== refreshRevision\.current/);
  assert.match(settings, /shouldCommit: \(\) => !controller\.signal\.aborted && revision === refreshRevision\.current/);
});
