import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import { isGpsPilotTester } from "../lib/gps-pilot-la-vista-1/access";
import { isCrossSiteRequest } from "../lib/backyard-ai/server/http-security";

test("GPS provisional pilot: all 25 portable geodesic/location regressions", () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "scripts/gps-la-vista-pilot.test.mjs"], { cwd: process.cwd(), encoding: "utf8", env });
  assert.match(output, /(?:#|ℹ) tests 25/); assert.match(output, /(?:#|ℹ) fail 0/);
});

const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ pilotHostEnabled: (config: Record<string, unknown>) => boolean }>;
const pilot = nativeImport(pathToFileURL(resolve("lib/gps-pilot-la-vista-1/pilot.mjs")).href);
const target = JSON.parse(readFileSync("lib/gps-pilot-la-vista-1/target.json", "utf8"));
const routeSource = readFileSync("app/api/gps-pilot/la-vista-1/route.ts", "utf8");
const routeJs = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const tester = "11111111-1111-4111-8111-111111111111", outsider = "22222222-2222-4222-8222-222222222222";
type Access = { ok: boolean; userId?: string; status?: number; error?: string; code?: string };
const denied = { ok: false, status: 403, code: "ADMIN_PERMISSION_DENIED", error: "Sin permiso." };

async function route(account: Access = { ok: true, userId: outsider }, admin: Access = denied, overrides: Record<string, string> = {}) {
  let calls = 0, adminCalls = 0;
  const exports: any = {}; const modules = await pilot;
  runInNewContext(routeJs, { exports, process: { env: {
    GPS_LA_VISTA_1_PILOT_ENABLED: "true", GPS_LA_VISTA_1_PILOT_USER_IDS: tester,
    VERCEL_GIT_COMMIT_REF: "integration/backyard-current", VERCEL_ENV: "preview", ...overrides,
  } }, require(specifier: string) {
    if (specifier === "next/server") return { NextResponse: { json: (body: unknown, options: unknown) => ({ body, ...options as object }) } };
    if (specifier.endsWith("admin-mode.server")) return { requireAdminMode: async (_request: unknown, module: string) => { assert.equal(module, "courses"); adminCalls++; return admin; } };
    if (specifier.endsWith("server-auth")) return { authenticatedRequest: async () => { calls++; return account; } };
    if (specifier.endsWith("http-security")) return { isCrossSiteRequest };
    if (specifier.endsWith("/access")) return { isGpsPilotTester };
    if (specifier.endsWith("pilot.mjs")) return modules;
    if (specifier.endsWith("target.json")) return target;
    throw new Error("Unexpected route dependency");
  } });
  return { handler: exports.GET as (request: unknown) => Promise<any>, calls: () => calls, adminCalls: () => adminCalls };
}
const request = (host = "dev.thebackyard.com.mx", extra: Record<string, string> = {}) => ({ url: `https://${host}/api/gps-pilot/la-vista-1`, headers: new Headers({ host, ...extra }) });

test("GPS route defaults off before reading any session or membership", async () => {
  const r = await route(undefined, undefined, { GPS_LA_VISTA_1_PILOT_ENABLED: "" });
  assert.equal((await r.handler(request())).status, 404); assert.equal(r.calls(), 0);
});
test("GPS route denies main, Production, beta and independent Preview before auth", async () => {
  for (const [env, host] of [[{ VERCEL_ENV: "production" }, "dev.thebackyard.com.mx"], [{ VERCEL_GIT_COMMIT_REF: "main" }, "dev.thebackyard.com.mx"], [{}, "app.thebackyard.com.mx"], [{}, "beta.thebackyard.com.mx"], [{}, "anything.vercel.app"]] as const) {
    const r = await route(undefined, undefined, env); assert.equal((await r.handler(request(host))).status, 404); assert.equal(r.calls(), 0);
  }
});
test("GPS route anonymous access returns 401 without target even with tester configured", async () => {
  const r = await route({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "Inicia sesión." });
  const response = await r.handler(request()); assert.equal(response.status, 401); assert.equal(response.body.target, undefined);
  assert.equal(r.adminCalls(), 0);
});
test("GPS route authenticated non-tester/non-admin returns 403 without target", async () => {
  const r = await route(); const response = await r.handler(request());
  assert.equal(response.status, 403); assert.equal(response.body.target, undefined);
});
test("GPS route preserves existing server-confirmed course-admin access", async () => {
  const r = await route(undefined, { ok: true }); const response = await r.handler(request());
  assert.equal(response.status, 200); assert.equal(response.body.target.candidate, true);
  assert.equal(response.body.target.fieldVerifiedAt, null); assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(r.calls(), 1); assert.equal(r.adminCalls(), 1);
});
test("GPS tester opens pilot without obtaining or querying admin membership", async () => {
  const r = await route({ ok: true, userId: tester }); const response = await r.handler(request());
  assert.equal(response.status, 200); assert.equal(response.body.target.isFlag, false);
  assert.equal(r.calls(), 1); assert.equal(r.adminCalls(), 0);
});
test("GPS tester permission still requires authenticated lifecycle to succeed", async () => {
  const r = await route({ ok: false, status: 403, userId: tester, error: "Cuenta desactivada.", code: "ACCOUNT_DEACTIVATED" });
  const response = await r.handler(request()); assert.equal(response.status, 403);
  assert.equal(response.body.target, undefined); assert.equal(r.adminCalls(), 0);
});
test("GPS target permission cannot be forged with an email, metadata or query ID", async () => {
  const r = await route(); const req = { ...request(), url: request().url + `?userId=${tester}&role=ADMIN` };
  assert.equal((await r.handler(req)).status, 403);
});
test("GPS route refuses cross-site requests before checking tester permission", async () => {
  for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://other.example" }] as Array<Record<string, string>>) {
    const r = await route({ ok: true, userId: tester }); const response = await r.handler(request(undefined, headers));
    assert.equal(response.status, 403); assert.equal(r.calls(), 0);
  }
});
test("GPS unavailable membership service stays 503 rather than a false denial", async () => {
  const r = await route(undefined, { ok: false, status: 503, error: "No pudimos confirmar permisos.", code: "ADMIN_ACCESS_UNAVAILABLE" });
  assert.equal((await r.handler(request())).status, 503);
});
test("GPS tester IDs fail closed for empty or malformed configuration", () => {
  for (const config of [undefined, "", "email@example.com", `${tester},oops`, "*"]) assert.equal(isGpsPilotTester(tester, config), false);
  assert.equal(isGpsPilotTester(tester, ` ${tester.toUpperCase()} `), true);
  assert.equal(isGpsPilotTester(outsider, tester), false);
});
test("GPS route has no write handler or database mutation capability", () => {
  assert.equal(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)|\.insert\(|\.update\(|\.delete\(/.test(routeSource), false);
});
