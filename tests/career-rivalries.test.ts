import assert from "node:assert/strict";
import test from "node:test";
import { deriveCareerRivalries, rivalryTotals, rivalryCompetitionEvidence } from "../lib/career-rivalries";
import { careerRound } from "./helpers/career-round";
import { renderCareer } from "./helpers/render-career";

test("same-day rivalry streaks and most recent match follow completion time, not random IDs", () => {
  const rounds=[careerRound("z-first",1,3,4),careerRound("a-middle",1,5,4),careerRound("y-last",1,3,4)];
  rounds.forEach((round,i)=>{round.completedAt=`2026-01-01T${12+i}:00:00Z`;});
  const rivalry=deriveCareerRivalries(rounds,"owner")[0];
  assert.deepEqual(rivalry.matches.map(m=>m.roundId),["y-last","a-middle","z-first"]);
  assert.deepEqual(rivalry.currentStreak,{result:"win",count:1});
  assert.equal(rivalry.bestWinStreak,1);
  assert.deepEqual([rivalry.wins,rivalry.losses,rivalry.ties],[2,1,0]);
});
test("G-P-E, rate, first/last match and streaks use sports scores regardless of money", () => {
  const rounds=[careerRound("one",1,5,4),careerRound("two",2,4,4),careerRound("three",3,4,5),careerRound("four",4,3,4),careerRound("five",5,3,4)];
  rounds.forEach(r=>{r.betResult=-999;r.personalOpponentResults=[{betId:"bet",mode:"dollar_stroke",modeLabel:"QA",opponentId:"rival-player",opponentName:"QA",amount:999}];});
  const r=deriveCareerRivalries([...rounds,rounds[0]],"owner")[0];
  assert.equal(r.matchesPlayed,5);assert.equal(r.wins,3);assert.equal(r.losses,1);assert.equal(r.ties,1);assert.equal(r.winRate,60);assert.equal(r.bestWinStreak,3);assert.deepEqual(r.currentStreak,{result:"win",count:3});
  assert.equal(r.firstMatch,rounds[0].date);assert.equal(r.lastMatch,rounds[4].date);assert.equal(rivalryCompetitionEvidence([r]).bestWinStreak,3);
  assert.equal(rivalryTotals([r]).winRate,60);assert.doesNotMatch(JSON.stringify(r),/balance|money|amount|betResult/);
});
test("Top rivales sorts by encounters; incomplete, different par and foreign cards are excluded", () => {
  const a=careerRound("a",1),b=careerRound("b",2),c=careerRound("c",3);
  c.players![1].accountUserId="rival2";
  const partial={...careerRound("partial",4),scores:{}};
  const different=careerRound("different",5);different.courseSnapshot!.playerHoleCards={"rival-player":different.courseSnapshot!.holes.map(h=>({...h,par:5}))};
  const result=deriveCareerRivalries([c,a,b,partial,different],"owner");
  assert.deepEqual(result.map(r=>r.matchesPlayed),[2,1]);assert.equal(deriveCareerRivalries([a],"unlinked").length,0);
});
test("unlinked guests with the same name and local id cannot create a false shared identity", () => {
  const a=careerRound("a",1),b=careerRound("b",2);delete a.players![1].accountUserId;delete b.players![1].accountUserId;
  assert.equal(deriveCareerRivalries([a,b],"owner").length,2);
});
test("rival rows and hero cannot render opponent financial fields, even if injected", () => {
  const r={...deriveCareerRivalries([careerRound("one",1)],"owner")[0],moneyWon:946731,moneyLost:857642,balance:768953,opponent:{moneyWon:946731,moneyLost:857642,balance:768953}};
  for(const name of ["RivalryRow","RivalryHero"]) {
    const html=renderCareer("app/components/career-rivalries.tsx",name,{rivalry:r,displayName:"QA Owner",onOpen(){}});
    assert.doesNotMatch(html,/946731|857642|768953|\$|moneyWon|moneyLost|balance/);assert.match(html,/QA Rival/);
  }
});
test("empty rivalries gives a working discovery action and no fabricated rivals", () => {
  const html=renderCareer("app/components/career-rivalries.tsx","CareerRivalries",{rounds:[],userId:"owner",onFindRival(){}});
  assert.match(html,/Juega con amigos para empezar/);assert.match(html,/Encuentra un rival/);assert.doesNotMatch(html,/Rafael|Luis/);
});
