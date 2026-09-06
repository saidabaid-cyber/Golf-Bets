import assert from "node:assert/strict";
import test from "node:test";

import { buildGolfInsights, buildPersonalActivity, scoredRoundInsight } from "../lib/golf-insights";
import type { Course, HoleScore, Player, RoundSnapshot } from "../lib/types";

const course: Course = {
  id: "reliable-course",
  name: "Campo confiable",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1,
    par: index === 0 ? 3 : index === 1 ? 5 : 4,
    strokeIndex: index + 1,
  })),
};

function orderFor(startHole: 1 | 10 = 1, holes: 9 | 18 = 9) {
  const full = startHole === 10
    ? [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  return full.slice(0, holes);
}

function scoreRows(order: number[], players: Player[], score = 4): Record<number, HoleScore> {
  return Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(players.map((player) => [player.id, score]))]));
}

function savedRound(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  const players = overrides.players || [{ id: "owner", name: "Owner", handicap: 0 }];
  const roundHoles = overrides.roundHoles || 9;
  const startHole = overrides.startHole || 1;
  const order = overrides.order || orderFor(startHole, roundHoles);
  return {
    id: "reliable-round",
    date: "2026-09-01",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Owner",
    ownerId: "owner",
    roundHoles,
    startHole,
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    players,
    courseSnapshot: course,
    order,
    scores: scoreRows(order, players),
    completedAt: "2026-09-01T18:00:00.000Z",
    updatedAt: "2026-09-01T18:00:00.000Z",
    ...overrides,
  };
}

test("historical insights fail closed instead of throwing on malformed runtime snapshots", () => {
  const malformed = [
    savedRound({ courseSnapshot: { ...course, holes: null } as unknown as Course }),
    { ...savedRound(), players: [null] as unknown as Player[] },
    savedRound({ scores: { 1: "bad" } as unknown as Record<number, HoleScore> }),
    null as unknown as RoundSnapshot,
  ];
  for (const round of malformed) assert.doesNotThrow(() => scoredRoundInsight(round));
  assert.equal(buildGolfInsights(malformed).scoredRounds, 0);
});

test("only canonical 9/18-hole geometry contributes to scoring", () => {
  assert.ok(scoredRoundInsight(savedRound({ id: "front" })));
  assert.ok(scoredRoundInsight(savedRound({ id: "back", startHole: 10, order: orderFor(10, 9), scores: scoreRows(orderFor(10, 9), [{ id: "owner", name: "Owner", handicap: 0 }]) })));
  assert.ok(scoredRoundInsight(savedRound({ id: "wrap", roundHoles: 18, startHole: 10, order: orderFor(10, 18), scores: scoreRows(orderFor(10, 18), [{ id: "owner", name: "Owner", handicap: 0 }]) })));
  assert.equal(scoredRoundInsight(savedRound({ order: Array(9).fill(1) })), null);
  assert.equal(scoredRoundInsight(savedRound({ startHole: 10, order: orderFor(1, 9) })), null);
});

test("invalid score primitives never become gross or scoring-category data", () => {
  for (const value of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 21]) {
    const scores = scoreRows(orderFor(), [{ id: "owner", name: "Owner", handicap: 0 }]);
    scores[1].owner = value;
    assert.equal(scoredRoundInsight(savedRound({ scores })), null);
  }
  assert.ok(scoredRoundInsight(savedRound({ scores: scoreRows(orderFor(), [{ id: "owner", name: "Owner", handicap: 0 }], 1) })));
});

test("explicit non-final and unknown lifecycle states are quarantined while legacy missing remains completed", () => {
  const snapshots = [
    savedRound({ id: "legacy" }),
    savedRound({ id: "complete", lifecycleState: "completed" }),
    savedRound({ id: "draft", lifecycleState: "draft" }),
    savedRound({ id: "live", lifecycleState: "live" }),
    savedRound({ id: "cancelled", lifecycleState: "cancelled" }),
    { ...savedRound({ id: "unknown" }), lifecycleState: "mystery" } as unknown as RoundSnapshot,
  ];
  const insights = buildGolfInsights(snapshots);
  assert.equal(insights.rounds, 2);
  assert.equal(insights.scoredRounds, 2);
  assert.equal(insights.quality.nonFinalRounds, 4);
  assert.deepEqual(buildPersonalActivity(snapshots, [], "Owner").map((item) => item.roundId).sort(), ["complete", "legacy"]);
});

test("owner resolution is identity-first and never falls back to an arbitrary multiplayer row", () => {
  const players = [
    { id: "one", name: "Alex", handicap: 0 },
    { id: "two", name: "Alex", handicap: 0 },
  ];
  const scores = scoreRows(orderFor(), players);
  assert.equal(scoredRoundInsight(savedRound({ players, scores, ownerId: undefined, ownerName: "Alex" })), null);
  assert.equal(scoredRoundInsight(savedRound({ players, scores, ownerId: undefined, ownerName: "Missing" })), null);
  assert.equal(scoredRoundInsight(savedRound({ players, scores, ownerId: "two", ownerName: "Old name" }))?.gross, 36);
  const sole = [{ id: "sole", name: "Renamed", handicap: 0 }];
  assert.equal(scoredRoundInsight(savedRound({ players: sole, scores: scoreRows(orderFor(), sole), ownerId: undefined, ownerName: "Legacy" }))?.gross, 36);
});

