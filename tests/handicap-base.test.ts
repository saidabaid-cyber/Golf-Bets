import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { handicapBases, freezeHandicapBase, freezeRoundHandicapBases } from "../lib/handicap-base";
import { initialBets } from "../lib/new-round-bets";
import { calculateBallFriend, calculateFoursomes, strokeAllowanceForHole } from "../lib/engine";
import type { Course, Player } from "../lib/types";

const players: Player[] = [
  { id: "daniel", name: "Daniel", handicap: 0 },
  { id: "said", name: "Said", handicap: 8 },
  { id: "tamayo", name: "Tamayo", handicap: 9 },
  { id: "juan", name: "Juan", handicap: 13 },
  { id: "flavio", name: "Flavio", handicap: 14 },
];
const ids = players.map(p => p.id);
const active = players.slice(1);
const course: Course = { id: "base-qa", name: "SI 6", teeName: "General", holes: [{ number: 1, par: 4, strokeIndex: 6 }] };
const scores = { 1: { said: 4, tamayo: 4, juan: 4, flavio: 4 } };
const setup = { 1: { restPlayerId: "daniel", teamA: ["said", "tamayo"] } };
const segment = [{ id: "s1", startIndex: 0, endIndex: 0, basePair: ["said", "tamayo"] }];

test("base movible: Daniel descansa; 0/1/5/6 y solo Flavio recibe en SI6", () => {
  const bases = handicapBases({ baseMode: "moving" }, active, players);
  assert.deepEqual(bases, { said: 0, tamayo: 1, juan: 5, flavio: 6 });
  assert.equal("daniel" in bases, false);
  assert.deepEqual(Object.values(bases).map(hcp => strokeAllowanceForHole(hcp, 6, "round")), [0, 0, 0, 1]);
  const withDaniel = handicapBases({ baseMode: "moving" }, [players[0], ...active.slice(1)], players);
  assert.deepEqual(withDaniel, { daniel: 0, tamayo: 9, juan: 13, flavio: 14 });
});

test("base fija se congela una vez y sobrevive a cambios de participantes/recarga", () => {
  const cfg = freezeHandicapBase({ ...initialBets(ids).ballFriend, baseMode: "fixed" as const }, players);
  assert.equal(cfg.fixedBaseHandicap, 0);
  const changed = { ...JSON.parse(JSON.stringify(cfg)), participantIds: active.map(p => p.id) };
  assert.equal(freezeHandicapBase(changed, active).fixedBaseHandicap, 0);
  assert.deepEqual(handicapBases(changed, active, active), { said: 8, tamayo: 9, juan: 13, flavio: 14 });
  assert.equal(freezeHandicapBase(cfg, players), cfg);
});

test("Bola Amiga movible excluye descanso en cálculo real, no solo en helper", () => {
  const cfg = { ...initialBets(ids).ballFriend, enabled: true };
  const result = calculateBallFriend(course, scores, players, cfg, setup, [1]);
  assert.equal(result.details[0].numberA, 44);
  assert.equal(result.details[0].numberB, 34);
  assert.deepEqual(result.balances, { daniel: 0, said: -200, tamayo: -200, juan: 200, flavio: 200 });
  const fixed = freezeHandicapBase({ ...cfg, baseMode: "fixed" as const }, players);
  assert.equal(calculateBallFriend(course, scores, players, fixed, setup, [1]).details[0].pointDiff, 0);
});

test("Bola Amiga antigua sin baseMode conserva referencia global y snapshot", () => {
  const cfg = { ...initialBets(ids).ballFriend, enabled: true, baseMode: undefined };
  const snapshot = JSON.stringify({ scores, cfg });
  assert.equal(calculateBallFriend(course, scores, players, cfg, setup, [1]).details[0].pointDiff, 0);
  assert.equal(JSON.stringify({ scores, cfg }), snapshot);
});

test("Foursome movible: base propia para cada match; otros participantes excluidos", () => {
  const cfg = { ...initialBets(ids).foursome, enabled: true };
  const result = calculateFoursomes(course, scores, players, cfg, segment, [1]);
  const match = result.matches.find(m => m.opponentPair.join() === "juan,flavio")!;
  assert.equal(match.pointDiff, -1);
  assert.deepEqual(match.holePoints[0].netA, [4, 4]);
  assert.deepEqual(match.holePoints[0].netB, [4, 3]);
  assert.equal(result.matches.filter(m => m.opponentPair.includes("daniel")).every(m => m.completedHoles === 0), true);
});

