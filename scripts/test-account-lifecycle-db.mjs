import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// PostgreSQL/WASM only; no remote credentials, network or real users.
const db = new PGlite({ extensions: { pg_trgm } });
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const OP="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LEASE="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", HASH="c".repeat(64);
const q=(sql,values)=>db.query(sql,values);
const scalar=async(sql,values)=>Object.values((await q(sql,values)).rows[0])[0];
const expectError=async(action,codes)=>{let error;try{await action();}catch(e){error=e;}assert.ok(error,"expected SQL failure");assert.ok(codes.includes(error.code),`${error.code}: ${error.message}`);};
const admin=()=>db.exec("reset role; reset request.jwt.claim.sub;");
const asUser=id=>db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
const acquire=(actor,operation=OP,policy="delete_golf_data",lease=LEASE)=>scalar("select public.account_lifecycle_acquire($1,$2,$3,$4,$5)",[actor,operation,policy,HASH,lease]);
const prepare=(operation=OP,lease=LEASE)=>scalar("select public.account_lifecycle_prepare($1,$2)",[operation,lease]);
const complete=(operation=OP,lease=LEASE)=>scalar("select public.account_lifecycle_complete($1,$2)",[operation,lease]);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create publication supabase_realtime;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid references auth.users(id),owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    -- PGlite lacks pgcrypto. Crypto is not the subject of these graph tests;
    -- these fixtures merely compile pre-existing tournament PIN functions.
    create function extensions.crypt(text,text) returns text language sql immutable as $$ select md5($1||$2) $$;
    create function extensions.gen_salt(text) returns text language sql immutable as $$ select $1 $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1),'hex') $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select substring(decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') from 1 for $1) $$;
    grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
  `);
  const files=readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort();
  for(const file of files) {
    const sql=readFileSync(`supabase/migrations/${file}`,"utf8").replace(/create extension if not exists pgcrypto(?: with schema extensions)?;/gi,"");
    try{await db.exec(sql);}catch(error){throw new Error(`Migration ${file}: ${error.code}: ${error.message}`);}
  }
  await db.exec(`grant usage on schema private to authenticated,service_role;
    insert into auth.users(id,email) values('${A}','qa-a@example.invalid'),('${B}','qa-b@example.invalid');`);
  const round=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'shared','shared',$2::jsonb,1) returning id`,[A,JSON.stringify({ownerId:"a",ownerName:"Private Name",lifecycleState:"completed",completedAt:"2026-09-15T12:00:00Z",players:[{id:"a",accountUserId:A,name:"Private Name",avatarUrl:"secret-avatar"},{id:"b",accountUserId:B,name:"Other Player"}],scores:{1:{a:4,b:5}},groupOrigin:{selectedMembers:[{roundPlayerId:"a",name:"Private Name"}]}})]);
  const guestRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version) values($1,'private','private','{}',1) returning id`,[A]);
  const staleSnapshot=await scalar("select snapshot from public.rounds_cloud where id=$1",[round]);
  const copy=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version) values($1,'copy','copy',$2::jsonb,1) returning id`,[B,JSON.stringify({...staleSnapshot,ownerId:"b",ownerName:"Other Player"})]);
  await q("insert into public.user_cloud_state(user_id,active_draft) values($1,$2::jsonb)",[A,JSON.stringify(staleSnapshot)]);
  await q("insert into public.round_players_cloud(round_id,local_player_id,name) values($1,'a','Private Name'),($1,'b','Other Player')",[round]);
  // No participant/self-confirm rows: the frozen account-linked snapshot alone
  // must prevent deleting the other player's historical card.
  const group=await scalar(`insert into public.groups_v2(owner_id,name) values($1,'Shared group') returning id`,[A]);
  await q(`insert into public.group_memberships_v2(group_id,user_id,display_name_snapshot,role) values($1,$2,'A','ADMIN'),($1,$3,'B','MEMBER')`,[group,A,B]);
  await q(`insert into public.player_equipment_profiles(user_id,snapshot,version) values($1::uuid,jsonb_build_object('userId',$1::uuid::text,'schemaVersion',2),1)`,[A]);
  await q("insert into public.user_statistics_resets(user_id,reset_at) values($1,now())",[A]);
  await q("update public.profiles set social_privacy='FRIENDS' where id=$1",[B]);
  await q("insert into public.social_activity_preferences_v3(user_id,share_rounds) values($1,true)",[B]);
  await q("insert into public.friendships(user_a_id,user_b_id) values($1,$2)",[A,B]);
  await q("update public.social_activities_v3 set material_hash=$2,audience='FRIENDS' where source_round_id=$1",[copy,HASH]);
  const bActivity=await scalar("select id from public.social_activities_v3 where source_round_id=$1 and author_id=$2",[copy,B]);
  await asUser(A);
  await q("insert into public.social_likes_v3(activity_id,user_id,expected_hash) values($1,$2,$3)",[bActivity,A,HASH]);
  await q("insert into public.social_comments_v3(activity_id,author_id,expected_hash,body) values($1,$2,$3,'QA comment')",[bActivity,A,HASH]);
  await admin();
  await asUser(B);
  await expectError(()=>acquire(A),["42501"]);
  await admin();
  await expectError(()=>prepare(OP,null),["42501"]);
  const first=await acquire(A);
  assert.equal(first.stage,"requested");
  assert.equal((await acquire(A)).lease_token,null,"concurrent worker does not own lease");
  assert.equal(await scalar("select public.account_lifecycle_recover($1,$2,$3)",[OP,"delete_golf_data","e".repeat(64)]),null);
  await asUser(A);
  assert.equal(await scalar("select public.account_access_status()"),"closing");
  await expectError(()=>q("select public.account_api_access_guard()"),["42501"]);
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud")),0,"stale JWT direct table reads denied");
  await admin();
  await expectError(()=>complete(),["42501"]);
  // Force a failure after earlier round writes to prove one SQL transaction
  // rolls ALL graph changes back, with the durable request still resumable.
  await db.exec(`create function private.qa_fail_graph() returns trigger language plpgsql as $$ begin raise exception 'qa_injected_failure'; end $$;
    create trigger qa_fail_graph before update on public.groups_v2 for each row execute function private.qa_fail_graph();`);
  await expectError(()=>prepare(),["P0001"]);
  assert.equal(await scalar("select owner_id from public.rounds_cloud where id=$1",[round]),A);
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud where id=$1",[guestRound])),1);
  assert.equal(await scalar("select stage from private.account_lifecycle_jobs where request_id=$1",[OP]),"requested");
  await db.exec("drop trigger qa_fail_graph on public.groups_v2; drop function private.qa_fail_graph();");
  assert.equal((await prepare()).stage,"data_prepared");
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud where id=$1",[guestRound])),0);
  const kept=(await q("select owner_id,snapshot from public.rounds_cloud where id=$1",[round])).rows[0];
  assert.equal(kept.owner_id,null); assert.equal(kept.snapshot.ownerName,"Jugador eliminado");
  assert.equal(kept.snapshot.players[0].name,"Jugador eliminado"); assert.equal(kept.snapshot.players[0].accountUserId,null);
  assert.equal(kept.snapshot.players[1].name,"Other Player"); assert.deepEqual(kept.snapshot.scores,{1:{a:4,b:5}});
  assert.equal(kept.snapshot.groupOrigin.selectedMembers[0].name,"Jugador eliminado");
  assert.equal(Number(await scalar("select count(*) from public.groups_v2 where id=$1",[group])),1);
  await expectError(()=>complete(),["P0001"]);
  // Simulates the Auth Admin deletion only AFTER SQL preparation. All actual
  // FK constraints from repository migrations are active, including Social.
  await q("delete from auth.users where id=$1",[A]);
  assert.equal((await complete()).stage,"completed");
  assert.equal((await acquire(A)).stage,"completed","same operation is idempotent after Auth removal");
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud where id=$1",[round])),1);
  assert.equal(Number(await scalar("select count(*) from public.player_equipment_profiles where user_id=$1",[A])),0);
  assert.equal(Number(await scalar("select count(*) from public.user_statistics_resets where user_id=$1",[A])),0);
  assert.equal(Number(await scalar("select count(*) from public.social_likes_v3 where user_id=$1",[A])),0);
  assert.equal(Number(await scalar("select count(*) from public.social_comments_v3 where author_id=$1",[A])),0);
  assert.equal(Number(await scalar("select count(*) from public.social_activities_v3 where id=$1",[bActivity])),1);
  assert.equal(await scalar("select public.account_lifecycle_recover($1,$2,$3)",[OP,"delete_golf_data",HASH]),A);
  // A remaining participant's offline device resends a pre-delete snapshot.
  // The DB tombstone scrubs the identity again rather than resurrecting PII.
  await asUser(B);
  await q("update public.rounds_cloud set snapshot=$2::jsonb where id=$1",[copy,JSON.stringify({...staleSnapshot,ownerId:"b",ownerName:"Other Player"})]);
  const restored=await scalar("select snapshot from public.rounds_cloud where id=$1",[copy]);
  assert.equal(restored.players[0].name,"Jugador eliminado");
  assert.equal(restored.players[0].avatarUrl,null);
  assert.equal(restored.ownerName,"Other Player");
  assert.deepEqual(restored.scores,staleSnapshot.scores);
  await admin();
  await q("insert into public.round_participants_v2(round_id,user_id,player_key,role) values($1,$2,'b','PLAYER')",[round,B]);
  await asUser(B);
  assert.equal(await scalar("select snapshot->>'ownerName' from public.rounds_cloud where id=$1",[round]),"Jugador eliminado","real participant reads shared history after organizer deletion");
  await admin();
  await q("update public.round_players_cloud set name='Private Name' where round_id=$1 and local_player_id='a'",[round]);
  assert.equal(await scalar("select name from public.round_players_cloud where round_id=$1 and local_player_id='a'",[round]),"Jugador eliminado");

  const archiveOp="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const before=Number(await scalar("select count(*) from public.rounds_cloud"));
  await acquire(B,archiveOp,"retain_history"); await prepare(archiveOp);
  await expectError(()=>complete(archiveOp),["P0001"]);
  await q("update auth.users set banned_until=now()+interval '100 years' where id=$1",[B]);
  await complete(archiveOp);
  assert.equal(Number(await scalar("select count(*) from auth.users where id=$1",[B])),1);
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud")),before);
  assert.equal(await scalar("select account_status from private.account_lifecycle_state where user_id=$1",[B]),"archived");
  assert.equal(await scalar("select deleted_at from private.account_lifecycle_state where user_id=$1",[B]),null);
  await asUser(B); await expectError(()=>q("select public.account_api_access_guard()"),["42501"]);
  await admin();
  const C="99999999-9999-4999-8999-999999999999", emptyOp="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await q("insert into auth.users(id,email) values($1,'qa-empty@example.invalid')",[C]);
  await acquire(C,emptyOp); await prepare(emptyOp);
  await q("delete from auth.users where id=$1",[C]);
  assert.equal((await complete(emptyOp)).stage,"completed","empty account delete succeeds");
  assert.equal((await acquire(C,emptyOp)).stage,"completed","empty account repeat remains idempotent");
  console.log("PASS: full migration graph, no self-service actor override, lease/retry, shared snapshots, privacy scrub, Auth cascade, archive, stale-JWT RLS. Auth HTTP/Storage real Preview remains separate QA.");
} catch(error) { console.error(error.code || "ASSERTION", error.message, error.where || ""); process.exitCode=1; }
finally { await db.close(); }
