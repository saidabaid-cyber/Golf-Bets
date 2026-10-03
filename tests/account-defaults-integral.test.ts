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
  assert.equal(existing.preferences.hasLocalState, false, "el cache canónico de avisos no concede ownership al sync genérico");
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
      preferences: { push: false, email: false, rounds: false, reminders: false, updatedAt: "2026-09-30T00:00:00.000Z" },
      delivery,
    });
  }) as typeof fetch;
  const result = await bootstrapAccountNotificationPreferences("account-token", {
    push: false, email: false, rounds: false, reminders: false,
  }, undefined, transport);
  assert.deepEqual(calls, ["GET"]);
  assert.deepEqual(result.preferences, {
    push: false, email: false, rounds: false, reminders: false, updatedAt: "2026-09-30T00:00:00.000Z",
  });
});

test("new accounts stay private and OFF until the atomic optional authorization", () => {
  const migration = readFileSync("supabase/migrations/20260930233254_explicit_optional_authorizations.sql", "utf8");
  const cloudProfile = readFileSync("lib/cloud-account.ts", "utf8");
  const accountProvider = readFileSync("app/components/account-provider.tsx", "utf8");
  const appPage = readFileSync("app/page.tsx", "utf8");
  const socialRuntime = readFileSync("lib/social-activity.server.ts", "utf8");
  assert.match(migration, /^begin;/m);
  for (const column of ["personal_memory_enabled", "global_learning_enabled", "location_internal_enabled", "notification_internal_enabled"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column} boolean`));
    assert.doesNotMatch(migration, new RegExp(`${column} boolean(?: not null)? default true`));
  }
  assert.match(migration, /create table private\.optional_authorization_onboarding_eligibility/);
  assert.match(migration, /No historical account is backfilled|No historical UPDATE|does not infer or backfill consent/i);
  assert.match(migration, /create or replace function public\.handle_phase2_user_bootstrap\(\)/);
  assert.match(migration, /username_candidate,[\s\S]*'PRIVATE',[\s\S]*'private'/);
  assert.match(migration, /insert into public\.social_profiles[\s\S]*'PRIVATE'/);
  assert.match(migration, /new\.id, false, false, false, false, false, false, false, false, false/);
  assert.match(migration, /insert into private\.optional_authorization_onboarding_eligibility/);
  assert.match(migration, /create or replace function public\.resolve_optional_authorization_bundle_v1/);
  assert.match(migration, /optional_authorization_bundle_not_eligible/);
  assert.match(migration, /requested_action = 'authorize_all'/);
  assert.match(migration, /profile_visibility = case when enabled then 'public' else 'private' end/);
  assert.match(migration, /set privacy = case when enabled then 'PUBLIC' else 'PRIVATE' end/);
  for (const projection of ["share_rounds", "share_achievements", "share_equipment", "share_courses", "notifications_enabled", "push_notifications_enabled", "email_notifications_enabled", "round_notifications_enabled", "reminders_enabled"]) {
    assert.match(migration, new RegExp(projection));
  }
  assert.match(migration, /'excluded', jsonb_build_array\('MARKETING', 'FINANCIAL_PATRIMONIAL'\)/);
  assert.match(cloudProfile, /profile_visibility:\s*"private"/);
  assert.doesNotMatch(accountProvider, /typeof preferencesResult\.data\?\.notifications_enabled === "boolean"/,
    "la proyección editable legacy no puede decidir el consentimiento de avisos");
  assert.match(accountProvider, /optionalAuthorizationResult\.status === "fulfilled"[\s\S]*hydrateOptionalDevicePermissionPreferences[\s\S]*notificationPreference === "enabled"/);
  assert.doesNotMatch(accountProvider, /localStorage\.getItem\(STORAGE_KEYS\.notifications\) === null/);
  assert.match(accountProvider, /backyard:account-notifications-hydrated/);
  assert.match(appPage, /backyard:account-notifications-hydrated/);
  assert.match(appPage, /event is only an invalidation signal/);
  assert.match(appPage, /setNotificationsEnabled\(readAccountDevicePermissionPreferences\(localStorage, identity\.userId\)\.notificationPreference === "enabled"\)/);
  assert.doesNotMatch(appPage, /setNotificationsEnabled\(detail\.enabled\)/);
  assert.match(socialRuntime, /notifyFriendAchievement: false, notifyEquipment: false, notifyFriendRequest: true/);
  assert.match(socialRuntime, /notifyFriendAchievement: row\.notify_friend_achievement === true/);
  assert.match(socialRuntime, /notifyEquipment: row\.notify_equipment === true/);
});

test("onboarding authorizes app intent while OS permission and delivery remain separate", () => {
  const consent = readFileSync("app/components/account-consent-checkpoint.tsx", "utf8");
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const settings = readFileSync("app/components/device-permission-settings.tsx", "utf8");
  assert.match(consent, /FUNCIONES OPCIONALES DE THE BACKYARD/);
  for (const purpose of ["texto o dictado", "fotos e imágenes", "launch monitor", "Uso interno de ubicación y notificaciones"]) assert.match(consent, new RegExp(purpose, "i"));
  assert.match(consent, /el permiso del dispositivo y la entrega se muestran y solicitan por separado/);
  assert.match(onboarding, /<OnboardingPrivacyChoices/);
  assert.match(readFileSync("app/components/onboarding-privacy-choices.tsx", "utf8"), /<InitialDevicePermissions/);
  assert.match(settings, /requestInitialLocation/);
  assert.match(settings, /requestInitialNotifications/);
  assert.match(settings, /devicePermissionReviewStatus/);
  assert.doesNotMatch(settings, /Preferencia interna|Registro de entrega|Solicitud guardada/);
  assert.match(settings, /persistPreference\("notifications", "enabled"\)/);
  assert.doesNotMatch(settings, /notifications:\s*"granted"/);
});

test("notification channel toggles wait for the canonical account response", () => {
  const panel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  assert.match(panel, /notificationPreferencesReady/);
  assert.match(panel, /Consultando preferencias de cuenta/);
  assert.match(panel, /notificationPreferencesReady && <>/);
});
