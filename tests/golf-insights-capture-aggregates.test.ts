import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StatsDashboard } from "../app/components/stats-dashboard";
import { buildGolfInsights, scoredRoundInsight } from "../lib/golf-insights";
import { roundsEligibleForStatistics } from "../lib/statistics-reset";
import type { Course, RoundSnapshot } from "../lib/types";

const course: Course = {
  id: "capture-course", name: "Captura real", teeName: "General",
  holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: index === 0 ? 3 : 4, strokeIndex: index + 1 })),
};

function savedRound(id: string, completedAt: string, advancedStats: RoundSnapshot["advancedStats"] = {}): RoundSnapshot {
  const order = course.holes.map((hole) => hole.number);
  const players = [{ id: "owner", name: "Said", handicap: 0 }, { id: "rival", name: "Pedro", handicap: 0 }];
  return {
    id, lifecycleState: "completed", date: completedAt.slice(0, 10), completedAt,
    courseName: course.name, teeName: course.teeName, ownerName: "Said", ownerId: "owner", roundHoles: 9,
    betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, netResult: 0, categoryResults: {}, players, order, courseSnapshot: course,
    scores: Object.fromEntries(course.holes.map((hole) => [hole.number, { owner: hole.par, rival: hole.par }])),
    advancedStats,
  };
}

test("Stats agrega solo hechos explícitos del dueño y de hoyos jugados, sin duplicar campos legacy", () => {
  const round = savedRound("old", "2026-01-01T18:00:00.000Z", {
    1: { owner: { greenSideBunkerCount: 1, fairwayBunkerCount: 2, bunkerCount: 3, teeDirection: "far_left", outOfBoundsCount: 2, outOfBounds: true }, rival: { greenSideBunkerCount: 9, outOfBoundsCount: 9 } },
    2: { owner: { bunkerCount: 1, teeDirection: "center", outOfBounds: true } },
    3: { owner: { greenSideBunkerCount: 0, fairwayBunkerCount: 0, teeDirection: "right", outOfBounds: false } },
    10: { owner: { greenSideBunkerCount: 5, teeDirection: "far_right", outOfBoundsCount: 5 } },
  });
  const insight = scoredRoundInsight(round);
  assert.ok(insight);
  assert.equal(insight.gross, 35, "las capturas no alteran score");
  assert.deepEqual(insight.capture, {
    greenSideBunkers: 1, greenSideBunkerHoles: 2,
    fairwayBunkers: 2, fairwayBunkerHoles: 2,
    unclassifiedBunkers: 1, unclassifiedBunkerHoles: 1,
    teeShots: { far_left: 1, left: 0, center: 1, right: 1, far_right: 0 }, teeShotHoles: 3,
    outOfBounds: 3, outOfBoundsHoles: 3,
  });
  assert.deepEqual(buildGolfInsights([round]).capture, insight.capture);
});

test("agregados respetan reset y solo suman otra ronda elegible", () => {
  const old = savedRound("old", "2026-01-01T18:00:00.000Z", { 1: { owner: { greenSideBunkerCount: 5, teeDirection: "left", outOfBoundsCount: 3 } } });
  const recent = savedRound("recent", "2026-03-01T18:00:00.000Z", { 1: { owner: { fairwayBunkerCount: 1, teeDirection: "far_right", outOfBoundsCount: 0 } } });
  const eligible = roundsEligibleForStatistics([old, recent], "2026-02-01T00:00:00.000Z");
  assert.deepEqual(eligible.map((round) => round.id), ["recent"]);
  const capture = buildGolfInsights(eligible).capture;
  assert.equal(capture?.greenSideBunkerHoles, 0);
  assert.equal(capture?.fairwayBunkers, 1);
  assert.equal(capture?.teeShots.far_right, 1);
  assert.equal(capture?.outOfBounds, 0);
  assert.equal(capture?.outOfBoundsHoles, 1, "cero capturado es dato real");
});

test("capturas ausentes o corruptas no se presentan como eventos cero", () => {
  const corrupt = savedRound("corrupt", "2026-04-01T18:00:00.000Z", { 1: { owner: { greenSideBunkerCount: -1, teeDirection: "diagonal", outOfBoundsCount: "2" } } } as unknown as RoundSnapshot["advancedStats"]);
  const insights = buildGolfInsights([corrupt]);
  assert.equal(insights.capture?.greenSideBunkerHoles, 0);
  assert.equal(insights.capture?.teeShotHoles, 0);
  assert.equal(insights.capture?.outOfBoundsHoles, 0);
  const markup = renderToStaticMarkup(createElement(StatsDashboard, { insights, onOpenHistory: () => undefined, onOpenRound: () => undefined }));
  assert.doesNotMatch(markup, /Bunkers y OB|Distribución de dirección de Tee Shot/);
});

test("Stats muestra categorías reales, dirección completa y muestras de captura", () => {
  const insights = buildGolfInsights([savedRound("visible", "2026-05-01T18:00:00.000Z", {
    1: { owner: { greenSideBunkerCount: 0, fairwayBunkerCount: 2, teeDirection: "center", outOfBoundsCount: 0 } },
    2: { owner: { bunkerCount: 1, teeDirection: "left", outOfBounds: true } },
  })]);
  const markup = renderToStaticMarkup(createElement(StatsDashboard, { insights, onOpenHistory: () => undefined, onOpenRound: () => undefined }));
  for (const label of ["Green-side bunker", "Fairway bunker", "Bunker sin clasificar", "OB", "Muy izquierda", "Izquierda", "HIT", "Derecha", "Muy derecha"]) assert.match(markup, new RegExp(label));
  assert.match(markup, /Dirección de 2 salidas capturadas/);
  assert.match(markup, /snapshot anterior/);
  assert.match(markup, /OB no se suma a penalidades/);
  assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
});
