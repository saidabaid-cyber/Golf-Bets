import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { normalizeAdminAccess } from "../lib/admin-access";

const OWNER = "11111111-1111-4111-8111-111111111111";

function routeHarness(rows: Array<Record<string, unknown>>, options: { unauthorized?: boolean; databaseError?: boolean } = {}) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select() { return this; },
    eq(column: string, value: unknown) { filters.push([column, value]); return this; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(options.databaseError ? { data: null, error: { code: "DB_DOWN" } } : { data: rows, error: null }).then(resolve); },
  };
  const exports: Record<string, (request: Request & { nextUrl: URL }) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync("app/api/admin/access/route.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports,
    Response,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (name.endsWith("/admin-control-center")) return { ADMIN_ROLES: ["SUPER_ADMIN", "COURSE_ADMIN", "CATALOG_ADMIN", "COMPETITION_ADMIN", "SUPPORT_ADMIN", "CONTENT_ADMIN"], ADMIN_SCOPE_TYPES: ["GLOBAL", "COURSE", "COMPETITION", "CATALOG"] };
      if (name.endsWith("/http-security")) return { isCrossSiteRequest: () => false };
      if (name.endsWith("/server-auth")) return { authenticatedRequest: async () => options.unauthorized ? { ok: false, status: 401, error: "Inicia sesión.", code: "AUTH_REQUIRED" } : { ok: true, userId: OWNER, token: "jwt", client: { from: (table: string) => { assert.equal(table, "admin_memberships"); return query; } } } };
      if (name.endsWith("/server")) return { serverPhase2FeatureFlags: () => ({ admin_v1: true }) };
      throw new Error(name);
    },
  });
  async function run(queryString = "") {
    const request = new Request(`https://preview.invalid/api/admin/access${queryString}`) as Request & { nextUrl: URL };
    Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
    return exports.GET(request);
  }
  return { filters, run };
}

test("SUPER_ADMIN reads only own active membership and receives access", async () => {
  const h = routeHarness([{ role: "SUPER_ADMIN", scope_type: "GLOBAL", scope_id: null }]);
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hasAccess: true, roles: ["SUPER_ADMIN"], scopes: [{ type: "GLOBAL", id: null }] });
  assert.deepEqual(h.filters, [["user_id", OWNER], ["active", true]]);
});

test("normal user receives hasAccess false", async () => {
  const response = await routeHarness([]).run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hasAccess: false });
});

test("admin access endpoint rejects selectors for another user", async () => {
  const h = routeHarness([{ role: "SUPER_ADMIN", scope_type: "GLOBAL", scope_id: null }]);
  const response = await h.run("?userId=22222222-2222-4222-8222-222222222222");
  assert.equal(response.status, 400);
  assert.equal(h.filters.length, 0);
});

test("failed admin lookup fails closed without granting access", async () => {
  const response = await routeHarness([], { databaseError: true }).run();
  assert.equal(response.status, 503);
});

test("admin UI is role-backed, never name-backed, and /admin remains server-validated", () => {
  const more = readFileSync("app/components/more-hub.tsx", "utf8");
  const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  const route = readFileSync("app/api/admin/control-center/route.ts", "utf8");
  assert.match(more, /adminAccess\?\.hasAccess/);
  assert.match(more, /href="\/admin"/);
  assert.match(profile, /adminAccess\.roles\.includes\("SUPER_ADMIN"\)/);
  assert.doesNotMatch(`${more}\n${profile}`, /displayName.*includes\(["']admin/i);
  assert.match(route, /authenticatedRequest\(request\)/);
  assert.match(route, /from\("admin_memberships"\)[\s\S]*\.eq\("user_id", account\.userId\)/);
});

test("display names never affect normalized admin access", () => {
  assert.equal(normalizeAdminAccess({ hasAccess: false, displayName: "Said Admin" }).hasAccess, false);
  assert.equal(normalizeAdminAccess({ hasAccess: true, displayName: "Said edición", roles: ["SUPER_ADMIN"], scopes: [{ type: "GLOBAL", id: null }] }).hasAccess, true);
});
