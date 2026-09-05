import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  handicapBases,
  hasValidRoundHandicap,
  missingHandicapsForActiveBets,
  normalizeRoundHandicapBasis,
  roundHandicapBases,
} from "../lib/handicap-base";
import {
  calculateBallFriend,
  calculateFoursomes,
  calculateMiniPolla,
  calculateMonkey,
  calculatePolla,
  calculateRabbits,
  calculateSkins,
  playingHandicap,
  strokeAllowanceForHole,
} from "../lib/engine";
import { initialBets } from "../lib/new-round-bets";
import { calculateLoba } from "../lib/side-bets";
import { calculateSupplementalBets, createSupplementalBet } from "../lib/supplemental-bets";
import { normalizeRoundDraft, privateLeaderboard } from "../lib/round-utils";
import { restoreRoundSnapshot } from "../lib/round-editing";
import type { Course, Player, RoundSnapshot, SupplementalBet } from "../lib/types";

const players: Player[] = [
  { id: "said", name: "Said", handicap: 4 },
  { id: "pedro", name: "Pedro", handicap: 6 },
  { id: "jorge", name: "Jorge", handicap: 8 },
  { id: "miguel", name: "Miguel", handicap: 10 },
];
const ids = players.map((player) => player.id);
const course: Course = {
  id: "hcp-basis-qa",
  name: "HCP basis QA",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

test("sobre el campo conserva 4/6/8/10 y distribuye por SI 4, 5, 7, 9 y 11", () => {
  const bases = roundHandicapBases(players, "course");
  const allowanceBases: Record<string, number> = bases;
  assert.deepEqual(bases, { said: 4, pedro: 6, jorge: 8, miguel: 10 });
  const allowances = (strokeIndex: number) => players.map((player) => strokeAllowanceForHole(allowanceBases[player.id], strokeIndex, "half_up"));
  assert.deepEqual(allowances(4), [1, 1, 1, 1]);
  assert.deepEqual(allowances(5), [0, 1, 1, 1]);
  assert.deepEqual(allowances(7), [0, 0, 1, 1]);
  assert.deepEqual(allowances(9), [0, 0, 0, 1]);
  assert.deepEqual(allowances(11), [0, 0, 0, 0]);
});

test("entre jugadores usa solo participantes de la apuesta y aplica porcentaje después de la base", () => {
  assert.deepEqual(roundHandicapBases(players, "relative"), { said: 0, pedro: 2, jorge: 4, miguel: 6 });
  assert.deepEqual(roundHandicapBases(players.slice(1), "relative"), { pedro: 0, jorge: 2, miguel: 4 });
  const courseBases = roundHandicapBases([players[0], players[3]], "course");
  const relativeBases = roundHandicapBases([players[0], players[3]], "relative");
  assert.deepEqual([playingHandicap(courseBases.said, 80, "decimal"), playingHandicap(courseBases.miguel, 80, "decimal")], [3.2, 8]);
  assert.deepEqual([playingHandicap(relativeBases.said, 80, "decimal"), playingHandicap(relativeBases.miguel, 80, "decimal")], [0, 4.8]);
});

test("base fija/movible se conserva en relativo y queda fuera del cálculo sobre campo", () => {
  const active = players.slice(1);
  assert.deepEqual(handicapBases({ baseMode: "fixed", fixedBaseHandicap: 4 }, active, players, players, "relative"), { pedro: 2, jorge: 4, miguel: 6 });
  assert.deepEqual(handicapBases({ baseMode: "moving" }, active, players, players, "relative"), { pedro: 0, jorge: 2, miguel: 4 });
  assert.deepEqual(handicapBases({ baseMode: "fixed", fixedBaseHandicap: 4 }, active, players, players, "course"), { pedro: 6, jorge: 8, miguel: 10 });
  assert.deepEqual(handicapBases({ baseMode: "moving" }, active, players, players, "course"), { pedro: 6, jorge: 8, miguel: 10 });
});

test("cero explícito es válido; vacío no entra como base ni produce un resultado HCP válido", () => {
  const withMissing: Player[] = [{ id: "zero", name: "Cero", handicap: 0 }, { id: "missing", name: "Pendiente", handicap: null }];
  assert.equal(hasValidRoundHandicap(withMissing[0]), true);
  assert.equal(hasValidRoundHandicap(withMissing[1]), false);
  assert.deepEqual(roundHandicapBases(withMissing, "relative"), {});
  const config = { ...initialBets(withMissing.map((player) => player.id)).skins, enabled: true };
  const pending = calculateSkins(course, { 1: { zero: 4, missing: 5 } }, withMissing, config, [1], "relative");
  assert.deepEqual(pending.events, []);
  assert.deepEqual(pending.missingHandicapPlayerIds, ["missing"]);
  assert.equal(privateLeaderboard(course, withMissing, { 1: { zero: 4, missing: 5 } }, [1])[1].net, null);
  const corrected = calculateSkins(course, { 1: { zero: 4, missing: 5 } }, [{ ...withMissing[0] }, { ...withMissing[1], handicap: 2 }], config, [1], "relative");
  assert.equal(corrected.events.length, 1);
  assert.equal(strokeAllowanceForHole(playingHandicap(22.5, 100, "decimal"), 5, "decimal"), 1.5);
  assert.deepEqual(roundHandicapBases([{ id: "plus", name: "Plus", handicap: -2 }, { id: "high", name: "Alto", handicap: 20.5 }], "course"), { plus: -2, high: 20.5 });
  assert.equal(strokeAllowanceForHole(20.5, 3, "decimal"), 1.5);
  assert.equal(strokeAllowanceForHole(20.5, 2, "decimal"), 2);
});

test("motores antiguos reciben la base elegida sin cambiar sus reglas económicas", () => {
  const scores = { 4: Object.fromEntries(ids.map((id) => [id, 4])), 5: Object.fromEntries(ids.map((id) => [id, 4])) };
  const bets = initialBets(ids);
  const skinsConfig = { ...bets.skins, enabled: true };
  assert.equal(calculateSkins(course, scores, players, skinsConfig, [5], "relative").events[0].winnerId, "miguel");
  assert.equal(calculateSkins(course, scores, players, skinsConfig, [5], "course").events[0].winnerId, undefined);
  const rabbitsConfig = { ...bets.rabbits, enabled: true };
  assert.equal(calculateRabbits(course, scores, players, rabbitsConfig, [5], "relative").events[0].playerId, "miguel");
  assert.equal(calculateRabbits(course, scores, players, rabbitsConfig, [5], "course").events[0].type, "free");

  const monkeyConfig = { ...bets.monkey!, enabled: true, participantIds: ids.slice(0, 3) };
  assert.deepEqual(calculateMonkey(course, scores, players, monkeyConfig, [4], "relative").details[0].net, { said: 4, pedro: 4, jorge: 3 });
  assert.deepEqual(calculateMonkey(course, scores, players, monkeyConfig, [4], "course").details[0].net, { said: 3, pedro: 3, jorge: 3 });

  const segment = [{ id: "s", startIndex: 0, endIndex: 0, basePair: ["said", "pedro"] }];
  const foursome = { ...bets.foursome, enabled: true, mode: "points" as const, participantIds: ids };
  assert.deepEqual(calculateFoursomes(course, scores, players, foursome, segment, [4], "relative").matches[0].holePoints[0], { hole: 4, points: -2, netA: [4, 4], netB: [3, 3] });
  assert.deepEqual(calculateFoursomes(course, scores, players, foursome, segment, [4], "course").matches[0].holePoints[0], { hole: 4, points: 0, netA: [3, 3], netB: [3, 3] });

  const ballFriend = { ...bets.ballFriend, enabled: true, participantIds: ids };
  const ballSetup = { 4: { teamA: ["said", "pedro"] } };
  assert.equal(calculateBallFriend(course, scores, players, ballFriend, ballSetup, [4], "relative").details[0].pointDiff, -11);
  assert.equal(calculateBallFriend(course, scores, players, ballFriend, ballSetup, [4], "course").details[0].pointDiff, 0);
});

test("Polla, Loba y apuestas adicionales usan el modo; Chicago exige HCP real", () => {
  const scores = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, Object.fromEntries(ids.map((id) => [id, 4]))]));
  const bets = initialBets(ids);
  bets.polla.first9 = { ...bets.polla.first9, enabled: true };
  const relativePolla = calculatePolla(course, scores, players, bets.polla, Array.from({ length: 9 }, (_, index) => index + 1), "relative");
  const coursePolla = calculatePolla(course, scores, players, bets.polla, Array.from({ length: 9 }, (_, index) => index + 1), "course");
  assert.notDeepEqual(relativePolla.details[0].totals, coursePolla.details[0].totals);
  const miniConfig = { ...bets.miniPolla, enabled: true };
  assert.notDeepEqual(
    calculateMiniPolla(course, scores, players, miniConfig, [1, 2, 3], "relative").details[0].totals,
    calculateMiniPolla(course, scores, players, miniConfig, [1, 2, 3], "course").details[0].totals,
  );
  const teamBase = createSupplementalBet("team_pressures", players, "team") as Extract<SupplementalBet, { type: "team_pressures" }>;
  const team = { ...teamBase, enabled: true, participantIds: ids, teamA: ["said", "pedro"] };
  assert.notDeepEqual(
    calculateSupplementalBets([team], players, course, { 4: scores[4] }, {}, [4], "relative").balances,
    calculateSupplementalBets([team], players, course, { 4: scores[4] }, {}, [4], "course").balances,
  );
  const vegasBase = createSupplementalBet("vegas", players, "vegas") as Extract<SupplementalBet, { type: "vegas" }>;
  const vegas = { ...vegasBase, enabled: true, participantIds: ids, teamA: ["said", "pedro"] };
  assert.notDeepEqual(
    calculateSupplementalBets([vegas], players, course, { 4: scores[4] }, {}, [4], "relative").results[0].lines,
    calculateSupplementalBets([vegas], players, course, { 4: scores[4] }, {}, [4], "course").results[0].lines,
  );

  const lobaConfig = { ...bets.loba, enabled: true, participantIds: ids };
  const lobaHole = { lobaPlayerId: "said", mode: "partner" as const, partnerId: "pedro", fireMultiplier: 1, unitCounts: {} };
  assert.deepEqual(calculateLoba(course, { 4: scores[4] }, players, lobaConfig, { 4: lobaHole }, [4], new Set([4]), "relative").details[0].netScores, { said: 4, pedro: 4, jorge: 3, miguel: 3 });
  assert.deepEqual(calculateLoba(course, { 4: scores[4] }, players, lobaConfig, { 4: lobaHole }, [4], new Set([4]), "course").details[0].netScores, { said: 3, pedro: 3, jorge: 3, miguel: 3 });

  const pressure = { ...createSupplementalBet("individual_pressures", players, "pressure"), enabled: true, participantIds: ["said", "miguel"] };
  const relativePressure = calculateSupplementalBets([pressure], players, course, { 4: scores[4] }, {}, [4], "relative").results[0];
  const coursePressure = calculateSupplementalBets([pressure], players, course, { 4: scores[4] }, {}, [4], "course").results[0];
  assert.notDeepEqual(relativePressure.balances, coursePressure.balances);

  const chicago = { ...createSupplementalBet("chicago", players, "chicago"), enabled: true };
  const missing = players.map((player) => player.id === "miguel" ? { ...player, handicap: null } : player);
  const chicagoResult = calculateSupplementalBets([chicago], missing, course, scores, {}, Array.from({ length: 9 }, (_, index) => index + 1), "course").results[0];
  assert.equal(chicagoResult.complete, false);
  assert.deepEqual(chicagoResult.missingHandicapPlayerIds, ["miguel"]);
});

