import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateLoba } from "../lib/side-bets";
import { collectHoleValidationErrors } from "../lib/hole-validation";
import { buildGeneralResultsTable, type ResultCategoryColumn } from "../lib/result-breakdown";
import type { BetConfig, Course, HoleScore, LobaHole, Player } from "../lib/types";
import { emptyCounterBetKeepers } from "../lib/side-bets";
import { fullRoundBets, fullRoundPlayers } from "./fixtures/full-round";

const lobaPlayers: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "daniel", name: "Daniel", handicap: 0 },
  { id: "flavio", name: "Flavio", handicap: 0 },
  { id: "juan", name: "Juan", handicap: 0 },
];
const pars = [4, 4, 5, 3];
const lobaCourse: Course = {
  id: "loba-natural-units",
  name: "Natural Units",
  teeName: "",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: pars[index] ?? 4, strokeIndex: index + 1 })),
};
const lobaConfig: BetConfig["loba"] = {
  enabled: true,
  value: 0,
  hcpPct: 100,
  unitsEnabled: true,
  unitValue: 100,
  duplicateUnitsByMode: false,
  participantIds: lobaPlayers.map(player => player.id),
};
const lobaCaptures: Record<number, LobaHole> = Object.fromEntries([1, 2, 3, 4].map(hole => {
  const unitCounts: Record<string, number> = hole === 1 ? { said: 2 } : {};
  return [hole, {
    lobaPlayerId: "said",
    mode: "partner",
    partnerId: "daniel",
    fireMultiplier: hole === 4 ? 20 : 1,
    unitCounts,
  } satisfies LobaHole];
}));
const lobaScores: Record<number, HoleScore> = {
  1: { said: 3, daniel: 4, flavio: 2, juan: 4 },
  2: { said: 2, daniel: 4, flavio: 4, juan: 4 },
  3: { said: 2, daniel: 5, flavio: 5, juan: 5 },
  4: { said: 1, daniel: 3, flavio: 3, juan: 3 },
};

test("Loba reconoce Birdie, Eagle, Albatross y HIO como unidades naturales", () => {
  const result = calculateLoba(lobaCourse, lobaScores, lobaPlayers, lobaConfig, lobaCaptures, [1, 2, 3, 4], new Set([1, 2, 3, 4]));
  assert.deepEqual(result.details.map(detail => detail.playerUnits.said.automatic), [1, 2, 3, 3]);
  assert.equal(result.details[0].playerUnits.said.manual, 2);
  assert.equal(result.details[0].playerUnits.said.total, 3);
  assert.equal(result.details[0].lobaAutomaticUnits, 1);
  assert.equal(result.details[0].lobaManualUnits, 2);
  assert.equal(result.details[0].lobaUnits, 3);
  assert.equal(result.details[0].opponentUnits, 2);
  assert.equal(result.details[3].fireMultiplier, 20);
  assert.equal(result.details[3].effectiveUnitValue, 100);
  assert.deepEqual(result.balances, { said: 1800, daniel: 1800, flavio: -1800, juan: -1800 });
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("la captura Loba separa Auto, Manual y Total sin botón manual de evento natural", () => {
  const panel = readFileSync("app/components/side-bet-panels.tsx", "utf8");
  assert.match(panel, /Auto \+\$\{unitDetail\.automatic\} · Manual \+\$\{unitDetail\.manual\} · Total \+\$\{unitDetail\.total\}/);
  assert.match(panel, /Unidades manuales o especiales de Loba/);
  assert.doesNotMatch(panel, /Counter label=\{`(?:Birdie|Eagle|Albatross|HIO)/);
  assert.match(panel, /🔥 Multiplicador del hoyo/);
  assert.match(panel, /base \$100 y 🔥5x: pareja \$500, sola \$1,000 y sola anticipada \$1,500/);
});

test("validación central reúne scores, tres keepers y configuraciones incompletas en un solo intento", () => {
  const bets = structuredClone(fullRoundBets);
  bets.vipers.enabled = true;
  bets.camels.enabled = true;
  bets.fish.enabled = true;
  bets.loba.enabled = true;
  const errors = collectHoleValidationErrors({
    scoreCaptureComplete: false,
    holeNumber: 9,
    players: fullRoundPlayers,
    counterBets: [
      { kind: "vipers", config: bets.vipers },
      { kind: "camels", config: bets.camels },
      { kind: "fish", config: bets.fish },
    ],
    counterBetKeepers: emptyCounterBetKeepers(),
    lobaConfig: bets.loba,
    foursomeConfig: bets.foursome,
    foursomeSegments: [],
    order: Array.from({ length: 18 }, (_, index) => index + 1),
    ballFriendConfig: bets.ballFriend,
  });
  assert.ok(errors.some(error => error.includes("score")));
  assert.ok(errors.some(error => error.includes("🐍 Víboras")));
  assert.ok(errors.some(error => error.includes("🐫 Camellos")));
  assert.ok(errors.some(error => error.includes("🐟 Peces")));
  assert.ok(errors.some(error => error.includes("Loba")));
  assert.ok(errors.some(error => error.includes("Foursome")));
  assert.ok(errors.some(error => error.includes("Bola Amiga")));
  assert.equal(new Set(errors).size, errors.length);
});

test("modal central no avanza y muestra juntos todos los faltantes", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /if \(validationErrors\.length\) \{[\s\S]*setHoleValidationErrors\(validationErrors\);[\s\S]*return;/);
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /holeValidationErrors\.map\(error => <li/);
});

test("resumen de hoyo usa alto dinámico seguro y scroll interno en iPhone", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const css = readFileSync("app/functional-ux.css", "utf8");
  assert.match(page, /className="holeSummaryContent"/);
  assert.match(css, /\.holeSummaryContent\{[^}]*overflow-y:auto/);
  assert.match(css, /\.holeSummaryBackdrop \.holeSummary\{[^}]*100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("Resumen General usa categorías dinámicas, total consolidado y total general cero", () => {
  const categories: ResultCategoryColumn[] = [
    { key: "rabbits", label: "Conejos", balances: { said: 300, juan: -300 }, active: true, played: true },
    { key: "skins", label: "Skins", balances: { said: -100, juan: 100 }, active: true, played: true },
    { key: "inactive", label: "Inactiva", balances: { said: 0, juan: 0 }, active: false, played: false },
    { key: "unplayed", label: "No jugada", balances: { said: 0, juan: 0 }, active: true, played: false },
  ];
  const result = buildGeneralResultsTable(["said", "juan"], categories, { said: 200, juan: -200 });
  assert.deepEqual(result.categories.map(category => category.key), ["rabbits", "skins"]);
  assert.deepEqual(result.rows.map(row => row.total), [200, -200]);
  assert.ok(result.rows.every(row => row.consistent));
  assert.deepEqual(result.categoryTotals, { rabbits: 0, skins: 0 });
  assert.equal(result.grandTotal, 0);
});

test("Resultados ofrece Jugadores y Resumen General con scroll y columnas fijas", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const css = readFileSync("app/functional-ux.css", "utf8");
  assert.match(page, />Jugadores<\/button>/);
  assert.match(page, />Resumen General<\/button>/);
  assert.match(page, /buildGeneralResultsTable\(settlementIds, generalResultCategories, allBetBalances\)/);
  assert.match(page, /TOTAL GENERAL/);
  assert.match(css, /\.generalResultsScroll\{[^}]*overflow-x:auto/);
  assert.match(css, /\.generalResultsTable th:first-child\{[^}]*position:sticky/);
  assert.match(css, /\.generalResultsTable th:last-child,.generalResultsTable td:last-child\{[^}]*position:sticky/);
});
