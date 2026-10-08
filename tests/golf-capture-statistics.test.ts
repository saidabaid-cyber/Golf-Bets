import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { golfCaptureStatistics } from "../lib/golf-capture-statistics";
import { buildGolfInsights } from "../lib/golf-insights";
import { StatsDashboard, type StatsCategory } from "../app/components/stats-dashboard";
import { careerRound } from "./helpers/career-round";
import { golfStatsSelection } from "../lib/golf-stats-navigation";
import { screenHref } from "../lib/app-navigation";
import { socialUI, uiFind, uiText } from "./helpers/social-ui";
import * as statsDomain from "../features/stats/domain";
import * as captureProjection from "../lib/golf-capture-statistics";
import * as statsNavigation from "../lib/golf-stats-navigation";
import * as careerStatistics from "../lib/career-statistics";
import * as golfInsights from "../lib/golf-insights";

test("stats selection survives round and back URLs without accepting invalid categories or periods",()=>{
  const search="?screen=stats&statsView=putting&statsPeriod=5&statsHoles=9&statsCourse=Campo";
  const next=screenHref("historyDetail",search,"real-round");
  assert.equal(golfStatsSelection(next.slice(1)).view,"putting");
  assert.equal(golfStatsSelection(search).scope,9);assert.equal(golfStatsSelection(search).window,5);
  assert.equal(golfStatsSelection("?statsView=admin&statsPeriod=999&statsHoles=0").view,"summary");
  assert.equal(golfStatsSelection("?statsPeriod=999").window,20);
});
test("category interactions switch real panels, retain filters and open the correct player's round",()=>{
  const round=careerRound("qa-round-id",1),opened:string[]=[];
  const ui=socialUI("app/components/stats-dashboard.tsx",{"domain":statsDomain,"golf-insights":golfInsights,"golf-capture-statistics":captureProjection,"golf-stats-navigation":statsNavigation,"career-statistics":careerStatistics,"insights":{structuredGolfInsightInput:()=>({sampleRounds:1})}});
  const props={rounds:[round],insights:buildGolfInsights([round]),consentOwnerId:"owner",onOpenHistory(){},onOpenRound(id:string){opened.push(id);}};
  let tree=ui.render("StatsDashboard",props);
  uiFind(tree,n=>n.type==="button"&&n.props.children==="Putting").props.onClick();tree=ui.render("StatsDashboard",props);
  assert.match(uiText(tree),/Aún no hay datos suficientes/);assert.doesNotMatch(uiText(tree),/Mejor score/);
  uiFind(tree,n=>n.type==="button"&&n.props.children==="Scoring").props.onClick();tree=ui.render("StatsDashboard",props);
  assert.match(uiText(tree),/Resultado por hoyo/);assert.match(uiText(tree),/18 hoyos reales/);
  uiFind(tree,n=>n.type==="button"&&uiText(n).includes("Campo QA sintético")).props.onClick();assert.deepEqual(opened,["qa-round-id"]);
});

