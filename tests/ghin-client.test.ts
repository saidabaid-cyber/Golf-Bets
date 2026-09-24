import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type GhinClientModule = typeof import("../lib/ghin/client");

const moduleLoader = Module as unknown as {
  _load(request: string, parent: NodeModule | null, isMain: boolean): unknown;
};
const originalModuleLoad = moduleLoader._load;
let serverOnlyBoundaryLoaded = false;
moduleLoader._load = (request, parent, isMain) => {
  if (request === "server-only") {
    serverOnlyBoundaryLoaded = true;
    return {};
  }
  return originalModuleLoad.call(moduleLoader, request, parent, isMain);
};
let clientModule: GhinClientModule;
try {
  clientModule = moduleLoader._load("../lib/ghin/client", module, false) as GhinClientModule;
} finally {
  moduleLoader._load = originalModuleLoad;
}
const { GhinClientError, GhinReadOnlyClient } = clientModule;

const credentials = {
  login: "11103349",
  password: "unit-test-password",
  loginBootstrapToken: "bootstrap-test",
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("autentica, deduplica consultas concurrentes y nunca deja secretos en el trace", async () => {
  let loginCalls = 0;
  let golferCalls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/golfer_login.json")) {
      loginCalls += 1;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        user: { email_or_ghin: credentials.login, password: credentials.password, remember_me: "true" },
        token: credentials.loginBootstrapToken,
      });
      return jsonResponse(200, { golfer_user_token: "provider-secret-token", expires_in: 3_600 });
    }
    if (url.pathname.endsWith("/golfers/search.json")) {
      golferCalls += 1;
      assert.equal(init?.headers && new Headers(init.headers).get("authorization"), "Bearer provider-secret-token");
      assert.equal(init?.headers && new Headers(init.headers).get("source"), "GHINcom");
      assert.equal(url.searchParams.get("golfer_id"), "11103349");
      return jsonResponse(200, {
        golfers: [{
          ghin: "11103349",
          first_name: "Said",
          last_name: "Abaid Taja",
          club_name: "La Vista Country Club",
          handicap_index: "7.2",
          status: "Active",
        }],
      });
    }
    throw new Error(`Unexpected test endpoint: ${url.pathname}`);
  };
  const client = new GhinReadOnlyClient({
    baseUrl: "https://api.ghin.com/api/v1",
    credentials,
    fetchImpl,
  });

  const [first, second] = await Promise.all([
    client.lookupGolfer("11103349"),
    client.lookupGolfer("11103349"),
  ]);
  const third = await client.lookupGolfer("11103349");

  assert.equal(first.data.name, "Said Abaid Taja");
  assert.equal(first.data.handicapIndex, 7.2);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(loginCalls, 1);
  assert.equal(golferCalls, 1);
  const serializedTrace = JSON.stringify(client.getTrace());
  assert.doesNotMatch(serializedTrace, /provider-secret-token|unit-test-password|11103349/i);
  assert.doesNotMatch(JSON.stringify(client), /provider-secret-token|unit-test-password|bootstrap-test|11103349/i);
  assert.deepEqual(client.getTrace().map((entry) => entry.endpoint), [
    "/golfer_login.json",
    "/golfers/search.json",
  ]);
});

test("el transporte queda fuera del grafo cliente", () => {
  assert.equal(serverOnlyBoundaryLoaded, true);
});

test("un 401 invalida sesión, autentica una sola vez más y reintenta exactamente una vez", async () => {
  let loginCalls = 0;
  let golferCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/golfer_login.json")) {
      loginCalls += 1;
      return jsonResponse(200, { access_token: `token-${loginCalls}`, expires_in: 3_600 });
    }
    golferCalls += 1;
    if (golferCalls === 1) return jsonResponse(401, { error: "Invalid token" });
    return jsonResponse(200, { golfers: [{ ghin_number: "11103349", handicap_index: "+1.4" }] });
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  const result = await client.lookupGolfer("11103349");

  assert.equal(result.data.handicapIndex, -1.4);
  assert.equal(loginCalls, 2);
  assert.equal(golferCalls, 2);
  assert.equal(client.getTrace().filter((entry) => entry.endpoint.endsWith("/golfers/search.json")).length, 2);
});

test("credenciales rechazadas producen sólo un error normalizado y sin cuerpo remoto", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(400, {
    error: `Incorrect Credentials for ${credentials.login}: ${credentials.password}`,
  });
  const client = new GhinReadOnlyClient({ baseUrl: "https://api.ghin.com/api/v1", credentials, fetchImpl });

  await assert.rejects(
    client.authenticate(),
    (error: unknown) => {
      assert.ok(error instanceof GhinClientError);
      assert.equal(error.code, "invalid_credentials");
      assert.equal(error.httpStatus, 400);
      assert.doesNotMatch(error.message, /11103349|unit-test-password|Incorrect Credentials/i);
      return true;
    },
  );
});

