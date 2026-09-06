import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculatePersonalBets } from "../lib/engine";
import { emptyCounterBetKeepers } from "../lib/side-bets";
import { initialBets } from "../lib/new-round-bets";
import { createSupplementalBet } from "../lib/supplemental-bets";
import { abandonedPressurePlayersWithMissingScores, firstIncompleteRoundCapture, incompleteCoreBetSettlements, incompleteExternalPersonalBets, unsettledSupplementalBetResults } from "../lib/round-completion";
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

function groupBet(components: PersonalBet["components"]): PersonalBet {
  return {
    ...externalBet(components),
    id: "group",
    rivalMode: "group",
    rivalPlayerId: "friend",
    rivalName: "",
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

test("archive rejects provisional supplemental calculations without altering final ones", () => {
  const pending = { betId: "pending", type: "individual_pressures" as const, label: "Presiones", complete: false };
  const final = { betId: "final", type: "chicago" as const, label: "Chicago", complete: true };
  assert.deepEqual(unsettledSupplementalBetResults([final, pending]), [pending]);
  assert.deepEqual(unsettledSupplementalBetResults([final]), []);
});

test("a team-pressure abandonment substitute never completes the canonical DNF card", () => {
  const roundPlayers: Player[] = [
    { id: "a", name: "A", handicap: 0 },
    { id: "b", name: "B", handicap: 0 },
    { id: "c", name: "C", handicap: 0 },
    { id: "d", name: "D", handicap: 0 },
  ];
  const pressure = createSupplementalBet("team_pressures", roundPlayers, "dnf");
  assert.equal(pressure.type, "team_pressures");
  if (pressure.type !== "team_pressures") return;
  pressure.abandonedPlayerIds = ["b", "b", "outside"];
  const rotatedOrder = order.slice(9);
  const partialScores = Object.fromEntries(rotatedOrder.map((hole) => [hole, { a: 4, c: 4, d: 4 }]));

  assert.deepEqual(
    abandonedPressurePlayersWithMissingScores(rotatedOrder, roundPlayers, partialScores, [pressure]).map((player) => player.id),
    ["b"],
  );
  assert.equal(Object.hasOwn(partialScores[10], "b"), false);

  const completeScores = Object.fromEntries(rotatedOrder.map((hole) => [hole, { a: 4, b: 8, c: 4, d: 4 }]));
  assert.deepEqual(abandonedPressurePlayersWithMissingScores(rotatedOrder, roundPlayers, completeScores, [pressure]), []);
});

test("the DNF explanation runs before the generic missing-score archive guard", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const saveStart = page.indexOf("function saveRound()");
  const specificGuard = page.indexOf("abandonedPressurePlayersWithMissingScores", saveStart);
  const genericGuard = page.indexOf("Faltan scores por confirmar", saveStart);
  assert.ok(saveStart >= 0 && specificGuard > saveStart && genericGuard > specificGuard);
  assert.match(page.slice(specificGuard, genericGuard), /no captures scores ficticios/);
  assert.match(page.slice(specificGuard, genericGuard), /solo se usa para calcular Presiones/);

  const liveStart = page.indexOf("function saveAndAdvance()");
  const liveGuard = page.indexOf("abandonedPressurePlayersWithMissingScores([holeNumber]", liveStart);
  const liveValidation = page.indexOf("collectHoleValidationErrors", liveStart);
  const liveCommit = page.indexOf("commitHoleCapture", liveStart);
  assert.ok(liveStart >= 0 && liveGuard > liveStart && liveValidation > liveGuard && liveCommit > liveValidation);
  assert.match(page.slice(liveStart, liveGuard), /scoreEdits\[holeNumber\]/);
  assert.match(page.slice(liveGuard, liveCommit), /jugador retirado \(DNF\)/);

  const editor = readFileSync("app/components/supplemental-bets-editor.tsx", "utf8");
  assert.match(editor, /Score máximo \(solo apuesta\)/);
  assert.match(editor, /la tarjeta sigue incompleta/);
});

test("the history action applies the supplemental settlement guard before persisting", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const saveStart = page.indexOf("function saveRound()");
  const persistStart = page.indexOf("void saveConfirmedRound(snapshot)", saveStart);
  const guardStart = page.indexOf("unsettledSupplementalBetResults(supplemental.results)", saveStart);
  assert.ok(saveStart >= 0 && guardStart > saveStart && persistStart > guardStart);
  assert.match(page.slice(guardStart, persistStart), /sigue provisional/);
  assert.match(page.slice(guardStart, persistStart), /supplemental\.results\.length !== activeSupplementalCount/);
  assert.match(page.slice(guardStart, persistStart), /incompleteCoreBetSettlements/);
  assert.match(page.slice(guardStart, persistStart), /isFiniteZeroSum\(Object\.values\(allBetBalances\)\)/);
});

