import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { applyHandicapSourceState, chooseIndexPreference, parseIndexPreference, readCloudIndexPreference, saveCloudIndexPreference, BACKYARD_INDEX_METADATA_KEY, type BackyardIndexPreference } from "../lib/backyard-index-preferences";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountPrimaryRoundPlayer, syncAccountRoundIndex } from "../lib/account-primary-player";
import { selectedHandicapIndex } from "../lib/handicap-source";
import { calculateBackyardIndex } from "../lib/backyard-index";
import { captureCompletedRoundIndex } from "../lib/backyard-index-auto-capture";
import { curatedPueblaCourseProvider } from "../lib/curated-puebla-course-data";
import { teeAssignmentSnapshot } from "../lib/player-tee-assignments";
import type { RoundSnapshot } from "../lib/types";
import { socialUI,uiText } from "./helpers/social-ui";
import type { GhinProfileProjection } from "../lib/ghin/profile";
const old:BackyardIndexPreference={version:1,userId:"owner",enabled:true,handicapSource:"BACKYARD",updatedAt:"2026-09-01T09:00:00.000Z",localPccZeroDeclaredAt:"2026-09-01T09:00:00.000Z"};
const state={backyard_index_reset_at:"2026-10-07T01:00:00Z",source_changed_at:"2026-10-07T01:00:00Z",source_revision:1};
const ghin={associationStatus:"VERIFIED",handicapIndex:30.8} as GhinProfileProjection;
function completed(id:string,startedAt="2026-09-15T10:00:00.000Z"):RoundSnapshot {
  const course=curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-el-cristo-blancas")!;
  const assignment=teeAssignmentSnapshot("owner",course,startedAt);
  assignment.rating=68.6;assignment.slope=125;
  assignment.indexRatingEvidence={kind:"OFFICIAL_RATED_TEE",authority:"Synthetic authority",sourceUrl:"https://ratings.example.invalid/fixture",verifiedAt:old.updatedAt,courseId:course.catalogCourseId!,teeId:course.catalogTeeId!,courseRating:68.6,slopeRating:125};
  const round={id,ownerId:"owner",ownerName:"QA",courseName:course.name,teeName:course.teeName,lifecycleState:"completed",date:"2026-09-15",roundHoles:18,startedAt,completedAt:"2026-10-07T03:00:00Z",players:[{id:"owner",name:"QA",handicap:9,accountUserId:"owner"}],courseSnapshot:course,playerTeeAssignments:[assignment],order:course.holes.map(h=>h.number),scores:Object.fromEntries(course.holes.map(h=>[h.number,{owner:h.par+1}])),betResult:0,expenseTotal:0,netResult:0,expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0},categoryResults:{}} as RoundSnapshot;
  return captureCompletedRoundIndex(round,"owner",old);
}
test("Backyard-only keeps normal eligible calculation; VERIFIED is the sole source even if preference/cache is stale",()=>{
  const rounds=[1,2,3].map(i=>completed(`old-${i}`)),before=structuredClone(rounds);
  assert.ok(calculateBackyardIndex(rounds,"owner").value!==null);
  assert.equal(selectedHandicapIndex(old,rounds,"owner").source,"BACKYARD");
  assert.deepEqual(selectedHandicapIndex(old,rounds,"owner",ghin),{source:"GHIN",value:30.8});
  assert.deepEqual(selectedHandicapIndex(old,rounds,"owner",{...ghin,handicapIndex:null}),{source:"GHIN",value:null});
  assert.deepEqual(rounds,before);
});
test("canonical link reset disables old preference, dominates future-clock cache and cannot revive the old index on unlink",()=>{
  const linked=applyHandicapSourceState(old,"owner",state)!;
  assert.equal(linked.enabled,false);assert.equal(linked.handicapSource,null);assert.equal(linked.resetAt,"2026-10-07T01:00:00.000Z");
  const stale={preference:{...old,updatedAt:"2099-01-01T00:00:00Z"},pending:true};
  assert.deepEqual(chooseIndexPreference(stale,linked),{preference:linked,pending:false});
  const unlinked=applyHandicapSourceState({...linked,enabled:true,updatedAt:"2026-10-07T02:00:00Z"},"owner",{...state,source_revision:2,source_changed_at:"2026-10-07T02:30:00Z"})!;
  assert.equal(unlinked.enabled,false);
  assert.deepEqual(selectedHandicapIndex(unlinked,[completed("old")],"owner"),{source:null,value:null});
});
test("future explicit Backyard activation requires current epoch and starts from new rounds, not old/paused/edited cards",()=>{
  const reset=applyHandicapSourceState(old,"owner",state)!;
  const future={...reset,enabled:true,handicapSource:"BACKYARD" as const,updatedAt:"2026-10-07T04:00:00.000Z"};
  assert.deepEqual(applyHandicapSourceState(future,"owner",state),future);
  const previous=[completed("old"),{...completed("paused"),completedAt:"2026-10-08T00:00:00Z"},{...completed("legacy"),startedAt:undefined}];
  const before=structuredClone(previous);
  assert.equal(calculateBackyardIndex(previous,"owner",reset.resetAt).eligibleRoundCount,0);
  assert.equal(selectedHandicapIndex(future,previous,"owner").value,null);
  const next=[1,2,3].map(i=>completed(`new-${i}`,"2026-10-08T01:00:00.000Z"));
  assert.equal(calculateBackyardIndex([...previous,...next],"owner",reset.resetAt).eligibleRoundCount,3);
  assert.equal(selectedHandicapIndex(future,[...previous,...next],"owner").value,calculateBackyardIndex(next,"owner").value);
  assert.deepEqual(previous,before);
});
test("epoch metadata validation rejects malformed state and preserves a valid future-cycle opt-in",()=>{
  assert.equal(parseIndexPreference({...old,resetAt:"invalid"},"owner"),null);
  assert.equal(parseIndexPreference({...old,sourceRevision:0},"owner"),null);
  assert.equal(parseIndexPreference({...old,sourceRevision:1.1},"owner"),null);
  const reset=applyHandicapSourceState(old,"owner",state)!;
  assert.deepEqual(parseIndexPreference(reset,"owner"),reset);
  assert.equal(applyHandicapSourceState(old,"owner",null),old);
});
test("fresh-session preference read honors server reset without a hydration write; stale devices cannot restore old source",async()=>{
  let writes=0;let metadata:Record<string,unknown>={[BACKYARD_INDEX_METADATA_KEY]:old};
  const client={auth:{getUser:async()=>({data:{user:{id:"owner",user_metadata:metadata}},error:null}),updateUser:async({data}:any)=>{writes++;metadata={...metadata,...data};return{data:{user:{id:"owner",user_metadata:metadata}},error:null};}},from(table:string){assert.equal(table,"player_handicap_source_state");const chain={select(){return chain;},eq(k:string,v:string){assert.equal(k,"owner_id");assert.equal(v,"owner");return chain;},maybeSingle:async()=>({data:state,error:null})};return chain;}} as unknown as SupabaseClient;
  const loaded=(await readCloudIndexPreference(client,"owner"))!;
  assert.equal(loaded.enabled,false);assert.equal(writes,0);
  await assert.rejects(saveCloudIndexPreference(client,{...old,updatedAt:"2099-01-01T00:00:00Z"}),/ciclo del Índice cambió/);assert.equal(writes,0);
  const activated={...loaded,enabled:true,handicapSource:"BACKYARD" as const,updatedAt:"2026-10-07T04:00:00.000Z",localPccZeroDeclaredAt:"2026-10-07T04:00:00.000Z"};
  await saveCloudIndexPreference(client,activated);assert.equal(writes,1);
  assert.deepEqual(await readCloudIndexPreference(client,"owner"),activated);
});
test("GHIN binds new round player to provider index; unlink never changes already-started handicap snapshots",()=>{
  const index=selectedHandicapIndex(old,[],"owner",ghin);
  const profile={userId:"owner",displayName:"QA"} as Parameters<typeof accountPrimaryRoundPlayer>[0];
  const created=accountPrimaryRoundPlayer(profile,index)!;assert.equal(created.handicapIndex,30.8);assert.equal(created.handicapIndexSource,"GHIN_OFFICIAL_FUTURE");
  const frozen:Parameters<typeof syncAccountRoundIndex>[0]=[{...created,handicap:36,courseHandicapSnapshot:{index:30.8,indexSource:"GHIN_OFFICIAL_FUTURE",teeId:"rojas",teeName:"Rojas",slope:137,courseRating:71,par:72,courseHandicap:36,appliedHandicap:36,formulaVersion:"WHS-2024-COURSE-HANDICAP-V1",effectiveAt:state.backyard_index_reset_at,calculatedAt:state.backyard_index_reset_at}}];
  const before=structuredClone(frozen);
  assert.equal(syncAccountRoundIndex(frozen,"owner",{source:null,value:null},true),frozen);assert.deepEqual(frozen,before);
});
test("Career uses only active GHIN index, keeps retained cards when unlinked and never presents the closed Backyard fallback",()=>{
  const h=socialUI("app/components/career-index-panel.tsx",{"career-index-presentation":{backyardIndexTimeline:()=>({points:[],low:null,average:null,high:null})},"career-statistics":{careerNumber:(n:number|null)=>n??"—"}});
  const props={ghin:{profile:ghin},index:{source:"GHIN",value:30.8},userId:"owner",rounds:[completed("old")],displayName:"QA",onOpenRound(){}};
  const tree=h.render("CareerIndexPanel",{props,detail:null,onDetail(){}});
  assert.match(uiText(tree),/30.8/);assert.doesNotMatch(uiText(tree),/conservado|5\.5/);
  const career=readFileSync("app/components/career-ghin-scores.tsx","utf8");
  assert.match(career,/!linked && !persisted/);
  const panel=readFileSync("app/components/ghin-read-only-panel.tsx","utf8");
  assert.match(panel,/Tarjetas GHIN retenidas/);assert.match(panel,/Sin vínculo activo/);
});
test("retained read route is owner-scoped and works without link/session; unlinked import writes remain blocked before upstream",async()=>{
  const exports:any={},calls:any[]=[];let linked=false;
  const client={from(table:string){const chain:any={select(){return chain;},eq(key:string,value:unknown){if(key==="owner_id")assert.equal(value,"owner");return chain;},maybeSingle:async()=>({error:null,data:table==="player_handicap_source_state"?{retained_ghin_player_id:"11103351",retained_ghin_score_ids:["saved-1"]}:linked?{external_player_id:"11103351",association_status:"VERIFIED"}:null})};return chain;}};
  const source=ts.transpileModule(readFileSync("app/api/profile/ghin/import/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,process:{env:{VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"integration/backyard-current"}},require:(id:string)=>{
    if(id.endsWith("/user-access.server"))return{ghinUserContext:async()=>({ok:true,userId:"owner",client})};
    if(id.endsWith("/preview-database"))return{isolatedPreviewDatabaseEnabled:()=>true};
    if(id.endsWith("/qa-access.server"))return{privateGhinJson:(body:any,status=200)=>Response.json(body,{status})};
    if(id.endsWith("/core"))return{SlidingWindowRateLimiter:class{consume(){return{allowed:true};}}};
    if(id.endsWith("/score-import.server"))return{readImportState:async(_client:any,ownerId:string,golferId:string,ids:string[])=>{calls.push({ownerId,golferId,ids});return{saved:true};},importPage:()=>({items:[{id:"saved-1"}],links:[],total:1})};
    if(id.endsWith("/user-session.server"))return{getGhinUserSession:()=>{throw new Error("unexpected upstream");}};
    return{};
  }});
  const request={nextUrl:{searchParams:new URLSearchParams()}};
  const read=await exports.GET(request);assert.equal(read.status,200);assert.equal((await read.json()).retainedHistory,true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{ownerId:"owner",golferId:"11103351",ids:["saved-1"]}]);
  const write=await exports.POST(request);assert.equal(write.status,409);assert.equal((await write.json()).code,"GHIN_NOT_VERIFIED");assert.equal(calls.length,1);
  linked=true;const current=await exports.GET(request);assert.equal(current.status,200);assert.equal(calls[1].ids,undefined);
});
