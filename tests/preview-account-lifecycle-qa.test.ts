import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl = pathToFileURL(resolve("scripts/qa-preview-account-lifecycle.mjs")).href;
const bootstrap = `
  import assert from 'node:assert/strict';
  import { randomUUID } from 'node:crypto';
  globalThis.fetch = async()=>{throw new Error('REAL_NETWORK_FORBIDDEN_IN_TEST');};
  const { previewAccountConfig, runPreviewAccountQA } = await import(${JSON.stringify(scriptUrl)});
  const ref='abcdefghijklmnopqrst';
  const env={PREVIEW_DB_REF:ref,QA_CONFIRM_ISOLATED_PREVIEW:ref,NEXT_PUBLIC_SUPABASE_URL:'https://'+ref+'.supabase.co',
    PREVIEW_QA_URL:'https://golf-bets-123abc789-qa-team.vercel.app',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_qa_test_only',
    SUPABASE_SECRET_KEY:'sb_secret_qa_contract_test_only'};
`;
function isolated(body: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap + body], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test("account Preview runner reuses exact isolation checks and proves deployment binding before any account creation", () => {
  isolated(`
    assert.equal(previewAccountConfig(env).projectRef,ref);
    let touched=false;const dependencies={fetcher:async()=>{touched=true;return new Response('unverified');},clientFactory:()=>{touched=true;}};
    for(const value of [{...env,QA_CONFIRM_ISOLATED_PREVIEW:''},{...env,PREVIEW_QA_URL:'https://app.thebackyard.com.mx'},
      {...env,PREVIEW_DB_REF:'zhqmlpljloumldaczcfp',QA_CONFIRM_ISOLATED_PREVIEW:'zhqmlpljloumldaczcfp'},
      {...env,VERCEL_ENV:'production'},{...env,NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1'}]){
      await assert.rejects(runPreviewAccountQA(value,dependencies));assert.equal(touched,false);
    }
    let created=false;
    await assert.rejects(runPreviewAccountQA(env,{fetcher:async()=>new Response('unverified'),clientFactory:()=>{created=true;}}),/did not prove/);
    assert.equal(created,false);
  `);
});

