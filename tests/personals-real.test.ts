import assert from "node:assert/strict";
import test from "node:test";
import { calculatePersonalBet, calculatePersonalBets } from "../lib/engine";
import { migratePersonalNassau } from "../lib/personal-nassau";
import { snapshotPersonalResult } from "../lib/personal-history";
import { realCases, realCourse, realGross, realOrder, realPersonal, realPlayers, realScores } from "./fixtures/personals-real";

test("real supplied scores total 82/68/87/91/84", () => {
  assert.deepEqual(Object.values(realGross).map(s => s.reduce((a,b)=>a+b,0)), [82,68,87,91,84]);
});
for (const c of realCases) test(`REAL La Vista Temporary: Said vs ${c.id}, net ${c.net}`, () => {
  const result = calculatePersonalBet(realPersonal(c),"said",realCourse,realScores,realOrder);
  assert.deepEqual(Object.values(result.matchPoints), c.match);
  assert.deepEqual(Object.values(result.medalDiff), c.medal);
  assert.deepEqual(Object.values(result.componentMoney),c.money);
  const amounts = Object.values(result.componentMoney);
  assert.deepEqual([amounts.reduce((sum,n)=>sum+Math.max(0,n),0), amounts.reduce((sum,n)=>sum+Math.max(0,-n),0)],c.gross);
  assert.equal(result.totalMoney,c.net);
  assert.deepEqual([result.grossOwner,result.grossRival],c.gross);
});
test("four real Personals settle Said -800 and all transfers sum zero", () => {
  const result = calculatePersonalBets(realCases.map(realPersonal),"said",realPlayers,realCourse,realScores,realOrder);
  assert.deepEqual(result.balances,{said:-800,carlos:600,juan:200,flavio:-800,javier:800});
  assert.deepEqual(result.provisionalBalances,result.balances);
  assert.equal(Object.values(result.balances).reduce((a,b)=>a+b,0),0);
});

test("carry is independent, additive to pressure, and Total18 remains base", () => {
  const carlos = calculatePersonalBet(realPersonal(realCases[0]),"said",realCourse,realScores,realOrder);
  const flavio = calculatePersonalBet(realPersonal(realCases[2]),"said",realCourse,realScores,realOrder);
  assert.deepEqual(carlos.liveComponents.map(c=>[c.key,c.stake,c.carryIn]), [
    ["match1",100,0],["medal1",100,0],["match2",300,100],["medal2",200,0],["match18",100,0],["medal18",100,0],
  ]);
  assert.equal(flavio.liveComponents.find(c=>c.key==="medal2")?.carryIn,100);
  assert.equal(flavio.liveComponents.find(c=>c.key==="match2")?.carryIn,0);
  const base150 = calculatePersonalBet({...realPersonal(realCases[0]),baseValue:150},"said",realCourse,realScores,realOrder);
  assert.equal(base150.liveComponents.find(c=>c.key==="match2")?.stake,450);
});

test("incomplete first nine does not create carry; incomplete second is provisional only", () => {
  const bet=realPersonal(realCases[0]);
  const incomplete=structuredClone(realScores);
  delete incomplete[9];
  assert.equal(calculatePersonalBet(bet,"said",realCourse,incomplete,realOrder).liveComponents.find(c=>c.key==="match2")?.carryIn,0);
  const partial=Object.fromEntries(Object.entries(realScores).filter(([h])=>+h<=10));
  const result=calculatePersonalBet(bet,"said",realCourse,partial,realOrder);
  assert.equal(result.componentMoney.match2,0);
  assert.equal(result.liveComponents.find(c=>c.key==="match2")?.stake,300);
});

test("disabled first/second components cannot create or collect carry", () => {
  const bet=realPersonal(realCases[0]);
  for (const key of ["match1","match2"] as const) {
    const result=calculatePersonalBet({...bet,components:{...bet.components,[key]:false}},"said",realCourse,realScores,realOrder);
    assert.equal(result.liveComponents.find(c=>c.key==="match2")?.carryIn ?? 0,0);
  }
});

test("a final tie collects neither pressure nor carry, never pushes it into Total18", () => {
  const bet=realPersonal(realCases[0]);
  const scores=Object.fromEntries(realOrder.map(h=>[h,{said:4,carlos:4}]));
  const result=calculatePersonalBet({...bet,advantageStrokes:0},"said",realCourse,scores,realOrder);
  assert.equal(result.totalMoney,0);
  assert.equal(result.grossOwner+result.grossRival,0);
  assert.equal(result.liveComponents.find(c=>c.key==="match2")?.stake,300);
  assert.equal(result.liveComponents.find(c=>c.key==="match18")?.stake,100);
});

test("H10 start: first played H10-18, second H1-9; pressure never follows saved physical selector", () => {
  const order=[...realOrder.slice(9),...realOrder.slice(0,9)];
  const bet={...realPersonal(realCases[0]),pressureNine:"holes_10_18" as const};
  const result=calculatePersonalBet(bet,"said",realCourse,realScores,order);
  assert.deepEqual(result.matchPoints,{first:-1,second:0,total:-1});
  assert.deepEqual(result.liveComponents.slice(0,4).map(c=>[c.holes[0],c.pressureStake]),[[10,100],[10,100],[1,200],[1,200]]);
  assert.equal(result.pressureNine,"holes_1_9");
});

test("nine holes H1 or H10 have no second chronological nine, carry, pressure or Total18", () => {
  for(const order of [realOrder.slice(0,9),realOrder.slice(9)]) {
    const result=calculatePersonalBet(realPersonal(realCases[0]),"said",realCourse,realScores,order);
    assert.equal(result.liveComponents.length,2);
    assert.ok(result.liveComponents.every(c=>c.stake===100 && c.carryIn===0));
    assert.equal(result.componentMoney.match18,0);
  }
});

test("legacy missing carry stays off; migration is idempotent and preserves selected physical components", () => {
  const legacy={...realPersonal(realCases[0]),carryEnabled:undefined,nassauVersion:undefined,components:{match1:true,medal1:false,match2:false,medal2:true,match18:true,medal18:true}};
  const untouched=JSON.stringify(legacy);
  const migrated=migratePersonalNassau(legacy,10,18);
  assert.equal(migrated.carryEnabled,false);
  assert.deepEqual(migrated.components,{match1:false,medal1:true,match2:true,medal2:false,match18:true,medal18:true});
  assert.deepEqual(migratePersonalNassau(migrated,10,18),migrated);
  assert.equal(JSON.stringify(legacy),untouched);
  const old=calculatePersonalBet({...realPersonal(realCases[0]),carryEnabled:undefined},"said",realCourse,realScores,realOrder);
  assert.equal(old.totalMoney,-500);
});

test("JSON reload preserves exact scores, carry and payouts; changing draft cannot mutate saved history", () => {
  const bet=realPersonal(realCases[2]);
  const result=calculatePersonalBet(bet,"said",realCourse,realScores,realOrder);
  const snapshot=snapshotPersonalResult(bet,result,realPlayers);
  const stored=JSON.stringify(snapshot);
  const restored=JSON.parse(JSON.stringify({bet,scores:realScores}));
  assert.equal(calculatePersonalBet(restored.bet,"said",realCourse,restored.scores,realOrder).totalMoney,800);
  bet.carryEnabled=false;
  bet.baseValue=999;
  migratePersonalNassau(bet,10,18);
  assert.equal(JSON.stringify(snapshot),stored);
  assert.equal(snapshot.totalMoney,800);
});
