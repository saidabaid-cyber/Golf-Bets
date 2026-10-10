import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("canonical CAS keeps table permissions, immutable context, revisions and prior card evidence", async () => {
  const db = new PGlite();
  const id = "00000000-0000-4000-8000-000000000001", a = "00000000-0000-4000-8000-000000000002", b = "00000000-0000-4000-8000-000000000003";
  const card = { id: "qa-card", lifecycleState: "live", scorekeeping: { version: 1, mode: "self" }, courseName: "QA course", players: [{ id: "a", accountUserId: a }, { id: "b", accountUserId: b }], scores: {} };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
      create table public.rounds_cloud(id uuid primary key, owner_id uuid, version bigint default 1, snapshot jsonb, updated_at timestamptz);
      create table public.prior_cards(snapshot jsonb);
      create function public.bump_test() returns trigger language plpgsql as $$begin insert into public.prior_cards values(old.snapshot); new.version:=old.version+1; return new; end$$;
      create trigger version_and_audit before update on public.rounds_cloud for each row execute function public.bump_test();
      grant usage on schema public to service_role,authenticated,anon;`);
    await db.exec(readFileSync("supabase/migrations/20261010050000_shared_round_live_cas.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261010070000_shared_round_bet_capture.sql", "utf8"));
    await db.query("insert into public.rounds_cloud(id,owner_id,snapshot) values($1,$2,$3)", [id, a, JSON.stringify(card)]);
    await db.exec("set request.jwt.claim.role='service_role'; set role service_role;");
    const call = (revision: number, actor: string, next: object) => db.query<{ version: number; snapshot: typeof card }>("select * from public.shared_round_live_cas_v1($1,$2,$3,$4)", [id, revision, actor, JSON.stringify(next)]);
    const next = { ...card, scores: { 1: { b: 5 } }, unitEvents: [{ id: "synthetic", hole: 1, playerId: "b", amount: 2 }], ballFriendSetup: { 1: { teamA: ["a", "b"] } } };
    const saved = await call(1, b, next); assert.equal(Number(saved.rows[0].version), 2);
    assert.deepEqual(saved.rows[0].snapshot.scores, { 1: { b: 5 } });
    assert.equal((await call(1, a, { ...next, scores: { 1: { a: 4 } } })).rows.length, 0);
    await assert.rejects(call(2, a, { ...next, courseName: "Wrong course" }), /Immutable round context/);
    await assert.rejects(call(2, a, { ...next, personalBets: [{ id: "unauthorized-rule", baseValue: 1000 }] }), /Immutable personal rules/);
    await assert.rejects(call(2, "00000000-0000-4000-8000-000000000004", next), /Invalid live membership/);
    await assert.rejects(call(2, b, { ...next, lifecycleState: "cancelled" }), /Immutable round context/);
    await assert.rejects(call(2, a, { ...next, lifecycleState: null }), /Immutable round context/);
    const cancelled = await call(2, a, { ...next, lifecycleState: "cancelled" }); assert.equal(Number(cancelled.rows[0].version), 3);
    await assert.rejects(call(3, a, next), /Invalid live membership/);
    const privilege = await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','public.rounds_cloud','UPDATE') as allowed"); assert.equal(privilege.rows[0].allowed, false);
    await db.exec("reset role; set request.jwt.claim.role='authenticated'; set role authenticated;");
    await assert.rejects(call(3, a, next), /permission denied/);
    await db.exec("reset role;");
    const evidence = await db.query<{ snapshot: typeof card }>("select snapshot from public.prior_cards");
    assert.equal(evidence.rows.length, 2); assert.deepEqual(evidence.rows[0].snapshot, card); assert.deepEqual(evidence.rows[1].snapshot.scores, next.scores);
  } finally { await db.close(); }
});