test("the newest duplicate snapshot is authoritative and a corrupt correction cannot resurrect stale stats", () => {
  const older = savedRound({ id: "same", updatedAt: "2026-09-01T18:00:00.000Z" });
  const corruptScores = structuredClone(older.scores!);
  corruptScores[1].owner = -2;
  const correction = savedRound({ id: "same", updatedAt: "2026-09-02T18:00:00.000Z", scores: corruptScores });
  const insights = buildGolfInsights([older, correction]);
  assert.equal(insights.quality.duplicateSnapshots, 1);
  assert.equal(insights.rounds, 1);
  assert.equal(insights.scoredRounds, 0);
});

test("played chronology uses completion time, not a later metadata edit", () => {
  const recentPlay = savedRound({ id: "recent", date: "2026-09-05", completedAt: "2026-09-05T18:00:00.000Z", updatedAt: "2026-09-05T18:00:00.000Z" });
  const oldEdited = savedRound({ id: "old", date: "2026-08-01", completedAt: "2026-08-01T18:00:00.000Z", updatedAt: "2026-09-06T18:00:00.000Z" });
  assert.deepEqual(buildGolfInsights([oldEdited, recentPlay]).recentRounds.map((round) => round.id), ["recent", "old"]);
});

test("nine and eighteen-hole cohorts remain independently selectable", () => {
  const round9 = savedRound({ id: "nine" });
  const order18 = orderFor(1, 18);
  const round18 = savedRound({ id: "eighteen", roundHoles: 18, order: order18, scores: scoreRows(order18, [{ id: "owner", name: "Owner", handicap: 0 }]) });
  const insights = buildGolfInsights([round9, round18]);
  assert.equal(insights.scoreCohorts[9]?.averageScore, 36);
  assert.equal(insights.scoreCohorts[18]?.averageScore, 72);
  assert.equal(insights.scoreCohorts[9]?.rounds, 1);
  assert.equal(insights.scoreCohorts[18]?.rounds, 1);
});

test("missing HCP preserves gross, while scratch and plus HCP retain valid net scoring", () => {
  const missing = [{ id: "owner", name: "Owner", handicap: null }];
  const scratch = [{ id: "owner", name: "Owner", handicap: 0 }];
  const plus = [{ id: "owner", name: "Owner", handicap: -2 }];
  assert.equal(scoredRoundInsight(savedRound({ players: missing, scores: scoreRows(orderFor(), missing) }))?.net, null);
  assert.equal(scoredRoundInsight(savedRound({ players: scratch, scores: scoreRows(orderFor(), scratch) }))?.net, 36);
  const fullOrder = orderFor(1, 18);
  assert.equal(scoredRoundInsight(savedRound({ roundHoles: 18, order: fullOrder, players: plus, scores: scoreRows(fullOrder, plus) }))?.net, 74);
});

test("putt averages require every played hole and only accept bounded integers", () => {
  const completePutts = Object.fromEntries(orderFor().map((hole) => [hole, { owner: 2 }]));
  assert.equal(scoredRoundInsight(savedRound({ putts: completePutts }))?.putts, 18);
  assert.equal(scoredRoundInsight(savedRound({ putts: { ...completePutts, 9: {} } }))?.putts, null);
  for (const value of [-1, 1.5, 21, Number.NaN]) {
    assert.equal(scoredRoundInsight(savedRound({ putts: { ...completePutts, 9: { owner: value } } }))?.putts, null);
  }
});

test("par-three fairway flags are ignored while explicit GIR and zero penalties remain captured", () => {
  const insight = scoredRoundInsight(savedRound({
    advancedStats: {
      1: { owner: { fairwayHit: true, greenInRegulation: false, penaltyStrokes: 0 } },
      2: { owner: { fairwayHit: false, greenInRegulation: true, penaltyStrokes: 1 } },
    },
  }));
  assert.equal(insight?.fairwayAttempts, 1);
  assert.equal(insight?.fairwaysHit, 0);
  assert.equal(insight?.greenAttempts, 2);
  assert.equal(insight?.greensInRegulation, 1);
  assert.equal(insight?.penaltyStrokes, 1);
});

test("unavailable financial data stays unavailable and an exact persisted zero is a real sample", () => {
  const missing = { ...savedRound({ id: "missing" }), betResult: undefined } as unknown as RoundSnapshot;
  const corrupt = savedRound({ id: "corrupt", betResult: Number.NaN });
  const absent = buildGolfInsights([missing, corrupt]);
  assert.equal(absent.betBalance, undefined);
  assert.equal(absent.betRounds, 0);
  const zero = buildGolfInsights([savedRound({ id: "zero", betResult: 0 })]);
  assert.equal(zero.betBalance, 0);
  assert.equal(zero.betRounds, 1);
});

test("invalid calendar dates are excluded and never become recent activity", () => {
  const invalid = savedRound({ id: "bad-date", date: "2026-02-30", completedAt: "not-a-date" });
  const insights = buildGolfInsights([invalid]);
  assert.equal(insights.rounds, 0);
  assert.equal(insights.quality.invalidRounds, 1);
  assert.deepEqual(buildPersonalActivity([invalid], [], "Owner"), []);
});
