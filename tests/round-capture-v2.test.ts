import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initialBets } from "../lib/new-round-bets";
import { captureAnimalVisibility, roundCaptureFieldsForPlayer, scoreToParLabel, viperQuantityFromPutts } from "../lib/round-capture";

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

test("Peces deriva del hecho canónico Penalty/Hazard sin duplicar Agua, Peces u OB", () => {
  const component = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  assert.match(component, /Penalty \/ Hazard/);
  assert.match(component, /setGolfFact\(activePlayer\.id, "penaltyAreaCount"/);
  assert.match(component, /onCounterChange\("fish", playerId, value\)/);
  assert.doesNotMatch(component, /label="Peces"/);
  assert.doesNotMatch(component, /Agua \/ drop/);
});

test("los animales visuales pertenecen sólo a apuestas activas del jugador", () => {
  const bets = initialBets(["said", "pedro"]);
  bets.vipers = { ...bets.vipers, enabled: true, participantIds: ["said"] };
  bets.camels = { ...bets.camels, enabled: true, participantIds: ["pedro"] };
  bets.fish = { ...bets.fish, enabled: true, participantIds: ["said", "pedro"] };
  assert.deepEqual(captureAnimalVisibility(bets, "said"), { viper: true, camel: false, fish: true });
  assert.deepEqual(captureAnimalVisibility(bets, "pedro"), { viper: false, camel: true, fish: true });
});

test("estado respecto al par nunca inventa un score", () => {
  assert.equal(scoreToParLabel(undefined, 4), "Sin score");
  assert.equal(scoreToParLabel(3, 4), "-1");
  assert.equal(scoreToParLabel(4, 4), "Par");
  assert.equal(scoreToParLabel(6, 4), "+2");
});

test("UX V2 captura un jugador a la vez, conserva cámara y CTA final", () => {
  const component = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(component, /HCP de juego/);
  assert.match(component, /aria-label="Cambiar jugador"/);
  assert.match(component, /RÁPIDA/);
  assert.match(component, /ESTADÍSTICAS/);
  assert.match(component, /aria-label="Escanear tarjeta"/);
  assert.match(component, /BOLA AMIGA/);
  assert.match(component, /haversineDistanceKm/);
  assert.doesNotMatch(component, /GPS activo para esta sesión/);
  assert.match(page, /ESCANEAR TARJETA PARA FINALIZAR/);
  assert.match(page, /<RoundCaptureV2/);
});

test("Capture V2.2 usa más/menos, contadores por tap y estadísticas inline", () => {
  const bets = initialBets(["said"]);
  assert.deepEqual(roundCaptureFieldsForPlayer({ mode: "advanced", playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] }), ["putts", "penalties", "ob"]);
  const component = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const controls = readFileSync("app/components/bet-fields/capture-controls.tsx", "utf8");
  assert.match(controls, /function CompactStepper/);
  assert.match(controls, /function TapCounter/);
  assert.match(controls, /Restar \$\{label\}/);
  assert.match(controls, /Agregar \$\{label\}/);
  assert.doesNotMatch(controls, /Confirmar cero/);
  assert.match(component, /<section className=\{styles\.situations\}/);
  assert.doesNotMatch(component, /players\.map\(\(player\) => <AdvancedPlayer/);
  assert.doesNotMatch(component, /<details/);
  assert.doesNotMatch(component, /Lie de llegada/);
  assert.match(component, /Distancia del primer putt/);
  assert.match(component, /label="Green Side Bunker" icon=\{activeAnimals\.camel \? "🐫" : "◯"\}/);
  assert.match(component, /label="Fairway Bunker" icon=\{activeAnimals\.camel \? "🐫" : "◯"\}/);
  assert.match(component, /label="Penalty \/ Hazard" icon=\{activeAnimals\.fish \? "🐟" : "≋"\}/);
  assert.match(component, /<SituationCounter label="OB" icon="‖"/);
  assert.match(component, /Score"\], \["tee", "Tee Shot"\], \["approach", "Approach"\], \["around", "Alrededor"\], \["summary", "Resumen"\]/);
  assert.match(component, /RoundCaddieCard/);
  assert.match(component, /aria-expanded=\{gpsOpen\}/);
  assert.doesNotMatch(component, />GIR</);
  assert.match(component, /unitQuantities/);
});
