import assert from "node:assert/strict";
import test from "node:test";
import { advanceSlidingAdvantage, configureCurrentIndexPersonal, configureSlidingPersonal, frequentPersonalSuggestions, personalBetFromFrequentTemplate, profileIndexSnapshot, slidingAdjustment, unavailableBackyardWhsProvider } from "../lib/personal-modes";
import type { PersonalBet, Player, SavedPersonalRival } from "../lib/types";

const base: PersonalBet = { id: "p1", rivalMode: "group", rivalPlayerId: "daniel", rivalName: "Daniel", externalScores: {}, baseValue: 500, advantageReceiver: "rival", advantageStrokes: 6, back9Multiplier: 1, components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true } };
const said: Player = { id: "said", name: "Said", handicap: 8 };
const daniel: Player = { id: "daniel", name: "Daniel", handicap: 14 };

test("Índice Actual usa fuente canónica y congela fallback provisional", () => {
  const configured = configureCurrentIndexPersonal(base, said, daniel, "2026-09-08T12:00:00.000Z");
  assert.equal(configured.advantageMode, "current_index");
  assert.deepEqual(configured.ownerIndexSnapshot, profileIndexSnapshot(8, "2026-09-08T12:00:00.000Z"));
  assert.equal(configured.ownerIndexSnapshot?.indexSource, "PROFILE_FALLBACK");
  assert.equal(configured.ownerIndexSnapshot?.provisional, true);
  assert.equal(configured.advantageReceiver, "rival");
  assert.equal(configured.advantageStrokes, 6);
});

test("BACKYARD_WHS no inventa índice si no existe motor completo", async () => {
  assert.equal(await unavailableBackyardWhsProvider.currentIndex("said", "2026-09-08"), null);
});

test("Sliding avanza por resultado y puede cruzar cero", () => {
  assert.equal(advanceSlidingAdvantage(6, -500), 5);
  assert.equal(advanceSlidingAdvantage(6, 500), 7);
  assert.equal(advanceSlidingAdvantage(6, 0), 6);
  assert.equal(advanceSlidingAdvantage(2, -1), 1);
  assert.equal(advanceSlidingAdvantage(1, -1), 0);
  assert.equal(advanceSlidingAdvantage(0, -1), -1);
  assert.equal(advanceSlidingAdvantage(-1, -1), -2);
});

test("Sliding guarda auditoría y no modifica el snapshot de entrada", () => {
  const configured = configureSlidingPersonal(base, 6);
  const audit = slidingAdjustment({ bet: configured, ownerResult: -500, rivalKey: "said::daniel", roundId: "r1", updatedAt: "2026-09-08T13:00:00.000Z" });
  assert.equal(configured.slidingAdvantage, 6);
  assert.deepEqual(audit, { betId: "p1", rivalKey: "said::daniel", previousAdvantage: 6, result: "rival_win", newAdvantage: 5, roundId: "r1", updatedAt: "2026-09-08T13:00:00.000Z" });
});

test("Personal frecuente se sugiere pero no se activa", () => {
  const template: SavedPersonalRival = { id: "t1", name: "Daniel", mode: "sliding", slidingAdvantage: 5, baseValue: 500, carryEnabled: true, pressureMultiplier: 2 };
  const suggestions = frequentPersonalSuggestions([template], [said, daniel]);
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].message, /¿La jugamos\?/);
  assert.equal((suggestions[0] as { enabled?: boolean }).enabled, undefined);
});

test("Backyard crea una Personal frecuente sólo después de aceptar la sugerencia", () => {
  const created = personalBetFromFrequentTemplate({
    template: { id: "frequent-daniel", name: "Daniel", mode: "sliding", slidingAdvantage: 5, baseValue: 500, carryEnabled: true, pressureMultiplier: 2 },
    owner: said,
    rival: daniel,
    id: "personal-round",
    effectiveAt: "2026-09-08",
  });
  assert.equal(created.enabled, true);
  assert.equal(created.externalRivalId, "frequent-daniel");
  assert.equal(created.slidingAdvantage, 5);
  assert.equal(created.baseValue, 500);
  assert.equal(created.carryEnabled, true);
  assert.equal(created.pressureMultiplier, 2);
});