test("capture projection keeps zero, missing, FIR par3 and owner attribution distinct",()=>{
  const round=careerRound("qa",1);
  round.courseSnapshot!.holes[0].par=3;
  round.putts={1:{"owner-player":0,"rival-player":3},2:{"owner-player":2}};
  round.advancedStats={1:{"owner-player":{fairwayHit:true,penaltyStrokes:0,greenInRegulation:false}},2:{"owner-player":{fairwayHit:false,penaltyStrokes:2,greenInRegulation:true,teeClub:"Driver",teeDistance:250}}};
  const before=JSON.stringify(round),rows=buildGolfInsights([round]).recentRounds;
  const facts=golfCaptureStatistics([round,round],rows,"owner");
  assert.equal(facts.holes,18);assert.equal(facts.puttHoles,2);assert.equal(facts.putts,2);assert.equal(facts.series[0].putts,null);
  assert.deepEqual(facts.puttDistribution,[1,0,1,0,0]);assert.equal(facts.firEligible,17);assert.equal(facts.firAttempts,1);assert.equal(facts.firHits,0);
  assert.equal(facts.girAttempts,2);assert.equal(facts.girHits,1);assert.equal(facts.penaltyHoles,2);assert.equal(facts.penalties,2);
  assert.equal(facts.clubs.get("Driver")?.totalYards,250);assert.equal(JSON.stringify(round),before);
  assert.equal(golfCaptureStatistics([round],rows,"stranger").holes,0);
});
test("complete putting counts zero, one, two, three and four+, without inferring GIR or penalties",()=>{
  const round=careerRound("full",2,5);round.putts=Object.fromEntries(round.order!.map((h,i)=>[h,{"owner-player":i%5}]));
  const facts=golfCaptureStatistics([round],buildGolfInsights([round]).recentRounds,"owner");
  assert.equal(facts.puttHoles,18);assert.equal(facts.series[0].putts,facts.putts);assert.deepEqual(facts.puttDistribution,[4,4,4,3,3]);
  assert.equal(facts.girAttempts,0);assert.equal(facts.penaltyHoles,0);
  const partial=structuredClone(round);delete partial.scores![18]["owner-player"];
  assert.equal(golfCaptureStatistics([partial],buildGolfInsights([partial]).recentRounds,"owner").holes,0);
});
test("statistics category panels use actual capture and separate nine from eighteen before period",()=>{
  const nine=careerRound("nine",3,4,5,9),eighteen=careerRound("eighteen",4,5);
  nine.putts=Object.fromEntries(nine.order!.map(h=>[h,{"owner-player":1}]));
  eighteen.putts=Object.fromEntries(eighteen.order!.map(h=>[h,{"owner-player":2}]));
  eighteen.advancedStats={1:{"owner-player":{fairwayHit:false,greenInRegulation:false,penaltyStrokes:0}}};
  const props={rounds:[nine,eighteen],consentOwnerId:"owner",insights:buildGolfInsights([nine,eighteen]),onOpenHistory(){},onOpenRound(){}};
  for(const category of ["summary","scoring","putting","driving","approach"] as StatsCategory[]){
    const html=renderToStaticMarkup(createElement(StatsDashboard,{...props,initialCategory:category}));
    assert.match(html,/1 tarjetas completas · 18 hoyos/);assert.doesNotMatch(html,/NaN|Infinity|undefined/);
    if(category==="putting")assert.match(html,/36\.0/);
    if(category==="driving")assert.match(html,/0 aciertos \/ 1 capturas/);
    if(category==="approach")assert.match(html,/Penalidades<\/span><b>0<\/b>/);
  }
});
test("missing optional captures produce honest category states instead of fake zeros",()=>{
  const round=careerRound("none",1),insights=buildGolfInsights([round]);
  for(const category of ["putting","driving","approach"] as StatsCategory[]){
    const html=renderToStaticMarkup(createElement(StatsDashboard,{rounds:[round],insights,initialCategory:category,consentOwnerId:"owner",onOpenHistory(){},onOpenRound(){}}));
    assert.match(html,/Aún no hay datos suficientes/);assert.doesNotMatch(html,/golfStatsRing|>Penalidades<|>0%<|>Putts por ronda</);
  }
});

test("FIR and GIR trends use captured denominators and penalty frequency excludes incomplete cards",()=>{
  const complete=careerRound("complete-zero",1),partial=careerRound("partial-penalty",2);
  complete.advancedStats=Object.fromEntries(complete.order!.map(h=>[h,{"owner-player":{penaltyStrokes:0}}]));
  partial.advancedStats={1:{"owner-player":{fairwayHit:true,greenInRegulation:false,penaltyStrokes:2}},2:{"owner-player":{fairwayHit:false,greenInRegulation:true}}};
  const props={rounds:[complete,partial],insights:buildGolfInsights([complete,partial]),consentOwnerId:"owner",onOpenHistory(){},onOpenRound(){}};
  const driving=renderToStaticMarkup(createElement(StatsDashboard,{...props,initialCategory:"driving"}));
  assert.match(driving,/FIR por ronda/);assert.match(driving,/1 de 2 capturas/);assert.match(driving,/1 rondas con captura/);
  const approach=renderToStaticMarkup(createElement(StatsDashboard,{...props,initialCategory:"approach"}));
  assert.match(approach,/GIR por ronda/);assert.match(approach,/1 de 2 capturas/);
  assert.match(approach,/Penalidades por ronda: <b>0\.0<\/b> · 0\/1 tarjetas/);
  assert.match(approach,/Penalidades<\/span><b>2<\/b>/);
});
