import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("server notification grants are column-limited, retry-safe and preserve recipient RLS (PostgreSQL)",{timeout:40_000},async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.notification_preferences_v2(user_id uuid,event_type text,in_app boolean default true,push boolean default false,updated_at timestamptz default now(),primary key(user_id,event_type));
      create table public.notification_events_v2(id uuid primary key,recipient_id uuid,event_type text,resource_type text,resource_id text,created_at timestamptz default now(),read_at timestamptz,unique(recipient_id,id));
      alter table public.notification_preferences_v2 enable row level security;
      alter table public.notification_events_v2 enable row level security;
      grant select on public.notification_events_v2 to authenticated; grant update(read_at) on public.notification_events_v2 to authenticated;
      grant select,insert,update on public.notification_preferences_v2 to authenticated;
      create policy recipient on public.notification_events_v2 for select to authenticated using(recipient_id=current_setting('qa.account')::uuid);
      create policy recipient_read on public.notification_events_v2 for update to authenticated using(recipient_id=current_setting('qa.account')::uuid) with check(recipient_id=current_setting('qa.account')::uuid);
      create policy owner on public.notification_preferences_v2 to authenticated using(user_id=current_setting('qa.account')::uuid) with check(user_id=current_setting('qa.account')::uuid);
      insert into public.notification_preferences_v2(user_id,event_type,in_app,push) values('11111111-1111-4111-8111-111111111111','round_started',true,true);
    `);
    const sql=readFileSync("supabase/migrations/20261005143022_notification_server_delivery_permissions.sql","utf8");
    await db.exec(sql);await db.exec(sql);
    await db.exec("set role service_role");
    const result=await db.query("select user_id,in_app from public.notification_preferences_v2 where event_type='round_started'");assert.equal(result.rows.length,1);
    await assert.rejects(db.query("select push from public.notification_preferences_v2"),/permission denied/);
    const insert=`insert into public.notification_events_v2(id,recipient_id,event_type,resource_type,resource_id) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','round_started','ROUND','33333333-3333-4333-8333-333333333333') on conflict(recipient_id,id) do nothing`;
    await db.exec(insert);await db.exec(insert);
    await assert.rejects(db.query("select resource_id from public.notification_events_v2"),/permission denied/);
    await assert.rejects(db.exec("update public.notification_events_v2 set read_at=now()"),/permission denied/);
    await db.exec("reset role; select set_config('qa.account','11111111-1111-4111-8111-111111111111',false); set role authenticated");
    assert.equal((await db.query("select * from public.notification_events_v2")).rows.length,1);
    await db.exec("update public.notification_events_v2 set read_at='2026-10-05T12:00:00Z'");
    await db.exec("reset role; set role service_role");await db.exec(insert);
    await db.exec("reset role; set role authenticated");
    assert.ok((await db.query<{read_at:string}>("select read_at from public.notification_events_v2")).rows[0].read_at);
    await db.exec("reset role; select set_config('qa.account','44444444-4444-4444-8444-444444444444',false); set role authenticated");
    assert.equal((await db.query("select * from public.notification_events_v2")).rows.length,0);
    await db.exec("reset role; set role anon");await assert.rejects(db.query("select * from public.notification_events_v2"),/permission denied/);
  }finally{await db.close();}
});
