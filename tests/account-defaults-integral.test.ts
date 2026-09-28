import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_ACCOUNT_UI_PREFERENCES,
  normalizeAccountUiPreferences,
  readAccountUiPreferences,
  writeAccountUiPreferences,
} from "../lib/account-ui-preferences";
import {
  DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES,
  bootstrapAccountNotificationPreferences,
  parseAccountNotificationPreferences,
  requestAccountNotificationPreferences,
} from "../lib/account-notification-preferences";
import { collectLocalCloudData } from "../lib/cloud-sync";
import { emptyDevicePermissionPreferences, enableNotificationsForApp } from "../lib/device-permissions";
import { defaultNotificationPreferences, deliveryChannels, type NotificationEvent } from "../features/notifications/domain";
import { STORAGE_KEYS } from "../lib/round-utils";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("local absence is legacy-safe while explicit account choices survive reload", () => {
  assert.deepEqual(DEFAULT_ACCOUNT_UI_PREFERENCES, {
    version: 1, distanceUnit: "yards", push: false, email: false, rounds: false, reminders: false,
  });
  assert.deepEqual(normalizeAccountUiPreferences({ version: 1, push: false, email: false, rounds: false, reminders: false }), {
    version: 1, distanceUnit: "yards", push: false, email: false, rounds: false, reminders: false,
  });
  const storage = new MemoryStorage();
  assert.deepEqual(readAccountUiPreferences(storage as unknown as Storage, "legacy-owner"), DEFAULT_ACCOUNT_UI_PREFERENCES);
  assert.deepEqual(normalizeAccountUiPreferences({ version: 1, push: true }), {
    version: 1, distanceUnit: "yards", push: true, email: false, rounds: false, reminders: false,
  });
  const selected = { version: 1 as const, distanceUnit: "meters" as const, push: false, email: true, rounds: false, reminders: true };
  writeAccountUiPreferences(storage as unknown as Storage, "legacy-owner", selected);
  assert.deepEqual(readAccountUiPreferences(storage as unknown as Storage, "legacy-owner"), selected);
});

test("internal notices require persisted true and a stored OFF remains canonical", () => {
  const storage = new MemoryStorage();
  const fresh = collectLocalCloudData(storage as unknown as Storage);
  assert.equal(fresh.preferences.notificationsEnabled, false);
  assert.equal(fresh.preferences.hasLocalState, false);
  storage.setItem(STORAGE_KEYS.notifications, "true");
  assert.equal(collectLocalCloudData(storage as unknown as Storage).preferences.notificationsEnabled, true);
  storage.setItem(STORAGE_KEYS.notifications, "false");
  const existing = collectLocalCloudData(storage as unknown as Storage);
  assert.equal(existing.preferences.notificationsEnabled, false);
  assert.equal(existing.preferences.hasLocalState, true);
});

test("device permission, app preference and provider delivery remain separate", () => {
  const storage = new MemoryStorage();
  const initial = emptyDevicePermissionPreferences("owner", "2026-09-28T00:00:00.000Z");
  assert.equal(initial.notificationPreference, "undecided");
  assert.equal(initial.notifications, "unknown");
  assert.equal(initial.pushSubscription, "not_registered");
  const preferred = enableNotificationsForApp(storage as unknown as Storage, "owner");
  assert.equal(preferred.notificationPreference, "enabled");
  assert.equal(preferred.notifications, "unknown", "an internal preference must not fabricate an OS grant");
  assert.equal(preferred.pushSubscription, "not_registered", "an internal preference must not fabricate a subscription");

  const event: NotificationEvent = { id: "n", recipientId: "owner", type: "round_invite", resourceType: "ROUND", resourceId: "r", createdAt: "2026-09-28T00:00:00.000Z" };
  const defaults = defaultNotificationPreferences("owner", event.createdAt);
  assert.ok(defaults.every((choice) => choice.inApp && choice.push));
  assert.deepEqual(deliveryChannels(event, defaults, false), ["IN_APP"], "push remains fail-closed without a backend");
});

