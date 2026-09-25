import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl = pathToFileURL(resolve("scripts/qa-preview-statistics.mjs")).href;
const bootstrap = `
  import assert from 'node:assert/strict';
  globalThis.fetch = async () => { throw new Error('REAL_NETWORK_FORBIDDEN_IN_TEST'); };
  const { previewStatisticsConfig, credentialBoundFetch, verifyPreviewBundleBinding, runPreviewStatisticsQA } = await import(${JSON.stringify(scriptUrl)});
  const ref = 'bymeopxkxapfizeeqeyb';
  const env = { PREVIEW_DB_REF:ref, QA_CONFIRM_ISOLATED_PREVIEW:ref,
    NEXT_PUBLIC_SUPABASE_URL:'https://' + ref + '.supabase.co',
    PREVIEW_QA_URL:'https://dev.thebackyard.com.mx', PREVIEW_QA_EXPECTED_SHA:'a'.repeat(40),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_qa_contract_test_only',
    SUPABASE_SECRET_KEY:'sb_secret_qa_contract_test_only' };
  const health = () => Response.json({status:'ok',environment:'preview',buildSha:env.PREVIEW_QA_EXPECTED_SHA});
  const databaseProof = async(input) => {
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/settings')return Response.json({external:{email:true,google:true}});
    if(url.pathname==='/auth/v1/admin/users')return Response.json({users:[]});
    return Response.json({code:'NOT_FOUND'},{status:404});
  };
`;

function isolatedScript(body: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap + body], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test("remote statistics QA refuses shared DB, Production/aliases, ambiguous URLs and unbound keys before network", () => {
  isolatedScript(`
    assert.equal(previewStatisticsConfig(env).projectRef, ref);
    const rejected = [
      {}, { ...env, PREVIEW_DB_REF:'zhqmlpljloumldaczcfp', QA_CONFIRM_ISOLATED_PREVIEW:'zhqmlpljloumldaczcfp', NEXT_PUBLIC_SUPABASE_URL:'https://zhqmlpljloumldaczcfp.supabase.co' },
      { ...env, PREVIEW_DB_REF:'abcdefghijklmnopqrst', QA_CONFIRM_ISOLATED_PREVIEW:'abcdefghijklmnopqrst', NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co' },
      {...env, QA_CONFIRM_ISOLATED_PREVIEW:undefined}, {...env, VERCEL_ENV:'production'}, {...env, VERCEL:'1'},
      {...env, PREVIEW_QA_EXPECTED_SHA:undefined}, {...env, PREVIEW_QA_EXPECTED_SHA:'abc'},
      {...env, NEXT_PUBLIC_SUPABASE_URL:'https://differentprojectxxxx.supabase.co'},
      {...env, NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL + '?redirect=1'},
      {...env, NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'},
      {...env, NEXT_PUBLIC_SUPABASE_URL:'https://user:secret@' + ref + '.supabase.co'},
      {...env, NEXT_PUBLIC_SUPABASE_URL:'http://' + ref + '.supabase.co'},
      {...env, PREVIEW_QA_URL:'https://app.thebackyard.com.mx'}, {...env, PREVIEW_QA_URL:'https://beta.thebackyard.com.mx'},
      {...env, PREVIEW_QA_URL:'https://synthetic-project-test-only.vercel.app'},
      {...env, PREVIEW_QA_URL:'https://synthetic-branch-test-only.vercel.app'},
      {...env, PREVIEW_QA_URL:env.PREVIEW_QA_URL + '/profile'},
      {...env, PREVIEW_QA_URL:env.PREVIEW_QA_URL + '?token=bad'},
      {...env, PREVIEW_QA_URL:env.PREVIEW_QA_URL + ':443/'},
      {...env, PREVIEW_QA_URL:env.PREVIEW_QA_URL + '/a/../'},
      {...env, PREVIEW_QA_URL:'https://DEV.thebackyard.com.mx/'},
      {...env, PREVIEW_QA_URL:' ' + env.PREVIEW_QA_URL},
      {...env, SUPABASE_SECRET_KEY:undefined}, {...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:undefined},
      {...env, SUPABASE_SECRET_KEY:'sb_publishable_wrong_role_of_key'},
    ];
    for (const value of rejected) assert.throws(() => previewStatisticsConfig(value));
    const jwt = claims => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.testsignature';
    assert.equal(previewStatisticsConfig({...env, SUPABASE_SECRET_KEY:jwt({ref,role:'service_role'})}).projectRef, ref);
    assert.throws(() => previewStatisticsConfig({...env, SUPABASE_SECRET_KEY:jwt({ref:'zhqmlpljloumldaczcfp',role:'service_role'})}));
    let called = false;
    await assert.rejects(runPreviewStatisticsQA({...env, QA_CONFIRM_ISOLATED_PREVIEW:''}, { fetcher:async()=>{called=true;}, clientFactory:()=>{called=true;} }));
    assert.equal(called,false);
  `);
});

