import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminAccessDecision, calculateAdminMetrics, rowsToCsv } from "../lib/admin-core";
import { ANALYTICS_EVENT_NAMES, eventCategory, getTelemetrySession, sanitizeOperationalMessage, sanitizeTelemetryMetadata } from "../lib/telemetry";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("session analytics survives activity and rotates after 30 minutes", () => {
  const storage = new MemoryStorage(); let count = 0; const makeId = () => `session-${++count}`;
  assert.equal(getTelemetrySession(storage, 1_000, makeId), "session-1");
  assert.equal(getTelemetrySession(storage, 1_000 + 20 * 60_000, makeId), "session-1");
  assert.equal(getTelemetrySession(storage, 1_000 + 51 * 60_000, makeId), "session-2");
});

test("analytics catalog and categories cover the hardening events", () => {
  for (const required of ["app_opened", "login_completed", "round_started", "round_completed", "bet_enabled", "rules_ai_question", "sync_error"]) assert.ok(ANALYTICS_EVENT_NAMES.includes(required as never));
  assert.equal(eventCategory("round_started"), "round"); assert.equal(eventCategory("rules_ai_success"), "rules_ai");
});

test("telemetry strips private metadata and operational secrets", () => {
  assert.deepEqual(sanitizeTelemetryMetadata({ bet_type: "skins", amount: 100, email: "a@b.com", question: "secret", mode: "carry" }), { bet_type: "skins", mode: "carry" });
  const message = sanitizeOperationalMessage("Bearer secret-token a@b.com sk-abcdefghijklmnopqrstuvwxyz");
  assert.ok(!message.includes("secret-token")); assert.ok(!message.includes("a@b.com")); assert.ok(!message.includes("sk-abc"));
});

test("admin authorization denies users and allows admins", () => {
  assert.equal(adminAccessDecision("user"), false); assert.equal(adminAccessDecision(undefined), false); assert.equal(adminAccessDecision("admin"), true);
});

test("admin metrics compute activity, rounds, AI and errors", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const metrics = calculateAdminMetrics({ now, users: [{ id: "u1", createdAt: "2026-09-05T12:00:00Z", lastSeenAt: "2026-09-06T10:00:00Z" }, { id: "u2", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-08-20T00:00:00Z" }], rounds: [{ id: "r1", ownerId: "u1", createdAt: "2026-09-06T00:00:00Z", completed: true }, { id: "r2", ownerId: "u1", createdAt: "2026-09-06T00:00:00Z", completed: false }], events: [{ eventName: "rules_ai_question", createdAt: "2026-09-05T00:00:00Z", sessionId: "s1" }], errors: [{ errorType: "sync", createdAt: "2026-09-06T11:00:00Z" }] });
  assert.deepEqual(metrics.users, { total: 2, new7d: 1, dau: 1, wau: 1, mau: 2, retention7d: 1, retention30d: 1 });
  assert.equal(metrics.rounds.completed, 1); assert.equal(metrics.rounds.incomplete, 1); assert.equal(metrics.ai.questions30d, 1); assert.equal(metrics.errors.total24h, 1);
});

test("CSV export quotes formulas and commas as data", () => {
  const csv = rowsToCsv([{ name: "A, B", note: '=HYPERLINK("x")' }]);
  assert.match(csv, /"A, B"/); assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});

test("migration defines additive schema, RLS and immutable client role", () => {
  const sql = readFileSync("supabase/migrations/20260906210425_production_hardening_v1.sql", "utf8");
  for (const fragment of ["create table if not exists public.analytics_events", "create table if not exists public.app_errors", "enable row level security", "analytics_events_insert_self", "app_errors_read_admin", "revoke update on table public.profiles from authenticated", "on delete set null"]) assert.ok(sql.includes(fragment), fragment);
  assert.ok(!/service[_-]?role[^\n]*NEXT_PUBLIC/i.test(sql));
});

test("round, login and AI flows emit the required minimized events", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const account = readFileSync("app/components/account-provider.tsx", "utf8");
  const rules = readFileSync("app/components/rules-panel.tsx", "utf8");
  for (const event of ["round_started", "round_resumed", "round_completed", "round_deleted", "results_opened", "history_opened"]) assert.ok(page.includes(`trackEvent(\"${event}\"`), event);
  for (const event of ["bet_enabled", "bet_disabled"]) assert.ok(page.includes(`\"${event}\"`), event);
  for (const event of ["login_completed", "signup_completed", "logout", "profile_updated", "sync_success", "sync_error"]) assert.ok(account.includes(`trackEvent(\"${event}\"`), event);
  for (const event of ["rules_ai_question", "rules_ai_success", "rules_ai_error"]) assert.ok(rules.includes(`trackEvent(\"${event}\"`), event);
  assert.ok(!rules.includes("metadata: { question"));
});

test("health and admin exports are server-side and reveal no credentials", () => {
  const health = readFileSync("app/api/health/route.ts", "utf8");
  const auth = readFileSync("lib/server-runtime.ts", "utf8");
  const exportRoute = readFileSync("app/api/admin/export/[dataset]/route.ts", "utf8");
  assert.match(health, /database[\s\S]*auth[\s\S]*version[\s\S]*buildSha[\s\S]*environment/);
  assert.ok(auth.includes("requireAdmin")); assert.ok(exportRoute.includes("requireAdmin"));
  assert.ok(!health.includes("SUPABASE_SECRET_KEY")); assert.ok(!exportRoute.includes("service_role"));
});
