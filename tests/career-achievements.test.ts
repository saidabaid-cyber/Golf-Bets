import assert from "node:assert/strict";
import test from "node:test";
import { deriveCareerAchievements, rankFameEntries } from "../lib/round-achievements";
import { careerRound } from "./helpers/career-round";
import { renderCareer } from "./helpers/render-career";
test("catalogue calculates progress from deduplicated owned evidence and keeps first unlock provenance", () => {
  const first=careerRound("one",1,3),second=careerRound("two",2,4),next=careerRound("three",3,4);
  const data=deriveCareerAchievements([next,first,second,first],"owner");
  assert.equal(data.find(a => a.slug === "consistency")!.progress,25);
  const birdie=data.find(a => a.slug === "birdie-club")!;
  assert.equal(birdie.value,18); assert.equal(birdie.status,"unlocked"); assert.equal(birdie.unlocked_at,first.date);assert.equal(birdie.round_id,"one");
  assert.equal(data.find(a => a.slug === "par-master")!.value,36);
  assert.equal(data.find(a => a.slug === "ace-club")!.status,"locked");
  assert.equal(deriveCareerAchievements([first],"other").find(a => a.slug === "consistency")!.value,0);
});
test("invalid/partial/cancelled cards never unlock; 9 holes never count as Low Round", () => {
  const round=careerRound("nine",1,3,4,9);
  const partial={...careerRound("partial",2),scores:{}};
  const data=deriveCareerAchievements([round,partial,{...round,id:"cancelled",lifecycleState:"cancelled"}],"owner");
  assert.equal(data.find(a => a.slug === "low-round")!.value,null);assert.equal(data.find(a => a.slug === "consistency")!.value,1);
  assert.equal(data.find(a => a.slug === "top-finish")!.metadata.available,false);
});
test("Ace and competition criteria derive from explicit evidence rather than stored percentages", () => {
  const round=careerRound("ace",1);round.scores![1]["owner-player"]=1;
  const data=deriveCareerAchievements([round],"owner",{bestWinStreak:3,streakAt:round.date,streakRoundId:round.id,podiums:[{id:"t",date:round.date,courseName:"QA"}]});
  for(const slug of ["ace-club","win-streak","top-finish"]) assert.equal(data.find(a => a.slug === slug)!.status,"unlocked");
});
test("Fame ranks tie-aware real aggregates and renders premium leader or honest empty", () => {
  assert.deepEqual(rankFameEntries([{userId:"b",name:"B",achievements:2},{userId:"a",name:"A",achievements:2},{userId:"c",name:"C",achievements:1}]).map(e=>e.position),[1,1,3]);
  const empty=renderCareer("app/components/career-achievements.tsx","FameLeaderboard",{});
  assert.match(empty,/Salón de la Fama/);assert.match(empty,/ranking global de logros verificados/);assert.doesNotMatch(empty,/#1/);
  const full=renderCareer("app/components/career-achievements.tsx","FameLeaderboard",{entries:[{userId:"a",name:"QA líder con nombre largo",achievements:7}]});
  assert.match(full,/#1/); assert.match(full,/QA líder con nombre largo/);assert.match(full,/Ver ranking completo/);
});
test("empty collection renders locked catalogue without invented players", () => {
  const html=renderCareer("app/components/career-achievements.tsx","CareerAchievements",{rounds:[],userId:"owner",onCreateRound(){},onOpenRound(){}});
  assert.match(html,/Tus primeros logros aparecerán conforme juegues/);assert.match(html,/Por desbloquear/);assert.match(html,/Sin datos suficientes/);
});