test("remote statistics QA never forwards credentials to another origin or follows redirects", () => {
  isolatedScript(`
    let calls=0;
    const safe=credentialBoundFetch(env.NEXT_PUBLIC_SUPABASE_URL,async(input,init)=>{
      calls++; assert.equal(init.redirect,'error'); assert.ok(init.signal);
      return new Response('{}',{status:200});
    });
    await safe(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/users',{headers:{authorization:'Bearer fake-secret'}});
    assert.equal(calls,1);
    await assert.rejects(safe('https://example.com',{headers:{authorization:'Bearer fake-secret'}}),/destination mismatch/);
    await assert.rejects(safe('https://user:secret@'+ref+'.supabase.co/auth/v1'),/destination mismatch/);
    await assert.rejects(safe('blob:'+env.NEXT_PUBLIC_SUPABASE_URL+'/synthetic'),/destination mismatch/);
    assert.equal(calls,1);
    let renders=0,delivered='';
    const alternating={toString:()=>++renders===1?env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/token':'https://attacker.invalid/collect'};
    const immutable=credentialBoundFetch(env.NEXT_PUBLIC_SUPABASE_URL,async(input)=>{delivered=String(input);return new Response('{}',{status:200});});
    await immutable(alternating,{headers:{authorization:'Bearer synthetic-token'}});
    assert.equal(delivered,env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/token');assert.equal(renders,1);
    class MaskedRequest extends Request{get url(){return env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/token';}}
    await assert.rejects(immutable(new MaskedRequest('https://attacker.invalid/collect',{headers:{authorization:'Bearer synthetic-token'}})),/destination mismatch/);
    assert.equal(delivered,env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/token');
    const redirects=credentialBoundFetch(env.NEXT_PUBLIC_SUPABASE_URL,async()=>new Response(null,{status:302,headers:{location:'https://example.com'}}));
    await assert.rejects(redirects(env.NEXT_PUBLIC_SUPABASE_URL),/refused an HTTP redirect/);
  `);
});

test("remote statistics QA proves compiled Preview DB binding before creating any account", () => {
  isolatedScript(`
    const config=previewStatisticsConfig(env);
    const bundle=async(input)=>{const url=new URL(String(input));if(url.pathname==='/api/health')return health();if(url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);return new Response('<script src="/_next/static/chunks/main.js"></script>',{headers:{'content-type':'text/html'}});};
    const db=credentialBoundFetch(config.supabaseOrigin,databaseProof);
    await verifyPreviewBundleBinding(config,bundle,db);
    const appWith=extra=>async(input)=>{const url=new URL(String(input));if(url.pathname==='/api/health')return health();if(url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+extra);return new Response('<script src="/_next/static/chunks/main.js"></script>',{headers:{'content-type':'text/html'}});};
    await assert.rejects(verifyPreviewBundleBinding(config,appWith('no-public-key'),db),/configured public key set/);
    await assert.rejects(verifyPreviewBundleBinding(config,appWith('https://zhqmlpljloumldaczcfp.supabase.co'),db),/only the isolated QA project/);
    await assert.rejects(verifyPreviewBundleBinding(config,appWith('https://ZHQMLPLJLOUMLDACZCFP.supabase.co'),db),/only the isolated QA project/);
    await assert.rejects(verifyPreviewBundleBinding(config,appWith('sb_publishable_unconfigured_key_material'),db),/unconfigured public key/);
    await assert.rejects(verifyPreviewBundleBinding(config,appWith('sb_secret_privileged_key_material'),db),/privileged credential/);
    const jwt=claims=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic_signature';
    await assert.rejects(verifyPreviewBundleBinding(config,appWith(jwt({ref,role:'authenticated',sub:'synthetic-user'})),db),/privileged credential/);
    await assert.rejects(verifyPreviewBundleBinding(config,appWith(jwt({ref:'zhqmlpljloumldaczcfp',role:'anon'})),db),/another Supabase project/);
    await assert.rejects(verifyPreviewBundleBinding(config,async(input)=>new URL(String(input)).pathname==='/api/health'?health():new Response('<html>No DB URL exposed</html>',{headers:{'content-type':'text/html'}}),db),/no inspectable Next\.js client chunk/);
    await assert.rejects(verifyPreviewBundleBinding(config,async(input)=>new URL(String(input)).pathname==='/api/health'?health():Response.json({value:env.NEXT_PUBLIC_SUPABASE_URL}),db),/did not return HTML/);
    await assert.rejects(verifyPreviewBundleBinding(config,async(input)=>new URL(String(input)).pathname==='/api/health'?Response.json({status:'ok',environment:'preview',buildSha:'b'.repeat(40)}):new Response(env.NEXT_PUBLIC_SUPABASE_URL),db),/health identity/);
    const badPublic=credentialBoundFetch(config.supabaseOrigin,async(input)=>new URL(String(input)).pathname==='/auth/v1/settings'?Response.json({code:'INVALID_KEY'},{status:401}):Response.json({users:[]}));
    await assert.rejects(verifyPreviewBundleBinding(config,bundle,badPublic),/public key did not authenticate/);
    const badAdmin=credentialBoundFetch(config.supabaseOrigin,async(input)=>new URL(String(input)).pathname==='/auth/v1/settings'?Response.json({external:{email:true}}):Response.json({code:'INVALID_KEY'},{status:401}));
    await assert.rejects(verifyPreviewBundleBinding(config,bundle,badAdmin),/admin key did not authenticate/);
    let created=false;
    await assert.rejects(runPreviewStatisticsQA(env,{fetcher:async(input)=>new URL(String(input)).pathname==='/api/health'?health():new Response('<html>unverified</html>'),clientFactory:()=>{created=true;}}));
    assert.equal(created,false);
  `);
});

