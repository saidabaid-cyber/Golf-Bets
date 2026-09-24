import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGhinToken,
  normalizeGhinError,
  parseGhinCourse,
  parseGhinCourses,
  parseGhinGolfer,
  parseGhinHandicapIndex,
  parseGhinScores,
  parseGhinToken,
  safeJsonParse,
  SlidingWindowRateLimiter,
  TtlPromiseCache,
} from "../lib/ghin/core";

test("normaliza variantes de golfer sin convertir null, undefined o NH en cero", () => {
  const golfer = parseGhinGolfer({
    Data: {
      Golfers: [{
        GHIN: 11103349,
        FirstName: " Said ",
        LastName: "Abaid Taja",
        HandicapIndex: "NH",
        GolferStatus: "Inactive",
        Club: { Name: "La Vista Country Club" },
        GolfAssociationName: "Federación de Golf",
      }],
    },
  });

  assert.ok(golfer);
  assert.equal(golfer.ghinNumber, "11103349");
  assert.equal(golfer.name, "Said Abaid Taja");
  assert.equal(golfer.clubName, "La Vista Country Club");
  assert.equal(golfer.handicapIndex, null);
  assert.equal(golfer.status, "inactive");
  assert.equal(golfer.isActive, false);

  assert.equal(parseGhinGolfer({ ghin_number: "7", handicap_index: null })?.handicapIndex, null);
  assert.equal(parseGhinGolfer({ ghin_number: "8" })?.handicapIndex, null);
  assert.equal(parseGhinGolfer({ ghin_number: "9", handicap_index: "0" })?.handicapIndex, 0);
  assert.equal(parseGhinHandicapIndex("N/H"), null);
  assert.equal(parseGhinHandicapIndex("+1.7"), -1.7);
  assert.equal(parseGhinHandicapIndex(-0.4), -0.4);
});

test("normaliza score history snake_case y PascalCase conservando faltantes como null", () => {
  const scores = parseGhinScores({
    response: {
      Scores: [
        {
          ScoreId: "score-1",
          ScoreDay: "2026-09-20",
          CourseName: "La Vista Country Club",
          TeeSetName: "Azules",
          GrossScore: "81",
          AdjustedGrossScore: "79",
          ScoreDifferential: "7.8",
          CourseRating: "72.4",
          SlopeRating: "131",
          ScoreType: "H",
          PostingMethod: "Internet",
          HolesPlayed: "18",
        },
        {
          id: "score-2",
          date_played: "2026-09-21",
          course_name: "La Vista",
          gross_score: null,
          adjusted_score: undefined,
          differential: null,
          holes: null,
        },
      ],
    },
  });

  assert.equal(scores.length, 2);
  assert.deepEqual(scores[0], {
    id: "score-1",
    playedOn: "2026-09-20",
    courseId: null,
    courseName: "La Vista Country Club",
    teeId: null,
    teeName: "Azules",
    grossScore: 81,
    adjustedGrossScore: 79,
    differential: 7.8,
    courseRating: 72.4,
    slopeRating: 131,
    scoreType: "H",
    postingMethod: "Internet",
    holes: 18,
  });
  assert.equal(scores[1].grossScore, null);
  assert.equal(scores[1].adjustedGrossScore, null);
  assert.equal(scores[1].differential, null);
  assert.equal(scores[1].holes, null);
});

test("normaliza Course/Tee/Hole y ratings segmentados sin inventar datos incompletos", () => {
  const payload = {
    result: {
      Courses: [{
        CourseID: 23233,
        CourseName: "La Vista Country Club",
        CourseStatus: "Active",
        HolesNumber: "18",
        Facility: {
          FacilityID: "facility-44",
          Name: "La Vista",
          Address: { City: "Puebla", StateRegion: "Puebla", CountryCode: "MX" },
        },
        TeeSets: [{
          TeeSetRatingID: "tee-blue",
          TeeSetName: "Azules",
          Gender: "Male",
          Ratings: [
            { RatingType: "Total", CourseRating: "72.4", SlopeRating: "131" },
            { RatingType: "Front 9", CourseRating: "36.1", SlopeRating: "129" },
            { RatingType: "Back 9", CourseRating: "36.3", SlopeRating: "133" },
          ],
          Holes: [
            { HoleNumber: 1, Par: 4, Length: "410", Allocation: 3 },
            { HoleNumber: 2, Par: null, Length: null, Allocation: null },
          ],
        }],
      }],
    },
  };

  const courses = parseGhinCourses(payload);
  assert.equal(courses.length, 1);
  const course = courses[0];
  assert.equal(course.id, "23233");
  assert.equal(course.facilityId, "facility-44");
  assert.equal(course.city, "Puebla");
  assert.equal(course.state, "Puebla");
  assert.equal(course.country, "MX");
  assert.equal(course.status, "active");
  assert.equal(course.holes, 18);
  assert.equal(course.tees.length, 1);

  const tee = course.tees[0];
  assert.equal(tee.id, "tee-blue");
  assert.equal(tee.courseRating, 72.4);
  assert.equal(tee.slopeRating, 131);
  assert.equal(tee.frontRating, 36.1);
  assert.equal(tee.backSlope, 133);
  assert.equal(tee.holes, 2);
  assert.equal(tee.par, null, "un hoyo sin par impide inventar un total parcial");
  assert.equal(tee.totalYards, null, "un hoyo sin yardage impide inventar un total parcial");
  assert.deepEqual(tee.holeData[1], { number: 2, par: null, yardage: null, strokeIndex: null });

  assert.deepEqual(parseGhinCourse({ CourseID: null, CourseName: null }), null);
  assert.deepEqual(parseGhinCourse({ CourseID: "course-without-tees", CourseName: "Sin salidas" })?.tees, []);
});

