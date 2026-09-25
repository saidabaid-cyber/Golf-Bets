import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl = pathToFileURL(resolve("scripts/qa-preview-profile-cloud.mjs")).href;
const bootstrap = `
  import assert from 'node:assert/strict';
  globalThis.fetch = async () => { throw new Error('REAL_NETWORK_FORBIDDEN_IN_CONTRACT_TEST'); };
  const { profileCloudQaConfig, runPreviewProfileCloudQA } = await import(${JSON.stringify(scriptUrl)});
  const ref = 'bymeopxkxapfizeeqeyb';
  const env = { PREVIEW_DB_REF:ref, QA_CONFIRM_ISOLATED_PREVIEW:ref,
    NEXT_PUBLIC_SUPABASE_URL:'https://' + ref + '.supabase.co',
    PREVIEW_QA_URL:'https://dev.thebackyard.com.mx', PREVIEW_QA_EXPECTED_SHA:'a'.repeat(40),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_qa_contract_test_only',
    SUPABASE_SECRET_KEY:'sb_secret_qa_contract_test_only' };
  const health=()=>Response.json({status:'ok',environment:'preview',buildSha:env.PREVIEW_QA_EXPECTED_SHA});
  const bindingResponse=input=>{const url=new URL(String(input));
    if(url.pathname==='/api/health')return health();
    if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/settings')return Response.json({external:{email:true}});
    if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/admin/users')return Response.json({users:[]});
    if(url.origin===env.PREVIEW_QA_URL&&url.pathname==='/')return new Response('<script src="/_next/static/qa.js"></script>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if(url.origin===env.PREVIEW_QA_URL&&url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return null;};
`;

function isolatedScript(body: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap + body], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test("profile/cloud QA accepts only the exact authorized ref, canonical origin and SHA before any request", () => {
  isolatedScript(`
    assert.equal(profileCloudQaConfig(env).projectRef, ref);
    const otherRef = 'abcdefghijklmnopqrst';
    const rejected = [
      {}, {...env, PREVIEW_DB_REF:otherRef, QA_CONFIRM_ISOLATED_PREVIEW:otherRef, NEXT_PUBLIC_SUPABASE_URL:'https://'+otherRef+'.supabase.co'},
      {...env, PREVIEW_DB_REF:'zhqmlpljloumldaczcfp', QA_CONFIRM_ISOLATED_PREVIEW:'zhqmlpljloumldaczcfp', NEXT_PUBLIC_SUPABASE_URL:'https://zhqmlpljloumldaczcfp.supabase.co'},
      {...env, QA_CONFIRM_ISOLATED_PREVIEW:''}, {...env, VERCEL_ENV:'production'},
      {...env, PREVIEW_QA_EXPECTED_SHA:''},
      {...env, NEXT_PUBLIC_SUPABASE_URL:'https://'+otherRef+'.supabase.co'},
      {...env, PREVIEW_QA_URL:'https://app.thebackyard.com.mx'},
      {...env, PREVIEW_QA_URL:'https://beta.thebackyard.com.mx'},
      {...env, PREVIEW_QA_URL:'https://synthetic-project-test-only.vercel.app'},
      {...env, PREVIEW_QA_URL:'https://synthetic-branch-test-only.vercel.app'},
      {...env, PREVIEW_QA_URL:env.PREVIEW_QA_URL+'?redirect=elsewhere'},
      {...env, SUPABASE_SECRET_KEY:'sb_publishable_wrong_role_only'},
    ];
    let network=0, clients=0;
    for (const candidate of rejected) {
      assert.throws(()=>profileCloudQaConfig(candidate));
      await assert.rejects(runPreviewProfileCloudQA(candidate, {
        fetcher:async()=>{network++;throw Error('must not call');},
        clientFactory:()=>{clients++;throw Error('must not construct');}
      }));
    }
    assert.equal(network,0);assert.equal(clients,0);
  `);
});

test("profile/cloud QA inspects the deployed bundle and refuses absent/shared binding before Auth creation", () => {
  isolatedScript(`
    for(const content of ['<html>No verified binding</html>','https://zhqmlpljloumldaczcfp.supabase.co']) {
      let clients=0;
      await assert.rejects(runPreviewProfileCloudQA(env, {
        fetcher:async(input)=>new URL(String(input)).pathname==='/api/health'?health():new Response(content),
        clientFactory:()=>{clients++;throw Error('must not create Auth clients');}
      }));
      assert.equal(clients,0);
    }
    let clients=0;
    const mixed=async(input,init)=>{
      assert.equal(init.redirect,'error');
      const url=new URL(String(input));if(url.pathname==='/api/health')return health();
      return url.pathname.endsWith('.js')
        ? new Response(env.NEXT_PUBLIC_SUPABASE_URL+' https://zhqmlpljloumldaczcfp.supabase.co')
        : new Response('<script src="/_next/static/qa.js"></script>',{headers:{'content-type':'text/html; charset=utf-8'}});
    };
    await assert.rejects(runPreviewProfileCloudQA(env,{fetcher:mixed,clientFactory:()=>{clients++;}}),/does not reference only the isolated QA project/);
    assert.equal(clients,0);
  `);
});

