import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBallFriend,
  calculateFoursomes,
  calculateManualBets,
  calculateMiniPolla,
  calculatePersonalBet,
  calculatePersonalBets,
  calculatePolla,
  calculateRabbits,
  calculateSkins,
  calculateUnits,
  expenseTotal,
  mergeBalances,
  normalizeHandicapMode,
  payoutWinnerTakesFromAll,
  playOrder,
  playingHandicap,
  segmentDefinitions,
} from "../lib/engine";
import type { BetConfig, Course, HoleScore, PersonalBet, Player } from "../lib/types";
import {
  historicalFoursomeCourse,
  historicalFoursomeMatchPoints,
  historicalFoursomePlayers,
  historicalFoursomeScores,
  historicalFoursomeSegments,
} from "./fixtures/foursome-historical";
import {
  fullRoundBallFriend,
  fullRoundBets,
  fullRoundCourse,
  fullRoundOrder,
  fullRoundPersonal,
  fullRoundPlayers,
  fullRoundScores,
  fullRoundSegments,
} from "./fixtures/full-round";

const players: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "cuau", name: "Cuau", handicap: 11 },
  { id: "armando", name: "Armando", handicap: 7 },
  { id: "jesus", name: "Jesús", handicap: 2 },
  { id: "raul", name: "Raúl", handicap: 11 },
];

const zeroHcpPlayers: Player[] = players.map((player) => ({ ...player, handicap: 0 }));

function makeCourse(pars = Array(18).fill(4), strokeIndexes = Array.from({ length: 18 }, (_, index) => index + 1)): Course {
  return {
    id: "test-course",
    name: "Test",
    teeName: "General",
    holes: pars.map((par, index) => ({ number: index + 1, par, strokeIndex: strokeIndexes[index] })),
  };
}

function scoresFor(holes: number[], values: Record<string, number>): Record<number, HoleScore> {
  return Object.fromEntries(holes.map((hole) => [hole, { ...values }]));
}

