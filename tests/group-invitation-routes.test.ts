import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as security from "../lib/backyard-ai/server/http-security";
import * as invitations from "../lib/group-invitations";
import * as templates from "../lib/frequent-templates";

const OWNER="11111111-1111-4111-8111-111111111111", OTHER="22222222-2222-4222-8222-222222222222", INVITE="33333333-3333-4333-8333-333333333333", GROUP="44444444-4444-4444-8444-444444444444";
type Options={ authMissing?:boolean; authThrows?:boolean; authNever?:boolean; rpcThrows?:boolean; rpcNever?:boolean; qa?:boolean; providerError?:string; noSend?:boolean; createData?:unknown; finishError?:boolean; rpcError?:{code:string;message:string} };
function harness(route:"invitations"|"users"="invitations",options:Options={}) {
  let authCalls=0,sendCalls=0;
  const calls:{service:boolean; name:string; args:Record<string,unknown>; aborted:boolean}[]=[],logs:unknown[]=[];
  const rpc=(service:boolean)=>(name:string,args:Record<string,unknown>)=>{
    const call={service,name,args,aborted:false};calls.push(call);
    const query={abortSignal:(signal:AbortSignal)=>{assert.ok(signal instanceof AbortSignal);call.aborted=true;return query;},then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>{
      if(options.rpcNever) return new Promise(()=>{});
      if(options.rpcThrows) return Promise.reject(new Error("private server data secret")).then(resolve,reject);
      let data:unknown={};let error:unknown=options.rpcError||null;
      if(name==="search_group_users_v1")data=[{user_id:OTHER,username:"golfer",display_name:"Golfer",avatar_url:null,is_friend:false,email:"private@example.invalid",password:"private"}];
      else if(args.action==="list")data={invitations:[],groupId:GROUP,acceptedMembers:[]};
      else if(args.action==="ensure")data={groupId:GROUP};
      else if(args.action==="accept")data={accepted:true,groupId:GROUP};
      else if(args.action==="create")data=Object.hasOwn(options,"createData")?options.createData:{invitationId:INVITE};
      else if(args.operation==="claim")data=options.noSend?{send:false,status:"SENDING"}:{send:true,email:"qa-recipient@example.invalid",token:"a".repeat(64),groupName:"QA",attempt:1};
      else if(args.operation==="finish"){data={status:options.providerError?"FAILED":"ACCEPTED_BY_PROVIDER"};if(options.finishError)error={code:"DB_UNAVAILABLE",message:"private db detail"};}
      return Promise.resolve({data,error}).then(resolve,reject);
    }};return query;
  };
  const exports:Record<string,(request:Request)=>Promise<Response>>={};
  runInNewContext(ts.transpileModule(readFileSync(`app/api/groups/${route}/route.ts`,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Request,Response,URL,AbortSignal,process:{env:{}},console:{error:(...args:unknown[])=>logs.push(args)},
    setTimeout:(callback:()=>void,delay:number)=>setTimeout(callback,options.authNever||options.rpcNever?1:delay),clearTimeout,
    require:(id:string)=>{
      if(id==="next/server")return{NextResponse:Response};
      if(id.endsWith("/server-auth"))return{authenticatedRequest:async(request:Request)=>{authCalls++;if(options.authThrows)throw new Error("private authentication secret");if(options.authNever)return new Promise(()=>{});return options.authMissing||!request.headers.get("authorization")?{ok:false,status:401,error:"Inicia sesión."}:{ok:true,userId:OWNER,client:{rpc:rpc(false)}};}};
      if(id.endsWith("/preview-database"))return{isolatedPreviewDatabaseEnabled:()=>options.qa!==false};
      if(id.endsWith("/supabase/server"))return{getSupabaseAdmin:()=>({rpc:rpc(true)})};
      if(id.endsWith("/frequent-templates"))return templates;
      if(id.endsWith("/group-invitations"))return invitations;
      if(id.endsWith("/http-security"))return security;
      if(id.endsWith("/group-invitation-email.server"))return{sendGroupInvitationEmail:async()=>{sendCalls++;return options.providerError?{errorCode:options.providerError}:{messageId:"provider-test-id"};}};
      throw new Error(id);
    },
  });
  return {calls,logs,authCalls:()=>authCalls,sendCalls:()=>sendCalls,run:async(method="GET",body?:unknown,suffix="",extraHeaders:Record<string,string>={})=>{
    const request=new Request(`https://preview.invalid/api/groups/${route}${suffix}`,{method,headers:{authorization:"Bearer verified-token","content-type":"application/json",...extraHeaders},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    Object.defineProperty(request,"nextUrl",{value:new URL(request.url)});return exports[method](request);
  }};
}

for(const route of ["invitations","users"] as const)test(`${route}: reject cross-site before authentication or RPC`,async()=>{
  const h=harness(route);assert.equal((await h.run("GET",undefined,"",{"sec-fetch-site":"cross-site"})).status,403);assert.equal(h.authCalls(),0);assert.equal(h.calls.length,0);
});
test("invitation POST rejects cross-site before action or email",async()=>{
  const h=harness();assert.equal((await h.run("POST",{action:"create",groupId:GROUP,email:"valid@example.invalid"},"",{origin:"https://attacker.invalid"})).status,403);assert.equal(h.sendCalls(),0);assert.equal(h.calls.length,0);
});
for(const route of ["invitations","users"] as const)for(const option of ["authThrows","authNever","rpcThrows","rpcNever"] as const)test(`${route}: ${option} is a bounded recoverable failure without leaking server details`,async()=>{
  const h=harness(route,{[option]:true});const response=await h.run("GET",undefined,"?q=golfer");assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|secret|DB_/);assert.doesNotMatch(JSON.stringify(h.logs),/private server|authentication secret/);
});
test("invitation listing forwards localGroupId without accepting an actor selector",async()=>{
  const h=harness();const response=await h.run("GET",undefined,"?localGroupId=friday&userId="+OTHER);assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)),{action:"list",payload:{localGroupId:"friday"}});assert.equal(h.calls[0].aborted,true);
  for(const suffix of ["?groupId=bad","?localGroupId=","?localGroupId="+"a".repeat(201)])assert.equal((await h.run("GET",undefined,suffix)).status,400);
});
test("directory projects identity fields only, even if an RPC mistakenly returns private columns",async()=>{
  const h=harness("users");const response=await h.run("GET",undefined,"?q=User%40Example.invalid");assert.equal(response.status,200);const body=await response.json();
  assert.deepEqual(Object.keys(body.users[0]).sort(),["avatar_url","display_name","is_friend","user_id","username"]);assert.doesNotMatch(JSON.stringify(body),/private|email|password/);assert.equal(h.calls[0].args.query_text,"User@Example.invalid");
});
test("authentication and isolated-Preview gates prevent writes or emails",async()=>{
  for(const options of [{authMissing:true},{qa:false}]){const h=harness("invitations",options);assert.equal((await h.run("POST",{action:"create",groupId:GROUP,email:"valid@example.invalid"})).status,options.authMissing?401:503);assert.equal(h.calls.length,0);assert.equal(h.sendCalls(),0);}
});
test("POST incrementally limits bytes, rejects wrong content type and primitive/array JSON",async()=>{
  for(const body of [null,[],true,"text",42]){const h=harness();assert.equal((await h.run("POST",body)).status,400);assert.equal(h.calls.length,0);}
  const h=harness();assert.equal((await h.run("POST",{action:"x"},"",{"content-type":"text/plain"})).status,415);
  assert.equal((await h.run("POST",{action:"ensure",padding:"x".repeat(220001)})).status,413);assert.equal(h.calls.length,0);
});
test("create validates email/IDs and derives service delivery actor from verified identity only",async()=>{
  const h=harness();assert.equal((await h.run("POST",{action:"create",groupId:GROUP,email:"bad"})).status,400);assert.equal(h.calls.length,0);
  const response=await h.run("POST",{action:"create",groupId:GROUP,email:" QA@Example.invalid ",actor_id:OTHER,userId:OTHER});assert.equal(response.status,200);assert.equal(h.sendCalls(),1);
  assert.equal((h.calls[0].args.payload as {email:string}).email,"qa@example.invalid");
  assert.deepEqual(h.calls.filter(call=>call.service).map(call=>call.args.actor_id),[OWNER,OWNER]);assert.ok(h.calls.every(call=>call.aborted));
  assert.equal((await response.json()).deliveryStatus,"ACCEPTED_BY_PROVIDER");
});
test("unconfigured provider records FAILED and never responds sent; retry uses same invitation",async()=>{
  const h=harness("invitations",{providerError:"GROUP_EMAIL_NOT_CONFIGURED"});const response=await h.run("POST",{action:"retry",invitationId:INVITE});assert.equal(response.status,503);
  const result=await response.json();assert.equal(result.deliveryStatus,"FAILED");assert.match(result.error,/No se envió ningún correo/);
  assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.args.invitation_id===INVITE));assert.equal(h.calls[1].args.operation,"finish");
});
test("existing member and duplicate in-flight send produce no new provider request",async()=>{
  const member=harness("invitations",{createData:{alreadyMember:true}});assert.equal((await member.run("POST",{action:"create",groupId:GROUP,targetUserId:OTHER})).status,200);assert.equal(member.sendCalls(),0);
  const sending=harness("invitations",{noSend:true});assert.equal((await sending.run("POST",{action:"retry",invitationId:INVITE})).status,200);assert.equal(sending.sendCalls(),0);
});
test("invalid database response or failed acknowledgement cannot report a confirmed send",async()=>{
  const malformed=harness("invitations",{createData:null});assert.equal((await malformed.run("POST",{action:"create",groupId:GROUP,targetUserId:OTHER})).status,503);assert.equal(malformed.sendCalls(),0);
  const failed=harness("invitations",{finishError:true});const response=await failed.run("POST",{action:"retry",invitationId:INVITE});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/ACCEPTED_BY_PROVIDER|private db/);
});
test("accept validates link and uses user RPC, never admin-selected target identity",async()=>{
  const h=harness();assert.equal((await h.run("POST",{action:"accept",invitationId:INVITE,token:"wrong"})).status,400);
  const response=await h.run("POST",{action:"accept",invitationId:INVITE,token:"a".repeat(64),targetUserId:OTHER});assert.equal(response.status,200);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].service,false);assert.deepEqual(Object.keys(h.calls[0].args.payload as object).sort(),["invitationId","token"]);
});