test("ventajas pactadas y apuestas sin HCP permanecen iguales en ambos modos", () => {
  const scores = { 1: { said: 4, pedro: 5, jorge: 4, miguel: 4 } };
  const dollar = { ...createSupplementalBet("dollar_stroke", players, "dollar"), enabled: true, playerAId: "said", playerBId: "pedro", advantageReceiverId: "pedro", advantageStrokes: 5 };
  assert.deepEqual(calculateSupplementalBets([dollar], players, course, scores, {}, [1], "relative"), calculateSupplementalBets([dollar], players, course, scores, {}, [1], "course"));
  const noHcpPlayers = players.map((player) => ({ ...player, handicap: null }));
  const puttsBet = { ...createSupplementalBet("minimum_putts", noHcpPlayers, "putts"), enabled: true, holes: 9 as const };
  const putts = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, Object.fromEntries(ids.map((id, playerIndex) => [id, 2 + (playerIndex === 3 ? 1 : 0)]))]));
  assert.deepEqual(calculateSupplementalBets([puttsBet], noHcpPlayers, course, {}, putts, Array.from({ length: 9 }, (_, index) => index + 1), "relative"), calculateSupplementalBets([puttsBet], noHcpPlayers, course, {}, putts, Array.from({ length: 9 }, (_, index) => index + 1), "course"));
});

