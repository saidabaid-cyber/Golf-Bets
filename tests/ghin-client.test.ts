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
const {
  GhinClientError,
  GhinReadOnlyClient,
} = clientModule;

const credentials = {
  login: "11103349",
  password: "unit-test-password",
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function firebaseResponse() {
  return jsonResponse(200, { authToken: { token: "firebase-installation-token", expiresIn: "604800s" } });
}

function isFirebase(url: URL) {
  return url.hostname === "firebaseinstallations.googleapis.com";
}

function assertSingleGhinSource(url: URL) {
  assert.deepEqual(url.searchParams.getAll("source"), ["GHINcom"]);
}

test("autentica, deduplica consultas concurrentes y nunca deja secretos en el trace", async () => {
  let loginCalls = 0;
  let golferCalls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (isFirebase(url)) {
      assert.equal(init?.method, "POST");
      assert.equal(url.pathname, "/v1/projects/ghin-mobile-app/installations");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key")?.length, 39);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        appId: "1:884417644529:web:47fb315bc6c70242f72650",
        authVersion: "FIS_v2",
        fid: "fg6JfS0U01YmrelthLX9Iz",
        sdkVersion: "w:0.5.7",
      });
      return firebaseResponse();
    }
    if (url.pathname.endsWith("/golfer_login.json")) {
      loginCalls += 1;
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers && new Headers(init.headers).get("content-type"), "application/json");
      assert.equal(init?.headers && new Headers(init.headers).get("accept"), "application/json, text/plain, */*");
      assert.equal(init?.headers && new Headers(init.headers).get("authorization"), null);
      const body = JSON.parse(String(init?.body)) as {
        user: { password: string; email_or_ghin: string };
        token: string;
      };
      assert.deepEqual(body.user, {
        password: credentials.password,
        email_or_ghin: credentials.login,
      });
      assert.equal(body.token, "firebase-installation-token");
      return jsonResponse(200, { golfer_user: { golfer_user_token: "provider-secret-token" }, expires_in: 3_600 });
    }
    if (url.pathname.endsWith("/golfers/search.json")) {
      golferCalls += 1;
      assert.equal(init?.headers && new Headers(init.headers).get("authorization"), "Bearer provider-secret-token");
      assert.equal(init?.headers && new Headers(init.headers).get("source"), null);
      assert.equal(url.searchParams.get("golfer_id"), "11103349");
      assert.equal(url.searchParams.get("source"), null);
      assert.equal(url.searchParams.get("per_page"), "100");
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
    baseUrl: "https://api2.ghin.com/api/v1",
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
  assert.doesNotMatch(JSON.stringify(client), /provider-secret-token|unit-test-password|11103349/i);
  assert.deepEqual(client.getTrace().map((entry) => entry.endpoint), [
    "/v1/projects/ghin-mobile-app/installations",
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
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) {
      loginCalls += 1;
      return jsonResponse(200, { access_token: `token-${loginCalls}`, expires_in: 3_600 });
    }
    golferCalls += 1;
    assert.equal(url.searchParams.get("source"), null);
    assert.equal(init?.headers && new Headers(init.headers).get("source"), null);
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
  const fetchImpl: typeof fetch = async (input) => isFirebase(new URL(String(input))) ? firebaseResponse() : jsonResponse(400, {
    error: `Incorrect Credentials for ${credentials.login}: ${credentials.password}`,
  });
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

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

test("un 400 de contrato no se disfraza como credenciales inválidas", async () => {
  const client = new GhinReadOnlyClient({
    baseUrl: "https://api2.ghin.com/api/v1",
    credentials,
    fetchImpl: async (input) => isFirebase(new URL(String(input))) ? firebaseResponse() : jsonResponse(400, { error: "Login token rejected" }),
  });
  await assert.rejects(
    client.authenticate(),
    (error: unknown) => error instanceof GhinClientError
      && error.httpStatus === 400
      && error.code !== "invalid_credentials",
  );
});

test("rechaza tokens ya vencidos y respuestas de token malformadas", async () => {
  const expired = new GhinReadOnlyClient({
    baseUrl: "https://api2.ghin.com/api/v1",
    credentials,
    now: () => Date.UTC(2026, 8, 24),
    fetchImpl: async (input) => isFirebase(new URL(String(input))) ? firebaseResponse() : jsonResponse(200, { access_token: "expired-token", expires_in: 0 }),
  });
  await assert.rejects(expired.authenticate(), (error: unknown) => error instanceof GhinClientError && error.code === "unauthorized");

  const malformed = new GhinReadOnlyClient({
    baseUrl: "https://api2.ghin.com/api/v1",
    credentials,
    fetchImpl: async (input) => isFirebase(new URL(String(input))) ? firebaseResponse() : jsonResponse(200, { golfer_user: { status: "Active" } }),
  });
  await assert.rejects(malformed.authenticate(), (error: unknown) => error instanceof GhinClientError && error.code === "invalid_response");
});

test("scores usa exactamente el endpoint read-only demostrado", async () => {
  const endpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    endpoints.push(url.pathname);
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/scores.json")) {
      assert.equal(url.searchParams.get("offset"), null);
      assert.equal(url.searchParams.get("limit"), null);
      assert.equal(url.searchParams.get("source"), null);
      return jsonResponse(200, {
        scores: [{ id: 7, played_at: "2026-09-20", adjusted_gross_score: 81, differential: 8.1 }],
      });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  const scores = await client.getScores("11103349", 10);

  assert.equal(scores.data.length, 1);
  assert.equal(scores.data[0].adjustedGrossScore, 81);
  assert.deepEqual(endpoints, [
    "/v1/projects/ghin-mobile-app/installations",
    "/api/v1/golfer_login.json",
    "/api/v1/scores.json",
  ]);
});

test("lookup usa exactamente el contrato demostrado y selecciona home club", async () => {
  const endpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    endpoints.push(url.pathname);
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/golfers/search.json")) {
      assert.equal(url.searchParams.get("golfer_id"), "11103349");
      assert.equal(url.searchParams.get("per_page"), "100");
      assert.equal(url.searchParams.get("source"), null);
      return jsonResponse(200, { golfers: [
        { ghin: "11103349", handicap_index: "7.1", status: "Active", club_name: "Secondary" },
        { ghin: "11103349", handicap_index: "7.1", status: "Active", club_name: "La Vista Country Club", is_home_club: true },
      ] });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  const golfer = await client.lookupGolfer("11103349");
  assert.equal(golfer.data.handicapIndex, 7.1);
  assert.equal(golfer.data.homeClubName, "La Vista Country Club");
  assert.deepEqual(endpoints, [
    "/v1/projects/ghin-mobile-app/installations",
    "/api/v1/golfer_login.json",
    "/api/v1/golfers/search.json",
  ]);
});

test("límites no finitos nunca se envían como NaN o Infinity", async () => {
  const observed: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    observed.push(url);
    return jsonResponse(200, url.pathname.endsWith("/scores.json") ? { Scores: [] } : { courses: [] });
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  await client.getScores("11103349", Number.NaN);
  await client.searchCourses("La Vista", Number.POSITIVE_INFINITY);
  assert.deepEqual(observed.map((url) => url.searchParams.get("limit")), [null, null]);
  assert.equal(observed[0].searchParams.get("source"), null);
  assertSingleGhinSource(observed[1]);
});

test("curso y TeeSet preservan null reales y datos por hoyo sin convertirlos a cero", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    if (url.pathname.endsWith("/SearchCourses.json")) {
      assert.equal(url.searchParams.get("name"), "La Vista");
      assert.equal(url.searchParams.get("country"), "Mexico");
      assert.equal(url.searchParams.get("state"), "Puebla");
      assertSingleGhinSource(url);
      assert.equal(url.searchParams.get("per_page"), null);
      return jsonResponse(200, { courses: [{ CourseId: 23233, CourseName: "La Vista", Status: "Active" }] });
    }
    if (url.pathname.endsWith("/GetCourseDetails.json")) {
      assert.equal(url.searchParams.get("courseId"), "23233");
      assert.equal(url.searchParams.get("include_altered_tees"), "false");
      assertSingleGhinSource(url);
      assert.equal(url.searchParams.get("course_id"), null);
      return jsonResponse(200, {
        CourseId: 23233,
        CourseName: "La Vista",
        TeeSets: [{ TeeSetRatingId: 106087, TeeSetName: "Azules", TotalYardage: null }],
      });
    }
    if (url.pathname.endsWith("/TeeSetRatings/106087.json")) {
      assertSingleGhinSource(url);
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
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  const search = await client.searchCourses("La Vista", 20, "Mexico", "Puebla");
  const course = await client.getCourse("23233");
  const tee = await client.getTee("106087");

  assert.equal(search.data[0].id, "23233");
  assert.equal(course.data.tees[0].totalYards, null);
  assert.equal(tee.data.totalYards, null);
  assert.equal(tee.data.holeData[0].yardage, null);
  assert.equal(tee.data.holeData[0].strokeIndex, 5);
});

test("Course Search y Details conservan fallbacks históricos sólo ante 404/405", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (isFirebase(url)) return firebaseResponse();
    if (url.pathname.endsWith("/golfer_login.json")) {
      return jsonResponse(200, { token: "read-only-token", expires_in: 3_600 });
    }
    assertSingleGhinSource(url);
    if (url.pathname.endsWith("/SearchCourses.json")) {
      if (url.searchParams.has("country")) return jsonResponse(404, { error: "not found" });
      assert.equal(url.searchParams.get("per_page"), "5");
      assert.equal(url.searchParams.get("page"), "1");
      return jsonResponse(200, { courses: [{ CourseId: 23233, CourseName: "La Vista" }] });
    }
    if (url.pathname.endsWith("/GetCourseDetails.json")) {
      if (url.searchParams.has("courseId")) return jsonResponse(405, { error: "unsupported" });
      assert.equal(url.searchParams.get("course_id"), "23233");
      assert.equal(url.searchParams.get("tee_set_status"), "Active");
      return jsonResponse(200, { CourseId: 23233, CourseName: "La Vista", TeeSets: [] });
    }
    throw new Error("unexpected endpoint");
  };
  const client = new GhinReadOnlyClient({ baseUrl: "https://api2.ghin.com/api/v1", credentials, fetchImpl });

  assert.equal((await client.searchCourses("La Vista", 5, "Mexico", "Puebla")).data[0].id, "23233");
  assert.equal((await client.getCourse("23233")).data.id, "23233");
});
