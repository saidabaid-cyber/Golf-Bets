import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('actual legacy CHECK fails 23514; migration preserves rows and atomically writes self-only channels without changing privacy/consent',{timeout:40_000},async()=>{
  const db=new PGlite(),id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('qa.account',true),'')::uuid$$;grant usage on schema auth to authenticated;
      create table notification_preferences_v2(user_id uuid,event_type text,in_app boolean default true,push boolean default false,updated_at timestamptz default now(),primary key(user_id,event_type),constraint notification_preferences_v2_event_type_check check(event_type in ('friend_request','friend_accepted','group_invite','round_invite','round_started','round_finished','scorecard_ready')));
      create table social_activity_preferences_v3(user_id uuid primary key,notify_like boolean default true,notify_comment boolean default true,notify_attest boolean default true,notify_friend_request boolean default true,notify_friend_achievement boolean default false,notify_equipment boolean default false,share_rounds boolean default false,updated_at timestamptz default now());
      alter table notification_preferences_v2 enable row level security;alter table social_activity_preferences_v3 enable row level security;
      create policy own on notification_preferences_v2 to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());create policy own on social_activity_preferences_v3 to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());grant select,insert,update on notification_preferences_v2,social_activity_preferences_v3 to authenticated;
      insert into notification_preferences_v2 values('${id}','friend_request',false,true,'2026-10-05'),('${other}','friend_request',true,false,'2026-10-05');insert into social_activity_preferences_v3(user_id,notify_like,share_rounds) values('${id}',false,false),('${other}',true,true);`);
    await assert.rejects(db.exec(`insert into notification_preferences_v2(user_id,event_type) values('${id}','like')`),(e:unknown)=>(e as {code:string}).code==='23514');
    const prior=(await db.query('select * from notification_preferences_v2 order by user_id')).rows;
    const sql=readFileSync('supabase/migrations/20261009000100_atomic_notification_preferences.sql','utf8');await db.exec(sql);await db.exec(sql);
    assert.deepEqual((await db.query('select * from notification_preferences_v2 order by user_id')).rows,prior);
    await db.exec(`select set_config('qa.account','${id}',false);set role authenticated;select set_my_notification_event_preference_v1('like',null,true);`);
    assert.equal((await db.query<{in_app:boolean;push:boolean}>("select * from notification_preferences_v2 where event_type='like'")).rows[0].in_app,false,'missing row inherits explicit legacy opt-out');
    await db.exec("select set_my_notification_event_preference_v1('like',true,null);");
    assert.deepEqual((await db.query<{in_app:boolean;push:boolean}>("select in_app,push from notification_preferences_v2 where event_type='like'")).rows[0],{in_app:true,push:true});
    assert.equal((await db.query<{share_rounds:boolean;notify_like:boolean}>('select share_rounds,notify_like from social_activity_preferences_v3')).rows[0].share_rounds,false);
    await db.exec("select set_my_notification_event_preference_v1('attest',false,null);select set_my_notification_event_preference_v1('attest_request',false,null);");
    assert.equal((await db.query<{notify_attest:boolean}>('select notify_attest from social_activity_preferences_v3')).rows[0].notify_attest,false);
    await db.exec("select set_my_notification_event_preference_v1('attest_request',true,null);");
    assert.equal((await db.query<{notify_attest:boolean}>('select notify_attest from social_activity_preferences_v3')).rows[0].notify_attest,true);
    assert.equal((await db.query<{in_app:boolean}>("select in_app from notification_preferences_v2 where event_type='attest'")).rows[0].in_app,false,'independent request/confirmation choices');
    await db.exec("update social_activity_preferences_v3 set notify_comment=false;");
    assert.equal((await db.query<{in_app:boolean}>("select in_app from notification_preferences_v2 where event_type='comment'")).rows[0].in_app,false,'existing settings RPC updates are mirrored in the same transaction');
    assert.equal((await db.query<{push:boolean}>("select push from notification_preferences_v2 where event_type='like'")).rows[0].push,true,'unrelated channel retained');
    await db.exec('reset role;create function fail_second_gate() returns trigger language plpgsql as $$begin raise exception \'controlled failure\';end$$;create trigger fail_gate before update on social_activity_preferences_v3 for each row execute function fail_second_gate();set role authenticated;');
    await assert.rejects(db.exec("select set_my_notification_event_preference_v1('like',false,null)"),/controlled failure/);
    assert.equal((await db.query<{in_app:boolean}>("select in_app from notification_preferences_v2 where event_type='like'")).rows[0].in_app,true,'second gate failure rolls back first write');
    await db.exec(`reset role;drop trigger fail_gate on social_activity_preferences_v3;select set_config('qa.account','${other}',false);set role authenticated;`);
    assert.equal((await db.query('select * from notification_preferences_v2')).rows.length,1,'another account cannot read choices');
    await assert.rejects(db.exec("select set_my_notification_event_preference_v1('invented',true,null)"));
    await db.exec('reset role;set role anon');await assert.rejects(db.exec("select set_my_notification_event_preference_v1('like',true,null)"),/permission denied/);
  }finally{await db.close();}
});
