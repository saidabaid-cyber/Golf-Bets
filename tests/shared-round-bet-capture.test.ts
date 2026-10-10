import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { initialBets } from "../lib/new-round-bets";
import { patchSharedScores, SharedLiveError, type SharedScorePatch } from "../lib/shared-round-live";
import { finalizeSharedRound } from "../lib/shared-round-finalize";
import type { RoundSnapshot } from "../lib/types";
import { DEFAULT_LA_VISTA_COURSE as laVista } from "../lib/golf-course-directory";

const A="00000000-0000-4000-8000-000000000001", B="00000000-0000-4000-8000-000000000002", now="2026-10-10T07:00:00Z";
function card(): RoundSnapshot {
  const bets=initialBets([]);
  for(const key of ["vipers","camels","fish","units"] as const) bets[key]={...bets[key],enabled:true,participantIds:["a","b"]};
  return {id:"synthetic-shared-bets",date:"2026-10-10",courseName:"QA",teeName:"QA",ownerName:"A",ownerId:"a",courseSnapshot:laVista,order:[1],scores:{},betConfig:bets,
    players:[{id:"a",accountUserId:A,name:"A",handicap:0},{id:"b",accountUserId:B,name:"B",handicap:0}],lifecycleState:"live",scorekeeping:{version:1,mode:"self"},
    presentation:{version:1,groupNassauTerm:"polla"},betResult:0,netResult:0,categoryResults:{},expenseTotal:0,expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0}};
}
const operation=(playerKey="a", baseVersion=1):SharedScorePatch=>({id:randomUUID(),hole:1,playerKey,baseVersion,score:4});
const apply=(r:RoundSnapshot, p:SharedScorePatch, actor=A, version=1)=>patchSharedScores("canonical",A,version,r,actor,[p],now);
const code=(c:string)=>(e:unknown)=>e instanceof SharedLiveError&&e.code===c;
test("participant facts merge across accounts and use existing event and unit representations",()=>{
  const a={...operation(),putts:3,facts:{camels:2,fish:0,units:-2}};
  const first=apply(card(),a).snapshot;
  const second=apply(first,{...operation("b"),score:5,putts:2,facts:{camels:0,fish:1,units:3}},B,2).snapshot;
  assert.deepEqual(second.scores![1],{a:4,b:5}); assert.deepEqual(second.putts![1],{a:3,b:2});
  assert.equal(second.counterBetEvents!.find(e=>e.playerId==="a"&&e.kind==="vipers")!.quantity,1);
  assert.equal(second.counterBetEvents!.find(e=>e.playerId==="b"&&e.kind==="vipers")!.quantity,0);
  assert.equal(second.counterBetEvents!.filter(e=>e.kind==="camels").length,2);
  assert.equal(second.unitEvents!.find(e=>e.playerId==="b")!.amount,3);
  assert.equal(apply(second,a,A,3).applied,false); assert.equal(first.counterBetEvents!.length,3);
});
test("same fact conflict and changed retry payload reject; another player's facts cannot be changed",()=>{
  const a={...operation(),facts:{camels:1}}; const first=apply(card(),a).snapshot;
  assert.throws(()=>apply(first,{...operation(),facts:{camels:2}},A,2),code("SCORE_CONFLICT"));
  assert.throws(()=>apply(first,{...a,facts:{camels:2}},A,2),code("IDEMPOTENCY_CONFLICT"));
  assert.throws(()=>apply(card(),{...operation("a"),facts:{fish:1}},B),code("FORBIDDEN"));
  const score=operation(); const scoreOnly=apply(card(),score).snapshot;
  assert.throws(()=>apply(scoreOnly,{...score,facts:{camels:1}},A,2),code("IDEMPOTENCY_CONFLICT"));
});
test("invalid or inactive facts reject atomically; no invented animal after repeat unchanged putts",()=>{
  for(const facts of [{camels:-1},{fish:21},{units:1000},{viperDistance:-1},{camels:1,arbitrary:4}]) assert.throws(()=>apply(card(),{...operation(),facts}),code("INVALID_REQUEST"));
  const inactive=card();inactive.betConfig!.fish.enabled=false;
  assert.throws(()=>apply(inactive,{...operation(),facts:{fish:1}}),code("INVALID_REQUEST"));
  const first=apply(card(),{...operation(),putts:3}).snapshot;
  const second=apply(first,{...operation("a",2),putts:3},A,2).snapshot;
  assert.deepEqual(second.counterBetEvents,first.counterBetEvents);
});
test("organizer saves group decisions, participant denied and stale decisions reject",()=>{
  const r=card();r.betConfig!.ballFriend.enabled=true;r.betConfig!.ballFriend.participantIds=["a","b"];
  r.betConfig!.loba.enabled=true;r.betConfig!.loba.participantIds=["a","b"];
  const group={...operation("@round"),score:null,group:{ballFriend:{teamA:["a"]},loba:{lobaPlayerId:"a",mode:"solo" as const,fireMultiplier:2,unitCounts:{a:1}}}};
  assert.throws(()=>apply(r,group,B),code("FORBIDDEN"));
  const first=apply(r,group).snapshot;
  assert.deepEqual(first.ballFriendSetup![1],group.group.ballFriend);
  assert.equal(first.lobaHoles![1].fireMultiplier,2);
  assert.equal(apply(first,group,A,2).applied,false);
  assert.throws(()=>apply(first,{...group,id:randomUUID(),group:{ballFriend:{teamA:["b"]}}},A,2),code("SCORE_CONFLICT"));
  assert.throws(()=>apply(r,{...group,group:{ballFriend:{teamA:["outsider"]}}}),code("INVALID_REQUEST"));
});
test("missing required putts cannot finalize; explicit putts unblock existing calculators",()=>{
  const r=card(); r.betConfig!.camels.enabled=false;r.betConfig!.fish.enabled=false;r.betConfig!.units.enabled=false;
  let next=apply(r,operation()).snapshot;
  next=apply(next,{...operation("b"),score:5},B,2).snapshot;
  assert.throws(()=>finalizeSharedRound(next,now),code("INCOMPLETE_BET_CAPTURE"));
  next=apply(next,{...operation("a",3),putts:2},A,3).snapshot;
  next=apply(next,{...operation("b",4),score:5,putts:3},B,4).snapshot;
  const final=finalizeSharedRound(next,now);assert.equal(final.lifecycleState,"completed");
  assert.equal(Object.values(final.playerBalances!).reduce((sum,v)=>sum+v,0),0);
});
