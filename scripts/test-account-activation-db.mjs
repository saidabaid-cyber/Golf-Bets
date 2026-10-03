import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
// Real PostgreSQL, synthetic fixtures only. No network or credentials.
const db=new PGlite();
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const S='33333333-3333-4333-8333-333333333333', F='44444444-4444-4444-8444-444444444444';
const D='55555555-5555-4555-8555-555555555555', R='66666666-6666-4666-8666-666666666666';
const q=(sql,args=[])=>db.query(sql,args); const scalar=async(sql,args)=>Object.values((await q(sql,args)).rows[0])[0];
const change=(action,key,session=S,user=A)=>scalar('select public.account_activation_change_v1($1,$2,$3,$4)',[user,session,action,key]);
const status=(user=A,session=S)=>scalar('select public.account_activation_status_v1($1,$2)',[user,session]);
let checks=0; const check=(value,expected,message)=>{assert.deepEqual(value,expected,message);checks++;};
async function denied(fn,code){try{await fn();assert.fail('Expected denial');}catch(e){assert.equal(e.code,code,e.message);checks++;}}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema private;
    create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table private.account_lifecycle_state(user_id uuid primary key,account_status text constraint account_lifecycle_state_account_status_check check(account_status in ('closing','archived','deleted')),updated_at timestamptz default now());
    create table public.history(user_id uuid primary key,payload jsonb); alter table public.history enable row level security;
    grant usage on schema auth,private to authenticated,service_role; grant select,update on public.history to authenticated;
    insert into auth.users values('${A}'),('${B}'); insert into auth.sessions values('${S}','${A}',now()-interval '1 day');
    insert into public.history values('${A}','{"rounds":[73,36],"equipment":8}'),('${B}','{"rounds":[90]}');`);
  const before=await q('select * from public.history order by user_id');
  await db.exec(readFileSync('supabase/migrations/20261003154026_account_reversible_activation.sql','utf8'));
  check((await q('select * from public.history order by user_id')).rows,before.rows,'installation modifies zero application rows');
  check(await scalar('select count(*)::int from private.account_activation_events'),0,'installation creates no decisions');
  await db.exec(`grant execute on function private.account_data_access_allowed() to authenticated;
    create policy owner on public.history for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy active on public.history as restrictive for all to authenticated using(private.account_data_access_allowed()) with check(private.account_data_access_allowed());`);
  check(await status(),'active'); check(await status(B,S),'session_expired','another owner cannot claim this session');
  await db.exec('set role authenticated');
  await denied(()=>change('deactivate',D),'42501');
  await denied(()=>q('select * from private.account_activation_events'),'42501');
  await db.exec('reset role');
  check(await change('deactivate',D),'deactivated');
  check(await change('deactivate',D),'deactivated','retry does not repeat transition');
  check(await scalar('select count(*)::int from private.account_activation_events'),1);
  check(await status(),'session_expired','stale login cannot reactivate');
  await denied(()=>change('reactivate',R),'42501');
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${A}'; set request.jwt.claims='{"session_id":"${S}"}';`);
  check((await q('select * from public.history')).rows.length,0,'inactive RLS blocks read');
  check((await q("update public.history set payload='{}' returning *")).rows.length,0,'inactive RLS blocks write');
  await db.exec('reset role');
  await q('insert into auth.sessions values($1,$2,clock_timestamp()+interval \'1 millisecond\')',[F,A]);
  check(await status(A,F),'deactivated','new legitimate session sees reactivation gate');
  await denied(()=>change('reactivate',D,F),'22023','cannot reuse another action key');
  check(await change('reactivate',R,F),'active');
  check(await change('reactivate',R,F),'active','reactivation idempotent');
  await denied(()=>change('reactivate',R,S),'42501');
  check(await scalar('select count(*)::int from private.account_activation_events'),2);
  check((await q('select * from public.history order by user_id')).rows,before.rows,'rounds/equipment unchanged');
  check(await scalar('select count(*)::int from auth.users'),2,'Auth is preserved');
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${A}'; set request.jwt.claims='{"session_id":"${S}"}';`);
  check((await q('select * from public.history')).rows.length,0,'old access JWT stays denied after reactivation');
  await db.exec(`set request.jwt.claims='{"session_id":"${F}"}';`);
  check((await q('select * from public.history')).rows.length,1,'new legitimate session reads preserved history');
  await db.exec('reset role');
  for(const lifecycle of ['closing','archived','deleted']) {
    await q('insert into private.account_lifecycle_state values($1,$2,now()) on conflict(user_id) do update set account_status=excluded.account_status',[B,lifecycle]);
    check(await status(B,S),lifecycle);
    await denied(()=>change('reactivate',crypto.randomUUID(),S,B),'42501');
  }
  check((await q('select * from public.history order by user_id')).rows,before.rows);
  console.log(JSON.stringify({status:'PASS',checks,installationApplicationRowsChanged:0,remoteWrites:0}));
} finally {await db.close();}
