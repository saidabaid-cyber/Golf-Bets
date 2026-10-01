import assert from "node:assert/strict";
import test from "node:test";

import {
  OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
  OPTIONAL_AUTHORIZATION_POLICY_VERSIONS,
  OPTIONAL_AUTHORIZATION_SCOPES,
  isCompleteBundleResolution,
  parseOptionalAuthorizationSettingsScope,
  parseOptionalAuthorizationState,
  requestOptionalAuthorizationState,
  resolveOptionalAuthorizationBundle,
  saveOptionalAuthorizationScope,
} from "../lib/account-optional-authorizations";
import { cacheAccountLearningConsent, clearAccountLearningConsentServerClock, failClosedAccountLearningConsent, readAccountLearningConsent } from "../lib/account-learning-consent-cache";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, defaultLearningConsent, learningConsentStorageKey, readLearningConsent, writeLearningConsent } from "../lib/backyard-ai/memory/learning-events";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const RECEIPT_ID = "6f7e8400-e29b-41d4-a716-446655440001";
const DECIDED_AT = "2026-09-30T18:00:00.000Z";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

function rawBundle(action: "authorize_all" | "decline_all", overrides: Record<string, unknown> = {}) {
  const active = action === "authorize_all";
  return {
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved: true,
    eligible: false,
    receipt: {
      id: RECEIPT_ID,
      bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      action,
      idempotencyKey: REQUEST_ID,
      decidedAt: DECIDED_AT,
      featureSet: {
        scopes: OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => ({ scope, policyVersion: OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope] })),
        excluded: ["MARKETING", "FINANCIAL_PATRIMONIAL"],
        projections: {
          profileVisibility: active ? "public" : "private",
          socialPrivacy: active ? "FRIENDS" : "PRIVATE",
          socialProfilePrivacy: active ? "PUBLIC" : "PRIVATE",
          sharing: {
            enabledForFriends: active,
            rounds: active,
            achievements: active,
            equipment: active,
            courses: active,
          },
          notifications: {
            internal: active,
            master: active,
            push: active,
            email: active,
            rounds: active,
            reminders: active,
          },
        },
      },
    },
    scopes: Object.fromEntries(OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
      active,
      status: active ? "accepted" : "declined",
      policyVersion: OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
      source: active ? "onboarding_authorize_all" : "onboarding_decline_all",
      decidedAt: DECIDED_AT,
    }])),
    profileVisibility: active ? "public" : "private",
    socialPrivacy: active ? "FRIENDS" : "PRIVATE",
    socialProfilePrivacy: active ? "PUBLIC" : "PRIVATE",
    sharing: {
      enabledForFriends: active,
      rounds: active,
      achievements: active,
      equipment: active,
      courses: active,
    },
    notifications: {
      internal: active,
      master: active,
      push: active,
      email: active,
      rounds: active,
      reminders: active,
    },
    ...overrides,
  };
}

test("canonical optional bundle parses all seven explicit scopes", () => {
  const parsed = parseOptionalAuthorizationState(rawBundle("authorize_all"));
  assert.ok(parsed);
  assert.equal(Object.keys(parsed.scopes).length, 7);
  assert.ok(OPTIONAL_AUTHORIZATION_SCOPES.every((scope) => parsed.scopes[scope].active));
  assert.equal(parsed.receipt?.action, "authorize_all");
  assert.equal(parsed.receipt && "id" in parsed.receipt, false);
  assert.equal(isCompleteBundleResolution(parsed, "authorize_all"), true);
});

test("the normalized HTTP state can be parsed again by the browser client", () => {
  const normalized = parseOptionalAuthorizationState(rawBundle("authorize_all"));
  assert.ok(normalized);
  assert.deepEqual(parseOptionalAuthorizationState(normalized), normalized);
  assert.equal(isCompleteBundleResolution(normalized, "authorize_all"), true);
});

