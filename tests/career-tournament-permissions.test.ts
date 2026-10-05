import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
test("tournament migration grants only selected server columns, preserves RLS and never grants browser or write access",async()=>{
  const db=new PGlite(),sql=readFileSync("supabase/migrations/20261005114931_career_tournament_server_read.sql","utf8");
  try {
    await db.exec("create role service_role; create role authenticated; create role anon;");
    const grants=[...sql.matchAll(/grant select \(([\s\S]*?)\)\s+on public\.(\w+) to service_role;/g)];
    assert.equal(grants.length,4);
    for(const g of grants){const columns=g[1].split(',').map(c=>`${c.trim()} text`).join(',');await db.exec(`create table public.${g[2]}(${columns}, pin_hash text); alter table public.${g[2]} enable row level security; create policy unchanged on public.${g[2]} using(true);`);}
    await db.exec(sql);
    const permissions=(await db.query<{server:boolean;browser:boolean;anonymous:boolean;write:boolean;secret:boolean}>("select has_column_privilege('service_role','public.tournament_players','profile_id','SELECT') as server, has_column_privilege('authenticated','public.tournament_players','profile_id','SELECT') as browser, has_column_privilege('anon','public.tournament_players','profile_id','SELECT') as anonymous, has_table_privilege('service_role','public.tournament_players','INSERT') as write, has_column_privilege('service_role','public.tournament_players','pin_hash','SELECT') as secret")).rows[0];
    assert.deepEqual(permissions,{server:true,browser:false,anonymous:false,write:false,secret:false});
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from pg_policies where policyname='unchanged'")).rows[0].count,4);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from pg_class where relname in ('tournaments','tournament_players','tournament_scores','tournament_access') and relrowsecurity")).rows[0].count,4);
  }finally{await db.close();}
});
