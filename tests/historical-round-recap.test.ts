import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoricalRoundRecap } from "../lib/historical-round-recap";
import type { Course, Player, RoundSnapshot } from "../lib/types";

const expenses = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };
const course: Course = {
  id: "course-history",
  name: "Campo guardado",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1,
    par: 4,
    strokeIndex: index + 1,
    yards: 400 + index,
  })),
};
const players: Player[] = [
  { id: "plus", name: "Plus", handicap: -1, accountUserId: "user-plus" },
  { id: "missing", name: "Pendiente", handicap: null, accountUserId: "user-missing" },
];

function snapshot(patch: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    id: "round-history",
    date: "2026-09-06",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Plus",
    ownerId: "plus",
    lifecycleState: "completed",
    roundHoles: 9,
    startHole: 1,
    betResult: 100,
    expenses,
    expenseTotal: 50,
    netResult: 50,
    categoryResults: {},
    players,
    courseSnapshot: course,
    ...patch,
  };
}

function parScores(order: readonly number[]) {
  return Object.fromEntries(order.map((hole) => [hole, { plus: 4, missing: 4 }]));
}

test("derives a nine-hole back-nine recap and preserves plus versus missing HCP honestly", () => {
  const order = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const recap = buildHistoricalRoundRecap(snapshot({ startHole: 10, order, scores: parScores(order) }));

  assert.equal(recap.golf?.holeCount, 9);
  assert.equal(recap.golf?.startHole, 10);
  assert.deepEqual(recap.golf?.order, order);
  assert.equal(recap.golf?.status, "complete");
  assert.deepEqual(recap.golf?.scorecard.map((hole) => hole.number), order);
  const plus = recap.golf?.leaderboard.find((row) => row.playerId === "plus");
  const missing = recap.golf?.leaderboard.find((row) => row.playerId === "missing");
  assert.deepEqual(
    { handicap: plus?.handicap, label: plus?.handicapLabel, gross: plus?.gross, net: plus?.net, grossToPar: plus?.grossRelativeToPar, netToPar: plus?.netRelativeToPar },
    { handicap: -1, label: "+1", gross: 36, net: 37, grossToPar: 0, netToPar: 1 },
  );
  assert.equal(missing?.handicap, null);
  assert.equal(missing?.handicapLabel, "Sin capturar");
  assert.equal(missing?.gross, 36);
  assert.equal("net" in (missing || {}), false);
  assert.equal("netRelativeToPar" in (missing || {}), false);
});

test("supports both 18-hole starting orders and rejects contradictory persisted geometry", () => {
  const fromTen = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const recap = buildHistoricalRoundRecap(snapshot({ roundHoles: 18, startHole: 10, order: undefined, scores: parScores(fromTen) }));
  assert.deepEqual(recap.golf?.order, fromTen);
  assert.equal(recap.golf?.status, "complete");

  const corrupt = buildHistoricalRoundRecap(snapshot({ roundHoles: 18, startHole: 10, order: Array.from({ length: 18 }, (_, index) => index + 1) }));
  assert.equal(corrupt.golf, undefined);
  assert.ok(corrupt.issues.some((issue) => issue.code === "invalid_geometry"));
});

test("rejects a course with duplicated stroke indexes in the played route", () => {
  const duplicatedSi = {
    ...course,
    holes: course.holes.map((hole) => hole.number === 2 ? { ...hole, strokeIndex: 1 } : hole),
  };
  const recap = buildHistoricalRoundRecap(snapshot({ courseSnapshot: duplicatedSi, order: undefined }));
  assert.equal(recap.golf, undefined);
  assert.ok(recap.issues.some((issue) => issue.code === "invalid_course"));
});

test("does not turn absent scores or optional stats into numeric zeroes", () => {
  const recap = buildHistoricalRoundRecap(snapshot({ order: undefined, scores: undefined, putts: undefined, advancedStats: undefined }));
  assert.equal(recap.golf?.status, "not_started");
  assert.ok(recap.golf?.leaderboard.every((row) => row.thru === 0));
  assert.ok(recap.golf?.leaderboard.every((row) => !("gross" in row) && !("net" in row) && !("grossRelativeToPar" in row)));
  assert.equal(recap.playerStats, undefined);
});

