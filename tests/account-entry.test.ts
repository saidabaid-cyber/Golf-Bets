import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as entry from "../lib/account-entry";
import * as checkpoint from '../lib/onboarding-checkpoint';
import * as security from "../lib/backyard-ai/server/http-security";
import { ensureCloudProfile } from "../lib/cloud-account";

const OWNER = "11111111-1111-4111-8111-111111111111";
function routeHarness(options: { completed?: boolean; legal?: string[]; noProfile?: boolean; error?: boolean; unauthorized?: boolean; archived?: boolean; authThrows?: boolean; authNever?: boolean } = {}) {
  const filters: [string, string, string][] = []; let writes = 0;
  const client = { from: (table: string) => {
    const result = () => ({ data: table === "profiles" ? options.noProfile ? null : { id: OWNER, onboarding_completed_at: options.completed ? "2026-09-01T00:00:00Z" : null } : (options.legal || []).map(type => ({ type })), error: options.error ? { code: "FAIL" } : null });
    const query = { select: () => query, eq: (column: string, value: string) => { filters.push([table, column, value]); return query; }, in: () => query, abortSignal: () => query,
      maybeSingle: async () => result(), then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      insert: () => { writes++; throw new Error("unexpected write"); }, upsert: () => { writes++; throw new Error("unexpected write"); },
    }; return query;
  } };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync("app/api/account/entry/route.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(source, { exports, URL, AbortSignal, setTimeout: (callback: () => void, delay: number) => setTimeout(callback, options.authNever ? 1 : delay), clearTimeout, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/account-entry")) return entry;
    if (name.endsWith('/onboarding-checkpoint')) return checkpoint;
    if (name.endsWith("/http-security")) return security;
    if (name.endsWith("/server-auth")) return { authenticatedRequest: async (request: Request) => {
      if (options.authThrows) throw new Error("internal auth service details");
      if (options.authNever) return new Promise<never>(() => {});
      if (options.unauthorized || !request.headers.get("authorization")) return { ok: false, status: 401, error: "Auth required" };
      if (options.archived) return { ok: false, status: 403, error: "Archived" };
      return { ok: true, userId: OWNER, client };
    } };
    throw new Error(name);
  } });
  return { filters, writes: () => writes, run: (query = "", crossSite = false) => exports.GET(new Request(`https://qa.invalid/api/account/entry${query}`, { headers: { authorization: "Bearer valid-session", ...(crossSite ? { "sec-fetch-site": "cross-site" } : {}) } })) };
}

test("Auth trigger skeletal row is new, never sufficient to skip onboarding", async () => {
  const h = routeHarness(); const response = await h.run();
  assert.equal(response.status, 200); assert.equal((await response.json()).existingAccount, false); assert.equal(h.writes(), 0);
});
for (const provider of ["Google", "email OTP"]) test(`${provider}: verified existing UUID maps to one existing Backyard profile`, async () => {
  const h = routeHarness({ completed: true }); const response = await h.run();
  assert.deepEqual(await response.json(), { userId: OWNER, profileExists: true, existingAccount: true, onboardingProgress: null });
  assert.deepEqual(h.filters, [["profiles", "id", OWNER], ["legal_acceptances", "user_id", OWNER]]);
  assert.equal(h.writes(), 0); assert.match(response.headers.get("cache-control") || "", /no-store/);
});
test("older explicitly registered account remains existing without new completion column value", async () => {
  const h = routeHarness({ legal: ["terms", "privacy"] }); assert.equal((await (await h.run()).json()).existingAccount, true);
  const incomplete = routeHarness({ legal: ["terms"] }); assert.equal((await (await incomplete.run()).json()).existingAccount, false);
});
test("no profile mapping remains new and lookup never creates any row", async () => {
  const h = routeHarness({ noProfile: true }); assert.deepEqual(await (await h.run()).json(), { userId: OWNER, profileExists: false, existingAccount: false, onboardingProgress: null }); assert.equal(h.writes(), 0);
});
test("mapping failures fail closed instead of interpreting an unavailable account as new", async () => {
  const response = await routeHarness({ error: true }).run(); assert.equal(response.status, 503);
  assert.equal((await response.json()).existingAccount, undefined);
});