test("archive readiness covers every completion-sensitive core wager", () => {
  const activeBets = initialBets(["a", "b", "c", "d"]);
  activeBets.foursome.enabled = true;
  activeBets.polla.first9.enabled = true;
  activeBets.polla.second9.enabled = true;
  activeBets.polla.total18.enabled = true;
  activeBets.miniPolla.enabled = true;
  activeBets.monkey!.enabled = true;
  activeBets.ballFriend.enabled = true;
  activeBets.loba.enabled = true;
  const playedHoles = order.map((hole) => ({ hole }));
  const segments = [{ id: "round", startIndex: 0, endIndex: 17, basePair: ["a", "b"] }];
  const personalBet = groupBet({ match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false });
  const ready = {
    order,
    bets: activeBets,
    segments,
    foursomeMatches: [{
      segmentId: "round",
      opponentPair: ["c", "d"] as [string, string],
      complete: true,
      completedHoles: 18,
      holePoints: playedHoles,
    }],
    pollaDetails: [
      { key: "first9" as const, complete: true, winnerIds: ["a"] },
      { key: "second9" as const, complete: true, winnerIds: ["a", "b"] },
      { key: "total18" as const, complete: true, winnerIds: ["b"] },
    ],
    miniPollaDetails: [{ key: "mini" as const, complete: true, winnerIds: ["c"] }],
    personalBets: [personalBet],
    personalResults: [{ betId: "group", liveComponents: [{ key: "match1", complete: true }] }],
    monkey: { valid: true, details: playedHoles },
    ballFriendDetails: playedHoles,
    loba: { zeroSum: true, details: playedHoles.map(({ hole }) => ({ hole, winner: "tie" })) },
  };
  assert.deepEqual(incompleteCoreBetSettlements(ready), []);

  assert.deepEqual(incompleteCoreBetSettlements({
    ...ready,
    foursomeMatches: [{ ...ready.foursomeMatches[0], complete: false }],
    pollaDetails: [],
    miniPollaDetails: [],
    personalResults: [{ betId: "group", liveComponents: [{ key: "match1", complete: false }] }],
    monkey: { valid: true, details: playedHoles.slice(0, -1) },
    ballFriendDetails: playedHoles.slice(0, -1),
    loba: { zeroSum: false, details: playedHoles.map(({ hole }) => ({ hole, winner: "tie" })) },
  }), ["Foursome", "Polla 1ª vuelta", "Polla 2ª vuelta", "Polla Nassau", "Mini Polla", "Personales", "Monkey", "Bola Amiga", "Loba"]);
});

test("archive readiness rejects duplicate, missing, and malformed terminal results", () => {
  const bets = initialBets(["a", "b", "c", "d", "e"]);
  bets.foursome.enabled = true;
  bets.polla.first9.enabled = true;
  bets.miniPolla.enabled = true;
  bets.loba.enabled = true;
  const holes = order.map((hole) => ({ hole }));
  const group = groupBet({ match1: true, medal1: true, match2: false, medal2: false, match18: false, medal18: false });
  const base = {
    order,
    bets,
    segments: [{ id: "round", startIndex: 0, endIndex: 17, basePair: ["a", "b"] }],
    foursomeMatches: [
      ["c", "d"], ["c", "e"], ["d", "e"],
    ].map((opponentPair) => ({
      segmentId: "round",
      opponentPair: opponentPair as [string, string],
      complete: true,
      completedHoles: 18,
      holePoints: holes,
    })),
    pollaDetails: [{ key: "first9" as const, complete: true, winnerIds: ["a", "b"] }],
    miniPollaDetails: [{ key: "mini" as const, complete: true, winnerIds: ["a"] }],
    personalBets: [group],
    personalResults: [{
      betId: "group",
      liveComponents: [
        { key: "match1", complete: true },
        { key: "medal1", complete: true },
      ],
    }],
    monkey: { details: [] },
    ballFriendDetails: [],
    loba: { zeroSum: true, details: holes.map(({ hole }) => ({ hole, winner: "tie" })) },
  };
  assert.deepEqual(incompleteCoreBetSettlements(base), []);

  assert.deepEqual(incompleteCoreBetSettlements({
    ...base,
    foursomeMatches: base.foursomeMatches.slice(0, -1),
    pollaDetails: [...base.pollaDetails, ...base.pollaDetails],
    miniPollaDetails: [{ key: "mini", complete: true, winnerIds: [] }],
    personalResults: [{ betId: "group", liveComponents: [{ key: "match1", complete: true }, { key: "match1", complete: true }] }],
    loba: { zeroSum: true, details: holes.map(({ hole }, index) => ({ hole, winner: index ? "tie" : "invalid" })) },
  }), ["Foursome", "Polla 1ª vuelta", "Mini Polla", "Personales", "Loba"]);

  assert.deepEqual(incompleteCoreBetSettlements({
    ...base,
    foursomeMatches: base.foursomeMatches.map((match, index) => index ? match : {
      ...match,
      completedHoles: 17,
      holePoints: [...holes.slice(0, -1), { hole: 1 }],
    }),
  }), ["Foursome"]);
});

test("nine-hole archive checks only applicable internal Personal components", () => {
  const bets = initialBets(["owner", "friend"]);
  const personalBet = groupBet({ match1: true, medal1: false, match2: true, medal2: true, match18: true, medal18: true });
  assert.deepEqual(incompleteCoreBetSettlements({
    order: order.slice(9),
    bets,
    segments: [],
    foursomeMatches: [],
    pollaDetails: [],
    miniPollaDetails: [],
    personalBets: [personalBet, externalBet(personalBet.components)],
    personalResults: [{ betId: "group", liveComponents: [{ key: "match1", complete: true }] }],
    monkey: { details: [] },
    ballFriendDetails: [],
    loba: { details: [] },
  }), []);
});

test("archive readiness exempts wager families with valid terminal carry or optional events", () => {
  const bets = initialBets(["a", "b"]);
  bets.rabbits.enabled = true;
  bets.skins.enabled = true;
  bets.units.enabled = true;
  bets.vipers.enabled = true;
  bets.camels.enabled = true;
  bets.fish.enabled = true;
  assert.deepEqual(incompleteCoreBetSettlements({
    order,
    bets,
    segments: [],
    foursomeMatches: [],
    pollaDetails: [],
    miniPollaDetails: [],
    personalBets: [],
    personalResults: [],
    monkey: { details: [] },
    ballFriendDetails: [],
    loba: { details: [] },
  }), []);
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
