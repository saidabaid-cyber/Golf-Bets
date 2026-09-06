import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAdvancedStats,
  normalizeScoreCaptureMode,
  summarizePlayerAdvancedStats,
  updateAdvancedHoleStat,
} from "../lib/advanced-stats";
import { buildGolfInsights, scoredRoundInsight } from "../lib/golf-insights";
import { normalizeRoundDraft } from "../lib/round-utils";
import type { Course, RoundSnapshot } from "../lib/types";

test("legacy rounds default to quick capture and advanced remains explicit", () => {
  assert.equal(normalizeScoreCaptureMode(undefined), "quick");
  assert.equal(normalizeScoreCaptureMode("quick"), "quick");
  assert.equal(normalizeScoreCaptureMode("advanced"), "advanced");
  assert.equal(normalizeScoreCaptureMode("invented"), "quick");
});

test("advanced normalization preserves explicit false and zero but rejects corrupt values", () => {
  const normalized = normalizeAdvancedStats({
    1: { owner: { fairwayHit: false, greenInRegulation: true, penaltyStrokes: 0 } },
    2: { owner: { fairwayHit: "yes", penaltyStrokes: -1 }, rival: { penaltyStrokes: 2 } },
    19: { owner: { penaltyStrokes: 1 } },
  });
  assert.deepEqual(normalized, {
    1: { owner: { fairwayHit: false, greenInRegulation: true, penaltyStrokes: 0 } },
    2: { rival: { penaltyStrokes: 2 } },
  });
});

test("editing one optional stat is immutable and clearing the last value removes its empty row", () => {
  const source = { 1: { owner: { fairwayHit: true } } };
  const withPenalty = updateAdvancedHoleStat(source, 1, "owner", { penaltyStrokes: 2 });
  assert.deepEqual(source, { 1: { owner: { fairwayHit: true } } });
  assert.deepEqual(withPenalty[1].owner, { fairwayHit: true, penaltyStrokes: 2 });
  const withoutFairway = updateAdvancedHoleStat(withPenalty, 1, "owner", { fairwayHit: undefined });
  const empty = updateAdvancedHoleStat(withoutFairway, 1, "owner", { penaltyStrokes: undefined });
  assert.deepEqual(empty, {});
});

test("summary uses only explicitly captured attempts and never fills missing holes", () => {
  const summary = summarizePlayerAdvancedStats({
    1: { owner: { fairwayHit: true, greenInRegulation: false, penaltyStrokes: 0 } },
    2: { owner: { greenInRegulation: true } },
    3: { owner: { fairwayHit: false, penaltyStrokes: 2 } },
  }, "owner", [1, 2, 3, 4]);
  assert.deepEqual(summary, {
    capturedHoles: 3,
    fairwaysHit: 1,
    fairwayAttempts: 2,
    greensInRegulation: 1,
    greenAttempts: 2,
    penaltyStrokes: 2,
    penaltyHoles: 2,
  });
});

const course: Course = {
  id: "advanced-course",
  name: "Advanced QA",
  teeName: "General",
  holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: index === 0 ? 3 : 4, strokeIndex: index + 1 })),
};

function completeRound(): RoundSnapshot {
  const order = course.holes.map((hole) => hole.number);
  return {
    id: "advanced-round",
    date: "2026-09-06",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Owner",
    ownerId: "owner",
    roundHoles: 9,
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    players: [{ id: "owner", name: "Owner", handicap: 0 }],
    scores: Object.fromEntries(order.map((hole) => [hole, { owner: course.holes[hole - 1].par }])),
    order,
    courseSnapshot: course,
    scoreCaptureMode: "advanced",
    advancedStats: {
      1: { owner: { greenInRegulation: true, penaltyStrokes: 0 } },
      2: { owner: { fairwayHit: true, greenInRegulation: false, penaltyStrokes: 1 } },
    },
  };
}

test("saved advanced data contributes to Stats without changing gross score", () => {
  const round = completeRound();
  const insight = scoredRoundInsight(round);
  assert.ok(insight);
  assert.equal(insight.gross, 35);
  assert.equal(insight.fairwaysHit, 1);
  assert.equal(insight.fairwayAttempts, 1);
  assert.equal(insight.greensInRegulation, 1);
  assert.equal(insight.greenAttempts, 2);
  assert.equal(insight.penaltyStrokes, 1);
  const aggregate = buildGolfInsights([round]);
  assert.equal(aggregate.advancedRounds, 1);
  assert.equal(aggregate.penaltyStrokes, 1);
});

test("Stats ignora valores avanzados corruptos de un histórico legacy", () => {
  const corrupt = {
    ...completeRound(),
    advancedStats: {
      1: { owner: { fairwayHit: true, penaltyStrokes: -5 } },
      2: { owner: { greenInRegulation: true, penaltyStrokes: 51 } },
    },
  };
  const insight = scoredRoundInsight(corrupt);
  assert.equal(insight?.penaltyStrokes, 0);
  assert.equal(insight?.fairwaysHit, 1);
  assert.equal(insight?.greensInRegulation, 1);
});

test("draft normalization persists mode and valid stats while old drafts stay compatible", () => {
  const modern = normalizeRoundDraft({ roundId: "modern", scoreCaptureMode: "advanced", advancedStats: { 4: { owner: { fairwayHit: false, penaltyStrokes: 0 } } } });
  assert.equal(modern?.scoreCaptureMode, "advanced");
  assert.deepEqual(modern?.advancedStats, { 4: { owner: { fairwayHit: false, penaltyStrokes: 0 } } });
  const legacy = normalizeRoundDraft({ roundId: "legacy", scores: {} });
  assert.equal(legacy?.scoreCaptureMode, "quick");
  assert.deepEqual(legacy?.advancedStats, {});
});
