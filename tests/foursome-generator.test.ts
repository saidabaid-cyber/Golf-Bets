import assert from "node:assert/strict";
import test from "node:test";
import { defaultMaxBaseAppearances, generateAutomaticFoursomes, markFoursomeSegmentEdited } from "../lib/foursome-generator";

const order = Array.from({ length: 18 }, (_, index) => index + 1);

test("4 jugadores cada 6 recorren las tres parejas únicas del jugador A", () => {
  const result = generateAutomaticFoursomes({ participantIds: ["A", "B", "C", "D"], order, segmentSize: 6 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.segments.map((segment) => segment.basePair), [["A", "B"], ["A", "C"], ["A", "D"]]);
  assert.deepEqual(result.segments.map((segment) => [segment.startIndex, segment.endIndex]), [[0, 5], [6, 11], [12, 17]]);
});

test("4 jugadores cada 3 repiten las tres particiones sin repetición inmediata", () => {
  const result = generateAutomaticFoursomes({ participantIds: ["A", "B", "C", "D"], order, segmentSize: 3 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.segments.map((segment) => segment.basePair), [["A", "B"], ["A", "C"], ["A", "D"], ["A", "B"], ["A", "C"], ["A", "D"]]);
});

test("4 jugadores cada 9 usan dos particiones distintas", () => {
  const result = generateAutomaticFoursomes({ participantIds: ["A", "B", "C", "D"], order, segmentSize: 9 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notDeepEqual(result.segments[0].basePair, result.segments[1].basePair);
});

test("5 jugadores respetan máximo y distribuyen la pareja base", () => {
  const ids = ["A", "B", "C", "D", "E"];
  const result = generateAutomaticFoursomes({ participantIds: ids, order, segmentSize: 3 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const appearances = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  result.segments.forEach((segment) => segment.basePair.forEach((id) => { appearances[id] += 1; }));
  assert.ok(Math.max(...Object.values(appearances)) <= defaultMaxBaseAppearances(3));
  assert.equal(new Set(result.segments.map((segment) => [...segment.basePair].sort().join("/"))).size, result.segments.length);
});

test("máximo imposible produce explicación y no muta segmentos", () => {
  const result = generateAutomaticFoursomes({ participantIds: ["A", "B", "C", "D", "E"], order, segmentSize: 3, maxBaseAppearances: 2 });
  assert.deepEqual(result, { ok: false, code: "impossible_max_appearances", message: "Ese máximo no alcanza para cubrir todos los segmentos. Auméntalo y vuelve a intentar." });
});

test("una pareja generada queda marcada y al editar se vuelve manual", () => {
  const result = generateAutomaticFoursomes({ participantIds: ["A", "B", "C", "D"], order, segmentSize: 6 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.segments[0].generatedByBackyard, true);
  assert.equal(markFoursomeSegmentEdited(result.segments[0]).generatedByBackyard, false);
});
