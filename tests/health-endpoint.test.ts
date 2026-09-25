import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type ModuleExports = Record<string, unknown>;

function loadTypeScriptModule(path: string, mocks: Record<string, unknown> = {}) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandboxModule = { exports: {} as ModuleExports };

  runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    process: { env: {} },
    Response,
    require(id: string) {
      if (id in mocks) return mocks[id];
      if (id === "server-only") return {};
      if (id === "../package.json") return { version: "0.1.0" };
      throw new Error(`Unexpected import: ${id}`);
    },
  });

  return sandboxModule.exports;
}

test("runtime identity exposes only normalized build metadata", () => {
  const runtime = loadTypeScriptModule("lib/server-runtime.ts");
  const runtimeIdentity = runtime.runtimeIdentity as (environment: Record<string, string>) => {
    appVersion: string;
    buildSha: string | null;
    environment: string;
  };

  assert.deepEqual(
    { ...runtimeIdentity({
      APP_VERSION: "2026.09.24+canonical",
      VERCEL_GIT_COMMIT_SHA: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
      VERCEL_ENV: "preview",
      SUPABASE_SECRET_KEY: "must-never-leak",
    }) },
    {
      appVersion: "2026.09.24+canonical",
      buildSha: "abcdef0123456789abcdef0123456789abcdef01",
      environment: "preview",
    },
  );
});

test("runtime identity rejects unsafe or unknown metadata", () => {
  const runtime = loadTypeScriptModule("lib/server-runtime.ts");
  const runtimeIdentity = runtime.runtimeIdentity as (environment: Record<string, string>) => {
    appVersion: string;
    buildSha: string | null;
    environment: string;
  };

  assert.deepEqual(
    { ...runtimeIdentity({
      APP_VERSION: "<script>alert(1)</script>",
      VERCEL_GIT_COMMIT_SHA: "not-a-commit",
      VERCEL_ENV: "private-environment-name",
    }) },
    { appVersion: "0.1.0", buildSha: null, environment: "unknown" },
  );
});

test("health route is a no-store liveness response without dependency probes", async () => {
  const route = loadTypeScriptModule("app/api/health/route.ts", {
    "../../../lib/server-runtime": {
      runtimeIdentity: () => ({ appVersion: "2.6.0", buildSha: "0123456789abcdef0123456789abcdef01234567", environment: "preview" }),
    },
  });
  const response = (route.GET as () => Response)();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "the-backyard",
    version: "2.6.0",
    buildSha: "0123456789abcdef0123456789abcdef01234567",
    environment: "preview",
  });

  const source = readFileSync("app/api/health/route.ts", "utf8");
  for (const forbidden of ["SUPABASE", "service_role", "getSupabase", ".from(", "auth.admin", "fetch("]) {
    assert.ok(!source.includes(forbidden), `health route must not contain ${forbidden}`);
  }
});
