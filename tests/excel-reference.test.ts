import assert from "node:assert/strict";
import test from "node:test";
import { calculateBallFriend, calculateFoursomes, calculateMonkey, calculateRabbits, calculateSkins, calculateUnits, payoutWinnerTakesFromAll, pendingSkinCarry } from "../lib/engine";
import type { BetConfig, Course, HoleScore, Player } from "../lib/types";

// Independent, reduced translations of the cited original workbook formulas.
// No engine helper is used to generate the expectations.
const ids=["a","b","c","d"];
const players:Player[]=ids.map(id=>({id,name:id,handicap:0}));
const course:Course={id:"excel-formulas",name:"Excel formula fixture",teeName:"",holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))};
const row=(values:number[])=>Object.fromEntries(ids.map((id,i)=>[id,values[i]]));
const sum=(values:Record<string,number>)=>Object.values(values).reduce((a,b)=>a+b,0);

// Cálculos M99:P99 → M922:R926 → S922:AF926. A fractional candidate
// competes by floor first, then MAX fractional remainder, not MIN remainder.
function excelDecimalWinners(gross:number[],handicaps:number[],si:number,pct:number) {
  const min=Math.min(...handicaps);
  const transformed=gross.map((g,i)=>{
    const h=(handicaps[i]-min)*pct/100;
    let stars=0, fraction=0;
    for(const threshold of [si,si+18]) {
      if(h>=threshold-.9999) stars++;
      if(h>threshold-1 && h<threshold) fraction+=1-(threshold-h);
    }
    return Math.round((g-stars+fraction)*1e9)/1e9;
  });
  const integerCandidates=transformed.filter(n=>Number.isInteger(n));
  const integerMin=integerCandidates.length ? Math.min(...integerCandidates) : Infinity;
  const fractions=transformed.filter(n=>!Number.isInteger(n) && n<=integerMin);
  if(!fractions.length) return transformed.flatMap((n,i)=>n===integerMin?[ids[i]]:[]);
  const lowestFloor=Math.floor(Math.min(...fractions));
  const maxFraction=Math.max(...fractions.filter(n=>Math.floor(n)===lowestFloor).map(n=>Math.round((n-lowestFloor)*1e9)/1e9));
  return transformed.flatMap((n,i)=>Math.floor(n)===lowestFloor && Math.abs(n-lowestFloor-maxFraction)<1e-8?[ids[i]]:[]);
}

test("Excel Skins/Rabbits decimal tie-break: 2160 independent formula comparisons",()=>{
  for(const handicaps of [[0,1,2,3],[3,7,11,15],[0,19,23,30]]) for(const pct of [40,60,80,100]) for(let si=1;si<=18;si++) for(let k=0;k<10;k++) {
    const p=players.map((p,i)=>({...p,handicap:handicaps[i]}));
    const gross=ids.map((_,i)=>3+((k*(i+1)+i)%5));
    const c={...course,holes:[{number:1,par:4,strokeIndex:si}]};
    const expected=excelDecimalWinners(gross,handicaps,si,pct);
    const cfg={enabled:true,value:50,hcpPct:pct,decimals:"decimal" as const,accumulate:true,participantIds:ids};
    const skins=calculateSkins(c,{1:row(gross)},p,cfg,[1]);
    assert.equal(skins.events[0]?.winnerId,expected.length===1?expected[0]:undefined,JSON.stringify({handicaps,pct,si,gross,expected}));
    const rabbits=calculateRabbits(c,{1:row(gross)},p,cfg,[1]);
    assert.equal(rabbits.events.find(e=>e.type==="grab")?.playerId,expected.length===1?expected[0]:undefined);
  }
});

test("Excel Skins E991:F993 pays carry on unique winner; final carry remains unpaid",()=>{
  const scores={1:row([4,4,5,6]),2:row([5,4,5,6]),3:row([4,4,4,4])};
  const result=calculateSkins(course,scores,players,{enabled:true,value:50,hcpPct:100,decimals:"decimal",accumulate:true,participantIds:ids},[1,2,3]);
  assert.deepEqual(result.won,{a:0,b:2,c:0,d:0});
  assert.deepEqual(result.events.map(pendingSkinCarry),[1,0,1]);
  assert.deepEqual(payoutWinnerTakesFromAll(players,result.won,50),{a:-100,b:300,c:-100,d:-100});
});

test("Excel rabbit state I851/I860/I861/I869: grab, retain, cash, free/carry, double cash",()=>{
  // A grabs, ties best on second, cashes tied best third. Three ties accumulate.
  // B grabs then wins outright: 2 rabbits; next cycle restarts immediately.
  const values=[[3,4,5,5],[4,4,5,5],[4,4,5,5],[4,4,4,4],[4,4,4,4],[4,4,4,4],[5,3,5,5],[5,3,5,5]];
  const scores=Object.fromEntries(values.map((v,i)=>[i+1,row(v)]));
  const result=calculateRabbits(course,scores,players,{enabled:true,value:100,hcpPct:100,decimals:"decimal",accumulate:true,participantIds:ids},values.map((_,i)=>i+1));
  assert.deepEqual(result.won,{a:1,b:2,c:0,d:0});
  assert.deepEqual(result.events.filter(e=>e.type==="win").map(e=>[e.hole,e.playerId,e.count]),[[3,"a",1],[8,"b",2]]);
  assert.deepEqual(payoutWinnerTakesFromAll(players,result.won,100),{a:100,b:500,c:-300,d:-300});
});

