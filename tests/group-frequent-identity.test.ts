import test from "node:test";
import assert from "node:assert/strict";
import { instantiateGroupGameTemplate } from "../lib/group-game-template";
import { addFrequentPlayerTemplate } from "../lib/frequent-templates";
import { upsertFrequentPlayers } from "../lib/round-utils";
import type { FrequentGroup } from "../lib/types";

test("explicit group guest retains frequent identity through round completion and rename", () => {
  const member = {memberId:"member-a",name:"Guest",handicap:12,kind:"guest" as const};
  const group:FrequentGroup = {id:"group",name:"QA",players:[member],uses:0,updatedAt:"now"};
  const saved = addFrequentPlayerTemplate([], member, "saved-a", "before");
  const round = instantiateGroupGameTemplate(group,()=>"new-id",undefined,saved);
  assert.equal(round.players[0].id,"saved-a");
  round.players[0].name="Renamed guest";
  const after = upsertFrequentPlayers(saved,round.players,"after");
  assert.equal(after.length,1); assert.equal(after[0].memberId,"member-a");
  assert.equal(after[0].uses,1);
  const next = instantiateGroupGameTemplate(group,()=>"new-id-2",undefined,after);
  assert.equal(next.origin.roundPlayerIdByMemberId["member-a"],"saved-a");
});

test("same name with different memberIds creates distinct templates; ambiguous provenance never guesses", () => {
  const a=addFrequentPlayerTemplate([],{memberId:"a",name:"Same",handicap:10},"one","now");
  const b=addFrequentPlayerTemplate(a,{memberId:"b",name:"Same",handicap:20},"two","now");
  assert.equal(b.length,2);
  assert.strictEqual(addFrequentPlayerTemplate(b,{memberId:"a",name:"Renamed",handicap:9},"three","now"),b);
  const group:FrequentGroup={id:"g",name:"QA",players:[{memberId:"a",name:"Same",handicap:10}],uses:0,updatedAt:"now"};
  const ambiguous=[...b,{...b.find(p=>p.memberId==="a")!,id:"duplicate"}];
  assert.equal(instantiateGroupGameTemplate(group,()=>"fresh",undefined,ambiguous).players[0].id,"fresh");
  assert.equal(ambiguous.length,3);
});
