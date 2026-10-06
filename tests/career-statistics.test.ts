import assert from "node:assert/strict";
import test from "node:test";
import { careerTrend, careerSeason, careerDistribution, careerPrecision, ownCareerHistory, careerScoreSamples, careerNewestFirst } from "../lib/career-statistics";
import { buildGolfInsights, type ScoredRoundInsight } from "../lib/golf-insights";
import type { RoundSnapshot } from "../lib/types";
import { renderCareer } from "./helpers/render-career";
const row = (id: number, gross: number, holes: 9 | 18 = 18) => ({ id: String(id), date: `2026-01-${String(id).padStart(2, "0")}`, holeCount: holes, gross } as ScoredRoundInsight);
test("career same-day recency and trend follow played time rather than random round identifiers", () => {
  const rows=[90,86,80,78].map((gross,i)=>({...row(i+1,gross),id:["z-oldest","y-old","b-new","a-newest"][i],date:"2026-10-05",occurredAt:`2026-10-05T${12+i}:00:00Z`}));
  const samples=careerScoreSamples([],{...buildGolfInsights([]),recentRounds:rows},"owner");
  assert.deepEqual(samples.map(r=>r.id),["a-newest","b-new","y-old","z-oldest"]);
  assert.equal(careerTrend(samples),-9);
  const snapshots=rows.map(r=>({id:r.id,date:r.date,completedAt:r.occurredAt,updatedAt:r.id==="z-oldest"?"2026-10-06T20:00:00Z":r.occurredAt}));
  assert.deepEqual(snapshots.sort(careerNewestFirst).map(r=>r.id),samples.map(r=>r.id));
  assert.equal(careerNewestFirst({id:"a",date:"2026-10-05",completedAt:"invalid"},{id:"z",date:"2026-10-05"}),1);
});
test("career averages, seasonal comparison and trend separate 9 and 18 holes", () => {
  const rows = [row(1, 90), row(2, 86), row(3, 80), row(4, 78), row(5, 39, 9)];
  assert.equal(careerTrend(rows.slice(0, 4)), -9);
  assert.equal(careerTrend(rows), undefined);
  const season = careerSeason(rows, 2026, 18);
  assert.equal(season.average, 83.5); assert.equal(season.best, 78); assert.equal(season.months[0].rounds, 4);
  assert.equal(season.months[1].average, undefined); assert.equal(season.evolution, undefined);
  assert.equal(careerTrend([row(1, 90)]), undefined);
});
test("score distribution handles edges and filters the cohort", () => {
  const scores = [69, 70, 74, 75, 79, 80, 84, 85, 89, 90, 120].map((v,i) => row(i+1,v));
  assert.deepEqual(careerDistribution([...scores, row(12, 39, 9)], 18).map(b => b.count), [1,2,2,2,2,2]);
  assert.deepEqual(careerDistribution([],9).map(b => b.count), [0,0,0,0,0,0]);
});
test("precision is empty without explicit evidence; foreign-linked legacy owner is rejected", () => {
  assert.equal(careerPrecision([],buildGolfInsights([]),"owner").gir, undefined);
  const foreign = { id:"foreign", players:[{id:"p",accountUserId:"other"}], ownerId:"p" } as RoundSnapshot;
  assert.equal(ownCareerHistory([foreign],"owner").length,0);
});
test("overview has honest empty/GHIN states and keeps profile when statistics fail", () => {
  const props = { displayName:"Una persona sin avatar y con nombre largo", userId:"owner", index:{value:null,source:null}, insights:buildGolfInsights([]), rounds:[], ready:true, onView(){}, onCreateRound(){}, onOpenRound(){}, ghin:{enabled:false,profile:null} };
  const html = renderCareer("app/components/career-overview.tsx","CareerOverview",props);
  assert.match(html,/Tu historia empieza con tu primera ronda/); assert.match(html,/no está disponible en este entorno/);
  assert.doesNotMatch(html,/sincronizado automáticamente/);
  const error = renderCareer("app/components/career-overview.tsx","CareerOverview",{...props,error:true});
  assert.match(error,/Una persona sin avatar/); assert.match(error,/Esta información no está disponible/);
});
