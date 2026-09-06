import assert from "node:assert/strict";
import test from "node:test";

import { calculatePersonalBets } from "../lib/engine";
import { emptyCounterBetKeepers } from "../lib/side-bets";
import { initialBets } from "../lib/new-round-bets";
import { createSupplementalBet } from "../lib/supplemental-bets";
import { firstIncompleteRoundCapture, incompleteExternalPersonalBets } from "../lib/round-completion";
import type { Course, PersonalBet, Player, PuttsByHole, SupplementalBet } from "../lib/types";

const players: Player[] = [{ id: "owner", name: "Said", handicap: 8 }];
const order = Array.from({ length: 18 }, (_, index) => index + 1);
const course: Course = {
  id: "completion-course",
  name: "Campo",
  teeName: "General",
  holes: order.map((number) => ({ number, par: 4, strokeIndex: number })),
};
const ownerScores = Object.fromEntries(order.map((hole) => [hole, { owner: 4 }]));

function externalBet(components: PersonalBet["components"]): PersonalBet {
  return {
    id: "external",
    enabled: true,
    rivalMode: "external",
    rivalName: "Invitado externo",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "none",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    carryEnabled: false,
    components,
  };
}

test("archive blocks an external Personal until every selected component is complete", () => {
  const bet = externalBet({ match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false });
  let results = calculatePersonalBets([bet], "owner", players, course, ownerScores, order).results;
  assert.deepEqual(incompleteExternalPersonalBets([bet], results).map((item) => item.id), ["external"]);

  bet.externalScores = Object.fromEntries(order.slice(0, 9).map((hole) => [hole, 4.5]));
  results = calculatePersonalBets([bet], "owner", players, course, ownerScores, order).results;
  assert.deepEqual(incompleteExternalPersonalBets([bet], results).map((item) => item.id), ["external"]);

  bet.externalScores = Object.fromEntries(order.slice(0, 9).map((hole) => [hole, 5]));
  results = calculatePersonalBets([bet], "owner", players, course, ownerScores, order).results;
  assert.deepEqual(incompleteExternalPersonalBets([bet], results), []);

  bet.components = { ...bet.components, match18: true };
  results = calculatePersonalBets([bet], "owner", players, course, ownerScores, order).results;
  assert.deepEqual(incompleteExternalPersonalBets([bet], results).map((item) => item.id), ["external"]);
});

test("disabled and in-group Personal bets do not require a separate external card", () => {
  const disabled = { ...externalBet({ match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false }), enabled: false };
  const group = { ...disabled, id: "group", enabled: true, rivalMode: "group" as const, rivalPlayerId: "friend" };
  assert.deepEqual(incompleteExternalPersonalBets([disabled, group], []), []);
});

test("archive rechecks Minimum Putts across prior holes and only its configured duration", () => {
  const bets = initialBets(["owner"]);
  const minimumPutts = createSupplementalBet("minimum_putts", players, "putts", 9) as Extract<SupplementalBet, { type: "minimum_putts" }>;
  const base = {
    order,
    players,
    scores: ownerScores,
    bets,
    segments: [],
    supplementalBets: [minimumPutts],
    putts: {} as PuttsByHole,
    counterBetKeepers: emptyCounterBetKeepers(),
    counterBetEvents: [],
    lobaHoles: {},
    ballFriendSetup: {},
  };
  const missing = firstIncompleteRoundCapture(base);
  assert.equal(missing?.holeNumber, 1);
  assert.match(missing?.errors.join(" ") ?? "", /putts/);

  const firstNinePutts = Object.fromEntries(order.slice(0, 9).map((hole) => [hole, { owner: 2 }])) as PuttsByHole;
  assert.equal(firstIncompleteRoundCapture({ ...base, putts: firstNinePutts }), null);
});
