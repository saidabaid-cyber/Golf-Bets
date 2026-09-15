import assert from "node:assert/strict";
import test from "node:test";
import { canResumeActiveRound, normalizeRoundResumeContext, persistRoundResumeContext, readRoundResumeContext } from "../lib/active-round-navigation";

const active = () => ({ userId: "account-1", workspaceOwnerId: "account-1", hydrated: true, closed: false, draftAvailable: true,
  draft: { roundId: "round-1", startedAt: "2026-09-15T13:00:00Z", courseSelected: true, ownerId: "player-1", players: [{id:"player-1"},{id:"player-2"}], scores: {} }, history: [] as {id:string}[] });

test("global resume requires real started round, never a setup draft or navigation marker", () => {
  assert.equal(canResumeActiveRound(active()), true);
  const setup = active(); setup.draft.startedAt = "";
  assert.equal(canResumeActiveRound(setup), false);
  assert.equal(canResumeActiveRound({...setup, draft: {...setup.draft, scores: {10:{"player-1":4}}}}), true);
  assert.equal(canResumeActiveRound({...setup, draft: {...setup.draft, scores: {10:{"player-1":null}}}}), false);
});

test("closed, historical, review, cancelled and foreign workspace rounds never appear", () => {
  for (const patch of [{closed:true},{hydrated:false},{workspaceOwnerId:"account-2"},{draftAvailable:false},{history:[{id:"round-1"}]}]) {
    assert.equal(canResumeActiveRound({...active(),...patch}), false);
  }
  for (const patch of [{reviewPending:true},{lifecycleState:"completed"},{lifecycleState:"cancelled"},{courseSelected:false},{ownerId:"missing"},{players:[]}]) {
    assert.equal(canResumeActiveRound({...active(),draft:{...active().draft,...patch}}), false);
  }
});

test("local resume survives reload and retains player, capture tab and played-order hole", () => {
  const values = new Map<string,string>();
  const storage = {getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const context = {roundId:"round-1",playerId:"player-2",stage:"approach" as const,currentIndex:11};
  assert.equal(persistRoundResumeContext(storage,"account-1",context),true);
  assert.deepEqual(normalizeRoundResumeContext(readRoundResumeContext(storage,"account-1","round-1"),"round-1",["player-1","player-2"],"player-1",18),context);
  assert.equal(readRoundResumeContext(storage,"account-2","round-1"),null);
  assert.equal(readRoundResumeContext(storage,"account-1","round-2"),null);
  assert.equal(values.size,1); // resume never writes a second golf round
});

test("removed player, invalid tab and out-of-bounds cursor recover safely", () => {
  assert.deepEqual(normalizeRoundResumeContext({roundId:"round-1",playerId:"removed",stage:"invalid",currentIndex:99},"round-1",["player-1"],"player-1",9),{roundId:"round-1",playerId:"player-1",stage:"score",currentIndex:8});
  assert.deepEqual(normalizeRoundResumeContext({roundId:"old",playerId:"player-2",stage:"summary",currentIndex:8},"round-1",["player-1","player-2"],"player-1",18),{roundId:"round-1",playerId:"player-1",stage:"score",currentIndex:0});
  assert.equal(readRoundResumeContext({getItem:()=>"corrupt"},"account-1","round-1"),null);
});
