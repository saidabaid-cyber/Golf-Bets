import assert from "node:assert/strict";
import test from "node:test";
import { createSingleAdvance, HOLE_SUMMARY_DURATION_MS, pauseCountdown, resumeCountdown, startCountdown } from "../lib/hole-summary";

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

test("mantener presionado pausa el tiempo restante y soltarlo lo reanuda", () => {
  const started = startCountdown(10_000, 1_000);
  const paused = pauseCountdown(started, 4_250);
  assert.deepEqual(paused, { remaining: 6_750, startedAt: 4_250, paused: true });
  assert.deepEqual(pauseCountdown(paused, 8_000), paused);
  const resumed = resumeCountdown(paused, 12_000);
  assert.deepEqual(resumed, { remaining: 6_750, startedAt: 12_000, paused: false });
});
