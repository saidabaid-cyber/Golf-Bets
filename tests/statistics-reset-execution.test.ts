import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { executeStatisticsReset, statisticsResetStatus, type StatisticsResetGateway } from "../lib/statistics-reset-execution";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const NEW_REQUEST = "33333333-3333-4333-8333-333333333333";
const body = (requestId = REQUEST) => ({ confirmation: "ELIMINAR", requestId });
const firstTime = "2026-09-15T11:00:00.000Z";
const secondTime = "2026-09-15T11:05:00.000Z";

function inMemoryGateway() {
  let canonical: string | null = null;
  const requests = new Map<string, string>();
  let nextTime = firstTime;
  let rpcCalls = 0;
  const gateway: StatisticsResetGateway = {
    canonical: async userId => {
      assert.equal(userId, OWNER);
      return { data: canonical ? { reset_at: canonical, strategy: "RESET_FROM_DATE" } : null, error: null };
    },
    request: async (userId, requestId) => {
      assert.equal(userId, OWNER);
      return { data: requests.has(requestId) ? { reset_at: requests.get(requestId)! } : null, error: null };
    },
    execute: async (confirmation, requestId) => {
      assert.equal(confirmation, "ELIMINAR");
      rpcCalls++;
      if (!requests.has(requestId)) {
        requests.set(requestId, nextTime);
        canonical = !canonical || Date.parse(nextTime) > Date.parse(canonical) ? nextTime : canonical;
      }
      return { data: canonical, error: null };
    },
  };
  return { gateway, setNextTime: (time: string) => { nextTime = time; }, rpcCalls: () => rpcCalls };
}

test("stats reset: un esquema ausente no ejecuta ningún RPC ni afirma reset", async () => {
  let executions = 0;
  const gateway: StatisticsResetGateway = {
    canonical: async () => ({ data: null, error: { code: "PGRST205", message: "table missing" } }),
    request: async () => ({ data: null, error: { code: "PGRST205", message: "table missing" } }),
    execute: async () => { executions++; return { data: null, error: null }; },
  };
  assert.equal((await statisticsResetStatus(gateway, OWNER)).body.code, "PENDING_CONTROLLED_DB_APPLY");
  const result = await executeStatisticsReset(body(), gateway, OWNER);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "PENDING_CONTROLLED_DB_APPLY");
  assert.equal(result.body.noDataDeleted, true);
  assert.doesNotMatch(String(result.body.error), /migracion|migración|transaccional|Preview|schema|PGRST/i);
  assert.equal(executions, 0);
});

test("stats reset: cuenta nueva sin estadísticas escribe y vuelve a leer su límite", async () => {
  const fixture = inMemoryGateway();
  assert.deepEqual((await statisticsResetStatus(fixture.gateway, OWNER)).body, { resetAt: null, strategy: "RESET_FROM_DATE" });
  const reset = await executeStatisticsReset(body(), fixture.gateway, OWNER);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.resetAt, firstTime);
  assert.deepEqual((await statisticsResetStatus(fixture.gateway, OWNER)).body, { resetAt: firstTime, strategy: "RESET_FROM_DATE" });
  assert.equal((await executeStatisticsReset(body(), fixture.gateway, OWNER)).status, 200);
  assert.equal(fixture.rpcCalls(), 1, "no stats count or aggregate row is required to complete a reset");
});

test("stats reset: errores de permisos no se confunden con migración ni revelan SQL", async () => {
  const fixture = inMemoryGateway();
  fixture.gateway.canonical = async () => ({ data: null, error: { code: "42501", message: "permission denied for user_statistics_resets" } });
  const result = await executeStatisticsReset(body(), fixture.gateway, OWNER);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "STATISTICS_STORE_UNAVAILABLE");
  assert.doesNotMatch(String(result.body.error), /permission|user_statistics|42501|autoritativo/);
  assert.equal(fixture.rpcCalls(), 0);
});

