import assert from "node:assert/strict";
import test from "node:test";
import { careerIndexChart } from "../lib/career-index-chart";
import { careerAttestSummary } from "../lib/career-index-presentation";
import * as presentation from "../lib/career-index-presentation";
import * as statistics from "../lib/career-statistics";
import { socialUI,uiNodes,uiText,uiFind,settleUI } from "./helpers/social-ui";

test("index chart uses elapsed dates, supports plus handicaps, and never inserts observations",()=>{
  const input=[{date:"2026-01-01",value:-2},{date:"2026-01-02",value:1},{date:"2026-01-11",value:4}];
  const before=JSON.stringify(input),chart=careerIndexChart(input)!;
  assert.equal(chart.points.length,3);assert.equal(chart.min,-5);assert.equal(chart.max,5);
  assert.equal(chart.points[0].x,36);assert.equal(chart.points[1].x,65.4);assert.equal(chart.points[2].x,330);
  for(const point of chart.points)assert.ok(point.y>=28&&point.y<=166);
  assert.equal(JSON.stringify(input),before);
});
test("invalid or insufficient index history cannot render a synthetic chart",()=>{
  for(const points of [[],[{date:"2026-01-01",value:8}],[{date:"invalid",value:8},{date:"2026-01-01",value:NaN}]])assert.equal(careerIndexChart(points),null);
});
function panel(source:"BACKYARD"|"GHIN"|null="BACKYARD",verified=false) {
  const cards=[{roundId:"one",date:"2026-10-01",courseName:"Test course",score:80,currentHash:"current",version:1},{roundId:"two",date:"2026-09-01",courseName:"Test course",score:81,currentHash:"other",version:1}];
  const summary=careerAttestSummary(cards,[{round_id:"one",target_user_id:"owner",attester_id:"peer",expected_hash:"current",expected_version:1}],"owner");
  const h=socialUI("app/components/career-index-panel.tsx",{"career-index-presentation":presentation,"career-index-chart":{careerIndexChart},"career-statistics":statistics,"career-attest-client":{readCareerAttestSummary:async()=>summary}});
  const changes:Array<string|null>=[],props={userId:"owner",displayName:"Test Owner",accessToken:"test-token",index:{source,value:8},history:[],rounds:[],ghin:{profile:{associationStatus:verified?"VERIFIED":"LOOKUP_FOUND"}},onOpenRound(){}};
  return {h,render:(detail:string|null="attest")=>h.render("CareerIndexPanel",{props,detail,onDetail:(next:string|null)=>changes.push(next)}),changes};
}
test("20 indicators map one-to-one to attested, pending and missing real cards",async()=>{
  const p=panel();p.render();await settleUI();const tree=p.render(),dots=uiNodes(tree).filter(n=>n.type==="i");
  assert.equal(dots.length,20);assert.equal(dots[0].props.className,"valid");assert.equal(dots[1].props.className,"pendingDot");assert.ok(dots.slice(2).every(n=>n.props.className===undefined));
  assert.match(uiText(tree),/5%/);assert.match(uiText(tree),/1\/20 atestadas/);
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="lastSummary").length,1);
});
test("source badge fails closed when GHIN association is not verified",()=>{
  const p=panel("GHIN");const tree=p.render("index");assert.match(uiText(tree),/SIN ÍNDICE/);assert.doesNotMatch(uiText(tree),/GHIN|8/);
});
test("verified GHIN source keeps provenance behind the information action",()=>{
  const p=panel("GHIN",true);let tree=p.render("index");assert.match(uiText(tree),/GHIN/);
  const badge=uiFind(tree,n=>n.type==="button"&&n.props.className==="sourceBadge");badge.props.onClick();tree=p.render("index");assert.match(uiText(tree),/Fuente GHIN verificada/);
  uiFind(tree,n=>n.props["aria-label"]==="Volver a Carrera").props.onClick();assert.deepEqual(p.changes,[null]);
});
test("post skeleton reserves avatar, content, metrics and action structure",()=>{
  const h=socialUI("app/components/cloud-social-activity.tsx"),tree=h.render("SocialFeedSkeleton",{});
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="skeletonPost").length,3);
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="skeletonAuthor").length,3);
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="skeletonMetrics").length,3);
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="skeletonActions").length,3);
});
