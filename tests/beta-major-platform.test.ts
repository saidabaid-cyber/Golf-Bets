import assert from "node:assert/strict";
import test from "node:test";

import { activeBetSafeDestination, activeRoundContinueTarget, BOTTOM_NAV_TARGETS, primarySectionForTab, resolveActiveRoundStatus, type AppTab } from "../lib/app-navigation";
import { buildGolfInsights, buildPersonalActivity, scoredRoundInsight } from "../lib/golf-insights";
import { internalCourseDataProvider, searchInternalCourses } from "../lib/golf-providers";
import type { Course, FrequentGroup, HoleScore, RoundSnapshot } from "../lib/types";

const course: Course = {
  id: "course-1",
  name: "Campo de prueba",
  teeName: "General",
  holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

const scores = [4, 3, 2, 5, 6, 4, 4, 5, 3];

function round(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  const scoreRows: Record<number, HoleScore> = Object.fromEntries(
    scores.map((score, index) => [index + 1, { owner: score }]),
  );
  return {
    id: "round-1",
    date: "2026-09-01",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Said",
    ownerId: "owner",
    roundHoles: 9,
    betResult: 250,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 250,
    categoryResults: {},
    players: [{ id: "owner", name: "Said", handicap: 0 }],
    courseSnapshot: course,
    order: course.holes.map((hole) => hole.number),
    scores: scoreRows,
    completedAt: "2026-09-01T18:00:00.000Z",
    updatedAt: "2026-09-01T18:00:00.000Z",
    ...overrides,
  };
}

test("the approved primary mobile navigation has four stable product areas", () => {
  assert.deepEqual(BOTTOM_NAV_TARGETS, {
    Inicio: "welcome",
    Social: "social",
    Más: "more",
    Perfil: "profile",
  });

  const expectations: Array<[AppTab, ReturnType<typeof primarySectionForTab>]> = [
    ["welcome", "Inicio"],
    ["play", "Inicio"],
    ["setup", "Inicio"],
    ["round", "Inicio"],
    ["results", "Inicio"],
    ["history", "Inicio"],
    ["balances", "Inicio"],
    ["courseLibrary", "Más"],
    ["rules", "Inicio"],
    ["groups", "Social"],
    ["social", "Social"],
    ["more", "Más"],
    ["profile", "Perfil"],
    ["account", "Perfil"],
    ["stats", "Perfil"],
  ];
  for (const [tab, section] of expectations) assert.equal(primarySectionForTab(tab), section);
});

test("continuing a draft never opens score before field, players and score progress exist", () => {
  assert.equal(resolveActiveRoundStatus({ reviewPending: false, courseSelected: false, playerCount: 2, scoreStarted: true }), "setup");
  assert.equal(resolveActiveRoundStatus({ reviewPending: false, courseSelected: true, playerCount: 0, scoreStarted: true }), "setup");
  assert.equal(resolveActiveRoundStatus({ reviewPending: false, courseSelected: true, playerCount: 2, scoreStarted: false }), "setup");
  assert.equal(activeRoundContinueTarget("setup", false), "setup");
  assert.equal(resolveActiveRoundStatus({ reviewPending: false, courseSelected: true, playerCount: 2, scoreStarted: true }), "live");
  assert.equal(activeRoundContinueTarget("live", true), "round");
  assert.equal(activeRoundContinueTarget("live", false), "setup");
  assert.equal(activeRoundContinueTarget("review", false), "results");
});

test("an invalid active bet draft can only be opened in setup, without blocking independent history", () => {
  for (const tab of ["round", "standings", "personalDetail", "results"] as AppTab[]) {
    assert.equal(activeBetSafeDestination(tab, true), "setup");
    assert.equal(activeBetSafeDestination(tab, false), tab);
  }
  for (const tab of ["welcome", "more", "play", "personals", "history", "historyDetail", "balances", "stats", "groups", "social", "profile"] as AppTab[]) {
    assert.equal(activeBetSafeDestination(tab, true), tab);
  }
});

test("a complete card produces only stats supported by captured scores", () => {
  const insight = scoredRoundInsight(round({
    putts: Object.fromEntries(course.holes.map((hole) => [hole.number, { owner: 2 }])),
  }));

  assert.ok(insight);
  assert.equal(insight.gross, 36);
  assert.equal(insight.net, 36);
  assert.equal(insight.relativeToPar, 0);
  assert.deepEqual(
    { pars: insight.pars, birdies: insight.birdies, eagles: insight.eaglesOrBetter, bogeys: insight.bogeys, doubles: insight.doublesOrWorse },
    { pars: 3, birdies: 2, eagles: 1, bogeys: 2, doubles: 1 },
  );
  assert.equal(insight.putts, 18);
  assert.equal(insight.holeCount, 9);
});

test("incomplete cards and incomplete advanced stats are never presented as complete", () => {
  const incompleteScores = structuredClone(round().scores!);
  delete incompleteScores[9].owner;
  assert.equal(scoredRoundInsight(round({ scores: incompleteScores })), null);

  const partialPutts = { 1: { owner: 2 } };
  const insight = scoredRoundInsight(round({ putts: partialPutts }));
  assert.ok(insight);
  assert.equal(insight.putts, null);
});

test("insights are ordered by completion time and retain zero handicap and zero balances", () => {
  const older = round({ id: "older", completedAt: "2026-08-20T18:00:00.000Z", betResult: -100 });
  const newerScores = Object.fromEntries(scores.map((score, index) => [index + 1, { owner: score - 1 }])) as Record<number, HoleScore>;
  const newer = round({ id: "newer", date: "2026-09-05", completedAt: "2026-09-05T18:00:00.000Z", scores: newerScores, betResult: 100 });
  const incomplete = round({ id: "draft-history", scores: { 1: { owner: 4 } }, betResult: 0 });

  const insights = buildGolfInsights([older, incomplete, newer]);
  assert.equal(insights.rounds, 3);
  assert.equal(insights.scoredRounds, 2);
  assert.equal(insights.recentRounds[0].id, "newer");
  assert.equal(insights.bestScore, 27);
  assert.equal(insights.averageScore, 31.5);
  assert.equal(insights.betBalance, 0);
  assert.equal(insights.puttRounds, 0);
  assert.equal(insights.averagePutts, undefined);
  assert.equal(insights.scoreScopeHoles, 9);
  assert.equal(insights.scoreSampleRounds, 2);
});

test("gross score and putts never mix complete rounds of different lengths", () => {
  const eighteenHoleCourse: Course = {
    ...course,
    id: "course-18",
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
  const eighteenHoleScores = Object.fromEntries(
    eighteenHoleCourse.holes.map((hole) => [hole.number, { owner: 4 }]),
  ) as Record<number, HoleScore>;
  const eighteenHolePutts = Object.fromEntries(
    eighteenHoleCourse.holes.map((hole) => [hole.number, { owner: 2 }]),
  );
  const complete18 = round({
    id: "round-18",
    roundHoles: 18,
    courseSnapshot: eighteenHoleCourse,
    order: eighteenHoleCourse.holes.map((hole) => hole.number),
    scores: eighteenHoleScores,
    putts: eighteenHolePutts,
  });
  const complete9 = round({
    id: "round-9",
    putts: Object.fromEntries(course.holes.map((hole) => [hole.number, { owner: 1 }])),
  });

  const insights = buildGolfInsights([complete9, complete18]);
  assert.equal(insights.scoredRounds, 2);
  assert.equal(insights.scoredRounds9, 1);
  assert.equal(insights.scoredRounds18, 1);
  assert.equal(insights.scoreScopeHoles, 18);
  assert.equal(insights.scoreSampleRounds, 1);
  assert.equal(insights.averageScore, 72);
  assert.equal(insights.bestScore, 72);
  assert.equal(insights.averagePutts, 36);
});

test("personal activity is derived from saved rounds and local groups, with an honest empty state", () => {
  assert.deepEqual(buildPersonalActivity([], [], "Said"), []);
  const groups: FrequentGroup[] = [{
    id: "group-1",
    name: "Viernes",
    players: [{ name: "Said", handicap: 0 }],
    uses: 1,
    updatedAt: "2026-09-04T12:00:00.000Z",
  }];
  const activity = buildPersonalActivity([round({ completedAt: "2026-09-05T18:00:00.000Z" })], groups, "Said");
  assert.equal(activity.length, 2);
  assert.equal(activity[0].kind, "round");
  assert.match(activity[0].title, /jugó 36/);
  assert.match(buildPersonalActivity([round({ betResult: -250 })], [], "Said")[0].detail, /−\$250/);
  assert.equal(activity[1].kind, "group");
  assert.equal(activity[1].groupId, "group-1");
});

test("the internal course provider searches only the supplied catalog and tolerates accents", async () => {
  const catalog: Course[] = [
    course,
    { ...course, id: "course-2", name: "Club México", teeName: "Azules" },
    { ...course, id: "course-3", name: "Otro campo", teeName: "Blancas" },
  ];
  const direct = searchInternalCourses({ courses: catalog, query: "mexico azules" });
  assert.deepEqual(direct.courses.map((item) => item.id), ["course-2"]);
  assert.equal(direct.total, 1);
  assert.equal(direct.hasMore, false);

  const limited = await internalCourseDataProvider.search({ courses: catalog, limit: 2 });
  assert.equal(limited.ok, true);
  if (!limited.ok) return;
  assert.equal(limited.data.courses.length, 2);
  assert.equal(limited.data.total, 3);
  assert.equal(limited.data.hasMore, true);
  assert.equal(internalCourseDataProvider.capabilities.remote_catalog, false);
});
