export const HOLE_SUMMARY_DURATION_MS = 10_000;

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
