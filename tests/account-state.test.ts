import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_STORAGE_KEYS,
  authErrorMessage,
  buildLegalAcceptances,
  clearLegalAcceptancesForUser,
  hasCurrentLegalConsent,
  hasLocalGolfData,
  isValidEmail,
  mergeLegalAcceptances,
  migrationDecisionStorageKey,
  normalizeOtp,
  parseLegalAcceptances,
} from "../lib/account-state";

test("consentimiento guarda usuario, versión, fecha y locale", () => {
  const accepted = buildLegalAcceptances("guest", "2026-09-01T12:00:00.000Z");
  assert.equal(accepted.length, 4);
  assert.equal(hasCurrentLegalConsent(accepted, "guest"), true);
  assert.equal(accepted.find((item) => item.type === "privacy")?.documentVersion, "2026-09-02-v2");
  assert.equal(accepted.find((item) => item.type === "age_confirmation")?.documentVersion, "2026-09-01-v1");
  assert.equal(accepted.find((item) => item.type === "age_confirmation")?.acceptedAt, "2026-09-01T12:00:00.000Z");
});

test("una versión anterior vuelve a solicitar consentimiento", () => {
  const stale = buildLegalAcceptances("user-1", "2026-01-01T00:00:00.000Z").map((item) => ({ ...item, documentVersion: "old" }));
  assert.equal(hasCurrentLegalConsent(stale, "user-1"), false);
  assert.equal(hasCurrentLegalConsent(buildLegalAcceptances("user-1", "2026-09-01T00:00:00.000Z"), "user-1"), true);
});

test("merge de consentimiento conserva otros usuarios sin duplicar tipos", () => {
  const old = buildLegalAcceptances("guest", "2026-08-01T00:00:00.000Z");
  const next = buildLegalAcceptances("guest", "2026-09-01T00:00:00.000Z");
  const merged = mergeLegalAcceptances([...old, ...buildLegalAcceptances("other", "2026-09-01T00:00:00.000Z")], next);
  assert.equal(merged.filter((item) => item.userId === "guest").length, 4);
  assert.equal(merged.filter((item) => item.userId === "other").length, 4);
  assert.equal(parseLegalAcceptances(JSON.stringify(merged)).length, 8);
  assert.deepEqual(parseLegalAcceptances("bad-json"), []);
});

test("correo y OTP se validan sin llamar OAuth real", () => {
  assert.equal(isValidEmail("jugador@example.com"), true);
  assert.equal(isValidEmail("incorrecto"), false);
  assert.equal(normalizeOtp("00a 12-3456"), "00123456");
  assert.equal(normalizeOtp("12a 34-56b78"), "12345678");
  assert.equal(normalizeOtp("1234567890"), "12345678");
  assert.match(authErrorMessage(new Error("token expired"), "otp"), /expiró/);
  assert.match(authErrorMessage(new Error("Failed to fetch"), "google"), /conexión/);
  assert.match(authErrorMessage(new Error("provider not enabled"), "apple"), /pendiente de configuración/);
});

test("detectar datos locales existentes no modifica el storage", () => {
  const values = new Map([["golfbets-history", "[{\"id\":\"r1\"}]"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(hasLocalGolfData(storage as Pick<Storage, "getItem">), true);
  assert.equal(values.size, 1);
});

test("la decisión de migración local se separa por cuenta", () => {
  assert.notEqual(migrationDecisionStorageKey("user-a"), migrationDecisionStorageKey("user-b"));
  assert.match(migrationDecisionStorageKey("user-a"), /user-a$/);
});

test("la confirmación 18+ de invitado queda versionada en almacenamiento local", () => {
  const stored = JSON.stringify(buildLegalAcceptances("guest", "2026-09-02T12:00:00.000Z"));
  const restored = parseLegalAcceptances(stored);
  assert.equal(ACCOUNT_STORAGE_KEYS.acceptances, "backyard-legal-acceptances-v1");
  assert.equal(restored.some((item) => item.userId === "guest" && item.type === "age_confirmation"), true);
  assert.equal(hasCurrentLegalConsent(restored, "guest"), true);
});

test("cada entrada invitada puede reiniciar solo su ceremonia legal", () => {
  const guest = buildLegalAcceptances("guest", "2026-09-02T12:00:00.000Z");
  const account = buildLegalAcceptances("user-1", "2026-09-02T12:00:00.000Z");
  const cleared = clearLegalAcceptancesForUser([...guest, ...account], "guest");
  assert.equal(hasCurrentLegalConsent(cleared, "guest"), false);
  assert.equal(hasCurrentLegalConsent(cleared, "user-1"), true);
});
