import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { lookupGhinCourse, parseCourseLookupInput } from "../lib/ghin/course-lookup";
import { socialUI, uiFind, uiText, settleUI } from "./helpers/social-ui";

const result = (data: any) => Promise.resolve({ data, httpStatus: 200, fetchedAt: "2026-10-06T00:00:00Z" });
test("lookup rejects owner/golfer selectors, malformed IDs and oversized queries", () => {
  for (const input of [null,[],{operation:"post"},{operation:"course",courseId:"../scores"},
    {operation:"search",name:"La Vista",ownerId:"other"},{operation:"tee",teeId:"123",golferId:"other"},
    {operation:"search",name:"x"},{operation:"search",name:"x".repeat(101)}]) assert.equal(parseCourseLookupInput(input),null);
  assert.deepEqual(parseCourseLookupInput({operation:"search",name:" La Vista "}),{operation:"search",name:"La Vista"});
  assert.deepEqual(parseCourseLookupInput({operation:"course",courseId:"23233"}),{operation:"course",courseId:"23233"});
});
test("facility denial does not hide an independently authorized course result", async () => {
  const calls:string[]=[];
  const r=await lookupGhinCourse({ searchFacilities:async()=>{calls.push("facility");throw Object.assign(new Error("secret-body"),{code:"forbidden",httpStatus:403});},
    searchCourses:async()=>{calls.push("courses");return result([{id:"23233"}]);} } as any,{operation:"search",name:"La Vista"});
  assert.equal(r.readOnly,true);assert.equal(r.courses?.ok,true);assert.deepEqual(r.facilities,{ok:false,code:"FORBIDDEN",httpStatus:403});
  assert.deepEqual(calls.sort(),["courses","facility"]);assert.ok(!JSON.stringify(r).includes("secret-body"));
});
test("entitlement denial preserves details without claiming posting is enabled", async()=>{
  const r=await lookupGhinCourse({getCourse:()=>result({id:"23233",tees:[]}),getScorePostingTees:async()=>{throw Object.assign(new Error("provider text"),{code:"forbidden",httpStatus:403});}} as any,{operation:"course",courseId:"23233"});
  assert.equal(r.course?.ok,true);assert.deepEqual(r.postingTees,{ok:false,code:"FORBIDDEN",httpStatus:403});
});
test("failed or mismatched details never trigger an entitlement read",async()=>{
  for(const id of [null,"other"]){let calls=0;const r=await lookupGhinCourse({getCourse:async()=>{if(!id)throw new Error("failed");return result({id});},getScorePostingTees:async()=>{calls++;return result([]);}} as any,{operation:"course",courseId:"23233"});assert.equal(calls,0);assert.equal(r.postingTees,undefined);}
});
test("one course inspect and one tee inspect make only the necessary provider reads",async()=>{
  const calls:string[]=[];const client={getCourse:(id:string)=>{calls.push(`course:${id}`);return result({id,tees:[]});},getScorePostingTees:(id:string)=>{calls.push(`posting:${id}`);return result([{id:"106088"}]);},getTee:(id:string)=>{calls.push(`tee:${id}`);return result({id});}};
  const c=await lookupGhinCourse(client as any,{operation:"course",courseId:"23233"});
  assert.equal(c.postingTees?.ok,true);await lookupGhinCourse(client as any,{operation:"tee",teeId:"106088"});assert.deepEqual(calls,["course:23233","posting:23233","tee:106088"]);
});

