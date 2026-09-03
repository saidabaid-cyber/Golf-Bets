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

export function nextHoleDestination(order: number[], currentIndex: number) {
  if (currentIndex < order.length - 1) return { kind: "hole" as const, index: currentIndex + 1 };
  return { kind: "results" as const };
}
