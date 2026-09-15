import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { authUserFailure } from "../lib/auth-errors";

type HttpModule = typeof import("../lib/social-http.server");
/** Execute the real HTTP adapter, substituting only network/config boundaries. No live account writes. */
function harness({ enabled = true, user = { id: "verified-account", is_anonymous: false } as { id: string; is_anonymous: boolean } | null, error = null as unknown } = {}) {
  let authCalls = 0;
  const exports: Record<string, unknown> = {};
  const source = readFileSync("lib/social-http.server.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const client = { auth: { getUser: async (token: string) => { authCalls++; assert.equal(token, "test-token"); return { data: { user }, error }; } } };
  const admin = { boundary: "admin-fixture" };
  runInNewContext(compiled, {
    exports, Response, Request, Uint8Array, TextDecoder, console: { error() {} },
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "./auth-errors") return { authUserFailure };
      if (id === "./social-preview-gate") return { socialPreviewEnabled: () => enabled };
      if (id === "./supabase/server") return { getSupabaseForUser: () => client, getSupabaseAdmin: () => admin };
      throw new Error(`Unexpected boundary: ${id}`);
    },
  });
  return { api: exports as HttpModule, authCalls: () => authCalls };
}
const request = (body?: unknown) => new Request("https://preview.invalid/api/social/activity", {
  method: body ? "POST" : "GET", headers: { authorization: "Bearer test-token", "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test("Social HTTP refuses missing/anonymous/rejected sessions before executing any operation", async () => {
  let operations = 0;
  const operation = async () => { operations++; return {}; };
  const normal = harness();
  assert.equal((await normal.api.socialHttp(new Request("https://preview.invalid"), operation)).status, 401);
  assert.equal(normal.authCalls(), 0);
  const anonymous = harness({ user: { id: "guest-account", is_anonymous: true } });
  assert.equal((await anonymous.api.socialHttp(request(), operation)).status, 401);
  const rejected = harness({ error: { status: 401 }, user: { id: "untrusted-account", is_anonymous: false } });
  assert.equal((await rejected.api.socialHttp(request(), operation)).status, 401);
  assert.equal(operations, 0);
});

test("Social HTTP isolated-DB gate fails closed without network or mutation", async () => {
  const { api, authCalls } = harness({ enabled: false });
  const response = await api.socialHttp(request(), async () => { throw new Error("must not run"); });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PENDING_CONTROLLED_DB_APPLY");
  assert.equal(authCalls(), 0);
});

test("Social HTTP ownership comes from verified session, never arbitrary body userId", async () => {
  const { api, authCalls } = harness();
  const response = await api.socialHttp(request({ userId: "another-account" }), async context => {
    assert.equal(context.userId, "verified-account");
    return { data: { owner: context.userId } };
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).data.owner, "verified-account");
  assert.equal(authCalls(), 1);
});

test("Social HTTP validates bounded JSON, identifiers and does not leak service errors", async () => {
  const { api } = harness();
  assert.equal((await api.socialBody(request({ text: "😎" }))).text, "😎");
  await assert.rejects(() => api.socialBody(request({ text: "x".repeat(9000) })));
  await assert.rejects(() => api.socialBody(new Request("https://preview.invalid", { method: "POST", body: "bad" })));
  assert.throws(() => api.socialId("another-user/../../account"));
  const response = await api.socialHttp(request(), async () => { throw new Error("private SQL/credential must not leak"); });
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("credential"), false);
});
