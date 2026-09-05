import assert from "node:assert/strict";
import test from "node:test";
import { createHoleSummarySession, createSingleAdvance, HOLE_SUMMARY_DURATION_MS, nextHoleDestination, pauseCountdown, resumeCountdown, startCountdown } from "../lib/hole-summary";

test("resumen de hoyo permanece diez segundos", () => {
  assert.equal(HOLE_SUMMARY_DURATION_MS, 10_000);
});

test("un callback de timeout repetido no puede avanzar dos veces", () => {
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

test("sesión real pausa con un toque, conserva el tiempo y reanuda con otro", () => {
  let now = 1_000;
  let advances = 0;
  let nextTimer = 0;
  const timers = new Map<number, { action: () => void; delay: number }>();
  const paused: boolean[] = [];
  const session = createHoleSummarySession({
    now: () => now,
    schedule: (action, delay) => { const id = ++nextTimer; timers.set(id, { action, delay }); return id; },
    cancel: id => { timers.delete(id); },
    onAdvance: () => { advances += 1; },
    onPauseChange: value => paused.push(value),
  });
  assert.equal(timers.get(1)?.delay, 10_000);
  now = 4_250;
  assert.equal(session.togglePause(), true);
  assert.equal(session.isPaused(), true);
  assert.equal(session.remaining(), 6_750);
  assert.equal(timers.size, 0);
  now = 20_000;
  assert.equal(advances, 0, "esperar pausado no puede avanzar");
  session.togglePause();
  assert.equal(session.isPaused(), false);
  assert.equal(Array.from(timers.values())[0]?.delay, 6_750);
  assert.deepEqual(paused, [true, false]);
});

test("timeout y una respuesta tardía avanzan exactamente una vez", () => {
  let advances = 0;
  let timerAction: (() => void) | null = null;
  const session = createHoleSummarySession({
    now: () => 0,
    schedule: action => { timerAction = action; return 1; },
    cancel: () => {},
    onAdvance: () => { advances += 1; },
  });
  // Una descarga cloud puede completar en este instante, pero ya no posee ni
  // cancela la sesión. El timeout gana la carrera y el callback tardío es inocuo.
  assert.equal(session.finish(), true);
  (timerAction as (() => void) | null)?.();
  assert.equal(session.finish(), false);
  assert.equal(advances, 1);
});

test("la X termina una sesión pausada, cancela el timer y avanza una sola vez", () => {
  let advances = 0;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const session = createHoleSummarySession({
    now: () => 1_000,
    schedule: action => {
      const id = ++nextTimer;
      timers.set(id, action);
      return id;
    },
    cancel: id => { timers.delete(id); },
    onAdvance: () => { advances += 1; },
  });

  session.togglePause();
  assert.equal(session.isPaused(), true);
  assert.equal(timers.size, 0);
  assert.equal(session.finish(), true);
  assert.equal(session.finish(), false);
  assert.equal(advances, 1);
});
