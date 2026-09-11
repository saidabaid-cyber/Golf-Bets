import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildAdminAggregateMetrics, requireAdminAccess } from "../features/admin/domain";
import { liveQuestionFacts, parseLiveQuestionFacts, validateLiveQuestionExplanation } from "../features/ai/live-questions";
import { parseGolfInsightInput, structuredGolfInsightInput, validateGolfInsightExplanation } from "../features/ai/insights";
import { PRODUCT_EVENT_NAMES, sanitizeProductEventMetadata, usageCount } from "../features/analytics/domain";
import { cancelShot, closeShot, startShot, summarizeClubDistances, updateShotClub } from "../features/shots/domain";
import { buildFilteredGolfInsights, buildGolfTrends, filterStatsRounds } from "../features/stats/domain";
import type { Course, HoleScore, Player, RoundShotSnapshot, RoundSnapshot } from "../lib/types";

const root = process.cwd();
const players: Player[] = [{ id: "owner", name: "Owner", handicap: 0 }];
const course: Course = { id: "course", name: "La Vista", teeName: "Blancas", holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })) };
function savedRound(id: string, day: number, gross = 72): RoundSnapshot {
  const scores: Record<number, HoleScore> = Object.fromEntries(course.holes.map((hole, index) => [hole.number, { owner: index === 0 ? gross - 68 : 4 }]));
  return { id, date: `2026-09-${String(day).padStart(2, "0")}`, courseName: course.name, teeName: course.teeName, ownerName: "Owner", ownerId: "owner", roundHoles: 18, startHole: 1, betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 0, categoryResults: {}, players, courseSnapshot: course, order: course.holes.map((hole) => hole.number), scores, completedAt: `2026-09-${String(day).padStart(2, "0")}T18:00:00Z`, updatedAt: `2026-09-${String(day).padStart(2, "0")}T18:00:00Z` };
}

test("shots preserve immutable club snapshots and never fabricate distance from inaccurate GPS", () => {
  const started = startShot({ id: "s1", roundId: "r1", playerId: "owner", hole: 1, clubId: "old-driver", clubLabel: "Driver G440", model: "G440 MAX", location: { latitude: 19, longitude: -98, accuracyMeters: 6 }, startedAt: "2026-09-10T12:00:00Z", existing: [] });
  const edited = updateShotClub(started, { clubId: "new-driver", label: "Driver nuevo", model: "Nuevo" });
  assert.equal(started.clubSnapshot.model, "G440 MAX");
  assert.equal(edited.clubSnapshot.model, "Nuevo");
  const inaccurate = closeShot(started, { latitude: 19.001, longitude: -98, accuracyMeters: 100 }, "2026-09-10T12:01:00Z");
  assert.equal(inaccurate.distanceYards, undefined);
  assert.equal(inaccurate.endedAt, "2026-09-10T12:01:00Z");
  assert.deepEqual(cancelShot([started], "s1"), []);
});

test("club distances require a minimum sample and label early versus reliable evidence", () => {
  const shot = (id: string, distanceYards: number): RoundShotSnapshot => ({ id, roundId: "r", playerId: "owner", hole: 1, sequence: Number(id.slice(1)), clubLabel: "7i", clubSnapshot: { label: "7i" }, distanceYards, startedAt: "2026-09-10T00:00:00Z", endedAt: "2026-09-10T00:01:00Z", source: "GPS" });
  assert.equal(summarizeClubDistances([shot("s1", 155), shot("s2", 160)])[0].averageYards, null);
  assert.equal(summarizeClubDistances([shot("s1", 155), shot("s2", 160), shot("s3", 159)])[0].confidence, "EARLY");
  assert.equal(summarizeClubDistances(Array.from({ length: 8 }, (_, index) => shot(`s${index + 1}`, 158)))[0].confidence, "RELIABLE");
});

test("stats filters paginate by window, course and tee without mutating history", () => {
  const rounds = Array.from({ length: 12 }, (_, index) => savedRound(`r${index}`, index + 1, 72 + index));
  const filtered = filterStatsRounds(rounds, { window: 5, courseName: "La Vista", teeName: "Blancas" });
  assert.equal(filtered.length, 5);
  assert.equal(filtered[0].id, "r11");
  assert.equal(rounds.length, 12);
  assert.equal(buildFilteredGolfInsights(rounds, { window: 10 }).scoredRounds, 10);
  assert.deepEqual(buildGolfTrends(rounds, 5).map((trend) => trend.metric), ["score"]);
});

test("AI insight input contains aggregates only and validates the exact response shape", () => {
  const insights = buildFilteredGolfInsights([savedRound("r1", 1)], { window: "ALL" });
  const input = structuredGolfInsightInput(insights, []);
  assert.equal(input.sampleRounds, 1);
  assert.equal("rounds" in input, false);
  assert.deepEqual(parseGolfInsightInput(input), input);
  assert.equal(parseGolfInsightInput({ ...input, playerName: "Said" }), null);
  assert.deepEqual(validateGolfInsightExplanation({ summary: "Muestra estable.", observations: ["Un dato."], caveat: "Una ronda no prueba causalidad." }), { summary: "Muestra estable.", observations: ["Un dato."], caveat: "Una ronda no prueba causalidad." });
  assert.equal(validateGolfInsightExplanation({ summary: "x", observations: [], caveat: "x", winner: "inventado" }), null);
});