test("reports only explicitly captured putts and advanced metrics per player", () => {
  const recap = buildHistoricalRoundRecap(snapshot({
    order: undefined,
    putts: {
      1: { plus: 0, missing: null },
      2: { plus: 2, missing: 3 },
      3: { plus: 21, missing: Number.NaN },
      10: { plus: 99 },
    },
    advancedStats: {
      1: { plus: { fairwayHit: false, penaltyStrokes: 0 } },
      2: { plus: { greenInRegulation: true }, missing: { penaltyStrokes: 2 } },
    },
  }));
  const plus = recap.playerStats?.find((row) => row.playerId === "plus");
  const missing = recap.playerStats?.find((row) => row.playerId === "missing");
  assert.deepEqual(plus, {
    playerId: "plus",
    name: "Plus",
    putts: { total: 2, capturedHoles: 2 },
    advanced: {
      capturedHoles: 2,
      fairways: { hit: 0, attempts: 1 },
      greensInRegulation: { hit: 1, attempts: 1 },
      penalties: { strokes: 0, capturedHoles: 1 },
    },
  });
  assert.deepEqual(missing, {
    playerId: "missing",
    name: "Pendiente",
    putts: { total: 3, capturedHoles: 1 },
    advanced: { capturedHoles: 1, penalties: { strokes: 2, capturedHoles: 1 } },
  });
});

test("derives scoring categories only from validated persisted scores", () => {
  const recap = buildHistoricalRoundRecap(snapshot({
    order: undefined,
    scores: {
      1: { plus: 4 },
      2: { plus: 3 },
      3: { plus: 2 },
      4: { plus: 5 },
      5: { plus: 6 },
      6: { plus: Number.NaN },
    },
  }));
  assert.deepEqual(recap.playerStats, [{
    playerId: "plus",
    name: "Plus",
    scoring: { scoredHoles: 5, pars: 1, birdies: 1, eaglesOrBetter: 1, bogeys: 1, doublesPlus: 1 },
  }]);
  assert.ok(recap.issues.some((issue) => issue.code === "invalid_scores"));
});

test("rejects oversized scores and unknown score identities before ranking", () => {
  const oversized = buildHistoricalRoundRecap(snapshot({
    order: undefined,
    scores: { 1: { plus: Number.MAX_VALUE, missing: 4 } },
  }));
  assert.equal(oversized.golf?.leaderboard.find((row) => row.playerId === "plus")?.gross, undefined);
  assert.equal(oversized.golf?.leaderboard.find((row) => row.playerId === "missing")?.gross, 4);
  assert.ok(oversized.issues.some((issue) => issue.code === "invalid_scores"));

  const unknown = buildHistoricalRoundRecap(snapshot({ order: undefined, scores: { 1: { plus: 4, ghost: 4 } } }));
  assert.equal(unknown.golf, undefined);
  assert.ok(unknown.issues.some((issue) => issue.code === "invalid_scores"));
});

test("any malformed player row prevents ranking even when other players look valid", () => {
  const recap = buildHistoricalRoundRecap(snapshot({
    players: [...players, { id: "", name: "Corrupto", handicap: 0 }],
    order: undefined,
    scores: { 1: { plus: 4, missing: 4 } },
  }));
  assert.equal(recap.golf, undefined);
  assert.ok(recap.issues.some((issue) => issue.code === "invalid_players"));
});

test("accepts only a complete finite zero-sum player ledger and labels transfers as suggestions", () => {
  const recap = buildHistoricalRoundRecap(snapshot({ playerBalances: { plus: 250, missing: -250 } }));
  assert.deepEqual(recap.settlement?.balances.map(({ playerId, name, amount }) => ({ playerId, name, amount })), [
    { playerId: "plus", name: "Plus", amount: 250 },
    { playerId: "missing", name: "Pendiente", amount: -250 },
  ]);
  assert.deepEqual(recap.settlement?.suggestedTransfers.map(({ kind, fromPlayerId, fromName, toPlayerId, toName, amount }) => ({ kind, fromPlayerId, fromName, toPlayerId, toName, amount })), [{
    kind: "suggestion",
    fromPlayerId: "missing",
    fromName: "Pendiente",
    toPlayerId: "plus",
    toName: "Plus",
    amount: 250,
  }]);
  assert.match(recap.settlement?.notice || "", /Sugerencias matemáticas/);
  assert.match(recap.settlement?.notice || "", /no confirman deuda ni pago/);
  assert.doesNotMatch(JSON.stringify(recap.settlement), /pagad[oa]|paid/i);
});

test("rejects non-finite, unbalanced, empty and runtime-null player ledgers", () => {
  for (const playerBalances of [
    { plus: 100, missing: -99 },
    { plus: Number.NaN, missing: 0 },
    {},
    null,
  ]) {
    const recap = buildHistoricalRoundRecap(snapshot({ playerBalances: playerBalances as Record<string, number> }));
    assert.equal(recap.settlement, undefined);
    assert.ok(recap.issues.some((issue) => issue.code === "invalid_player_balances"));
  }
  const legacy = buildHistoricalRoundRecap(snapshot({ playerBalances: undefined, betResult: 700 }));
  assert.equal(legacy.settlement, undefined);
  assert.equal(legacy.issues.some((issue) => issue.code === "invalid_player_balances"), false);
});

