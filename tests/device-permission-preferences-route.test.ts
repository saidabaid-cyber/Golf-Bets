import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as optional from "../lib/account-optional-authorizations";
import * as preferences from "../lib/account-device-permission-preferences";
import * as security from "../lib/backyard-ai/server/http-security";

const AT = "2026-10-01T02:00:00.000Z";
type Handler = (request: Request & { nextUrl: URL }) => Promise<Response>;

function harness(failRead = false) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const scopes = Object.fromEntries(optional.OPTIONAL_AUTHORIZATION_SCOPES.map((scope) => [scope, {
    active: true, status: "accepted", source: "settings", decidedAt: AT,
    policyVersion: optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],
  }]));
  const snapshot = () => ({
    bundleVersion: optional.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,
    resolved: false, eligible: false, receipt: null, scopes,
    profileVisibility: "public", socialPrivacy: "FRIENDS", socialProfilePrivacy: "PUBLIC",
    sharing: { enabledForFriends: true, rounds: true, achievements: true, equipment: true, courses: true },
    notifications: { internal: true, master: true, push: true, email: true, rounds: true, reminders: true },
  });
  const media: preferences.AccountDeviceMediaPreferences = {camera:null,photos:null};
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if(name === "get_optional_device_media_preferences_v1")return {data:media,error:null};
    if(name === "set_optional_device_media_preference_v1") {
      const purpose=args?.requested_scope==="CAMERA_INTERNAL"?"camera":"photos";
      media[purpose]={version:1,value:args?.requested_enabled?"enabled":"disabled",changedAt:AT};return {data:media,error:null};
    }
    if (name === "set_optional_authorization_scope_v1") {
      const scope = String(args?.requested_scope);
      scopes[scope] = { ...scopes[scope], active: Boolean(args?.requested_enabled),
        status: args?.requested_enabled ? "accepted" : "revoked" };
      // The existing writer still returns its legacy envelope. It must not
      // be mistaken for the current canonical read contract.
      return { data: { bundleVersion: "optional-features-2026-09-30-v1" }, error: null };
    }
    assert.equal(name, "get_optional_authorization_state_v2");
    assert.equal(args?.requested_environment, "preview");
    return { data: failRead ? null : snapshot(), error: failRead ? { code: "XX000" } : null };
  } };
  const exports: Record<string, Handler> = {};
  const source = ts.transpileModule(readFileSync("app/api/account/device-permission-preferences/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { exports, Response, crypto: webcrypto, TextEncoder,
    require: (id: string) => {
      if (id.endsWith("/account-optional-authorizations")) return optional;
      if (id.endsWith("/account-device-permission-preferences")) return preferences;
      if (id.endsWith("/http-security")) return security;
      if (id.endsWith("/runtime-environment")) return { resolveCanonicalDataEnvironment: () => "preview" };
      if (id.endsWith("/server-auth")) return { authenticatedRequest: async () => ({ ok: true,
        userId: "11111111-1111-4111-8111-111111111111", client }) };
      throw Error(`Unexpected import: ${id}`);
    },
  });
  const request = (method: string, body?: unknown, query = "") => {
    const r = new Request("https://dev.thebackyard.com.mx/api/account/device-permission-preferences"+query, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as Request & { nextUrl: URL };
    Object.defineProperty(r, "nextUrl", { value: new URL(r.url) });
    return r;
  };
  return { exports, request, calls };
}

test("device permission GET reads the current environment-scoped consent snapshot", async () => {
  const h = harness();
  const r = await h.exports.GET(h.request("GET"));
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.location.value, "enabled");
  assert.equal(saved.notifications.value, "enabled");
  assert.deepEqual(h.calls.map((call) => call.name), ["get_optional_authorization_state_v2"]);
});

for (const preference of ["location", "notifications"]) {
  test(`device permission ${preference} revoke confirms via v2 rather than parsing a legacy write envelope`, async () => {
    const h = harness();
    const r = await h.exports.PATCH(h.request("PATCH", { preference, version: 1, value: "disabled", changedAt: AT }));
    assert.equal(r.status, 200);
    const saved = await r.json();
    assert.equal(saved[preference].value, "disabled");
    assert.equal(saved[preference === "location" ? "notifications" : "location"].value, "enabled");
    assert.deepEqual(h.calls.map((call) => call.name), [
      "get_optional_authorization_state_v2", "set_optional_authorization_scope_v1", "get_optional_authorization_state_v2",
    ]);
    const reload = await h.exports.GET(h.request("GET"));
    assert.equal((await reload.json())[preference].value, "disabled");
  });
}

test("device permission failed canonical read stays a recoverable error, not a fabricated preference", async () => {
  const h = harness(true);
  assert.equal((await h.exports.GET(h.request("GET"))).status, 503);
  assert.equal((await h.exports.PATCH(h.request("PATCH", {
    preference: "location", version: 1, value: "disabled", changedAt: AT,
  }))).status, 503);
  assert.ok(h.calls.every((call) => call.name !== "set_optional_authorization_scope_v1"));
});

test("media extension starts undecided and never alters location/notification contracts", async () => {
  const h=harness();const response=await h.exports.GET(h.request("GET",undefined,"?media=true"));
  assert.deepEqual(await response.json(),{camera:null,photos:null});
  assert.deepEqual(h.calls.map(call=>call.name),["get_optional_device_media_preferences_v1"]);
});
for(const preference of ["camera","photos"] as const)test(`media ${preference} persists an internal decision with canonical read-back`,async()=>{
  const h=harness();const idempotencyKey="550e8400-e29b-41d4-a716-446655440000";
  const saved=await h.exports.PATCH(h.request("PATCH",{preference,enabled:true,idempotencyKey},"?media=true"));
  assert.equal(saved.status,200);assert.equal((await saved.json())[preference].value,"enabled");
  const revoked=await h.exports.PATCH(h.request("PATCH",{preference,enabled:false,idempotencyKey:"550e8400-e29b-41d4-a716-446655440001"},"?media=true"));
  assert.equal(revoked.status,200);assert.equal((await revoked.json())[preference].value,"disabled");
  assert.equal((await (await h.exports.GET(h.request("GET",undefined,"?media=true"))).json())[preference].value,"disabled");
  assert.ok(h.calls.every(call=>call.name.includes("device_media")));
});
test("media extension rejects invented scopes, grant claims, malformed IDs and extra query parameters",async()=>{
  const h=harness();
  for(const body of [{preference:"marketing",enabled:true,idempotencyKey:"550e8400-e29b-41d4-a716-446655440000"},{preference:"camera",enabled:true,idempotencyKey:"invalid"},{preference:"photos",enabled:true,idempotencyKey:"550e8400-e29b-41d4-a716-446655440000",systemPermission:"granted"}]) {
    assert.equal((await h.exports.PATCH(h.request("PATCH",body,"?media=true"))).status,400);
  }
  assert.equal((await h.exports.GET(h.request("GET",undefined,"?media=true&owner=other"))).status,400);
  assert.equal(h.calls.length,0);
});
