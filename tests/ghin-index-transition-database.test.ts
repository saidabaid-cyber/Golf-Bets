import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",round="33333333-3333-4333-8333-333333333333";
const migration="supabase/migrations/20261007012847_ghin_index_epoch_retained_history.sql";
async function fixture(count=7) {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
    create function private.account_subject_active(uuid) returns boolean language sql stable as $$select true$$;
    create table public.rounds_cloud(id uuid primary key,owner_id uuid,snapshot jsonb);
    insert into public.rounds_cloud values('${round}','${owner}','{"scores":{"1":{"owner":5}},"hcpSnapshot":36,"lifecycleState":"completed"}'),
      ('44444444-4444-4444-8444-444444444444','${owner}','{"scores":{"1":{"owner":5,"guest":6}},"hcpSnapshot":5,"lifecycleState":"live"}');
    create table public.player_handicap_provider_profiles(owner_id uuid primary key,provider text,association_status text,external_player_id text,handicap_index numeric);
    create table public.player_handicap_provider_link_audit(owner_id uuid,provider text,external_player_id text,event text);
    create table public.ghin_score_post_receipts(owner_id uuid references auth.users,round_id uuid references public.rounds_cloud on delete restrict,provider_score_id text,fingerprint text);
    insert into public.ghin_score_post_receipts values('${owner}','${round}','provider-1','permanent-fingerprint');
    grant usage on schema auth,private,public to anon,authenticated,service_role;
    grant select,insert,update,delete on public.player_handicap_provider_profiles to service_role;
    grant select,insert on public.player_handicap_provider_link_audit to service_role;
    grant select on public.rounds_cloud,public.ghin_score_post_receipts to service_role;`);
  await db.exec(readFileSync("supabase/migrations/20261006184558_ghin_owned_score_import.sql","utf8"));
  await db.exec(readFileSync(migration,"utf8"));
  await db.exec("set role service_role");
  await db.query("insert into public.player_handicap_provider_profiles values($1,'GHIN','VERIFIED','11103351',30.8)",[owner]);
  const rows=Array.from({length:count},(_,i)=>({external_score_id:`provider-${i+1}`,played_on:`2026-09-${String(i+1).padStart(2,"0")}`,provider_course_name:"Fixture course",provider_tee_name:"Fixture tee",number_of_holes:18,adjusted_gross_score:100+i,linked_round_id:i===0?round:null,linked_score_hash:i===0?"frozen-evidence":null,posting_fingerprint:i===0?"a".repeat(64):null,match_status:i===0?"EXACT_MATCH":"GHIN_ONLY",candidate_round_ids:[]}));
  await db.query("select public.import_ghin_scores_v1($1,'11103351',$2::jsonb)",[owner,JSON.stringify(rows)]);
  return {db,rows};
}
async function state(db:PGlite) {return (await db.query<any>("select * from public.player_handicap_source_state where owner_id=$1",[owner])).rows[0];}
async function unlink(db:PGlite) {return (await db.query<{result:boolean}>("select public.unlink_ghin_profile_v1($1) as result",[owner])).rows[0].result;}

test("actual verified transition establishes one epoch; refresh/reauthorization and bootstrap remain idempotent",async()=>{
  const {db}=await fixture();try{
    const before=await state(db);
    await db.query("update public.player_handicap_provider_profiles set handicap_index=31 where owner_id=$1",[owner]);
    await db.query("select public.initialize_verified_handicap_source_v1($1)",[owner]);
    assert.deepEqual(await state(db),before);
  }finally{await db.close();}
});
test("unconfirmed lookup cannot reset; confirmation resets atomically and a failed link does not leave a boundary",async()=>{
  const {db}=await fixture();try{
    await db.query("insert into public.player_handicap_provider_profiles values($1,'GHIN','LOOKUP_FOUND','11103352',null)",[other]);
    assert.equal((await db.query("select * from public.player_handicap_source_state where owner_id=$1",[other])).rows.length,0);
    await assert.rejects(db.query("select public.initialize_verified_handicap_source_v1($1)",[other]),/GHIN_NOT_VERIFIED/);
    await db.exec("begin");
    await db.query("update public.player_handicap_provider_profiles set association_status='VERIFIED' where owner_id=$1",[other]);
    await db.exec("rollback");
    assert.equal((await db.query("select * from public.player_handicap_source_state where owner_id=$1",[other])).rows.length,0);
    await db.query("update public.player_handicap_provider_profiles set association_status='VERIFIED' where owner_id=$1",[other]);
    assert.equal((await db.query("select * from public.player_handicap_source_state where owner_id=$1",[other])).rows.length,1);
  }finally{await db.close();}
});
for(const count of [0,7,25])test(`unlink retains ${Math.min(count,20)} of ${count} scores without deleting older history, receipts, round or frozen HCP`,async()=>{
  const {db}=await fixture(count);try{
    const history=await db.query("select * from public.rounds_cloud");
    const receipts=await db.query("select * from public.ghin_score_post_receipts");
    const provider=await db.query("select * from public.handicap_provider_scores order by external_score_id");
    const before=await state(db);assert.equal(await unlink(db),true);
    const after=await state(db);assert.equal(after.source_revision,before.source_revision+1);
    assert.equal(+after.backyard_index_reset_at,+before.backyard_index_reset_at);
    assert.equal(after.retained_ghin_score_ids.length,Math.min(count,20));
    assert.deepEqual(after.retained_ghin_score_ids,Array.from({length:Math.min(count,20)},(_,i)=>`provider-${count-i}`));
    assert.deepEqual(await db.query("select * from public.handicap_provider_scores order by external_score_id"),provider);
    assert.deepEqual(await db.query("select * from public.rounds_cloud"),history);
    assert.deepEqual(await db.query("select * from public.ghin_score_post_receipts"),receipts);
    assert.equal((await db.query("select * from public.player_handicap_provider_profiles where owner_id=$1",[owner])).rows.length,0);
    assert.equal(await unlink(db),false);assert.deepEqual(await state(db),after);
  }finally{await db.close();}
});
test("relink same provider retains IDs and round-trip evidence; reimport adds zero; new link advances epoch once",async()=>{
  const {db,rows}=await fixture();try{
    await unlink(db);const unlinked=await state(db);
    await db.query("insert into public.player_handicap_provider_profiles values($1,'GHIN','VERIFIED','11103351',30.8)",[owner]);
    const linked=await state(db);assert.equal(linked.source_revision,unlinked.source_revision+1);
    assert.ok(+linked.backyard_index_reset_at>=+unlinked.backyard_index_reset_at);
    const result=await db.query<any>("select public.import_ghin_scores_v1($1,'11103351',$2::jsonb) as result",[owner,JSON.stringify(rows)]);
    assert.equal(result.rows[0].result.importedNew,0);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,7);
    const evidence=(await db.query<any>("select linked_round_id,posting_fingerprint from public.handicap_provider_scores where external_score_id='provider-1'")).rows[0];
    assert.equal(evidence.linked_round_id,round);assert.equal(evidence.posting_fingerprint,"a".repeat(64));
    assert.equal((await db.query<any>("select provider_score_id from public.ghin_score_post_receipts")).rows[0].provider_score_id,"provider-1");
    await db.query("update public.player_handicap_provider_profiles set handicap_index=30.8 where owner_id=$1",[owner]);
    assert.deepEqual(await state(db),linked);
  }finally{await db.close();}
});
test("clean owner session after unlink reads retained history; RLS isolates other owners and denies mutations/RPC/anonymous",async()=>{
  const {db}=await fixture();try{
    await unlink(db);await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,is_anonymous:false})]);
    assert.equal((await db.query("select * from public.player_handicap_source_state")).rows.length,1);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,7);
    for(const sql of ["update public.player_handicap_source_state set source_revision=99","delete from public.handicap_provider_scores","select public.unlink_ghin_profile_v1('"+owner+"')","select public.initialize_verified_handicap_source_v1('"+owner+"')"])await assert.rejects(db.exec(sql),/permission denied/);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,is_anonymous:false})]);
    assert.equal((await db.query("select * from public.player_handicap_source_state")).rows.length,0);
    assert.equal((await db.query("select * from public.handicap_provider_scores")).rows.length,0);
    await db.exec("set role anon");await assert.rejects(db.query("select * from public.player_handicap_source_state"),/permission denied/);
  }finally{await db.close();}
});
