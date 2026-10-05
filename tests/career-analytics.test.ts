import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {isProductEventName,sanitizeProductEventMetadata} from "../features/analytics/domain";
test("career event names reuse analytics and never accept identities, money or scorecards",()=>{
  for(const name of ["career_opened","career_tab_viewed","achievement_opened","rivalry_opened","round_opened","tournament_opened"])assert.equal(isProductEventName(name),true);
  assert.deepEqual(sanitizeProductEventMetadata({surface:"career",feature:"rivalries",opponentName:"private",balance:300,userId:"other",scorecard:{}}),{surface:"career",feature:"rivalries"});
});
test("analytics migration preserves existing events, rows and RLS and allows exactly the new events",async()=>{
  const db=new PGlite();
  try {
    await db.exec("create table public.product_usage_events_v2(id text primary key,event_name text constraint product_usage_events_v2_event_name_check check(event_name in ('round_created','old_valid_event'))); alter table public.product_usage_events_v2 enable row level security; create policy own_events on public.product_usage_events_v2 using (true); insert into public.product_usage_events_v2 values('old','old_valid_event');");
    await db.exec(readFileSync("supabase/migrations/20261005110904_career_usage_events.sql","utf8"));
    await db.exec("insert into public.product_usage_events_v2 values('new','career_opened');");
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.product_usage_events_v2")).rows[0].count,2);
    assert.equal((await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='public.product_usage_events_v2'::regclass")).rows[0].relrowsecurity,true);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from pg_policies where tablename='product_usage_events_v2'")).rows[0].count,1);
    await assert.rejects(db.exec("insert into public.product_usage_events_v2 values('bad','fake_event');"));
  }finally{await db.close();}
});
