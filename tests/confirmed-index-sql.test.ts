import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("participant index SQL grants append-only to server, denies clients and preserves canonical data", async () => {
  const db = new PGlite();
  const roundId="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222";
  const snapshot={id:"local",lifecycleState:"completed",players:[{id:"b",accountUserId:b}],scores:{1:{b:5}},playerBalances:{b:-100}};
  const record={accountUserId:b,playerId:"b",roundId:"local",eligible:false};
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table rounds_cloud(id uuid primary key,snapshot jsonb,version bigint);
      create table social_round_account_links_v3(round_id uuid,user_id uuid,player_key text,verified_by text);`);
    const file=readdirSync("supabase/migrations").find(name=>name.endsWith("_confirmed_participant_index_append.sql"))!;
    await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
    await db.query("insert into rounds_cloud values($1,$2,1)",[roundId,snapshot]);
    const call=()=>db.query<{append_confirmed_round_index:boolean}>("select append_confirmed_round_index($1,$2,1,$3)",[roundId,b,record]);
    await db.exec("set role authenticated");
    await assert.rejects(call,{code:"42501"});
    await db.exec("set role service_role");
    await assert.rejects(call,{code:"42501"});
    await db.exec("reset role");
    await db.query("insert into social_round_account_links_v3 values($1,$2,'b','SELF_CONFIRMED')",[roundId,b]);
    await db.exec("set role service_role");
    assert.equal((await call()).rows[0].append_confirmed_round_index,true);
    assert.equal((await call()).rows[0].append_confirmed_round_index,true);
    await assert.rejects(()=>db.query("update rounds_cloud set snapshot='{}'"),{code:"42501"});
    await db.exec("reset role");
    const after=(await db.query<{snapshot:unknown}>("select snapshot from rounds_cloud")).rows[0].snapshot;
    assert.deepEqual(after,{...snapshot,backyardIndexSnapshots:[record]});
  } finally {await db.close();}
});
