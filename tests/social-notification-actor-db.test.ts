import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',activity='33333333-3333-4333-8333-333333333333';
test('social notification trigger captures actor, deduplicates retry/unlike, honors opt-outs and preserves recipient history',{timeout:40_000},async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create schema private;create role anon;create role authenticated;
      create table notification_events_v2(id uuid primary key,recipient_id uuid,event_type text,resource_type text,resource_id text,created_at timestamptz default now(),read_at timestamptz);
      alter table notification_events_v2 enable row level security;
      create policy recipient on notification_events_v2 for select to authenticated using(recipient_id=current_setting('qa.account')::uuid);
      create policy recipient_read on notification_events_v2 for update to authenticated using(recipient_id=current_setting('qa.account')::uuid) with check(recipient_id=current_setting('qa.account')::uuid);
      grant select on notification_events_v2 to authenticated;grant update(read_at) on notification_events_v2 to authenticated;
      create table social_activities_v3(id uuid primary key,author_id uuid);
      create table social_likes_v3(activity_id uuid,user_id uuid,expected_hash text,created_at timestamptz default now(),primary key(activity_id,user_id));
      create table social_comments_v3(id uuid primary key,activity_id uuid,author_id uuid,expected_hash text,created_at timestamptz default now(),body text);
      create table social_activity_preferences_v3(user_id uuid primary key,notify_like boolean,notify_comment boolean,notify_attest boolean);
      create table user_preferences(user_id uuid primary key,notifications_enabled boolean,notification_internal_enabled boolean);
      create table notification_preferences_v2(user_id uuid,event_type text,in_app boolean,push boolean,primary key(user_id,event_type));
      insert into social_activities_v3 values('${activity}','${owner}');
      insert into social_activity_preferences_v3 values('${owner}',true,true,true);
      insert into user_preferences values('${owner}',true,true);
      insert into notification_preferences_v2 values('${owner}','like',true,false),('${owner}','comment',true,false);
      insert into social_comments_v3 values('44444444-4444-4444-8444-444444444444','${activity}','${actor}','hash','2026-10-01T12:00:00Z','legacy');
      insert into notification_events_v2 values('55555555-5555-4555-8555-555555555555','${owner}','comment','ROUND','${activity}','2026-10-01T12:00:00Z','2026-10-02T12:00:00Z');`);
    const sql=readFileSync('supabase/migrations/20261008204149_social_notification_actor_v1.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    const legacy=(await db.query<{actor_id:string;reaction_id:string;read_at:string}>('select actor_id,reaction_id,read_at from notification_events_v2')).rows[0];
    assert.equal(legacy.actor_id,actor);assert.equal(legacy.reaction_id,'44444444-4444-4444-8444-444444444444');assert.ok(legacy.read_at);
    await db.exec(`create trigger notify_like after insert on social_likes_v3 for each row execute function private.notify_social_reaction_v3();create trigger notify_comment after insert on social_comments_v3 for each row execute function private.notify_social_reaction_v3();`);
    const like=()=>db.exec(`insert into social_likes_v3 values('${activity}','${actor}','hash',now()) on conflict do nothing`);
    await like();await like();
    const notice=(await db.query<{id:string;actor_id:string}>("select * from notification_events_v2 where event_type='like'")).rows[0];assert.equal(notice.actor_id,actor);
    await db.exec(`update notification_events_v2 set read_at=now() where id='${notice.id}';delete from social_likes_v3;`);await like();
    assert.equal((await db.query("select * from notification_events_v2 where event_type='like'")).rows.length,1);assert.ok((await db.query<{read_at:string}>(`select read_at from notification_events_v2 where id='${notice.id}'`)).rows[0].read_at);
    await db.exec(`insert into social_likes_v3 values('${activity}','${owner}','hash',now())`);assert.equal((await db.query<{n:number}>('select count(*) n from notification_events_v2')).rows[0].n,2,'self-like creates no notification');
    for(const gate of ['notify_comment','in_app','master','internal']){
      await db.exec(gate==='notify_comment'?`update social_activity_preferences_v3 set notify_comment=false`:gate==='in_app'?`update notification_preferences_v2 set in_app=false where event_type='comment'`:gate==='internal'?`update user_preferences set notification_internal_enabled=false`:`update user_preferences set notifications_enabled=false`);
      await db.exec(`insert into social_comments_v3 values(gen_random_uuid(),'${activity}','${actor}','hash',now(),'muted')`);
      assert.equal((await db.query<{n:number}>('select count(*) n from notification_events_v2')).rows[0].n,2,gate);
      await db.exec(`update social_activity_preferences_v3 set notify_comment=true;update notification_preferences_v2 set in_app=true;update user_preferences set notifications_enabled=true,notification_internal_enabled=true;`);
    }
    await db.exec(`insert into social_comments_v3 values('66666666-6666-4666-8666-666666666666','${activity}','${actor}','hash',now(),'QA isolated');update social_comments_v3 set body='edited';delete from social_comments_v3 where id='66666666-6666-4666-8666-666666666666';`);
    assert.equal((await db.query<{n:number}>('select count(*) n from notification_events_v2')).rows[0].n,3,'editing/deletion keeps history, no duplicate');
    await db.exec(`select set_config('qa.account','${owner}',false);set role authenticated;update notification_events_v2 set read_at=now();`);
    assert.equal((await db.query('select * from notification_events_v2')).rows.length,3);
    await assert.rejects(db.exec(`update notification_events_v2 set actor_id='${owner}'`),/permission denied/);
    await assert.rejects(db.exec('delete from notification_events_v2'),/permission denied/);
    await db.exec(`reset role;select set_config('qa.account','${actor}',false);set role authenticated;`);assert.equal((await db.query('select * from notification_events_v2')).rows.length,0);
    await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from notification_events_v2'),/permission denied/);
  }finally{await db.close();}
});
