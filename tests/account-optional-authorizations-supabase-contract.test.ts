import assert from "node:assert/strict";
import test from "node:test";
import { optionalBundleLegalEvidence } from "../lib/account-optional-legal-evidence";

import {
  OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
  OPTIONAL_AUTHORIZATION_POLICY_VERSIONS,
  OPTIONAL_AUTHORIZATION_SCOPES,
  parseOptionalAuthorizationState,
  requestOptionalAuthorizationState,
  resolveOptionalAuthorizationBundle,
} from "../lib/account-optional-authorizations";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const RECEIPT_ID = "f30d2a64-df70-4af6-a94a-e4ad55af8ac8";
const DECIDED_AT = "2026-09-30T23:44:00.000Z";

function sqlOptionalAuthorizationState(action: "authorize_all" | "decline_all") {
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
      featureSet: {
        scopes: OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => ({
          scope,
          policyVersion: OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
        })),
        excluded: [],
        legal: optionalBundleLegalEvidence(action, REQUEST_ID, DECIDED_AT),
        projections: {
          profileVisibility: "public",
          socialPrivacy: active ? "FRIENDS" : "PRIVATE",
          socialProfilePrivacy: "PUBLIC",
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
      decidedAt: DECIDED_AT,
    },
    scopes: Object.fromEntries(OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
      active,
      status: active ? "accepted" : "declined",
      policyVersion: OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
      source: active ? "onboarding_authorize_all" : "onboarding_decline_all",
      decidedAt: DECIDED_AT,
    }])),
    legal: Object.fromEntries(["financial_data", "marketing"].map((subject) => [subject, {
      active, status: active ? "accepted" : "rejected", policyVersion: "2026-09-08-v6", decidedAt: DECIDED_AT,
    }])),
    profileVisibility: "public",
    socialPrivacy: active ? "FRIENDS" : "PRIVATE",
    socialProfilePrivacy: "PUBLIC",
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
  };
}

test("Supabase receipt id is validated, accepted and omitted from the normalized client state", () => {
  const parsed = parseOptionalAuthorizationState(sqlOptionalAuthorizationState("authorize_all"));

  assert.ok(parsed);
  assert.equal(parsed.receipt?.action, "authorize_all");
  assert.equal(parsed.receipt?.idempotencyKey, REQUEST_ID);
  assert.equal(parsed.receipt && Object.hasOwn(parsed.receipt, "id"), false);
});

test("Supabase receipt fails closed for an invalid id or an unknown receipt field", () => {
  const invalidId = sqlOptionalAuthorizationState("authorize_all");
  invalidId.receipt.id = "not-a-uuid";
  assert.equal(parseOptionalAuthorizationState(invalidId), null);

  const unknownField = sqlOptionalAuthorizationState("authorize_all") as ReturnType<typeof sqlOptionalAuthorizationState> & {
    receipt: ReturnType<typeof sqlOptionalAuthorizationState>["receipt"] & { unexpected?: string };
  };
  unknownField.receipt.unexpected = "must-fail-closed";
  assert.equal(parseOptionalAuthorizationState(unknownField), null);
});

test("GET and POST clients accept the SQL-shaped response containing receipt.id", async () => {
  const calls: Array<{ method: string | undefined; body: string | undefined }> = [];
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method, body: init?.body?.toString() });
    return Response.json(sqlOptionalAuthorizationState("authorize_all"));
  }) as typeof fetch;

  const read = await requestOptionalAuthorizationState("access-token", undefined, transport);
  const saved = await resolveOptionalAuthorizationBundle(
    "access-token",
    "authorize_all",
    REQUEST_ID,
    undefined,
    transport,
  );

  assert.equal(read.receipt?.action, "authorize_all");
  assert.equal(saved.receipt?.action, "authorize_all");
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(calls[1].body ?? "null"), {
    action: "authorize_all",
    bundleVersion: OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    idempotencyKey: REQUEST_ID,
  });
});

test("GET and POST clients accept the normalized response emitted by the API route", async () => {
  const normalized = parseOptionalAuthorizationState(sqlOptionalAuthorizationState("authorize_all"));
  assert.ok(normalized);
  const transport = (async () => Response.json(normalized)) as typeof fetch;

  const read = await requestOptionalAuthorizationState("access-token", undefined, transport);
  const saved = await resolveOptionalAuthorizationBundle(
    "access-token",
    "authorize_all",
    REQUEST_ID,
    undefined,
    transport,
  );

  assert.deepEqual(read, normalized);
  assert.deepEqual(saved, normalized);
});

test("a completed POST remains readable after reload without duplicating the decision", async () => {
  const persisted = sqlOptionalAuthorizationState("decline_all");
  let postCount = 0;
  let getCount = 0;
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") postCount += 1;
    if (init?.method === "GET") getCount += 1;
    return Response.json(structuredClone(persisted));
  }) as typeof fetch;

  const saved = await resolveOptionalAuthorizationBundle(
    "access-token",
    "decline_all",
    REQUEST_ID,
    undefined,
    transport,
  );
  const reloaded = await requestOptionalAuthorizationState("access-token", undefined, transport);
  const signedInAgain = await requestOptionalAuthorizationState("fresh-access-token", undefined, transport);

  assert.deepEqual(reloaded, saved);
  assert.deepEqual(signedInAgain, saved);
  assert.equal(saved.receipt?.idempotencyKey, REQUEST_ID);
  assert.equal(postCount, 1);
  assert.equal(getCount, 2);
});