test("stats reset: mutation route is Preview isolated while status lookup remains read-only", () => {
  const source = readFileSync("app/api/account/statistics/route.ts", "utf8");
  const deletion = source.slice(source.indexOf("export async function DELETE"));
  assert.ok(deletion.indexOf("isolatedPreviewDatabaseEnabled()") < deletion.indexOf("executeStatisticsReset("));
  assert.match(deletion, /code: "PREVIEW_DATABASE_REQUIRED"/);
  const lookup = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function DELETE"));
  assert.doesNotMatch(lookup, /executeStatisticsReset/);
  assert.match(source, /console\.warn\("\[statistics-reset\]", \{ operation, code: result\.body\.code \}\)/);
  assert.doesNotMatch(source, /console\.(?:warn|error)\([^\n]*(?:userId|token|read\.value)/);
});

test("stats reset: servidor no acepta owner payload, confirmación floja ni requestId inválido", async () => {
  const fixture = inMemoryGateway();
  for (const value of [{ ...body(), userId: "someone-else" }, { ...body(), confirmation: "eliminar" }, { ...body(), requestId: "not-uuid" }]) {
    assert.equal((await executeStatisticsReset(value, fixture.gateway, OWNER)).status, 400);
  }
  assert.equal(fixture.rpcCalls(), 0);
});

test("stats reset: doble submit con el mismo requestId retorna mismo límite sin segundo RPC", async () => {
  const fixture = inMemoryGateway();
  const first = await executeStatisticsReset(body(), fixture.gateway, OWNER);
  assert.deepEqual(first.body, { resetAt: firstTime, strategy: "RESET_FROM_DATE", requestId: REQUEST });
  fixture.setNextTime(secondTime);
  const retry = await executeStatisticsReset(body(), fixture.gateway, OWNER);
  assert.deepEqual(retry.body, first.body);
  assert.equal(fixture.rpcCalls(), 1);
  assert.deepEqual((await statisticsResetStatus(fixture.gateway, OWNER)).body, { resetAt: firstTime, strategy: "RESET_FROM_DATE" });
  const separate = await executeStatisticsReset(body(NEW_REQUEST), fixture.gateway, OWNER);
  assert.deepEqual(separate.body, { resetAt: secondTime, strategy: "RESET_FROM_DATE", requestId: NEW_REQUEST });
  assert.equal(fixture.rpcCalls(), 2);
  const oldRetry = await executeStatisticsReset(body(), fixture.gateway, OWNER);
  assert.deepEqual(oldRetry.body, { resetAt: secondTime, strategy: "RESET_FROM_DATE", requestId: REQUEST }, "old retry returns latest canonical boundary");
});

test("stats reset: timeout tras commit se reconcilia por readback; antes de commit queda pendiente y reintento seguro", async () => {
  const committed = inMemoryGateway();
  const execution = committed.gateway.execute;
  committed.gateway.execute = async (confirmation, requestId) => {
    await execution(confirmation, requestId);
    throw new Error("response timeout after commit");
  };
  assert.equal((await executeStatisticsReset(body(), committed.gateway, OWNER)).status, 200);

  const uncommitted = inMemoryGateway();
  uncommitted.gateway.execute = async () => { throw new Error("timeout before commit"); };
  const pending = await executeStatisticsReset(body(), uncommitted.gateway, OWNER);
  assert.equal(pending.status, 503);
  assert.equal(pending.body.code, "RESET_CONFIRMATION_PENDING");
  assert.equal(pending.body.noDataDeleted, undefined, "ambiguous response must not claim no data changed");
  const real = inMemoryGateway();
  assert.equal((await executeStatisticsReset(body(), real.gateway, OWNER)).status, 200);
});

test("stats reset: una respuesta RPC sin fila de idempotencia jamás se convierte en 2xx", async () => {
  const gateway: StatisticsResetGateway = {
    canonical: async () => ({ data: { reset_at: firstTime, strategy: "RESET_FROM_DATE" }, error: null }),
    request: async () => ({ data: null, error: null }),
    execute: async () => ({ data: firstTime, error: null }),
  };
  assert.equal((await executeStatisticsReset(body(), gateway, OWNER)).body.code, "RESET_CONFIRMATION_PENDING");
});

test("stats migration: owner RLS, one request PK, narrow RPC and monotonic greatest are retained in additive SQL", () => {
  const sql = readFileSync("supabase/migrations/20260915114707_user_statistics_reset_idempotency.sql", "utf8");
  assert.match(sql, /primary key \(user_id, request_id\)/);
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /grant select on table public\.user_statistics_reset_requests to authenticated/);
  assert.doesNotMatch(sql, /grant select, insert on table public\.user_statistics_reset_requests to authenticated/);
  assert.match(sql, /revoke insert, update, delete on table public\.user_statistics_resets from public, anon, authenticated/);
  assert.match(sql, /greatest\(public\.user_statistics_resets\.reset_at, excluded\.reset_at\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /current_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql, /on conflict on constraint user_statistics_reset_requests_pkey do nothing/);
  assert.match(sql, /revoke execute on function public\.reset_my_statistics\(text\)/);
});
