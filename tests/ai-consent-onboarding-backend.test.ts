import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as record from "../lib/backyard-ai/consent-record";
import * as privacy from "../lib/backyard-ai/privacy";
import * as security from "../lib/backyard-ai/server/http-security";
import { authUserFailure } from "../lib/auth-errors";
import { readRemoteAiConsentDecisions, saveRemoteAiConsentDecisions, RemoteAiProcessingConsentError } from "../lib/backyard-ai/consent-client";

const TEXT = privacy.AI_PROVIDER_PROCESSING_CONSENT;
const PHOTO = privacy.AI_IMAGE_PROCESSING_CONSENT;
const LAUNCH = privacy.AI_LAUNCH_MONITOR_PROCESSING_CONSENT;
const VERSION = privacy.BACKYARD_AI_PROVIDER_CONSENT_VERSION;
const OWNER = "11111111-1111-4111-8111-111111111111";
const WHEN = "2026-09-16T02:30:00.000Z";
const row = (scope = TEXT as privacy.BackyardAiProcessingConsentScope, status = "accepted" as record.AiProcessingConsentRow["decision_status"]): record.AiProcessingConsentRow => ({
  id: scope === TEXT ? 1 : scope === PHOTO ? 2 : 3, scope, policy_version: VERSION, decision_status: status,
  accepted_at: status === "declined" ? null : WHEN,
  revoked_at: status === "revoked" ? WHEN : null, source: "onboarding", decided_at: WHEN,
});

