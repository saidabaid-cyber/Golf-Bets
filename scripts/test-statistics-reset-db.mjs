import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";
const ROLLED_BACK = "55555555-5555-4555-8555-555555555555";

// PGlite runs PostgreSQL itself in WASM. These fixtures replace ONLY the
// earlier migration's dependencies and Supabase's auth.uid() JWT context;
// no network connection or shared Preview/Production database is used.
const db = new PGlite();
const results = [];
const query = (sql) => db.query(sql);
const count = async (table) => Number((await query(`select count(*) as n from public.${table}`)).rows[0].n);
const call = async (id, confirmation = "ELIMINAR") =>
  (await query(`select public.reset_my_statistics('${confirmation}', '${id}'::uuid) as boundary`)).rows[0].boundary;
const role = async (userId) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
};
const admin = async () => { await db.exec("reset role; reset request.jwt.claim.sub;"); };
const expectDbError = async (action, code) => {
  try { await action(); assert.fail(`expected PostgreSQL ${code}`); }
  catch (error) { assert.equal(error.code, code, error.message); }
};

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.user_statistics_resets (
      user_id uuid primary key references auth.users(id),
      reset_at timestamptz not null, strategy text not null,
      updated_at timestamptz not null
    );
    alter table public.user_statistics_resets enable row level security;
    grant select, insert, update on public.user_statistics_resets to authenticated;
    create policy "owner reset read" on public.user_statistics_resets
      for select to authenticated using (user_id = (select auth.uid()));
    create policy "statistics reset owner insert" on public.user_statistics_resets
      for insert to authenticated with check (user_id = (select auth.uid()));
    create policy "statistics reset owner update" on public.user_statistics_resets
      for update to authenticated using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
    create table public.product_usage_events_v2 (
      id text primary key, owner_id uuid, event_name text,
      metadata jsonb, occurred_at timestamptz
    );
    create table public.profiles (id uuid primary key references auth.users(id), display_name text);
    create table public.frequent_groups_cloud (id text primary key, owner_id uuid references auth.users(id), payload jsonb);
    create table public.rounds_cloud (id text primary key, owner_id uuid references auth.users(id), payload jsonb);
    create function public.reset_my_statistics(text) returns timestamptz
      language sql as $$select now()$$;
    insert into auth.users(id) values ('${OWNER}'), ('${OTHER}');
  `);
  const sql = readFileSync("supabase/migrations/20260915114707_user_statistics_reset_idempotency.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql); // additive migration can be retried safely in QA
  results.push("migration + repeat apply");

  await role(OWNER);
  await expectDbError(() => call(FIRST, "eliminar"), "P0001");
  await expectDbError(() => query("select public.reset_my_statistics('ELIMINAR')"), "42501");
  await expectDbError(() => query(`insert into public.user_statistics_reset_requests(user_id,request_id,reset_at)
    values ('${OWNER}', '${FIRST}', now())`), "42501");
  await expectDbError(() => query(`insert into public.user_statistics_resets(user_id,reset_at,strategy,updated_at)
    values ('${OWNER}', now(), 'RESET_FROM_DATE', now())`), "42501");
  results.push("strong confirmation; legacy RPC/direct marker inserts revoked");

  const first = await call(FIRST);
  assert.ok(Number.isFinite(first.valueOf()), "zero-stat account can persist its first reset without history or aggregate rows");
  const duplicate = await call(FIRST);
  assert.equal(first.valueOf(), duplicate.valueOf());
  await admin();
  assert.equal(await count("user_statistics_reset_requests"), 1);
  assert.equal(await count("product_usage_events_v2"), 1);
  await role(OWNER);
  await expectDbError(() => query(`update public.user_statistics_resets set reset_at = now()
    where user_id = '${OWNER}'`), "42501");
  await admin();
  results.push("same-key retry makes one request and one audit");

  await role(OWNER);
  const newer = await call(SECOND);
  assert.ok(newer.valueOf() >= first.valueOf());
  assert.equal((await call(FIRST)).valueOf(), newer.valueOf(), "old retry returns canonical latest boundary");
  await admin();
  assert.equal(await count("user_statistics_reset_requests"), 2);
  assert.equal(await count("product_usage_events_v2"), 2);
  results.push("distinct keys monotonically advance; retry does not audit again");

  await role(OTHER);
  assert.equal((await count("user_statistics_reset_requests")), 0, "RLS hides another user's requests");
  assert.equal((await count("user_statistics_resets")), 0, "base owner RLS hides canonical boundary");
  await admin();
  results.push("owner RLS under simulated authenticated JWT context");

  await role(OWNER);
  await db.exec("begin");
  await call(ROLLED_BACK);
  await db.exec("rollback");
  await admin();
  assert.equal(await count("user_statistics_reset_requests"), 2);
  assert.equal(await count("product_usage_events_v2"), 2);
  results.push("transaction rollback preserves idempotency/audit consistency");

  // A second QA user has captured rounds and private account/group data.
  // RESET_FROM_DATE changes only the authoritative ledger; history stays byte
  // equivalent and new completed rounds can feed fresh derived statistics.
  await db.exec(`
    insert into public.profiles values ('${OTHER}', 'Stats QA');
    insert into public.frequent_groups_cloud values ('qa-group', '${OTHER}', '{"name":"QA group","members":["player-qa"]}');
    insert into public.rounds_cloud values ('qa-history', '${OTHER}', '{"id":"qa-history","completedAt":"2026-01-01T12:00:00.000Z","scores":{"1":{"player-qa":4}},"putts":{"1":{"player-qa":2}},"netResult":100}');
  `);
  const historyBefore = (await query("select payload from public.rounds_cloud where id = 'qa-history'")).rows[0].payload;
  await role(OTHER);
  const populatedReset = await call(FIRST);
  const ownLedger = (await query("select reset_at from public.user_statistics_resets")).rows;
  assert.equal(ownLedger.length, 1);
  assert.equal(ownLedger[0].reset_at.valueOf(), populatedReset.valueOf());
  await admin();
  assert.equal(Number((await query("select count(*) as n from auth.users")).rows[0].n), 2, "accounts remain");
  assert.equal(await count("profiles"), 1);
  assert.equal(await count("frequent_groups_cloud"), 1);
  assert.deepEqual((await query("select payload from public.rounds_cloud where id = 'qa-history'")).rows[0].payload, historyBefore);
  assert.ok(Date.parse(historyBefore.completedAt) < populatedReset.valueOf());
  await db.exec(`insert into public.rounds_cloud values ('qa-new', '${OTHER}', jsonb_build_object(
    'id','qa-new','completedAt',to_char('${populatedReset.toISOString()}'::timestamptz + interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scores',jsonb_build_object('1',jsonb_build_object('player-qa',5))
  ));`);
  await role(OTHER); // new request context simulates a subsequent authenticated read
  const reloadedReset = (await query("select reset_at from public.user_statistics_resets")).rows[0].reset_at;
  assert.equal(reloadedReset.valueOf(), populatedReset.valueOf());
  await admin();
  const sportEligible = (await query(`select id from public.rounds_cloud
    where owner_id = '${OTHER}' and (payload->>'completedAt')::timestamptz > '${reloadedReset.toISOString()}'::timestamptz`)).rows;
  assert.deepEqual(sportEligible.map(item => item.id), ["qa-new"]);
  assert.equal(await count("rounds_cloud"), 2, "old history and new round both remain stored");
  results.push("empty account reset; populated account reset; authoritative reload; account/group/history preservation; new-round cutoff");

  // A single PGlite connection serializes statements; true multi-connection
  // race/load testing remains required against an isolated Preview Postgres.
  console.log(`isolated PostgreSQL SQL QA passed (${results.length}): ${results.join("; ")}`);
} finally {
  await db.close();
}