test("volatile canonical learning decision defeats stale local ON when storage writes fail", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem() { throw new Error("quota"); },
    removeItem(key: string) { values.delete(key); },
  };
  const consentKey = learningConsentStorageKey("owner");
  assert.ok(consentKey);
  values.set(consentKey, JSON.stringify({
    schemaVersion: 1,
    ownerId: "owner",
    personalMemoryEnabled: true,
    globalLearningEnabled: true,
    retainPrivateInputs: false,
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    updatedAt: "2026-09-29T18:00:00.000Z",
    grantedAt: "2026-09-29T18:00:00.000Z",
  }));
  const declined = parseOptionalAuthorizationState(rawBundle("decline_all"));
  assert.ok(declined);
  const projected = cacheAccountLearningConsent(storage as unknown as Storage, "owner", declined);
  assert.equal(projected.personalMemoryEnabled, false);
  assert.equal(projected.globalLearningEnabled, false);
  const runtime = readAccountLearningConsent(storage as unknown as Storage, "owner");
  assert.equal(runtime.personalMemoryEnabled, false);
  assert.equal(runtime.globalLearningEnabled, false);
});

test("client-authored durable learning clocks never authorize memory or learning", () => {
  const storage = memoryStorage();
  const decidedAt = "2099-01-01T00:00:00.000Z";
  storage.setItem(`the-backyard:account-learning-server-clock:v1:${encodeURIComponent("forged-owner")}`, JSON.stringify({
    schemaVersion: 1,
    userId: "forged-owner",
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    scopes: {
      PERSONAL_MEMORY: { active: true, decidedAt },
      GLOBAL_LEARNING: { active: true, decidedAt },
    },
  }));
  const consentKey = learningConsentStorageKey("forged-owner");
  assert.ok(consentKey);
  storage.setItem(consentKey, JSON.stringify({
    schemaVersion: 1,
    ownerId: "forged-owner",
    personalMemoryEnabled: true,
    globalLearningEnabled: true,
    retainPrivateInputs: false,
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    updatedAt: decidedAt,
    grantedAt: decidedAt,
  }));

  const runtime = readAccountLearningConsent(storage as unknown as Storage, "forged-owner");
  assert.equal(runtime.personalMemoryEnabled, false);
  assert.equal(runtime.globalLearningEnabled, false);
});

test("server-confirmed learning remains available in this execution when durable writes fail", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem() { throw new Error("quota"); },
    removeItem(key: string) { values.delete(key); },
  };
  const accepted = parseOptionalAuthorizationState(rawBundle("authorize_all"));
  assert.ok(accepted);

  const projected = cacheAccountLearningConsent(storage as unknown as Storage, "confirmed-owner", accepted);
  assert.equal(projected.personalMemoryEnabled, true);
  assert.equal(projected.globalLearningEnabled, true);
  const runtime = readAccountLearningConsent(storage as unknown as Storage, "confirmed-owner");
  assert.equal(runtime.personalMemoryEnabled, true);
  assert.equal(runtime.globalLearningEnabled, true);
});

test("decline-all is complete only when every included projection remains OFF", () => {
  const declined = parseOptionalAuthorizationState(rawBundle("decline_all"));
  assert.ok(declined);
  assert.equal(isCompleteBundleResolution(declined, "decline_all"), true);

  const partial = parseOptionalAuthorizationState(rawBundle("decline_all", {
    sharing: { enabledForFriends: false, rounds: true, achievements: false, equipment: false, courses: false },
  }));
  assert.ok(partial);
  assert.equal(isCompleteBundleResolution(partial, "decline_all"), false);
});

test("authorize-all is incomplete when a projected privacy or notification default is missing", () => {
  const privateProfile = parseOptionalAuthorizationState(rawBundle("authorize_all", {
    socialProfilePrivacy: "PRIVATE",
  }));
  assert.ok(privateProfile);
  assert.equal(isCompleteBundleResolution(privateProfile, "authorize_all"), false);

  const notificationsWithoutMaster = parseOptionalAuthorizationState(rawBundle("authorize_all", {
    notifications: {
      internal: true,
      master: false,
      push: true,
      email: true,
      rounds: true,
      reminders: true,
    },
  }));
  assert.ok(notificationsWithoutMaster);
  assert.equal(isCompleteBundleResolution(notificationsWithoutMaster, "authorize_all"), false);
});