test("requires every round player and rejects unsupported extra ledger identities", () => {
  const missingPlayer = buildHistoricalRoundRecap(snapshot({ playerBalances: { plus: 0, ghost: 0 } }));
  assert.equal(missingPlayer.settlement, undefined);
  assert.ok(missingPlayer.issues.some((issue) => issue.code === "invalid_player_balances"));

  const unsupportedExtra = buildHistoricalRoundRecap(snapshot({ playerBalances: { plus: 100, missing: -100, ghost: 0 } }));
  assert.equal(unsupportedExtra.settlement, undefined);
  assert.ok(unsupportedExtra.issues.some((issue) => issue.code === "invalid_player_balances"));
});

test("allows only persisted personal-result extras and preserves their external names", () => {
  const canonical = buildHistoricalRoundRecap(snapshot({
    playerBalances: { plus: 100, missing: 0, "personal:daniel": -100 },
    personalOpponentResults: [{
      betId: "personal-1",
      mode: "nassau_individual",
      modeLabel: "Nassau individual",
      opponentId: "personal:daniel",
      opponentName: "Daniel García",
      amount: 100,
      status: "final",
    }],
  }));
  assert.equal(canonical.settlement?.balances.find((row) => row.playerId === "personal:daniel")?.name, "Daniel García");
  assert.deepEqual(canonical.personalOpponents, [{
    source: "personal_opponent_results",
    opponentId: "personal:daniel",
    opponentName: "Daniel García",
    amount: 100,
    betId: "personal-1",
    mode: "nassau_individual",
    modeLabel: "Nassau individual",
    status: "final",
  }]);

  const legacy = buildHistoricalRoundRecap(snapshot({
    playerBalances: { plus: 50, missing: 0, "personal:legacy": -50 },
    personalResults: [{ rivalKey: "personal:legacy", rivalName: "Rival legado", totalMoney: 50, componentMoney: {} }],
  }));
  assert.equal(legacy.settlement?.balances.find((row) => row.playerId === "personal:legacy")?.name, "Rival legado");
  assert.equal(legacy.personalOpponents?.[0].source, "legacy_personal_results");
});

test("personal result guards omit corrupt cores and unsafe optional enums without recalculation", () => {
  const recap = buildHistoricalRoundRecap(snapshot({
    personalOpponentResults: [
      { opponentId: "external", opponentName: "Externo", amount: 20, mode: "invented", status: "paid" },
      { opponentId: "bad", opponentName: "", amount: Number.MAX_VALUE },
    ] as unknown as RoundSnapshot["personalOpponentResults"],
  }));
  assert.deepEqual(recap.personalOpponents, [{
    source: "personal_opponent_results",
    opponentId: "external",
    opponentName: "Externo",
    amount: 20,
  }]);
});

test("exposes only finite zero-sum persisted category balances with safe player labels", () => {
  const recap = buildHistoricalRoundRecap(snapshot({
    categoryBalances: {
      Skins: { plus: 100, missing: -100 },
      Personales: { plus: 50, "external-rival": -50 },
      Inactiva: {},
    },
  }));
  assert.deepEqual(recap.categoryBalances, [
    {
      category: "Skins",
      balances: [
        { playerId: "plus", name: "Plus", amount: 100 },
        { playerId: "missing", name: "Pendiente", amount: -100 },
      ],
    },
    {
      category: "Personales",
      balances: [
        { playerId: "plus", name: "Plus", amount: 50 },
        { playerId: "external-rival", name: "external-rival", amount: -50 },
      ],
    },
  ]);
  assert.equal(recap.issues.some((issue) => issue.code === "invalid_category_balances"), false);
});

test("omits the whole category breakdown when a category is corrupt or totals do not reconcile", () => {
  const corrupt = buildHistoricalRoundRecap(snapshot({
    categoryBalances: {
      Skins: { plus: 100, missing: -100 },
      Corrupta: { plus: Number.POSITIVE_INFINITY, missing: Number.NEGATIVE_INFINITY },
    },
  }));
  assert.equal(corrupt.categoryBalances, undefined);
  assert.deepEqual(corrupt.issues.filter((issue) => issue.code === "invalid_category_balances").map((issue) => issue.detail), ["Corrupta"]);

  const reconciled = buildHistoricalRoundRecap(snapshot({
    playerBalances: { plus: 150, missing: -150 },
    categoryBalances: {
      Skins: { plus: 100, missing: -100 },
      Nassau: { plus: 50, missing: -50 },
    },
  }));
  assert.equal(reconciled.categoryBalances?.length, 2);

  const mismatch = buildHistoricalRoundRecap(snapshot({
    playerBalances: { plus: 150, missing: -150 },
    categoryBalances: { Skins: { plus: 100, missing: -100 } },
  }));
  assert.equal(mismatch.categoryBalances, undefined);
  assert.ok(mismatch.issues.some((issue) => issue.code === "invalid_category_balances" && issue.detail === "player_balances_mismatch"));
});

