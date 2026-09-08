import assert from "node:assert/strict";
import test from "node:test";

import type { BackyardProfile } from "../lib/account-state";
import { calculatePersonalBets, playOrder } from "../lib/engine";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";
import type { Course, FrequentGroup, FrequentPlayer, Player, RoundSnapshot } from "../lib/types";

const course: Course = {
  id: "la-vista-azules",
  name: "La Vista",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1,
    par: 4,
    strokeIndex: index + 1,
  })),
};

const players: Player[] = [
  { id: "said", name: "Said", handicap: 8, accountUserId: "user-said" },
  { id: "pedro", name: "Pedro", handicap: 10 },
  { id: "juan", name: "Juan", handicap: 12 },
  { id: "carlos", name: "Carlos", handicap: 14 },
];

const profile: BackyardProfile = {
  userId: "user-said",
  displayName: "Said Abaid",
  email: "said@example.test",
  avatarUrl: "",
  defaultHandicap: 8,
  homeClub: "La Vista",
  preferredTee: "Azules",
};

const frequentPlayers: FrequentPlayer[] = players.slice(1).map((player, index) => ({
  id: `frequent-${player.id}`,
  name: player.name,
  handicap: player.handicap,
  uses: 10 - index,
  updatedAt: "2026-09-08T12:00:00.000Z",
}));

function setupContext(startHole: 1 | 10 = 1) {
  let sequence = 0;
  return {
    profile,
    frequentPlayers,
    frequentGroups: [] as FrequentGroup[],
    history: [] as RoundSnapshot[],
    courses: [course],
    today: "2026-09-08",
    idFactory: () => `nassau-9h-${++sequence}`,
    activeDraft: createRoundSetupDraft({
      date: "2026-09-08",
      course,
      players,
      ownerId: "said",
      startHole,
    }),
  };
}

function winningScores(order: number[]) {
  return Object.fromEntries(order.map((hole) => [hole, { said: 4, pedro: 5, juan: 4, carlos: 4 }]));
}

const NINE_HOLE_COMPONENTS = {
  match1: true,
  medal1: true,
  match2: false,
  medal2: false,
  match18: false,
  medal18: false,
};

test("‘Sólo jugamos 9 hoyos. Nassau Said contra Pedro de 500.’ configura y liquida únicamente los dos componentes jugables", () => {
  const plan = planRoundSetup(
    "Sólo jugamos 9 hoyos. Nassau Said contra Pedro de 500.",
    setupContext(),
  );

  assert.equal(plan.draft.roundHoles, 9);
  assert.equal(plan.draft.personalBets.length, 1);
  assert.equal(plan.draft.supplementalBets.length, 0);
  assert.equal(plan.draft.personalBets[0].rivalPlayerId, "pedro");
  assert.equal(plan.draft.personalBets[0].baseValue, 500);
  assert.deepEqual(plan.draft.personalBets[0].components, NINE_HOLE_COMPONENTS);

  const order = playOrder(1).slice(0, 9);
  const result = calculatePersonalBets(plan.draft.personalBets, "said", players, course, winningScores(order), order);
  assert.deepEqual(result.results[0].liveComponents.map((component) => component.key), ["match1", "medal1"]);
  assert.equal(result.results[0].totalMoney, 1_000);
  assert.deepEqual(result.results[0].componentMoney, {
    match1: 500,
    medal1: 500,
    match2: 0,
    medal2: 0,
    match18: 0,
    medal18: 0,
  });
});

test("una ronda de 9 hoyos saliendo por H10 conserva el primer nueve jugado como H10–18", () => {
  const plan = planRoundSetup(
    "Sólo jugamos 9 hoyos. Salimos por el 10. Nassau Said contra Pedro de 500.",
    setupContext(1),
  );

  assert.equal(plan.draft.startHole, 10);
  assert.deepEqual(plan.draft.personalBets[0].components, NINE_HOLE_COMPONENTS);
  const order = playOrder(10).slice(0, 9);
  const result = calculatePersonalBets(plan.draft.personalBets, "said", players, course, winningScores(order), order);
  assert.deepEqual(result.results[0].liveComponents.map((component) => ({
    key: component.key,
    firstHole: component.holes[0],
    lastHole: component.holes.at(-1),
    label: component.label,
  })), [
    { key: "match1", firstHole: 10, lastHole: 18, label: "Match H10–18" },
    { key: "medal1", firstHole: 10, lastHole: 18, label: "Medal H10–18" },
  ]);
  assert.equal(result.results[0].totalMoney, 1_000);
});

test("cambiar un Nassau personal ya configurado de 18H a 9H elimina sus cuatro componentes inaplicables", () => {
  const configured = planRoundSetup("Nassau Said contra Pedro de 500.", setupContext());
  assert.deepEqual(configured.draft.personalBets[0].components, {
    match1: true,
    medal1: true,
    match2: true,
    medal2: true,
    match18: true,
    medal18: true,
  });

  const shortened = planRoundSetup("Sólo jugamos 9 hoyos.", {
    ...setupContext(),
    activeDraft: configured.draft,
  });
  assert.deepEqual(shortened.draft.personalBets[0].components, NINE_HOLE_COMPONENTS);
});