function harness(options: { rows?: record.AiProcessingConsentRow[]; blocked?: boolean; authMissing?: boolean; authError?: unknown; storeError?: boolean } = {}) {
  const rows = options.rows ?? [];
  const writes: Record<string, unknown>[] = [];
  const ownerFilters: unknown[] = [];
  const admin = {
    from: (table: string) => {
      assert.equal(table, record.AI_PROCESSING_CONSENT_TABLE);
      let scope: string | null = null;
      const result = () => ({ data: rows.filter((item) => scope === null || item.scope === scope), error: options.storeError ? { code: "DB_ERROR" } : null });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          if (key === "user_id") { ownerFilters.push(value); assert.equal(value, OWNER); }
          if (key === "scope") scope = String(value);
          if (key === "policy_version") assert.equal(value, VERSION);
          return query;
        },
        order: () => query, limit: () => query,
        maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    rpc: async (name: string, body: Record<string, unknown>) => {
      assert.equal(name, record.AI_PROCESSING_CONSENT_DECISIONS_RPC);
      writes.push(JSON.parse(JSON.stringify(body)) as Record<string, unknown>);
      return { data: rows, error: options.storeError ? { code: "DB_ERROR" } : null };
    },
  };
  const userClient = { auth: { getUser: async (token: string) => {
    assert.equal(token, "verified-owner-token");
    return { data: { user: options.authMissing ? null : { id: OWNER, is_anonymous: false } }, error: options.authError ?? null };
  } } };
  const load = (path: string) => {
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    runInNewContext(compiled, { exports, Request, Response, process: { env: {} }, console, Date,
      require: (id: string) => {
        if (id === "server-only") return {};
        if (id === "next/server") return { NextResponse: Response };
        if (id.endsWith("/consent-record")) return record;
        if (id.endsWith("/privacy")) return privacy;
        if (id.endsWith("/http-security")) return security;
        if (id.endsWith("/supabase/server")) return { getSupabaseAdmin: () => admin, getSupabaseForUser: () => userClient };
        if (id.endsWith("/auth-errors")) return { authUserFailure };
        if (id.endsWith("/account-access.server")) return { accountAccessFailure: async () => null };
        if (id.endsWith("/config")) return { aiProcessingConsentLedgerAccess: () => ({ allowed: !options.blocked }) };
        throw new Error(`Unexpected import ${id}`);
      },
    });
    return exports;
  };
  const route = load("app/api/backyard-ai/consent/route.ts");
  const verifier = load("lib/backyard-ai/server/processing-consent.ts");
  const request = (method: string, body?: unknown, suffix = "", token = "verified-owner-token") => {
    const result = new Request(`https://preview.invalid/api/backyard-ai/consent${suffix}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    Object.defineProperty(result, "nextUrl", { value: new URL(result.url) });
    return result;
  };
  return { writes, ownerFilters,
    run: async (method: string, body?: unknown, suffix = "", token?: string) => route[method](request(method, body, suffix, token)) as Promise<Response>,
    verify: async (scope = TEXT as privacy.BackyardAiProcessingConsentScope) => verifier.verifyStoredAiProcessingConsent(request("POST"), scope) as Promise<{ ok: boolean; code?: string }>,
  };
}

test("onboarding batch derives identity and version on server; missing, declined and revoked stay distinct", async () => {
  const missing = harness();
  const initial = await missing.run("GET");
  assert.equal(initial.status, 200);
  assert.match(initial.headers.get("cache-control") ?? "", /no-store/);
  const empty = await initial.json();
  assert.equal(empty.resolved, false);
  assert.deepEqual(empty.decisions.map((choice: { status: string }) => choice.status), ["missing", "missing", "missing"]);

  const fixture = harness({ rows: [row(TEXT), row(PHOTO, "declined"), row(LAUNCH, "declined")] });
  const response = await fixture.run("POST", { source: "onboarding", decisions: [{ scope: TEXT, accepted: true }, { scope: PHOTO, accepted: false }, { scope: LAUNCH, accepted: false }] });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.resolved, true);
  assert.equal(saved.decisions[0].active, true);
  assert.equal(saved.decisions[1].active, false);
  assert.equal(saved.decisions[1].status, "declined");
  assert.equal(saved.decisions[1].acceptedAt, null);
  assert.equal(fixture.writes[0].p_user_id, OWNER);
  assert.equal(fixture.writes[0].p_policy_version, VERSION);
  assert.equal(fixture.writes[0].p_source, "onboarding");
});

test("existing text/scorecard consent never grants the separate launch-monitor image purpose", async () => {
  const fixture = harness({ rows: [row(TEXT), row(PHOTO)] });
  const response = await (await fixture.run("GET")).json();
  assert.equal(response.resolved, false);
  assert.equal(response.decisions.find((choice: { scope: string }) => choice.scope === LAUNCH).status, "missing");
  assert.equal((await fixture.verify(PHOTO)).ok, true);
  assert.equal((await fixture.verify(LAUNCH)).ok, false);
  assert.equal((await harness({ rows: [row(LAUNCH)] }).verify(LAUNCH)).ok, true);
});

test("checkpoint rejects arbitrary owner, source, timestamp, duplicate scopes and non-boolean acceptance", async () => {
  const fixture = harness();
  const invalidBodies = [
    { userId: "someone-else", source: "onboarding", decisions: [{ scope: TEXT, accepted: true }] },
    { source: "settings", decisions: [{ scope: TEXT, accepted: true }] },
    { source: "onboarding", decisions: [{ scope: TEXT, accepted: true, acceptedAt: WHEN }] },
    { source: "onboarding", decisions: [{ scope: TEXT, accepted: "yes" }] },
    { source: "onboarding", decisions: [{ scope: TEXT, accepted: true }, { scope: TEXT, accepted: false }] },
    { scope: TEXT, acceptedAt: WHEN },
  ];
  for (const body of invalidBodies) assert.equal((await fixture.run("POST", body)).status, 400);
  assert.equal(fixture.writes.length, 0);
});

test("settings accepts/revokes through the same transaction and auth failure never writes", async () => {
  const fixture = harness({ rows: [row(TEXT, "revoked")] });
  const response = await fixture.run("PATCH", { scope: TEXT });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "revoked");
  assert.deepEqual(fixture.writes[0].p_decisions, [{ scope: TEXT, accepted: false }]);
  assert.equal(fixture.writes[0].p_source, "settings");
  for (const options of [{ authMissing: true }, { blocked: true }]) {
    const failure = harness(options);
    assert.ok((await failure.run("POST", { scope: TEXT })).status >= 400);
    assert.equal(failure.writes.length, 0);
  }
});

test("failed persistence fails closed; no successful consent result or provider acceptance", async () => {
  const fixture = harness({ storeError: true });
  assert.equal((await fixture.run("POST", { source: "onboarding", decisions: [{ scope: TEXT, accepted: true }] })).status, 503);
  assert.equal((await fixture.run("GET")).status, 503);
  const verification = await fixture.verify();
  assert.equal(verification.ok, false);
  assert.equal(verification.code, "consent_store_unavailable");
});

test("authenticated provider denies missing, declined and revoked records; only server acceptance authorizes", async () => {
  for (const rows of [[], [row(TEXT, "declined")], [row(TEXT, "revoked")]]) {
    const result = await harness({ rows }).verify();
    assert.equal(result.ok, false);
    assert.equal(result.code, "consent_required");
  }
  assert.equal((await harness({ rows: [row(TEXT)] }).verify()).ok, true);
});

test("new device/reload reads server choices without localStorage; batch never sends userId", async () => {
  const fixture = harness({ rows: [row(TEXT), row(PHOTO, "declined"), row(LAUNCH, "declined")] });
  const payload = await (await fixture.run("GET")).json();
  const previousFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { calls.push(init ?? {}); return Response.json(payload); };
  try {
    const initial = await readRemoteAiConsentDecisions("device-one");
    const reload = await readRemoteAiConsentDecisions("fresh-device");
    assert.deepEqual(reload, initial);
    assert.equal(reload.resolved, true);
    assert.equal(reload.decisions[1].status, "declined");
    await saveRemoteAiConsentDecisions("session-token", OWNER, [{ scope: PHOTO, accepted: false }], "account_update");
    const sent = JSON.parse(String(calls[2].body));
    assert.deepEqual(sent, { decisions: [{ scope: PHOTO, accepted: false }], source: "account_update" });
    assert.ok(calls.every((call) => call.cache === "no-store"));
  } finally { globalThis.fetch = previousFetch; }
});

test("client refuses fabricated resolved status, outdated policy and network-store failure", async () => {
  const payload = await (await harness({ rows: [row(TEXT), row(PHOTO, "declined"), row(LAUNCH, "declined")] }).run("GET")).json();
  const previousFetch = globalThis.fetch;
  try {
    for (const body of [{ ...payload, policyVersion: "outdated" }, { ...payload, resolved: false }, {
      ...payload, decisions: payload.decisions.map((choice: Record<string, unknown>) => ({ ...choice, active: true })),
    }]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(() => readRemoteAiConsentDecisions("token"), RemoteAiProcessingConsentError);
    }
    globalThis.fetch = async () => Response.json({ error: "No disponible", code: "consent_store_unavailable" }, { status: 503 });
    await assert.rejects(() => saveRemoteAiConsentDecisions("token", OWNER, [{ scope: TEXT, accepted: true }], "onboarding"), (error: unknown) => error instanceof RemoteAiProcessingConsentError && error.status === 503);
  } finally { globalThis.fetch = previousFetch; }
});
