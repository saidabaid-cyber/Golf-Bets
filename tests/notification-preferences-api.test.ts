import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as domain from "../features/notifications/domain";
import * as security from "../lib/backyard-ai/server/http-security";

type Row={user_id:string;event_type:string;in_app:boolean;push:boolean;updated_at:string};
function harness(auth=true){
  const rows:Row[]=[{user_id:"owner",event_type:"friend_request",in_app:true,push:true,updated_at:"2026-10-05T12:00:00Z"},{user_id:"other",event_type:"friend_request",in_app:true,push:true,updated_at:"2026-10-05T12:00:00Z"}];
  let enabled=true,fail=false;
  const filters:Array<[string,unknown]>=[],updates:Record<string,unknown>[]=[];
  const client={from(table:string){
    const where:Record<string,unknown>={};let patch:Record<string,unknown>|null=null,insert:Record<string,unknown>|null=null;
    const finish=()=>{
      if(fail)return {data:null,error:{code:"42501"}};
      if(table==="user_preferences")return {data:{notifications_enabled:enabled},error:null};
      assert.equal(table,"notification_preferences_v2");
      if(insert && !rows.some(row=>row.user_id===insert!.user_id && row.event_type===insert!.event_type))rows.push({...insert,updated_at:"2026-10-05T12:00:00Z"} as Row);
      const selected=rows.filter(row=>Object.entries(where).every(([key,value])=>row[key as keyof Row]===value));
      if(patch){updates.push(patch);selected.forEach(row=>Object.assign(row,patch));}
      return {data:selected,error:null};
    };
    const query={select:()=>query,eq:(key:string,value:unknown)=>{where[key]=value;filters.push([key,value]);return query;},abortSignal:()=>query,
      upsert:(value:Record<string,unknown>,options:{ignoreDuplicates:boolean})=>{assert.equal(options.ignoreDuplicates,true);insert=value;return query;},
      update:(value:Record<string,unknown>)=>{patch=value;return query;},maybeSingle:async()=>finish(),single:async()=>{const result=finish();return {...result,data:Array.isArray(result.data)?result.data[0]:result.data};},
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(finish()).then(resolve)};
    return query;
  }};
  const compiled=ts.transpileModule(readFileSync("app/api/social/notification-preferences/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,(request:Request)=>Promise<Response>>={};
  runInNewContext(compiled,{exports,Date,AbortSignal,Object,require:(id:string)=>{
    if(id==="next/server")return {NextResponse:Response};
    if(id.endsWith("/server-auth"))return {authenticatedRequest:async()=>auth?{ok:true,userId:"owner",client}:{ok:false,status:401,error:"auth"}};
    if(id.endsWith("/domain"))return domain;if(id.endsWith("/http-security"))return security;
    throw new Error(id);
  }});
  const request=(body?:unknown,origin?:string)=>new Request("https://dev.invalid/api/social/notification-preferences",{method:body?"PATCH":"GET",headers:{"content-type":"application/json",...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {exports,request,rows,filters,updates,master:(value:boolean)=>{enabled=value;},fail:()=>{fail=true;}};
}
test("event preferences authenticate and scope every read/write to the verified account",async()=>{
  const fixture=harness();const response=await fixture.exports.GET(fixture.request());assert.equal(response.status,200);
  assert.match(response.headers.get("cache-control")||"",/no-store/);const initial=await response.json();assert.equal(initial.data.length,domain.NOTIFICATION_PREFERENCE_TYPES.length);
  assert.equal((await fixture.exports.PATCH(fixture.request({type:"friend_request",inApp:false}))).status,200);
  const after=await (await fixture.exports.GET(fixture.request())).json();assert.equal(after.data.find((x:{type:string})=>x.type==="friend_request").inApp,false);
  assert.equal(fixture.rows[0].push,true);assert.equal(fixture.rows[1].in_app,true);assert.equal(fixture.updates[0].push,undefined);
  assert.ok(fixture.filters.filter(([key])=>key==="user_id").every(([,id])=>id==="owner"));
});
test("seven event choices persist independently and preserve the unrelated channel",async()=>{
  const fixture=harness();
  for(const type of domain.NOTIFICATION_EVENT_TYPES){
    assert.equal((await fixture.exports.PATCH(fixture.request({type,inApp:false}))).status,200);
    const reload=await (await fixture.exports.GET(fixture.request())).json();assert.equal(reload.data.find((row:{type:string})=>row.type===type).inApp,false);
  }
  const prefsBefore=JSON.stringify(fixture.rows);fixture.master(false);assert.equal((await (await fixture.exports.GET(fixture.request())).json()).enabled,false);
  fixture.master(true);assert.equal((await (await fixture.exports.GET(fixture.request())).json()).enabled,true);assert.equal(JSON.stringify(fixture.rows),prefsBefore);
});
test("event preference API rejects arbitrary payloads, user id, non-booleans and cross-site writes",async()=>{
  const fixture=harness();
  for(const body of [{type:"unknown",inApp:true},{type:"friend_request",inApp:"true"},{type:"friend_request",push:1},{type:"friend_request"},{type:"friend_request",inApp:true,user_id:"other"}])assert.equal((await fixture.exports.PATCH(fixture.request(body))).status,400);
  assert.equal((await fixture.exports.PATCH(fixture.request({type:"friend_request",inApp:false},"https://evil.invalid"))).status,403);
  assert.equal(fixture.updates.length,0);
});
test("unavailable schema and unauthenticated sessions fail closed without success feedback",async()=>{
  const noAuth=harness(false);assert.equal((await noAuth.exports.GET(noAuth.request())).status,401);assert.equal((await noAuth.exports.PATCH(noAuth.request({type:"friend_request",inApp:false}))).status,401);
  const failed=harness();failed.fail();assert.equal((await failed.exports.PATCH(failed.request({type:"friend_request",inApp:false}))).status,503);assert.equal(failed.updates.length,0);
});
