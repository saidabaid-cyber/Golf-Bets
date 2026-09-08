import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initialBets } from "../lib/new-round-bets";
import { roundCaptureFieldsForPlayer, scoreToParLabel, viperQuantityFromPutts } from "../lib/round-capture";

test("Rápida muestra únicamente datos consumidos por apuestas activas", () => {
  const bets = initialBets(["said", "pedro"]);
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] }), []);

  bets.vipers.enabled = true;
  bets.vipers.participantIds = ["said"];
  bets.camels.enabled = true;
  bets.camels.participantIds = ["pedro"];
  bets.fish.enabled = true;
  bets.fish.participantIds = ["said"];
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] }), ["putts", "fish"]);
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "pedro", playedHoleIndex: 0, bets, supplementalBets: [] }), ["bunker"]);
});

test("Menos Putts activa Putts sólo para sus participantes y hoyos contratados", () => {
  const bets = initialBets(["said", "pedro"]);
  const supplementalBets = [{ id: "putts", type: "minimum_putts" as const, enabled: true, participantIds: ["said"], ante: 100, holes: 9 as const }];
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "said", playedHoleIndex: 8, bets, supplementalBets }), ["putts"]);
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "said", playedHoleIndex: 9, bets, supplementalBets }), []);
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "quick", playerId: "pedro", playedHoleIndex: 0, bets, supplementalBets }), []);
});

test("Putts traduce Víboras al evento determinista existente", () => {
  assert.equal(viperQuantityFromPutts(null), 0);
  assert.equal(viperQuantityFromPutts(2), 0);
  assert.equal(viperQuantityFromPutts(3), 1);
  assert.equal(viperQuantityFromPutts(4), 1);
});

test("Peces pide un evento de agua explícito y no reutiliza penalidad u OB genéricos", () => {
  const component = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  assert.match(component, /Pez · agua/);
  assert.match(component, /Peces por agua/);
  assert.doesNotMatch(component, /Pen \/ OB<NumericCaptureInput/);
});

test("estado respecto al par nunca inventa un score", () => {
  assert.equal(scoreToParLabel(undefined, 4), "Sin score");
  assert.equal(scoreToParLabel(3, 4), "-1");
  assert.equal(scoreToParLabel(4, 4), "Par");
  assert.equal(scoreToParLabel(6, 4), "+2");
});

test("UX V2 separa jugador principal, tabla móvil, cámara secundaria y CTA final", () => {
  const component = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(component, /Jugador principal/);
  assert.match(component, /JUGADORES DEL GRUPO/);
  assert.match(component, /RÁPIDA/);
  assert.match(component, /ESTADÍSTICAS/);
  assert.match(component, /aria-label="Escanear tarjeta"/);
  assert.match(component, /BOLA AMIGA/);
  assert.match(component, /haversineDistanceKm/);
  assert.doesNotMatch(component, /GPS activo para esta sesión/);
  assert.match(page, /ESCANEAR TARJETA PARA FINALIZAR/);
  assert.match(page, /<RoundCaptureV2/);
});