test("account Preview runner executes delete/shared RLS/stale sync/archive and proof checks with synthetic transport, not cloud proof", () => {
  isolated(`
    const users=new Map([['existing-user',{id:'existing-user',email:'untouched@example.invalid',app_metadata:{}}]]);
    const rounds=new Map(),participants=new Map(),jobs=new Map(),deletedIds=new Set(),logs=[];
    let creates=0,deleteCalls=0,archiveCalls=0,adminDeletes=0;
    const ok=data=>({data,error:null});const failure=(status,code)=>({data:null,error:{status,code}});
    function scrub(round){
      for(const id of deletedIds){
        for(const player of round.snapshot.players)if(player.accountUserId===id){player.name='Jugador eliminado';player.accountUserId=null;player.avatarUrl=null;}
        if(round.owner_id===id){round.owner_id=null;round.snapshot.ownerName='Jugador eliminado';round.snapshot.accountUserId=null;}
      }
      return round;
    }
    const clientFactory=(_url,key)=>{
      const admin=key===env.SUPABASE_SECRET_KEY;let signedIn=null;
      return {auth:{admin:{
        createUser:async(input)=>{assert.ok(admin);creates++;users.set(input.id,{...input});return ok({user:users.get(input.id)});},
        getUserById:async(id)=>{assert.ok(admin);return users.has(id)?ok({user:structuredClone(users.get(id))}):failure(404,'user_not_found');},
        deleteUser:async()=>{adminDeletes++;throw new Error('Runner must not bypass lifecycle for app-populated or archived accounts');}
      },signInWithPassword:async({email,password})=>{
        const user=[...users.values()].find(u=>u.email===email&&u.password===password&&!u.banned_until);
        if(!user)return failure(400,'invalid_credentials');signedIn=user.id;return ok({user,session:{access_token:'qa-token-'+user.id}});
      }},from:table=>{
        const filters={};let action='select',payload=null;
        const execute=()=>{
          if(!admin&&users.get(signedIn)?.banned_until)return failure(403,'42501');
          if(table==='round_participants_v2'&&action==='insert'){
            assert.equal(rounds.get(payload.round_id).owner_id,signedIn);participants.set(payload.round_id,payload.user_id);return ok(null);
          }
          assert.equal(table,'rounds_cloud');const row=rounds.get(filters.id);
          if(!row)return failure(404,'PGRST116');
          if(!admin&&row.owner_id!==signedIn&&participants.get(row.id)!==signedIn)return failure(403,'42501');
          if(action==='update'){
            assert.equal(row.owner_id,signedIn);assert.equal(filters.owner_id,signedIn);
            row.snapshot=structuredClone(payload.snapshot);scrub(row);
          }
          return ok(structuredClone(row));
        };
        const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},single:async()=>execute(),
          insert:v=>{action='insert';payload=v;return q;},update:v=>{action='update';payload=v;return q;},
          then:(resolve,reject)=>Promise.resolve().then(execute).then(resolve,reject)};return q;
      }};
    };
    const transport=async(input,init={})=>{
      assert.equal(init.redirect,'error');const url=new URL(String(input));
      if(url.pathname==='/')return new Response('<script src="/_next/static/main.js"></script>');
      if(url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL);
      const body=init.body?JSON.parse(init.body):null;const token=init.headers.authorization||'';
      const id=token.startsWith('Bearer qa-token-')?token.slice('Bearer qa-token-'.length):null;
      if(url.pathname==='/api/account/delete'){
        if(body.confirmation!=='ELIMINAR'||body.userId)return Response.json({code:'INVALID_ACCOUNT_DELETE_CHOICE'},{status:400});
        const existing=jobs.get(body.requestId);
        if(existing){
          if(existing.proof!==body.recoveryToken)return Response.json({code:'AUTH_REQUIRED'},{status:401});
          return Response.json(existing.response);
        }
        assert.ok(id&&users.has(id));assert.equal(body.recoveryToken.length,64);
        const archived=body.dataPolicy==='retain_history';
        if(archived){archiveCalls++;users.get(id).banned_until='2099-01-01T00:00:00.000Z';}
        else{deleteCalls++;users.delete(id);deletedIds.add(id);for(const row of rounds.values())scrub(row);}
        const response={ok:true,deleted:!archived,archived};jobs.set(body.requestId,{proof:body.recoveryToken,response});return Response.json(response);
      }
      assert.ok(id&&users.has(id));
      if(url.pathname==='/api/equipment')return Response.json({code:'ACCOUNT_ARCHIVED'},{status:403});
      assert.equal(url.pathname,'/api/cloud/rounds');assert.equal(init.method,'POST');
      const roundId=randomUUID();rounds.set(roundId,{id:roundId,owner_id:id,snapshot:body.round});return Response.json({roundId},{status:201});
    };
    const result=await runPreviewAccountQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))});
    assert.equal(creates,3);assert.equal(deleteCalls,2);assert.equal(archiveCalls,1);assert.equal(adminDeletes,0);
    assert.equal(result.passed.length,11);assert.deepEqual(result.retainedQaUserIds,[]);assert.equal(result.archivedQaFixtures.length,1);
    assert.equal(users.size,2);assert.ok(users.has('existing-user'));
    assert.equal(logs[0].cleanup,'ONLY_INTENTIONAL_ARCHIVE_FIXTURE_RETAINED');
    assert.equal(result.archivedQaFixtures[0].roundIds.length,2);
    assert.doesNotMatch(JSON.stringify(logs),/qa-token-|sb_secret|sb_publishable|recoveryToken|@example/);
    assert.ok(logs[0].coverageExcludes.includes('Social API likes/comments/attest'));
  `);
});

test("account Preview runner never deletes an existing/unproven identity during failed setup cleanup", () => {
  isolated(`
    let attempted,deleted=0;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async()=>({data:{user:{...attempted,app_metadata:{qa_run_id:'different-run'}}},error:null}),
      deleteUser:async()=>{deleted++;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400}})}});
    const bundle=async(input)=>new Response(String(input).endsWith('.js')?env.NEXT_PUBLIC_SUPABASE_URL:'<script src="/_next/static/main.js"></script>');
    await assert.rejects(runPreviewAccountQA(env,{fetcher:bundle,clientFactory,log:value=>logs.push(JSON.parse(value))}),/Remote account QA failed/);
    assert.equal(deleted,0);assert.equal(logs[0].cleanup,'QA_CLEANUP_PENDING');
    assert.deepEqual(logs[0].retainedQaUserIds,[attempted.id]);assert.ok(!JSON.stringify(logs).includes(attempted.password));
  `);
});

test("account Preview runner default/help/check-config never execute remote writes", () => {
  for (const args of [[], ["--help"], ["--check-config"]]) {
    const ref = "abcdefghijklmnopqrst";
    const result = spawnSync(process.execPath, ["scripts/qa-preview-account-lifecycle.mjs", ...args], { encoding: "utf8", timeout: 15_000,
      env: { ...process.env, VERCEL: "", VERCEL_ENV: "", PREVIEW_DB_REF: ref, QA_CONFIRM_ISOLATED_PREVIEW: ref,
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, PREVIEW_QA_URL: "https://golf-bets-123abc789-qa-team.vercel.app",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_qa_contract_test_only", SUPABASE_SECRET_KEY: "sb_secret_qa_contract_test_only" } });
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === "--check-config") assert.equal(JSON.parse(result.stdout).network, "NOT_RUN");
    else assert.match(result.stdout, /Explicit execution/);
    assert.doesNotMatch(result.stdout, /sb_secret_|sb_publishable_|Bearer/);
  }
});
