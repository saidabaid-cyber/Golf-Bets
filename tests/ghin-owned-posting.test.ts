import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { ghinOwnedPostingEnvironment } from "../lib/ghin/posting-policy";
import { buildOwnedPostingCandidate } from "../lib/ghin/posting-round";
import { verifyGhinPostedScore } from "../lib/ghin/posting-verification";
import { buildGhinScorePostingDryRun } from "../lib/ghin/score-posting";
import { reconcileGhinScores } from "../lib/ghin/score-reconciliation";
import { SlidingWindowRateLimiter } from "../lib/ghin/core";
import * as config from "../lib/ghin/config";
import { socialUI,uiFind,uiText,settleUI } from "./helpers/social-ui";

const env={VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"integration/backyard-current",PREVIEW_DB_REF:"bymeopxkxapfizeeqeyb",NEXT_PUBLIC_SUPABASE_URL:"https://bymeopxkxapfizeeqeyb.supabase.co",
  NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION:"true",GHIN_READ_ONLY_ENABLED:"true",GHIN_GOLFER_LOOKUP_ENABLED:"true",GHIN_SCORE_POSTING_ENABLED:"true"};
const owner="11111111-1111-4111-8111-111111111111",roundId="22222222-2222-4222-8222-222222222222",playerId=`account:${owner}`,golferId="123456";
const holes=Array.from({length:18},(_,i)=>({number:i+1,par:4,yards:300,strokeIndex:i+1}));
const tee:any={id:"106090",name:"Rojas",gender:"Female",status:"active",holes:18,par:72,courseRating:71,slopeRating:137,totalYards:5400,holeData:holes.map(h=>({...h,yardage:h.yards}))};
const snapshot:any={ownerId:playerId,date:"2026-10-06",lifecycleState:"completed",roundHoles:18,order:holes.map(h=>h.number),players:[{id:playerId,accountUserId:owner}],scores:Object.fromEntries(holes.map(h=>[h.number,{[playerId]:6}])),courseName:"Real catalog course",teeName:"Rojas",
  courseSnapshot:{catalogCourseId:"course",catalogTeeId:"tee",providerCourseId:"23233",providerTeeSetRatingId:"106090",provider:"GHIN",ghinPostEligible:true,isProvisional:false,holes},
  playerTeeAssignments:[{playerId,courseId:"course",teeId:"tee",teeName:"Rojas",par:72,rating:71,slope:137,yards:5400,indexRatingEvidence:{ratingGender:"WOMEN"}}]};
const input=()=>({accountId:owner,roundId,snapshot:structuredClone(snapshot),golferId,gender:"F" as const,
  courseLink:{course_id:"course",external_course_id:"23233",sync_status:"CONFIRMED"},teeLink:{course_id:"course",tee_id:"tee",external_tee_set_id:"106090",sync_status:"CONFIRMED"},tee:structuredClone(tee),postingTeeIds:new Set(["106090"]),today:"2026-10-06"});
function load<T>(file:string,boundaries:Record<string,unknown>,globals:Record<string,unknown>={}):T{
  const exports={};const source=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Buffer,Response,AbortSignal,console:{info(){}},Date,Set,Promise,...globals,require(id:string){if(id==="server-only")return{};for(const [key,value]of Object.entries(boundaries))if(id.endsWith(key))return value;throw new Error(`Unexpected import ${id}`);}});return exports as T;
}
type Transport=typeof import("../lib/ghin/post-transport.server");
const transport=load<Transport>("lib/ghin/post-transport.server.ts",{"/config":config,"/posting-policy":{ghinOwnedPostingEnvironment}});
const candidate=()=>buildOwnedPostingCandidate(input());
const payload=()=>buildGhinScorePostingDryRun(candidate(),[]).payload!;
const portable=()=>({version:1 as const,accessToken:"fixture-secret",tokenExpiresAt:Date.now()+60_000,effectiveExpiresAt:Date.now()+60_000,authenticatedAt:Date.now(),httpStatus:200,firebaseHttpStatus:200,golferNumber:golferId});

