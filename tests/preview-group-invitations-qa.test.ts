import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl=pathToFileURL(resolve("scripts/qa-preview-group-invitations.mjs")).href;
const bootstrap=`
 import assert from 'node:assert/strict';
 globalThis.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
 const {runPreviewGroupInvitationsQA}=await import(${JSON.stringify(scriptUrl)});
 const ref='bymeopxkxapfizeeqeyb';
 const env={PREVIEW_DB_REF:ref,QA_CONFIRM_ISOLATED_PREVIEW:ref,NEXT_PUBLIC_SUPABASE_URL:'https://'+ref+'.supabase.co',PREVIEW_QA_URL:'https://dev.thebackyard.com.mx',PREVIEW_QA_EXPECTED_SHA:'a'.repeat(40),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_qa_contract_only',SUPABASE_SECRET_KEY:'sb_secret_qa_contract_only'};
 const health=()=>Response.json({status:'ok',environment:'preview',buildSha:env.PREVIEW_QA_EXPECTED_SHA});
 const bindingResponse=input=>{const url=new URL(String(input));
   if(url.pathname==='/api/health')return health();
   if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/settings')return Response.json({external:{email:true}});
   if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/admin/users')return Response.json({users:[]});
   if(url.origin===env.PREVIEW_QA_URL&&url.pathname==='/')return new Response('<script src="/_next/static/group.js"></script>',{headers:{'content-type':'text/html; charset=utf-8'}});
   if(url.origin===env.PREVIEW_QA_URL&&url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
   return null;};
`;
function isolated(code:string){const result=spawnSync(process.execPath,["--input-type=module","--eval",bootstrap+code],{encoding:"utf8",timeout:30_000});assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);}

test("group invitation real QA refuses wrong refs/Production and inspects deployed bundle before creating fixtures",()=>{
  isolated(`
    let network=0,clients=0;
    for(const candidate of [{...env,VERCEL_ENV:'production'},{...env,PREVIEW_QA_URL:'https://app.thebackyard.com.mx'},
      {...env,PREVIEW_QA_URL:'https://beta.thebackyard.com.mx'},{...env,PREVIEW_QA_URL:'https://synthetic-preview-test-only.vercel.app'},
      {...env,PREVIEW_DB_REF:'zhqmlpljloumldaczcfp',QA_CONFIRM_ISOLATED_PREVIEW:'zhqmlpljloumldaczcfp'},
      {...env,PREVIEW_DB_REF:'abcdefghijklmnopqrst',QA_CONFIRM_ISOLATED_PREVIEW:'abcdefghijklmnopqrst',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'}]){
      await assert.rejects(runPreviewGroupInvitationsQA(candidate,{fetcher:async()=>{network++;},clientFactory:()=>{clients++;}}));
    }
    assert.equal(network,0);assert.equal(clients,0);
    await assert.rejects(runPreviewGroupInvitationsQA(env,{fetcher:async(input)=>new URL(String(input)).pathname==='/api/health'?health():new Response('No verified binding'),clientFactory:()=>{clients++;}}));
    assert.equal(clients,0);
  `);
});

test("group QA retains attempted run-owned fixtures on failure and never logs credentials or emails",()=>{
  isolated(`
    const logs=[];let attempted,deletes=0;
    const clientFactory=()=>({auth:{admin:{createUser:async(input)=>{attempted=input;return{data:{user:input},error:null};},deleteUser:async()=>{deletes++;}},signInWithPassword:async()=>({data:{},error:{code:'QA_LOGIN_ERROR'}})}});
    await assert.rejects(runPreviewGroupInvitationsQA(env,{fetcher:async(input)=>bindingResponse(input)||new Response('unexpected',{status:500}),clientFactory,log:value=>logs.push(JSON.parse(value))}));
    assert.equal(deletes,0);assert.equal(logs[0].fixtures,'RETAINED_NO_DELETE_AUTHORIZED');
    assert.deepEqual(logs[0].retainedQaUserIds,[attempted.id]);
    assert.ok(!JSON.stringify(logs).includes(attempted.email));assert.ok(!JSON.stringify(logs).includes(attempted.password));
  `);
});

test("group QA revalidates the canonical SHA immediately before the first Auth write",()=>{
  isolated(`
    let healthCalls=0,createCalls=0;
    const clientFactory=()=>({auth:{admin:{createUser:async()=>{createCalls++;throw Error('must not write');}}}});
    const transport=async input=>{const url=new URL(String(input));
      if(url.pathname==='/api/health'){healthCalls++;return healthCalls===1?health():Response.json({status:'ok',environment:'preview',buildSha:'b'.repeat(40)});}
      return bindingResponse(input)||new Response('unexpected',{status:500});
    };
    await assert.rejects(runPreviewGroupInvitationsQA(env,{fetcher:transport,clientFactory}),/Group invitations QA failed/);
    assert.equal(healthCalls,2);assert.equal(createCalls,0);
  `);
});

test("group QA never invokes synthetic email delivery on a configured provider or claims receipt",()=>{
  const source=readFileSync("scripts/qa-preview-group-invitations.mjs","utf8");
  assert.match(source,/assert\.equal\(typeof inbox\.emailDeliveryConfigured,"boolean"\)/);
  assert.match(source,/assert\.equal\(invite\.channel,"BACKYARD"\)/);
  assert.match(source,/if\(!emailDeliveryConfigured\)/);
  assert.doesNotMatch(source,/deleteUser\(|\/api\/account\/delete|\.delete\(/);
  assert.match(source,/emailReceipt:emailDeliveryConfigured\?"PENDING_INTERACTIVE_QA":"BLOCKED_EXTERNAL"/);
});
