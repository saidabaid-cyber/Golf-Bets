import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {promotionDatabase,asUser,asOperator,privateCourse,IDS} from './helpers/admin-promotion-database';
import type {PGlite} from '@electric-sql/pglite';

async function publishCourse(db:PGlite,id:string,name:string){
 const payload={club:{id:'global-public-club',name:'Offline global club',country:'MX'},course:{id,clubId:'global-public-club',name,holes:9,active:true},tees:[],holes:[],teeHoleYardages:[]};
 const draft=(await db.query<{id:string}>("select (admin_create_revision_v1('COURSE',$1,'COURSE',$1,$2,'ADMIN_RESEARCH','Offline test','https://example.invalid','VERIFIED',now(),'HIGH',null)).id as id",[id,JSON.stringify(payload)])).rows[0].id;
 const hash=(await db.query<{preview:{previewHash:string}}>('select admin_prepare_revision_v1($1) as preview',[draft])).rows[0].preview.previewHash;
 await db.query("select admin_transition_revision_v1($1,'REVIEWED','Offline review',gen_random_uuid())",[draft]);
 await db.query("select admin_transition_revision_v1($1,'VERIFIED','Offline verification',gen_random_uuid())",[draft]);
 await db.query("select admin_publish_revision_v1($1,$2,'Offline publication',gen_random_uuid())",[draft,hash]);
 return draft;
}
test('portable manifest installs with no QA binding, preserves personal writes and audits global lifecycle',async t=>{
 const db=await promotionDatabase(true,true);
 try{
  await t.test('fresh DEV structure needs no QA project/table/configuration',async()=>{
   assert.equal((await db.query<{binding:string|null}>("select to_regclass('private.admin_mode_v2_qa_binding')::text as binding")).rows[0].binding,null);
   assert.equal((await db.query<{n:number}>('select count(*)::int n from private.admin_runtime_configuration_v2')).rows[0].n,0);
   const defs=await db.query<{definition:string}>("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'admin_%' and p.prokind='f'");
   assert.ok(defs.rows.every(r=>!r.definition.includes('gvzeymebltssgjkvksxt')));
  });
  await t.test('PLAYER keeps private creation/edits; all global Admin operations denied',async()=>{
   await privateCourse(db,'portable-private');
   assert.equal((await db.query("update golf_courses set name='Private edited' where id='portable-private' returning id")).rows.length,1);
   await assert.rejects(db.query("select admin_catalog_lifecycle_v3('COURSE','portable-private','archive','Forbidden')"),/ADMIN_REQUIRED/);
   await assert.rejects(publishCourse(db,'forged-global','Forbidden'),/ADMIN_SCOPE_REQUIRED/);
  });
  await t.test('ADMIN creates/edits global via reviewed publication, read-back and audit',async()=>{
   await asUser(db,IDS.admin);
   await publishCourse(db,'portable-global','Published global');
   await publishCourse(db,'portable-global','Edited global');
   await asUser(db,IDS.other);
   const published=await db.query<{payload:{course:{name:string}}}>("select payload from player_published_catalog_v1(array['COURSE']) where entity_id='portable-global' and status='PUBLISHED'");
   assert.equal(published.rows[0].payload.course.name,'Edited global');
   await asOperator(db);
   assert.equal((await db.query<{name:string}>("select payload->'course'->>'name' name from admin_catalog_revisions where entity_id='portable-global' and status='PUBLISHED'")).rows[0].name,'Edited global');
   assert.equal((await db.query<{n:number}>("select count(*)::int n from admin_audit_log where entity_id='portable-global' and action='PUBLISH'")).rows[0].n,2);
  });
  await t.test('ADMIN cannot archive/delete a player personal course through global tools',async()=>{
   await asUser(db,IDS.admin);
   for(const action of ['inspect','archive','delete'])await assert.rejects(db.query("select admin_catalog_lifecycle_v3('COURSE','portable-private',$1,'Offline attempt')",[action]),/PERSONAL_COURSE_NOT_GLOBAL_CATALOG/);
  });
  await t.test('ADMIN archives, deletes unused global and blocks referenced global deletion',async()=>{
   await db.query("select admin_catalog_lifecycle_v3('COURSE','portable-global','archive','Offline archival')");
   await asUser(db,IDS.super);
   assert.equal((await db.query<{state:string}>("select state from admin_catalog_lifecycle where entity_id='portable-global'")).rows[0].state,'ARCHIVED');
   await db.query("select admin_catalog_lifecycle_v3('COURSE','portable-global','delete','Offline unused deletion')");
   await asOperator(db);
   assert.equal((await db.query("select id from golf_courses where id='portable-global'")).rows.length,0);
   await db.exec("insert into golf_clubs(id,name) values('reference-club','Offline reference');insert into golf_courses(id,club_id,name,holes) values('reference-course','reference-club','Referenced',9);insert into golf_course_tees(id,course_id,name) values('reference-tee','reference-course','White')");
   await asUser(db,IDS.admin);
   const result=(await db.query<{result:{blocked:boolean}}>("select admin_catalog_lifecycle_v3('COURSE','reference-course','delete','Must preserve reference') result")).rows[0].result;
   assert.equal(result.blocked,true);
   await db.query("select admin_catalog_lifecycle_v3('COURSE','reference-course','archive','Safe archival')");
  });
  await t.test('SUPER_ADMIN audited role changes persist; ADMIN cannot escalate',async()=>{
   await asUser(db,IDS.admin);await assert.rejects(db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Offline role check',gen_random_uuid())",[IDS.other]),/SUPER_ADMIN_REQUIRED/);
   await asUser(db,IDS.super);await db.query("select admin_change_role_v2($1,'PLAYER','ADMIN','Offline assignment',gen_random_uuid())",[IDS.other]);
   await asUser(db,IDS.other);assert.equal((await db.query<{role:string}>('select private.admin_application_role_v2() role')).rows[0].role,'ADMIN');
   await asUser(db,IDS.super);await db.query("select admin_change_role_v2($1,'ADMIN','PLAYER','Offline revoke',gen_random_uuid())",[IDS.other]);
   await asUser(db,IDS.other);assert.equal((await db.query<{role:string}>('select private.admin_application_role_v2() role')).rows[0].role,'PLAYER');
  });
  await t.test('request environment is portable, operator-only and excludes TEST/SYNTHETIC',async()=>{
   await asOperator(db);
   const requestIds=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
   for(const [i,environment]of ['PRODUCTION','QA','TEST','SYNTHETIC'].entries())await db.query("insert into feedback_requests(id,user_id,category,payload,status,title,description,contextual_category,data_environment) values($1,$2,'COURSE','{}','NOT_SENT','Missing course','Offline controlled request','COURSE',$3)",[requestIds[i],IDS.player,environment]);
   await asUser(db,IDS.admin);
   const queue=async()=> (await db.query<{queue:{items:{id:string}[]}}>('select admin_simple_request_queue_v2() queue')).rows[0].queue.items.map(r=>r.id);
   assert.deepEqual(await queue(),[requestIds[0]]);
   await assert.rejects(db.query("insert into private.admin_runtime_configuration_v2(request_environment,reason) values('QA','Unauthorized configuration')"),/permission denied/);
   await assert.rejects(db.query("select admin_review_request_v2($1,'NEW','APPROVED','Wrong environment')",[requestIds[1]]),/REQUEST_NOT_AVAILABLE/);
   await db.query("select admin_review_request_v2($1,'NEW','APPROVED','Reviewed ordinary request')",[requestIds[0]]);
   await asOperator(db);await db.exec("insert into private.admin_runtime_configuration_v2(request_environment,reason) values('QA','Offline isolated request environment test')");
   await asUser(db,IDS.admin);assert.deepEqual(await queue(),[requestIds[1]]);
   await db.query("select admin_review_request_v2($1,'NEW','APPROVED','Reviewed QA request')",[requestIds[1]]);
   for(const id of requestIds.slice(2))await assert.rejects(db.query("select admin_review_request_v2($1,'NEW','APPROVED','Cannot review fixture')",[id]),/REQUEST_NOT_AVAILABLE/);
   await asOperator(db);assert.equal((await db.query<{n:number}>("select count(*)::int n from admin_audit_log where action='CONFIGURE_ADMIN_RUNTIME'")).rows[0].n,1);
  });
  await t.test('portable bet writes enforce real capabilities, publication, read-back and audit',async()=>{
   const values={engine:'skins',title:'Club Skins',description:'Supported defaults',active:true,order:1,minPlayers:2,maxPlayers:5,config:{value:50,hcpPct:100,mode:'carry'}};
   await asUser(db,IDS.player);await assert.rejects(db.query("select admin_bet_variant_operation_v3(null,'draft',$1)",[JSON.stringify(values)]),/ADMIN_REQUIRED/);
   await asUser(db,IDS.admin);
   await assert.rejects(db.query("select admin_bet_variant_operation_v3(null,'draft',$1)",[JSON.stringify({...values,engine:'arbitrary_javascript'})]),/ENGINE_REQUIRES_DEVELOPMENT/);
   await assert.rejects(db.query("select admin_bet_variant_operation_v3(null,'draft',$1)",[JSON.stringify({...values,config:{...values.config,formula:'x'}})]),/UNSUPPORTED_ENGINE_OPTION/);
   const draft=(await db.query<{draft:{id:string;variantId:string}}>("select admin_bet_variant_operation_v3(null,'draft',$1) draft",[JSON.stringify(values)])).rows[0].draft;
   const hash=(await db.query<{preview:{previewHash:string}}>("select admin_bet_variant_operation_v3(null,'preview',null,0,$1) preview",[draft.id])).rows[0].preview.previewHash;
   await db.query("select admin_bet_variant_operation_v3(null,'publish',null,0,$1,$2,'Offline reviewed publication')",[draft.id,hash]);
   await asUser(db,IDS.other);assert.equal((await db.query<{title:string}>("select title from player_bet_variants_v3() where id=$1",[draft.variantId])).rows[0].title,values.title);
   await asUser(db,IDS.admin);
   const duplicate=(await db.query<{draft:{variantId:string}}>("select admin_bet_variant_operation_v3(null,'draft',$1) draft",[JSON.stringify({...values,title:'Club Skins duplicate'})])).rows[0].draft;
   assert.notEqual(duplicate.variantId,draft.variantId);
   await db.query("select admin_bet_variant_operation_v3(null,'archive',null,0,$1,null,'Offline archive')",[draft.id]);
   await asUser(db,IDS.other);assert.equal((await db.query("select * from player_bet_variants_v3() where id=$1",[draft.variantId])).rows.length,0);
  });
 }finally{await db.close();}
});
test('portable replacements upgrade an existing QA schema without resetting its records',async()=>{
 const db=await promotionDatabase();
 try{
  await privateCourse(db,'upgrade-personal');await asOperator(db);
  const before=(await db.query<{n:number}>('select count(*)::int n from admin_audit_log')).rows[0].n;
  const manifest=JSON.parse(readFileSync('supabase/admin-v2-promotion-manifest.json','utf8')) as {toApply:string[]};
  for(const file of manifest.toApply.filter(f=>f.startsWith('20261002')))await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  assert.equal((await db.query<{n:number}>('select count(*)::int n from admin_audit_log')).rows[0].n,before);
  await asUser(db,IDS.player);assert.equal((await db.query("update golf_courses set name='Preserved upgrade' where id='upgrade-personal' returning id")).rows.length,1);
 }finally{await db.close();}
});
test('promotion SQL contains no project binding or install-time catalog/account mutations',()=>{
 const manifest=JSON.parse(readFileSync('supabase/admin-v2-promotion-manifest.json','utf8')) as {toApply:string[];rejected:string[];qaOnly:string[]};
 for(const name of manifest.toApply){
  assert.ok(!manifest.rejected.includes(name)&&!manifest.qaOnly.includes(name));
  const sql=readFileSync('supabase/migrations/'+name,'utf8');
  assert.doesNotMatch(sql,/gvzeymebltssgjkvksxt|ADMIN MODE V2 QA|admin_mode_v2_qa_binding|ISOLATED_ADMIN_QA_REQUIRED/);
  // Function bodies describe later authenticated operations. Installation is DDL only.
  const installation=sql.replace(/\$\$[\s\S]*?\$\$/g,'').replace(/--[^\n]*/g,'');
  assert.doesNotMatch(installation,/\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate|call\s+|select\s+public\.)/i,name);
 }
});