test("malformed, incomplete or forged bundle responses fail closed", () => {
  const missingScope = rawBundle("authorize_all");
  delete (missingScope.scopes as Record<string, unknown>).PERSONAL_MEMORY;
  assert.equal(parseOptionalAuthorizationState(missingScope), null);
  assert.equal(parseOptionalAuthorizationState({ ...rawBundle("authorize_all"), bundleVersion: "unknown" }), null);
  assert.equal(parseOptionalAuthorizationState({ ...rawBundle("authorize_all"), receipt: { action: "authorize_all", idempotencyKey: "not-a-uuid", decidedAt: DECIDED_AT } }), null);
  assert.equal(parseOptionalAuthorizationState({ ...rawBundle("authorize_all"), resolved: false }), null);

  const contradictoryScope = rawBundle("authorize_all");
  (contradictoryScope.scopes as Record<string, Record<string, unknown>>).PERSONAL_MEMORY.active = false;
  assert.equal(parseOptionalAuthorizationState(contradictoryScope), null);

  const extraScope = rawBundle("authorize_all");
  (extraScope.scopes as Record<string, unknown>).MARKETING = { active: true };
  assert.equal(parseOptionalAuthorizationState(extraScope), null);

  const driftedReceipt = rawBundle("authorize_all");
  const receipt = driftedReceipt.receipt as Record<string, unknown>;
  receipt.featureSet = { scopes: [], excluded: ["MARKETING"] };
  assert.equal(parseOptionalAuthorizationState(driftedReceipt), null);

  const invalidReceiptId = rawBundle("authorize_all");
  (invalidReceiptId.receipt as Record<string, unknown>).id = "not-a-uuid";
  assert.equal(parseOptionalAuthorizationState(invalidReceiptId), null);

  const unknownReceiptField = rawBundle("authorize_all");
  (unknownReceiptField.receipt as Record<string, unknown>).unexpected = true;
  assert.equal(parseOptionalAuthorizationState(unknownReceiptField), null);
});

test("scope state with a mismatched policy version fails closed", () => {
  const mismatched = rawBundle("authorize_all");
  (mismatched.scopes as Record<string, Record<string, unknown>>).PERSONAL_MEMORY.policyVersion = "outdated-policy";
  assert.equal(parseOptionalAuthorizationState(mismatched), null);

  const missingWithWrongVersion = rawBundle("decline_all", { resolved: false, receipt: null });
  (missingWithWrongVersion.scopes as Record<string, Record<string, unknown>>).GLOBAL_LEARNING = {
    active: false,
    status: "missing",
    policyVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    source: null,
    decidedAt: null,
  };
  assert.equal(parseOptionalAuthorizationState(missingWithWrongVersion), null);
});

test("individual Settings endpoint accepts only memory, learning and internal device intents", () => {
  for (const scope of ["PERSONAL_MEMORY", "GLOBAL_LEARNING", "LOCATION_INTERNAL", "NOTIFICATION_INTERNAL"]) {
    assert.equal(parseOptionalAuthorizationSettingsScope(scope), scope);
  }
  for (const excluded of ["MARKETING", "FINANCIAL_PATRIMONIAL", "AI_PROVIDER_PROCESSING_CONSENT", "AI_IMAGE_PROCESSING_CONSENT"]) {
    assert.equal(parseOptionalAuthorizationSettingsScope(excluded), null);
  }
});

test("account hydration requires canonical learning evidence and never treats legacy absence as consent", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const initial = {
    ...defaultLearningConsent("owner", BACKYARD_AI_MEMORY_POLICY_VERSION, "2026-09-29T10:00:00.000Z"),
    personalMemoryEnabled: true,
    grantedAt: "2026-09-29T10:00:00.000Z",
  };
  assert.equal(writeLearningConsent(storage as Storage, initial).ok, true);

  const legacyRaw = rawBundle("decline_all", { resolved: false, eligible: false, receipt: null });
  for (const scope of ["PERSONAL_MEMORY", "GLOBAL_LEARNING"] as const) {
    (legacyRaw.scopes as Record<string, Record<string, unknown>>)[scope] = {
      active: false,
      status: "missing",
      policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
      source: null,
      decidedAt: null,
    };
  }
  const legacy = parseOptionalAuthorizationState(legacyRaw);
  assert.ok(legacy);
  const preserved = cacheAccountLearningConsent(storage as Storage, "owner", legacy);
  assert.equal(preserved.personalMemoryEnabled, false);
  assert.equal(preserved.globalLearningEnabled, false);

  const authorized = parseOptionalAuthorizationState(rawBundle("authorize_all"));
  assert.ok(authorized);
  cacheAccountLearningConsent(storage as Storage, "owner", authorized);
  const hydrated = readLearningConsent(storage as Storage, "owner", BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
  assert.equal(hydrated.personalMemoryEnabled, true);
  assert.equal(hydrated.globalLearningEnabled, true);

  clearAccountLearningConsentServerClock(storage as Storage, "owner");
  const afterDeletion = failClosedAccountLearningConsent(storage as Storage, "owner", hydrated);
  assert.equal(afterDeletion.personalMemoryEnabled, false);
  assert.equal(afterDeletion.globalLearningEnabled, false);
});

