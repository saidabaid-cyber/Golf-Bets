import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as contract from "../lib/account-notification-preferences";
import * as security from "../lib/backyard-ai/server/http-security";

function loadRoute(options: { row?: Record<string, unknown> | null; auth?: boolean; schemaError?: boolean; mutationError?: boolean } = {}) {
  const row = options.row ?? null;
  const ownerFilters: string[] = [];
  const rpcCalls: Array<{ name: string; body?: Record<string, unknown> }> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => { if (column === "user_id") ownerFilters.push(value); return query; },
    abortSignal: () => query,
    maybeSingle: async () => ({ data: row, error: options.schemaError ? { code: "42703" } : null }),
  };
  const client = {
    rpc: (name: string, body?: Record<string, unknown>) => {
      rpcCalls.push({ name, ...(body ? { body } : {}) });
      const saved = body ? {
        push_notifications_enabled: body.requested_push,
        email_notifications_enabled: body.requested_email,
        round_notifications_enabled: body.requested_rounds,
        reminders_enabled: body.requested_reminders,
        updated_at: "2026-09-30T12:00:00.000Z",
      } : null;
      return { abortSignal: async () => ({ data: saved, error: options.mutationError ? { code: "MUTATION_FAILED" } : null }) };
    },
    from: (table: string) => {
      assert.equal(table, "user_preferences");
      return query;
    },
  };
  const source = ts.transpileModule(readFileSync("app/api/account/notification-preferences/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(source, {
    exports, Request, Response, AbortSignal, Date,
    require: (id: string) => {
      if (id === "next/server") return { NextResponse: Response };
      if (id.endsWith("/server-auth")) return { authenticatedRequest: async () => options.auth === false ? { ok: false, status: 401, error: "auth" } : { ok: true, userId: "verified-owner", client } };
      if (id.endsWith("/account-notification-preferences")) return contract;
      if (id.endsWith("/push-provider")) return { unavailablePushProvider: { configured: false } };
      if (id.endsWith("/http-security")) return security;
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const request = (method: string, body?: unknown, origin?: string) => new Request("https://preview.invalid/api/account/notification-preferences", {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { exports, ownerFilters, rpcCalls, request };
}

test("notification preferences API treats a missing legacy row as uninitialized OFF without fabricating delivery", async () => {
  const fixture = loadRoute();
  const response = await fixture.exports.GET(fixture.request("GET"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const body = await response.json();
  assert.deepEqual(JSON.parse(JSON.stringify(body.preferences)), {
    push: false, email: false, rounds: false, reminders: false, updatedAt: null,
  });
  assert.equal(body.initialized, false);
  assert.deepEqual(JSON.parse(JSON.stringify(body.delivery)), {
    push: { configured: false, state: "not_configured" },
    email: { configured: false, state: "not_configured" },
  });
  assert.deepEqual(fixture.ownerFilters, ["verified-owner"]);
});

test("notification preferences API returns the explicit ON row created for a new account", async () => {
  const fixture = loadRoute({ row: {
    push_notifications_enabled: true,
    email_notifications_enabled: true,
    round_notifications_enabled: true,
    reminders_enabled: true,
    updated_at: "2026-09-28T00:00:00.000Z",
  } });
  const response = await fixture.exports.GET(fixture.request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.initialized, true);
  assert.deepEqual(JSON.parse(JSON.stringify(body.preferences)), {
    push: true, email: true, rounds: true, reminders: true, updatedAt: "2026-09-28T00:00:00.000Z",
  });
});

test("notification preferences API persists exact owner choices and rejects forged/partial bodies", async () => {
  const fixture = loadRoute();
  const selected = { push: false, email: true, rounds: false, reminders: true };
  const saved = await fixture.exports.PUT(fixture.request("PUT", selected));
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.initialized, true);
  assert.deepEqual(savedBody.preferences, { ...selected, updatedAt: "2026-09-30T12:00:00.000Z" });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.rpcCalls)), [{
    name: "set_my_notification_preferences_v1",
    body: {
      requested_push: false,
      requested_email: true,
      requested_rounds: false,
      requested_reminders: true,
    },
  }]);
  for (const bad of [{ ...selected, userId: "victim" }, { push: true }]) {
    assert.equal((await fixture.exports.PUT(fixture.request("PUT", bad))).status, 400);
  }
  assert.equal((await fixture.exports.PUT(fixture.request("PUT", selected, "https://evil.invalid"))).status, 403);
  assert.equal(fixture.rpcCalls.length, 1);
});

test("notification preferences use one atomic RPC and fail closed without a second write", async () => {
  const fixture = loadRoute({ mutationError: true });
  const selected = { push: true, email: true, rounds: true, reminders: true };
  const response = await fixture.exports.PUT(fixture.request("PUT", selected));
  assert.equal(response.status, 503);
  assert.deepEqual(fixture.rpcCalls.map((call) => call.name), ["set_my_notification_preferences_v1"]);
});

test("notification preferences API fails closed when auth or the controlled migration is missing", async () => {
  const unauthenticated = loadRoute({ auth: false });
  assert.equal((await unauthenticated.exports.GET(unauthenticated.request("GET"))).status, 401);
  const schemaPending = loadRoute({ schemaError: true });
  assert.equal((await schemaPending.exports.GET(schemaPending.request("GET"))).status, 503);
});