function betConfig(ids = players.map((player) => player.id)): BetConfig {
  return {
    rabbits: { enabled: true, value: 100, hcpPct: 80, decimals: "partial", accumulate: true, participantIds: ids },
    skins: { enabled: true, value: 50, hcpPct: 80, decimals: "partial", accumulate: true, participantIds: ids },
    units: { enabled: true, value: 100, participantIds: ids },
    foursome: { enabled: true, hcpPct: 100, decimals: "round", segmentSize: 9, mode: "fixed_points", fixedValue: 100, pointValue: 10, pressSecond9: false, participantIds: ids },
    ballFriend: { enabled: true, value: 10, hcpPct: 100, decimals: "round", maxScore: 9, participantIds: ids },
    polla: {
      first9: { enabled: true, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
      second9: { enabled: true, value: 200, hcpPct: 100, decimals: "round", participantIds: ids },
      total18: { enabled: true, value: 300, hcpPct: 100, decimals: "round", participantIds: ids },
    },
    miniPolla: { enabled: true, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
  };
}

test("playOrder supports 9 and 18 holes from hole 1 or 10", () => {
  assert.deepEqual(playOrder(1).slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(playOrder(10).slice(0, 9), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(playOrder(10), [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("Explicit HCP modes are deterministic at .4, .5 and .6", () => {
  const values = [7.4, 7.5, 7.6];
  assert.deepEqual(values.map((value) => playingHandicap(value, 100, "decimal")), [7.4, 7.5, 7.6]);
  assert.deepEqual(values.map((value) => playingHandicap(value, 100, "half_up")), [7, 8, 8]);
  assert.deepEqual(values.map((value) => playingHandicap(value, 100, "half_down")), [7, 7, 8]);
  assert.deepEqual(values.map((value) => playingHandicap(value, 100, "six_up")), [7, 7, 8]);
  assert.deepEqual(values.map((value) => playingHandicap(value, 100, "four_down")), [7, 8, 8]);
});

test("Saved legacy HCP modes retain their previous behavior", () => {
  assert.equal(normalizeHandicapMode("partial"), "decimal");
  assert.equal(normalizeHandicapMode("round"), "half_up");
  assert.equal(playingHandicap(7.5, 100, "partial"), 7.5);
  assert.equal(playingHandicap(7.5, 100, "round"), 8);
});

test("Conejos detects Said grabbing from the first hole with the documented score", () => {
  const course = makeCourse(Array(18).fill(4), [5, ...Array.from({ length: 17 }, (_, index) => index + 1).filter((value) => value !== 5)]);
  const scores = { 1: { said: 3, cuau: 5, armando: 5, jesus: 6, raul: 6 } };
  const result = calculateRabbits(course, scores, players, betConfig().rabbits, playOrder(1));
  assert.deepEqual(result.events[0], { hole: 1, type: "grab", playerId: "said" });
});

test("Conejos preserves its three-hole accumulation state machine", () => {
  const twoPlayers = zeroHcpPlayers.slice(0, 2);
  const cfg = betConfig(twoPlayers.map((player) => player.id)).rabbits;
  const scores = {
    1: { said: 4, cuau: 4 },
    2: { said: 4, cuau: 4 },
    3: { said: 4, cuau: 4 },
    4: { said: 3, cuau: 4 },
    5: { said: 3, cuau: 4 },
  };
  const result = calculateRabbits(makeCourse(), scores, twoPlayers, cfg, [1, 2, 3, 4, 5]);
  assert.equal(result.won.said, 2);
  assert.ok(result.events.some((event) => event.hole === 3 && event.type === "accumulate" && event.count === 2));
  assert.ok(result.events.some((event) => event.hole === 5 && event.type === "win" && event.playerId === "said" && event.count === 2));
});

test("Skins carries a tied hole into the next unique winner", () => {
  const twoPlayers = zeroHcpPlayers.slice(0, 2);
  const cfg = betConfig(twoPlayers.map((player) => player.id)).skins;
  const scores = { 1: { said: 4, cuau: 4 }, 2: { said: 3, cuau: 4 } };
  const result = calculateSkins(makeCourse(), scores, twoPlayers, cfg, [1, 2]);
  assert.equal(result.won.said, 2);
  assert.equal(result.events[1].count, 2);
});

test("Foursome uses low ball plus high ball and exposes live hole points", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const cfg = betConfig(four.map((player) => player.id)).foursome;
  const segments = [{ ...segmentDefinitions([1], 9)[0], basePair: ["said", "cuau"] }];
  const result = calculateFoursomes(
    makeCourse(),
    { 1: { said: 3, cuau: 5, armando: 4, jesus: 6 } },
    four,
    cfg,
    segments,
    [1],
  );
  assert.equal(result.matches[0].holePoints[0].points, 2);
  assert.equal(result.matches[0].pointDiff, 2);
  assert.equal(result.matches[0].totalMoney, 120);
  assert.deepEqual(result.balances, { said: 120, cuau: 120, armando: -120, jesus: -120 });
});

test("Foursome 18 doubles fixed and point economics only on holes 10–18 when pressed", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const order = playOrder(1);
  const scores = scoresFor(order, { said: 3, cuau: 5, armando: 4, jesus: 6 });
  const segment = [{ ...segmentDefinitions(order, 18)[0], basePair: ["said", "cuau"] }];
  const normalCfg = { ...betConfig(four.map((player) => player.id)).foursome, segmentSize: 18 as const };
  const pressedCfg = { ...normalCfg, pressSecond9: true };

  const normal = calculateFoursomes(makeCourse(), scores, four, normalCfg, segment, order);
  const pressed = calculateFoursomes(makeCourse(), scores, four, pressedCfg, segment, order);

  assert.equal(normal.matches[0].fixedMoney, 100);
  assert.equal(normal.matches[0].pointMoney, 360);
  assert.equal(normal.matches[0].totalMoney, 460);
  assert.equal(pressed.matches[0].first9PointDiff, 18);
  assert.equal(pressed.matches[0].second9PointDiff, 18);
  assert.equal(pressed.matches[0].fixedMoney, 300);
  assert.equal(pressed.matches[0].pointMoney, 540);
  assert.equal(pressed.matches[0].totalMoney, 840);
  assert.deepEqual(pressed.balances, { said: 840, cuau: 840, armando: -840, jesus: -840 });
});

test("Foursome Fantasma duplicates the third player and settles zero-sum among three", () => {
  const three = zeroHcpPlayers.slice(0, 3);
  const cfg = { ...betConfig(three.map((player) => player.id)).foursome, mode: "fixed_points" as const };
  const segments = [{ ...segmentDefinitions([1], 9)[0], basePair: ["said", "cuau"] }];
  const result = calculateFoursomes(
    makeCourse(),
    { 1: { said: 3, cuau: 4, armando: 5 } },
    three,
    cfg,
    segments,
    [1],
  );

  assert.deepEqual(result.matches[0].opponentPair, ["armando", "__foursome_ghost__"]);
  assert.equal(result.matches[0].ghostPlayerId, "armando");
  assert.equal(result.matches[0].holePoints[0].points, 2);
  assert.equal(result.matches[0].totalMoney, 120);
  assert.deepEqual(result.balances, { said: 120, cuau: 120, armando: -240 });
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("Foursome pressure uses the selected physical nine even when starting on H10", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const order = playOrder(10);
  const scores = scoresFor(order, { said: 3, cuau: 5, armando: 4, jesus: 6 });
  const segment = [{ ...segmentDefinitions(order, 18)[0], basePair: ["said", "cuau"] }];
  const base = { ...betConfig(four.map((player) => player.id)).foursome, segmentSize: 18 as const, pressSecond9: false };
  const holes1Pressed = calculateFoursomes(makeCourse(), scores, four, {
    ...base,
    pressureMultiplier: 3,
    pressureNine: "holes_1_9",
  }, segment, order);
  const holes10Pressed = calculateFoursomes(makeCourse(), scores, four, {
    ...base,
    pressureMultiplier: 2,
    pressureNine: "holes_10_18",
  }, segment, order);

  assert.equal(holes1Pressed.matches[0].fixedMoney, 400);
  assert.equal(holes1Pressed.matches[0].pointMoney, 720);
  assert.equal(holes10Pressed.matches[0].fixedMoney, 300);
  assert.equal(holes10Pressed.matches[0].pointMoney, 540);
});

test("Foursome ignores residual pressure settings in a standalone nine-hole round", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const order = playOrder(1).slice(0, 9);
  const scores = scoresFor(order, { said: 3, cuau: 5, armando: 4, jesus: 6 });
  const segment = [{ ...segmentDefinitions(order, 9)[0], basePair: ["said", "cuau"] }];
  const base = { ...betConfig(four.map((player) => player.id)).foursome, segmentSize: 9 as const };
  const normal = calculateFoursomes(makeCourse(), scores, four, base, segment, order);
  const residual = calculateFoursomes(makeCourse(), scores, four, {
    ...base,
    pressSecond9: true,
    pressureMultiplier: 3,
    pressureNine: "holes_1_9",
  }, segment, order);

  assert.equal(normal.matches[0].totalMoney, 280);
  assert.equal(residual.matches[0].pressureMultiplier, 1);
  assert.deepEqual(residual.balances, normal.balances);
});

test("Foursome histórico de cinco jugadores conserva los nueve matches y sus tres liquidaciones validadas", () => {
  const participantIds = historicalFoursomePlayers.map((player) => player.id);
  const base = {
    ...betConfig(participantIds).foursome,
    segmentSize: 6 as const,
    pressureMultiplier: 1 as const,
    pressureNine: "holes_10_18" as const,
  };
  const cases = [
    { mode: "fixed" as const, fixedValue: 200, pointValue: 0, expected: { said: -400, cuau: 800, armando: 600, jesus: -1400, raul: 400 } },
    { mode: "fixed_points" as const, fixedValue: 200, pointValue: 100, expected: { said: -800, cuau: 1400, armando: 1100, jesus: -2600, raul: 900 } },
    { mode: "points" as const, fixedValue: 0, pointValue: 100, expected: { said: -400, cuau: 600, armando: 500, jesus: -1200, raul: 500 } },
  ];

  for (const current of cases) {
    const result = calculateFoursomes(historicalFoursomeCourse, historicalFoursomeScores, historicalFoursomePlayers, { ...base, ...current }, historicalFoursomeSegments, playOrder(1));
    assert.deepEqual(result.matches.map((match) => match.pointDiff), historicalFoursomeMatchPoints);
    assert.deepEqual(result.balances, current.expected);
    assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
  }
});

test("Foursome rebasa HCP exclusivamente con los cuatro jugadores del match", () => {
  const comparison = [
    { id: "said", name: "Said", handicap: 0 },
    { id: "cuau", name: "Cuau", handicap: 11 },
    { id: "armando", name: "Armando", handicap: 7 },
    { id: "jesus", name: "Jesús", handicap: 2 },
  ];
  const withOutsideLow = [...comparison, { id: "raul", name: "Raúl", handicap: -1 }];
  const row = { said: 4, cuau: 4, armando: 4, jesus: 4, raul: 4 };
  const segment = [{ id: "match", startIndex: 0, endIndex: 0, basePair: ["said", "cuau"] }];
  const fourCfg = { ...betConfig(comparison.map((player) => player.id)).foursome, mode: "points" as const };
  const fiveCfg = { ...fourCfg, participantIds: withOutsideLow.map((player) => player.id) };
  const course = makeCourse(Array(18).fill(4), [3, 1, 2, ...Array.from({ length: 15 }, (_, index) => index + 4)]);
  const expected = calculateFoursomes(course, { 1: row }, comparison, fourCfg, segment, [1]);
  const actual = calculateFoursomes(course, { 1: row }, withOutsideLow, fiveCfg, segment, [1]);
  assert.equal(expected.matches[0].pointDiff, 0);
  assert.equal(actual.matches[0].pointDiff, expected.matches[0].pointDiff);
});

test("Foursome aplica el porcentaje HCP y limita cada hoyo de -2 a +2", () => {
  const four: Player[] = [
    { id: "a", name: "A", handicap: 0 },
    { id: "b", name: "B", handicap: 10 },
    { id: "c", name: "C", handicap: 0 },
    { id: "d", name: "D", handicap: 0 },
  ];
  const segment = [{ id: "match", startIndex: 0, endIndex: 1, basePair: ["a", "b"] }];
  const course = makeCourse(Array(18).fill(4), [6, 5, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  const scores = { 1: { a: 4, b: 4, c: 4, d: 4 }, 2: { a: 2, b: 2, c: 6, d: 6 } };
  const base = { ...betConfig(four.map((player) => player.id)).foursome, mode: "points" as const };
  const hundred = calculateFoursomes(course, scores, four, { ...base, hcpPct: 100 }, segment, [1, 2]);
  const fifty = calculateFoursomes(course, scores, four, { ...base, hcpPct: 50 }, segment, [1, 2]);
  assert.equal(hundred.matches[0].holePoints[0].points, 1);
  assert.equal(fifty.matches[0].holePoints[0].points, 0);
  assert.equal(hundred.matches[0].holePoints[1].points, 2);
  assert.equal(fifty.matches[0].holePoints[1].points, 2);
  assert.ok(hundred.matches[0].holePoints.every(({ points }) => points >= -2 && points <= 2));
});

test("Foursome expone dinero provisional sin liquidarlo antes de cerrar el segmento", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const cfg = betConfig(four.map((player) => player.id)).foursome;
  const segments = [{ id: "match", startIndex: 0, endIndex: 1, basePair: ["said", "cuau"] }];
  const result = calculateFoursomes(makeCourse(), { 1: { said: 3, cuau: 5, armando: 4, jesus: 6 } }, four, cfg, segments, [1, 2]);
  assert.equal(result.matches[0].complete, false);
  assert.equal(result.matches[0].completedHoles, 1);
  assert.equal(result.matches[0].totalMoney, 0);
  assert.equal(result.matches[0].provisionalFixedMoney, 100);
  assert.equal(result.matches[0].provisionalPointMoney, 20);
  assert.equal(result.matches[0].provisionalTotalMoney, 120);
  assert.deepEqual(result.balances, { said: 0, cuau: 0, armando: 0, jesus: 0 });
  assert.deepEqual(result.provisionalBalances, { said: 120, cuau: 120, armando: -120, jesus: -120 });
});

test("segmentos Foursome 3, 6, 9 y 18 cubren cada hoyo exactamente una vez", () => {
  for (const size of [3, 6, 9, 18] as const) {
    const definitions = segmentDefinitions(playOrder(10), size);
    const indexes = definitions.flatMap((segment) => Array.from({ length: segment.endIndex - segment.startIndex + 1 }, (_, offset) => segment.startIndex + offset));
    assert.deepEqual(indexes, Array.from({ length: 18 }, (_, index) => index));
  }
});

test("fixture integral de 18 hoyos mantiene todos los motores coordinados y settlement cero-sum", () => {
  const rabbits = calculateRabbits(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.rabbits, fullRoundOrder);
  const skins = calculateSkins(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.skins, fullRoundOrder);
  const units = calculateUnits(fullRoundPlayers, [{ id: "sandy", hole: 1, playerId: "said", amount: 1, label: "Sandy Par" }], fullRoundBets.units, fullRoundCourse, fullRoundScores, fullRoundOrder);
  const foursomes = calculateFoursomes(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.foursome, fullRoundSegments, fullRoundOrder);
  const ballFriend = calculateBallFriend(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.ballFriend, fullRoundBallFriend, fullRoundOrder);
  const polla = calculatePolla(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.polla, fullRoundOrder);
  const mini = calculateMiniPolla(fullRoundCourse, fullRoundScores, fullRoundPlayers, fullRoundBets.miniPolla, fullRoundOrder);
  const personals = calculatePersonalBets([fullRoundPersonal], "said", fullRoundPlayers, fullRoundCourse, fullRoundScores, fullRoundOrder);
  const rabbitBalances = payoutWinnerTakesFromAll(fullRoundPlayers, rabbits.won, fullRoundBets.rabbits.value);
  const skinBalances = payoutWinnerTakesFromAll(fullRoundPlayers, skins.won, fullRoundBets.skins.value);
  const settlement = mergeBalances(fullRoundPlayers, rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, polla.balances, mini.balances, personals.balances);

  assert.equal(foursomes.matches.length, 3);
  assert.ok(foursomes.matches.every((match) => match.complete && match.completedHoles === 6));
  assert.equal(ballFriend.details.length, 18);
  assert.ok(polla.details.every((detail) => detail.complete));
  assert.ok(mini.details.every((detail) => detail.complete));
  assert.equal(personals.results.length, 1);
  assert.ok(Object.values(settlement).every(Number.isFinite));
  assert.equal(Object.values(settlement).reduce((sum, amount) => sum + amount, 0), 0);
});

test("fixture integral actualiza cada hoyo en vivo sin perder scores ni romper cero-sum", () => {
  for (let through = 1; through <= 18; through += 1) {
    const holes = fullRoundOrder.slice(0, through);
    const liveScores = Object.fromEntries(holes.map((hole) => [hole, fullRoundScores[hole]]));
    const foursomes = calculateFoursomes(fullRoundCourse, liveScores, fullRoundPlayers, fullRoundBets.foursome, fullRoundSegments, fullRoundOrder);
    const ballFriend = calculateBallFriend(fullRoundCourse, liveScores, fullRoundPlayers, fullRoundBets.ballFriend, fullRoundBallFriend, fullRoundOrder);
    const personals = calculatePersonalBets([fullRoundPersonal], "said", fullRoundPlayers, fullRoundCourse, liveScores, fullRoundOrder);

    assert.ok(holes.every((hole) => fullRoundPlayers.every((player) => typeof liveScores[hole]?.[player.id] === "number")));
    assert.ok(foursomes.matches.flatMap((match) => match.holePoints).every(({ points }) => points >= -2 && points <= 2));
    assert.equal(Object.values(foursomes.provisionalBalances).reduce((sum, amount) => sum + amount, 0), 0);
    assert.equal(Object.values(ballFriend.balances).reduce((sum, amount) => sum + amount, 0), 0);
    assert.equal(Object.values(personals.provisionalBalances).reduce((sum, amount) => sum + amount, 0), 0);
  }
});

test("Bola Amiga flips the opposing two-digit score on birdie or better", () => {
  const four = zeroHcpPlayers.slice(0, 4);
  const cfg = betConfig(four.map((player) => player.id)).ballFriend;
  const result = calculateBallFriend(
    makeCourse(),
    { 1: { said: 3, cuau: 5, armando: 4, jesus: 6 } },
    four,
    cfg,
    { 1: { teamA: ["said", "cuau"] } },
    [1],
  );
  assert.equal(result.details[0].numberA, 35);
  assert.equal(result.details[0].numberB, 64);
  assert.equal(result.details[0].pointDiff, 29);
  assert.deepEqual(result.balances, { said: 290, cuau: 290, armando: -290, jesus: -290 });
});

test("Unidades combines automatic and manual events without duplicating HIO", () => {
  const twoPlayers = zeroHcpPlayers.slice(0, 2);
  const pars = [4, 5, 5, 3, ...Array(14).fill(4)];
  const scores = {
    1: { said: 3, cuau: 4 },
    2: { said: 3, cuau: 5 },
    3: { said: 2, cuau: 5 },
    4: { said: 1, cuau: 3 },
  };
  const cfg = betConfig(twoPlayers.map((player) => player.id)).units;
  const result = calculateUnits(
    twoPlayers,
    [
      { id: "sandy", hole: 1, playerId: "said", amount: 1, label: "Sandy Par" },
      { id: "copa", hole: 2, playerId: "said", amount: -1, label: "Copa" },
    ],
    cfg,
    makeCourse(pars),
    scores,
    [1, 2, 3, 4],
  );
  assert.equal(result.autoByHole[1].said, 1);
  assert.equal(result.autoByHole[2].said, 2);
  assert.equal(result.autoByHole[3].said, 3);
  assert.equal(result.autoByHole[4].said, 3);
  assert.equal(result.autoNet.said, 9);
  assert.equal(result.manualNet.said, 0);
  assert.equal(result.net.said, 9);
  assert.equal(result.registeredTotal, 11);
  assert.deepEqual(result.balances, { said: 900, cuau: -900 });
});

test("Unidades contributes nothing when disabled", () => {
  const twoPlayers = zeroHcpPlayers.slice(0, 2);
  const cfg = { ...betConfig(twoPlayers.map((player) => player.id)).units, enabled: false };
  const result = calculateUnits(twoPlayers, [{ id: "manual", hole: 1, playerId: "said", amount: 1 }], cfg, makeCourse(), { 1: { said: 3, cuau: 4 } }, [1]);
  assert.deepEqual(result.balances, { said: 0, cuau: 0 });
  assert.deepEqual(result.net, { said: 0, cuau: 0 });
  assert.equal(result.registeredTotal, 0);
});

test("Polla 1ª vuelta pays +400/-100 with five players and splits a two-way tie", () => {
  const order = playOrder(1).slice(0, 9);
  const cfg = betConfig().polla;
  const soloScores = scoresFor(order, { said: 3, cuau: 4, armando: 4, jesus: 4, raul: 4 });
  const solo = calculatePolla(makeCourse(), soloScores, zeroHcpPlayers, cfg, order);
  assert.deepEqual(solo.balances, { said: 400, cuau: -100, armando: -100, jesus: -100, raul: -100 });

  const tiedScores = scoresFor(order, { said: 3, cuau: 3, armando: 4, jesus: 4, raul: 4 });
  const tied = calculatePolla(makeCourse(), tiedScores, zeroHcpPlayers, cfg, order);
  assert.deepEqual(tied.balances, { said: 150, cuau: 150, armando: -100, jesus: -100, raul: -100 });
  assert.deepEqual(tied.details[0].winnerIds, ["said", "cuau"]);
});

test("Polla Nassau 18 pays all three independent components", () => {
  const order = playOrder(1);
  const scores = scoresFor(order, { said: 3, cuau: 4, armando: 4, jesus: 4, raul: 4 });
  const result = calculatePolla(makeCourse(), scores, zeroHcpPlayers, betConfig().polla, order);
  assert.equal(result.details.length, 3);
  assert.deepEqual(result.balances, { said: 2400, cuau: -600, armando: -600, jesus: -600, raul: -600 });
});

test("Polla components always use physical H1–9 and H10–18", () => {
  const order = playOrder(10);
  const scores = scoresFor(order, { said: 4, cuau: 4, armando: 4, jesus: 4, raul: 4 });
  for (const hole of Array.from({ length: 9 }, (_, index) => index + 1)) scores[hole].said = 3;
  const result = calculatePolla(makeCourse(), scores, zeroHcpPlayers, betConfig().polla, order);
  const first = result.details.find((detail) => detail.key === "first9")!;
  const second = result.details.find((detail) => detail.key === "second9")!;
  assert.deepEqual(first.holes, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(second.holes, [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(first.winnerIds, ["said"]);
  assert.equal(second.winnerIds.length, 5);
});

test("Polla de nueve hoyos saliendo por H10 liquida únicamente H10–18", () => {
  const order = playOrder(10).slice(0, 9);
  const scores = scoresFor(order, { said: 3, cuau: 4, armando: 4, jesus: 4, raul: 4 });
  const result = calculatePolla(makeCourse(), scores, zeroHcpPlayers, betConfig().polla, order);

  assert.deepEqual(result.details.map((detail) => detail.key), ["second9"]);
  assert.deepEqual(result.details[0].holes, [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(result.balances, { said: 800, cuau: -200, armando: -200, jesus: -200, raul: -200 });
});

test("Each Polla component honors its own switch, value and participants", () => {
  const order = playOrder(1);
  const config = betConfig().polla;
  config.first9 = { ...config.first9, value: 10, hcpPct: 0, participantIds: ["said", "cuau"] };
  config.second9 = { ...config.second9, enabled: false };
  config.total18 = { ...config.total18, value: 100, hcpPct: 0, participantIds: players.map((player) => player.id) };
  const scores = scoresFor(order, { said: 3, cuau: 4, armando: 4, jesus: 4, raul: 4 });
  const result = calculatePolla(makeCourse(), scores, zeroHcpPlayers, config, order);

  assert.deepEqual(result.details.map((detail) => [detail.key, detail.value]), [["first9", 10], ["total18", 100]]);
  assert.deepEqual(result.balances, { said: 410, cuau: -110, armando: -100, jesus: -100, raul: -100 });
});

test("A final unpaid Skins carry is not counted as a won skin", () => {
  const twoPlayers = zeroHcpPlayers.slice(0, 2);
  const cfg = betConfig(twoPlayers.map((player) => player.id)).skins;
  const result = calculateSkins(makeCourse(), { 1: { said: 4, cuau: 4 } }, twoPlayers, cfg, [1]);
  assert.equal(Object.values(result.won).reduce((total, count) => total + count, 0), 0);
  assert.equal(result.carry, 2);
});

test("Mini Polla always uses the last three holes actually played", () => {
  const cfg = betConfig().miniPolla;
  const nineFromTen = playOrder(10).slice(0, 9);
  const eighteenFromTen = playOrder(10);
  const nine = calculateMiniPolla(makeCourse(), {}, zeroHcpPlayers, cfg, nineFromTen);
  const eighteen = calculateMiniPolla(makeCourse(), {}, zeroHcpPlayers, cfg, eighteenFromTen);
  assert.deepEqual(nine.details[0].holes, [16, 17, 18]);
  assert.deepEqual(eighteen.details[0].holes, [7, 8, 9]);
});

test("Personales on nine holes pays only Match 9 and Medal 9", () => {
  const order = playOrder(1).slice(0, 9);
  const bet: PersonalBet = {
    id: "personal",
    rivalMode: "group",
    rivalPlayerId: "cuau",
    rivalName: "Cuau",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 0,
    back9Multiplier: 2,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  };
  const scores = scoresFor(order, { said: 3, cuau: 4 });
  const result = calculatePersonalBet(bet, "said", makeCourse(), scores, order);
  assert.equal(result.totalMoney, 200);
  assert.deepEqual(result.componentMoney, { match1: 100, medal1: 100, match2: 0, medal2: 0, match18: 0, medal18: 0 });
  assert.equal(result.liveComponents.find((component) => component.key === "match1")?.complete, true);
  assert.equal(result.liveComponents.find((component) => component.key === "match1")?.matchState, 9);
  assert.equal(result.liveComponents.find((component) => component.key === "medal1")?.ownerNetTotal, 27);
  assert.equal(result.liveComponents.find((component) => component.key === "medal1")?.rivalNetTotal, 36);
});

test("Personales exposes auditable live Match and Medal state without settling early", () => {
  const order = playOrder(1).slice(0, 9);
  const bet: PersonalBet = {
    id: "personal-live",
    rivalMode: "group",
    rivalPlayerId: "cuau",
    rivalName: "Cuau",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 0,
    back9Multiplier: 1,
    components: { match1: true, medal1: true, match2: false, medal2: false, match18: false, medal18: false },
  };
  const result = calculatePersonalBet(bet, "said", makeCourse(), {
    1: { said: 3, cuau: 4 },
    2: { said: 4, cuau: 4 },
  }, order);
  const match = result.liveComponents.find((component) => component.key === "match1")!;
  const medal = result.liveComponents.find((component) => component.key === "medal1")!;

  assert.equal(result.totalMoney, 0);
  assert.equal(match.complete, false);
  assert.equal(match.matchState, 1);
  assert.equal(match.leader, "owner");
  assert.equal(match.ownerMoney, 100);
  assert.deepEqual(match.holeResults.map(({ hole, winner }) => ({ hole, winner })), [
    { hole: 1, winner: "owner" },
    { hole: 2, winner: "tie" },
  ]);
  assert.equal(medal.medalDiff, 1);
  assert.equal(medal.ownerNetTotal, 7);
  assert.equal(medal.rivalNetTotal, 8);
  assert.equal(medal.ownerMoney, 100);

  const aggregate = calculatePersonalBets([bet], "said", zeroHcpPlayers.slice(0, 2), makeCourse(), {
    1: { said: 3, cuau: 4 },
    2: { said: 4, cuau: 4 },
  }, order);
  assert.deepEqual(aggregate.balances, { said: 0, cuau: 0 });
  assert.deepEqual(aggregate.provisionalBalances, { said: 200, cuau: -200 });
});

test("Personales pressure applies to second PLAYED nine, including H10 starts (validated Nassau rule)", () => {
  const order = playOrder(10);
  const bet: PersonalBet = {
    id: "physical-pressure",
    rivalMode: "group",
    rivalPlayerId: "cuau",
    rivalName: "Cuau",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 3,
    pressureNine: "holes_1_9",
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: false, medal18: false },
  };
  const scores = scoresFor(order, { said: 3, cuau: 4 });
  const result = calculatePersonalBet(bet, "said", makeCourse(), scores, order);
  assert.equal(result.componentMoney.match1, 100);
  assert.equal(result.componentMoney.medal1, 100);
  assert.equal(result.componentMoney.match2, 300);
  assert.equal(result.componentMoney.medal2, 300);
  assert.equal(result.totalMoney, 800);
  assert.equal(result.pressureNine, "holes_1_9");
});

test("Personales keeps a stable key for a saved external rival", () => {
  const order = playOrder(1).slice(0, 9);
  const bet: PersonalBet = {
    id: "bet-1",
    rivalMode: "external",
    externalRivalId: "daniel-stable",
    rivalName: "Daniel",
    externalScores: Object.fromEntries(order.map((hole) => [hole, 4])),
    baseValue: 100,
    advantageReceiver: "owner",
    advantageStrokes: 0,
    back9Multiplier: 1,
    components: { match1: true, medal1: true, match2: false, medal2: false, match18: false, medal18: false },
  };
  const scores = scoresFor(order, { said: 3 });
  const result = calculatePersonalBet(bet, "said", makeCourse(), scores, order);
  assert.equal(result.rivalId, "personal:daniel-stable");
  assert.equal(result.rivalName, "Daniel");
  assert.equal(result.totalMoney, 200);
});

test("Manual bets only enter the total when they close at zero", () => {
  const three = zeroHcpPlayers.slice(0, 3);
  const result = calculateManualBets(three, [
    { id: "valid", name: "Válida", amounts: { said: 500, cuau: -200, armando: -300 } },
    { id: "invalid", name: "Inválida", amounts: { said: 100, cuau: -50, armando: 0 } },
  ]);
  assert.equal(result.details[0].valid, true);
  assert.equal(result.details[1].valid, false);
  assert.deepEqual(result.balances, { said: 500, cuau: -200, armando: -300 });
});

test("Final balances retain external rivals and remain exact and zero-sum", () => {
  const result = mergeBalances(zeroHcpPlayers.slice(0, 2), { said: 250, cuau: -100, "personal:daniel": -150 });
  assert.deepEqual(result, { said: 250, cuau: -100, "personal:daniel": -150 });
  assert.equal(Object.values(result).reduce((sum, amount) => sum + amount, 0), 0);
});

test("Expense total uses exactly the V2.4 categories", () => {
  assert.equal(expenseTotal({ caddie: 100, food: 200, drinks: 300, greenFee: 400, cartRental: 500, other: 600 }), 2100);
});
