import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// PostgreSQL/WASM only; no remote credentials, network or real users.
const db = new PGlite({ extensions: { pg_trgm } });
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER="66666666-6666-4666-8666-666666666666", LEGACY_DELETED="77777777-7777-4777-8777-777777777777";
const LEGACY_OTHER="55555555-5555-4555-8555-555555555555";
const A_PLAYER=`qa-player-${A}`;
const REBORN="33333333-3333-4333-8333-333333333333";
const OP="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LEASE="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", HASH="c".repeat(64);
const q=(sql,values)=>db.query(sql,values);
const scalar=async(sql,values)=>Object.values((await q(sql,values)).rows[0])[0];
const deletedPlayerKey=async(roundId,userId,oldKey)=>oldKey.replace(
  userId,
  await scalar("select private.account_deleted_identity_token($1,$2)",[`round:${roundId}`,userId]),
);
const expectError=async(action,codes)=>{let error;try{await action();}catch(e){error=e;}assert.ok(error,"expected SQL failure");assert.ok(codes.includes(error.code),`${error.code}: ${error.message}`);};
const admin=()=>db.exec("reset role; reset request.jwt.claim.sub;");
const asUser=id=>db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
const acquire=(actor,operation=OP,policy="delete_golf_data",lease=LEASE)=>scalar("select public.account_lifecycle_acquire($1,$2,$3,$4,$5)",[actor,operation,policy,HASH,lease]);
const prepare=(operation=OP,lease=LEASE)=>scalar("select public.account_lifecycle_prepare($1,$2)",[operation,lease]);
const reconcile=(operation=OP,lease=LEASE)=>scalar("select public.account_lifecycle_reconcile_identifiers($1,$2)",[operation,lease]);
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
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1)||md5('x'||$1),'hex') $$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select decode(md5(encode($1,'hex'))||md5('x'||encode($1,'hex')),'hex') $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select substring(decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') from 1 for $1) $$;
    grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
  `);
  const files=readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort();
  for(const file of files) {
    const sql=readFileSync(`supabase/migrations/${file}`,"utf8").replace(/create extension if not exists pgcrypto(?: with schema extensions)?;/gi,"");
    try{await db.exec(sql);}catch(error){throw new Error(`Migration ${file}: ${error.code}: ${error.message}`);}
  }

  // Reproduce data written before the tombstone migration existed. The rows
  // are inserted before lifecycle state marks the identity deleted so the
  // current stale-write trigger cannot clean them opportunistically. Reapply
  // the additive migration exactly as QA will and prove its backfill.
  await q(`insert into auth.users(id,email,email_confirmed_at) values
    ($1,'qa-legacy-owner@example.invalid',now()),($2,'qa-legacy-deleted@example.invalid',now()),
    ($3,'qa-legacy-other@example.invalid',now())`,[LEGACY_OWNER,LEGACY_DELETED,LEGACY_OTHER]);
  const legacyPlayer=`account:${LEGACY_DELETED}`;
  const legacyRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'qa-legacy-shared','qa-legacy-shared',$2::jsonb,1) returning id`,[LEGACY_OWNER,JSON.stringify({
      ownerId:`account:${LEGACY_OWNER}`,players:[{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}],
      scores:{1:{[legacyPlayer]:4}},putts:{1:{[legacyPlayer]:2}},
    })]);
  const legacyGroup=await scalar(`insert into public.groups_v2(owner_id,name,default_template)
    values($1,'QA legacy shared group',$2::jsonb) returning id`,[LEGACY_OWNER,JSON.stringify({players:[{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}]})]);
  const legacyMarkerGroup=await scalar(`insert into public.groups_v2(owner_id,name,default_template)
    values($1,'QA legacy marker-only group',$2::jsonb) returning id`,[LEGACY_OWNER,JSON.stringify({players:[{
      id:"legacy-marker-only",accountUserId:null,identityDeleted:true,name:"LEGACY_MARKER_PII",
      avatarUrl:"legacy-marker-avatar",updatedBy:LEGACY_OTHER,
    }]})]);
  const legacyRoundPlayer=await scalar(`insert into public.round_players_cloud(round_id,local_player_id,name)
    values($1,$2,'Legacy private name') returning id`,[legacyRound,legacyPlayer]);
  await q(`insert into public.round_group_snapshots_v2(round_id,source_group_id,source_group_name,source_group_version,selected_player_count)
    values($1,$2,'QA legacy shared group',1,1)`,[legacyRound,legacyGroup]);
  await q(`insert into public.round_group_snapshot_players_v2(round_id,round_player_id,display_name_snapshot,position)
    values($1,$2,'Legacy private name',0)`,[legacyRound,legacyRoundPlayer]);
  const legacyVersion=await scalar(`insert into public.cloud_record_versions(owner_id,entity_type,local_id,version,previous_snapshot)
    values($1,'round','qa-legacy-shared',1,$2::jsonb) returning id`,[LEGACY_OWNER,JSON.stringify({players:[{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}],scores:{1:{[legacyPlayer]:4}},putts:{1:{[legacyPlayer]:2}}})]);
  const legacyOtherRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'qa-legacy-shared','qa-legacy-shared',$2::jsonb,1) returning id`,[LEGACY_OTHER,JSON.stringify({ownerId:`account:${LEGACY_OTHER}`,players:[{id:`account:${LEGACY_OTHER}`,accountUserId:LEGACY_OTHER,name:"Other owner"}]})]);
  await q(`insert into public.round_course_handicap_snapshots(user_id,round_id,player_key,tee_id,tee_name,index_value,index_source,slope,course_rating,course_par,course_handicap,formula_version,effective_at,calculated_at)
    values($1,'qa-legacy-shared',$2,'qa-tee','QA tee',10,'BACKYARD_MANUAL',113,72,72,10,'qa-v1',now(),now())`,[LEGACY_OTHER,legacyPlayer]);
  assert.equal((await scalar("select private.account_deleted_identity_token($1,$2)",[`round:${legacyRound}`,LEGACY_DELETED])).length,36,
    "deleted identity replacement is UUID-sized for bounded relational keys");
  await db.exec("alter table public.competition_definitions disable trigger competition_definition_audit; alter table public.admin_import_jobs disable trigger import_job_audit; alter table public.admin_catalog_revisions disable trigger admin_catalog_revision_audit;");
  const legacyCompetition=await scalar(`insert into public.competition_definitions(name,type,status,settings,created_by)
    values('QA legacy competition','EVENT','DRAFT',$1::jsonb,$2) returning id`,[JSON.stringify({player:{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}}),LEGACY_OWNER]);
  const legacyImport=await scalar(`insert into public.admin_import_jobs(kind,scope_type,status,source_format,summary,created_by)
    values('COURSE','GLOBAL','UPLOADED','CSV',$1::jsonb,$2) returning id`,[JSON.stringify({player:{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}}),LEGACY_OWNER]);
  const legacyRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,payload,preview_hash,revision_hash,created_by)
    values('COURSE','qa-legacy-revision','GLOBAL',1,$1::jsonb,$2,$2,$3) returning id`,[JSON.stringify({player:{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}}),HASH,LEGACY_OWNER]);
  const legacyMarkerRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,payload,preview_hash,revision_hash,created_by)
    values('COURSE','qa-legacy-marker-revision','GLOBAL',1,$1::jsonb,$2,$2,$3) returning id`,[JSON.stringify({player:{
      id:"legacy-admin-marker",identityDeleted:true,name:"LEGACY_ADMIN_MARKER_PII",
      avatarUrl:"legacy-admin-marker-avatar",updatedBy:LEGACY_OTHER,
    }}),HASH,LEGACY_OWNER]);
  await db.exec("alter table public.competition_definitions enable trigger competition_definition_audit; alter table public.admin_import_jobs enable trigger import_job_audit; alter table public.admin_catalog_revisions enable trigger admin_catalog_revision_audit;");
  const legacyAudit=await scalar(`insert into public.admin_audit_log(action,entity_type,entity_id,before_state,after_state)
    values('QA_BACKFILL','QA_SYNTHETIC','qa-legacy',$1::jsonb,$1::jsonb) returning id`,[JSON.stringify({player:{id:legacyPlayer,name:"Legacy private name",avatarUrl:"legacy-private-avatar"}})]);
  await q(`insert into private.account_lifecycle_state(user_id,account_status,deleted_at) values($1,'deleted',now())`,[LEGACY_DELETED]);
  await q(`insert into private.account_lifecycle_jobs(request_id,user_id,data_policy,token_hash,stage,completed_at)
    values('99999999-9999-4999-8999-999999999998',$1,'delete_golf_data',$2,'completed',now())`,[LEGACY_DELETED,HASH]);
  const tombstoneSql=readFileSync("supabase/migrations/20260927045252_account_delete_round_player_tombstones.sql","utf8");
  await db.exec(tombstoneSql);
  const legacyTombstone=await deletedPlayerKey(legacyRound,LEGACY_DELETED,legacyPlayer);
  const legacyRoundSnapshot=await scalar("select snapshot from public.rounds_cloud where id=$1",[legacyRound]);
  const legacyGroupTemplate=await scalar("select default_template from public.groups_v2 where id=$1",[legacyGroup]);
  const legacyVersionSnapshot=await scalar("select previous_snapshot from public.cloud_record_versions where id=$1",[legacyVersion]);
  const legacyCompetitionSettings=await scalar("select settings from public.competition_definitions where id=$1",[legacyCompetition]);
  const legacyImportSummary=await scalar("select summary from public.admin_import_jobs where id=$1",[legacyImport]);
  const legacyRevisionRow=(await q("select payload,preview_hash,revision_hash from public.admin_catalog_revisions where id=$1",[legacyRevision])).rows[0];
  const legacyAuditStates=(await q("select before_state,after_state from public.admin_audit_log where id=$1",[legacyAudit])).rows[0];
  for(const value of [legacyRoundSnapshot,legacyGroupTemplate,legacyVersionSnapshot,legacyCompetitionSettings,legacyImportSummary,legacyRevisionRow.payload,...Object.values(legacyAuditStates)]) {
    assert.ok(!JSON.stringify(value).includes(LEGACY_DELETED),"backfill removes the deleted UUID from historical JSON");
  }
  for(const player of [legacyRoundSnapshot.players[0],legacyGroupTemplate.players[0],legacyVersionSnapshot.players[0],legacyCompetitionSettings.player,legacyImportSummary.player,legacyRevisionRow.payload.player,legacyAuditStates.before_state.player,legacyAuditStates.after_state.player]) {
    assert.equal(player.name,"Jugador eliminado","compound-id-only identity loses its historical name");
    assert.equal(player.avatarUrl,null,"compound-id-only identity loses its historical avatar");
    assert.equal(player.identityDeleted,true);
  }
  assert.equal(legacyRoundSnapshot.players[0].id,legacyTombstone);
  assert.equal(legacyRoundSnapshot.scores[1][legacyTombstone],4);
  assert.equal(legacyRoundSnapshot.putts[1][legacyTombstone],2);
  assert.equal(legacyVersionSnapshot.players[0].id,legacyTombstone,"round version uses the canonical round tombstone");
  assert.equal(legacyVersionSnapshot.scores[1][legacyTombstone],4);
  assert.equal(legacyVersionSnapshot.putts[1][legacyTombstone],2);
  const legacyOtherTombstone=await deletedPlayerKey(legacyOtherRound,LEGACY_DELETED,legacyPlayer);
  assert.equal(await scalar("select player_key from public.round_course_handicap_snapshots where user_id=$1 and round_id='qa-legacy-shared'",[LEGACY_OTHER]),legacyOtherTombstone,"same local round id is scoped by proven owner and uses the correct canonical namespace");
  assert.notEqual(legacyOtherTombstone,legacyTombstone);
  assert.equal(await scalar("select display_name_snapshot from public.round_group_snapshot_players_v2 where round_id=$1 and round_player_id=$2",[legacyRound,legacyRoundPlayer]),"Jugador eliminado","backfill removes relational frozen player names");
  const legacyRevisionHash=await scalar("select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from public.admin_catalog_revisions where id=$1",[legacyRevision]);
  assert.equal(legacyRevisionRow.preview_hash,legacyRevisionHash,"backfill reconciles the revision preview hash");
  assert.equal(legacyRevisionRow.revision_hash,legacyRevisionHash,"backfill reconciles the published revision hash");
  assert.equal(await scalar("select bool_and(tgenabled='O') from pg_trigger where tgname in ('competition_definition_audit','import_job_audit','admin_catalog_revision_guard','admin_catalog_revision_audit')"),true,"Admin guard/audit triggers are restored after backfill");
  const legacyMarkerTemplate=await scalar("select default_template from public.groups_v2 where id=$1",[legacyMarkerGroup]);
  assert.equal(legacyMarkerTemplate.players[0].name,"Jugador eliminado","historical marker-only JSON is scrubbed during backfill");
  assert.equal(legacyMarkerTemplate.players[0].avatarUrl ?? null,null);
  assert.equal(legacyMarkerTemplate.players[0].updatedBy,LEGACY_OTHER,"marker-only scrub preserves another actor's attribution");
  const legacyMarkerRevisionRow=(await q("select payload,preview_hash,revision_hash from public.admin_catalog_revisions where id=$1",[legacyMarkerRevision])).rows[0];
  assert.equal(legacyMarkerRevisionRow.payload.player.name,"Jugador eliminado","historical marker-only Admin payload is scrubbed");
  assert.equal(legacyMarkerRevisionRow.payload.player.avatarUrl ?? null,null);
  assert.equal(legacyMarkerRevisionRow.payload.player.updatedBy,LEGACY_OTHER,"Admin marker scrub preserves survivor attribution");
  const legacyMarkerRevisionHash=await scalar("select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from public.admin_catalog_revisions where id=$1",[legacyMarkerRevision]);
  assert.equal(legacyMarkerRevisionRow.preview_hash,legacyMarkerRevisionHash,"marker-only Admin preview hash is reconciled");
  assert.equal(legacyMarkerRevisionRow.revision_hash,legacyMarkerRevisionHash,"marker-only Admin revision hash is reconciled");
  // Remote QA has this email-consent surface even though it predates the
  // reconstructed local migration ledger. The lifecycle function discovers it
  // dynamically so local and deployed schemas follow the same fresh-start rule.
  await db.exec(`create table public.marketing_waitlist(
    id uuid primary key default gen_random_uuid(),email text not null,name text,consent_privacy boolean not null default false
  );`);
  assert.equal(await scalar("select has_function_privilege('authenticated','private.account_lifecycle_context_actor()','EXECUTE')"),false,"lease context is not client-callable");
  assert.equal(await scalar("select has_function_privilege('service_role','private.account_lifecycle_context_actor()','EXECUTE')"),true,"trusted lifecycle worker can validate its lease context");
  assert.equal(await scalar("select has_function_privilege('authenticated','public.account_lifecycle_reconcile_identifiers(uuid,uuid)','EXECUTE')"),false,"reconciliation RPC is not client-callable");
  assert.equal(await scalar("select has_function_privilege('service_role','public.account_lifecycle_reconcile_identifiers(uuid,uuid)','EXECUTE')"),true,"trusted lifecycle worker can reconcile identifiers");
  await db.exec(`grant usage on schema private to authenticated,service_role;
    insert into auth.users(id,email,email_confirmed_at) values
      ('${A}','qa-a@example.invalid',now()),('${B}','qa-b@example.invalid',now());
    insert into public.admin_memberships(user_id,role,scope_type,active,created_by)
      values('${A}','SUPER_ADMIN','GLOBAL',true,'${A}'),('${B}','CATALOG_ADMIN','GLOBAL',true,'${A}');
    set request.jwt.claim.sub='${A}';`);

  // Complete Admin provenance fixture: the 17 Auth references are historical
  // attribution. Shared rows survive with NULL rather than a replacement actor.
  const legacyTournament=await scalar(`insert into public.tournaments(short_code,created_by,name,tournament_date,course_name,course_snapshot,holes,start_hole,format)
    values('QADEL1',$1,'Synthetic private tournament','2026-09-25','QA course','{}',18,1,'gross') returning id`,[A]);
  const sharedTournament=await scalar(`insert into public.tournaments(short_code,created_by,name,tournament_date,course_name,course_snapshot,holes,start_hole,format)
    values('QASHR1',$1,'Synthetic shared tournament','2026-09-25','QA course','{}',18,1,'gross') returning id`,[B]);
  const sharedOwnedPlayer=await scalar(`insert into public.players(profile_id,owner_id,name,handicap,snapshot)
    values($1,$1,'Private linked player',12.4,$2::jsonb) returning id`,[A,JSON.stringify({accountUserId:A,name:"Private linked player",email:"qa-a@example.invalid"})]);
  const unsharedOwnedPlayer=await scalar(`insert into public.players(profile_id,owner_id,name,handicap,snapshot)
    values($1,$1,'Private unshared player',14.2,$2::jsonb) returning id`,[A,JSON.stringify({accountUserId:A,name:"Private unshared player"})]);
  const sharedTournamentPlayer=await scalar(`insert into public.tournament_players(tournament_id,player_id,name,handicap,pin_hash,claimed_at)
    values($1,$2,'Private linked player',12.4,'synthetic-pin',now()) returning id`,[sharedTournament,sharedOwnedPlayer]);
  const revision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,payload,preview_hash,revision_hash,created_by,reviewed_by,verified_by,published_by)
    values('COURSE','qa-delete-course','GLOBAL',1,$2::jsonb,$3,$3,$1,$1,$1,$1) returning id`,[A,JSON.stringify({accountUserId:A,created_by:A,email:"qa-a@example.invalid",name:"Private Admin"}),HASH]);
  const publishedRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,status,payload,preview_hash,revision_hash,created_by,published_by)
    values('BALL','qa-delete-ball','GLOBAL',1,'PUBLISHED',$2::jsonb,$3,$3,$1,$1) returning id`,[A,JSON.stringify({accountUserId:A,created_by:A,email:"qa-a@example.invalid",name:"Published private attribution"}),HASH]);
  const configuration=await scalar(`insert into public.course_configurations(course_id,name,scope_type,status,created_by,published_by,version,revision_hash)
    values('qa-delete-course','QA delete configuration','COURSE','DRAFT',$1,$1,1,$2) returning id`,[A,HASH]);
  await q(`update public.course_configurations configuration set revision_hash=encode(extensions.digest(
    convert_to(private.admin_configuration_payload_v1(configuration.id)::text,'UTF8'),'sha256'),'hex') where id=$1`,[configuration]);
  const configurationHashBefore=await scalar("select revision_hash from public.course_configurations where id=$1",[configuration]);
  const localRules=await scalar(`insert into public.course_local_rule_sets(course_id,title,version,status,source,created_by,published_by)
    values('qa-delete-course','QA delete rules',1,'DRAFT','Synthetic lifecycle fixture',$1,$1) returning id`,[A]);
  const adminDocument=await scalar(`insert into public.admin_documents(owner_entity_type,owner_entity_id,scope_type,storage_path,mime_type,byte_size,original_name,created_by)
    values('COURSE','qa-delete-course','GLOBAL','qa/account-delete/admin.pdf','application/pdf',42,'admin.pdf',$1) returning id`,[A]);
  const adminDocumentStorage=await scalar(`insert into storage.objects(bucket_id,name,owner,owner_id)
    values('admin-documents-private','qa/account-delete/admin.pdf',$1,$1::uuid::text) returning id`,[A]);
  const competition=await scalar(`insert into public.competition_definitions(legacy_tournament_id,name,type,status,settings,created_by,published_by)
    values($2,'QA delete competition','TOURNAMENT','DRAFT',$3::jsonb,$1,$1) returning id`,[A,legacyTournament,JSON.stringify({actor_id:A,email:"qa-a@example.invalid"})]);
  const competitionRules=await scalar(`insert into public.competition_rule_sets(competition_id,title,version,status,created_by,published_by)
    values($2,'QA delete competition rules',1,'DRAFT',$1,$1) returning id`,[A,competition]);
  const importJob=await scalar(`insert into public.admin_import_jobs(kind,scope_type,status,source_format,summary,created_by,confirmed_by)
    values('COURSE','GLOBAL','UPLOADED','CSV',$2::jsonb,$1,$1) returning id`,[A,JSON.stringify({created_by:A,email:"qa-a@example.invalid"})]);
  const feedback="44444444-4444-4444-8444-444444444444";
  await q(`insert into public.feedback_requests(id,user_id,category,payload,status,title,description,reply_email,identity_snapshot)
    values($1,$2,'BUG',$3::jsonb,'NOT_SENT','Private request','Synthetic private feedback','qa-a@example.invalid',$4::jsonb)`,
    [feedback,A,JSON.stringify({description:"Synthetic private feedback",user_id:A,email:"qa-a@example.invalid"}),JSON.stringify({userId:A,email:"qa-a@example.invalid"})]);
  const requestDraft=await scalar(`insert into public.admin_request_drafts(feedback_request_id,entity_type,created_by)
    values($2,'REQUEST',$1) returning id`,[A,feedback]);
  const archiveDocument=await scalar(`insert into public.admin_documents(owner_entity_type,owner_entity_id,scope_type,storage_path,mime_type,byte_size,original_name,created_by)
    values('BALL','qa-archive-ball','GLOBAL','qa/account-delete/archive.pdf','application/pdf',42,'archive.pdf',$1) returning id`,[B]);
  await db.exec("reset request.jwt.claim.sub;");
  const round=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'shared','shared',$2::jsonb,1) returning id`,[A,JSON.stringify({ownerId:A_PLAYER,ownerName:"Private Name",lifecycleState:"completed",completedAt:"2026-09-15T12:00:00Z",players:[{id:A_PLAYER,accountUserId:A,name:"Private Name",avatarUrl:"secret-avatar"},{id:"b",accountUserId:B,name:"Other Player"}],scores:{1:{[A_PLAYER]:4,b:5}},putts:{1:{[A_PLAYER]:2,b:2}},groupOrigin:{selectedMembers:[{roundPlayerId:A_PLAYER,name:"Private Name"}]}})]);
  const roundTombstone=await deletedPlayerKey(round,A,A_PLAYER);
  const guestRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version) values($1,'private','private','{}',1) returning id`,[A]);
  const staleSnapshot=await scalar("select snapshot from public.rounds_cloud where id=$1",[round]);
  const copy=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version) values($1,'copy','copy',$2::jsonb,1) returning id`,[B,JSON.stringify({...staleSnapshot,ownerId:"b",ownerName:"Other Player"})]);
  const copyTombstone=await deletedPlayerKey(copy,A,A_PLAYER);
  await q("insert into public.user_cloud_state(user_id,active_draft) values($1,$2::jsonb)",[A,JSON.stringify(staleSnapshot)]);
  await q("insert into public.round_players_cloud(round_id,local_player_id,name) values($1,$2,'Private Name'),($1,'b','Other Player')",[round,A_PLAYER]);
  // No participant/self-confirm rows: the frozen account-linked snapshot alone
  // must prevent deleting the other player's historical card.
  const group=await scalar(`insert into public.groups_v2(owner_id,name,default_template)
    values($1,'Shared group',$2::jsonb) returning id`,[A,JSON.stringify({players:[{id:A_PLAYER,accountUserId:A,name:"Private Name"}]})]);
  await q(`insert into public.group_memberships_v2(group_id,user_id,display_name_snapshot,role) values($1,$2,'A','ADMIN'),($1,$3,'B','MEMBER')`,[group,A,B]);
  const emailInvite=await scalar(`insert into private.group_email_invitations(group_id,inviter_id,recipient_email,recipient_label)
    values($1,$2,'qa-a@example.invalid','Private invitee') returning id`,[group,B]);
  await q("insert into public.marketing_waitlist(email,name,consent_privacy) values('qa-a@example.invalid','Private Marketing Name',true)");
  const ownedCourse=await scalar(`insert into public.courses_cloud(owner_id,name,local_id,snapshot)
    values($1,'Private synced course','qa-private-course',$2::jsonb) returning id`,[A,JSON.stringify({ownerId:A,name:"Private synced course"})]);
  const ownedCourseVersion=await scalar(`insert into public.course_versions(course_id,version,holes,created_by)
    values($1,1,$2::jsonb,$3) returning id`,[ownedCourse,JSON.stringify(Array.from({length:18},(_,index)=>({number:index+1,par:4}))),A]);
  const sharedCourse=await scalar(`insert into public.courses_cloud(owner_id,name,local_id,snapshot)
    values($1,'Shared synced course','qa-shared-course',$2::jsonb) returning id`,[B,JSON.stringify({ownerId:B,name:"Shared synced course"})]);
  const sharedCourseVersion=await scalar(`insert into public.course_versions(course_id,version,holes,created_by)
    values($1,1,$2::jsonb,$3) returning id`,[sharedCourse,JSON.stringify(Array.from({length:18},(_,index)=>({number:index+1,par:4}))),A]);
  const manualClub="qa-manual-club-delete";
  const manualCourse="qa-manual-course-delete";
  await q(`insert into public.golf_clubs(id,name,provider,visibility,created_by)
    values($1,'Private manual club','USER_MANUAL','PRIVATE',$2)`,[manualClub,A]);
  await q(`insert into public.golf_courses(id,club_id,name,holes,provider,visibility,created_by)
    values($1,$2,'Private manual course',18,'USER_MANUAL','PRIVATE',$3)`,[manualCourse,manualClub,A]);
  await q(`insert into public.golf_course_tees(id,course_id,name,provider)
    values('qa-manual-tee-delete',$1,'QA tee','USER_MANUAL')`,[manualCourse]);
  const manualHole="qa-manual-hole-delete";
  const manualYardage="qa-manual-yardage-delete";
  const manualGeoFeature="qa-manual-geo-delete";
  const manualNineRating="qa-manual-rating-delete";
  await q(`insert into public.golf_holes(id,course_id,hole_number,par,stroke_index,provider)
    values($1,$2,1,4,1,'USER_MANUAL')`,[manualHole,manualCourse]);
  await q(`insert into public.golf_tee_hole_yardages(id,course_id,tee_id,hole_id,yards,provider)
    values($1,$2,'qa-manual-tee-delete',$3,410,'USER_MANUAL')`,[manualYardage,manualCourse,manualHole]);
  await q(`insert into public.golf_hole_geo_features(id,hole_id,type,latitude,longitude,provider)
    values($1,$2,'GREEN_CENTER',19.041,-98.205,'USER_MANUAL')`,[manualGeoFeature,manualHole]);
  await q(`insert into public.golf_tee_nine_ratings(id,course_id,tee_id,segment,rating,slope,par,source_url,observed_at,source_payload)
    values($1,$2,'qa-manual-tee-delete','FRONT',35.5,113,36,'https://example.invalid/account-delete','2026-09-25',$3::jsonb)`,
    [manualNineRating,manualCourse,JSON.stringify({synthetic:true,ownerId:A})]);
  await q(`insert into public.player_equipment_profiles(user_id,snapshot,version) values($1::uuid,jsonb_build_object('userId',$1::uuid::text,'schemaVersion',2),1)`,[A]);
  await q("insert into public.user_statistics_resets(user_id,reset_at) values($1,now())",[A]);
  const storageObject=await scalar(`insert into storage.objects(bucket_id,name,owner,owner_id)
    values('scorecard-photos',$1::uuid::text||'/private.webp',$1,$1::uuid::text) returning id`,[A]);
  await q("update public.profiles set social_privacy='FRIENDS' where id=$1",[B]);
  await q("insert into public.social_activity_preferences_v3(user_id,share_rounds) values($1,true)",[B]);
  await q("insert into public.friendships(user_a_id,user_b_id) values($1,$2)",[A,B]);
  await q("update public.social_activities_v3 set material_hash=$2,audience='FRIENDS' where source_round_id=$1",[copy,HASH]);
  const bActivity=await scalar("select id from public.social_activities_v3 where source_round_id=$1 and author_id=$2",[copy,B]);
  await asUser(A);
  await q("insert into public.social_likes_v3(activity_id,user_id,expected_hash) values($1,$2,$3)",[bActivity,A,HASH]);
  await q("insert into public.social_comments_v3(activity_id,author_id,expected_hash,body) values($1,$2,$3,'QA comment')",[bActivity,A,HASH]);
  // The lifecycle-aware Admin guards must remain transparent to an ordinary,
  // authorized draft edit when there is no valid lifecycle lease context.
  await q("update public.admin_catalog_revisions set internal_notes='Ordinary Admin edit' where id=$1",[revision]);
  assert.equal(await scalar("select internal_notes from public.admin_catalog_revisions where id=$1",[revision]),"Ordinary Admin edit");
  await expectError(()=>q("update public.admin_catalog_revisions set payload=payload||'{\"unsafe\":true}'::jsonb where id=$1",[publishedRevision]),["23514"]);
  await admin();
  await asUser(B);
  await expectError(()=>acquire(A),["42501"]);
  await expectError(()=>q("select public.account_lifecycle_prepare($1,$2)",[OP,LEASE]),["42501"]);
  await expectError(()=>q("select private.account_lifecycle_context_actor()"),["42501"]);
  await admin();
  await expectError(()=>prepare(OP,null),["42501"]);
  const first=await acquire(A);
  assert.equal(first.stage,"requested");
  assert.equal((await acquire(A)).lease_token,null,"concurrent worker does not own lease");
  assert.equal(await scalar("select public.account_lifecycle_recover($1,$2,$3)",[OP,"delete_golf_data","e".repeat(64)]),null);

  const rehomes=(await q("select * from public.account_lifecycle_storage_rehomes($1,$2)",[OP,LEASE])).rows;
  assert.equal(rehomes.length,1,"shared Admin storage is rehomed before owner cleanup");
  assert.equal(rehomes[0].document_id,adminDocument);
  assert.equal(rehomes[0].name,"qa/account-delete/admin.pdf");
  assert.equal(rehomes[0].replacement_name,`account-lifecycle-shared/${adminDocument}.pdf`);
  await expectError(()=>q("select public.account_lifecycle_commit_storage_rehome($1,$2,$3,$4,$5)",[
    OP,LEASE,adminDocument,rehomes[0].name,rehomes[0].replacement_name,
  ]),["P0001"]);
  const replacementStorage=await scalar(`insert into storage.objects(bucket_id,name,owner,owner_id)
    values('admin-documents-private',$1,null,null) returning id`,[rehomes[0].replacement_name]);
  assert.equal(await scalar("select public.account_lifecycle_commit_storage_rehome($1,$2,$3,$4,$5)",[
    OP,LEASE,adminDocument,rehomes[0].name,rehomes[0].replacement_name,
  ]),true);
  assert.equal(await scalar("select public.account_lifecycle_commit_storage_rehome($1,$2,$3,$4,$5)",[
    OP,LEASE,adminDocument,rehomes[0].name,rehomes[0].replacement_name,
  ]),true,"Storage rehome commit is idempotent");
  assert.equal((await q("select * from public.account_lifecycle_storage_rehomes($1,$2)",[OP,LEASE])).rows.length,0);
  const manifest=(await q("select * from public.account_lifecycle_storage($1,$2)",[OP,LEASE])).rows;
  assert.deepEqual(manifest.map(row=>row.name),[
    "qa/account-delete/admin.pdf",`${A}/private.webp`,
  ],"leased manifest exposes both the rehomed source and private object to the Storage API worker");
  await q("delete from storage.objects where id in ($1,$2)",[adminDocumentStorage,storageObject]); // simulates Storage.remove(), never product SQL.
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

  // A future RESTRICT/NO ACTION Auth FK must stop with a named diagnosis rather
  // than surfacing later as an opaque Auth Admin failure.
  await db.exec(`create table public.qa_unhandled_actor_ref(id uuid primary key default gen_random_uuid(),created_by uuid references auth.users(id) on delete restrict);
    insert into public.qa_unhandled_actor_ref(created_by) values('${A}');`);
  let unresolved;
  try { await prepare(); } catch(error) { unresolved=error; }
  assert.equal(unresolved?.code,"23503");
  assert.equal(unresolved?.message,"account_lifecycle_unresolved_auth_fk");
  assert.match(unresolved?.detail || "",/qa_unhandled_actor_ref/);
  await db.exec("drop table public.qa_unhandled_actor_ref;");

  // A malformed cross-owner graph must not let deleting A cascade a course
  // owned by B merely because both rows point at A's private manual club.
  const foreignManualCourse="qa-foreign-manual-course-preserve";
  await q(`insert into public.golf_courses(id,club_id,name,holes,provider,visibility,created_by)
    values($1,$2,'Other owner private course',18,'USER_MANUAL','PRIVATE',$3)`,[foreignManualCourse,manualClub,B]);
  let sharedClubFailure;
  try { await prepare(); } catch(error) { sharedClubFailure=error; }
  assert.equal(sharedClubFailure?.code,"23503");
  assert.equal(sharedClubFailure?.message,"account_lifecycle_shared_manual_club");
  assert.match(sharedClubFailure?.detail || "",/qa-manual-club-delete/);
  assert.equal(Number(await scalar("select count(*) from public.golf_courses where id in ($1,$2)",[manualCourse,foreignManualCourse])),2,"cross-owner club failure rolls back all course cleanup");
  assert.equal(await scalar("select stage from private.account_lifecycle_jobs where request_id=$1",[OP]),"requested");
  await q("delete from public.golf_courses where id=$1",[foreignManualCourse]);

  // Reconcile a job already marked data_prepared by an older worker. This is
  // the production incident recovery path, not merely a repeated no-op.
  await q("update private.account_lifecycle_jobs set stage='data_prepared' where request_id=$1",[OP]);
  const retryStorage=await scalar(`insert into storage.objects(bucket_id,name,owner,owner_id)
    values('feedback-private',$1::uuid::text||'/retry.webp',$1,$1::uuid::text) returning id`,[A]);
  assert.deepEqual((await q("select name from public.account_lifecycle_storage($1,$2)",[OP,LEASE])).rows.map(row=>row.name),[`${A}/retry.webp`]);
  await q("delete from storage.objects where id=$1",[retryStorage]);
  assert.equal((await prepare()).stage,"data_prepared");
  assert.equal((await prepare()).stage,"data_prepared","data_prepared reconciliation is idempotent");
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud where id=$1",[guestRound])),0);
  const kept=(await q("select owner_id,snapshot from public.rounds_cloud where id=$1",[round])).rows[0];
  assert.equal(kept.owner_id,null); assert.equal(kept.snapshot.ownerName,"Jugador eliminado");
  assert.equal(kept.snapshot.players[0].name,"Jugador eliminado"); assert.equal(kept.snapshot.players[0].accountUserId,null);
  assert.equal(kept.snapshot.players[0].id,roundTombstone); assert.equal(kept.snapshot.ownerId,roundTombstone);
  assert.equal(JSON.stringify(kept.snapshot).includes(A),false,"shared round JSON contains no deleted Auth UUID");
  assert.equal(kept.snapshot.players[1].name,"Other Player"); assert.deepEqual(kept.snapshot.scores,{1:{[roundTombstone]:4,b:5}});
  assert.deepEqual(kept.snapshot.putts,{1:{[roundTombstone]:2,b:2}});
  assert.equal(kept.snapshot.groupOrigin.selectedMembers[0].name,"Jugador eliminado");
  assert.equal(kept.snapshot.groupOrigin.selectedMembers[0].roundPlayerId,roundTombstone);
  assert.equal(await scalar("select local_player_id from public.round_players_cloud where round_id=$1 and name='Jugador eliminado'",[round]),roundTombstone);
  assert.equal(Number(await scalar("select count(*) from public.groups_v2 where id=$1",[group])),1);
  const keptGroup=await scalar("select default_template from public.groups_v2 where id=$1",[group]);
  assert.equal(JSON.stringify(keptGroup).includes(A),false,"shared group template contains no deleted Auth UUID");
  assert.equal(keptGroup.players[0].name,"Jugador eliminado");
  assert.ok((await scalar("select count(*) from public.cloud_record_versions"))>0,"round updates preserve version history");
  assert.equal(Number(await scalar("select count(*) from public.cloud_record_versions where previous_snapshot::text like '%'||$1::text||'%'",[A])),0,
    "shared cloud version history contains no deleted Auth UUID");
  assert.equal(Number(await scalar("select count(*) from private.group_email_invitations where id=$1",[emailInvite])),0,"verified-email invitation cannot relink on signup");
  assert.equal(Number(await scalar("select count(*) from public.tournaments where id=$1",[legacyTournament])),0,"private legacy tournament is removed");
  assert.equal(Number(await scalar("select count(*) from public.tournaments where id=$1",[sharedTournament])),1,"another account's tournament is preserved");
  assert.equal(Number(await scalar("select count(*) from public.players where id=$1",[unsharedOwnedPlayer])),0,"unshared private player is removed");
  const preservedPlayer=(await q("select owner_id,profile_id,name,snapshot from public.players where id=$1",[sharedOwnedPlayer])).rows[0];
  assert.ok(preservedPlayer,"actor-owned player linked by shared tournament is preserved");
  assert.equal(preservedPlayer.owner_id,null);
  assert.equal(preservedPlayer.profile_id,null);
  assert.equal(preservedPlayer.name,"Jugador eliminado");
  assert.equal(preservedPlayer.snapshot.accountUserId,null);
  const preservedTournamentPlayer=(await q("select player_id,profile_id,name,pin_hash,claimed_at from public.tournament_players where id=$1",[sharedTournamentPlayer])).rows[0];
  assert.equal(preservedTournamentPlayer.player_id,sharedOwnedPlayer);
  assert.equal(preservedTournamentPlayer.profile_id,null);
  assert.equal(preservedTournamentPlayer.name,"Jugador eliminado");
  assert.equal(preservedTournamentPlayer.pin_hash,null);
  assert.equal(preservedTournamentPlayer.claimed_at,null);
  assert.equal(await scalar("select legacy_tournament_id from public.competition_definitions where id=$1",[competition]),null,"Admin projection no longer blocks tournament delete");
  assert.equal(await scalar("select feedback_request_id from public.admin_request_drafts where id=$1",[requestDraft]),null,"private feedback is unlinked before Auth cascade");
  assert.equal(Number(await scalar("select count(*) from public.feedback_requests where id=$1",[feedback])),1,"private feedback remains until confirmed Auth deletion");
  for(const [table,id,columns] of [
    ["admin_catalog_revisions",revision,["created_by","reviewed_by","verified_by","published_by"]],
    ["admin_catalog_revisions",publishedRevision,["created_by","reviewed_by","verified_by","published_by"]],
    ["course_configurations",configuration,["created_by","published_by"]],
    ["course_local_rule_sets",localRules,["created_by","published_by"]],
    ["admin_documents",adminDocument,["created_by"]],
    ["competition_definitions",competition,["created_by","published_by"]],
    ["competition_rule_sets",competitionRules,["created_by","published_by"]],
    ["admin_import_jobs",importJob,["created_by","confirmed_by"]],
    ["admin_request_drafts",requestDraft,["created_by"]],
  ]) {
    const row=(await q(`select ${columns.join(",")} from public.${table} where id=$1`,[id])).rows[0];
    assert.ok(row,`${table} shared evidence is preserved`);
    for(const column of columns) assert.equal(row[column],null,`${table}.${column} provenance is anonymized`);
  }
  assert.equal(await scalar("select created_by from public.admin_memberships where user_id=$1",[B]),null,"admin_memberships.created_by is anonymized");
  assert.equal(Number(await scalar(`select count(*) from public.admin_audit_log
    where actor_id=$1 or coalesce(before_state::text,'') like '%'||$1::text||'%' or coalesce(after_state::text,'') like '%'||$1::text||'%'`,[A])),0,"Admin audit JSON contains no deleted UUID");
  const scrubbedRevision=await scalar("select payload from public.admin_catalog_revisions where id=$1",[revision]);
  assert.equal(scrubbedRevision.created_by,null); assert.equal(scrubbedRevision.email,null); assert.equal(scrubbedRevision.name,"Jugador eliminado");
  const scrubbedPublished=await scalar("select payload from public.admin_catalog_revisions where id=$1",[publishedRevision]);
  assert.equal(scrubbedPublished.created_by,null); assert.equal(scrubbedPublished.email,null); assert.equal(scrubbedPublished.name,"Jugador eliminado");
  for(const revisionId of [revision,publishedRevision]) {
    const hashes=(await q("select payload,preview_hash,revision_hash from public.admin_catalog_revisions where id=$1",[revisionId])).rows[0];
    const expectedHash=await scalar("select encode(extensions.digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex')",[JSON.stringify(hashes.payload)]);
    assert.equal(hashes.preview_hash,expectedHash,"revision preview hash matches scrubbed payload");
    assert.equal(hashes.revision_hash,expectedHash,"revision hash matches scrubbed payload");
  }
  const configurationHashAfter=await scalar("select revision_hash from public.course_configurations where id=$1",[configuration]);
  const expectedConfigurationHash=await scalar(`select encode(extensions.digest(
    convert_to(private.admin_configuration_payload_v1($1)::text,'UTF8'),'sha256'),'hex')`,[configuration]);
  assert.notEqual(configurationHashAfter,configurationHashBefore,"configuration hash changes with anonymized provenance");
  assert.equal(configurationHashAfter,expectedConfigurationHash,"configuration hash matches anonymized payload");
  assert.equal(Number(await scalar("select count(*) from public.courses_cloud where id=$1",[ownedCourse])),0,"private synced course is removed");
  assert.equal(Number(await scalar("select count(*) from public.course_versions where id=$1",[ownedCourseVersion])),0,"private course versions cascade");
  assert.equal(await scalar("select created_by from public.course_versions where id=$1",[sharedCourseVersion]),null,"shared course provenance is anonymized");
  assert.equal(Number(await scalar("select count(*) from public.golf_clubs where id=$1",[manualClub])),0,"private manual club is removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_courses where id=$1",[manualCourse])),0,"private manual course is removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_course_tees where id='qa-manual-tee-delete'")),0,"private manual tee is explicitly removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_holes where id=$1",[manualHole])),0,"private manual holes are explicitly removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_tee_hole_yardages where id=$1",[manualYardage])),0,"private manual yardage children are explicitly removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_hole_geo_features where id=$1",[manualGeoFeature])),0,"private manual geolocation children are removed");
  assert.equal(Number(await scalar("select count(*) from public.golf_tee_nine_ratings where id=$1",[manualNineRating])),0,"NO ACTION nine-rating leaves are explicitly removed");
  assert.equal(Number(await scalar("select count(*) from public.marketing_waitlist where lower(email)='qa-a@example.invalid'")),0,"verified-email consent cannot relink on signup");
  assert.equal(await scalar("select storage_path from public.admin_documents where id=$1",[adminDocument]),rehomes[0].replacement_name,"shared document points at ownerless copy");
  const replacement=(await q("select owner,owner_id from storage.objects where id=$1",[replacementStorage])).rows[0];
  assert.equal(replacement.owner,null); assert.equal(replacement.owner_id,null);
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
  assert.equal(Number(await scalar("select count(*) from public.feedback_requests where id=$1",[feedback])),0,"private feedback cascades only after Auth deletion");
  assert.equal(Number(await scalar("select count(*) from public.admin_request_drafts where id=$1",[requestDraft])),1,"Admin draft shell survives without private feedback PII");
  assert.equal(Number(await scalar("select count(*) from public.admin_memberships where user_id=$1",[A])),0,"deleted account's Admin membership cascades");
  assert.equal(Number(await scalar("select count(*) from public.admin_memberships where user_id=$1",[B])),1,"other Admin membership survives");
  assert.equal(Number(await scalar("select count(*) from storage.objects where id=$1",[replacementStorage])),1,"ownerless shared Admin document survives Auth deletion");
  assert.equal(await scalar("select public.account_lifecycle_recover($1,$2,$3)",[OP,"delete_golf_data",HASH]),A);
  await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-a@example.invalid',now())",[REBORN]);
  assert.equal(Number(await scalar("select count(*) from private.group_email_invitations where recipient_email='qa-a@example.invalid'")),0,"same email starts without prior invitations");
  assert.equal(Number(await scalar("select count(*) from public.player_equipment_profiles where user_id=$1",[REBORN])),0,"same email starts without equipment");
  assert.equal(Number(await scalar("select count(*) from public.user_statistics_resets where user_id=$1",[REBORN])),0,"same email starts without statistics state");
  // A remaining participant's offline device resends a pre-delete snapshot.
  // The DB tombstone scrubs the identity again rather than resurrecting PII.
  await asUser(B);
  await q("update public.rounds_cloud set snapshot=$2::jsonb where id=$1",[copy,JSON.stringify({...staleSnapshot,
    ownerId:"b",ownerName:"Other Player",players:[...staleSnapshot.players].reverse()})]);
  const restored=await scalar("select snapshot from public.rounds_cloud where id=$1",[copy]);
  const restoredDeleted=restored.players.find(player=>player.identityDeleted===true);
  assert.equal(restoredDeleted.name,"Jugador eliminado");
  assert.equal(restoredDeleted.avatarUrl,null);
  assert.equal(restoredDeleted.id,copyTombstone);
  assert.equal(restored.ownerName,"Other Player");
  assert.equal(JSON.stringify(restored).includes(A),false,"stale sync cannot restore the deleted Auth UUID");
  assert.deepEqual(restored.scores,{1:{[copyTombstone]:4,b:5}});
  assert.deepEqual(restored.putts,{1:{[copyTombstone]:2,b:2}});
  const tombstoneOnlySnapshot=structuredClone(restored);
  const tombstoneOnlyPlayer=tombstoneOnlySnapshot.players.find(player=>player.id===copyTombstone);
  tombstoneOnlyPlayer.name="RESTORED_PII";
  tombstoneOnlyPlayer.avatarUrl="restored-private-avatar";
  await q("update public.rounds_cloud set snapshot=$2::jsonb where id=$1",[copy,JSON.stringify(tombstoneOnlySnapshot)]);
  const tombstoneOnlyRestored=await scalar("select snapshot from public.rounds_cloud where id=$1",[copy]);
  const tombstoneOnlyDeleted=tombstoneOnlyRestored.players.find(player=>player.id===copyTombstone);
  assert.equal(tombstoneOnlyDeleted.name,"Jugador eliminado","tombstone-only stale snapshot cannot restore a deleted name");
  assert.equal(tombstoneOnlyDeleted.avatarUrl,null,"tombstone-only stale snapshot cannot restore a deleted avatar");
  assert.deepEqual(tombstoneOnlyRestored.scores,{1:{[copyTombstone]:4,b:5}});
  assert.deepEqual(tombstoneOnlyRestored.putts,{1:{[copyTombstone]:2,b:2}});
  const uppercaseIdentityOnly={
    ownerId:"b",ownerName:"Other Player",
    players:[{id:"uppercase-identity-only",accountUserId:A.toUpperCase(),name:"UPPERCASE_PII",avatarUrl:"uppercase-private-avatar"},{id:"b",accountUserId:B,name:"Other Player"}],
    scores:{1:{"uppercase-identity-only":4,b:5}},putts:{1:{"uppercase-identity-only":2,b:2}},
  };
  await q("update public.rounds_cloud set snapshot=$2::jsonb where id=$1",[copy,JSON.stringify(uppercaseIdentityOnly)]);
  const uppercaseRestored=await scalar("select snapshot from public.rounds_cloud where id=$1",[copy]);
  const uppercaseDeleted=uppercaseRestored.players.find(player=>player.id==="uppercase-identity-only");
  assert.equal(uppercaseDeleted.name,"Jugador eliminado","uppercase identity-key-only snapshot loses its name");
  assert.equal(uppercaseDeleted.avatarUrl,null,"uppercase identity-key-only snapshot loses its avatar");
  assert.equal(uppercaseDeleted.accountUserId ?? null,null,"uppercase identity-key-only snapshot loses its Auth id");
  assert.equal(uppercaseDeleted.identityDeleted,true);
  assert.equal(JSON.stringify(uppercaseRestored).toLowerCase().includes(A),false);
  await admin();
  await q("update public.groups_v2 set default_template=$2::jsonb where id=$1",[group,JSON.stringify({
    players:[{id:"marker-only",accountUserId:null,identityDeleted:true,name:"MARKER_ONLY_PII",avatarUrl:"marker-private-avatar",updatedBy:B}],
  })]);
  const markerOnly=await scalar("select default_template from public.groups_v2 where id=$1",[group]);
  assert.equal(markerOnly.players[0].name,"Jugador eliminado","identityDeleted marker enforces redaction without UUID or token");
  assert.equal(markerOnly.players[0].avatarUrl ?? null,null);
  assert.equal(markerOnly.players[0].updatedBy,B,"marker-only enforcement preserves survivor attribution");
  await admin();
  await q("insert into public.round_participants_v2(round_id,user_id,player_key,role) values($1,$2,'b','PLAYER')",[round,B]);
  await asUser(B);
  assert.equal(await scalar("select snapshot->>'ownerName' from public.rounds_cloud where id=$1",[round]),"Jugador eliminado","real participant reads shared history after organizer deletion");
  await admin();
  await q("update public.round_players_cloud set name='Private Name' where round_id=$1 and local_player_id=$2",[round,roundTombstone]);
  assert.equal(await scalar("select name from public.round_players_cloud where round_id=$1 and local_player_id=$2",[round,roundTombstone]),"Jugador eliminado");

  const archiveOp="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const before=Number(await scalar("select count(*) from public.rounds_cloud"));
  await acquire(B,archiveOp,"retain_history"); await prepare(archiveOp);
  await expectError(()=>complete(archiveOp),["P0001"]);
  await q("update auth.users set banned_until=now()+interval '100 years' where id=$1",[B]);
  await complete(archiveOp);
  assert.equal(Number(await scalar("select count(*) from auth.users where id=$1",[B])),1);
  assert.equal(Number(await scalar("select count(*) from public.rounds_cloud")),before);
  assert.equal(await scalar("select created_by from public.admin_documents where id=$1",[archiveDocument]),B,"retain_history leaves Admin attribution untouched");
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
  // A normal first attempt remains in requested throughout prepare. Its
  // validated operation+lease context must activate the compound-ID scrub.
  const D="88888888-8888-4888-8888-888888888888";
  const normalOp="12121212-1212-4212-8212-121212121212",normalLease="34343434-3434-4434-8434-343434343434";
  const D_PLAYER=`account:${D}`;
  await q("insert into auth.users(id,email) values($1,'qa-requested@example.invalid')",[D]);
  // Relational projections may outlive the JSON snapshot that originally
  // carried the account identity. The explicit reconcile stage must find and
  // tombstone those projections before Auth deletion.
  const relationalOnlyRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'requested-relational-only','requested-relational-only',$2::jsonb,1) returning id`,[B,JSON.stringify({
      ownerId:"b",ownerName:"Other Player",players:[{id:"b",accountUserId:B,name:"Other Player"}],scores:{},putts:{},
    })]);
  const relationalOnlyPlayer=await scalar(`insert into public.round_players_cloud(round_id,local_player_id,name)
    values($1,$2,'Requested private relational') returning id`,[relationalOnlyRound,D_PLAYER]);
  const survivorTeePreference=await scalar(`insert into public.player_course_tee_preferences(user_id,player_key,course_id,tee_id,source)
    values($1,$2,'qa-course','qa-tee','PLAYER_COURSE') returning id`,[B,D_PLAYER]);
  const unmappedHandicap=await scalar(`insert into public.round_course_handicap_snapshots(user_id,round_id,player_key,tee_id,tee_name,index_value,index_source,slope,course_rating,course_par,course_handicap,formula_version,effective_at,calculated_at)
    values($1,'qa-unmapped',$2,'qa-tee','QA tee',10,'BACKYARD_MANUAL',113,72,72,10,'qa-v1',now(),now()) returning id`,[B,D_PLAYER]);
  const requestedRound=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,'requested-shared','requested-shared',$2::jsonb,1) returning id`,[D,JSON.stringify({
      ownerId:D_PLAYER,ownerName:"Requested private",players:[{id:D_PLAYER,accountUserId:D,name:"Requested private"},{id:"b",accountUserId:B,name:"Other Player"}],
      scores:{1:{[D_PLAYER]:4,b:5}},putts:{1:{[D_PLAYER]:2,b:2}}
    })]);
  const requestedAdminPayload=JSON.stringify({player:{id:D_PLAYER,name:"Requested private",avatarUrl:"requested-private-avatar"}});
  await db.exec("alter table public.competition_definitions disable trigger competition_definition_audit; alter table public.admin_import_jobs disable trigger import_job_audit; alter table public.admin_catalog_revisions disable trigger admin_catalog_revision_audit;");
  const requestedCompetition=await scalar(`insert into public.competition_definitions(name,type,status,settings,created_by)
    values('QA requested competition','EVENT','DRAFT',$1::jsonb,$2) returning id`,[requestedAdminPayload,B]);
  const requestedImport=await scalar(`insert into public.admin_import_jobs(kind,scope_type,status,source_format,summary,created_by)
    values('COURSE','GLOBAL','UPLOADED','CSV',$1::jsonb,$2) returning id`,[requestedAdminPayload,B]);
  const requestedRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,payload,preview_hash,revision_hash,created_by)
    values('BALL','qa-requested-revision','GLOBAL',1,$1::jsonb,$2,$2,$3) returning id`,[requestedAdminPayload,HASH,B]);
  await db.exec("alter table public.competition_definitions enable trigger competition_definition_audit; alter table public.admin_import_jobs enable trigger import_job_audit; alter table public.admin_catalog_revisions enable trigger admin_catalog_revision_audit;");
  const requestedAudit=await scalar(`insert into public.admin_audit_log(action,entity_type,entity_id,before_state,after_state)
    values('QA_RUNTIME','QA_SYNTHETIC','qa-requested',$1::jsonb,$1::jsonb) returning id`,[requestedAdminPayload]);
  assert.equal((await acquire(D,normalOp,"delete_golf_data",normalLease)).stage,"requested");
  assert.equal((await prepare(normalOp,normalLease)).stage,"data_prepared");
  await expectError(()=>reconcile(normalOp,normalLease),["23514"]);
  assert.equal(await scalar("select local_player_id from public.round_players_cloud where id=$1",[relationalOnlyPlayer]),D_PLAYER,
    "an unmapped handicap fails the whole identifier reconciliation transaction");
  assert.equal(Number(await scalar("select count(*) from public.player_course_tee_preferences where id=$1",[survivorTeePreference])),1,
    "an unmapped handicap also rolls back private preference cleanup");
  await q("delete from public.round_course_handicap_snapshots where id=$1",[unmappedHandicap]);
  assert.equal((await reconcile(normalOp,normalLease)).stage,"data_prepared");
  const relationalOnlyTombstone=await deletedPlayerKey(relationalOnlyRound,D,D_PLAYER);
  assert.deepEqual((await q("select local_player_id,name from public.round_players_cloud where id=$1",[relationalOnlyPlayer])).rows[0],
    {local_player_id:relationalOnlyTombstone,name:"Jugador eliminado"},"relational-only player is reconciled before Auth deletion");
  await q("update public.round_players_cloud set name='Requested private restored by name only' where id=$1",[relationalOnlyPlayer]);
  assert.equal(await scalar("select name from public.round_players_cloud where id=$1",[relationalOnlyPlayer]),"Jugador eliminado",
    "name-only stale write cannot restore PII for a relational-only tombstone");
  assert.equal(Number(await scalar("select count(*) from public.player_course_tee_preferences where id=$1",[survivorTeePreference])),0,
    "survivor-owned private tee preference for the deleted identity is removed");
  const requestedKept=await scalar("select snapshot from public.rounds_cloud where id=$1",[requestedRound]);
  const requestedTombstone=await deletedPlayerKey(requestedRound,D,D_PLAYER);
  assert.equal(JSON.stringify(requestedKept).includes(D),false,"requested prepare removes compound Auth UUIDs");
  assert.equal(requestedKept.players.find(player=>player.identityDeleted===true).id,requestedTombstone);
  assert.deepEqual(requestedKept.scores,{1:{[requestedTombstone]:4,b:5}});
  assert.deepEqual(requestedKept.putts,{1:{[requestedTombstone]:2,b:2}});
  const requestedAdminValues=[
    await scalar("select settings from public.competition_definitions where id=$1",[requestedCompetition]),
    await scalar("select summary from public.admin_import_jobs where id=$1",[requestedImport]),
    await scalar("select payload from public.admin_catalog_revisions where id=$1",[requestedRevision]),
    ...Object.values((await q("select before_state,after_state from public.admin_audit_log where id=$1",[requestedAudit])).rows[0]),
  ];
  for(const value of requestedAdminValues) {
    assert.equal(JSON.stringify(value).includes(D),false,"normal requested lifecycle scrubs future Admin compound identifiers");
    assert.equal(value.player.name,"Jugador eliminado");
    assert.equal(value.player.avatarUrl,null);
    assert.equal(value.player.identityDeleted,true);
  }
  const requestedRevisionRow=(await q("select payload,preview_hash,revision_hash from public.admin_catalog_revisions where id=$1",[requestedRevision])).rows[0];
  const requestedRevisionHash=await scalar("select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from public.admin_catalog_revisions where id=$1",[requestedRevision]);
  assert.equal(requestedRevisionRow.preview_hash,requestedRevisionHash,"normal lifecycle reconciles the revision preview hash");
  assert.equal(requestedRevisionRow.revision_hash,requestedRevisionHash,"normal lifecycle reconciles the revision hash");
  await q("delete from auth.users where id=$1",[D]);
  assert.equal((await complete(normalOp,normalLease)).stage,"completed");
  await admin();
  await db.exec(`set request.jwt.claim.sub='${B}';`);
  await q("update public.admin_catalog_revisions set payload=$1::jsonb where id=$2",[requestedAdminPayload,requestedRevision]);
  const staleAdminRevision=(await q("select payload,preview_hash,revision_hash from public.admin_catalog_revisions where id=$1",[requestedRevision])).rows[0];
  assert.equal(JSON.stringify(staleAdminRevision.payload).includes(D),false,"later Admin draft update cannot restore a deleted UUID");
  assert.equal(staleAdminRevision.payload.player.name,"Jugador eliminado");
  assert.equal(staleAdminRevision.payload.player.avatarUrl,null);
  const staleAdminRevisionHash=await scalar("select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from public.admin_catalog_revisions where id=$1",[requestedRevision]);
  assert.equal(staleAdminRevision.preview_hash,staleAdminRevisionHash);
  assert.equal(staleAdminRevision.revision_hash,staleAdminRevisionHash);
  const staleInsertedRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,payload,preview_hash,created_by)
    values('BALL','qa-stale-deleted-revision','GLOBAL',1,$1::jsonb,$2,$3) returning id`,[requestedAdminPayload,HASH,B]);
  const staleInserted=(await q("select payload,preview_hash from public.admin_catalog_revisions where id=$1",[staleInsertedRevision])).rows[0];
  assert.equal(JSON.stringify(staleInserted.payload).includes(D),false,"later Admin draft insert cannot restore a deleted UUID");
  assert.equal(staleInserted.payload.player.name,"Jugador eliminado");
  assert.equal(staleInserted.preview_hash,await scalar("select encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') from public.admin_catalog_revisions where id=$1",[staleInsertedRevision]));
  await q("update public.admin_catalog_revisions set payload=$1::jsonb where id=$2",[JSON.stringify({
    entity:{id:"course-la-vista",name:"La Vista Country Club",createdBy:D,courseRating:72.4},
    invitation:{id:"invite-1",name:"Weekend Group",inviteeId:D},
  }),requestedRevision]);
  const provenanceOnlyAdmin=await scalar("select payload from public.admin_catalog_revisions where id=$1",[requestedRevision]);
  assert.equal(provenanceOnlyAdmin.entity.createdBy ?? null,null,"deleted Admin provenance is unlinked");
  assert.equal(provenanceOnlyAdmin.entity.name,"La Vista Country Club","provenance deletion preserves the catalog entity name");
  assert.equal(provenanceOnlyAdmin.entity.courseRating,72.4,"provenance deletion preserves catalog data");
  assert.equal(provenanceOnlyAdmin.entity.identityDeleted,undefined,"provenance-only object is not mislabeled as a deleted player");
  assert.equal(provenanceOnlyAdmin.invitation.inviteeId ?? null,null,"deleted relation endpoint is unlinked");
  assert.equal(provenanceOnlyAdmin.invitation.name,"Weekend Group","relation endpoint deletion preserves entity name");
  assert.equal(provenanceOnlyAdmin.invitation.identityDeleted,undefined);
  await q("update public.admin_catalog_revisions set payload=$1::jsonb where id=$2",[JSON.stringify({
    player:{accountUserId:D.toUpperCase(),name:"UPPERCASE_ADMIN_PII",avatarUrl:"uppercase-admin-avatar"},
  }),requestedRevision]);
  const uppercaseAdmin=await scalar("select payload from public.admin_catalog_revisions where id=$1",[requestedRevision]);
  assert.equal(uppercaseAdmin.player.name,"Jugador eliminado","uppercase Admin identity-key-only update loses its name");
  assert.equal(uppercaseAdmin.player.avatarUrl,null);
  assert.equal(uppercaseAdmin.player.accountUserId ?? null,null);
  assert.equal(uppercaseAdmin.player.identityDeleted,true);
  const adminTombstone=await scalar("select private.account_deleted_identity_token($1,$2)",[`admin_catalog_revisions:${requestedRevision}`,D]);
  await q("update public.admin_catalog_revisions set payload=$1::jsonb where id=$2",[JSON.stringify({
    player:{id:`account:${adminTombstone}`,name:"RESTORED_ADMIN_PII",avatarUrl:"restored-admin-avatar",identityDeleted:true},
  }),requestedRevision]);
  const tombstoneOnlyAdmin=await scalar("select payload from public.admin_catalog_revisions where id=$1",[requestedRevision]);
  assert.equal(tombstoneOnlyAdmin.player.name,"Jugador eliminado","tombstone-only Admin update cannot restore a deleted name");
  assert.equal(tombstoneOnlyAdmin.player.avatarUrl,null,"tombstone-only Admin update cannot restore a deleted avatar");

  const staleRoundPlayer=await scalar(`insert into public.round_players_cloud(round_id,local_player_id,name)
    values($1,$2,'Requested private restored') returning id`,[requestedRound,D_PLAYER]);
  assert.deepEqual((await q("select local_player_id,name from public.round_players_cloud where id=$1",[staleRoundPlayer])).rows[0],
    {local_player_id:requestedTombstone,name:"Jugador eliminado"},"stale relational player insert is tombstoned");
  await q("update public.round_players_cloud set local_player_id=$1,name='Requested private restored again' where id=$2",[D_PLAYER,staleRoundPlayer]);
  assert.deepEqual((await q("select local_player_id,name from public.round_players_cloud where id=$1",[staleRoundPlayer])).rows[0],
    {local_player_id:requestedTombstone,name:"Jugador eliminado"},"stale relational player update is tombstoned");
  const uppercasePlayerKey=D_PLAYER.toUpperCase();
  const uppercaseTombstone=await scalar("select private.account_replace_deleted_identity_text($1,$2,$3)",[
    uppercasePlayerKey,D,`round:${requestedRound}`,
  ]);
  await q("update public.round_players_cloud set local_player_id=$1,name='UPPERCASE_RELATIONAL_PII' where id=$2",[uppercasePlayerKey,staleRoundPlayer]);
  assert.deepEqual((await q("select local_player_id,name from public.round_players_cloud where id=$1",[staleRoundPlayer])).rows[0],
    {local_player_id:uppercaseTombstone,name:"Jugador eliminado"},"uppercase relational UUID is tombstoned case-insensitively");
  await q(`insert into public.round_participants_v2(round_id,user_id,player_key,role)
    values($1,$2,$3,'SCOREKEEPER')`,[requestedRound,B,D_PLAYER]);
  await q(`insert into public.live_round_operations_v2(id,round_id,actor_id,operation_kind,player_key,hole,payload,base_version,resulting_version)
    values(gen_random_uuid(),$1,$2,'SCORE_SET',$3,1,'{}',0,1)`,[requestedRound,B,D_PLAYER]);
  await q(`insert into public.round_activity_v2(id,round_id,actor_id,event_type,player_key,hole,visibility)
    values(gen_random_uuid(),$1,$2,'SCORE_RECORDED',$3,1,'ROUND')`,[requestedRound,B,D_PLAYER]);
  await q(`insert into public.round_shots_v2(id,round_id,owner_id,player_key,hole,sequence,club_snapshot,source,started_at,operation_id)
    values(gen_random_uuid(),$1,$2,$3,1,1,'{}','MANUAL',now(),gen_random_uuid())`,[requestedRound,B,D_PLAYER]);
  await q(`insert into public.round_course_handicap_snapshots(user_id,round_id,player_key,tee_id,tee_name,index_value,index_source,slope,course_rating,course_par,course_handicap,formula_version,effective_at,calculated_at)
    values($1,'requested-shared',$2,'qa-tee','QA tee',10,'BACKYARD_MANUAL',113,72,72,10,'qa-v1',now(),now())`,[B,D_PLAYER]);
  for(const [table,column] of [["round_participants_v2","player_key"],["live_round_operations_v2","player_key"],
    ["round_activity_v2","player_key"],["round_shots_v2","player_key"],["round_course_handicap_snapshots","player_key"]]) {
    assert.equal(await scalar(`select ${column} from public.${table} where ${column}=$1 limit 1`,[requestedTombstone]),requestedTombstone,
      `${table} stale key is reconciled to the canonical tombstone`);
  }
  await q(`insert into public.round_group_snapshots_v2(round_id,source_group_name,source_group_version,selected_player_count)
    values($1,'QA stale group',1,1)`,[requestedRound]);
  await q(`insert into public.round_group_snapshot_players_v2(round_id,round_player_id,display_name_snapshot,position)
    values($1,$2,'Requested private restored',0)`,[requestedRound,staleRoundPlayer]);
  assert.equal(await scalar("select display_name_snapshot from public.round_group_snapshot_players_v2 where round_id=$1 and round_player_id=$2",[requestedRound,staleRoundPlayer]),"Jugador eliminado","stale frozen display name is scrubbed");
  await expectError(()=>q(`insert into public.player_course_tee_preferences(user_id,player_key,course_id,tee_id,source)
    values($1,$2,'qa-course-after-delete','qa-tee','PLAYER_COURSE')`,[B,D_PLAYER]),["23514"]);
  await expectError(()=>q(`insert into public.player_course_tee_preferences(user_id,player_key,course_id,tee_id,source)
    values($1,$2,'qa-course-after-delete-uppercase','qa-tee','PLAYER_COURSE')`,[B,D_PLAYER.toUpperCase()]),["23514"]);

  // A local round id is scoped, not globally unique. When a surviving user can
  // legitimately map the same id to two canonical rounds, the historical
  // migration must abort instead of choosing an arbitrary tombstone.
  const ambiguousLocalId="qa-ambiguous-local-round";
  const ambiguousRoundOne=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,$2,$2,$3::jsonb,1) returning id`,[B,ambiguousLocalId,JSON.stringify({ownerId:"b",players:[{id:"b",accountUserId:B,name:"Other Player"}]})]);
  const ambiguousRoundTwo=await scalar(`insert into public.rounds_cloud(owner_id,local_round_id,local_id,snapshot,version)
    values($1,$2,$2,$3::jsonb,1) returning id`,[LEGACY_OTHER,ambiguousLocalId,JSON.stringify({ownerId:`account:${LEGACY_OTHER}`,players:[{id:`account:${LEGACY_OTHER}`,accountUserId:LEGACY_OTHER,name:"Legacy Other"}]})]);
  await q("insert into public.round_participants_v2(round_id,user_id,player_key,role) values($1,$2,'b','SCOREKEEPER')",[ambiguousRoundTwo,B]);
  await db.exec("alter table public.round_course_handicap_snapshots disable trigger account_scrub_deleted_player_key;");
  const ambiguousHandicap=await scalar(`insert into public.round_course_handicap_snapshots(user_id,round_id,player_key,tee_id,tee_name,index_value,index_source,slope,course_rating,course_par,course_handicap,formula_version,effective_at,calculated_at)
    values($1,$2,$3,'qa-tee','QA tee',10,'BACKYARD_MANUAL',113,72,72,10,'qa-v1',now(),now()) returning id`,[B,ambiguousLocalId,D_PLAYER]);
  await db.exec("alter table public.round_course_handicap_snapshots enable trigger account_scrub_deleted_player_key;");
  await db.exec("begin");
  await expectError(()=>db.exec(tombstoneSql),["23514"]);
  await db.exec("rollback");
  assert.equal(await scalar("select player_key from public.round_course_handicap_snapshots where id=$1",[ambiguousHandicap]),D_PLAYER,
    "ambiguous historical mapping fails closed without mutating the player key");
  assert.notEqual(ambiguousRoundOne,ambiguousRoundTwo);
  await admin();
  console.log("PASS: full migration graph, historical UUID backfill, stable shared-player tombstones, scores/putts preservation, relational-only reconciliation, tee-preference cleanup, ambiguous local-round fail-closed, 17 Admin refs, Admin hash reconciliation, feedback unlink, verified-email fresh start, private courses/players deleted, nine-rating leaves removed, cross-owner club fail-closed, shared player/tournament preserved and anonymized, named FK diagnostic, requested/data_prepared retries, shared Storage rehome + private manifest, shared round snapshots, stats/equipment cascade, archive unchanged, stale-JWT RLS. Auth HTTP/Storage real Preview remains separate QA.");
} catch(error) { console.error(error.code || "ASSERTION", error.message, error.where || "", error.stack || ""); process.exitCode=1; }
finally { await db.close(); }
