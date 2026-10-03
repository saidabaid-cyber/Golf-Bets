import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const db = new PGlite({ extensions: { pg_trgm } });
const A="61111111-1111-4111-8111-111111111111", B="62222222-2222-4222-8222-222222222222", C="63333333-3333-4333-8333-333333333333";
const q=(sql,args=[])=>db.query(sql,args);
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const service=()=>db.exec("reset role; reset request.jwt.claim.sub; set role service_role;");
const user=(id)=>db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
const get=()=>value("select public.get_optional_authorization_state_v2('preview')");
const resolve=(id,action,key,events)=>value("select public.resolve_optional_authorization_bundle_v2($1,$2,'optional-features-2026-10-01-v2',$3,'preview','local-db-test',$4::jsonb)",[id,action,key,JSON.stringify(events)]);
// Match the shipped versioned definitions, not new legal wording.
const events=(key,enabled)=>["financial_data","marketing"].map((subject,i)=>{
  const action=enabled?"accepted":"rejected";
  return {subject,action,documentKey:"privacy_integral",documentVersion:"2026-09-08-v6",documentHash:"c441091d44899e8b84e6dff1edd68e99cf377c60ddf9c824ff046a9a8aa78780",
    statementKey:`${subject}.${action}.2026-09-08-v6`,
    statementText:subject==="financial_data"?(enabled?"Consiento expresamente el tratamiento de datos financieros o patrimoniales necesario para registrar apuestas privadas, saldos, gastos y resultados económicos.":"No consiento el tratamiento de datos financieros o patrimoniales para apuestas privadas, saldos, gastos y resultados económicos."):(enabled?"Consiento recibir comunicaciones promocionales de The Backyard. Esta elección es opcional.":"No consiento recibir comunicaciones promocionales de The Backyard."),
    statementHash:subject==="financial_data"?(enabled?"41ddb7fa9e2c2332eb320f32dcede6158493a18ad0f61a6d8fb0ed787a25a620":"02c6e0ce2b40157048f3cf57502eaaca8cd04a2b288cafc6b87da30709e2329d"):(enabled?"3270203a4cd4b19b720d6876c637115d1eb7fd5f0febef64a19988a7c9b2cce0":"b69273f6e3ae17383a0beba18b8dbdedc0078e8a572456dac7a244b19a89f22c"),
    locale:"es-MX",origin:"onboarding",clientOccurredAt:"2026-10-01T00:00:00.000Z",idempotencyKey:`71000000-0000-4000-8000-${(i+Number(key.slice(-1))).toString().padStart(12,"0")}`};
});
const key=(n)=>`70000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let checks=0;
function pass(label){checks++;console.log("OPTIONAL_V2_DB PASS: "+label);}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create publication supabase_realtime;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('role',current_setting('request.jwt.claim.role',true)) $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid references auth.users(id),owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    -- PGlite lacks pgcrypto: test shims only, never production token generation.
    create function extensions.crypt(text,text) returns text language sql immutable as $$ select md5($1||$2) $$;
    create function extensions.gen_salt(text) returns text language sql immutable as $$ select $1 $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1),'hex') $$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select decode(md5(encode($1,'hex')),'hex') $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select substring(decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') from 1 for $1) $$;
    grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
  `);
  // Test the portable schema shipped to DEV, not the archived QA-only
  // originals retained in the migration directory for audit.
  const promotionManifest=JSON.parse(readFileSync("supabase/admin-v2-promotion-manifest.json","utf8"));
  const excluded=new Set([...promotionManifest.qaOnly,...promotionManifest.rejected]);
  for (const file of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql") && !excluded.has(name)).sort()) {
    const sql=readFileSync(`supabase/migrations/${file}`,"utf8").replace(/create extension if not exists pgcrypto(?: with schema extensions)?;/gi,"");
    try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${file}: ${error.code}: ${error.message}`); }
  }

  await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-v2-a@example.invalid',now()),($2,'qa-v2-b@example.invalid',now()),($3,'qa-v2-c@example.invalid',now())",[A,B,C]);
  await user(A);let initial=await get();assert.equal(initial.profileVisibility,"public");assert.equal(initial.socialProfilePrivacy,"PUBLIC");assert.equal(initial.resolved,false);assert.equal(initial.eligible,true);assert.equal(initial.legal.marketing.status,"missing");pass("new account public with no optional acceptance");
  await assert.rejects(()=>resolve(B,"authorize_all",key(1),events(key(1),true)),/permission denied/);pass("only authenticated server boundary may resolve another account");
  await service();const accepted=await resolve(A,"authorize_all",key(1),events(key(1),true));assert.equal(accepted.resolved,true);assert.equal(accepted.profileVisibility,"public");
  assert.ok(Object.values(accepted.scopes).every(r=>r.active));assert.ok(Object.values(accepted.sharing).every(Boolean));assert.equal(accepted.legal.marketing.status,"accepted");assert.equal(accepted.legal.financial_data.status,"accepted");pass("authorize all stores seven scopes plus separate marketing and financial evidence");
  await resolve(A,"authorize_all",key(1),events(key(1),true));assert.equal(await value("select count(*)::int from public.optional_authorization_events where user_id=$1",[A]),7);assert.equal(await value("select count(*)::int from public.legal_evidence_events where user_id=$1",[A]),2);pass("same request replay does not duplicate either ledger");
  await assert.rejects(()=>resolve(A,"decline_all",key(1),events(key(1),false)),/already_resolved/);
  const declined=await resolve(B,"decline_all",key(4),events(key(4),false));assert.equal(declined.resolved,true);assert.equal(declined.profileVisibility,"public");assert.equal(declined.socialProfilePrivacy,"PUBLIC");assert.equal(declined.socialPrivacy,"PRIVATE");assert.ok(Object.values(declined.scopes).every(r=>!r.active));assert.equal(declined.legal.marketing.status,"rejected");assert.equal(declined.legal.financial_data.status,"rejected");pass("decline all resolves without acceptance or changing public profile");
  await db.exec("reset role; create function public.qa_fail_v2_projection() returns trigger language plpgsql as $$begin raise exception 'qa projection failure'; end$$; create trigger qa_fail_v2_projection before update on public.user_preferences for each row execute function public.qa_fail_v2_projection();");
  await service();await assert.rejects(()=>resolve(C,"authorize_all",key(7),events(key(7),true)),/qa projection failure/);
  assert.equal(await value("select count(*)::int from public.legal_evidence_events where user_id=$1",[C]),0);assert.equal(await value("select count(*)::int from public.optional_authorization_bundle_receipts where user_id=$1",[C]),0);pass("failure after legal ingest rolls back all evidence and projections");
  await db.exec("reset role; drop trigger qa_fail_v2_projection on public.user_preferences; drop function public.qa_fail_v2_projection();");
  await service();assert.equal((await resolve(C,"authorize_all",key(7),events(key(7),true))).resolved,true);pass("retry after rolled-back partial attempt succeeds with same id");
  await db.exec("reset role");await q("update public.profiles set username='qa_v2_a',display_name='QA Person',name='QA Person' where id=$1",[A]);await user(A);assert.equal(await value("select public.set_my_profile_visibility('friends')"),"friends");await value("select public.set_optional_authorization_scope_v1('PERSONAL_MEMORY',false,$1)",[key(8)]);
  await service();const replay=await resolve(A,"authorize_all",key(1),events(key(1),true));assert.equal(replay.profileVisibility,"friends");assert.equal(replay.socialProfilePrivacy,"FRIENDS");assert.equal(replay.scopes.PERSONAL_MEMORY.active,false);pass("replay never restores public audience or revoked scope");
  await user(A);const reread=await get();assert.equal(reread.resolved,true);assert.equal(reread.profileVisibility,"friends");assert.equal(reread.legal.marketing.active,true);pass("fresh canonical read retains completed decision and later audience choice");
  await user(B);const separate=await get();assert.equal(separate.legal.marketing.active,false);assert.equal(separate.legal.financial_data.active,false);pass("owner isolation and rejected evidence survive fresh read");
  // Granular onboarding reuses existing purpose-specific ledgers, not a bundle.
  const D="64444444-4444-4444-8444-444444444444";
  await db.exec("reset role");await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-granular@example.invalid',now())",[D]);
  await user(D);const missing=await get();assert.equal(missing.resolved,false);assert.ok(Object.values(missing.scopes).every(s=>!s.active));pass("granular new account is entirely OFF without evidence");
  for(const scope of ["PERSONAL_MEMORY","GLOBAL_LEARNING","LOCATION_INTERNAL","NOTIFICATION_INTERNAL"])await value("select public.set_optional_authorization_scope_v1($1,true,$2)",[scope,crypto.randomUUID()]);
  await service();await q("select * from public.record_ai_processing_consent_decisions($1,'2026-09-08-v2',$2::jsonb,'onboarding')",[D,JSON.stringify(["AI_PROVIDER_PROCESSING_CONSENT","AI_IMAGE_PROCESSING_CONSENT","AI_LAUNCH_MONITOR_PROCESSING_CONSENT"].map(scope=>({scope,accepted:true})))]);
  await q("select * from public.record_legal_evidence_batch($1,'preview','local-granular',$2::jsonb)",[D,JSON.stringify(events(key(9),true))]);
  await user(D);await value("select public.set_my_notification_preferences_v1(true,true,true,true)");
  const prefs=Object.fromEntries(["shareRounds","shareAchievements","shareEquipment","shareCourses","notifyLike","notifyComment","notifyAttest","notifyFriendAchievement","notifyEquipment","notifyFriendRequest","enabledForFriends"].map(k=>[k,true]));
  await value("select public.set_my_social_activity_preferences_v1($1::jsonb)",[JSON.stringify(prefs)]);
  const granular=await get();assert.ok(Object.values(granular.scopes).every(s=>s.active));assert.ok(Object.values(granular.notifications).every(Boolean));assert.ok(Object.values(granular.sharing).every(Boolean));assert.ok(Object.values(granular.legal).every(s=>s.active));assert.equal(granular.receipt,null);assert.equal(granular.resolved,false);assert.equal(granular.eligible,false);pass("granular acceptance persists all purposes with no fabricated bundle receipt");
  await user(B);await user(D);assert.deepEqual(await get(),granular);pass("another authenticated client reads the same granular choices");
  await value("select public.set_optional_authorization_scope_v1('PERSONAL_MEMORY',false,$1)",[crypto.randomUUID()]);assert.equal((await get()).scopes.PERSONAL_MEMORY.active,false);assert.equal((await get()).scopes.AI_IMAGE_PROCESSING_CONSENT.active,true);pass("granular revocation closes only the selected purpose");

  const getMedia=()=>value("select public.get_optional_device_media_preferences_v1()");
  const setMedia=(scope,enabled,id)=>value("select public.set_optional_device_media_preference_v1($1,$2,$3)",[scope,enabled,id]);
  await user(A);const beforeMedia=await get();
  assert.deepEqual(await getMedia(),{camera:null,photos:null});pass("previous authorize-all does not fabricate camera/photo consent outside its bundle");
  const cameraId=crypto.randomUUID(),photosId=crypto.randomUUID();
  assert.equal((await setMedia("CAMERA_INTERNAL",true,cameraId)).camera.value,"enabled");
  assert.equal((await setMedia("PHOTO_LIBRARY_INTERNAL",true,photosId)).photos.value,"enabled");
  const media=await getMedia();assert.deepEqual(await get(),beforeMedia);pass("camera/photos reuse existing evidence without changing other purposes or bundle receipt");
  await setMedia("CAMERA_INTERNAL",true,cameraId);
  assert.equal(await value("select count(*)::int from public.optional_authorization_events where user_id=$1 and scope='CAMERA_INTERNAL'",[A]),1);
  await setMedia("CAMERA_INTERNAL",false,crypto.randomUUID());
  const latest=await getMedia();assert.equal(latest.camera.value,"disabled");assert.equal(latest.photos.value,"enabled");
  assert.equal((await setMedia("CAMERA_INTERNAL",true,cameraId)).camera.value,"disabled");pass("idempotent replay reads latest revocation and cannot restore an old acceptance");
  await user(B);assert.deepEqual(await getMedia(),{camera:null,photos:null});
  await user(A);assert.deepEqual(await getMedia(),latest);assert.equal(media.photos.value,"enabled");pass("reload and logout/login preserve owner media decisions and isolate other accounts");
  await assert.rejects(()=>setMedia("MARKETING",true,crypto.randomUUID()),/invalid_device_media_decision/);
  await assert.rejects(()=>setMedia("LOCATION_INTERNAL",true,crypto.randomUUID()),/invalid_device_media_decision/);
  await assert.rejects(()=>setMedia("PHOTO_LIBRARY_INTERNAL",false,photosId),/idempotency_conflict/);pass("media writer cannot accept legal/other device purposes or reuse a conflicting request");
  await db.exec("reset role; reset request.jwt.claim.sub; set role anon;");
  await assert.rejects(getMedia,/permission denied/);
  await assert.rejects(()=>setMedia("CAMERA_INTERNAL",true,crypto.randomUUID()),/permission denied/);
  await user(A);await assert.rejects(()=>q("insert into public.optional_authorization_events(user_id,scope,decision_status,policy_version,source,idempotency_key,decided_at) values($1,'CAMERA_INTERNAL','accepted','device-media-2026-10-03-v1','settings',$2,now())",[B,crypto.randomUUID()]),/permission denied/);pass("anonymous access and direct client evidence forgery remain blocked");
  console.log(JSON.stringify({status:"PASS",checks,database:"isolated PostgreSQL WASM"}));
} finally { await db.close(); }
