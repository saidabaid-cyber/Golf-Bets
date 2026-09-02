import assert from "node:assert/strict";
import test from "node:test";
import { createSingleAdvance, HOLE_SUMMARY_DURATION_MS } from "../lib/hole-summary";

test("resumen de hoyo permanece diez segundos", () => {
  assert.equal(HOLE_SUMMARY_DURATION_MS, 10_000);
});

test("X y timeout no pueden avanzar dos veces", () => {
  let advances = 0;
  const advance = createSingleAdvance(() => { advances += 1; });
  assert.equal(advance(), true);
  assert.equal(advance(), false);
  assert.equal(advances, 1);
});
