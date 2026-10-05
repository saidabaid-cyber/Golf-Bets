import assert from "node:assert/strict";
import test from "node:test";
import { buildGolfInsights } from "../lib/golf-insights";
import { careerScoreSamples,careerPrecision } from "../lib/career-statistics";
import { createTotalScoreRound } from "../lib/total-score-round";
import { careerRound } from "./helpers/career-round";
import { renderCareer } from "./helpers/render-career";
test("round history includes declared totals without synthetic per-hole metrics",()=>{
  const card=careerRound("card",1),declared=createTotalScoreRound({id:"declared",course:card.courseSnapshot!,player:card.players![0],date:card.date,holes:18,start:1,total:79,now:"2026-09-02T12:00:00Z"});
  const samples=careerScoreSamples([card,declared],buildGolfInsights([card,declared]),"owner");
  assert.equal(samples.length,2);assert.equal(samples.find(r=>r.id==="declared")!.relativeToPar,undefined);
  const html=renderCareer("app/components/career-rounds.tsx","RoundScorecardPreview",{round:declared,row:samples.find(r=>r.id==="declared"),onOpen(){}});
  assert.match(html,/79/);assert.match(html,/Total declarado/);assert.doesNotMatch(html,/<td/);
});
test("explicit precision treats false and zero as data and ignores uncaptured/inferred GIR",()=>{
  const card=careerRound("card",1);card.putts={1:{"owner-player":0},2:{"owner-player":2}};
  card.advancedStats={1:{"owner-player":{fairwayHit:false,greenInRegulation:true,teeDistance:200}},2:{"owner-player":{fairwayHit:true,greenInRegulation:false,teeDistance:300}}};
  const p=careerPrecision([card],buildGolfInsights([card]),"owner");
  assert.equal(p.gir,50);assert.equal(p.greenAttempts,2);assert.equal(p.fairways,50);assert.equal(p.putts,1);assert.equal(p.distance,250);
});
test("scorecard preview renders real owner holes and historical navigation",()=>{
  const round=careerRound("card",1),row=careerScoreSamples([round],buildGolfInsights([round]),"owner")[0];
  const html=renderCareer("app/components/career-rounds.tsx","RoundScorecardPreview",{round,row,onOpen(){}});
  assert.match(html,/Primeros 9 hoyos/);assert.match(html,/<th scope="row">Par/);assert.match(html,/Ver scorecard completo/);
});
test("rounds empty, single point and many data charts remain honest and accessible",()=>{
  const html=renderCareer("app/components/career-rounds.tsx","CareerRounds",{rounds:[],history:[],userId:"owner",insights:buildGolfInsights([]),onCreateRound(){}});
  assert.match(html,/Tu historia empieza con tu primera ronda/);assert.match(html,/Sin datos suficientes/);
  const one=careerScoreSamples([careerRound("one",1)],buildGolfInsights([careerRound("one",1)]),"owner");
  const chart=renderCareer("app/components/career-rounds.tsx","RoundTrendChart",{rows:one});assert.match(chart,/role="img"/);assert.doesNotMatch(chart,/NaN|Infinity/);
  const many=Array.from({length:80},(_,i)=>({...one[0],id:`many-${i}`,date:`2026-${String(Math.floor(i/27)+1).padStart(2,"0")}-${String(i%27+1).padStart(2,"0")}`}));
  assert.match(renderCareer("app/components/career-rounds.tsx","RoundTrendChart",{rows:many}),/promedio por mes/);
});
