import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveRoundDraftCore } from "../app/draft-restoration";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import { normalizeRoundStartHole, playOrder } from "../lib/engine";
import { validateTeeFeedback } from "../lib/feedback";
import { parsePollaPlayersCsv } from "../lib/polla-live";
import { createTotalScoreRound } from "../lib/total-score-round";
import type { Course, Player } from "../lib/types";

const course: Course = {
  id: "course-qa",
  name: "Campo QA",
  teeName: "Azul",
  catalogCourseId: "layout-qa",
  catalogTeeId: "tee-blue",
  totalYards: 6742,
  rating: 72.4,
  slope: 136,
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};
const player: Player = { id: "player-qa", accountUserId: "user-qa", name: "Jugador QA", handicap: 8 };

for (const [start, expected] of [
  [1, [1, 2, 3, 4]],
  [3, [3, 4, 5, 6]],
  [5, [5, 6, 7, 8]],
  [10, [10, 11, 12, 13]],
  [18, [18, 1, 2, 3]],
] as const) {
  test(`shotgun order starts at H${start} and wraps once`, () => {
    const order = playOrder(start);
    assert.deepEqual(order.slice(0, 4), expected);
    assert.equal(order.length, 18);
    assert.equal(new Set(order).size, 18);
  });
}

test("invalid start holes normalize safely to H1", () => {
  assert.equal(normalizeRoundStartHole(0), 1);
  assert.equal(normalizeRoundStartHole(19), 1);
  assert.equal(normalizeRoundStartHole("5"), 5);
});

test("draft restoration and structured round draft preserve arbitrary shotgun start", () => {
  assert.equal(resolveRoundDraftCore({ startHole: 5, players: [player], ownerId: player.id }, "user-qa").startHole, 5);
  const draft = createRoundSetupDraft({ date: "2026-09-23", course, courseSelected: true, players: [player], ownerId: player.id, startHole: 18 });
  assert.equal(draft.startHole, 18);
  assert.deepEqual(playOrder(draft.startHole).slice(0, 4), [18, 1, 2, 3]);
});

test("total-score snapshot keeps a shotgun start without fabricating hole scores", () => {
  const snapshot = createTotalScoreRound({ id: "total-qa", course, player, date: "2026-09-23", holes: 18, start: 5, total: 80, now: "2026-09-23T18:00:00.000Z" });
  assert.equal(snapshot.startHole, 5);
  assert.deepEqual(snapshot.order?.slice(-4), [1, 2, 3, 4]);
  assert.deepEqual(snapshot.scores, {});
});

test("Polla CSV accepts verified physical start holes 1 through 18", () => {
  const result = parsePollaPlayersCsv("name,handicap,group,startHole,teeTime\nJugador,8,A,12,08:30");
  assert.deepEqual(result.issues, []);
  assert.equal(result.players[0].startHole, 12);
});

test("tee request remains a reported review request with required evidence", () => {
  assert.equal(validateTeeFeedback({ category: "TEE", courseName: "Campo QA", teeName: "Verde", description: "Tarjeta observada en recepción.", replyEmail: "qa@example.invalid" }).ok, true);
  assert.deepEqual(validateTeeFeedback({ category: "TEE", courseName: "Campo QA", teeName: "", description: "corto", replyEmail: "" }), { ok: false, error: "Indica el nombre o color del tee si lo conoces." });
});

test("round UI advances course → tee → details and nearby search is capped at 50 km", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const route = readFileSync("app/api/courses/search/route.ts", "utf8");
  const teePicker = readFileSync("app/components/round-tee-picker.tsx", "utf8");
  assert.match(page, /courseSetupStage.*"course" \| "tee" \| "details"/);
  assert.match(page, /<RoundTeePicker/);
  assert.match(page, /<StartHoleSelector/);
  assert.match(teePicker, /¿Falta un tee\? Solicitar tee/);
  assert.match(route, /radiusKm: 50/);
  assert.doesNotMatch(route, /radiusKm: 250/);
});
