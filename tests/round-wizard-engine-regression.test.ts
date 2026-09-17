import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import { calculateFoursomes, playOrder, segmentDefinitions } from "../lib/engine";
import { upsertRoundSnapshot } from "../lib/round-editing";
import { readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import type { PlayerTeeAssignmentSnapshot, RoundHandicapBasis, RoundSnapshot } from "../lib/types";
import {
  evaluateWizardEngineFixture, wizardEngineFixture, type WizardEngineFixture,
} from "./fixtures/round-wizard-engine";

// Golden outputs captured with the engines at f6dd9008ab7b66618f8941edceff752edff1f078,
// before the wizard changes. SHA-256 covers every result detail (not just final
// balances): scores, handicap allocations, pressures, winner decisions and
// transfers. Never regenerate these values simply to make a UX change pass.
const beforeWizard = [
  { start: 1, basis: "relative", hash: "b0cf5b6714dcfb44eae7b9ddfcf9844b21736f920eecd794bd320fecdf6beedf", balances: { said: -2865, cuau: -8415, armando: 11830, jesus: -550 } },
  { start: 1, basis: "course", hash: "8e2ad74f2d3f94b4d9a1dc71db47e620ca4e74606e97173cbb0e1c803e50b589", balances: { said: -3565, cuau: -7715, armando: 12370, jesus: -1090 } },
  { start: 10, basis: "relative", hash: "068219cbc7833257e46b9ed1deb7ee9f7c8aff90ccd1837c2d94f7e02c2b919f", balances: { said: -4115, cuau: -7665, armando: 13580, jesus: -1800 } },
  { start: 10, basis: "course", hash: "6131732de5f2f721f0a092ec1fd580b761f2aa5b474feafb07ba0693fc537e41", balances: { said: -3265, cuau: -7215, armando: 12070, jesus: -1590 } },
] satisfies Array<{ start: 1 | 10; basis: RoundHandicapBasis; hash: string; balances: Record<string, number> }>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

for (const baseline of beforeWizard) {
  test(`wizard golden master: H${baseline.start}, ${baseline.basis}, identical engine/scoring/settlement outputs`, () => {
    const state = wizardEngineFixture(baseline.start, baseline.basis);
    const input = structuredClone(state);
    const result = evaluateWizardEngineFixture(state);
    assert.deepEqual(result.balances, baseline.balances);
    assert.equal(fingerprint(result), baseline.hash);
    assert.deepEqual(state, input, "calculations cannot mutate the reusable wizard draft");
    assert.deepEqual(result.board.map(({ playerId, gross, net }) => ({ playerId, gross, net })), [
      { playerId: "said", gross: 69, net: 65 }, { playerId: "cuau", gross: 76, net: 64 },
      { playerId: "armando", gross: 70, net: 54 }, { playerId: "jesus", gross: 78, net: 70 },
    ]);
    assert.equal(result.supplemental.results.length, 7, "all supported supplemental types are calculated");
    assert.ok(result.supplemental.results.every((bet) => bet.complete));
    assert.equal(result.animals.length, 3);
    assert.equal(Object.values(result.balances).reduce((total, amount) => total + amount, 0), 0);
    const afterTransfers: Record<string, number> = { ...result.balances };
    for (const transfer of result.transfers) {
      afterTransfers[transfer.fromPlayerId] += transfer.amount;
      afterTransfers[transfer.toPlayerId] -= transfer.amount;
    }
    assert.ok(Object.values(afterTransfers).every((amount) => amount === 0), "settlement clears every player's balance");
  });

  test(`wizard existing draft serialization preserves every engine input: H${baseline.start}, ${baseline.basis}`, () => {
    let state = wizardEngineFixture(baseline.start, baseline.basis);
    const original = structuredClone(state);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null };
    for (let reload = 0; reload < 6; reload += 1) {
      data.set(STORAGE_KEYS.draft, JSON.stringify(state));
      const restored = readStoredJson<WizardEngineFixture | null>(storage, STORAGE_KEYS.draft, null);
      assert.ok(restored);
      state = restored;
      assert.deepEqual(state, original);
      assert.equal(fingerprint(evaluateWizardEngineFixture(state)), baseline.hash);
      assert.equal(new Set(state.supplementalBets.map((bet) => bet.id)).size, 7);
      assert.equal(state.personalBets.length, 1);
      assert.equal(state.manualBets.length, 1);
    }
  });
}