test("Auth network failure and timeout return retryable mapping failure, never new-account permission", async () => {
  for (const options of [{ authThrows: true }, { authNever: true }]) {
    const h = routeHarness(options); const response = await h.run();
    assert.equal(response.status, 503); const body = await response.json();
    assert.equal(body.code, "ACCOUNT_MAPPING_UNAVAILABLE");
    assert.equal(body.existingAccount, undefined); assert.equal(h.filters.length, 0);
    assert.doesNotMatch(JSON.stringify(body), /internal auth/);
  }
});
test("mapping denies unauthenticated and archived identities before profile reads", async () => {
  for (const options of [{ unauthorized: true }, { archived: true }]) {
    const h = routeHarness(options); assert.equal((await h.run()).status, options.unauthorized ? 401 : 403); assert.equal(h.filters.length, 0);
  }
});
test("mapping cannot enumerate emails or inspect another user even with a valid session", async () => {
  for (const query of ["?email=victim%40example.com", "?userId=other", "?id=other"]) { const h = routeHarness(); assert.equal((await h.run(query)).status, 400); assert.equal(h.filters.length, 0); }
  assert.equal((await routeHarness().run("", true)).status, 403);
});
test("client refuses a mapping from another identity and sends no email or client identity selector", async () => {
  const original = globalThis.fetch; const requests: string[] = [];
  try {
    globalThis.fetch = async (input, init) => { requests.push(String(input)); assert.equal(init?.cache, "no-store"); return Response.json({ userId: "other", profileExists: true, existingAccount: true }); };
    await assert.rejects(entry.readAccountEntry("token", OWNER), /verificar/); assert.deepEqual(requests, ["/api/account/entry"]);
    globalThis.fetch = async () => Response.json({ userId: OWNER, profileExists: true, existingAccount: true });
    assert.equal((await entry.readAccountEntry("token", OWNER)).existingAccount, true);
    globalThis.fetch = async () => Response.json({ error: "private database details" }, { status: 503 });
    await assert.rejects(entry.readAccountEntry("token", OWNER), error => error instanceof Error && !error.message.includes("private"));
  } finally { globalThis.fetch = original; }
});
test("create/login intent is consumed once and is not persistent consent or account proof", () => {
  const values = new Map<string, string>(); const storage = { setItem: (key: string, value: string) => { values.set(key, value); }, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
  entry.rememberAccountEntryIntent(storage, "create"); assert.equal(entry.consumeAccountEntryIntent(storage), "create"); assert.equal(entry.consumeAccountEntryIntent(storage), null);
  entry.rememberAccountEntryIntent(storage, "login"); assert.equal(entry.consumeAccountEntryIntent(storage), "login");
});
test("existing canonical profile is not overwritten with blank new-device fallback", async () => {
  let inserts = 0; const existing = { display_name: "Existing Golfer", avatar_url: "emoji:😎", default_handicap: null, onboarding_completed_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: existing, error: null }), insert: () => { inserts++; return query; } };
  const client = { from: () => query } as unknown as Parameters<typeof ensureCloudProfile>[0];
  assert.equal(await ensureCloudProfile(client, OWNER, { displayName: "", defaultHandicap: null, avatarUrl: "" }), existing); assert.equal(inserts, 0);
});

test("provider places mapping before cloud writes and creation UI, retains consent checkpoint", () => {
  const source = readFileSync("app/components/account-provider.tsx", "utf8");
  const hydration = source.indexOf('if (accountEntry?.userId !== authenticatedUserId) return;');
  assert.ok(hydration > 0 && hydration < source.indexOf("const pendingProfileAttempt"));
  assert.ok(source.indexOf("if (identity.mode === \"authenticated\" && identity.accessToken && accountEntry?.userId !== identity.userId)") < source.indexOf("<ProfileSetupScreen identity="));
  assert.match(source, /readCurrentAccountEntry\(authenticatedAccessToken, authenticatedUserId, \(\) => activeUserId.current, controller.signal\)/);
  assert.match(source, /setProfileSetupRequired\(!accountEntry.existingAccount && !cloudProfile.onboarding_completed_at\)/);
  assert.match(source, /const mapping = await readAccountEntry\(identity.accessToken \|\| "", identity.userId\)/);
  assert.match(source, /Ya tienes una cuenta\. Vamos a iniciar sesión\./);
  assert.doesNotMatch(source, /if \(identity\.mode === "authenticated" && existingAccountNotice\) return/);
  assert.match(source, /Verifica tu correo para continuar; si ya tienes cuenta, entraremos a ella\./);
  assert.match(source, /return identity.mode === "authenticated" \? <AccountConsentCheckpoint/);
});

test("late mapping after logout, account switch, or effect cancellation cannot reopen creation or account UI", async () => {
  const original = globalThis.fetch;
  try {
    for (const transition of ["logout", "switch", "abort", "same"] as const) {
      let finish!: (value: Response) => void;
      globalThis.fetch = async () => new Promise<Response>(resolve => { finish = resolve; });
      let current: string | null = OWNER; const controller = new AbortController();
      const pending = entry.readCurrentAccountEntry("token", OWNER, () => current, controller.signal);
      if (transition === "logout") current = null;
      if (transition === "switch") current = "another-user";
      if (transition === "abort") controller.abort();
      finish(Response.json({ userId: OWNER, profileExists: true, existingAccount: true }));
      const result = await pending;
      assert.equal(result?.existingAccount ?? null, transition === "same" ? true : null);
    }
  } finally { globalThis.fetch = original; }
});
