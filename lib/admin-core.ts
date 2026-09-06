export type AdminMetricInput = {
  users: Array<{ id: string; createdAt: string; lastSeenAt?: string | null }>;
  rounds: Array<{ id: string; ownerId: string; createdAt: string; completed: boolean }>;
  events: Array<{ eventName: string; createdAt: string; sessionId: string }>;
  errors: Array<{ errorType: string; createdAt: string }>;
  now?: Date;
};

export function adminAccessDecision(role: unknown) { return role === "admin"; }

function since(value: string | null | undefined, cutoff: number) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed >= cutoff;
}

export function calculateAdminMetrics(input: AdminMetricInput) {
  const now = (input.now || new Date()).getTime();
  const days = (count: number) => now - count * 86_400_000;
  const completed = input.rounds.filter(round => round.completed);
  const uniqueActive = (count: number) => new Set(input.users.filter(user => since(user.lastSeenAt, days(count))).map(user => user.id)).size;
  const retention = (ageDays: number) => {
    const eligible = input.users.filter(user => Date.parse(user.createdAt) <= days(ageDays));
    const retained = eligible.filter(user => {
      const created = Date.parse(user.createdAt); const seen = Date.parse(String(user.lastSeenAt || ""));
      return Number.isFinite(created) && Number.isFinite(seen) && seen >= created + ageDays * 86_400_000;
    });
    return eligible.length ? retained.length / eligible.length : 0;
  };
  return {
    users: { total: input.users.length, new7d: input.users.filter(user => since(user.createdAt, days(7))).length, dau: uniqueActive(1), wau: uniqueActive(7), mau: uniqueActive(30), retention7d: retention(7), retention30d: retention(30) },
    rounds: { total: input.rounds.length, completed: completed.length, incomplete: input.rounds.length - completed.length, averagePerUser: input.users.length ? input.rounds.length / input.users.length : 0 },
    ai: { questions30d: input.events.filter(event => event.eventName === "rules_ai_question" && since(event.createdAt, days(30))).length, errors30d: input.events.filter(event => event.eventName === "rules_ai_error" && since(event.createdAt, days(30))).length },
    errors: { total24h: input.errors.filter(error => since(error.createdAt, days(1))).length, total7d: input.errors.filter(error => since(error.createdAt, days(7))).length },
  };
}

export function rowsToCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = (value: unknown) => {
    const raw = String(value ?? "");
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [headers.map(quote).join(","), ...rows.map(row => headers.map(header => quote(row[header])).join(","))].join("\r\n");
}
