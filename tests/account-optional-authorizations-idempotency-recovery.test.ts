import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as optionalAuthorizations from "../lib/account-optional-authorizations";
import { optionalBundleLegalEvidence } from "../lib/account-optional-legal-evidence";
import * as security from "../lib/backyard-ai/server/http-security";

const OWNER = "11111111-1111-4111-8111-111111111111";
const AUTHORIZE_REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const DECLINE_REQUEST_ID = "660e8400-e29b-41d4-a716-446655440000";
const RECEIPT_ID = "770e8400-e29b-41d4-a716-446655440000";
const DECIDED_AT = "2026-09-30T23:44:00.000Z";
const ROUTE_URL = "https://app.example/api/account/optional-authorizations";

type Action = "authorize_all" | "decline_all";
type RpcError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: RpcError | null };
type RouteRequest = Request & { nextUrl: URL };
type RouteApi = {
  GET(request: RouteRequest): Promise<Response>;
  POST(request: RouteRequest): Promise<Response>;
};

function projections(active: boolean) {
  return {
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

function state(action: Action | null, idempotencyKey: string | null) {
  const active = action === "authorize_all";
  const resolved = action !== null;
  const projection = projections(active);
  return {
    bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved,
    eligible: !resolved,
    receipt: resolved ? {
      // get_optional_authorization_state_v2 returns the persisted receipt id.
      id: RECEIPT_ID,
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      action,
      idempotencyKey,
      featureSet: {
        scopes: optionalAuthorizations.OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => ({
          scope,
          policyVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
        })),
        excluded: [],
        legal: optionalBundleLegalEvidence(action!, idempotencyKey!, DECIDED_AT),
        projections: projection,
      },
      decidedAt: DECIDED_AT,
    } : null,
    scopes: Object.fromEntries(optionalAuthorizations.OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
      active,
      status: resolved ? (active ? "accepted" : "declined") : "missing",
      policyVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
      source: resolved ? (active ? "onboarding_authorize_all" : "onboarding_decline_all") : null,
      decidedAt: resolved ? DECIDED_AT : null,
    }])),
    legal: Object.fromEntries(["financial_data", "marketing"].map((subject) => [subject, {
      active, status: resolved ? (active ? "accepted" : "rejected") : "missing",
      policyVersion: "2026-09-08-v6", decidedAt: resolved ? DECIDED_AT : null,
    }])),
    profileVisibility: projection.profileVisibility,
    socialPrivacy: projection.socialPrivacy,
    socialProfilePrivacy: projection.socialProfilePrivacy,
    sharing: projection.sharing,
    notifications: projection.notifications,
  };
}

