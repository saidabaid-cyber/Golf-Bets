import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { haversineDistanceKm } from "../lib/course-distance";
import { distinctNearbyClubCards } from "../lib/course-nearby-clubs";

const qaOrigin = { latitude: 19.008297, longitude: -98.254634 };
const qaCards = [
  { id: "course-la-vista", courseId: "course-la-vista", clubId: "club-la-vista", name: "LA VISTA COUNTRY CLUB", clubName: "LA VISTA COUNTRY CLUB", city: "San Andrés Cholula", latitude: 19.008297, longitude: -98.254634 },
  { id: "course-la-vista-temporal", courseId: "course-la-vista-temporal", clubId: "club-la-vista", name: "LA VISTA TEMPORAL", clubName: "LA VISTA COUNTRY CLUB", city: "San Andrés Cholula", latitude: 19.008297, longitude: -98.254634 },
  { id: "course-campestre-puebla", courseId: "course-campestre-puebla", clubId: "club-campestre-puebla", name: "PUEBLA", clubName: "CLUB CAMPESTRE DE PUEBLA", city: "Puebla", latitude: 19.0131, longitude: -98.2345 },
  { id: "review-course-24458", courseId: "review-course-24458", clubId: "review-club-75f6ac3a0e37a69eabd3", name: "LAS FUENTES", clubName: "CLUB DE GOLF LAS FUENTES", city: "Puebla", latitude: 19.08806, longitude: -98.23316 },
  { id: "review-course-23231", courseId: "review-course-23231", clubId: "review-club-9c0700f229794a278011", name: "CLUB DE GOLF LA HUERTA", clubName: "CLUB DE GOLF LA HUERTA", city: "San Pedro Cholula", latitude: 19.05946, longitude: -98.3307 },
  { id: "course-cola-de-lagarto", courseId: "course-cola-de-lagarto", clubId: "club-cola-de-lagarto", name: "COLA DE LAGARTO", clubName: "COLA DE LAGARTO CAMPO MÍTICO", city: "Atlixco", latitude: 18.8693355, longitude: -98.3806388 },
  { id: "course-el-cristo", courseId: "course-el-cristo", clubId: "club-el-cristo", name: "CLUB CAMPESTRE EL CRISTO", clubName: "CLUB CAMPESTRE EL CRISTO", city: "Atlixco", latitude: 18.882, longitude: -98.426 },
  { id: "review-course-23167", courseId: "review-course-23167", clubId: "review-club-d146fe8e70001cc350c2", name: "VISTA VERDE", clubName: "VISTA VERDE COUNTRY CLUB", city: "Tehuacán", latitude: 18.487452, longitude: -97.403514 },
].map((card) => ({ ...card, aliases: [], localIndexTeeAvailable: false, tee: { id: `${card.id}:tee`, name: "Tee por seleccionar", localIndexRated: false } }));

type HarnessOptions = { authFailure?: boolean; catalogFailure?: boolean };
type CourseSearchInput = { query: string; limit: number; latitude?: number; longitude?: number; requireQaReviewedCatalog?: boolean };

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

function routeHarness(options: HarnessOptions = {}) {
  const catalogCalls: Array<{ input: CourseSearchInput; database: unknown }> = [];
  const authClient = { scope: "authenticated-qa-player" };
  const exports: { GET?: (request: { nextUrl: URL; headers: Headers }) => Promise<Response> } = {};
  const source = ts.transpileModule(readFileSync("app/api/courses/search/route.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("golf-course-directory")) return { DEFAULT_COURSES: [] };
      if (name.endsWith("golf-providers")) return { internalCourseDataProvider: { searchCourses: async () => ({ ok: true, providerId: "fallback", data: { courses: [], total: 0 } }) } };
      if (name.endsWith("course-catalog-provider.server")) return { searchCourseCards: async (input: CourseSearchInput, database: unknown) => {
        catalogCalls.push({ input: { ...input }, database });
        if (options.catalogFailure) throw Error("private catalog unavailable");
        const tokens = normalized(input.query).split(/\s+/).filter(Boolean);
        const matching = qaCards.filter((card) => tokens.every((token) => normalized(`${card.clubName} ${card.name}`).includes(token)));
        const cards = matching.map((card) => ({
          card,
          distanceKm: input.latitude === undefined || input.longitude === undefined
            ? null
            : haversineDistanceKm({ latitude: input.latitude, longitude: input.longitude }, { latitude: card.latitude, longitude: card.longitude }),
        })).sort((left, right) => (left.distanceKm ?? Number.MAX_VALUE) - (right.distanceKm ?? Number.MAX_VALUE));
        return { cards, total: cards.length, hasMore: false, nextCursor: null, provider: database ? "admin-published+reviewed-seed" : "backyard-course-catalog" };
      } };
      if (name.endsWith("course-catalog-provider")) return {};
      if (name.endsWith("course-nearby-clubs")) return { distinctNearbyClubCards };
      if (name.endsWith("feature-flags/server")) return { serverPhase2FeatureFlags: () => ({ course_search: true }) };
      if (name.endsWith("server-auth")) return {
        bearerToken: (request: { headers: Headers }) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "",
        authenticatedRequest: async () => options.authFailure
          ? { ok: false, status: 401, code: "AUTH_INVALID", error: "invalid_session" }
          : { ok: true, client: authClient, userId: "synthetic-qa-owner" },
      };
      throw new Error(`Unexpected route dependency: ${name}`);
    },
  });
  return {
    authClient,
    catalogCalls,
    request: (query: string, bearer?: string) => exports.GET!({
      nextUrl: new URL(`https://preview.example/api/courses/search${query}`),
      headers: new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    }),
  };
}

