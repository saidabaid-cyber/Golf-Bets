import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// PostgreSQL/WASM only; no remote credentials, network or real users.
const db = new PGlite({ extensions: { pg_trgm } });
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const REBORN="33333333-3333-4333-8333-333333333333";
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
  // Remote QA has this email-consent surface even though it predates the
  // reconstructed local migration ledger. The lifecycle function discovers it
  // dynamically so local and deployed schemas follow the same fresh-start rule.
  await db.exec(`create table public.marketing_waitlist(
    id uuid primary key default gen_random_uuid(),email text not null,name text,consent_privacy boolean not null default false
  );`);
  assert.equal(await scalar("select has_function_privilege('authenticated','private.account_lifecycle_context_actor()','EXECUTE')"),false,"lease context is not client-callable");
  assert.equal(await scalar("select has_function_privilege('service_role','private.account_lifecycle_context_actor()','EXECUTE')"),true,"trusted lifecycle worker can validate its lease context");
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
    values('COURSE','qa-delete-course','GLOBAL',1,$2::jsonb,$3,$3,$1,$1,$1,$1) returning id`,[A,JSON.stringify({created_by:A,email:"qa-a@example.invalid",name:"Private Admin"}),HASH]);
  const publishedRevision=await scalar(`insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,version,status,payload,preview_hash,revision_hash,created_by,published_by)
    values('BALL','qa-delete-ball','GLOBAL',1,'PUBLISHED',$2::jsonb,$3,$3,$1,$1) returning id`,[A,JSON.stringify({created_by:A,email:"qa-a@example.invalid",name:"Published private attribution"}),HASH]);
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
  assert.equal(kept.snapshot.players[1].name,"Other Player"); assert.deepEqual(kept.snapshot.scores,{1:{a:4,b:5}});
  assert.equal(kept.snapshot.groupOrigin.selectedMembers[0].name,"Jugador eliminado");
  assert.equal(Number(await scalar("select count(*) from public.groups_v2 where id=$1",[group])),1);
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
  console.log("PASS: full migration graph, 17 Admin refs, Admin hash reconciliation, feedback unlink, verified-email fresh start, private courses/players deleted, nine-rating leaves removed, cross-owner club fail-closed, shared player/tournament preserved and anonymized, named FK diagnostic, data_prepared retry, shared Storage rehome + private manifest, shared round snapshots, stats/equipment cascade, archive unchanged, stale-JWT RLS. Auth HTTP/Storage real Preview remains separate QA.");
} catch(error) { console.error(error.code || "ASSERTION", error.message, error.where || ""); process.exitCode=1; }
finally { await db.close(); }