function routeHarness(options:{env?:string;branch?:string;isolated?:boolean;courseLookup?:boolean;auth?:boolean;verified?:boolean;session?:boolean;rate?:boolean}={}) {
  const calls:string[]=[];
  const account={ok:true,userId:"owner-one",client:{from:(table:string)=>{assert.equal(table,"player_handicap_provider_profiles");const q:any={select:()=>q,eq:(key:string,value:string)=>{calls.push(`${key}:${value}`);return q;},maybeSingle:async()=>({data:{association_status:options.verified===false?"DISCONNECTED":"VERIFIED",external_player_id:"linked-golfer"},error:null})};return q;}}};
  const exported:any={};
  const modules:any={
    "next/server":{},
    "../../../../../lib/backyard-ai/server/http-security":{readJsonBodyWithLimit:async()=>({ok:true,value:{operation:"course",courseId:"23233"}})},
    "../../../../../lib/ghin/config":{resolveGhinPreviewCapabilities:()=>({courseLookup:options.courseLookup!==false})},
    "../../../../../lib/ghin/core":{SlidingWindowRateLimiter:class{consume(){return{allowed:options.rate!==false};}}},
    "../../../../../lib/ghin/course-lookup":{parseCourseLookupInput,lookupGhinCourse:async()=>{calls.push("provider-read");return{readOnly:true};}},
    "../../../../../lib/ghin/qa-access.server":{privateGhinJson:(body:any,status=200)=>({body,status})},
    "../../../../../lib/ghin/user-access.server":{ghinUserContext:async()=>{calls.push("auth");return options.auth===false?{ok:false,response:{status:401}}:account;}},
    "../../../../../lib/ghin/user-session.server":{GHIN_SESSION_COOKIE_NAME:"sealed-owner-cookie",getGhinUserSession:(owner:string,golfer:string,sealed:string)=>{assert.deepEqual([owner,golfer,sealed],["owner-one","linked-golfer","sealed"]);calls.push("owner-session");return options.session===false?null:{client:{getTrace:()=>[]}};}},
    "../../../../../lib/preview-database":{isolatedPreviewDatabaseEnabled:()=>options.isolated!==false},
  };
  runInNewContext(ts.transpileModule(readFileSync("app/api/profile/ghin/courses/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:exported,process:{env:{VERCEL_ENV:options.env??"preview",VERCEL_GIT_COMMIT_REF:options.branch??"integration/backyard-current"}},console:{info:()=>{}},require:(path:string)=>{assert.ok(path in modules,`Unexpected dependency ${path}`);return modules[path];}});
  return {calls,post:()=>exported.POST({cookies:{get:(key:string)=>{assert.equal(key,"sealed-owner-cookie");return{value:"sealed"};}}})};
}
test("lookup route is unavailable in production, beta, other branches and wrong DB",async()=>{
  for(const options of [{env:"production"},{branch:"beta"},{branch:"main"},{isolated:false},{courseLookup:false}]){const h=routeHarness(options);assert.equal((await h.post()).status,404);assert.deepEqual(h.calls,[]);}
});
test("unauthenticated, unverified, expired session and rate limit stop upstream reads",async()=>{
  for(const [options,status] of [[{auth:false},401],[{verified:false},409],[{session:false},409],[{rate:false},429]] as const){const h=routeHarness(options);assert.equal((await h.post()).status,status);assert.ok(!h.calls.includes("provider-read"));}
});
test("verified owner route uses RLS-bound profile and the same owner's sealed session",async()=>{
  const h=routeHarness();assert.equal((await h.post()).status,200);assert.ok(h.calls.includes("owner_id:owner-one"));assert.equal(h.calls.filter(x=>x==="provider-read").length,1);
  const route=readFileSync("app/api/profile/ghin/courses/route.ts","utf8");assert.doesNotMatch(route,/resolveGhinRuntime|GHIN_TEST_|getSupabaseAdmin|\.upsert\(|\.update\(|\.rpc\(|getScores|postScore/);
});
test("opening or rendering course lookup does not read GHIN; simultaneous submits coalesce",async()=>{
  let reads=0,resolve:((data:any)=>void)|undefined;
  const h=socialUI("app/components/ghin-course-lookup.tsx"),props={lookup:()=>{reads++;return new Promise(r=>resolve=r);}};
  h.render("GhinCourseLookup",props);const tree=h.render("GhinCourseLookup",props);assert.equal(reads,0);
  const form=uiFind(tree,n=>n.type==="form");form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});assert.equal(reads,1);
  resolve!({readOnly:true,postingTees:{ok:false,code:"FORBIDDEN",httpStatus:403}});await settleUI();
  assert.match(uiText(h.render("GhinCourseLookup",props)),/Score posting entitlement: FORBIDDEN · HTTP 403/);assert.equal(reads,1);
});
