import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import * as aliases from "../lib/ghin/catalog-alias";
import * as reconciliation from "../lib/ghin/score-reconciliation";

function fixture() {
  const geometry=Array.from({length:18},(_,i)=>({hole_number:i+1,par:4,yards:300}));
  const hash=aliases.ghinHoleGeometryHash(geometry),verified_at="2026-10-06T23:04:47Z";
  const courses:any[]=[{id:"historical-course",club_id:"club",origin:"BACKYARD_ADMIN",is_provisional:false,holes:18,total_par:72,catalog_metadata:{
    ghin_provider_alias_v1:{status:"CONFIRMED",provider:"GHIN",club_id:"club",canonical_course_id:"official-course",course_provider_link_id:"course-link",provider_course_id:"123",provider_facility_id:"456",verified_at}}}];
  const assignment:any={courseId:"historical-course",teeId:"historical-gold",teeName:"Doradas",par:72,rating:68.4,slope:121,yards:5400,
    indexRatingEvidence:{courseId:"historical-course",teeId:"historical-gold",courseRating:68.4,slopeRating:121,ratingGender:"MEN"}};
  const tees:any[]=[{id:"historical-gold",course_id:"historical-course",catalog_metadata:{holes:geometry,ghin_provider_alias_v1:{status:"CONFIRMED",provider:"GHIN",
    canonical_course_id:"official-course",canonical_tee_id:"official-gold",course_provider_link_id:"course-link",tee_provider_link_id:"tee-link",provider_tee_set_id:"789",verified_at,
    snapshot_attributes:{holes:18,par:72,rating:68.4,slope:121,yards:5400,rating_gender:"MEN"},
    evidence:{course_id:"123",tee_id:"789",local_geometry_hash:hash,provider_geometry_hash:hash,stroke_allocation_differs:true}}}}];
  const courseLinks:any[]=[{id:"course-link",course_id:"official-course",external_course_id:"123",external_facility_id:"456",sync_status:"CONFIRMED"}];
  const teeLinks:any[]=[{id:"tee-link",course_id:"official-course",tee_id:"official-gold",external_tee_set_id:"789",course_provider_link_id:"course-link",sync_status:"CONFIRMED"}];
  return {assignment,holes:18,frozenHoles:geometry.map(h=>({number:h.hole_number,par:h.par,yards:h.yards,strokeIndex:19-h.hole_number})),courses,tees,courseLinks,teeLinks};
}
test("audited physical alias resolves existing provider links while preserving all frozen data",()=>{
  const f=fixture(),before=structuredClone(f);
  assert.deepEqual(aliases.resolveGhinCatalogAlias(f),{providerCourseId:"123",providerTeeSetId:"789",canonicalCourseId:"official-course",canonicalTeeId:"official-gold",strokeAllocationDiffers:true});
  assert.deepEqual(f,before);
});
test("a name or generic search alias alone can never confirm a physical course/tee",()=>{
  const f=fixture();f.courses[0].catalog_metadata={name:"La Vista",search_aliases:["official-course"]};assert.equal(aliases.resolveGhinCatalogAlias(f),null);
});
test("alias rejects ratings, gender, geometry, provisional, stale and mismatched identities",()=>{
  const edits:Array<(f:ReturnType<typeof fixture>)=>void>=[
    f=>f.assignment.slope=125,f=>f.assignment.rating=70.8,f=>f.assignment.yards++,f=>f.assignment.indexRatingEvidence.ratingGender="WOMEN",
    f=>f.assignment.indexRatingEvidence.teeId="other",f=>f.frozenHoles[17].yards++,f=>f.frozenHoles.pop(),f=>f.courses[0].is_provisional=true,
    f=>f.tees[0].catalog_metadata.holes[0].yards++,f=>f.courseLinks[0].sync_status="STALE",f=>f.teeLinks[0].sync_status="CANDIDATE",
    f=>f.courseLinks[0].external_course_id="999",f=>f.courseLinks[0].external_facility_id="999",f=>f.teeLinks[0].course_provider_link_id="other",
    f=>f.tees[0].catalog_metadata.ghin_provider_alias_v1.verified_at="bad",f=>f.courses[0].catalog_metadata.ghin_provider_alias_v1.club_id="other",
    f=>f.tees[0].catalog_metadata.ghin_provider_alias_v1.evidence.provider_geometry_hash="different",
  ];
  for(const edit of edits){const f=fixture();edit(f);assert.equal(aliases.resolveGhinCatalogAlias(f),null);}
});
test("reconciliation consumes the alias without rewriting a round or richer evidence",()=>{
  const f=fixture(),exports:any={};
  runInNewContext(ts.transpileModule(readFileSync("lib/ghin/score-import.server.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(id:string)=>id==="./catalog-alias"?aliases:id==="./score-reconciliation"?reconciliation:id==="node:crypto"?crypto:{}});
  const round={id:"round",local_id:"local",snapshot:{ownerId:"owner",lifecycleState:"completed",date:"2026-10-05",roundHoles:18,
    order:Array.from({length:18},(_,i)=>i+1),scores:Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,{owner:4}])),
    playerTeeAssignments:[{...f.assignment,playerId:"owner"}],courseSnapshot:{holes:f.frozenHoles},notes:"Rich local evidence"}};
  const before=structuredClone(round);
  const result=exports.reconciliationRound(round,"123456",f.courseLinks,f.teeLinks,{courses:f.courses,tees:f.tees});
  assert.equal(result.courseId,"123");assert.equal(result.teeId,"789");assert.equal(result.gross,72);assert.deepEqual(round,before);
  round.snapshot.lifecycleState="cancelled";assert.equal(exports.reconciliationRound(round,"123456",f.courseLinks,f.teeLinks,{courses:f.courses,tees:f.tees}),null);
});
test("reconciliation bulk-reads only catalog assignments from the owner, not one request per round",async()=>{
  const f=fixture(),exports:any={};
  runInNewContext(ts.transpileModule(readFileSync("lib/ghin/score-import.server.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(id:string)=>id==="./catalog-alias"?aliases:id==="./score-reconciliation"?reconciliation:id==="node:crypto"?crypto:{}});
  const calls:any[]=[],rounds=Array.from({length:50},(_,i)=>({id:`r-${i}`,local_id:`l-${i}`,snapshot:{ownerId:"owner",lifecycleState:"completed",roundHoles:18,date:"2026-10-05",
    order:Array.from({length:18},(_,i)=>i+1),scores:Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,{owner:4}])),playerTeeAssignments:[{...f.assignment,playerId:"owner"}],courseSnapshot:{holes:f.frozenHoles}}}));
  const data:any={rounds_cloud:rounds,handicap_provider_scores:[],ghin_score_post_receipts:[],golf_course_provider_links:f.courseLinks,golf_tee_provider_links:f.teeLinks,golf_courses:f.courses,golf_course_tees:f.tees};
  const client={from(table:string){const filters:any[]=[],q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push([k,v]);return q;},in:(k:string,v:any)=>{filters.push([k,v]);return q;},order:()=>q,limit:()=>q,then:(resolve:any)=>{calls.push({table,filters});return Promise.resolve({data:data[table],error:null}).then(resolve);}};return q;}};
  const state=await exports.readImportState(client,"owner","123456");assert.equal(state.candidates.length,50);
  assert.equal(calls.filter(c=>c.table==="golf_courses").length,1);assert.equal(calls.filter(c=>c.table==="golf_course_tees").length,1);
  assert.ok(calls.filter(c=>c.table==="rounds_cloud").every(c=>c.filters.some((f:any)=>f[0]==="owner_id"&&f[1]==="owner")));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c.table==="golf_courses").filters)),[["id",["historical-course"]]]);
});