test("first canonical learning read overrides a future-dated local cache", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
  const local = {
    ...defaultLearningConsent("canonical-owner", BACKYARD_AI_MEMORY_POLICY_VERSION, "2099-01-01T00:00:00.000Z"),
    personalMemoryEnabled: true,
    globalLearningEnabled: true,
    grantedAt: "2099-01-01T00:00:00.000Z",
  };
  assert.equal(writeLearningConsent(storage as Storage, local).ok, true);

  const declined = parseOptionalAuthorizationState(rawBundle("decline_all"));
  assert.ok(declined);
  const hydrated = cacheAccountLearningConsent(storage as Storage, "canonical-owner", declined);
  assert.equal(hydrated.personalMemoryEnabled, false);
  assert.equal(hydrated.globalLearningEnabled, false);
  assert.equal(hydrated.updatedAt, DECIDED_AT);
});

test("an older GET cannot overwrite a newer per-scope PATCH response in the active execution", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
  const newerRaw = rawBundle("authorize_all");
  (newerRaw.scopes as Record<string, Record<string, unknown>>).PERSONAL_MEMORY.decidedAt = "2026-09-30T20:00:00.000Z";
  const newer = parseOptionalAuthorizationState(newerRaw);
  const older = parseOptionalAuthorizationState(rawBundle("decline_all"));
  assert.ok(newer);
  assert.ok(older);

  const afterPatch = cacheAccountLearningConsent(storage as Storage, "race-owner", newer);
  assert.equal(afterPatch.personalMemoryEnabled, true);
  const afterLateGet = cacheAccountLearningConsent(storage as Storage, "race-owner", older, afterPatch);
  assert.equal(afterLateGet.personalMemoryEnabled, true);
  assert.equal(afterLateGet.globalLearningEnabled, false);
  assert.equal(afterLateGet.updatedAt, "2026-09-30T20:00:00.000Z");
});

test("client sends owner-free GET, bundle POST and individual PATCH contracts", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(rawBundle("authorize_all"));
  }) as typeof fetch;

  await requestOptionalAuthorizationState("access-token", undefined, transport);
  await resolveOptionalAuthorizationBundle("access-token", "authorize_all", REQUEST_ID, undefined, transport);
  await saveOptionalAuthorizationScope("access-token", "PERSONAL_MEMORY", true, REQUEST_ID, undefined, transport);

  assert.deepEqual(calls.map((call) => call.init?.method), ["GET", "POST", "PATCH"]);
  assert.ok(calls.every((call) => call.url === "/api/account/optional-authorizations"));
  assert.ok(calls.every((call) => (call.init?.headers as Record<string, string>).authorization === "Bearer access-token"));
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    action: "authorize_all",
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    idempotencyKey: REQUEST_ID,
  });
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    scope: "PERSONAL_MEMORY",
    enabled: true,
    idempotencyKey: REQUEST_ID,
  });
  assert.doesNotMatch(`${calls[1].init?.body}${calls[2].init?.body}`, /userId|owner/i);
});

test("client rejects non-canonical success bodies and server failures", async () => {
  const malformed = (async () => Response.json({ ok: true })) as typeof fetch;
  await assert.rejects(() => requestOptionalAuthorizationState("token", undefined, malformed), /No pudimos confirmar/);

  const failed = (async () => Response.json({ error: "No se aplicó un estado parcial." }, { status: 503 })) as typeof fetch;
  await assert.rejects(() => resolveOptionalAuthorizationBundle("token", "authorize_all", REQUEST_ID, undefined, failed), /No se aplicó un estado parcial/);
});

test("client aborts a stalled optional-authorization request within its deadline", async () => {
  const stalled = ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
  })) as typeof fetch;

  await assert.rejects(
    () => requestOptionalAuthorizationState("token", undefined, stalled, 5),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});
