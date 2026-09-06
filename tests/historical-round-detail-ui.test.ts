import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HistoricalRoundDetail } from "../app/components/historical-round-detail";
import type { Course, Player, RoundSnapshot } from "../lib/types";

const expenses = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };
const players: Player[] = [
  { id: "said", name: "Said", handicap: -1 },
  { id: "ana", name: "Ana", handicap: 7 },
];
const course: Course = {
  id: "course-history-ui",
  name: "Campo guardado",
  teeName: "Azules",
  holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1, yards: 400 + index })),
};

function completeRound(): RoundSnapshot {
  return {
    id: "history-ui",
    lifecycleState: "completed",
    date: "2026-09-06",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Said",
    ownerId: "said",
    roundHoles: 9,
    startHole: 1,
    order: Array.from({ length: 9 }, (_, index) => index + 1),
    courseSnapshot: course,
    players,
    scores: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, { said: 4, ana: index === 0 ? 3 : 5 }])),
    putts: { 1: { said: 2, ana: 1 } },
    advancedStats: { 1: { said: { fairwayHit: true, greenInRegulation: false, penaltyStrokes: 0 } } },
    betResult: 250,
    expenses,
    expenseTotal: 50,
    netResult: 200,
    categoryResults: { Skins: 250 },
    playerBalances: { said: 250, ana: -250 },
    categoryBalances: { Skins: { said: 250, ana: -250 } },
    personalOpponentResults: [{ betId: "personal-ui", mode: "nassau_individual", modeLabel: "Nassau individual", opponentId: "ana", opponentName: "Ana", amount: 250, status: "final" }],
  };
}

test("el detalle histórico presenta golf, economía y liquidación persistida sin confundir netos", () => {
  const markup = renderToStaticMarkup(createElement(HistoricalRoundDetail, {
    round: completeRound(),
    onEdit: () => undefined,
    onPhoto: () => undefined,
  }));

  assert.match(markup, /Resultado económico guardado/);
  assert.match(markup, /Balance de apuestas/);
  assert.match(markup, /Neto del día/);
  assert.match(markup, /Clasificación final de golf/);
  assert.match(markup, /Gross/);
  assert.match(markup, /Balance final por jugador/);
  assert.match(markup, /Ajustes sugeridos/);
  assert.match(markup, /Said[\s\S]*Ana/);
  assert.match(markup, /no confirman deuda ni pago/);
  assert.match(markup, /Desglose por modalidad/);
  assert.match(markup, /Estadísticas de la ronda/);
  assert.match(markup, /Resultados personales guardados/);
  assert.match(markup, /vs Ana/);
  assert.match(markup, /Pars/);
  assert.match(markup, /Putts/);
  assert.match(markup, /Ver tarjeta completa/);
  assert.match(markup, /aria-controls="historical-full-scorecard"/);
  assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
});

test("un histórico legado o corrupto falla cerrado y no inventa 18 hoyos ni contrapartes", () => {
  const corrupt = {
    ...completeRound(),
    roundHoles: undefined,
    startHole: undefined,
    order: undefined,
    players: undefined,
    courseSnapshot: undefined,
    scores: undefined,
    betResult: Number.NaN,
    expenseTotal: Number.POSITIVE_INFINITY,
    netResult: Number.NEGATIVE_INFINITY,
    categoryResults: null,
    playerBalances: { said: 100 },
    categoryBalances: null,
  } as unknown as RoundSnapshot;
  const markup = renderToStaticMarkup(createElement(HistoricalRoundDetail, {
    round: corrupt,
    onEdit: () => undefined,
    onPhoto: () => undefined,
  }));

  assert.match(markup, /Hoyos no registrados/);
  assert.match(markup, /Resultado de golf no disponible/);
  assert.match(markup, /Datos históricos limitados/);
  assert.match(markup, /se volvió a ejecutar el motor de apuestas/i);
  assert.doesNotMatch(markup, /Organizó Said · 18 hoyos|Ajustes sugeridos|NaN|Infinity/);
});

test("un desglose moderno corrupto no reaparece mediante el fallback legado del dueño", () => {
  const markup = renderToStaticMarkup(createElement(HistoricalRoundDetail, {
    round: {
      ...completeRound(),
      categoryResults: { Skins: 999 },
      categoryBalances: { Skins: { said: 100, ana: -100 } },
    },
    onEdit: () => undefined,
    onPhoto: () => undefined,
  }));

  assert.match(markup, /Un desglose por modalidad no cuadra y fue ocultado/);
  assert.doesNotMatch(markup, /\$999|Registro anterior: conserva la perspectiva/);
});

test("una ronda no terminada nunca se presenta como liquidación o clasificación final", () => {
  const markup = renderToStaticMarkup(createElement(HistoricalRoundDetail, {
    round: { ...completeRound(), lifecycleState: "live" },
    onEdit: () => undefined,
    onPhoto: () => undefined,
  }));

  assert.match(markup, /En juego/);
  assert.match(markup, /Clasificación guardada/);
  assert.doesNotMatch(markup, /Clasificación final de golf|Balance final por jugador|Ajustes sugeridos/);
});

test("el recap histórico conserva controles táctiles y contención horizontal en iPhone", () => {
  const css = readFileSync("app/functional-ux.css", "utf8");
  const component = readFileSync("app/components/historical-round-detail.tsx", "utf8");
  const recap = readFileSync("lib/historical-round-recap.ts", "utf8");

  assert.match(css, /\.historicalScorecardToggle\{width:100%;min-height:48px/);
  assert.match(css, /\.scorecardZoom button\{min-height:44px\}/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*\.historicalEconomyGrid,\.historicalCategoryList,\.historicalStatsGrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.historicalDetail \.tableWrap\{max-width:100%;/);
  assert.match(component, /<FullScorecard/);
  assert.match(component, /context="history"/);
  assert.doesNotMatch(component, /calculate|buildPersonalOpponentHistory|resultDetails/);
  assert.doesNotMatch(recap, /resultDetails\s*(?:\.|\[)/);
});
