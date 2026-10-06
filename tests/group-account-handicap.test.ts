import test from "node:test";
import assert from "node:assert/strict";
import { instantiateGroupGameTemplate } from "../lib/group-game-template";
import { syncAccountRoundIndex } from "../lib/account-primary-player";
import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import { assignTeeToEveryPlayer } from "../lib/player-tee-assignments";
import type { Course, FrequentGroup } from "../lib/types";

const group: FrequentGroup = { id: "qa-group", name: "QA", uses: 0, updatedAt: "2026-10-06T12:00:00Z", players: [
  { memberId: "member-owner", name: "Owner", handicap: 8, accountUserId: "qa-owner", kind: "account" },
  { memberId: "member-guest", name: "Guest", handicap: 12, kind: "guest" },
] };
const white: Course = { id: "white", name: "QA", teeName: "Blancas", rating: 70.8, slope: 125,
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })) };
test("real group instantiation preserves linked Index semantics and guest manual HCP", () => {
  const round = instantiateGroupGameTemplate(group, () => "runtime-guest");
  assert.equal(round.players[0].handicapIndex, 8); assert.equal(round.players[0].handicapSource, "profile_index");
  assert.equal(round.players[1].handicapIndex, undefined); assert.equal(round.players[1].handicapSource, "manual");
  assert.equal(round.origin.roundPlayerIdByMemberId["member-guest"], "runtime-guest");
});
test("current owner Index plus actual tee recalculates 5 then 2; IDs and guest HCP stay intact", () => {
  const round = instantiateGroupGameTemplate(group, () => "runtime-guest");
  const bound = syncAccountRoundIndex(round.players, "qa-owner", { source: "BACKYARD", value: 5.5 });
  let players = applyRoundCourseHandicaps(bound, assignTeeToEveryPlayer(bound, white, "2026-10-06T12:00:00Z"), white, "now");
  assert.equal(players[0].handicap, 5); assert.equal(players[0].handicapIndexSource, "BACKYARD_INDEX");
  const gold = { ...white, id: "gold", teeName: "Doradas", rating: 68.4, slope: 121 };
  players = applyRoundCourseHandicaps(players, assignTeeToEveryPlayer(players, gold, "2026-10-06T12:00:00Z"), gold, "now");
  assert.equal(players[0].handicap, 2); assert.equal(players[1].handicap, 12);
  assert.deepEqual(players.map(p => p.id), round.players.map(p => p.id));
  assert.strictEqual(syncAccountRoundIndex(players, "qa-owner", { source: "BACKYARD", value: 5.5 }), players);
  assert.strictEqual(syncAccountRoundIndex(players, "qa-owner", { source: "BACKYARD", value: 18 }, true), players);
});
test("unavailable account Index never promotes a group/manual number into a verified Index", () => {
  const round = instantiateGroupGameTemplate(group, () => "runtime-guest");
  const players = syncAccountRoundIndex(round.players, "qa-owner", { source: null, value: null });
  assert.equal(players[0].handicapIndex, null); assert.equal(players[0].handicap, null);
  assert.equal(players[1].handicap, 12);
});
