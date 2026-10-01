import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const superId = "10000000-0000-4000-8000-000000000001", adminId = "10000000-0000-4000-8000-000000000002", playerId = "10000000-0000-4000-8000-000000000003";
const migration = (name: string) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
async function database(withSuper=true) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('role',true)$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.profiles(id uuid primary key,name text,display_name text,username text);
    create function private.account_data_access_allowed() returns boolean language sql as $$select auth.uid() is not null and coalesce(current_setting('request.test.account_active',true),'true')<>'false'$$;
    create function private.account_subject_active(id uuid) returns boolean language sql as $$select exists(select 1 from auth.users where users.id=$1)$$;
    create table public.admin_audit_log(id bigint generated always as identity primary key,actor_id uuid,actor_role text,action text,entity_type text,entity_id text,before_state jsonb,after_state jsonb,reason text,request_id uuid,created_at timestamptz default now());`);
  await db.exec(migration("20260922132057_admin_control_center_v1.sql").split("create table public.admin_catalog_revisions")[0] + "commit;");
  await db.exec(migration("20260922132140_admin_publication_workflows_v1.sql").split("create or replace function private.guard_admin_revision_v1")[0] + "commit;");
  await db.exec(migration("20261001060612_admin_mode_v2_roles.sql"));
  await db.exec(migration("20261001061219_admin_mode_v2_administrators.sql"));
  await db.exec(migration("20261001063622_admin_mode_v2_visual_publication.sql"));
  await db.exec("create table public.feedback_requests(id uuid primary key,request_status text not null default 'NEW' check(request_status in ('NEW','IN_REVIEW','RESOLVED','REJECTED')),data_environment text default 'PRODUCTION',updated_at timestamptz default now(),resolved_at timestamptz)");
  await db.exec(migration("20261001064607_admin_mode_v2_requests_security.sql"));
  await db.exec("create table admin_catalog_revisions(id uuid primary key default gen_random_uuid(),entity_type text,entity_id text,status text,payload jsonb,version int); grant select,insert on admin_catalog_revisions to authenticated; alter table admin_catalog_revisions enable row level security; create policy test_existing_scope on admin_catalog_revisions for all to authenticated using(private.admin_has_scope_v1(entity_type,'GLOBAL',null,'READ')) with check(private.admin_has_scope_v1(entity_type,'GLOBAL',null,'CREATE_DRAFT'))");
  for(const table of ['course_configurations','course_configuration_holes','course_configuration_tee_holes','course_configuration_ratings','course_local_rule_sets','course_local_rules','competition_definitions','competition_rule_sets','competition_rules','admin_import_jobs','admin_import_rows','admin_request_drafts','course_scorecard_profiles','course_scorecard_profile_tees','course_scorecard_profile_holes'])await db.exec(`create table ${table}(id uuid)`);
  await db.exec("alter table competition_rule_sets add column competition_id uuid,add column version int; alter table competition_rules add column rule_set_id uuid,add column category text,add column title text,add column engine_contract jsonb");
  await db.exec(migration("20261001065019_admin_mode_v2_authorization_guards.sql"));
  await db.query("insert into auth.users(id,email) values($1,'owner@backyard.test'),($2,'admin@backyard.test'),($3,'player@backyard.test')", [superId, adminId, playerId]);
  if(withSuper)await db.query("insert into admin_memberships(user_id,role,scope_type) values($1,'SUPER_ADMIN','GLOBAL')", [superId]);
  await db.query("insert into admin_memberships(user_id,role,scope_type) values($1,'ADMIN','GLOBAL')", [adminId]);
  return db;
}
async function act(db: PGlite, id: string) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); }
test("real Postgres role permissions deny direct writes, PLAYER, ADMIN escalation and protected SUPER_ADMIN", async () => {
  const db = await database();
  try {
    await act(db, playerId);
    await assert.rejects(db.query("select * from admin_user_directory_v2()"), /ADMIN_REQUIRED/);
    await assert.rejects(db.query("insert into admin_memberships(user_id,role,scope_type) values($1,'SUPER_ADMIN','GLOBAL')", [playerId]), /permission denied/);
    await act(db, adminId);
    await assert.rejects(db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Test',gen_random_uuid())", [playerId]), /SUPER_ADMIN_REQUIRED/);
    const directory = await db.query<{ email: string | null }>("select * from admin_user_directory_v2()");
    assert.ok(directory.rows.every(row => row.email === null));
    for(const role of ['ADMIN','COURSE_ADMIN','CATALOG_ADMIN']){
      await db.exec("reset role");await db.query("update admin_memberships set role=$1 where user_id=$2",[role,adminId]);await act(db,adminId);
      assert.equal((await db.query<{allowed:boolean}>("select private.admin_has_scope_v1('IMPORT','GLOBAL',null,'CREATE_DRAFT') as allowed")).rows[0].allowed,false);
      assert.equal((await db.query<{allowed:boolean}>("select private.admin_has_scope_v1('COURSE','GLOBAL',null,'AUDIT') as allowed")).rows[0].allowed,false);
    }
    await act(db, superId);
    await assert.rejects(db.query("select admin_change_role_v2($1,'ADMIN','PLAYER','Test',gen_random_uuid())", [superId]), /SUPER_ADMIN_PROTECTED/);
  } finally { await db.close(); }
});
test("one-time SUPER_ADMIN bootstrap requires operator privilege, a real existing identity and an empty SUPER_ADMIN grant set",async()=>{const db=await database(false);try{await act(db,adminId);await assert.rejects(db.query("select admin_bootstrap_super_v2($1,'Operador revisó identidad')",[superId]),/permission denied/);await db.exec("reset role;set role service_role");await assert.rejects(db.query("select admin_bootstrap_super_v2('99999999-0000-4000-8000-000000000000','Operador revisó identidad')"),/REAL_USER_REQUIRED/);await db.query("select admin_bootstrap_super_v2($1,'Operador revisó identidad')",[superId]);await assert.rejects(db.query("select admin_bootstrap_super_v2($1,'Otro intento de bootstrap')",[adminId]),/INITIAL_SUPER_ALREADY_PRESENT/);await act(db,superId);assert.equal((await db.query<{role:string}>("select private.admin_application_role_v2() as role")).rows[0].role,"SUPER_ADMIN");}finally{await db.close();}});
test("direct Postgres payload manipulation cannot alter engines and account lifecycle revokes scopes",async()=>{const db=await database();try{await act(db,adminId);await assert.rejects(db.query("insert into admin_catalog_revisions(entity_type,entity_id,status,payload,version) values('COMPETITION','event','DRAFT',$1,1)",[JSON.stringify({rules:[{engineContract:{formula:"arbitrary"}}]})]),/ENGINE_CHANGE_REQUIRES_DEVELOPMENT/);await db.query("insert into admin_catalog_revisions(entity_type,entity_id,status,payload,version) values('COMPETITION','event','DRAFT',$1,1)",[JSON.stringify({name:"Evento",rules:[{body:"Regla informativa"}]})]);await db.exec("select set_config('request.test.account_active','false',false)");assert.equal((await db.query<{allowed:boolean}>("select private.admin_has_scope_v1('BALL','CATALOG','equipment','PUBLISH') as allowed")).rows[0].allowed,false);assert.equal((await db.query<{role:string}>("select private.admin_application_role_v2() as role")).rows[0].role,"PLAYER");await assert.rejects(db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Revisado',gen_random_uuid())",[playerId]),/SUPER_ADMIN_REQUIRED/);}finally{await db.close();}});
test("request review is persisted and audited; PLAYER, fixture changes and stale states fail closed",async()=>{const db=await database();const id="30000000-0000-4000-8000-000000000001",qa="30000000-0000-4000-8000-000000000002";try{await db.query("insert into feedback_requests(id,data_environment) values($1,'PRODUCTION'),($2,'SYNTHETIC')",[id,qa]);await act(db,playerId);await assert.rejects(db.query("select admin_review_request_v2($1,'NEW','APPROVED','Revisado')",[id]),/ADMIN_REQUIRED/);await act(db,adminId);await assert.rejects(db.query("select admin_review_request_v2($1,'NEW','APPROVED','Revisado')",[qa]),/REQUEST_NOT_AVAILABLE/);await db.query("select admin_review_request_v2($1,'NEW','APPROVED','Revisado')",[id]);await assert.rejects(db.query("select admin_review_request_v2($1,'NEW','RESOLVED','Revisado')",[id]),/STALE_REQUEST/);await db.exec("reset role");assert.equal((await db.query<{request_status:string}>("select request_status from feedback_requests where id=$1",[id])).rows[0].request_status,"APPROVED");assert.equal((await db.query<{count:number}>("select count(*)::int as count from admin_audit_log where action='REVIEW_REQUEST'")).rows[0].count,1);}finally{await db.close();}});
test("published visual metadata persists across sessions; draft, critical payload, stale version and PLAYER publish are rejected",async()=>{
  const db=await database();
  try{
    await act(db,adminId);
    await assert.rejects(db.query("select admin_save_visual_draft_v2('BET','skins',$1,0)",[JSON.stringify({title:"Skins",active:true,order:1,icon:"⛳",engineAdapter:"fake"})]),/PROTECTED_FIELD/);
    const saved=await db.query<{draft:{id:string}}>("select admin_save_visual_draft_v2('BET','skins',$1,0) as draft",[JSON.stringify({title:"Skins del club",description:"Reglas informativas",instructions:"Texto revisado",active:true,order:1,icon:"⛳"})]);const id=saved.rows[0].draft.id;
    await db.exec("reset role;set role anon");assert.equal((await db.query("select * from player_visual_content_v2()")).rows.length,0);
    await act(db,adminId);const preview=(await db.query<{preview:{previewHash:string}}>("select admin_preview_visual_v2($1) as preview",[id])).rows[0].preview;
    await act(db,playerId);await assert.rejects(db.query("select admin_publish_visual_v2($1,$2,'Revisado')",[id,preview.previewHash]),/ADMIN_REQUIRED/);
    await act(db,adminId);await assert.rejects(db.query("select admin_publish_visual_v2($1,'wrong','Revisado')",[id]),/STALE_PREVIEW/);
    await db.query("select admin_publish_visual_v2($1,$2,'Revisado')",[id,preview.previewHash]);
    await db.exec("reset role;set role anon");const published=await db.query<{values:{title:string}}>("select * from player_visual_content_v2()");assert.equal(published.rows[0].values.title,"Skins del club");
    await assert.rejects(db.query("update admin_visual_versions set payload='{}'"),/permission denied/);
    await act(db,adminId);await assert.rejects(db.query("select admin_save_visual_draft_v2('BET','skins',$1,0)",[JSON.stringify({title:"Stale",active:true,order:1,icon:"⛳"})]),/STALE_CONTENT/);
  }finally{await db.close();}
});
test("real Postgres role changes persist for another session, audit once and reject stale/reused payloads", async () => {
  const db = await database(); const operation = "20000000-0000-4000-8000-000000000001";
  try {
    await act(db, superId);
    const args = [playerId, operation];
    await db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Asignación revisada',$2)", args);
    await db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Asignación revisada',$2)", args);
    await assert.rejects(db.query("select admin_change_role_v2($1,'PLAYER','PLAYER','Payload distinto',$2)", args), /OPERATION_REUSED/);
    await assert.rejects(db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Rol desactualizado',gen_random_uuid())", [playerId]), /ROLE_CHANGED_RELOAD/);
    await act(db, playerId);
    assert.equal((await db.query<{ role: string }>("select private.admin_application_role_v2() as role")).rows[0].role, "ADMIN");
    await db.exec("reset role");
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from admin_audit_log")).rows[0].count, 1);
    await act(db, superId);
    await db.query("select admin_change_role_v2($1,'ADMIN','PLAYER','Revocación revisada',gen_random_uuid())", [playerId]);
    await act(db, playerId);
    assert.equal((await db.query<{ role: string }>("select private.admin_application_role_v2() as role")).rows[0].role, "PLAYER");
  } finally { await db.close(); }
});
