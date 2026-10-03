import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as security from "../lib/backyard-ai/server/http-security";
import { parseAccountActivation, requestAccountActivation } from "../lib/account-activation";

const OWNER="11111111-1111-4111-8111-111111111111",SESSION="22222222-2222-4222-8222-222222222222",KEY="33333333-3333-4333-8333-333333333333";
const TOKEN=`header.${Buffer.from(JSON.stringify({session_id:SESSION})).toString("base64url")}.signature`;
type Route=(request:Request)=>Promise<Response>;
function fixture(options:{authenticated?:boolean;missing?:boolean;state?:string;signOutError?:boolean}={}) {
  const calls:Array<{name:string;args?:Record<string,unknown>}> = []; let signouts=0;
  const authenticated=options.authenticated!==false;
  const admin={rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});if(options.missing)return{data:null,error:{code:"PGRST202"}};
    return {data:name.includes("change") ? args.requested_action==="deactivate"?"deactivated":"active" : options.state||"active",error:null};
  },auth:{admin:{signOut:async(token:string,scope:string)=>{assert.equal(token,TOKEN);assert.equal(scope,"global");signouts++;return{error:options.signOutError?{}:null};}}}};
  const compiledModule={exports:{} as {GET:Route;POST:Route}};
  const source=ts.transpileModule(readFileSync("app/api/account/activation/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{module:compiledModule,exports:compiledModule.exports,Buffer,AbortSignal,require:(name:string)=>{
    if(name==="server-only")return{};
    if(name==="next/server")return{NextResponse:{json:(body:unknown,init:ResponseInit)=>Response.json(body,init)}};
    if(name.endsWith("server-auth"))return{authenticatedRequest:async()=>authenticated?{ok:true,userId:OWNER,token:TOKEN,client:{rpc:()=>({abortSignal:async()=>({data:options.state||"active",error:null})})}}:{ok:false,status:401,code:"AUTH_REQUIRED",error:"Inicia sesión"}};
    if(name.endsWith("supabase/server"))return{getSupabaseAdmin:()=>admin};
    if(name.endsWith("http-security"))return security;
    throw new Error(name);
  }});
  const request=(body:unknown)=>new Request("https://qa.example/api/account/activation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  return{...compiledModule.exports,calls,signouts:()=>signouts,request};
}
test("activation requires real authentication and never reads an arbitrary user's state",async()=>{
  const f=fixture({authenticated:false});assert.equal((await f.GET(new Request("https://qa.example/api/account/activation"))).status,401);assert.equal((await f.POST(f.request({action:"deactivate",requestId:KEY}))).status,401);assert.equal(f.calls.length,0);
});
test("deactivation RPC is owner/session bound and revokes Auth refresh sessions globally",async()=>{
  const f=fixture();const response=await f.POST(f.request({action:"deactivate",requestId:KEY}));assert.equal(response.status,200);
  assert.deepEqual({ ...f.calls[0].args },{requested_user:OWNER,requested_session:SESSION,requested_action:"deactivate",requested_id:KEY});assert.equal(f.signouts(),1);
});
test("reactivation keeps the new authenticated session and never calls deletion",async()=>{
  const f=fixture({state:"deactivated"});const response=await f.POST(f.request({action:"reactivate",requestId:KEY}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:"active",available:true});assert.equal(f.signouts(),0);assert.ok(f.calls.every(call=>!call.name.includes("lifecycle")));
});
test("tampered user/role/action and invalid key payloads are denied before mutation",async()=>{
  for(const payload of [{action:"deactivate",requestId:KEY,userId:"victim"},{action:"reactivate",requestId:KEY,role:"SUPER_ADMIN"},{action:"delete",requestId:KEY},{action:"deactivate",requestId:"bad"}]){const f=fixture();assert.equal((await f.POST(f.request(payload))).status,400);assert.equal(f.calls.length,0);}
});
test("pre-apply capability reads require proof of active legacy account; missing migration cannot execute deactivation",async()=>{
  const f=fixture({missing:true});const response=await f.GET(new Request("https://qa.example/api/account/activation"));assert.deepEqual(await response.json(),{status:"active",available:false});
  const mutation=await f.POST(f.request({action:"deactivate",requestId:KEY}));assert.equal(mutation.status,503);assert.equal((await mutation.json()).code,"PENDING_CONTROLLED_DB_APPLY");assert.equal(f.signouts(),0);
  const restricted=fixture({missing:true,state:"closing"});assert.equal((await restricted.GET(new Request("https://qa.example/api/account/activation"))).status,503);
});
test("closing/deleted/archived/stale session cannot enter the reactivation screen",async()=>{
  for(const state of ["closing","deleted","archived","session_expired"]){const f=fixture({state});assert.equal((await f.GET(new Request("https://qa.example/api/account/activation"))).status,403);}
});
test("failed session revocation cannot report complete deactivation success",async()=>{
  const f=fixture({signOutError:true});const response=await f.POST(f.request({action:"deactivate",requestId:KEY}));assert.equal(response.status,503);assert.match((await response.json()).error,/Tu cuenta está desactivada/);
});
test("client rejects malformed or inconsistent success, no local state can activate the account",async()=>{
  assert.equal(parseAccountActivation({status:"active",available:"yes"}),null);
  await assert.rejects(requestAccountActivation("token","reactivate",KEY,undefined,async()=>Response.json({status:"deactivated",available:true})));
  await assert.rejects(requestAccountActivation("token","deactivate",KEY,undefined,async()=>Response.json({status:"deactivated",available:false})));
});
