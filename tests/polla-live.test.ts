import assert from "node:assert/strict";
import test from "node:test";

import { autoGroupPollaPlayers, initializePollaHoleScores, nextPollaHole, normalizeOyesDistance, parsePollaPlayersCsv, pollaHoleOrder, rankPollaLeaderboard } from "../lib/polla-live";

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
