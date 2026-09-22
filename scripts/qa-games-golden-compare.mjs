/**
 * Compare every valid synthetic Games matrix result against the frozen stable
 * engine. Run after compiling both worktrees with tsconfig.test.json.
 *
 * Usage: node scripts/qa-games-golden-compare.mjs <stable-worktree>
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const stableRoot = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(stableRoot, "Pass the frozen stable worktree path");
const require = createRequire(import.meta.url);
const fixtureModule = require("../.test-dist/tests/fixtures/games-matrix.js");
const candidate = {
  engine: require("../.test-dist/lib/engine.js"),
  side: require("../.test-dist/lib/side-bets.js"),
  supplemental: require("../.test-dist/lib/supplemental-bets.js"),
};
const stable = {
  engine: require(path.join(stableRoot, ".test-dist/lib/engine.js")),
  side: require(path.join(stableRoot, ".test-dist/lib/side-bets.js")),
  supplemental: require(path.join(stableRoot, ".test-dist/lib/supplemental-bets.js")),
};

function evaluate(modules, id, fixture) {
  const { course, scores, players, bets, order, basis } = fixture;
  const complete = new Set(order.filter((hole) => modules.engine.completedHole(hole, scores, fixture.ids)));
  switch (id) {
    case "rabbits": {
      const result = modules.engine.calculateRabbits(course, scores, players, bets.rabbits, order, basis);
      return { balances: modules.engine.payoutWinnerTakesFromAll(players, result.won, bets.rabbits.value), detail: result };
    }
    case "skins": {
      const result = modules.engine.calculateSkins(course, scores, players, bets.skins, order, basis);
      return { balances: modules.engine.payoutWinnerTakesFromAll(players, result.won, bets.skins.value), detail: result };
    }
    case "monkey": {
      const result = modules.engine.calculateMonkey(course, scores, players, bets.monkey, order, basis);
      return { balances: result.balances, detail: result };
    }
    case "units": {
      const result = modules.engine.calculateUnits(players, fixture.units, bets.units, course, scores, order);
      return { balances: result.balances, detail: result };
    }
    case "foursome": {
      const result = modules.engine.calculateFoursomes(course, scores, players, bets.foursome, fixture.segments, order, basis);
      return { balances: result.balances, detail: result };
    }
    case "ball_friend": {
      const result = modules.engine.calculateBallFriend(course, scores, players, bets.ballFriend, fixture.ballFriend, order, basis);
      return { balances: result.balances, detail: result };
    }
    case "polla_first":
    case "polla_second":
    case "polla_total": {
      const key = id === "polla_first" ? "first9" : id === "polla_second" ? "second9" : "total18";
      const config = {
        first9: { ...bets.polla.first9, enabled: false },
        second9: { ...bets.polla.second9, enabled: false },
        total18: { ...bets.polla.total18, enabled: false },
        [key]: bets.polla[key],
      };
      const result = modules.engine.calculatePolla(course, scores, players, config, order, basis);
      return { balances: result.balances, detail: result };
    }
    case "mini_polla": {
      const result = modules.engine.calculateMiniPolla(course, scores, players, bets.miniPolla, order, basis);
      return { balances: result.balances, detail: result };
    }
    case "vipers":
    case "camels":
    case "fish": {
      const result = modules.side.calculateCounterBet(id, players, bets[id], fixture.events.map((event) => ({ ...event, kind: id })), modules.side.emptyCounterBetKeepers(), order, complete);
      return { balances: result.balances, detail: result };
    }
    case "loba": {
      const result = modules.side.calculateLoba(course, scores, players, bets.loba, fixture.loba, order, complete, basis);
      return { balances: result.balances, detail: result };
    }
    case "personals": {
      const result = modules.engine.calculatePersonalBets([fixture.personal], fixture.ids[0], players, course, scores, order);
      return { balances: result.balances, detail: result };
    }
    case "manuals": {
      const result = modules.engine.calculateManualBets(players, [{ id: "synthetic-manual", name: "Synthetic adjustment", amounts: { [fixture.ids[0]]: fixture.scenario.ties ? 0 : fixture.stake, [fixture.ids[1]]: fixture.scenario.ties ? 0 : -fixture.stake } }]);
      return { balances: result.balances, detail: result };
    }
    default: {
      const bet = fixture.supplemental.find((item) => item.type === id);
      assert.ok(bet, `Missing supplemental fixture for ${id}`);
      const result = modules.supplemental.calculateSupplementalBets([bet], players, course, scores, fixture.putts, order, basis);
      return { balances: result.balances, detail: result };
    }
  }
}

const failures = [];
let compared = 0;
for (const entry of fixtureModule.matrixInventory) {
  for (const scenario of fixtureModule.scenariosFor(entry.id)) {
    const fixture = fixtureModule.matrixFixture(scenario);
    try {
      assert.deepEqual(
        evaluate(candidate, entry.id, structuredClone(fixture)),
        evaluate(stable, entry.id, structuredClone(fixture)),
      );
      compared += 1;
    } catch (error) {
      failures.push({ modality: entry.id, scenario: scenario.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

console.log(JSON.stringify({
  schemaVersion: 1,
  fixtureProvenance: "SYNTHETIC_VALID_GAMES_MATRIX",
  stableSha: "8fe4379d4afa034bc1dd6b37fcd058046ed669c3",
  modalities: fixtureModule.matrixInventory.length,
  compared,
  expected: fixtureModule.matrixInventory.reduce((sum, entry) => sum + fixtureModule.scenariosFor(entry.id).length, 0),
  validResultDifferences: failures.length,
  failures,
  status: failures.length ? "FAIL" : "PASS",
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
