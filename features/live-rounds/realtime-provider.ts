import type { LiveRoundOperation, LiveRoundState } from "./domain";

export type RealtimeUnsubscribe = () => void;

export interface LiveRoundRealtimeProvider {
  readonly id: string;
  readonly configured: boolean;
  fetch(roundId: string, actorId: string): Promise<LiveRoundState | null>;
  publish(operation: LiveRoundOperation): Promise<void>;
  subscribe(roundId: string, actorId: string, listener: (operation: LiveRoundOperation) => void): Promise<RealtimeUnsubscribe>;
}

/** Deterministic Preview/test provider. Production providers remain replaceable. */
export class InMemoryLiveRoundRealtimeProvider implements LiveRoundRealtimeProvider {
  readonly id = "memory-live-rounds";
  readonly configured = true;
  private states = new Map<string, LiveRoundState>();
  private listeners = new Map<string, Set<(operation: LiveRoundOperation) => void>>();

  seed(state: LiveRoundState) { this.states.set(state.id, structuredClone(state)); }
  async fetch(roundId: string, actorId: string) {
    const state = this.states.get(roundId);
    if (!state || (state.ownerId !== actorId && !state.participants.some((participant) => participant.userId === actorId))) return null;
    return structuredClone(state);
  }
  async publish(operation: LiveRoundOperation) {
    for (const listener of this.listeners.get(operation.roundId) ?? []) listener(structuredClone(operation));
  }
  async subscribe(roundId: string, actorId: string, listener: (operation: LiveRoundOperation) => void) {
    if (!await this.fetch(roundId, actorId)) throw new Error("live_round_forbidden");
    const listeners = this.listeners.get(roundId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(roundId, listeners);
    return () => listeners.delete(listener);
  }
}
