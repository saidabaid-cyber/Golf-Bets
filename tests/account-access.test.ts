import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { isolatedPreviewDatabaseEnabled } from "../lib/preview-database";

function harness(data: unknown, error: unknown = null, env: Record<string, string> = {
  ACCOUNT_LIFECYCLE_ENABLED: "false", PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb",
  NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co", VERCEL_ENV: "preview",
}) {
  const exports: Record<string, unknown> = {}; let calls = 0;
  const compiled = ts.transpileModule(readFileSync("lib/account-access.server.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports, AbortSignal, require: (id: string) => {
    if (id === "server-only") return {};
    if (id === "./preview-database") return { isolatedPreviewDatabaseEnabled: () => isolatedPreviewDatabaseEnabled(env) };
    throw new Error(`Unexpected boundary ${id}`);
  } });
  const client = { rpc: (name: string) => { calls++; assert.equal(name, "account_access_status"); return { abortSignal: async () => ({ data, error }) }; } };
  return { run: () => (exports.accountAccessFailure as (client: unknown) => Promise<{ status: number; code: string } | null>)(client), calls: () => calls };
}
test("archived/closing/deleted remain denied with destructive feature flag OFF", async () => {
  for (const state of ["archived", "closing", "deleted"]) {
    const result = harness(state); const failure = await result.run();
    assert.equal(failure?.status, 403); assert.equal(failure?.code, "ACCOUNT_ACCESS_RESTRICTED"); assert.equal(result.calls(), 1);
  }
});
test("RPC outage is unavailable, not an assertion that the account was archived", async () => {
  const failure = await harness("active", { code: "PGRST_TIMEOUT" }).run();
  assert.equal(failure?.status, 503); assert.equal(failure?.code, "ACCOUNT_STATUS_UNAVAILABLE");
  assert.equal((await harness(null).run())?.status, 503);
});
test("active account allowed; nonisolated deployments preserve prior auth flow without RPC", async () => {
  assert.equal(await harness("active").run(), null);
  const unbound = harness("archived", null, {}); assert.equal(await unbound.run(), null); assert.equal(unbound.calls(), 0);
});
