import assert from "node:assert/strict";
import test from "node:test";
import { devicePermissionReviewStatus, emptyDevicePermissionPreferences, requestInitialNotifications } from "../lib/device-permissions";
import { optionalBundleLegalEvidence } from "../lib/account-optional-legal-evidence";

test("review states never turn intent or platform limitations into a device grant", () => {
  const value = { ...emptyDevicePermissionPreferences("owner"), locationPreference: "enabled" as const, notificationPreference: "enabled" as const };
  for (const status of ["unknown", "prompt", "unavailable", "timeout"] as const) {
    assert.equal(devicePermissionReviewStatus({ ...value, location: status }, "location"), "Pendientes en este dispositivo");
    assert.equal(devicePermissionReviewStatus({ ...value, notifications: status }, "notifications"), "Pendientes en este dispositivo");
  }
  assert.equal(devicePermissionReviewStatus({ ...value, location: "granted" }, "location"), "Permitida");
  assert.equal(devicePermissionReviewStatus({ ...value, notifications: "granted" }, "notifications"), "Activadas");
  assert.equal(devicePermissionReviewStatus({ ...value, notifications: "granted", notificationPreference: "disabled" }, "notifications"), "Desactivadas");
});

test("notification OS prompt starts synchronously on the explicit request, not after cloud persistence", async () => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  let prompts = 0;
  const result = requestInitialNotifications(storage, "owner", { permission: "default", requestPermission: () => { prompts++; return Promise.resolve("granted"); } });
  assert.equal(prompts, 1);
  assert.equal((await result).notifications, "granted");
  assert.equal((await requestInitialNotifications(storage, "owner", null)).notifications, "unavailable");
});

test("marketing and financial envelopes are separate, explicit, versioned and stable on retry", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const accepted = optionalBundleLegalEvidence("authorize_all", id);
  const retry = optionalBundleLegalEvidence("authorize_all", id.toUpperCase());
  assert.deepEqual(accepted.map((e) => e.idempotencyKey), retry.map((e) => e.idempotencyKey));
  assert.notEqual(accepted[0].idempotencyKey, accepted[1].idempotencyKey);
  assert.deepEqual(accepted.map((e) => [e.subject, e.action]), [["financial_data", "accepted"], ["marketing", "accepted"]]);
  assert.ok(accepted.every((e) => e.statementHash.length === 64 && e.documentVersion === "2026-09-08-v6"));
  assert.ok(optionalBundleLegalEvidence("decline_all", id).every((e) => e.action === "rejected"));
});