test("extrae tokens sólo de llaves permitidas y normaliza expiración", () => {
  const payload = {
    response: {
      golfer_user: {
        golferUserToken: " Bearer abc.def.ghi ",
        expiresIn: "60",
      },
    },
  };
  assert.equal(extractGhinToken(payload), "abc.def.ghi");
  assert.deepEqual(parseGhinToken(payload, 1_000), {
    accessToken: "abc.def.ghi",
    tokenType: "Bearer",
    expiresAt: 61_000,
  });
  assert.equal(extractGhinToken({ user: { password: "do-not-treat-as-token" } }), null);
  assert.equal(extractGhinToken({ access_token: null }), null);
  assert.equal(parseGhinToken({ token: "   " }), null);
});

test("helpers de error nunca devuelven el mensaje o secreto de entrada", () => {
  const secret = "password=hunter2 token=abc.def";
  const normalized = normalizeGhinError(new Error(`Invalid password ${secret}`), 401);
  assert.deepEqual(normalized, {
    code: "invalid_credentials",
    message: "GHIN rechazó las credenciales.",
    httpStatus: 401,
    retryable: false,
  });
  assert.doesNotMatch(normalized.message, /hunter2|abc\.def|password|token/i);

  assert.deepEqual(normalizeGhinError({ statusCode: 429, message: secret }), {
    code: "rate_limited",
    message: "GHIN limitó temporalmente las consultas.",
    httpStatus: 429,
    retryable: true,
  });
  assert.deepEqual(safeJsonParse('{"ok":true}'), { ok: true });
  assert.equal(safeJsonParse("not json"), null);
  assert.equal(safeJsonParse("  "), null);
});

test("TTL cache deduplica promesas concurrentes y expira desde su resolución", async () => {
  let now = 0;
  let calls = 0;
  let resolveLoader!: (value: number) => void;
  const cache = new TtlPromiseCache<string, number>({ ttlMs: 1_000, now: () => now });
  const loader = () => {
    calls += 1;
    return new Promise<number>((resolve) => { resolveLoader = resolve; });
  };

  const first = cache.get("golfer:11103349", loader);
  const duplicate = cache.getOrLoad("golfer:11103349", loader);
  assert.strictEqual(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveLoader(79);
  assert.deepEqual(await Promise.all([first, duplicate]), [79, 79]);
  assert.equal(cache.peek("golfer:11103349"), 79);

  now = 999;
  assert.equal(await cache.get("golfer:11103349", () => { calls += 1; return 80; }), 79);
  assert.equal(calls, 1);
  now = 1_000;
  assert.equal(await cache.get("golfer:11103349", () => { calls += 1; return 80; }), 80);
  assert.equal(calls, 2);
});

test("TTL cache no conserva rechazos ni repuebla una entrada invalidada en vuelo", async () => {
  const cache = new TtlPromiseCache<string, number>(1_000, () => 0);
  let rejectedCalls = 0;
  await assert.rejects(cache.get("bad", () => {
    rejectedCalls += 1;
    throw new Error("temporary");
  }), /temporary/);
  assert.equal(await cache.get("bad", () => {
    rejectedCalls += 1;
    return 4;
  }), 4);
  assert.equal(rejectedCalls, 2);

  let resolveLoader!: (value: number) => void;
  const pending = cache.get("deleted", () => new Promise<number>((resolve) => { resolveLoader = resolve; }));
  await Promise.resolve();
  assert.equal(cache.delete("deleted"), true);
  resolveLoader(12);
  assert.equal(await pending, 12);
  assert.equal(cache.peek("deleted"), undefined);
});

test("sliding-window limiter es por llave, determinista y libera el borde exacto", () => {
  let now = 0;
  const limiter = new SlidingWindowRateLimiter<string>({ limit: 2, windowMs: 1_000, now: () => now });

  assert.deepEqual(limiter.consume("user-a"), {
    allowed: true,
    limit: 2,
    remaining: 1,
    retryAfterMs: 0,
    resetAt: 1_000,
  });
  assert.equal(limiter.consume("user-a").allowed, true);
  assert.deepEqual(limiter.consume("user-a"), {
    allowed: false,
    limit: 2,
    remaining: 0,
    retryAfterMs: 1_000,
    resetAt: 1_000,
  });
  assert.equal(limiter.consume("user-b").allowed, true, "cada usuario tiene su propia ventana");

  now = 1_000;
  const atBoundary = limiter.attempt("user-a");
  assert.equal(atBoundary.allowed, true);
  assert.equal(atBoundary.remaining, 1);
  assert.equal(atBoundary.resetAt, 2_000);
});
