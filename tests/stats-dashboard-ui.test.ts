import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StatsDashboard } from "../app/components/stats-dashboard";
import type { GolfInsights, ScoreCohortInsight, ScoredRoundInsight } from "../lib/golf-insights";

function scoredRound(
  id: string,
  holeCount: 9 | 18,
  gross: number,
  relativeToPar: number,
  putts: number | null,
): ScoredRoundInsight {
  return {
    id,
    date: holeCount === 9 ? "2026-09-01" : "2026-09-02",
    occurredAt: holeCount === 9 ? "2026-09-01T18:00:00.000Z" : "2026-09-02T18:00:00.000Z",
    courseName: holeCount === 9 ? "Nueve seleccionado" : "Dieciocho seleccionado",
    teeName: "Tee verificado",
    gross,
    net: gross,
    relativeToPar,
    pars: holeCount,
    birdies: 0,
    eaglesOrBetter: 0,
    bogeys: 0,
    doublesOrWorse: 0,
    putts,
    fairwaysHit: 0,
    fairwayAttempts: 0,
    greensInRegulation: 0,
    greenAttempts: 0,
    penaltyStrokes: 0,
    advancedHoles: 0,
    holeCount,
  };
}

const nineRounds = [
  scoredRound("nine-new", 9, 39, 3, 11),
  scoredRound("nine-old", 9, 41, 5, 13),
];
const eighteenRounds = [scoredRound("eighteen", 18, 80, 8, 32)];

function cohort(holeCount: 9 | 18, rounds: ScoredRoundInsight[]): ScoreCohortInsight {
  const scores = rounds.map((round) => round.gross);
  const relativeScores = rounds.map((round) => round.relativeToPar);
  return {
    holeCount,
    rounds: rounds.length,
    averageScore: scores.reduce((total, score) => total + score, 0) / scores.length,
    bestScore: Math.min(...scores),
    averageNet: scores.reduce((total, score) => total + score, 0) / scores.length,
    bestNet: Math.min(...scores),
    netRounds: rounds.length,
    averageVsPar: relativeScores.reduce((total, score) => total + score, 0) / relativeScores.length,
    bestVsPar: Math.min(...relativeScores),
    last5Average: scores.reduce((total, score) => total + score, 0) / scores.length,
    last10Average: scores.reduce((total, score) => total + score, 0) / scores.length,
    recentRounds: rounds,
  };
}

function insights(scoreScopeHoles: 9 | 18): GolfInsights {
  return {
    rounds: 3,
    scoredRounds: 3,
    scoredRounds9: 2,
    scoredRounds18: 1,
    scoreSampleRounds: 99,
    scoreScopeHoles,
    averageScore: 777.7,
    bestScore: 777,
    averageNet: 777.7,
    bestNet: 777,
    netRounds: 99,
    averageVsPar: 777.7,
    bestVsPar: 777.7,
    last5Average: 777.7,
    last10Average: 777.7,
    pars: 27,
    birdies: 0,
    eaglesOrBetter: 0,
    bogeys: 0,
    doublesOrWorse: 0,
    averagePutts: 777.7,
    puttRounds: 99,
    advancedRounds: 0,
    fairwaysHit: 0,
    fairwayAttempts: 0,
    greensInRegulation: 0,
    greenAttempts: 0,
    penaltyStrokes: 0,
    coursesPlayed: 2,
    betRounds: 0,
    expenseRounds: 0,
    netResultRounds: 0,
    categoryTotals: {},
    recentRounds: [...eighteenRounds, ...nineRounds],
    scoreCohorts: {
      9: cohort(9, nineRounds),
      18: cohort(18, eighteenRounds),
    },
    quality: {
      inputSnapshots: 3,
      uniqueSnapshots: 3,
      duplicateSnapshots: 0,
      nonFinalRounds: 0,
      invalidRounds: 0,
      incompleteRounds: 0,
      unresolvedOwnerRounds: 0,
    },
  };
}

function renderStats(scoreScopeHoles: 9 | 18) {
  return renderToStaticMarkup(createElement(StatsDashboard, {
    insights: insights(scoreScopeHoles),
    onOpenHistory: () => undefined,
    onOpenRound: () => undefined,
  }));
}

test("Stats mantiene separadas las cohortes 9H y 18H en score, putts y rondas recientes", () => {
  const nineMarkup = renderStats(9);
  assert.match(nineMarkup, /Formato de ronda para comparar/);
  assert.match(nineMarkup, /class="active" aria-pressed="true"[^>]*>9 hoyos/);
  assert.match(nineMarkup, /Promedio[\s\S]*40\.0/);
  assert.match(nineMarkup, /Mejor score[\s\S]*39/);
  assert.match(nineMarkup, /vs par[\s\S]*\+4\.0/);
  assert.match(nineMarkup, /PUTTS[\s\S]*12\.0/);
  assert.match(nineMarkup, /Nueve seleccionado/);
  assert.doesNotMatch(nineMarkup, /Dieciocho seleccionado|777\.7/);

  const eighteenMarkup = renderStats(18);
  assert.match(eighteenMarkup, /class="active" aria-pressed="true"[^>]*>18 hoyos/);
  assert.match(eighteenMarkup, /Promedio[\s\S]*80\.0/);
  assert.match(eighteenMarkup, /PUTTS[\s\S]*32\.0/);
  assert.match(eighteenMarkup, /Dieciocho seleccionado/);
  assert.doesNotMatch(eighteenMarkup, /Nueve seleccionado|777\.7/);
});

test("Stats ofrece controles reales y una alternativa textual accesible para la gráfica", () => {
  const component = readFileSync("app/components/stats-dashboard.tsx", "utf8");
  const markup = renderStats(9);

  assert.match(component, /onClick=\{\(\) => setRequestedScope\(holes\)\}/);
  assert.match(component, /onClick=\{\(\) => setTrendMode\("gross"\)\}/);
  assert.match(component, /onClick=\{\(\) => setTrendMode\("relative"\)\}/);
  assert.match(markup, /aria-label="Métrica de evolución"/);
  assert.match(markup, />Gross<\/button>/);
  assert.match(markup, />vs Par<\/button>/);
  assert.match(markup, /<ol class="srOnly" aria-label="Datos de evolución de score bruto">/);
  assert.match(markup, /Nueve seleccionado: 39 golpes/);
  assert.match(markup, /Sin liquidaciones verificables en el histórico/);
  assert.doesNotMatch(markup, /NaN|Infinity|undefined|\$0/);
});