test("remote statistics QA runner executes zero/data/reload/cutoff and scoped cleanup with synthetic transport (not cloud proof)", () => {
  isolatedScript(`
    const users = new Map([['existing-user',{id:'existing-user',email:'unrelated@example.invalid',app_metadata:{}}]]);
    const rounds=new Map(),markers=new Map(),requests=new Map();
    const logs=[]; let creates=0, resetCalls=0, cleanupCalls=0;
    const clientFactory=(url,key)=>({auth:{admin:{
      createUser:async(input)=>{creates++;users.set(input.id,{...input,app_metadata:input.app_metadata});return {data:{user:users.get(input.id)},error:null};},
      getUserById:async(id)=>users.has(id)?{data:{user:users.get(id)},error:null}:{data:{user:null},error:{status:404}},
      deleteUser:async()=>{throw new Error('normal cleanup should use real account endpoint');}
    },signInWithPassword:async({email,password})=>{
      const user=[...users.values()].find(item=>item.email===email&&item.password===password);
      return user?{data:{user,session:{access_token:'qa-token-'+user.id}},error:null}:{data:{},error:{status:400}};
    }},from:(table)=>{
      assert.equal(key,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'reset readback must use authenticated owner, not admin');
      const filters={};const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q;},single:async()=>{
        const stamp=table==='user_statistics_resets'?markers.get(filters.user_id):requests.get(filters.user_id+':'+filters.request_id);
        return stamp?{data:{reset_at:stamp,strategy:'RESET_FROM_DATE'},error:null}:{data:null,error:{status:404}};
      }};return q;
    }});
    const transport=async(input,init={})=>{
      const url=new URL(String(input));
      assert.equal(init.redirect,'error');
      if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL){
        if(url.pathname==='/auth/v1/settings')return Response.json({external:{email:true,google:true}});
        if(url.pathname==='/auth/v1/admin/users')return Response.json({users:[]});
      }
      if(url.pathname==='/api/health')return health();
      if(url.pathname==='/')return new Response('<script src="/_next/static/chunks/main.js"></script>',{headers:{'content-type':'text/html'}});
      if(url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      const token=init.headers.authorization;
      const id=token.slice('Bearer qa-token-'.length);assert.ok(users.has(id));
      const body=init.body?JSON.parse(init.body):null;
      if(url.pathname==='/api/cloud/rounds'){
        if(init.method==='POST'){rounds.set(id,[...(rounds.get(id)||[]),body.round]);return Response.json({roundId:body.round.id},{status:201});}
        return Response.json({rounds:rounds.get(id)||[]});
      }
      if(url.pathname==='/api/account/statistics'){
        if(init.method==='DELETE'){
          resetCalls++;assert.equal(body.confirmation,'ELIMINAR');
          const key=id+':'+body.requestId;
          if(!requests.has(key)){const stamp=new Date().toISOString();requests.set(key,stamp);markers.set(id,stamp);}
          return Response.json({resetAt:markers.get(id),strategy:'RESET_FROM_DATE',requestId:body.requestId});
        }
        return Response.json({resetAt:markers.get(id)||null,strategy:'RESET_FROM_DATE'});
      }
      if(url.pathname==='/api/account/delete'){
        cleanupCalls++;assert.equal(body.confirmation,'ELIMINAR');assert.equal(body.dataPolicy,'delete_golf_data');
        assert.equal(users.get(id).app_metadata.qa_run_id.length,36);users.delete(id);
        return Response.json({ok:true,deleted:true,archived:false});
      }
      throw new Error('Unexpected QA path');
    };
    const result=await runPreviewStatisticsQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))});
    assert.equal(creates,2);assert.equal(resetCalls,3);assert.equal(cleanupCalls,2);
    assert.deepEqual([...users.keys()],['existing-user']);
    assert.equal(result.passed.length,7);assert.equal(logs[0].cleanup,'COMPLETE');
    assert.deepEqual(result.retainedQaUserIds,[]);
    assert.ok(!JSON.stringify(logs).includes('qa-token-'));
    assert.ok(!JSON.stringify(logs).includes('sb_secret_'));
  `);
});

