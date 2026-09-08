type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();
const MAX_COUNTERS = 5_000;

function pruneCounters(now: number) {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
  while (counters.size >= MAX_COUNTERS) {
    const oldest = counters.keys().next().value as string | undefined;
    if (!oldest) break;
    counters.delete(oldest);
  }
}

/** Best-effort process-local protection. A distributed limiter is Phase 2 work. */
export function consumeBackyardAiLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) return false;
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && counters.size >= MAX_COUNTERS) pruneCounters(now);
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetBackyardAiLimitsForTests() {
  counters.clear();
}

export function backyardAiLimiterSizeForTests() {
  return counters.size;
}
