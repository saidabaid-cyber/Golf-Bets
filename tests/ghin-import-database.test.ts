import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const round="33333333-3333-4333-8333-333333333333",foreignRound="44444444-4444-4444-8444-444444444444";
async function fixture() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
    create function private.account_subject_active(uuid) returns boolean language sql stable as $$ select true $$;
    create table public.rounds_cloud(id uuid primary key,owner_id uuid,snapshot jsonb);
    insert into public.rounds_cloud values ('${round}','${owner}','{"lifecycleState":"completed","scores":{"1":{"owner":5}}}'),('${foreignRound}','${other}','{"lifecycleState":"completed"}');
    create table public.player_handicap_provider_profiles(owner_id uuid,provider text,association_status text,external_player_id text);
    insert into public.player_handicap_provider_profiles values ('${owner}','GHIN','VERIFIED','11103351');
    grant usage on schema auth,private,public to anon,authenticated,service_role;
    grant select on public.rounds_cloud,public.player_handicap_provider_profiles to service_role;`);
  await db.exec(readFileSync("supabase/migrations/20261006184558_ghin_owned_score_import.sql","utf8"));
  return db;
}
const record=(patch:Record<string,unknown>={})=>({external_score_id:"provider-1",played_on:"2026-10-05",provider_course_id:"123",provider_course_name:"QA Club",provider_tee_set_id:"456",provider_tee_name:"Blancas",number_of_holes:18,gross_score:82,adjusted_gross_score:81,score_differential:8,course_rating:72,slope_rating:113,score_type:"H",posting_method:"M",linked_round_id:round,linked_score_hash:"original-evidence",posting_fingerprint:null,match_status:"HIGH_CONFIDENCE_MATCH",candidate_round_ids:[],...patch});
const importRows=(db:PGlite,rows:unknown[],golfer="11103351")=>db.query<{result:any}>("select public.import_ghin_scores_v1($1::uuid,$2,$3::jsonb) as result",[owner,golfer,JSON.stringify(rows)]);

test("actual migration/RPC: first import, repeat, one provider identity and rich Backyard state unchanged",async()=>{
  const db=await fixture();try{
    const before=await db.query("select snapshot from public.rounds_cloud where id=$1",[round]);
    await db.exec("set role service_role");
    assert.equal((await importRows(db,[record()])).rows[0].result.importedNew,1);
    assert.equal((await importRows(db,[record()])).rows[0].result.importedNew,0);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.handicap_provider_scores")).rows[0].count,1);
    assert.deepEqual(await db.query("select snapshot from public.rounds_cloud where id=$1",[round]),before);
    await importRows(db,[record({linked_score_hash:"changed-evidence"})]);
    assert.equal((await db.query<{hash:string}>("select linked_score_hash as hash from public.handicap_provider_scores")).rows[0].hash,"original-evidence");
  }finally{await db.close();}
});
test("actual RLS: only owner reads, no anonymous access, no authenticated mutation/RPC and no service DELETE",async()=>{
  const db=await fixture();try{
    await importRows(db,[record()]);await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,is_anonymous:false})]);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,1);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,is_anonymous:false})]);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,0);
    await assert.rejects(importRows(db,[]),(e:any)=>e.code==="42501");
    await assert.rejects(db.exec("update public.handicap_provider_scores set gross_score=80"),(e:any)=>e.code==="42501");
    await db.exec("reset role; set role anon");await assert.rejects(db.query("select * from public.handicap_provider_scores"),(e:any)=>e.code==="42501");
    await db.exec("reset role; set role service_role");await assert.rejects(db.exec("delete from public.handicap_provider_scores"),(e:any)=>e.code==="42501");
  }finally{await db.close();}
});
test("actual RPC refuses wrong linked identity, foreign round and foreign review candidate without partial writes",async()=>{
  const db=await fixture();try{
    await assert.rejects(importRows(db,[record()],"11103349"),/IDENTITY_MISMATCH/);
    await assert.rejects(importRows(db,[record({linked_round_id:foreignRound})]),/ROUND_OWNER_MISMATCH/);
    await assert.rejects(importRows(db,[record({linked_round_id:null,match_status:"MATCH_REVIEW_REQUIRED",candidate_round_ids:[foreignRound]})]),/CANDIDATE_OWNER_MISMATCH/);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,0);
  }finally{await db.close();}
});