test("remote statistics QA --check-config validates offline without outputting keys", () => {
  const ref = "bymeopxkxapfizeeqeyb";
  const result = spawnSync(process.execPath, ["scripts/qa-preview-statistics.mjs", "--check-config"], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, VERCEL: "", VERCEL_ENV: "", PREVIEW_DB_REF: ref, QA_CONFIRM_ISOLATED_PREVIEW: ref,
      NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, PREVIEW_QA_URL: "https://dev.thebackyard.com.mx", PREVIEW_QA_EXPECTED_SHA: "a".repeat(40),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_qa_contract_test_only", SUPABASE_SECRET_KEY: "sb_secret_qa_contract_test_only" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).network, "NOT_RUN");
  assert.doesNotMatch(result.stdout, /sb_secret|sb_publishable|password|Bearer/);
});

test("remote statistics QA refuses cleanup when read-back cannot prove this run owns the exact account", () => {
  isolatedScript(`
    let attempted,deleted=0;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async()=>({data:{user:{...attempted,app_metadata:{qa_run_id:'another-run'}}},error:null}),
      deleteUser:async()=>{deleted++;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400}})}});
    const bundle=async(input)=>{const url=new URL(String(input));if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL)return databaseProof(input);return url.pathname==='/api/health'?health():new Response(url.pathname.endsWith('.js')?env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'<script src="/_next/static/main.js"></script>',url.pathname.endsWith('.js')?{}:{headers:{'content-type':'text/html'}});};
    await assert.rejects(runPreviewStatisticsQA(env,{fetcher:bundle,clientFactory,log:value=>logs.push(JSON.parse(value))}),/Remote statistics QA failed/);
    assert.equal(deleted,0);
    assert.equal(logs[0].cleanup,'QA_ACCOUNTS_RETAINED');
    assert.deepEqual(logs[0].retainedQaUserIds,[attempted.id]);
    assert.ok(!JSON.stringify(logs).includes(attempted.password));
    assert.ok(!JSON.stringify(logs).includes(attempted.email));
  `);
});

test("remote statistics QA aborts before its first write when the branch alias SHA changes", () => {
  isolatedScript(`
    let healthCalls=0,created=0;
    const transport=async(input)=>{
      const url=new URL(String(input));
      if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL)return databaseProof(input);
      if(url.pathname==='/api/health')return Response.json({status:'ok',environment:'preview',buildSha:(++healthCalls===1?env.PREVIEW_QA_EXPECTED_SHA:'b'.repeat(40))});
      if(url.pathname==='/')return new Response('<script src="/_next/static/main.js"></script>',{headers:{'content-type':'text/html'}});
      if(url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      throw new Error('unexpected');
    };
    const clientFactory=()=>({auth:{admin:{
      createUser:async()=>{created++;throw new Error('must not write');},
      getUserById:async()=>({data:{user:null},error:{status:404}}),
    }}});
    await assert.rejects(runPreviewStatisticsQA(env,{fetcher:transport,clientFactory,log:()=>{}}),/Remote statistics QA failed/);
    assert.equal(created,0);assert.equal(healthCalls,2);
  `);
});
