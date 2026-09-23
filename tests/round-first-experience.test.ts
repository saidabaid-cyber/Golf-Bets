import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { firstRoundExperienceKey, hasSeenFirstRoundExperience, markFirstRoundExperienceSeen } from "../lib/round-first-experience";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("la introducción de primera ronda queda aislada por usuario y sólo aparece una vez", () => {
  const store = storage();
  assert.equal(hasSeenFirstRoundExperience(store, "user-a"), false);
  markFirstRoundExperienceSeen(store, "user-a");
  assert.equal(hasSeenFirstRoundExperience(store, "user-a"), true);
  assert.equal(hasSeenFirstRoundExperience(store, "user-b"), false);
  assert.notEqual(firstRoundExperienceKey("user-a"), firstRoundExperienceKey("user-b"));
});

test("la ayuda contextual sólo intercepta la ronda completa, no score-only", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const requestNewRound = page.split("function requestNewRound()")[1].split("function completeFirstRoundExperience")[0];
  assert.match(requestNewRound, /hasSeenFirstRoundExperience/);
  assert.match(page, /onScoreOnly=\{\(\) => requestNewRoundIntent\(\{ kind: "scoreOnly" \}\)\}/);
  assert.match(page, /Agregar jugadores/);
  assert.match(page, /Usar un grupo/);
  assert.match(page, /Configurar apuestas/);
  assert.match(page, /Continuar sin configurar/);
});
