import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as optionalAuthorizations from "../lib/account-optional-authorizations";
import { optionalBundleLegalEvidence } from "../lib/account-optional-legal-evidence";
import * as security from "../lib/backyard-ai/server/http-security";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const RECEIPT_ID = "6f7e8400-e29b-41d4-a716-446655440001";
const DECIDED_AT = "2026-09-30T18:00:00.000Z";
const ROUTE_URL = "https://app.example/api/account/optional-authorizations";

type Action = "authorize_all" | "decline_all";
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcCall = { name: string; args?: Record<string, unknown> };
type RouteHandler = (request: Request & { nextUrl: URL }) => Promise<Response>;
type RouteApi = Record<"GET" | "POST" | "PATCH", RouteHandler>;

function canonicalBundle(action: Action) {
  const active = action === "authorize_all";
  return {
    bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved: true,
    eligible: false,
    receipt: {
      id: RECEIPT_ID,
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      action,
      idempotencyKey: REQUEST_ID,
      decidedAt: DECIDED_AT,
      featureSet: {
        scopes: optionalAuthorizations.OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => ({
          scope,
          policyVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
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
    },
    scopes: Object.fromEntries(optionalAuthorizations.OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
      active,
      status: active ? "accepted" : "declined",
      policyVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
      source: active ? "onboarding_authorize_all" : "onboarding_decline_all",
      decidedAt: DECIDED_AT,
    }])),
    legal: Object.fromEntries(["financial_data", "marketing"].map((subject) => [subject, {
      active, status: active ? "accepted" : "rejected",
      policyVersion: "2026-09-08-v6", decidedAt: DECIDED_AT,
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

function routeHarness(options: {
  authenticated?: boolean;
  rpc?: (name: string, args?: Record<string, unknown>) => RpcResult | Promise<RpcResult>;
} = {}) {
  let authCalls = 0;
  const rpcCalls: RpcCall[] = [];
  let currentAction: Action = "authorize_all";
  const client = {
    rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
      rpcCalls.push({ name, args });
      if (options.rpc) return options.rpc(name, args);
      if (name === "resolve_optional_authorization_bundle_v2") {
        return { data: canonicalBundle(args?.requested_action as Action), error: null };
      }
      if (name === "set_optional_authorization_scope_v1") {
        currentAction = args?.requested_enabled ? "authorize_all" : "decline_all";
        return { data: canonicalBundle(currentAction), error: null };
      }
      return { data: canonicalBundle(currentAction), error: null };
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
        authenticatedRequest: async (request: Request) => {
          authCalls++;
          if (options.authenticated === false || !request.headers.get("authorization")) {
            return { ok: false, status: 401, error: "Inicia sesión para continuar.", code: "AUTH_REQUIRED" };
          }
          return { ok: true, userId: OWNER, client };
        },
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });

  function request(method: "GET" | "POST" | "PATCH", input: {
    body?: unknown;
    rawBody?: string;
    contentType?: string | null;
    query?: string;
    bearer?: string | null;
    headers?: Record<string, string>;
  } = {}) {
    const rawBody = input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body));
    const headers = new Headers(input.headers);
    if (input.bearer !== null) headers.set("authorization", `Bearer ${input.bearer ?? "valid-session"}`);
    if (rawBody !== undefined && input.contentType !== null) headers.set("content-type", input.contentType ?? "application/json");
    const request = new Request(`${ROUTE_URL}${input.query ?? ""}`, {
      method,
      headers,
      ...(rawBody === undefined ? {} : { body: rawBody }),
    }) as Request & { nextUrl: URL };
    Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
    return request;
  }

  return {
    route: routeExports as RouteApi,
    request,
    rpcCalls,
    authCalls: () => authCalls,
  };
}

test("optional authorization GET denies an unauthenticated request before any RPC", async () => {
  const fixture = routeHarness({ authenticated: false });
  const response = await fixture.route.GET(fixture.request("GET", { bearer: null }));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "AUTH_REQUIRED");
  assert.equal(fixture.authCalls(), 1);
  assert.deepEqual(fixture.rpcCalls, []);
});

test("optional authorization POST and PATCH reject cross-site requests before auth or RPC", async () => {
  const fixture = routeHarness();
  const post = await fixture.route.POST(fixture.request("POST", {
    body: {
      action: "authorize_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
    },
    headers: { origin: "https://evil.example" },
  }));
  const patch = await fixture.route.PATCH(fixture.request("PATCH", {
    body: { scope: "PERSONAL_MEMORY", enabled: true, idempotencyKey: REQUEST_ID },
    headers: { "sec-fetch-site": "cross-site" },
  }));

  for (const response of [post, patch]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "CROSS_SITE");
  }
  assert.equal(fixture.authCalls(), 0);
  assert.deepEqual(fixture.rpcCalls, []);
});

test("optional authorization writes enforce bounded JSON and exact body contracts", async () => {
  const fixture = routeHarness();
  const invalidRequests: Array<{ method: "POST" | "PATCH"; request: ReturnType<typeof fixture.request>; status: number }> = [
    {
      method: "POST",
      request: fixture.request("POST", {
        body: {
          action: "authorize_all",
          bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
          idempotencyKey: REQUEST_ID,
          unexpected: true,
        },
      }),
      status: 400,
    },
    {
      method: "POST",
      request: fixture.request("POST", {
        body: {
          action: "sometimes",
          bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
          idempotencyKey: REQUEST_ID,
        },
      }),
      status: 400,
    },
    {
      method: "POST",
      request: fixture.request("POST", { body: [] }),
      status: 400,
    },
    {
      method: "PATCH",
      request: fixture.request("PATCH", {
        body: { scope: "AI_PROVIDER_PROCESSING_CONSENT", enabled: true, idempotencyKey: REQUEST_ID },
      }),
      status: 400,
    },
    {
      method: "PATCH",
      request: fixture.request("PATCH", {
        body: { scope: "PERSONAL_MEMORY", enabled: "true", idempotencyKey: REQUEST_ID },
      }),
      status: 400,
    },
    {
      method: "POST",
      request: fixture.request("POST", { rawBody: "{", contentType: "application/json" }),
      status: 400,
    },
    {
      method: "PATCH",
      request: fixture.request("PATCH", { rawBody: "{}", contentType: "text/plain" }),
      status: 415,
    },
    {
      method: "POST",
      request: fixture.request("POST", {
        rawBody: JSON.stringify({ padding: "x".repeat(1_100) }),
        contentType: "application/json",
      }),
      status: 413,
    },
  ];

  for (const invalid of invalidRequests) {
    assert.equal((await fixture.route[invalid.method](invalid.request)).status, invalid.status);
  }
  assert.equal(fixture.authCalls(), 0);
  assert.deepEqual(fixture.rpcCalls, []);
});

test("canonical complete RPC states are returned for GET, bundle POST and scope PATCH", async () => {
  const fixture = routeHarness();
  const get = await fixture.route.GET(fixture.request("GET"));
  const post = await fixture.route.POST(fixture.request("POST", {
    body: {
      action: "authorize_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
    },
  }));
  const patch = await fixture.route.PATCH(fixture.request("PATCH", {
    body: { scope: "PERSONAL_MEMORY", enabled: false, idempotencyKey: REQUEST_ID },
  }));

  for (const response of [get, post, patch]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  }
  assert.equal((await get.json()).scopes.PERSONAL_MEMORY.active, true);
  assert.equal((await post.json()).receipt.action, "authorize_all");
  assert.equal((await patch.json()).scopes.PERSONAL_MEMORY.active, false);
  assert.deepEqual(fixture.rpcCalls.map((call) => call.name), [
    "get_optional_authorization_state_v2", "resolve_optional_authorization_bundle_v2",
    "set_optional_authorization_scope_v1", "get_optional_authorization_state_v2",
  ]);
  assert.equal(fixture.rpcCalls[1].args?.requested_owner_id, OWNER);
  assert.equal(fixture.rpcCalls[1].args?.requested_environment, "preview");
  const legal = fixture.rpcCalls[1].args?.requested_legal_events as Array<{ subject: string; action: string }>;
  assert.deepEqual(legal.map((row) => [row.subject, row.action]), [["financial_data", "accepted"], ["marketing", "accepted"]]);});

test("partial and malformed RPC states fail closed without reporting partial success", async () => {
  const partial = canonicalBundle("authorize_all");
  partial.notifications.master = false;
  const partialPost = routeHarness({ rpc: async () => ({ data: partial, error: null }) });
  const partialResponse = await partialPost.route.POST(partialPost.request("POST", {
    body: {
      action: "authorize_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
    },
  }));
  assert.equal(partialResponse.status, 503);
  assert.equal((await partialResponse.json()).code, "CONSENT_CONFIRMATION_FAILED");

  const malformedGet = routeHarness({ rpc: async () => ({ data: { ok: true }, error: null }) });
  const getResponse = await malformedGet.route.GET(malformedGet.request("GET"));
  assert.equal(getResponse.status, 503);
  assert.equal((await getResponse.json()).code, "CONSENT_STORE_UNAVAILABLE");

  const mismatchedPatch = routeHarness({ rpc: async () => ({ data: canonicalBundle("decline_all"), error: null }) });
  const patchResponse = await mismatchedPatch.route.PATCH(mismatchedPatch.request("PATCH", {
    body: { scope: "PERSONAL_MEMORY", enabled: true, idempotencyKey: REQUEST_ID },
  }));
  assert.equal(patchResponse.status, 503);
  assert.equal((await patchResponse.json()).code, "CONSENT_CONFIRMATION_FAILED");

  const malformedPost = routeHarness({ rpc: async () => ({ data: null, error: null }) });
  const postResponse = await malformedPost.route.POST(malformedPost.request("POST", {
    body: {
      action: "decline_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
    },
  }));
  assert.equal(postResponse.status, 503);
  assert.equal((await postResponse.json()).code, "CONSENT_CONFIRMATION_FAILED");
});

test("the optional authorization route accepts no client-selected owner", async () => {
  const fixture = routeHarness();
  const get = await fixture.route.GET(fixture.request("GET", { query: `?userId=${OTHER}` }));
  const post = await fixture.route.POST(fixture.request("POST", {
    body: {
      action: "authorize_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
      userId: OTHER,
    },
  }));
  const patch = await fixture.route.PATCH(fixture.request("PATCH", {
    body: {
      scope: "PERSONAL_MEMORY",
      enabled: true,
      idempotencyKey: REQUEST_ID,
      ownerId: OTHER,
    },
  }));

  assert.deepEqual([get.status, post.status, patch.status], [400, 400, 400]);
  assert.equal(fixture.authCalls(), 0);
  assert.deepEqual(fixture.rpcCalls, []);

  const canonical = routeHarness();
  assert.equal((await canonical.route.POST(canonical.request("POST", {
    body: {
      action: "decline_all",
      bundleVersion: optionalAuthorizations.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
      idempotencyKey: REQUEST_ID,
    },
  }))).status, 200);
  assert.equal(canonical.rpcCalls[0].args?.requested_owner_id, OWNER);
  assert.deepEqual(Object.keys(canonical.rpcCalls[0].args ?? {}).sort(), [
    "requested_action",
    "requested_bundle_version",
    "requested_deployment_ref",
    "requested_environment",
    "requested_idempotency_key",
    "requested_legal_events",
    "requested_owner_id",
  ]);
});