for (const multiplier of [2, 3, 4, 5] as const) {
  test(`wizard H10 Foursome Match retains second played half ${multiplier}x plus multiple presses`, () => {
    const state = wizardEngineFixture(10, "relative");
    const order = playOrder(10);
    const players = state.players.map((player) => ({ ...player, handicap: 0 }));
    const scores = Object.fromEntries(order.map((hole) => [hole, { said: 4, cuau: 4, armando: 4, jesus: 4 }]));
    for (const hole of order.slice(0, 3)) scores[hole] = { said: 3, cuau: 3, armando: 4, jesus: 4 };
    for (const hole of order.slice(9, 13)) scores[hole] = { said: 4, cuau: 4, armando: 3, jesus: 3 };
    const config = {
      ...state.bets.foursome, mode: "match" as const, segmentSize: 18 as const,
      fixedValue: 500, pressSecond9: true, pressureMultiplier: multiplier, pressureNine: "holes_10_18" as const,
    };
    const segments = [{ ...segmentDefinitions(order, 18)[0], basePair: ["said", "cuau"] }];
    const result = calculateFoursomes(state.course, scores, players, config, segments, order);
    const match = result.matches[0];
    assert.ok(match.matchLegs);
    assert.deepEqual(Object.values(match.matchLegs).map((leg) => [leg.pointDiff, leg.multiplier, leg.money]), [
      [3, 1, 500], [-4, multiplier, -500 * multiplier], [-1, 1, -500],
    ]);
    assert.equal(match.pressureNine, "holes_1_9");
    const money = -500 * multiplier;
    assert.equal(match.totalMoney, money);
    assert.deepEqual(result.balances, { said: money, cuau: money, armando: -money, jesus: -money });
    const persistedConfig = JSON.parse(JSON.stringify(config)) as typeof config;
    assert.deepEqual(calculateFoursomes(state.course, scores, players, persistedConfig, segments, order), result);
    // Existing explicit presses replace (rather than double-charge) the legacy
    // second-nine multiplier. Preserve that rule when expanding the editor.
    const explicit = calculateFoursomes(state.course, scores, players, {
      ...config,
      matchPresses: [
        { id: "first", scope: "first", startHole: 10, multiplier: 2 },
        { id: "second", scope: "second", startHole: 1, multiplier },
        { id: "total", scope: "total", startHole: 1, multiplier: 5 },
      ],
    }, segments, order);
    assert.deepEqual(Object.values(explicit.matches[0].matchLegs!).map((leg) => leg.money), [500, -500, -500]);
    assert.deepEqual(explicit.matches[0].matchPresses?.map((press) => [press.startHole, press.multiplier, press.money]), [
      [10, 2, 1000], [1, multiplier, -500 * multiplier], [1, 5, -2500],
    ]);
    assert.equal(explicit.matches[0].totalMoney, -2000 - 500 * multiplier);
  });
}

test("wizard course/tee selection retains Index-to-playing-HCP formula and immutable started-round snapshot", () => {
  const state = wizardEngineFixture(10, "course");
  const account = { ...state.players[0], accountUserId: "wizard-account", handicapIndex: 10, handicapSource: "profile_index" as const };
  const guest = { ...state.players[1], handicap: 18, handicapSource: "manual" as const };
  const capturedAt = "2026-09-10T11:00:00.000Z";
  const tee: PlayerTeeAssignmentSnapshot = {
    playerId: account.id, courseId: state.course.id, teeId: "synthetic-white", teeName: "Fixture white",
    rating: 70.1, slope: 125, source: "catalog", capturedAt,
  };
  const applied = applyRoundCourseHandicaps([account, guest], [tee, { ...tee, playerId: guest.id }], state.course, capturedAt);
  assert.deepEqual(applied.map((player) => player.handicap), [9, 18]);
  assert.equal(applied[0].handicapIndex, 10);
  assert.equal(applied[0].courseHandicapSnapshot?.formulaVersion, "WHS-2024-COURSE-HANDICAP-V1");
  const restored = JSON.parse(JSON.stringify(applied)) as typeof applied;
  assert.deepEqual(applyRoundCourseHandicaps(restored, [{ ...tee, rating: 74, slope: 140 }], state.course, capturedAt, true), applied);
});

test("wizard draft edits never mutate an already persisted round snapshot or its settlement", () => {
  const state = wizardEngineFixture(10, "relative");
  const result = evaluateWizardEngineFixture(state);
  const expenses = { greenFee: 0, cartRental: 0, caddie: 0, food: 0, drinks: 0, other: 0 };
  const snapshot: RoundSnapshot = {
    id: "wizard-snapshot", date: "2026-09-10", courseName: state.course.name, teeName: state.course.teeName,
    ownerId: "said", ownerName: "Said", betResult: result.balances.said, netResult: result.balances.said,
    expenseTotal: 0, expenses, categoryResults: {}, courseSnapshot: state.course, players: state.players,
    scores: state.scores, betConfig: state.bets, personalBets: state.personalBets,
    supplementalBets: state.supplementalBets, manualBets: state.manualBets, order: state.order,
    segments: state.segments, playerBalances: result.balances, resultDetails: result,
  };
  const saved = upsertRoundSnapshot([], snapshot);
  const frozen = structuredClone(saved[0]);
  state.players[0].name = "Changed after save";
  state.bets.foursome.fixedValue = 9999;
  state.personalBets[0].baseValue = 9999;
  state.scores[10].said = 99;
  assert.deepEqual(saved[0], frozen);
  assert.equal(fingerprint(saved[0].resultDetails), beforeWizard[2].hash);
  assert.deepEqual(JSON.parse(JSON.stringify(saved))[0], JSON.parse(JSON.stringify(frozen)));
});