test("Foursome fija conserva base original aunque el jugador base se retire", () => {
  const cfg = freezeHandicapBase({ ...initialBets(ids).foursome, enabled: true, baseMode: "fixed" as const }, players);
  const result = calculateFoursomes(course, scores, active, { ...cfg, participantIds: active.map(p => p.id) }, segment, [1]);
  assert.equal(result.matches[0].pointDiff, 0);
  assert.deepEqual(result.matches[0].holePoints[0].netA, [3, 3]);
  assert.deepEqual(result.matches[0].holePoints[0].netB, [3, 3]);
});

test("Foursome porcentaje y redondeo siguen interviniendo después del rebasing", () => {
  const cfg = { ...initialBets(active.map(p => p.id)).foursome, enabled: true, hcpPct: 50 };
  assert.equal(calculateFoursomes(course, scores, players, cfg, segment, [1]).matches[0].pointDiff, 0);
  const decimals = active.map(p => p.id === "flavio" ? { ...p, handicap: 13.5 } : p);
  const partial = calculateFoursomes(course, scores, decimals, { ...cfg, hcpPct: 100, decimals: "partial" }, segment, [1]);
  const rounded = calculateFoursomes(course, scores, decimals, { ...cfg, hcpPct: 100 }, segment, [1]);
  assert.deepEqual(partial.matches[0].holePoints[0].netB, [4, 3.5]);
  assert.deepEqual(rounded.matches[0].holePoints[0].netB, [4, 3]);
});

test("Fantasma copia ventaja y score sin formar una base distinta ni romper suma cero", () => {
  const three = active.filter(p => p.id !== "juan");
  const cfg = { ...initialBets(three.map(p => p.id)).foursome, enabled: true };
  const result = calculateFoursomes(course, scores, three, cfg, segment, [1]);
  assert.deepEqual(result.matches[0].holePoints[0].netB, [3, 3]);
  assert.equal(result.matches[0].pointDiff, -2);
  assert.equal(Object.values(result.balances).reduce((a, b) => a + b, 0), 0);
});

test("nueva ronda: todas apagadas; ninguna configuración se comparte con la anterior", () => {
  const previous = initialBets(ids);
  previous.foursome.enabled = true; previous.polla.first9.enabled = true;
  const fresh = initialBets(ids);
  const configs = [fresh.monkey!, fresh.rabbits, fresh.skins, fresh.units, fresh.foursome, fresh.ballFriend, ...Object.values(fresh.polla), fresh.miniPolla, fresh.vipers, fresh.camels, fresh.fish, fresh.loba];
  assert.equal(configs.length, 14);
  assert.ok(configs.every(cfg => cfg.enabled === false));
  assert.equal(fresh.foursome.handicapMethod, "configured");
  const frozen = freezeRoundHandicapBases(fresh, players);
  assert.deepEqual(frozen, fresh);
  const ui = readFileSync("app/page.tsx", "utf8");
  const reset = ui.slice(ui.indexOf("function resetRound()"), ui.indexOf("function deleteActiveRound()"));
  assert.match(reset, /setPersonalBets\(\[\]\)/);
  assert.match(reset, /setBets\(initialBets\(\[\]\)\)/);
});

test("UI controles visibles sin motores internos y ayuda independiente para ambas apuestas", () => {
  const ui = readFileSync("app/page.tsx", "utf8");
  const control = readFileSync("app/components/handicap-base-control.tsx", "utf8");
  assert.doesNotMatch(ui, /Modalidad del Excel|Modalidad Excel|Excel original|<option[^>]*>legacy/);
  assert.match(ui, /HandicapBaseControl name="Foursome"/);
  assert.match(ui, /HandicapBaseControl name="Bola Amiga"/);
  assert.match(control, /Base fija/); assert.match(control, /Base movible/);
  assert.match(control, /Quien descansa no cuenta/);
  assert.doesNotMatch(control, /Daniel \(0\)|Tamayo \(9\)|Flavio \(14\)/);
  assert.match(control, /Ayuda de base de HCP/);
  assert.match(ui, /freezeRoundHandicapBases\(current, players, roundHandicapBasis\)/);
});
