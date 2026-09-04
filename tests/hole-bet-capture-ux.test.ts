import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateBallFriend, calculateSkins } from "../lib/engine";
import { ballFriendSetupChipLabel, lobaSetupChipLabel, playerHoleBetLabels, skinHoleNotice } from "../lib/hole-bet-display";
import { calculateLoba } from "../lib/side-bets";
import type { BetConfig, Course, HoleScore, LobaHole, Player } from "../lib/types";

const players: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "abel", name: "Abel", handicap: 8 },
  { id: "bringas", name: "Bringas", handicap: 12 },
  { id: "pepe", name: "Pepe Lalo", handicap: 16 },
  { id: "daniel", name: "Daniel", handicap: 20 },
];
const course: Course = {
  id: "qa",
  name: "QA",
  teeName: "",
  holes: [1, 2, 3].map(number => ({ number, par: 4, strokeIndex: number })),
};
const lobaConfig: BetConfig["loba"] = {
  enabled: true,
  value: 100,
  hcpPct: 100,
  unitsEnabled: true,
  unitValue: 50,
  duplicateUnitsByMode: false,
  participantIds: players.map(player => player.id),
};
const lobaHole: LobaHole = {
  lobaPlayerId: "said",
  mode: "partner",
  partnerId: "abel",
  fireMultiplier: 1,
  unitCounts: {},
};
const ballFriendConfig: BetConfig["ballFriend"] = {
  enabled: true,
  value: 10,
  hcpPct: 100,
  decimals: "round",
  maxScore: 9,
  participantIds: players.map(player => player.id),
};
const ballFriendHole = { teamA: ["said", "abel"], restPlayerId: "daniel" };

test("la tarjeta de scores queda antes del estado previo y contiene accesos compactos sin paneles grandes", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const scorecard = page.indexOf('<section className="card scoreCard">');
  const priorStatus = page.indexOf('<section className="card compact priorBetStatus"');
  const editor = page.indexOf('{holeBetEditor && <div className="modalBackdrop');
  assert.ok(scorecard >= 0 && priorStatus > scorecard && editor > priorStatus);
  assert.match(page.slice(scorecard, priorStatus), /scoreBetQuickSetup/);
  assert.equal((page.match(/<LobaHolePanel config=/g) || []).length, 1);
  assert.equal((page.match(/<BallFriendHolePanel config=/g) || []).length, 1);
  assert.doesNotMatch(page.slice(0, scorecard), /<LobaHolePanel|<BallFriendHolePanel/);
});

test("accesos compactos resumen Loba y Bola Amiga configuradas", () => {
  assert.equal(lobaSetupChipLabel(undefined, players), "🐺 Elegir Loba");
  assert.equal(lobaSetupChipLabel(lobaHole, players), "🐺 Said + Abel");
  assert.equal(ballFriendSetupChipLabel(undefined, players, players.map(player => player.id)), "⚪🤝 Elegir Bola Amiga");
  assert.equal(ballFriendSetupChipLabel(ballFriendHole, players, players.map(player => player.id)), "⚪🤝 Said/Abel vs Bringas/Pepe Lalo");
});

test("etiquetas por jugador reflejan Loba, pareja, equipos y descanso antes de capturar", () => {
  const participants = players.map(player => player.id);
  assert.deepEqual(playerHoleBetLabels("said", lobaHole, ballFriendHole, participants), ["🐺 Loba", "Bola Amiga · Equipo 1"]);
  assert.deepEqual(playerHoleBetLabels("abel", lobaHole, ballFriendHole, participants), ["Pareja Loba", "Bola Amiga · Equipo 1"]);
  assert.deepEqual(playerHoleBetLabels("bringas", lobaHole, ballFriendHole, participants), ["Bola Amiga · Equipo 2"]);
  assert.deepEqual(playerHoleBetLabels("daniel", lobaHole, ballFriendHole, participants), ["Descansa"]);
});

test("resultados vivos de Loba y Bola Amiga esperan scores completos y aparecen al completarlos", () => {
  const partial: Record<number, HoleScore> = { 1: { said: 4, abel: 4, bringas: 5 } };
  assert.equal(calculateLoba(course, partial, players, lobaConfig, { 1: lobaHole }, [1], new Set([1])).details.length, 0);
  assert.equal(calculateBallFriend(course, partial, players, ballFriendConfig, { 1: ballFriendHole }, [1]).details.length, 0);

  const complete: Record<number, HoleScore> = { 1: { said: 4, abel: 4, bringas: 5, pepe: 5, daniel: 6 } };
  assert.equal(calculateLoba(course, complete, players, lobaConfig, { 1: lobaHole }, [1], new Set([1])).details.length, 1);
  assert.equal(calculateBallFriend(course, complete, players, ballFriendConfig, { 1: ballFriendHole }, [1]).details.length, 1);
});

test("Skins informa primer y segundo carry con monto real sin inventar ganador", () => {
  const participants = players.slice(0, 2);
  const config: BetConfig["skins"] = { enabled: true, value: 50, hcpPct: 0, decimals: "round", accumulate: true, participantIds: participants.map(player => player.id) };
  const scores: Record<number, HoleScore> = {
    1: { said: 4, abel: 4 },
    2: { said: 5, abel: 5 },
  };
  const result = calculateSkins(course, scores, participants, config, [1, 2]);
  assert.equal(result.events[0].winnerId, undefined);
  assert.equal(result.events[1].winnerId, undefined);
  assert.deepEqual(skinHoleNotice(result.events[0], config.value, false, id => id), ["⛳ Skin se acumula", "Próximo hoyo: 2 skins · $100 en juego"]);
  assert.deepEqual(skinHoleNotice(result.events[1], config.value, false, id => id), ["⛳ Skin se acumula", "Próximo hoyo: 3 skins · $150 en juego"]);
});

test("último hoyo empatado conserva carry sin anunciar próximo hoyo ni ganador", () => {
  const participants = players.slice(0, 2);
  const config: BetConfig["skins"] = { enabled: true, value: 50, hcpPct: 0, decimals: "round", accumulate: true, participantIds: participants.map(player => player.id) };
  const result = calculateSkins(course, { 1: { said: 4, abel: 4 } }, participants, config, [1]);
  const notice = skinHoleNotice(result.events[0], config.value, true, id => id);
  assert.deepEqual(notice, ["⛳ Skin sin ganador · 2 skins acumulados"]);
  assert.doesNotMatch(notice.join(" "), /Próximo hoyo/);
  assert.deepEqual(result.won, { said: 0, abel: 0 });
});

test("ganador único cobra todo el carry y mantiene el aviso existente", () => {
  const participants = players.slice(0, 2);
  const config: BetConfig["skins"] = { enabled: true, value: 50, hcpPct: 0, decimals: "round", accumulate: true, participantIds: participants.map(player => player.id) };
  const result = calculateSkins(course, {
    1: { said: 4, abel: 4 },
    2: { said: 3, abel: 5 },
  }, participants, config, [1, 2]);
  assert.deepEqual(skinHoleNotice(result.events[1], config.value, false, id => players.find(player => player.id === id)?.name || id), ["⛳ Said gana 2 skins"]);
  assert.deepEqual(result.won, { said: 2, abel: 0 });
});