test("rechaza tokens ya vencidos y respuestas de token malformadas", async () => {
  const expired = new GhinReadOnlyClient({
    baseUrl: "https://api.ghin.com/api/v1",
    credentials,
    now: () => Date.UTC(2026, 8, 24),
    fetchImpl: async () => jsonResponse(200, { access_token: "expired-token", expires_in: 0 }),
  });
  await assert.rejects(expired.authenticate(), (error: unknown) => error instanceof GhinClientError && error.code === "unauthorized");

  const malformed = new GhinReadOnlyClient({
    baseUrl: "https://api.ghin.com/api/v1",
    credentials,
    fetchImpl: async () => jsonResponse(200, { golfer_user: { status: "Active" } }),
  });
  await assert.rejects(malformed.authenticate(), (error: unknown) => error instanceof GhinClientError && error.code === "invalid_response");
});

test("scores usa el endpoint histórico y sólo cae al actual ante 404/405", async () => {
  const endpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    endpoints.push(url.pathname);
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/scores/search.json")) return jsonResponse(404, { error: "not found" });
    if (url.pathname.endsWith("/scores.json")) {
      assert.equal(url.searchParams.get("source"), "GHINcom");
      assert.equal(url.searchParams.get("per_page"), "10");
      return jsonResponse(200, {
        scores: [{ id: 7, played_at: "2026-09-20", adjusted_gross_score: 81, differential: 8.1 }],
      });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api.ghin.com/api/v1", credentials, fetchImpl });

  const scores = await client.getScores("11103349", 10);

  assert.equal(scores.data.length, 1);
  assert.equal(scores.data[0].adjustedGrossScore, 81);
  assert.deepEqual(endpoints, [
    "/api/v1/golfer_login.json",
    "/api/v1/scores/search.json",
    "/api/v1/scores.json",
  ]);
});

test("lookup cae al endpoint global sólo ante incompatibilidad 404/405 y conserva parámetros actuales", async () => {
  const endpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    endpoints.push(url.pathname);
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/golfers/search.json")) return jsonResponse(405, { error: "unsupported" });
    if (url.pathname.endsWith("/golfers.json")) {
      assert.equal(url.searchParams.get("golfer_id"), "11103349");
      assert.equal(url.searchParams.get("from_ghin"), "true");
      assert.equal(url.searchParams.get("source"), "GHINcom");
      return jsonResponse(200, { golfers: [{ ghin: "11103349", handicap_index: "7.1", status: "Active" }] });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api.ghin.com/api/v1", credentials, fetchImpl });

  assert.equal((await client.lookupGolfer("11103349")).data.handicapIndex, 7.1);
  assert.deepEqual(endpoints, [
    "/api/v1/golfer_login.json",
    "/api/v1/golfers/search.json",
    "/api/v1/golfers.json",
  ]);
});

test("límites no finitos nunca se envían como NaN o Infinity", async () => {
  const observed: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    observed.push(url);
    return jsonResponse(200, url.pathname.endsWith("/scores/search.json") ? { Scores: [] } : { courses: [] });
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api.ghin.com/api/v1", credentials, fetchImpl });

  await client.getScores("11103349", Number.NaN);
  await client.searchCourses("La Vista", Number.POSITIVE_INFINITY);
  assert.deepEqual(observed.map((url) => url.searchParams.get("per_page")), ["20", "20"]);
});

test("curso y TeeSet preservan null reales y datos por hoyo sin convertirlos a cero", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/SearchCourses.json")) {
      return jsonResponse(200, { courses: [{ CourseId: 23233, CourseName: "La Vista", Status: "Active" }] });
    }
    if (url.pathname.endsWith("/GetCourseDetails.json")) {
      return jsonResponse(200, {
        CourseId: 23233,
        CourseName: "La Vista",
        TeeSets: [{ TeeSetRatingId: 106087, TeeSetName: "Azules", TotalYardage: null }],
      });
    }
    if (url.pathname.endsWith("/TeeSetRatings/106087.json")) {
      return jsonResponse(200, {
        TeeSetRatingId: 106087,
        TeeSetName: "Azules",
        CourseRating: 74.3,
        SlopeRating: 146,
        Holes: [{ Number: 1, Par: 4, Length: null, Allocation: 5 }],
      });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api.ghin.com/api/v1", credentials, fetchImpl });

  const search = await client.searchCourses("La Vista");
  const course = await client.getCourse("23233");
  const tee = await client.getTee("106087");

  assert.equal(search.data[0].id, "23233");
  assert.equal(course.data.tees[0].totalYards, null);
  assert.equal(tee.data.totalYards, null);
  assert.equal(tee.data.holeData[0].yardage, null);
  assert.equal(tee.data.holeData[0].strokeIndex, 5);
});
