import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { BackyardProfile } from "../lib/account-state";
import { historicalBetDisplayLabel } from "../lib/bet-catalog";
import { executeRoundSetupAction } from "../lib/backyard-ai/runtime/action-executor";
import { initialBets } from "../lib/new-round-bets";
import { restoreRoundSnapshot, upsertRoundSnapshot } from "../lib/round-editing";
import { roundShareText } from "../lib/round-export";
import { groupNassauPresentation, normalizeRoundPresentation } from "../lib/round-presentation";
import { normalizeRoundDraft, persistRoundHistory, readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import type { Course, FrequentGroup, FrequentPlayer, Player, RoundSnapshot } from "../lib/types";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";

const course: Course = {
  id: "la-vista-azules",
  name: "La Vista",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};
const profile: BackyardProfile = {
  userId: "user-said",
  displayName: "Said Abaid",
  givenName: "Said",
  familyName: "Abaid",
  email: "said@example.test",
  avatarUrl: "",
  defaultHandicap: 8,
  homeClub: "La Vista",
  preferredTee: "Azules",
};
const players: Player[] = [
  { id: "said", name: "Said Abaid", handicap: 8, accountUserId: profile.userId },
  { id: "pedro", name: "Pedro", handicap: 10 },
];
const frequentPlayers: FrequentPlayer[] = [
  { id: "pedro", name: "Pedro", handicap: 10, uses: 4, updatedAt: "2026-09-08T12:00:00.000Z" },
];

function context() {
  let sequence = 0;
  return {
    profile,
    frequentPlayers,
    frequentGroups: [] as FrequentGroup[],
    history: [] as RoundSnapshot[],
    courses: [course],
    today: "2026-09-08",
    idFactory: () => `generated-${++sequence}`,
  };
}

function completedSnapshot(presentation: RoundSnapshot["presentation"]): RoundSnapshot {
  const bets = initialBets(players.map((player) => player.id));
  bets.polla.first9 = { ...bets.polla.first9, enabled: true, value: 500 };
  bets.polla.second9 = { ...bets.polla.second9, enabled: true, value: 500 };
  bets.polla.total18 = { ...bets.polla.total18, enabled: true, value: 500 };
  return {
    id: "round-presentation",
    lifecycleState: "completed",
    date: "2026-09-08",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: "Said Abaid",
    ownerId: "said",
    roundHoles: 18,
    startHole: 1,
    handicapBasis: "relative",
    presentation,
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: { "Polla 1ª vuelta": 0, "Polla 2ª vuelta": 0, "Polla Nassau": 0 },
    categoryBalances: { "Polla 1ª vuelta": { said: 0, pedro: 0 } },
    players: structuredClone(players),
    scores: {},
    courseSnapshot: structuredClone(course),
    order: Array.from({ length: 18 }, (_, index) => index + 1),
    betConfig: bets,
    segments: [],
    completedAt: "2026-09-08T20:00:00.000Z",
    updatedAt: "2026-09-08T20:00:00.000Z",
  };
}

for (const [input, expected] of [
  ["Jugamos Said y Pedro en La Vista. Nassau de $500.", "nassau"],
  ["Jugamos Said y Pedro en La Vista. Polla primera vuelta de $500.", "polla"],
] as const) {
  test(`${expected} conserva su terminología al aplicar, guardar y restaurar`, () => {
    const plan = planRoundSetup(input, context());
    assert.equal(plan.draft.presentation?.version, 1);
    assert.equal(normalizeRoundPresentation(plan.draft.presentation).groupNassauTerm, expected);
    assert.equal(plan.draft.bets.polla.first9.value, 500, "la representación del engine sigue siendo bets.polla");

    const applied = normalizeRoundPresentation(plan.draft.presentation);
    assert.equal(applied.groupNassauTerm, expected);

    const draft = normalizeRoundDraft(JSON.parse(JSON.stringify({
      course,
      courseSelected: true,
      players,
      ownerId: "said",
      bets: plan.draft.bets,
      presentation: applied,
    })));
    assert.equal(draft?.presentation.groupNassauTerm, expected);

    let raw = "";
    const storage = {
      getItem: (key: string) => key === STORAGE_KEYS.history ? raw : null,
      setItem: (_key: string, value: string) => { raw = value; },
    };
    const snapshot = completedSnapshot(applied);
    persistRoundHistory(storage, upsertRoundSnapshot([], snapshot));
    const saved = readStoredJson<RoundSnapshot[]>(storage, STORAGE_KEYS.history, [])[0];
    const restored = restoreRoundSnapshot(saved);
    assert.equal(restored?.presentation?.groupNassauTerm, expected);

    const labels = groupNassauPresentation(restored?.presentation);
    assert.equal(labels.name, expected === "nassau" ? "Nassau" : "Polla");
    assert.equal(labels.component("first9"), expected === "nassau" ? "Nassau · frente" : "Polla 1ª vuelta");
    assert.equal(labels.resultComponent("mini"), "Mini Polla");
    assert.equal(
      historicalBetDisplayLabel("Polla 1ª vuelta", restored?.presentation),
      expected === "nassau" ? "🥈 Nassau · frente" : "🥈 Polla 1ª vuelta",
    );
    assert.match(roundShareText({ ...snapshot, categoryResults: { "Polla 1ª vuelta": 100 } }), expected === "nassau" ? /Nassau · frente/ : /Polla 1ª vuelta/);
  });
}

test("la UI conecta metadata de presentación en ronda activa, captura, snapshot y restauración", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const capture = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  assert.match(page, /setRoundPresentation\(normalizeRoundPresentation\(draft\.presentation\)\)/);
  assert.match(page, /presentation: normalizeRoundPresentation\(roundPresentation\)/);
  assert.match(page, /groupNassauLabel=.*groupNassauLabels\.summary/);
  assert.match(page, /setRoundPresentation\(normalizeRoundPresentation\(restored\.presentation\)\)/);
  assert.match(capture, /APUESTA ACTIVA[\s\S]*groupNassauLabel/);
});

test("snapshots legacy sin metadata mantienen la terminología Polla", () => {
  const restored = restoreRoundSnapshot(completedSnapshot(undefined));
  assert.equal(restored?.presentation, undefined);
  assert.equal(groupNassauPresentation(restored?.presentation).name, "Polla");
});

test("‘como la semana pasada’ recupera también la terminología visible, no sólo bets.polla", () => {
  const plan = planRoundSetup("Como la semana pasada.", {
    ...context(),
    history: [{ ...completedSnapshot({ version: 1, groupNassauTerm: "nassau" }), date: "2026-09-03" }],
  });
  assert.equal(plan.draft.presentation?.groupNassauTerm, "nassau");
  assert.equal(plan.draft.bets.polla.first9.enabled, true);
  assert.equal(plan.draft.bets.polla.first9.value, 500);
});

test("una preferencia de participantes no cambia la terminología elegida por el usuario", () => {
  const plan = planRoundSetup("Polla primera vuelta de 500.", { ...context(), activeDraft: planRoundSetup("Jugamos Said y Pedro en La Vista. Skins de 100.", context()).draft });
  assert.equal(plan.draft.presentation?.groupNassauTerm, "polla");

  const memoryUpdate = executeRoundSetupAction(plan.draft, {
    type: "configure_group_nassau",
    participantIds: plan.draft.players.map((player) => player.id),
    source: "personal_memory",
    confidence: 0.95,
    evidence: "Preferencia confirmada",
  });

  assert.equal(memoryUpdate.rejected.length, 0);
  assert.equal(memoryUpdate.draft.presentation?.groupNassauTerm, "polla");
});