test("live AI questions expose only facts already calculated by deterministic engines", () => {
  const facts = liveQuestionFacts({ kind: "HOW_AM_I", playerId: "owner", scoreboard: { status: "PROVISIONAL", golf: [{ playerId: "owner", name: "Owner", handicap: 0, finished: false, gross: 20, net: 18, relativeToPar: 2, thru: 5 }], balances: { owner: 100, rival: -100 }, engineVersion: "phase1", calculatedAt: "2026-09-10T00:00:00Z" }, putts: 9 });
  assert.equal(facts.balance, 100);
  assert.equal(facts.player?.thru, 5);
  assert.equal(facts.engineVersion, "phase1");
  assert.deepEqual(parseLiveQuestionFacts(facts), facts);
  assert.equal(parseLiveQuestionFacts({ ...facts, scores: { 1: { owner: 4 } } }), null);
  assert.deepEqual(validateLiveQuestionExplanation({ answer: "Vas dos sobre par después de cinco hoyos." }), { answer: "Vas dos sobre par después de cinco hoyos." });
  assert.equal(validateLiveQuestionExplanation({ answer: "Respuesta", winner: "inventado" }), null);
});

test("analytics has the required events and strips PII, prompts, images and coordinates", () => {
  assert.ok(PRODUCT_EVENT_NAMES.includes("shot_recorded"));
  assert.ok(PRODUCT_EVENT_NAMES.includes("ai_insight_viewed"));
  assert.deepEqual(sanitizeProductEventMetadata({ feature: "gps", quantity: 1, email: "private@example.com", prompt: "private", latitude: 19, arbitrary: "drop" }), { feature: "gps", quantity: 1 });
  const records = [{ userId: "u", capability: "AI", quantity: 2, occurredAt: "2026-09-10T01:00:00Z" }, { userId: "u", capability: "AI", quantity: 3, occurredAt: "2026-08-10T01:00:00Z" }];
  assert.equal(usageCount(records, { userId: "u", capability: "AI", window: "monthly", now: "2026-09-10T12:00:00Z" }), 2);
  assert.equal(usageCount(records, { userId: "u", capability: "AI", window: "lifetime", now: "2026-09-10T12:00:00Z" }), 5);
});

test("admin metrics require explicit authorization and remain aggregate-only", () => {
  assert.throws(() => requireAdminAccess(false), /ADMIN_REQUIRED/);
  const metrics = buildAdminAggregateMetrics({ users: 3, activeUsers: 2, rounds: 4, groups: 1, plans: { BETA_PRO: 3 }, events: [{ name: "round_completed", count: 4 }], errors: [{ code: "timeout", count: 1 }] }, "2026-09-10T00:00:00Z");
  assert.equal(metrics.rounds, 4);
  assert.equal("roundPayload" in metrics, false);
});

test("Phase 2D UI wires shot tracking, bag clubs, filtered stats and deterministic AI language", () => {
  const capture = readFileSync(`${root}/app/components/round-capture-v2.tsx`, "utf8");
  const stats = readFileSync(`${root}/app/components/stats-dashboard.tsx`, "utf8");
  assert.match(capture, /Registrar golpe/);
  assert.match(capture, /activeTeeClubs\.map/);
  assert.match(capture, /sin inventar distancia/);
  assert.match(stats, /Últimas 5/);
  assert.match(stats, /no recalcula scores, HCP, ganadores ni dinero/);
});

test("Phase 2D migration enforces RLS, idempotency and aggregate-only admin access", () => {
  const migration = readFileSync(`${root}/supabase/migrations/202609100004_phase2_shots_analytics.sql`, "utf8");
  for (const table of ["round_shots_v2", "product_usage_events_v2"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /unique \(owner_id, operation_id\)/);
  assert.match(migration, /private\.is_app_admin\(\)/);
  assert.doesNotMatch(migration, /drop table|truncate table|alter publication/i);
});

test("AI Insights endpoint is strict, stateless and never accepts raw history", () => {
  const route = readFileSync(`${root}/app/api/backyard-ai/insights/route.ts`, "utf8");
  assert.match(route, /hasOnlyKeys\(source, \["aggregates", "consent"\]\)/);
  assert.match(route, /store: false|generateBackyardAiJson/);
  assert.doesNotMatch(route, /rawRounds|playerName|email|scores:/);
});

test("live question endpoint and UI accept only deterministic facts", () => {
  const route = readFileSync(`${root}/app/api/backyard-ai/live-question/route.ts`, "utf8");
  const component = readFileSync(`${root}/app/components/live-round-question.tsx`, "utf8");
  assert.match(route, /hasOnlyKeys\(source, \["question", "facts", "consent"\]\)/);
  assert.match(route, /parseLiveQuestionFacts/);
  assert.match(route, /Never recalculate or invent scores, handicaps, winners, balances, money/);
  assert.match(component, /liveQuestionFacts/);
  assert.match(component, /No modifica la ronda/);
});

test("admin screen consumes aggregate metrics behind authenticated authorization", () => {
  const page = readFileSync(`${root}/app/admin/phase2/page.tsx`, "utf8");
  const route = readFileSync(`${root}/app/api/admin/metrics/route.ts`, "utf8");
  assert.match(page, /authorization: `Bearer \$\{token\}`/);
  assert.match(page, /no expone rondas ni contenido privado/i);
  assert.match(route, /authenticatedRequest/);
  assert.match(route, /ADMIN_REQUIRED/);
});

test("Phase 2 API routes resolve domain imports from their real App Router depth", () => {
  const socialSearch = readFileSync(`${root}/app/api/social/search/route.ts`, "utf8");
  assert.match(socialSearch, /from "\.\.\/\.\.\/\.\.\/\.\.\/features\/social\/domain"/);
  assert.doesNotMatch(socialSearch, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/social/);
});
