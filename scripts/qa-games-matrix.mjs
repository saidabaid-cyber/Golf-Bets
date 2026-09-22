/** Run after `tsc -p tsconfig.test.json`. Emits JSON; no network/DB/file writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { matrixFixture, evaluateMatrix, matrixInventory, scenariosFor } = require("../.test-dist/tests/fixtures/games-matrix.js");
const { calculateMonkey } = require("../.test-dist/lib/engine.js");
let revision = null;
try { revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(); } catch { /* Git may not be on PATH; never guess a SHA. */ }
const failures = [];
const modalities = matrixInventory.map((entry) => {
  const scenarios = scenariosFor(entry.id).map((scenario) => {
    try {
      const fixture = matrixFixture(scenario);
      const stored = JSON.stringify(fixture);
      const result = evaluateMatrix(entry.id, fixture);
      const values = Object.values(result.balances);
      assert.ok(values.every(Number.isFinite));
      assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0)) <= Math.max(1e-8, values.reduce((sum, value) => sum + Math.abs(value), 0) * 1e-12));
      assert.deepEqual(evaluateMatrix(entry.id, fixture), result);
      assert.deepEqual(evaluateMatrix(entry.id, JSON.parse(stored)), result);
      assert.equal(JSON.stringify(fixture), stored);
      if (scenario.ties || (scenario.captured === 0 && entry.id !== "manuals")) assert.ok(values.every((value) => value === 0));
      return { id: scenario.id, status: "PASS", nonzeroSettlement: values.some((value) => value !== 0) };
    } catch (error) {
      const failure = { modality: entry.id, scenario: scenario.id, message: error.message };
      failures.push(failure);
      return { id: scenario.id, status: "FAIL" };
    }
  });
  if (!scenarios.some((scenario) => scenario.nonzeroSettlement)) failures.push({ modality: entry.id, message: "No nonzero settlement exercised" });
  return { ...entry, scenarios };
});

const fixture = matrixFixture({ id: "monkey-oracle", handicaps: [0, 0, 0, 0] });
let monkeyOracleScenarios = 0;
for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) for (let c = 1; c <= 12; c++) {
  try {
    const result = calculateMonkey(fixture.course, { 1: { "qa-a": a, "qa-b": b, "qa-c": c } }, fixture.players, fixture.bets.monkey, [1]);
    const points = result.details[0].points;
    assert.equal(Object.values(points).reduce((sum, value) => sum + value, 0), 6);
    for (const id of fixture.ids.slice(0, 3)) assert.equal(result.balances[id], fixture.ids.slice(0, 3).filter((rival) => rival !== id).reduce((sum, rival) => sum + (points[id] - points[rival]) * fixture.stake, 0));
    monkeyOracleScenarios++;
  } catch (error) { failures.push({ modality: "monkey", gross: [a, b, c], message: error.message }); }
}

console.log(JSON.stringify({
  schemaVersion: 1, fixtureProvenance: "SYNTHETIC_MATHEMATICAL_ONLY", sourceRevision: revision,
  status: failures.length ? "FAIL" : "PASS", activeModalities: modalities.length,
  matrixScenarios: modalities.reduce((sum, entry) => sum + entry.scenarios.length, 0),
  monkeyOracleScenarios, skipped: 0, failures, modalities,
  invariants: ["finite zero-sum settlement", "same input same result", "replay does not accumulate", "serialized snapshot roundtrip", "no input mutation", "equal scores/handicaps/facts push", "uncaptured games do not settle", "nonzero settlement actually exercised", "Monkey conserves six points", "Monkey independent pairwise payment oracle"],
  ruleClarifications: [
    { status: "PENDING_RULE_CLARIFICATION", scope: "Abandonment outside explicit team_pressures.abandonedPlayerIds", question: "No common forfeiture rule exists in these contracts. Continue using incomplete-round semantics until a product rule defines withdrawal settlement." },
    { status: "PENDING_RULE_CLARIFICATION", scope: "Vegas integer concatenation with negative net or two-digit scores", question: "Existing arithmetic is preserved and tested for determinism/zero-sum. No new cap, sign rule, or concatenation rule is assumed." },
  ],
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