test("posting requires exact DEV branch, isolated DB, private opt-in and provider read flags",()=>{
  assert.equal(ghinOwnedPostingEnvironment(env),true);
  for(const patch of [{VERCEL_ENV:"production"},{VERCEL_ENV:"development"},{VERCEL_GIT_COMMIT_REF:"beta"},{VERCEL_GIT_COMMIT_REF:"main"},{PREVIEW_DB_REF:"other"},{NEXT_PUBLIC_SUPABASE_URL:"https://zhqmlpljloumldaczcfp.supabase.co"},{GHIN_SCORE_POSTING_ENABLED:"false"},{GHIN_GOLFER_LOOKUP_ENABLED:"false"}])assert.equal(ghinOwnedPostingEnvironment({...env,...patch}),false);
});
test("owned complete female tee preserves frozen data and produces READY",()=>{
  const i=input(),before=JSON.stringify(i.snapshot),c=buildOwnedPostingCandidate(i),d=buildGhinScorePostingDryRun(c,[]);
  assert.equal(d.status,"READY");assert.equal(d.grossScore,108);assert.equal(d.payload?.gender,"F");assert.equal(d.payload?.tee_set_side,"All18");assert.equal(JSON.stringify(i.snapshot),before);
});
test("cancelled/live/other participant/incomplete/future rounds cannot become postable",()=>{
  for(const mutate of [(i:any)=>i.snapshot.lifecycleState="live",(i:any)=>i.snapshot.lifecycleState="cancelled",(i:any)=>i.snapshot.players[0].accountUserId="other",(i:any)=>delete i.snapshot.scores[18],(i:any)=>i.snapshot.order.pop(),(i:any)=>i.snapshot.date="2026-10-07"]){const i=input();mutate(i);assert.throws(()=>buildOwnedPostingCandidate(i));}
});
test("name alone, historical men rating and mismatching geometry cannot confirm mapping",()=>{
  for(const mutate of [(i:any)=>i.courseLink.sync_status="PENDING",(i:any)=>i.teeLink.tee_id="other",(i:any)=>i.snapshot.courseSnapshot.providerTeeSetRatingId="other",(i:any)=>i.tee.gender="Male",(i:any)=>i.snapshot.playerTeeAssignments[0].indexRatingEvidence.ratingGender="MEN",(i:any)=>i.tee.courseRating=70.8,(i:any)=>i.tee.holeData[0].yardage=301,(i:any)=>i.postingTeeIds.clear(),(i:any)=>i.snapshot.courseSnapshot.isProvisional=true]){const i=input();mutate(i);assert.throws(()=>buildOwnedPostingCandidate(i));}
});
test("POST transport sends confirmed contract once and retains provider ID with optional echoes absent",async()=>{
  let calls=0;const result=await transport.postGhinHoleByHole({session:portable(),payload:payload(),env,fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,"https://api2.ghin.com/api/v1/scores/hbh.json");assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");assert.equal(init?.cache,"no-store");assert.equal(JSON.parse(String(init?.body)).number_of_holes,"18");
    return Response.json({score:{id:789,golfer_id:golferId,status:"Validated",adjusted_gross_score:108,differential:30.5}});
  }});
  assert.equal(calls,1);assert.equal(result.providerScoreId,"789");assert.equal(result.httpStatus,200);assert.ok(result.responseBytes>0);assert.doesNotMatch(JSON.stringify(result),/fixture-secret|123456|Authorization/);
});
test("transport never retries auth failure, rejected POST, timeout or malformed successful response",async()=>{
  for(const mode of [401,403,422,500,"timeout","malformed","wrong-golfer"]){let calls=0;await assert.rejects(()=>transport.postGhinHoleByHole({session:portable(),payload:payload(),env,fetchImpl:async()=>{
    calls++;if(mode==="timeout")throw new Error("private token");if(typeof mode==="number")return new Response("private provider text",{status:mode});
    return mode==="malformed"?new Response("bad"):Response.json({score:{id:789,golfer_id:"other"}});
  }}));assert.equal(calls,1);}
});
test("disabled environment and expired/wrong golfer session perform zero POSTs",async()=>{
  let calls=0;for(const patch of [{env:{...env,VERCEL_ENV:"production"}},{session:{...portable(),effectiveExpiresAt:0}},{session:{...portable(),golferNumber:"other"}}])await assert.rejects(()=>transport.postGhinHoleByHole({session:portable(),payload:payload(),env,...patch,fetchImpl:async()=>{calls++;return Response.json({});}}));assert.equal(calls,0);
});

