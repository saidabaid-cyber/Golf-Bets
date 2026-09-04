export const HOLE_SUMMARY_DURATION_MS = 10_000;

export type CountdownState = { remaining: number; startedAt: number; paused: boolean };

export function startCountdown(duration: number, now: number): CountdownState {
  return { remaining: Math.max(0, duration), startedAt: now, paused: false };
}

export function pauseCountdown(state: CountdownState, now: number): CountdownState {
  if (state.paused) return state;
  return { remaining: Math.max(0, state.remaining - Math.max(0, now - state.startedAt)), startedAt: now, paused: true };
}

export function resumeCountdown(state: CountdownState, now: number): CountdownState {
  if (!state.paused) return state;
  return { ...state, startedAt: now, paused: false };
}

export function createSingleAdvance(action: () => void) {
  let completed = false;
  return () => {
    if (completed) return false;
    completed = true;
    action();
    return true;
  };
}

export type HoleSummarySession = {
  finish: () => boolean;
  togglePause: () => boolean;
  dispose: () => void;
  isPaused: () => boolean;
  remaining: () => number;
};

type HoleSummarySessionOptions<TTimer> = {
  duration?: number;
  now: () => number;
  schedule: (action: () => void, delay: number) => TTimer;
  cancel: (timer: TTimer) => void;
  onAdvance: () => void;
  onPauseChange?: (paused: boolean, remaining: number) => void;
};

/** Owns one summary clock independently from the persisted round draft. */
export function createHoleSummarySession<TTimer>(options: HoleSummarySessionOptions<TTimer>): HoleSummarySession {
  const duration = options.duration ?? HOLE_SUMMARY_DURATION_MS;
  let countdown: CountdownState | null = startCountdown(duration, options.now());
  let timer: TTimer | null = null;
  const advance = createSingleAdvance(options.onAdvance);
  const cancelTimer = () => {
    if (timer === null) return;
    options.cancel(timer);
    timer = null;
  };
  const finish = () => {
    if (!countdown) return false;
    cancelTimer();
    countdown = null;
    options.onPauseChange?.(false, 0);
    return advance();
  };
  const scheduleRemaining = () => {
    if (!countdown || countdown.paused) return;
    timer = options.schedule(finish, countdown.remaining);
  };
  scheduleRemaining();
  return {
    finish,
    togglePause() {
      if (!countdown) return false;
      const now = options.now();
      if (countdown.paused) {
        countdown = resumeCountdown(countdown, now);
        options.onPauseChange?.(false, countdown.remaining);
        if (countdown.remaining <= 0) finish();
        else scheduleRemaining();
      } else {
        cancelTimer();
        countdown = pauseCountdown(countdown, now);
        options.onPauseChange?.(true, countdown.remaining);
      }
      return true;
    },
    dispose() {
      cancelTimer();
      countdown = null;
    },
    isPaused: () => Boolean(countdown?.paused),
    remaining: () => countdown?.remaining ?? 0,
  };
}

export function nextHoleDestination(order: number[], currentIndex: number) {
  if (currentIndex < order.length - 1) return { kind: "hole" as const, index: currentIndex + 1 };
  return { kind: "results" as const };
}