test("Excel Foursome D194:D197 and D228: all five outcomes, fixed + Patada matrix half payments",()=>{
  const values=[[3,4,4,5],[3,5,4,5],[3,6,4,5],[4,6,4,5],[5,6,4,5],[3,4,4,5]];
  const expected=[2,1,0,-1,-2,2]; // Sum2: fixed200 + points2*100 =400 each team member.
  const scores:Record<number,HoleScore>=Object.fromEntries(values.map((v,i)=>[i+1,row(v)]));
  const cfg:BetConfig["foursome"]={enabled:true,hcpPct:100,decimals:"round",segmentSize:6,mode:"fixed_points",fixedValue:200,pointValue:100,participantIds:ids};
  const result=calculateFoursomes(course,scores,players,cfg,[{id:"first",startIndex:0,endIndex:5,basePair:["a","b"]}],[1,2,3,4,5,6]);
  assert.deepEqual(result.matches[0].holePoints.map(h=>h.points),expected);
  assert.equal(result.matches[0].pointDiff,2);
  assert.equal(result.matches[0].fixedMoney,200);
  assert.equal(result.matches[0].pointMoney,200);
  // Matrix: MIN(200,200)*SIGN(2)*.5 + MIN(100,100)*2*.5 =200 per cross-rival.
  assert.deepEqual(result.balances,{a:400,b:400,c:-400,d:-400});
  assert.equal(sum(result.balances),0);
});

test("Excel Bola Amiga O129:AC129 cap9 and opponent reversal, uniform monetary settlement",()=>{
  const cfg:BetConfig["ballFriend"]={enabled:true,value:10,hcpPct:100,decimals:"round",maxScore:9,participantIds:ids};
  const result=calculateBallFriend(course,{1:row([3,10,4,5])},players,cfg,{1:{teamA:["a","b"]}},[1]);
  // TeamA raw3/10 => cap3/9 =>39. Its birdie reverses opponent45 to54.
  assert.equal(result.details[0].numberA,39);
  assert.equal(result.details[0].numberB,54);
  assert.equal(result.details[0].pointDiff,15);
  assert.deepEqual(result.balances,{a:150,b:150,c:-150,d:-150});
});

test("Excel Units/Copas matrices with equal stakes equal pairwise net quantities",()=>{
  const result=calculateUnits(players,[
    {id:"u1",hole:1,playerId:"a",amount:2,label:"Manual"},
    {id:"u2",hole:1,playerId:"b",amount:1,label:"Manual"},
    {id:"c1",hole:1,playerId:"a",amount:-1,label:"Copa"},
  ],{enabled:true,value:50,participantIds:ids});
  // Units: A+250 B+50 C-150 D-150. Copa: A-150 B+50 C+50 D+50.
  assert.deepEqual(result.balances,{a:100,b:100,c:-100,d:-100});
  assert.equal(sum(result.balances),0);
});

test("Excel Copas value is independent of positive Units; old rounds retain unit price",()=>{
  const events=[{id:"u",hole:1,playerId:"a",amount:2,label:"Manual"},{id:"c",hole:1,playerId:"b",amount:-1,label:"Copa"}];
  const result=calculateUnits(players,events,{enabled:true,value:100,copaValue:50,participantIds:ids});
  // A wins200 from each; B pays50 to each. C/D each pay A200, receive B50.
  assert.deepEqual(result.balances,{a:650,b:-350,c:-150,d:-150});
  assert.equal(sum(result.balances),0);
  const legacy=calculateUnits(players,events,{enabled:true,value:100,participantIds:ids});
  assert.deepEqual(legacy.balances,{a:700,b:-500,c:-100,d:-100});
  const other=calculateUnits(players,[{...events[1],label:"Otra negativa"}],{enabled:true,value:100,copaValue:50,participantIds:ids});
  assert.equal(other.balances.b,-300);
});

test("Excel Monkey F1459:F1461: all score order/tie patterns and pairwise M1491:M1493 payouts",()=>{
  const examples=[
    {gross:[3,4,5],points:[4,2,0],money:[120,0,-120]},
    {gross:[3,3,5],points:[3,3,0],money:[60,60,-120]},
    {gross:[3,5,5],points:[4,1,1],money:[120,-60,-60]},
    {gross:[4,4,4],points:[2,2,2],money:[0,0,0]},
  ];
  for(const example of examples) {
    const result=calculateMonkey(course,{1:row(example.gross)},players,{enabled:true,value:20,participantIds:ids.slice(0,3)},[1]);
    assert.deepEqual(Object.values(result.points),example.points);
    assert.deepEqual(Object.values(result.balances),example.money);
    assert.equal(sum(result.balances),0);
  }
});

test("Monkey uses only selected three HCPs, SI/SI+18, scores persist and missing config stays disabled",()=>{
  const p=players.map((p,i)=>({...p,handicap:[10,11,30,0][i]}));
  const cfg={enabled:true,value:20,participantIds:ids.slice(0,3)};
  const result=calculateMonkey(course,{1:row([4,5,6])},p,cfg,[1]);
  assert.deepEqual(result.details[0].net,{a:4,b:4,c:4});
  assert.equal(sum(result.balances),0);
  assert.deepEqual(calculateMonkey(course,{1:row([4,5,6])},p,JSON.parse(JSON.stringify(cfg)),[1]),result);
  assert.equal(calculateMonkey(course,{},p,undefined,[1]).details.length,0);
  assert.equal(calculateMonkey(course,{},p,{...cfg,participantIds:ids},[1]).valid,false);
});
