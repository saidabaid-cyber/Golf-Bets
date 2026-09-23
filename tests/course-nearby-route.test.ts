import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function routeHarness() {
  const origins: Array<{ latitude: number; longitude: number }> = [];
  const exports: { GET?: (request: { nextUrl: URL }) => Promise<Response> } = {};
  const source = ts.transpileModule(readFileSync("app/api/courses/search/route.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("golf-course-directory")) return { DEFAULT_COURSES: [] };
      if (name.endsWith("golf-providers")) return { internalCourseDataProvider: {
        nearbyCourses: async ({ origin }: { origin: { latitude: number; longitude: number } }) => {
          origins.push({ ...origin });
          return { ok: true, providerId: "qa-provider", data: { total: 0, matches: [] } };
        },
      } };
      if (name.endsWith("course-catalog-provider")) return {};
      if (name.endsWith("feature-flags/server")) return { serverPhase2FeatureFlags: () => ({ course_search: true }) };
      if (name.endsWith("server-auth")) return { bearerToken: () => "", authenticatedRequest: async () => ({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "auth" }) };
      throw new Error(`Unexpected route dependency: ${name}`);
    },
  });
  return { origins, request: (query: string) => exports.GET!({ nextUrl: new URL(`https://preview.example/api/courses/search?nearby=1${query}`) }) };
}

for (const query of ["", "&lat=19", "&lng=-98", "&lat=&lng=0", "&lat=0&lng=%20", "&lat=nope&lng=0", "&lat=Infinity&lng=0", "&lat=91&lng=0", "&lat=0&lng=-181"]) {
  test(`nearby route rejects absent/invalid location without consulting provider: ${query || "both absent"}`, async () => {
    const route = routeHarness();
    const response = await route.request(query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_location" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(route.origins.length, 0);
  });
}

test("nearby route preserves explicit zero and ordinary valid coordinates", async () => {
  const route = routeHarness();
  assert.equal((await route.request("&lat=0&lng=0")).status, 200);
  assert.equal((await route.request("&lat=19.04&lng=-98.20")).status, 200);
  assert.deepEqual(route.origins, [{ latitude: 0, longitude: 0 }, { latitude: 19.04, longitude: -98.20 }]);
});