test("an invalid present player ledger suppresses category balances and all-zero categories stay absent", () => {
  const invalidLedger = buildHistoricalRoundRecap(snapshot({
    playerBalances: { plus: 100, missing: -90 },
    categoryBalances: { Skins: { plus: 100, missing: -100 } },
  }));
  assert.equal(invalidLedger.categoryBalances, undefined);

  const zeroOnly = buildHistoricalRoundRecap(snapshot({ categoryBalances: { Skins: { plus: 0, missing: 0 } } }));
  assert.equal(zeroOnly.categoryBalances, undefined);
});

test("snapshot version 2 exposes financials only when ledger, totals and expenses reconcile", () => {
  const valid = buildHistoricalRoundRecap(snapshot({
    snapshotVersion: 2,
    playerBalances: { plus: 100, missing: -100 },
    betResult: 100,
    expenses: { ...expenses, caddie: 40, food: 10 },
    expenseTotal: 50,
    netResult: 50,
  }));
  assert.deepEqual(valid.financials, { betResult: 100, expenseTotal: 50, netResult: 50 });
  assert.equal(valid.issues.some((issue) => issue.code === "invalid_financials"), false);

  const corruptions: Partial<RoundSnapshot>[] = [
    { playerBalances: { plus: 90, missing: -90 } },
    { netResult: 51 },
    { expenseTotal: 49 },
    { expenses: { ...expenses, caddie: -1 } },
    { expenses: { ...expenses, caddie: Number.MAX_VALUE }, expenseTotal: Number.MAX_VALUE },
  ];
  for (const corruption of corruptions) {
    const recap = buildHistoricalRoundRecap(snapshot({
      snapshotVersion: 2,
      playerBalances: { plus: 100, missing: -100 },
      betResult: 100,
      expenses: { ...expenses, caddie: 40, food: 10 },
      expenseTotal: 50,
      netResult: 50,
      ...corruption,
    }));
    assert.equal(recap.financials, undefined);
    assert.ok(recap.issues.some((issue) => issue.code === "invalid_financials"));
  }
});

test("settlement and categories are final-only while missing legacy lifecycle normalizes completed", () => {
  const legacy = buildHistoricalRoundRecap(snapshot({
    lifecycleState: undefined,
    playerBalances: { plus: 100, missing: -100 },
    categoryBalances: { Skins: { plus: 100, missing: -100 } },
  }));
  assert.equal(legacy.meta.lifecycleState, "completed");
  assert.ok(legacy.settlement);
  assert.ok(legacy.categoryBalances);

  for (const lifecycleState of ["draft", "live", "cancelled"] as const) {
    const recap = buildHistoricalRoundRecap(snapshot({
      lifecycleState,
      playerBalances: { plus: 100, missing: -100 },
      categoryBalances: { Skins: { plus: 100, missing: -100 } },
    }));
    assert.equal(recap.settlement, undefined);
    assert.equal(recap.categoryBalances, undefined);
    assert.ok(recap.issues.some((issue) => issue.code === "non_final_round"));
  }
});

test("never reads untrusted resultDetails and does not mutate the snapshot", () => {
  const input = snapshot({ playerBalances: { plus: 25, missing: -25 } });
  Object.defineProperty(input, "resultDetails", {
    enumerable: true,
    get() { throw new Error("resultDetails must not be trusted"); },
  });
  const beforePlayers = structuredClone(input.players);
  assert.doesNotThrow(() => buildHistoricalRoundRecap(input));
  const recap = buildHistoricalRoundRecap(input);
  assert.equal(recap.settlement?.balances[0].amount, 25);
  assert.deepEqual(input.players, beforePlayers);
});

test("fails closed for corrupt and unsupported legacy shapes without throwing", () => {
  const values = [
    null,
    [],
    "round",
    snapshot({ order: [1, 1, 2, 3, 4, 5, 6, 7, 8] }),
    snapshot({ courseSnapshot: { ...course, holes: [] } }),
    snapshot({ players: [{ id: "duplicate", name: "One", handicap: 0 }, { id: "duplicate", name: "Two", handicap: 1 }] }),
  ];
  for (const value of values) {
    assert.doesNotThrow(() => buildHistoricalRoundRecap(value as RoundSnapshot));
    const recap = buildHistoricalRoundRecap(value as RoundSnapshot);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      assert.deepEqual(recap, { meta: {}, issues: [{ code: "invalid_snapshot" }] });
    } else {
      assert.ok(recap.issues.length > 0);
    }
  }
  const duplicatePlayers = buildHistoricalRoundRecap(values.at(-1) as RoundSnapshot);
  assert.equal(duplicatePlayers.golf, undefined);
});
