import assert from "node:assert/strict";
import test from "node:test";
import { calculateSupplementalBets, createSupplementalBet } from "../lib/supplemental-bets";
import { matrixFixture } from "./fixtures/games-matrix";

for (const invalid of [NaN, Infinity, -Infinity, -1, 0.5]) {
  test(`minimum putts rejects invalid captured putt count ${invalid}`, () => {
    const f = matrixFixture({ id: "invalid-putts", ties: true });
    f.putts[1][f.ids[0]] = invalid;
    const bet = createSupplementalBet("minimum_putts", f.players, "invalid-putts");
    const result = calculateSupplementalBets([bet], f.players, f.course, f.scores, f.putts, f.order);
    assert.equal(result.results[0].complete, false);
    assert.ok(Object.values(result.balances).every((amount) => amount === 0));
  });
}

for (const invalid of [NaN, Infinity, -Infinity, -1, 0, 0.5]) {
  test(`Dollar a Stroke ignores invalid captured gross score ${invalid}`, () => {
    const f = matrixFixture({ id: "invalid-gross", captured: 1 });
    f.scores[1][f.ids[0]] = invalid;
    const bet = createSupplementalBet("dollar_stroke", f.players, "invalid-gross");
    const result = calculateSupplementalBets([bet], f.players, f.course, f.scores, {}, f.order);
    assert.equal(result.results[0].complete, false);
    assert.equal(result.results[0].audit?.playedHoles, 0);
    assert.ok(Object.values(result.balances).every((amount) => amount === 0));
  });
  for (const type of ["individual_pressures", "team_pressures"] as const) {
    test(`${type} cannot settle invalid captured gross score ${invalid}`, () => {
      const f = matrixFixture({ id: "invalid-pressure", ties: true, handicaps: [0, 0, 0, 0] });
      f.scores[1][f.ids[0]] = invalid;
      const bet = createSupplementalBet(type, f.players, "invalid-pressure");
      const result = calculateSupplementalBets([bet], f.players, f.course, f.scores, {}, f.order);
      assert.equal(result.results[0].complete, false);
      assert.ok(Object.values(result.balances).every((amount) => amount === 0));
    });
  }
}

for (const defect of ["missing", "duplicate", "invalid-par"] as const) {
  test(`Chicago rejects ${defect} course definition without throwing or settling`, () => {
    const f = matrixFixture();
    if (defect === "missing") f.course.holes = f.course.holes.filter((hole) => hole.number !== 1);
    if (defect === "duplicate") f.course.holes.push({ ...f.course.holes[0] });
    if (defect === "invalid-par") f.course.holes[0].par = Number.NaN;
    const bet = createSupplementalBet("chicago", f.players, "bad-card");
    const result = calculateSupplementalBets([bet], f.players, f.course, f.scores, {}, f.order);
    assert.equal(result.results[0].complete, false);
    assert.ok(Object.values(result.balances).every((amount) => amount === 0));
  });
}

test("valid zero putts (chip-in) still wins; integer high putts stay valid", () => {
  const f = matrixFixture({ id: "valid-putts", ties: true });
  f.putts[1][f.ids[0]] = 0;
  f.putts[1][f.ids[1]] = 15;
  const bet = createSupplementalBet("minimum_putts", f.players, "zero-valid");
  const result = calculateSupplementalBets([bet], f.players, f.course, f.scores, f.putts, f.order);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { "qa-a": 150, "qa-b": -50, "qa-c": -50, "qa-d": -50 });
});