test("account notification client uses exact server acknowledgement and never sends userId", async () => {
  assert.deepEqual(DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES, { push: false, email: false, rounds: false, reminders: false, updatedAt: null });
  const delivery = { push: { configured: false, state: "not_configured" }, email: { configured: false, state: "not_configured" } };
  const preferences = { push: false, email: true, rounds: false, reminders: true };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ initialized: true, preferences: { ...preferences, updatedAt: "2026-09-28T00:00:00.000Z" }, delivery });
  }) as typeof fetch;
  const result = await requestAccountNotificationPreferences("account-token", preferences, undefined, transport);
  assert.deepEqual(result.preferences, { ...preferences, updatedAt: "2026-09-28T00:00:00.000Z" });
  assert.equal(result.initialized, true);
  assert.equal(calls[0].url, "/api/account/notification-preferences");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), preferences);
  assert.doesNotMatch(String(calls[0].init?.body), /userId|owner/i);
  const legacy = parseAccountNotificationPreferences({ initialized: false, preferences: {}, delivery });
  assert.equal(legacy?.initialized, false);
  assert.equal(legacy?.preferences.push, false);
});

test("legacy notification bootstrap persists existing local OFF choices before using server state", async () => {
  const local = { push: false, email: true, rounds: false, reminders: true };
  const calls: Array<{ method: string; body?: string }> = [];
  const delivery = { push: { configured: false, state: "not_configured" }, email: { configured: false, state: "not_configured" } };
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: String(init?.method), body: typeof init?.body === "string" ? init.body : undefined });
    if (init?.method === "GET") {
      return Response.json({ initialized: false, preferences: { push: false, email: false, rounds: false, reminders: false, updatedAt: null }, delivery });
    }
    return Response.json({ initialized: true, preferences: { ...local, updatedAt: "2026-09-28T00:00:00.000Z" }, delivery });
  }) as typeof fetch;
  const result = await bootstrapAccountNotificationPreferences("account-token", local, undefined, transport);
  assert.equal(result.initialized, true);
  assert.deepEqual(result.preferences, { ...local, updatedAt: "2026-09-28T00:00:00.000Z" });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT"]);
  assert.deepEqual(JSON.parse(calls[1].body || "{}"), local);
});

test("new-account server row is already initialized and never enters legacy bootstrap", async () => {
  const calls: string[] = [];
  const delivery = { push: { configured: false, state: "not_configured" }, email: { configured: false, state: "not_configured" } };
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.method));
    return Response.json({
      initialized: true,
      preferences: { push: true, email: true, rounds: true, reminders: true, updatedAt: "2026-09-28T00:00:00.000Z" },
      delivery,
    });
  }) as typeof fetch;
  const result = await bootstrapAccountNotificationPreferences("account-token", {
    push: false, email: false, rounds: false, reminders: false,
  }, undefined, transport);
  assert.deepEqual(calls, ["GET"]);
  assert.deepEqual(result.preferences, {
    push: true, email: true, rounds: true, reminders: true, updatedAt: "2026-09-28T00:00:00.000Z",
  });
});

