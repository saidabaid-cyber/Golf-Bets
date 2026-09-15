import assert from "node:assert/strict";
import test from "node:test";
import { safeSocialRoundCard } from "../lib/social-round-card";
import type { RoundSnapshot } from "../lib/types";

const SAID = "11111111-1111-4111-8111-111111111111";
const PEDRO = "22222222-2222-4222-8222-222222222222";
const ORDER = Array.from({ length: 18 }, (_, index) => index + 1);
const HOLES = ORDER.map(number => ({ number, par: 4, strokeIndex: number }));

function source(overrides: Partial<RoundSnapshot> = {}) {
  const snapshot: RoundSnapshot = {
    id: "local-round-qa", lifecycleState: "completed", completedAt: "2026-09-15T15:00:00.000Z",
    date: "2026-09-15", courseName: "Campo privado de Said", teeName: "Blancas",
    ownerName: "Said secreto", ownerId: "said-player", betResult: 500, expenseTotal: 100,
    netResult: 400, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 100, cartRental: 0, other: 0 },
    categoryResults: { foursome: 500 },
    players: [
      { id: "said-player", name: "Said secreto", handicap: 7, accountUserId: SAID },
      { id: "pedro-player", name: "Pedro secreto", handicap: 14, accountUserId: PEDRO },
    ],
    order: ORDER, roundHoles: 18,
    courseSnapshot: { id: "private-course", name: "Campo privado de Said", teeName: "Blancas", holes: HOLES },
    scores: Object.fromEntries(ORDER.map(number => [number, { "said-player": 4, "pedro-player": 5 }])),
    playerBalances: { "said-player": 500, "pedro-player": -500 },
    resultDetails: { privateOrganizerNotes: "Nunca compartir" },
    ...overrides,
  };
  return { id: "44444444-4444-4444-8444-444444444444", local_round_id: snapshot.id, snapshot };
}

test("card social proyecta únicamente el score del accountUserId enlazado, sin PII o balances de terceros", () => {
  const owner = safeSocialRoundCard(source(), SAID, true);
  const participant = safeSocialRoundCard(source(), PEDRO, true);
  assert.ok(owner && participant);
  assert.equal(owner.ownerScore, 72);
  assert.equal(participant.ownerScore, 90);
  assert.deepEqual(owner.scorecard?.map(hole => hole.score), Array(18).fill(4));
  assert.deepEqual(participant.scorecard?.map(hole => hole.score), Array(18).fill(5));
  for (const card of [owner, participant]) {
    const text = JSON.stringify(card);
    for (const secret of ["Said secreto", "Pedro secreto", SAID, PEDRO, "privateOrganizerNotes", "500", "Nunca compartir"])
      assert.equal(text.includes(secret), false, `card leaked ${secret}`);
    assert.equal("players" in card, false);
    assert.equal("betResult" in card, false);
  }
});

test("shareCourses=false oculta identidad campo/tee y homeClub; resumen puede omitir scorecard", () => {
  const privateCard = safeSocialRoundCard(source(), PEDRO, false, false);
  assert.ok(privateCard);
  assert.equal(privateCard.courseName, "Campo privado");
  assert.equal(privateCard.teeName, null);
  assert.equal(privateCard.ownerScore, 90);
  assert.equal("scorecard" in privateCard, false);
  assert.equal(JSON.stringify(privateCard).includes("Campo privado de Said"), false);
  assert.equal(JSON.stringify(privateCard).includes("homeClub"), false);
});

test("no crea card para identidad ausente, repetida ni score/campo incompleto", () => {
  assert.equal(safeSocialRoundCard(source(), "unknown-account", true), null);
  const duplicated = source(); duplicated.snapshot.players!.push({
    ...duplicated.snapshot.players![0], id: "duplicate-said",
  });
  assert.equal(safeSocialRoundCard(duplicated, SAID, true), null);
  assert.equal(safeSocialRoundCard(source({ lifecycleState: "live" }), SAID, true), null);
  const missingScore = source(); delete missingScore.snapshot.scores![18];
  assert.equal(safeSocialRoundCard(missingScore, SAID, true), null);
  const missingCourse = source(); missingCourse.snapshot.courseSnapshot!.holes.pop();
  assert.equal(safeSocialRoundCard(missingCourse, SAID, true), null);
});

test("9H completados pueden mostrar sólo sus nueve hoyos; logros personales siguen reservados a 18H", () => {
  const nine = source({ roundHoles: 9, order: ORDER.slice(0, 9) });
  const card = safeSocialRoundCard(nine, PEDRO, true);
  assert.ok(card);
  assert.equal(card.holesPlayed, 9);
  assert.equal(card.ownerScore, 45);
  assert.equal(card.scorecard?.length, 9);
});