function routeHarness(options:{verified?:boolean;session?:boolean;mapping?:boolean;receiptFailure?:boolean;postFailure?:boolean;versionChange?:boolean}={}){
  let receipt:any=null,posts=0,reads=0,claims=0;const round={id:roundId,version:1,snapshot:structuredClone(snapshot)};
  const client={from(table:string){const filters:Record<string,unknown>={};let cols="";const chain:any={select(v:string){cols=v;return chain;},eq(k:string,v:unknown){filters[k]=v;return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){return Promise.resolve(resolve());},then(ok:any){return Promise.resolve(resolve()).then(ok);}};
    function resolve(){if(["rounds_cloud","ghin_score_post_receipts","player_handicap_provider_profiles"].includes(table))assert.equal(filters.owner_id,owner);
      if(table==="player_handicap_provider_profiles")return{data:{external_player_id:golferId,association_status:options.verified===false?"PENDING":"VERIFIED"},error:null};
      if(table==="rounds_cloud")return{data:cols==="version"?{version:options.versionChange?2:1}:round,error:null};
      if(table==="ghin_score_post_receipts")return{data:receipt,error:null};
      if(table==="golf_course_provider_links")return{data:options.mapping===false?null:input().courseLink,error:null};
      if(table==="golf_tee_provider_links")return{data:input().teeLink,error:null};throw new Error(table);
    }return chain;}};
  const admin={async rpc(name:string,args:any){if(name==="claim_ghin_score_post_v1"){claims++;if(receipt)return{data:{acquired:false,id:"receipt",status:receipt.status},error:null};receipt={id:"receipt",status:"POSTING",provider_score_id:null,fingerprint:args.p_fingerprint,played_at:args.p_played_at,course_id:args.p_course_id,tee_set_id:args.p_tee_set_id,gross_score:args.p_gross_score};return{data:{acquired:true,id:"receipt"},error:null};}
    if(options.receiptFailure)return{error:{message:"write unavailable"}};receipt.status=args.p_succeeded?"SUCCEEDED":"FAILED";receipt.provider_score_id=args.p_provider_score_id??null;return{data:null,error:null};}};
  const provider={async lookupGolfer(){reads++;return{data:{ghinNumber:golferId,gender:"F"}};},async getTee(){reads++;return{data:tee};},async getScorePostingTees(){reads++;return{data:[tee]};},invalidateScores(){},async getScores(){reads++;return{data:receipt?.provider_score_id?[{id:"789",playedOn:"2026-10-06",courseId:"23233",teeId:"106090",holes:18,grossScore:108,adjustedGrossScore:108}]:[]};},exportPortableSession:portable};
  class ClientError extends Error{code="unknown";}
  const route=load<any>("app/api/profile/ghin/post/route.ts",{
    "next/server":{},"/http-security":{hasOnlyKeys:(v:any,keys:string[])=>Object.keys(v).every(k=>keys.includes(k)),readJsonBodyWithLimit:async(r:any)=>({ok:true,value:await r.json()})},
    "/client":{GhinClientError:ClientError},"/core":{SlidingWindowRateLimiter},"/qa-access.server":{privateGhinJson:(body:any,status=200)=>Response.json(body,{status})},
    "/user-access.server":{ghinUserContext:async()=>({ok:true,userId:owner,client})},"/user-session.server":{GHIN_SESSION_COOKIE_NAME:"cookie",getGhinUserSession:()=>options.session===false?null:{client:provider}},
    "/posting-policy":{ghinOwnedPostingEnvironment},"/posting-round":{buildOwnedPostingCandidate},"/posting-verification":{verifyGhinPostedScore},"/score-posting":{buildGhinScorePostingDryRun},"/post-transport.server":{GhinPostingError:transport.GhinPostingError,postGhinHoleByHole:async()=>{posts++;if(options.postFailure)throw new transport.GhinPostingError("POST_OUTCOME_UNKNOWN");return{providerScoreId:"789",httpStatus:200};}},"/supabase/server":{getSupabaseAdmin:()=>admin},
  },{process:{env},Date:class extends Date{toLocaleDateString(){return"2026-10-06";}}});
  async function run(body:any){const r=await route.POST({json:async()=>body,cookies:{get:()=>({value:"sealed-fixture"})}});return{status:r.status,body:await r.json()};}
  return{run,round,get counts(){return{posts,reads,claims};},get receipt(){return receipt;}};
}
test("route dry-run → one claimed POST → provider verify → repeated action blocked before upstream",async()=>{
  const h=routeHarness(),dry=await h.run({operation:"dry-run",roundId});assert.equal(dry.body.status,"READY");assert.equal(h.counts.posts,0);
  const post=await h.run({operation:"post",roundId,fingerprint:dry.body.fingerprint,confirm:true});assert.equal(post.body.code,"POSTED");assert.equal(h.receipt.provider_score_id,"789");
  const verified=await h.run({operation:"verify",roundId});assert.equal(verified.body.code,"PROVIDER_CONFIRMED");
  const before=h.counts;const second=await h.run({operation:"post",roundId,fingerprint:dry.body.fingerprint,confirm:true});assert.equal(second.body.code,"ALREADY_POSTED");assert.deepEqual(h.counts,before);assert.equal(h.counts.posts,1);
});
test("route blocks unverified, missing session, missing mapping, wrong fingerprint and changed version without POST",async()=>{
  for(const options of [{verified:false},{session:false},{mapping:false},{versionChange:true}]){const h=routeHarness(options);const r=await h.run({operation:"post",roundId,fingerprint:"a".repeat(64),confirm:true});assert.ok(r.status>=400);assert.equal(h.counts.posts,0);}
  const h=routeHarness();const r=await h.run({operation:"post",roundId,fingerprint:"a".repeat(64),confirm:true});assert.equal(r.body.code,"CANDIDATE_CHANGED");assert.equal(h.counts.posts,0);
});
test("explicit confirmation and request ownership fields are checked before any upstream reads",async()=>{
  const h=routeHarness();for(const body of [{operation:"post",roundId,confirm:false,fingerprint:"a".repeat(64)},{operation:"post",roundId,confirm:true,fingerprint:"a".repeat(64),ownerId:"other"},{operation:"dry-run",roundId,golferId:"other"}])assert.equal((await h.run(body)).status,400);assert.equal(h.counts.reads,0);
});
test("a round version changing after READY is blocked before claiming",async()=>{
  const h=routeHarness({versionChange:true}),d=await h.run({operation:"dry-run",roundId});
  const r=await h.run({operation:"post",roundId,confirm:true,fingerprint:d.body.fingerprint});
  assert.equal(r.body.code,"CANDIDATE_CHANGED");assert.equal(h.counts.claims,0);assert.equal(h.counts.posts,0);
});
test("simultaneous posting actions result in one occupied claim and one provider POST",async()=>{
  const h=routeHarness(),d=await h.run({operation:"dry-run",roundId}),p={operation:"post",roundId,confirm:true,fingerprint:d.body.fingerprint};
  const results=await Promise.all([h.run(p),h.run(p)]);assert.equal(h.counts.posts,1);assert.equal(results.filter(r=>r.body.code==="POSTED").length,1);
});
test("editing a posted Backyard card never implicitly updates or reposts it",async()=>{
  const h=routeHarness(),d=await h.run({operation:"dry-run",roundId}),p={operation:"post",roundId,confirm:true,fingerprint:d.body.fingerprint};
  await h.run(p);h.round.snapshot.scores[1][playerId]=7;h.round.version++;
  const before=h.counts,r=await h.run({operation:"dry-run",roundId});assert.equal(r.body.code,"ALREADY_POSTED");assert.deepEqual(h.counts,before);
});
test("provider ACK with receipt-side failure keeps occupied claim and never reposts",async()=>{
  const h=routeHarness({receiptFailure:true}),d=await h.run({operation:"dry-run",roundId}),p={operation:"post",roundId,confirm:true,fingerprint:d.body.fingerprint};
  assert.equal((await h.run(p)).body.code,"PROVIDER_ACK_RECEIPT_PENDING");assert.equal(h.receipt.status,"POSTING");assert.equal((await h.run(p)).body.code,"POST_ALREADY_CLAIMED");assert.equal(h.counts.posts,1);
});
test("uncertain transport outcome blocks subsequent attempt and does not auto retry",async()=>{
  const h=routeHarness({postFailure:true}),d=await h.run({operation:"dry-run",roundId}),p={operation:"post",roundId,confirm:true,fingerprint:d.body.fingerprint};
  const failed=await h.run(p);assert.equal(failed.body.code,"POST_OUTCOME_UNKNOWN");assert.equal(failed.body.automaticRetry,false);assert.equal((await h.run(p)).body.code,"POST_ALREADY_CLAIMED");assert.equal(h.counts.posts,1);
});
test("posting receipt makes reimport link the original round once, preserving its richer snapshot",()=>{
  const c=candidate(),d=buildGhinScorePostingDryRun(c,[]),before=JSON.stringify(snapshot);
  const score:any={id:"789",playedOn:c.playedAt,courseId:"23233",teeId:"106090",holes:18,grossScore:108,adjustedGrossScore:108};
  const result=reconcileGhinScores({golferId,scores:[score],rounds:[{id:roundId,localId:"local",golferId,playedOn:c.playedAt!,courseId:"23233",teeId:"106090",holes:18,gross:108,adjustedGross:108,courseName:c.courseName!,teeName:c.teeName!}],existing:[],posts:[{roundId,providerScoreId:"789",fingerprint:d.fingerprint!}]});
  assert.equal(result.decisions[0].linkedRoundId,roundId);assert.equal(result.decisions[0].postingFingerprint,d.fingerprint);assert.equal(JSON.stringify(snapshot),before);
});
test("provider verification uses exact saved ID, never name-only, and tolerates omitted optional IDs",()=>{
  const receipt={provider_score_id:"789",played_at:"2026-10-06",course_id:"23233",tee_set_id:"106090",gross_score:108};
  const score:any={id:"789",playedOn:"2026-10-06",courseId:null,teeId:null,holes:18,grossScore:null,adjustedGrossScore:108};
  assert.equal(verifyGhinPostedScore([score],receipt).confirmed,true);
  for(const patch of [{id:"other"},{playedOn:"2026-10-05"},{courseId:"other"},{teeId:"other"},{holes:9},{adjustedGrossScore:99}])assert.equal(verifyGhinPostedScore([{...score,...patch}],receipt).confirmed,false);
  assert.equal(verifyGhinPostedScore([score,score],receipt).confirmed,false);
});
test("posting UI is demand-only and requires an explicit checked confirmation",async()=>{
  let calls=0;const h=socialUI("app/components/ghin-posting-panel.tsx"),props={request:async(body:any)=>{calls++;return body?{status:"READY",roundId,fingerprint:"a".repeat(64)}:{items:[{id:roundId,date:"2026-10-06",course:"Club",tee:"Rojas",gross:108}]};},onReauthorize(){}};
  let tree=h.render("GhinPostingPanel",props);h.render("GhinPostingPanel",props);assert.equal(calls,0);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="VER RONDAS PARA REVISAR").props.onClick();await settleUI();tree=h.render("GhinPostingPanel",props);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="VALIDAR SIN PUBLICAR").props.onClick();await settleUI();tree=h.render("GhinPostingPanel",props);
  assert.equal(uiFind(tree,n=>n.type==="button"&&uiText(n)==="PUBLICAR ESTA TARJETA").props.disabled,true);
  uiFind(tree,n=>n.type==="input"&&n.props.type==="checkbox").props.onChange({target:{checked:true}});tree=h.render("GhinPostingPanel",props);
  assert.equal(uiFind(tree,n=>n.type==="button"&&uiText(n)==="PUBLICAR ESTA TARJETA").props.disabled,false);assert.equal(calls,2);
});