test("solo apuestas activas que usan HCP bloquean al jugador pendiente", () => {
  const pendingPlayers = players.map((player) => player.id === "pedro" ? { ...player, handicap: null } : player);
  const bets = initialBets(ids);
  bets.units.enabled = true;
  assert.deepEqual(missingHandicapsForActiveBets(pendingPlayers, bets, []), []);
  bets.skins.enabled = true;
  assert.deepEqual(missingHandicapsForActiveBets(pendingPlayers, bets, []).map((player) => player.id), ["pedro"]);
});

test("modo persiste en borrador e Histórico; ausencia legacy equivale a entre jugadores", () => {
  const bets = initialBets(ids);
  const draft = normalizeRoundDraft({ version: 7, handicapBasis: "course", players, course, bets, scores: { 1: { said: 4 } } });
  assert.equal(draft?.handicapBasis, "course");
  assert.equal(normalizeRoundHandicapBasis(undefined), "relative");
  const snapshot: RoundSnapshot = {
    id: "round-hcp", date: "2026-09-05", courseName: course.name, teeName: course.teeName, ownerName: "Said", ownerId: "said",
    handicapBasis: "course", betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 0,
    categoryResults: {}, players, scores: { 1: { said: 4, pedro: 4, jorge: 4, miguel: 4 } }, courseSnapshot: course, order: [1], betConfig: bets, segments: [],
  };
  assert.equal(restoreRoundSnapshot(JSON.parse(JSON.stringify(snapshot)))?.handicapBasis, "course");
  const legacy = { ...snapshot };
  delete legacy.handicapBasis;
  assert.equal(normalizeRoundHandicapBasis(restoreRoundSnapshot(legacy)?.handicapBasis), "relative");
});

test("selector usa controles existentes, no autofocus, y oculta base fija/movible en modo campo", () => {
  const control = readFileSync("app/components/round-handicap-basis-control.tsx", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(control, /Ventajas sobre el campo/);
  assert.match(control, /Ventajas entre jugadores/);
  assert.doesNotMatch(control, /autoFocus|\.focus\(/);
  assert.match(page, /roundHandicapBasis === "relative" && <HandicapBaseControl name="Foursome"/);
  assert.match(page, /roundHandicapBasis === "relative" && <HandicapBaseControl name="Bola Amiga"/);
});
