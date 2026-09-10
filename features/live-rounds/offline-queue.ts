import type { LiveRoundOperation } from "./domain";

export type QueuedRoundOperation = LiveRoundOperation & {
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode?: string;
};

export function enqueueRoundOperation(queue: readonly QueuedRoundOperation[], operation: LiveRoundOperation): QueuedRoundOperation[] {
  if (queue.some((candidate) => candidate.id === operation.id)) return [...queue];
  return [...queue, { ...operation, attempts: 0, nextAttemptAt: operation.createdAt }];
}

export function acknowledgeRoundOperation(queue: readonly QueuedRoundOperation[], operationId: string) {
  return queue.filter((operation) => operation.id !== operationId);
}

export function failRoundOperation(queue: readonly QueuedRoundOperation[], operationId: string, now: string, errorCode: string) {
  const nowMs = Date.parse(now);
  return queue.map((operation) => {
    if (operation.id !== operationId) return operation;
    const attempts = operation.attempts + 1;
    const delay = Math.min(60_000, 1_000 * (2 ** Math.min(attempts - 1, 6)));
    return { ...operation, attempts, lastErrorCode: errorCode.slice(0, 64), nextAttemptAt: new Date(nowMs + delay).toISOString() };
  });
}

export function readyRoundOperations(queue: readonly QueuedRoundOperation[], now: string) {
  return queue.filter((operation) => operation.nextAttemptAt <= now).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
