import assert from "node:assert/strict";
import test from "node:test";
import { createSingleAdvance, HOLE_SUMMARY_DURATION_MS, nextHoleDestination, pauseCountdown, resumeCountdown, startCountdown } from "../lib/hole-summary";

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

test("hoyos críticos avanzan una sola vez y el último termina sin desbordar", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  for (const hole of [1, 2, 9, 10, 17, 18]) {
    const index = hole - 1;
    let advances = 0;
    const close = createSingleAdvance(() => { advances += 1; });
    close(); close(); close();
    assert.equal(advances, 1, `H${hole} avanzó más de una vez`);
    assert.deepEqual(nextHoleDestination(order, index), hole === 18 ? { kind: "results" } : { kind: "hole", index: index + 1 });
  }
});

test("la X de resumen cierra en pointerup sin compartir la pausa", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /className="holeSummaryClose"[\s\S]{0,320}onPointerUp=[\s\S]{0,180}closeHoleSummary/);
  assert.match(page, /className="holeSummaryContent"[\s\S]{0,220}onPointerDown=\{pauseHoleSummary\}/);
});