function statefulRouteHarness(options: { loseFirstCommittedResponse?: boolean } = {}) {
  let storedAction: Action | null = null;
  let storedIdempotencyKey: string | null = null;
  let mutationCount = 0;
  let loseFirstCommittedResponse = options.loseFirstCommittedResponse === true;

  const client = {
    rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
      if (name === "get_optional_authorization_state_v2") {
        return { data: state(storedAction, storedIdempotencyKey), error: null };
      }
      if (name !== "resolve_optional_authorization_bundle_v2") {
        throw new Error(`Unexpected RPC ${name}`);
      }

      const requestedAction = args?.requested_action as Action;
      const requestedIdempotencyKey = args?.requested_idempotency_key as string;
      if (storedAction !== null) {
        if (storedAction !== requestedAction) {
          return {
            data: null,
            error: { code: "22023", message: "optional_authorization_bundle_already_resolved" },
          };
        }
        return { data: state(storedAction, storedIdempotencyKey), error: null };
      }

      storedAction = requestedAction;
      storedIdempotencyKey = requestedIdempotencyKey;
      mutationCount += 1;
      if (loseFirstCommittedResponse) {
        loseFirstCommittedResponse = false;
        return { data: { committed: true }, error: null };
      }
      return { data: state(storedAction, storedIdempotencyKey), error: null };
    },
  };

  const routeExports: Partial<RouteApi> = {};
  const source = ts.transpileModule(readFileSync("app/api/account/optional-authorizations/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports: routeExports,
    Request,
    Response,
    process: { env: {} },
    require: (id: string) => {
      if (id.endsWith("/account-optional-authorizations")) return optionalAuthorizations;
      if (id.endsWith("/supabase/server")) return { getSupabaseAdmin: () => client };
      if (id.endsWith("/runtime-environment")) return { resolveCanonicalDataEnvironment: () => "preview" };
      if (id.endsWith("/account-optional-legal-evidence")) return { optionalBundleLegalEvidence };
      if (id.endsWith("/http-security")) return security;
      if (id.endsWith("/server-auth")) return {
        authenticatedRequest: async () => ({ ok: true, userId: OWNER, client }),
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });

  function request(method: "GET" | "POST", action?: Action, idempotencyKey?: string) {
    const body = action ? JSON.stringify({
      action,
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey,
    }) : undefined;
    const request = new Request(ROUTE_URL, {
      method,
      headers: {
        authorization: "Bearer valid-session",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    }) as RouteRequest;
    Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
    return request;
  }

  return {
    route: routeExports as RouteApi,
    request,
    mutationCount: () => mutationCount,
  };
}

async function post(fixture: ReturnType<typeof statefulRouteHarness>, action: Action, requestId: string) {
  return fixture.route.POST(fixture.request("POST", action, requestId));
}

test("initial optional authorization GET returns the unresolved canonical state", async () => {
  const fixture = statefulRouteHarness();
  const response = await fixture.route.GET(fixture.request("GET"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.resolved, false);
  assert.equal(body.eligible, true);
  assert.equal(body.receipt, null);
  assert.equal(fixture.mutationCount(), 0);
});

test("authorize_all persists once and is visible through the subsequent GET", async () => {
  const fixture = statefulRouteHarness();
  const saved = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);
  const read = await fixture.route.GET(fixture.request("GET"));

  assert.equal(saved.status, 200);
  assert.equal(read.status, 200);
  assert.equal((await saved.json()).receipt.action, "authorize_all");
  assert.equal((await read.json()).scopes.PERSONAL_MEMORY.active, true);
  assert.equal(fixture.mutationCount(), 1);
});

test("decline_all persists once and is visible through the subsequent GET", async () => {
  const fixture = statefulRouteHarness();
  const saved = await post(fixture, "decline_all", DECLINE_REQUEST_ID);
  const read = await fixture.route.GET(fixture.request("GET"));

  assert.equal(saved.status, 200);
  assert.equal(read.status, 200);
  assert.equal((await saved.json()).receipt.action, "decline_all");
  assert.equal((await read.json()).scopes.PERSONAL_MEMORY.active, false);
  assert.equal(fixture.mutationCount(), 1);
});

test("replaying the same successful request id returns 200 without a duplicate mutation", async () => {
  const fixture = statefulRouteHarness();
  const first = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);
  const replay = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);

  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).receipt.idempotencyKey, AUTHORIZE_REQUEST_ID);
  assert.equal(fixture.mutationCount(), 1);
});

test("a retry recovers when DB committed but the first response was malformed", async () => {
  const fixture = statefulRouteHarness({ loseFirstCommittedResponse: true });
  const lost = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);
  const retry = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);
  const read = await fixture.route.GET(fixture.request("GET"));

  assert.equal(lost.status, 503);
  assert.equal((await lost.json()).code, "CONSENT_CONFIRMATION_FAILED");
  assert.equal(retry.status, 200);
  assert.equal(read.status, 200);
  assert.equal((await retry.json()).receipt.idempotencyKey, AUTHORIZE_REQUEST_ID);
  assert.equal((await read.json()).receipt.action, "authorize_all");
  assert.equal(fixture.mutationCount(), 1);
});

test("opposite action after a commit returns 409 while GET preserves the canonical decision", async () => {
  const fixture = statefulRouteHarness();
  const saved = await post(fixture, "decline_all", DECLINE_REQUEST_ID);
  const conflicting = await post(fixture, "authorize_all", AUTHORIZE_REQUEST_ID);
  const read = await fixture.route.GET(fixture.request("GET"));

  assert.equal(saved.status, 200);
  assert.equal(conflicting.status, 409);
  assert.equal((await conflicting.json()).code, "ALREADY_RESOLVED");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).receipt.action, "decline_all");
  assert.equal(fixture.mutationCount(), 1);
});