for (const query of ["", "&lat=19", "&lng=-98", "&lat=&lng=0", "&lat=0&lng=%20", "&lat=nope&lng=0", "&lat=Infinity&lng=0", "&lat=91&lng=0", "&lat=0&lng=-181"]) {
  test(`authenticated nearby route rejects absent/invalid location without consulting provider: ${query || "both absent"}`, async () => {
    const route = routeHarness();
    const response = await route.request(`?nearby=1${query}`, "valid-qa-token");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_location" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(route.catalogCalls.length, 0);
  });
}

test("public name search keeps Cristo and lagarto available without exposing the private reviewed catalog", async () => {
  const route = routeHarness();
  for (const [query, expectedId] of [["Cristo", "course-el-cristo"], ["lagarto", "course-cola-de-lagarto"]] as const) {
    const response = await route.request(`?q=${query}`);
    assert.equal(response.status, 200);
    const body = await response.json() as { total: number; courses: Array<{ courseId: string }> };
    assert.equal(body.total, 1);
    assert.deepEqual(body.courses.map((course) => course.courseId), [expectedId]);
    assert.equal(route.catalogCalls.at(-1)?.database, null);
  }
});

test("nearby without bearer is an explicit 401 and never reads the private QA projection", async () => {
  const route = routeHarness();
  const response = await route.request(`?nearby=1&lat=${qaOrigin.latitude}&lng=${qaOrigin.longitude}`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required", code: "AUTH_REQUIRED" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(route.catalogCalls.length, 0);
});

test("nearby rejects an invalid bearer before consulting the catalog", async () => {
  const route = routeHarness({ authFailure: true });
  const response = await route.request(`?nearby=1&lat=${qaOrigin.latitude}&lng=${qaOrigin.longitude}`, "invalid-token");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_session", code: "AUTH_INVALID" });
  assert.equal(route.catalogCalls.length, 0);
});

test("authenticated nearby returns the first three canonical QA clubs and exposes a stable next page", async () => {
  const route = routeHarness();
  const response = await route.request(`?nearby=1&lat=${qaOrigin.latitude}&lng=${qaOrigin.longitude}&limit=3`, "valid-qa-token");
  assert.equal(response.status, 200);
  const body = await response.json() as { provider: string; total: number; hasMore: boolean; nextCursor: string | null; courses: Array<{ clubId: string; distanceKm: number }> };
  assert.equal(body.provider, "admin-published+reviewed-seed");
  assert.equal(body.total, 6);
  assert.deepEqual(body.courses.map((course) => course.clubId), [
    "club-la-vista",
    "club-campestre-puebla",
    "review-club-75f6ac3a0e37a69eabd3",
  ]);
  assert.equal(body.hasMore, true);
  assert.equal(body.nextCursor, "3");
  assert.equal(new Set(body.courses.map((course) => course.clubId)).size, 3);
  assert.ok(body.courses.every((course, index) => course.distanceKm <= 50 && (index === 0 || body.courses[index - 1].distanceKm <= course.distanceKm)));
  assert.equal(route.catalogCalls.length, 1);
  assert.equal(route.catalogCalls[0].database, route.authClient);
  assert.equal(route.catalogCalls[0].input.requireQaReviewedCatalog, true);
  assert.equal(route.catalogCalls[0].input.limit, 10_000);
});

test("authenticated nearby reports catalog unavailability instead of a false empty success", async () => {
  const route = routeHarness({ catalogFailure: true });
  const response = await route.request(`?nearby=1&lat=${qaOrigin.latitude}&lng=${qaOrigin.longitude}`, "valid-qa-token");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "course_catalog_unavailable", code: "COURSE_CATALOG_UNAVAILABLE" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
