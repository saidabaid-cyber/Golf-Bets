import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as reconciliation from "../lib/ghin/score-reconciliation";
import { socialUI,uiText,uiNodes } from "./helpers/social-ui";
import type { NormalizedGhinScore } from "../lib/ghin/core";

const normalized:NormalizedGhinScore={id:"provider-1",playedOn:"2026-10-05",courseId:"123",courseName:"QA Club",teeId:"456",teeName:"Blancas",holes:18,grossScore:82,adjustedGrossScore:81,differential:8,courseRating:72,slopeRating:113,scoreType:"H",postingMethod:"M"};
function service() {
  const exports:any={};
  const source=ts.transpileModule(readFileSync("lib/ghin/score-import.server.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,require:(id:string)=>id==="node:crypto"?crypto:id==="./score-reconciliation"?reconciliation:{}});
  return exports as Record<"readImportState"|"importGhinScores"|"importPage"|"reconciliationRound"|"reconciliationEvidenceHash",(...args:any[])=>any>;
}
function round() {
  return {id:"canonical-round",local_id:"local-round",snapshot:{id:"local-round",ownerId:"owner",lifecycleState:"completed",date:"2026-10-05",roundHoles:18,order:Array.from({length:18},(_,i)=>i+1),scores:Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,{owner:i<10?5:4}])),courseName:"QA Club",teeName:"Blancas",courseSnapshot:{catalogCourseId:"club",catalogTeeId:"white"},backyardIndexSnapshots:[{playerId:"owner",adjustedGrossScore:81}]}};
}
const courses=[{course_id:"club",external_course_id:"123",sync_status:"CONFIRMED"}],tees=[{course_id:"club",tee_id:"white",external_tee_set_id:"456",sync_status:"CONFIRMED"}];
function database() {
  const provider:any[]=[],calls:any[]=[];const backyard=round(),original=structuredClone(backyard);
  const client={from(table:string){const filters:any[]=[];const chain:any={select(){return chain;},eq(key:string,value:any){filters.push([key,value]);return chain;},order(){return chain;},limit(){return chain;},then(resolve:any){calls.push({table,filters});return Promise.resolve({error:null,data:table==="handicap_provider_scores"?provider:table==="rounds_cloud"?[backyard]:table==="golf_course_provider_links"?courses:table==="golf_tee_provider_links"?tees:[]}).then(resolve);}};return chain;},async rpc(name:string,args:any){assert.equal(name,"import_ghin_scores_v1");assert.equal(args.p_owner_id,"owner");let added=0;for(const row of args.p_records){const existing=provider.find(p=>p.external_score_id===row.external_score_id);if(existing)Object.assign(existing,row);else{provider.push({...row,imported_at:"2026-10-06",updated_at:"2026-10-06"});added++;}}return{error:null,data:{importedNew:added,total:provider.length,matched:provider.filter(p=>p.linked_round_id).length,ambiguous:0,ghinOnly:0,syncedAt:"2026-10-06"}};}};
  return{client,provider,calls,backyard,original};
}
test("real service normalizes first import and repeats through one transactional RPC without rewriting a Backyard round",async()=>{
  const s=service(),db=database();const first=await s.importGhinScores(db.client,"owner","11103351",[normalized]);
  assert.equal(first.importedNew,1);assert.equal(first.matched,1);assert.equal(db.provider[0].linked_round_id,"canonical-round");
  assert.equal((await s.importGhinScores(db.client,"owner","11103351",[normalized])).importedNew,0);assert.equal(db.provider.length,1);assert.deepEqual(db.backyard,db.original);
  assert.ok(db.calls.filter(c=>["rounds_cloud","handicap_provider_scores","ghin_score_post_receipts"].includes(c.table)).every(c=>c.filters.some((f:any)=>f[0]==="owner_id"&&f[1]==="owner")));
  const page=await s.readImportState(db.client,"owner","11103351");assert.equal(page.records[0].linkedLocalId,"local-round");assert.equal(page.records[0].outOfSync,false);
});
test("material hole edit at the same gross changes linked evidence and never triggers a repost",()=>{
  const s=service(),r=round(),before=s.reconciliationEvidenceHash(s.reconciliationRound(r,"11103351",courses,tees));
  r.snapshot.scores[1].owner=6;r.snapshot.scores[2].owner=4;
  assert.notEqual(s.reconciliationEvidenceHash(s.reconciliationRound(r,"11103351",courses,tees)),before);
  assert.equal(s.reconciliationRound(r,"11103351",courses,tees).gross,82);
});
test("unconfirmed mappings and incomplete lifecycle cannot become a high-confidence card",()=>{
  const s=service(),r=round();assert.equal(s.reconciliationRound(r,"11103351",[],[]).courseId,null);
  r.snapshot.lifecycleState="live";assert.equal(s.reconciliationRound(r,"11103351",courses,tees),null);
});
test("private server pages bound provider data, preserve all links and aggregate only unambiguous raw gross",()=>{
  const s=service();const records=Array.from({length:45},(_,i)=>({...normalized,id:`p-${i}`,match:i===0?"MATCH_REVIEW_REQUIRED":"GHIN_ONLY",linkedRoundId:null,grossScore:i===1?null:82,importedAt:"2026-10-06"}));
  const page=s.importPage({records,syncedAt:"2026-10-06"},0);assert.equal(page.items.length,20);assert.equal(page.nextCursor,"20");assert.equal(page.grossTotals[18].rounds,43);assert.equal(page.grossTotals[18].sum,43*82);
  assert.equal(s.importPage({records,syncedAt:"2026-10-06"},40).items.length,5);
});
test("retained latest-20 presentation preserves linked Backyard provenance even if its provider card is older",()=>{
  const s=service();
  const retained=Array.from({length:20},(_,i)=>({...normalized,id:`retained-${i}`,match:"GHIN_ONLY",linkedRoundId:null}));
  const older={...normalized,id:"old-posted",match:"EXACT_MATCH",linkedRoundId:"canonical-round",linkedLocalId:"local-round",postingFingerprint:"a".repeat(64)};
  const page=s.importPage({records:retained,historicalLinks:[older],syncedAt:"2026-10-06"},0);
  assert.equal(page.total,20);assert.equal(page.items.length,20);assert.equal(page.nextCursor,null);
  assert.equal(page.links.length,1);assert.equal(page.links[0].linkedRoundId,"canonical-round");
  const unified=reconciliation.unifiedGhinHistory([{id:"local-round",date:normalized.playedOn!,courseName:"QA Club",teeName:"Blancas",holes:18,gross:82,lifecycle:"completed"}],[...page.items,...page.links]);
  assert.equal(unified.filter(r=>r.origin==="BACKYARD + GHIN").length,1);
});
test("provider UI is read-only, labels adjusted-only scores honestly and has no dead open CTA",()=>{
  const h=socialUI("app/components/ghin-import-history.tsx",{"score-reconciliation":reconciliation,"career-statistics":{careerDate:(v:any)=>v,careerNumber:(v:any)=>v??"—"}});
  const entry={id:"ghin:p",date:"2026-10-05",courseName:"QA Club",teeName:"Blancas",holes:18,gross:null,origin:"GHIN",backyardId:null,provider:{...normalized,grossScore:null,adjustedGrossScore:81,match:"GHIN_ONLY"}};
  const tree=h.render("GhinProviderCard",{entry});assert.match(uiText(tree),/81 Ajustado/);assert.match(uiText(tree),/GHIN Solo lectura/);assert.equal(uiNodes(tree).filter(n=>n.type==="button").length,0);
  assert.doesNotMatch(uiText(tree),/Atestada|Putts|Birdies|Reanudar/);
});
