import type { ProductEventName } from "../analytics/domain";

export type AdminAggregateInput = {
  users: number;
  activeUsers: number;
  rounds: number;
  groups: number;
  plans: Record<string, number>;
  events: Array<{ name: ProductEventName; count: number }>;
  errors: Array<{ code: string; count: number }>;
};

export type AdminAggregateMetrics = AdminAggregateInput & { generatedAt: string };

export function requireAdminAccess(isAdmin: boolean) {
  if (!isAdmin) throw new Error("ADMIN_REQUIRED");
}

/** Aggregates contain counts only. They deliberately have no round, score,
 * balance, prompt, email, name or location payloads. */
export function buildAdminAggregateMetrics(input: AdminAggregateInput, generatedAt: string): AdminAggregateMetrics {
  const count = (value: number) => Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
  return {
    users: count(input.users),
    activeUsers: count(input.activeUsers),
    rounds: count(input.rounds),
    groups: count(input.groups),
    plans: Object.fromEntries(Object.entries(input.plans).map(([key, value]) => [key, count(value)])),
    events: input.events.map((event) => ({ name: event.name, count: count(event.count) })),
    errors: input.errors.map((error) => ({ code: error.code.slice(0, 80), count: count(error.count) })),
    generatedAt,
  };
}
