import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { authUserFailure } from "../lib/auth-errors";

type Failure = { status: number; code: string; error: string };
type Options = { accessFailure?: Failure | null; authError?: unknown; anonymous?: boolean };
const routes = [
  { path: "app/api/equipment/route.ts", method: "account", privateExport: true },
  { path: "app/api/backyard-ai/consent/route.ts", method: "account", privateExport: true },
  { path: "app/api/polla/admin/[tournamentId]/route.ts", method: "authorize", privateExport: true },
  { path: "app/api/polla/tournaments/route.ts", method: "GET", privateExport: false },
  { path: "app/api/polla/tournaments/route.ts", method: "POST", privateExport: false },
  { path: "app/api/admin/golf-catalog/route.ts", method: "requireAdmin", privateExport: true },
  { path: "lib/backyard-ai/server/processing-consent.ts", method: "verifyStoredAiProcessingConsent", privateExport: false },
];

/** Runs real route adapters; only Auth/DB/config boundaries are replaced. A
 * privileged read or mutation before the guard fails the test immediately. */
function harness(route: typeof routes[number], options: Options = {}) {
  let accesses = 0;
  let guardCalls = 0;
  const source = readFileSync(route.path, "utf8") + (route.privateExport ? `\nexport { ${route.method} };` : "");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<Response | Failure | { response: Response }>> = {};
  const forbiddenAccess = () => { accesses++; throw new Error("Data accessed before lifecycle authorization"); };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: {
      id: "11111111-1111-4111-8111-111111111111", is_anonymous: options.anonymous === true,
    } }, error: options.authError || null }) },
    from: forbiddenAccess, rpc: forbiddenAccess,
  };
  const admin = { from: forbiddenAccess, rpc: forbiddenAccess };
  runInNewContext(compiled, {
    exports, Request, Response, process: { env: {} }, console, Date,
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "next/server") return { NextResponse: Response };
      if (id === "node:crypto") return {};
      if (id.endsWith("/supabase/server")) return { getSupabaseAdmin: () => admin, getSupabaseForUser: () => userClient };
      if (id.endsWith("/auth-errors")) return { authUserFailure };
      if (id.endsWith("/account-access.server")) return { accountAccessFailure: async (client: unknown) => {
        assert.equal(client, userClient, "must check the user JWT, never service_role's auth.uid=NULL");
        guardCalls++; return options.accessFailure ?? null;
      } };
      if (id.endsWith("/feature-flags")) return { equipmentCloudServerEnabled: true };
      if (id.endsWith("/engine")) return { playOrder: () => Array.from({ length: 18 }, (_, index) => index + 1) };
      if (id.endsWith("/golf-catalog-admin-contract")) return { parseAdminBearerToken: () => "still-valid-but-archived-jwt", hasImmutableAdminRole: () => true };
      if (id.endsWith("/backyard-ai/server/config") || id === "./config") return { aiProcessingConsentLedgerAccess: () => ({ allowed: true }) };
      if (["../privacy", "../consent-record"].includes(id)) return {};
      if (["/golf-equipment", "/social-publication.server", "/polla-live", "/backyard-ai/privacy",
        "/backyard-ai/consent-record", "/backyard-ai/server/http-security"].some(suffix => id.endsWith(suffix))) return {};
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return {
    run: () => exports[route.method](new Request("https://preview.invalid/api/qa", {
      method: "POST", headers: { authorization: "Bearer still-valid-but-archived-jwt", "content-type": "application/json" }, body: "{}",
    }), "tournament-1"),
    accesses: () => accesses,
    guardCalls: () => guardCalls,
  };
}
const statusOf = (result: Response | Failure | { response: Response }) => "response" in result ? result.response.status : result.status;

test("archived/deleting accounts cannot reach elevated Mi Bolsa, AI consent or Polla operations", async () => {
  for (const route of routes) {
    const fixture = harness(route, { accessFailure: {
      status: 403, code: "ACCOUNT_ACCESS_RESTRICTED", error: "Cuenta desactivada.",
    } });
    const result = await fixture.run();
    assert.equal(statusOf(result), 403, `${route.path}:${route.method}`);
    assert.equal(fixture.guardCalls(), 1);
    assert.equal(fixture.accesses(), 0);
  }
});

test("transient lifecycle/Auth outages stay retryable and never become false 401 logout", async () => {
  for (const route of routes) {
    const lifecycleUnavailable = harness(route, { accessFailure: {
      status: 503, code: "ACCOUNT_STATUS_UNAVAILABLE", error: "Reintenta.",
    } });
    assert.equal(statusOf(await lifecycleUnavailable.run()), 503, route.path);
    assert.equal(lifecycleUnavailable.accesses(), 0);
    const authUnavailable = harness(route, { authError: { status: 503, message: "Gateway timeout" } });
    assert.equal(statusOf(await authUnavailable.run()), 503, route.path);
    assert.equal(authUnavailable.guardCalls(), 0);
    assert.equal(authUnavailable.accesses(), 0);
  }
});

test("anonymous Auth sessions never reach private elevated operations", async () => {
  for (const route of routes) {
    const fixture = harness(route, { anonymous: true });
    assert.equal(statusOf(await fixture.run()), 401, route.path);
    assert.equal(fixture.guardCalls(), 0);
    assert.equal(fixture.accesses(), 0);
  }
});
