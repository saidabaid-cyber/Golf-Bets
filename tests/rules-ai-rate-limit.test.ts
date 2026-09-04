import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RulesAiRateLimitError, consumePersistentRulesAiLimit } from "../lib/rules-ai-rate-limit";

test("Rules AI consume un límite persistente sin guardar IP ni contenido de la consulta", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const allowed = await consumePersistentRulesAiLimit({
    rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; },
  }, "a".repeat(64), 8, 60);

  assert.equal(allowed, true);
  assert.deepEqual(calls, [{
    name: "consume_rules_ai_rate_limit",
    args: { p_key_hash: "a".repeat(64), p_limit: 8, p_window_seconds: 60 },
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /bola|camino|pregunta/i);
});

test("Rules AI respeta rechazo y falla cerrado si Supabase no confirma el contador", async () => {
  assert.equal(await consumePersistentRulesAiLimit({ rpc: async () => ({ data: false, error: null }) }, "b".repeat(64)), false);
  await assert.rejects(
    consumePersistentRulesAiLimit({ rpc: async () => ({ data: null, error: { code: "42501" } }) }, "c".repeat(64)),
    (error: unknown) => error instanceof RulesAiRateLimitError,
  );
  await assert.rejects(
    consumePersistentRulesAiLimit({ rpc: async () => ({ data: "yes", error: null }) }, "d".repeat(64)),
    (error: unknown) => error instanceof RulesAiRateLimitError,
  );
});

test("migración de límite IA no concede acceso a clientes", () => {
  const sql = readFileSync("supabase/migrations/20260904104145_rules_ai_rate_limit.sql", "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.rules_ai_rate_limits from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.consume_rules_ai_rate_limit\(text, integer, integer\) to service_role/i);
  assert.doesNotMatch(sql, /grant .*rules_ai_rate_limits.*authenticated/i);
});