test("Auth bootstrap alone applies new-account defaults; generic and legacy paths stay historical", () => {
  const migration = readFileSync("supabase/migrations/20260928010000_new_account_privacy_notification_defaults.sql", "utf8");
  const publicBootstrapFix = readFileSync("supabase/migrations/20260928033500_fix_new_account_public_bootstrap.sql", "utf8");
  const cloudProfile = readFileSync("lib/cloud-account.ts", "utf8");
  const accountProvider = readFileSync("app/components/account-provider.tsx", "utf8");
  const socialRuntime = readFileSync("lib/social-activity.server.ts", "utf8");
  assert.match(migration, /alter table public\.profiles\s+alter column profile_visibility set default 'private'/);
  assert.match(migration, /alter table public\.social_profiles\s+alter column privacy set default 'PRIVATE'/);
  assert.doesNotMatch(migration, /alter column profile_visibility set default 'public'/);
  assert.match(migration, /insert into public\.profiles\([\s\S]*profile_visibility[\s\S]*'PRIVATE',\s*'public'/);
  assert.match(migration, /on conflict \(id\) do update set[\s\S]*profile_visibility = 'public'/);
  assert.match(publicBootstrapFix, /create or replace function public\.handle_phase2_user_bootstrap\(\)[\s\S]*on conflict \(id\) do update set[\s\S]*profile_visibility = 'public'/);
  assert.doesNotMatch(publicBootstrapFix, /update\s+public\.profiles/i);
  assert.match(migration, /insert into public\.social_profiles[\s\S]*'PUBLIC'[\s\S]*on conflict \(user_id\) do nothing/);
  assert.match(cloudProfile, /profile_visibility:\s*"private"/);
  assert.match(accountProvider, /current\.profileVisibility === profileVisibility/);
  assert.match(accountProvider, /select\("default_handicap,high_contrast,notifications_enabled,updated_at"\)/);
  assert.match(accountProvider, /typeof preferencesResult\.data\?\.notifications_enabled === "boolean"/);
  assert.match(migration, /notifications_enabled set default false/);
  assert.match(migration, /insert into public\.user_preferences\([\s\S]*push_notifications_enabled[\s\S]*values \(new\.id, true, true, true, true, true\)/);
  for (const column of ["push_notifications_enabled", "email_notifications_enabled", "round_notifications_enabled", "reminders_enabled"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column} boolean[;,]`));
    assert.match(migration, new RegExp(`alter column ${column} drop default`));
    assert.doesNotMatch(migration, new RegExp(`alter column ${column} set default true`));
    assert.doesNotMatch(migration, new RegExp(`add column if not exists ${column} boolean not null default true`));
  }
  assert.match(migration, /insert into public\.notification_preferences_v2\(user_id, event_type, in_app, push\)\s+select new\.id, event_type, true, true/);
  assert.match(migration, /alter column push set default false/);
  assert.match(migration, /insert into public\.social_activity_preferences_v3\([\s\S]*notify_friend_request[\s\S]*values \(new\.id, true, true, true, true, true, true\)/);
  assert.match(migration, /alter column notify_friend_achievement set default false/);
  assert.match(migration, /alter column notify_equipment set default false/);
  assert.match(migration, /add column if not exists notify_friend_request boolean;/);
  assert.match(migration, /alter column notify_friend_request drop default/);
  assert.doesNotMatch(migration, /notify_friend_request boolean not null default true/);
  assert.match(migration, /if new\.state = 'PENDING' and coalesce\(/);
  assert.match(socialRuntime, /notifyFriendAchievement: false, notifyEquipment: false, notifyFriendRequest: true/);
  assert.match(socialRuntime, /notifyFriendAchievement: row\.notify_friend_achievement === true/);
  assert.match(socialRuntime, /notifyEquipment: row\.notify_equipment === true/);
  assert.doesNotMatch(migration, /update\s+public\.(profiles|user_preferences|social_activity_preferences_v3)/i);
});

test("onboarding asks all AI/device decisions while Settings only reviews them", () => {
  const consent = readFileSync("app/components/account-consent-checkpoint.tsx", "utf8");
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const settings = readFileSync("app/components/device-permission-settings.tsx", "utf8");
  assert.match(consent, /Autorizaciones de IA/);
  for (const purpose of ["texto o dictado", "scorecards", "launch monitor"]) assert.match(consent, new RegExp(purpose, "i"));
  assert.match(onboarding, /<InitialDevicePermissions/);
  assert.match(settings, /requestInitialLocation/);
  assert.match(settings, /requestInitialNotifications/);
  assert.match(settings, /Preferencia, permiso del sistema y entrega son estados distintos/);
  assert.match(settings, /enableNotificationsForApp/);
  assert.doesNotMatch(settings, /notifications:\s*"granted"/);
});

test("notification channel toggles wait for the canonical account response", () => {
  const panel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  assert.match(panel, /notificationPreferencesReady/);
  assert.match(panel, /Consultando preferencias de cuenta/);
  assert.match(panel, /notificationPreferencesReady && <>/);
});
