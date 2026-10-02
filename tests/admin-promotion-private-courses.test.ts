import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {promotionDatabase,asUser,asOperator,privateCourse,IDS} from './helpers/admin-promotion-database';

test('promotion preserves PLAYER private-course ownership and rejects global writes',async t=>{
 const db=await promotionDatabase();
 try{
  await t.test('PLAYER creates and edits their private club and course',async()=>{
   await privateCourse(db);
   assert.equal((await db.query("update golf_courses set name='Edited private' where id='personal-course' returning id")).rows.length,1);
   assert.equal((await db.query("update golf_clubs set name='Edited club' where id='personal-course-club' returning id")).rows.length,1);
  });
  await t.test('PLAYER cannot edit another private course or transfer ownership/visibility',async()=>{
   await privateCourse(db,'other-private',IDS.other);await asUser(db,IDS.player);
   assert.equal((await db.query("update golf_courses set name='Unauthorized' where id='other-private' returning id")).rows.length,0);
   await assert.rejects(db.query("update golf_courses set created_by=$1 where id='personal-course'",[IDS.other]),/row-level security/);
   await assert.rejects(db.query("update golf_courses set visibility='PUBLIC' where id='personal-course'"),/row-level security/);
   await assert.rejects(db.query("update golf_courses set club_id='other-private-club' where id='personal-course'"),/row-level security/);
  });
  await t.test('PLAYER cannot create or edit global catalog or admin drafts',async()=>{
   await asOperator(db);await db.exec("insert into golf_clubs(id,name) values('global-club','Global fixture');insert into golf_courses(id,club_id,name,holes) values('global-course','global-club','Global fixture',9)");
   await asUser(db,IDS.player);
   await assert.rejects(db.query("insert into golf_courses(id,club_id,name,holes) values('forged-global','global-club','Forbidden',9)"),/row-level security/);
   assert.equal((await db.query("update golf_courses set name='Forbidden' where id='global-course' returning id")).rows.length,0);
   await assert.rejects(db.query("select admin_create_revision_v1('COURSE','forged','COURSE','forged','{}','ADMIN_MANUAL','Fixture','https://example.invalid','VERIFIED',now(),'HIGH',null)"),/ADMIN_SCOPE_REQUIRED/);
  });
  await t.test('private tees, holes and yardages retain their existing ownership path',async()=>{
   await db.exec("insert into golf_course_tees(id,course_id,name,provider) values('private-tee','personal-course','White','USER_MANUAL');insert into golf_holes(id,course_id,hole_number,par,stroke_index,provider) values('private-hole','personal-course',1,4,1,'USER_MANUAL');insert into golf_tee_hole_yardages(tee_id,hole_id,course_id,yards,provider) values('private-tee','private-hole','personal-course',350,'USER_MANUAL');insert into golf_hole_geo_features(id,hole_id,type,label,provider,latitude,longitude) values('private-geometry','private-hole','GREEN_CENTER','Own green','USER_MANUAL',20,10)");
   assert.equal((await db.query("update golf_course_tees set name='Owned tee' where id='private-tee' returning id")).rows.length,1);
   assert.equal((await db.query("update golf_holes set par=5 where id='private-hole' returning id")).rows.length,1);
   assert.equal((await db.query("update golf_tee_hole_yardages set yards=360 where tee_id='private-tee' returning tee_id")).rows.length,1);
   assert.equal((await db.query("update golf_hole_geo_features set label='Edited green' where id='private-geometry' returning id")).rows.length,1);
   await asUser(db,IDS.other);assert.equal((await db.query("update golf_course_tees set name='Forbidden' where id='private-tee' returning id")).rows.length,0);
   assert.equal((await db.query("update golf_hole_geo_features set label='Forbidden' where id='private-geometry' returning id")).rows.length,0);
  });
  await t.test('ADMIN still uses own private path but cannot directly overwrite global rows',async()=>{
   await privateCourse(db,'admin-private',IDS.admin);
   assert.equal((await db.query("update golf_courses set name='Owned admin course' where id='admin-private' returning id")).rows.length,1);
   assert.equal((await db.query("update golf_courses set name='Direct global bypass' where id='global-course' returning id")).rows.length,0);
   await assert.rejects(db.query("select admin_create_revision_v1('COURSE','personal-course','COURSE','personal-course','{}','ADMIN_MANUAL','Fixture','https://example.invalid','VERIFIED',now(),'HIGH',null)"),/PERSONAL_COURSE_NOT_GLOBAL_CATALOG/);
   await assert.rejects(db.query("select admin_create_revision_v1('COURSE','new-global','COURSE','new-global',$1,'ADMIN_MANUAL','Fixture','https://example.invalid','VERIFIED',now(),'HIGH',null)",[JSON.stringify({clubId:'personal-course-club'})]),/PERSONAL_COURSE_NOT_GLOBAL_CATALOG/);
  });
 }finally{await db.close();}
});

test('reproduction: rejected guard blocks PLAYER; portable replacement restores only personal access',async()=>{
 const db=await promotionDatabase(false);
 try{
  await asUser(db,IDS.player);
  await assert.rejects(db.query("insert into golf_clubs(id,name,provider,visibility,created_by) values('before-club','Old guard','USER_MANUAL','PRIVATE',$1)",[IDS.player]),/row-level security/);
  await asOperator(db);await db.exec(readFileSync('supabase/migrations/20261002034131_admin_v2_portable_authorization.sql','utf8'));
  await privateCourse(db,'after-correction');
  assert.equal((await db.query("update golf_courses set name='Restored personal edit' where id='after-correction' returning id")).rows.length,1);
  await assert.rejects(db.query("insert into golf_clubs(id,name,created_by) values('after-global','Still forbidden',$1)",[IDS.player]),/row-level security/);
 }finally{await db.close();}
});
