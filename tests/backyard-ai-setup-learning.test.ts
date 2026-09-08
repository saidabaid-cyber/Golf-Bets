import assert from "node:assert/strict";
import test from "node:test";

import { buildRoundSetupCorrectionRecords } from "../lib/backyard-ai/memory/setup-learning";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import type { Course, Player } from "../lib/types";

const players: Player[] = [
  { id: "said", name: "Said", handicap: 8 },
  { id: "pedro", name: "Pedro", handicap: 10 },
];
const course: Course = {
  id: "la-vista",
  name: "La Vista",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

test("una edición conversacional conserva propuesta y corrección estructuradas sin guardar el prompt", () => {
  const previousDraft = createRoundSetupDraft({ date: "2026-09-08", course, courseSelected: true, players, ownerId: "said" });
  previousDraft.bets.skins = { ...previousDraft.bets.skins, enabled: true, value: 100, participantIds: ["said", "pedro"] };
  const plan = planRoundSetup("Mejor skins de 200", {
    activeDraft: previousDraft,
    courses: [course],
    frequentPlayers: [],
    frequentGroups: [],
    history: [],
    today: "2026-09-08",
    idFactory: (() => { let id = 0; return () => `plan-${++id}`; })(),
  });
  let id = 0;
  const result = buildRoundSetupCorrectionRecords({
    ownerId: "owner-1",
    previousDraft,
    plan,
    confidence: 0.96,
    durationMs: 120,
    usedModel: false,
    occurredAt: "2026-09-08T08:00:00.000Z",
    idFactory: () => `learning-${++id}`,
  });

  assert.equal(plan.draft.bets.skins.value, 200);
  assert.deepEqual(result.changes.map((change) => ({
    path: change.fieldPath,
    before: (change.proposedValue as { value: number }).value,
    after: (change.correctedValue as { value: number }).value,
  })), [{ path: "/bets/skins", before: 100, after: 200 }]);
  assert.ok(result.records.some((record) => record.recordType === "AI_ACTION"));
  assert.ok(result.records.some((record) => record.recordType === "AI_CORRECTION"));
  const event = result.records.find((record) => record.recordType === "LEARNING_EVENT");
  assert.equal(event?.trainingUse, "EXCLUDED");
  assert.doesNotMatch(JSON.stringify(result.records), /Mejor skins/);
});
