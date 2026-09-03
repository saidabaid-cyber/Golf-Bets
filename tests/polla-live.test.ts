import assert from "node:assert/strict";
import test from "node:test";

import { autoGroupPollaPlayers, buildPollaLeaderboard, canEditPollaScore, hasPollaScoreConflict, initializePollaHoleScores, nextPollaHole, normalizeOyesDistance, normalizePollaHcpPercentage, parsePollaPlayersCsv, pollaHoleOrder, rankPollaLeaderboard } from "../lib/polla-live";
import { polla18HoleCourse, polla60Players, polla60Scores } from "./fixtures/polla-live-60";

test("Polla Live validates and imports its documented CSV format", () => {
  const valid = parsePollaPlayersCsv("name,handicap,group,startHole,teeTime\nSaid,7,Grupo 1,10,08:30\nCuau,9,Grupo 1,10,08:30");
  assert.equal(valid.issues.length, 0);
  assert.equal(valid.players[0].startHole, 10);
  assert.equal(valid.players[0].teeTime, "08:30");
  const invalid = parsePollaPlayersCsv("name,handicap\n,99");
  assert.equal(invalid.players.length, 0);
  assert.equal(invalid.issues.length, 2);
});

test("Polla Live auto-groups 60 players efficiently into 15 foursomes", () => {
  const players = Array.from({ length: 60 }, (_, index) => ({ id: String(index), name: `Jugador ${index + 1}`, handicap: index % 19 }));
  const groups = autoGroupPollaPlayers(players, 4);
  assert.equal(groups.length, 15);
  assert.ok(groups.every((group) => group.length === 4));
});

test("Polla Live respects the preferred size without groups smaller than three", () => {
  const players = Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `J${index}`, handicap: 0 }));
  assert.deepEqual(autoGroupPollaPlayers(players, 4).map((group) => group.length), [4, 3, 3]);
  assert.deepEqual(autoGroupPollaPlayers(players, 5).map((group) => group.length), [5, 5]);
});

test("Oyes normalize meters, centimeters and feet/inches", () => {
  assert.equal(normalizeOyesDistance(1.25, "m"), 1.25);
  assert.equal(normalizeOyesDistance(125, "cm"), 1.25);
  assert.ok(Math.abs(normalizeOyesDistance(4, "ft_in", 1) - 1.2446) < 0.0001);
});

test("Polla Live conserva 0% HCP y limita valores fuera de rango", () => {
  assert.equal(normalizePollaHcpPercentage(0), 0);
  assert.equal(normalizePollaHcpPercentage(105), 100);
  assert.equal(normalizePollaHcpPercentage(-5), 0);
  assert.equal(normalizePollaHcpPercentage(undefined), 100);
});

test("Leaderboard never marks unequal progress as finished", () => {
  const rows = rankPollaLeaderboard([
    { playerId: "a", name: "A", handicap: 7, gross: 50, net: 45, relativeToPar: -2, thru: 14, finished: false },
    { playerId: "b", name: "B", handicap: 8, gross: 68, net: 60, relativeToPar: -4, thru: 18, finished: true },
  ]);
  assert.equal(rows[0].playerId, "b");
  assert.equal(rows[1].finished, false);
  assert.equal(rows[1].thru, 14);
});

test("Polla Live respeta salida H10, par real y final de nueve hoyos", () => {
  const order = pollaHoleOrder(10, 9);
  assert.deepEqual(order, [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  const initialized = initializePollaHoleScores({}, ["a", "b"], 10, [{ number: 10, par: 5 }]);
  assert.deepEqual(initialized, { "a:10": 5, "b:10": 5 });
  assert.equal(nextPollaHole(10, 10, 9), 11);
  assert.equal(nextPollaHole(18, 10, 9), null);
});

test("fixture de 60 jugadores produce 15 grupos, 1080 scores y leaderboard único", () => {
  const started = performance.now();
  const rows = buildPollaLeaderboard({ players: polla60Players, scores: polla60Scores, courseSnapshot: polla18HoleCourse, tournamentHoles: 18, startHole: 1, hcpPct: 100, handicapMode: "half_up" });
  assert.equal(new Set(polla60Players.map((player) => player.groupId)).size, 15);
  assert.equal(polla60Scores.length, 1_080);
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map((row) => row.playerId)).size, 60);
  assert.ok(rows.every((row) => row.thru === 18 && row.finished));
  assert.ok(performance.now() - started < 1_000);
});

test("leaderboard filtra vueltas y grupo sin fetch por jugador", () => {
  const front = buildPollaLeaderboard({ players: polla60Players, scores: polla60Scores, courseSnapshot: polla18HoleCourse, tournamentHoles: 18, startHole: 1, hcpPct: 100, handicapMode: "half_up", scope: "front9", groupId: "group-1" });
  const back = buildPollaLeaderboard({ players: polla60Players, scores: polla60Scores, courseSnapshot: polla18HoleCourse, tournamentHoles: 18, startHole: 1, hcpPct: 100, handicapMode: "half_up", scope: "back9", groupId: "group-1" });
  assert.equal(front.length, 4);
  assert.ok(front.every((row) => row.thru === 9 && row.finished));
  assert.ok(back.every((row) => row.thru === 9 && row.finished));
});

test("RLS lógico: scorer solo su grupo abierto, viewer nunca y admin sí", () => {
  assert.equal(canEditPollaScore({ role: "scorer", sessionGroupId: "g1", targetGroupId: "g1", cardStatus: "open" }), true);
  assert.equal(canEditPollaScore({ role: "scorer", sessionGroupId: "g1", targetGroupId: "g2", cardStatus: "open" }), false);
  assert.equal(canEditPollaScore({ role: "scorer", sessionGroupId: "g1", targetGroupId: "g1", cardStatus: "confirmed" }), false);
  assert.equal(canEditPollaScore({ role: "viewer", sessionGroupId: "g1", targetGroupId: "g1", cardStatus: "open" }), false);
  assert.equal(canEditPollaScore({ role: "admin", sessionGroupId: null, targetGroupId: "g2", cardStatus: "confirmed" }), true);
});

test("dos dispositivos ven la actualización y una versión obsoleta genera conflicto", () => {
  const initialScores = polla60Scores.filter((score) => !(score.playerId === "player-1" && score.hole === 1));
  const viewerBefore = buildPollaLeaderboard({ players: polla60Players, scores: initialScores, courseSnapshot: polla18HoleCourse, tournamentHoles: 18, startHole: 1, hcpPct: 100, handicapMode: "half_up" });
  const scorerUpdate = [...initialScores, { playerId: "player-1", hole: 1, score: 2 }];
  const viewerAfter = buildPollaLeaderboard({ players: polla60Players, scores: scorerUpdate, courseSnapshot: polla18HoleCourse, tournamentHoles: 18, startHole: 1, hcpPct: 100, handicapMode: "half_up" });
  assert.equal(viewerBefore.find((row) => row.playerId === "player-1")?.thru, 17);
  assert.equal(viewerAfter.find((row) => row.playerId === "player-1")?.thru, 18);
  assert.equal(hasPollaScoreConflict("device-a-v1", "admin-v2"), true);
  assert.equal(hasPollaScoreConflict("admin-v2", "admin-v2"), false);
  assert.equal(hasPollaScoreConflict(undefined, "admin-v2"), true);
  assert.equal(hasPollaScoreConflict(undefined, undefined), false);
});
