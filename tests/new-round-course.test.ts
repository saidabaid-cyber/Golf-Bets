import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRoundDraft } from "../lib/round-utils";
import type { Course } from "../lib/types";

const course: Course = {
  id: "qa-course",
  name: "Campo QA",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

test("un borrador nuevo conserva explícitamente que todavía no se eligió campo", () => {
  const draft = normalizeRoundDraft({ course, courseSelected: false, players: [{ id: "p1", name: "Jugador A", handicap: 5 }] });
  assert.equal(draft?.courseSelected, false);
  assert.equal(draft?.course?.name, "Campo QA");
});

test("borradores antiguos con campo conservan la selección existente", () => {
  const legacy = normalizeRoundDraft({ course, players: [{ id: "p1", name: "Jugador A", handicap: 5 }] });
  assert.equal(legacy?.courseSelected, true);
});

test("un campo inválido nunca se presenta como seleccionado", () => {
  const draft = normalizeRoundDraft({ course: { name: "Incompleto" }, courseSelected: true, players: [] });
  assert.equal(draft?.courseSelected, false);
  assert.equal(draft?.course, undefined);
});