test("profile/cloud QA cleanup requires exact ID, email AND run marker (synthetic transport only)", () => {
  isolatedScript(`
    const mismatches = [
      value=>({...value,id:'00000000-0000-4000-8000-000000000000'}),
      value=>({...value,email:'unrelated@example.invalid'}),
      value=>({...value,app_metadata:{qa_run_id:'different-run'}}),
    ];
    for (const mismatch of mismatches) {
      let attempted, deleted=0, apiDeletes=0;const logs=[];
      const clientFactory=()=>({auth:{admin:{
        createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
        getUserById:async()=>({data:{user:mismatch(attempted)},error:null}),
        deleteUser:async()=>{deleted++;return {data:{},error:null};}
      },signInWithPassword:async()=>({data:{},error:{status:400}})}});
      const transport=async(input)=>{
        if(String(input).includes('/api/account/delete'))apiDeletes++;
        return bindingResponse(input)||new Response('unexpected',{status:500});
      };
      await assert.rejects(runPreviewProfileCloudQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))}),/remote QA failed/);
      assert.equal(deleted,0);assert.equal(apiDeletes,0);
      assert.equal(logs[0].cleanup,'QA_ACCOUNTS_RETAINED');
      assert.deepEqual(logs[0].retainedQaUserIds,[attempted.id]);
      assert.ok(!JSON.stringify(logs).includes(attempted.password));
      assert.ok(!JSON.stringify(logs).includes(attempted.email));
      assert.ok(!JSON.stringify(logs).includes('sb_secret_'));
    }
  `);
});

test("profile/cloud QA removes only its proven fresh unused Auth fixture after login failure (not cloud evidence)", () => {
  isolatedScript(`
    let attempted, deleted=false;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async(id)=>{
        assert.equal(id,attempted.id);
        return deleted?{data:{user:null},error:{status:404}}:{data:{user:attempted},error:null};
      },
      deleteUser:async(id)=>{assert.equal(id,attempted.id);deleted=true;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400}})}});
    const transport=async(input)=>bindingResponse(input)||new Response('unexpected',{status:500});
    await assert.rejects(runPreviewProfileCloudQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))}),/remote QA failed/);
    assert.equal(deleted,true);assert.equal(logs[0].cleanup,'COMPLETE');
    assert.deepEqual(logs[0].retainedQaUserIds,[]);
    assert.equal(logs[0].failedAt,'CREATE_FRESH_QA_ACCOUNTS');
  `);
});

test("profile/cloud cleanup refuses a changed alias and uses only exact marker-scoped Admin deletion", () => {
  isolatedScript(`
    let attempted,deleted=false,adminDeletes=0,appDeletes=0,healthCalls=0;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async(id)=>deleted?{data:{user:null},error:{status:404,code:'user_not_found'}}:{data:{user:attempted},error:null},
      deleteUser:async(id)=>{assert.equal(id,attempted.id);adminDeletes++;deleted=true;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400,code:'invalid_credentials'}})}});
    const transport=async(input)=>{const url=new URL(String(input));
      if(url.pathname==='/api/health'){healthCalls++;return healthCalls<=2?health():Response.json({status:'ok',environment:'preview',buildSha:'b'.repeat(40)});}
      if(url.pathname==='/api/account/delete')appDeletes++;
      return bindingResponse(input)||new Response('unexpected',{status:500});
    };
    await assert.rejects(runPreviewProfileCloudQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))}),/remote QA failed/);
    assert.equal(adminDeletes,1);assert.equal(appDeletes,0);assert.equal(deleted,true);
    assert.equal(logs[0].cleanup,'COMPLETE');assert.equal(logs[0].cleanupModes[0].mode,'ADMIN_DIRECT_AFTER_ALIAS_REVALIDATION_FAILURE');
  `);
});

test("profile/cloud QA --check-config is offline and prints no credential", () => {
  const ref = "bymeopxkxapfizeeqeyb";
  const result = spawnSync(process.execPath, ["scripts/qa-preview-profile-cloud.mjs", "--check-config"], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, VERCEL: "", VERCEL_ENV: "", PREVIEW_DB_REF: ref, QA_CONFIRM_ISOLATED_PREVIEW: ref,
      NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, PREVIEW_QA_URL: "https://dev.thebackyard.com.mx", PREVIEW_QA_EXPECTED_SHA: "a".repeat(40),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_qa_contract_test_only", SUPABASE_SECRET_KEY: "sb_secret_qa_contract_test_only" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).network, "NOT_RUN");
  assert.equal(JSON.parse(result.stdout).projectRef, ref);
  assert.doesNotMatch(result.stdout, /sb_secret|sb_publishable|password|Bearer/);
});
