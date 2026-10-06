import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reconcileGhinScores,unifiedGhinHistory,unifiedGrossMetrics,combineProviderGrossTotals, type ReconciliationRound,type ProviderScoreRecord } from "../lib/ghin/score-reconciliation";
import type { NormalizedGhinScore } from "../lib/ghin/core";
const score=(patch:Partial<NormalizedGhinScore>={}):NormalizedGhinScore=>({id:"external-1",playedOn:"2026-10-05",courseId:"23001",courseName:"Club de prueba",teeId:"100",teeName:"Blancas",holes:18,grossScore:82,adjustedGrossScore:81,differential:8,courseRating:72,slopeRating:113,scoreType:"H",postingMethod:"M",...patch});
const round=(patch:Partial<ReconciliationRound>={}):ReconciliationRound=>({id:"canonical-one",localId:"local-one",golferId:"11103351",playedOn:"2026-10-05",courseId:"23001",courseName:"Club de prueba",teeId:"100",teeName:"Blancas",holes:18,gross:82,adjustedGross:81,...patch});
const plan=(scores=[score()],rounds=[round()],extra:Partial<Parameters<typeof reconcileGhinScores>[0]>={})=>reconcileGhinScores({golferId:"11103351",scores,rounds,existing:[],posts:[],...extra});
const provider=(patch:Partial<ProviderScoreRecord>={}):ProviderScoreRecord=>({...score(),id:"external-1",linkedRoundId:null,linkedLocalId:null,match:"GHIN_ONLY",candidateRoundIds:[],importedAt:"2026-10-06",postingFingerprint:null,outOfSync:false,...patch});
test("unique provider IDs/date/holes/gross link a high-confidence match",()=>{
  const d=plan().decisions[0];assert.equal(d.match,"HIGH_CONFIDENCE_MATCH");assert.equal(d.linkedRoundId,"canonical-one");
});
test("second import preserves an existing canonical link after a local edit",()=>{
  const d=plan([score()],[round({gross:83})],{existing:[{id:"external-1",linkedRoundId:"canonical-one",postingFingerprint:null}]}).decisions[0];
  assert.equal(d.match,"EXACT_MATCH");assert.equal(d.linkedRoundId,"canonical-one");
});
test("round trip uses the saved provider ID and posting fingerprint",()=>{
  const d=plan([score()],[round()],{posts:[{roundId:"canonical-one",providerScoreId:"external-1",fingerprint:"f".repeat(64)}]}).decisions[0];
  assert.equal(d.match,"EXACT_MATCH");assert.equal(d.postingFingerprint,"f".repeat(64));
});
test("conflicting exact associations require review",()=>{
  const d=plan([score()],[round(),round({id:"two"})],{existing:[{id:"external-1",linkedRoundId:"canonical-one",postingFingerprint:null}],posts:[{roundId:"two",providerScoreId:"external-1",fingerprint:"f".repeat(64)}]}).decisions[0];
  assert.equal(d.match,"MATCH_REVIEW_REQUIRED");assert.equal(d.linkedRoundId,null);
});
test("provider response without a score ID retains the posting fingerprint only after a unique full identity match",()=>{
  const posts=[{roundId:"canonical-one",providerScoreId:null,fingerprint:"f".repeat(64)}];
  assert.equal(plan([score()],[round()],{posts}).decisions[0].postingFingerprint,"f".repeat(64));
  assert.equal(plan([score({teeId:null,teeName:null})],[round()],{posts}).decisions[0].postingFingerprint,null);
});
test("unmatched GHIN cards never overwrite richer Backyard data",()=>{
  const rounds=[round()],before=structuredClone(rounds);assert.equal(plan([score({playedOn:"2020-01-01"})],rounds).decisions[0].match,"GHIN_ONLY");assert.deepEqual(rounds,before);
});
for(const [label,patch] of Object.entries({date:{playedOn:"2026-10-04"},course:{courseId:"999"},tee:{teeId:"999"},holes:{holes:9},gross:{grossScore:80},adjusted:{adjustedGrossScore:80}}))
  test(`matching refuses conflicting ${label}`,()=>assert.equal(plan([score(patch)]).decisions[0].match,"GHIN_ONLY"));
test("names only support review; missing tee cannot match",()=>{
  const d=plan([score({courseId:null,teeId:null})]).decisions[0];assert.equal(d.match,"MATCH_REVIEW_REQUIRED");assert.equal(d.linkedRoundId,null);
  assert.equal(plan([score({courseId:null,teeId:null,teeName:null})]).decisions[0].match,"GHIN_ONLY");
});
test("match is scoped to the linked golfer",()=>assert.equal(plan([score()],[round({golferId:"11103349"})]).decisions[0].match,"GHIN_ONLY"));
test("two Backyard candidates preserve both for review",()=>{
  const d=plan([score()],[round(),round({id:"two",localId:"two"})]).decisions[0];assert.equal(d.match,"MATCH_REVIEW_REQUIRED");assert.equal(d.candidateRoundIds.length,2);
});
test("two provider IDs cannot silently link to the same physical round",()=>assert.ok(plan([score(),score({id:"external-2"})]).decisions.every(d=>d.match==="MATCH_REVIEW_REQUIRED"&&!d.linkedRoundId)));
test("existing exact association wins over a competing unconfirmed card",()=>{
  const ds=plan([score(),score({id:"external-2"})],[round()],{existing:[{id:"external-1",linkedRoundId:"canonical-one",postingFingerprint:null}]}).decisions;
  assert.equal(ds[0].match,"EXACT_MATCH");assert.equal(ds[1].match,"MATCH_REVIEW_REQUIRED");
});
test("raw and adjusted totals are not interchangeable",()=>{
  assert.equal(plan([score({grossScore:null,adjustedGrossScore:82})]).decisions[0].match,"GHIN_ONLY");
  assert.equal(plan([score({grossScore:null,adjustedGrossScore:81})]).decisions[0].match,"HIGH_CONFIDENCE_MATCH");
});
test("invalid cards are counted; repeated external IDs yield one decision",()=>{
  const r=plan([score(),score(),score({id:null}),score({id:"bad",playedOn:"2026-02-31"}),score({id:"empty",grossScore:null,adjustedGrossScore:null})]);
  assert.equal(r.decisions.length,1);assert.equal(r.ignoredInvalid,3);
});
test("unified history displays one linked card with richer Backyard total",()=>{
  const rows=unifiedGhinHistory([{id:"local-one",date:"2026-10-05",courseName:"Backyard club",teeName:"Blancas",holes:18,gross:83}],[provider({linkedRoundId:"canonical-one",linkedLocalId:"local-one",match:"EXACT_MATCH"})]);
  assert.equal(rows.length,1);assert.equal(rows[0].origin,"BACKYARD + GHIN");assert.equal(rows[0].gross,83);
});
test("sources order by played date, not arbitrary IDs",()=>{
  const rows=unifiedGhinHistory([{id:"z",date:"2026-10-05",courseName:"Club",teeName:"Blancas",holes:18,gross:82}],[provider({id:"aaa",playedOn:"2026-10-06"})]);
  assert.equal(rows[0].origin,"GHIN");assert.equal(rows[1].origin,"BACKYARD");
});
test("aggregate never manufactures gross from adjusted-only data",()=>{
  assert.deepEqual(unifiedGrossMetrics(unifiedGhinHistory([],[provider({grossScore:null}),provider({id:"two",grossScore:80})]),18),{rounds:1,average:80,best:80});
  assert.deepEqual(combineProviderGrossTotals([{gross:80},{gross:90}],{rounds:1,sum:70,best:70}),{rounds:3,average:80,best:70});
});
test("import route is DEV/owner/session bound, separate from editable round writes",()=>{
  const route=readFileSync("app/api/profile/ghin/import/route.ts","utf8"),server=readFileSync("lib/ghin/score-import.server.ts","utf8");
  assert.match(route,/VERCEL_ENV !== "preview"/);assert.match(route,/integration\/backyard-current/);assert.match(route,/isolatedPreviewDatabaseEnabled/);
  assert.match(route,/ghinUserContext/);assert.match(route,/context\.userId,context\.golferId/);assert.match(route,/REAUTH_REQUIRED/);
  assert.match(server,/rpc\("import_ghin_scores_v1"/);assert.doesNotMatch(server,/\.insert\(|\.delete\(|\.update\((?!JSON\.stringify)/);
  assert.doesNotMatch(route+server,/localStorage|sessionStorage|GHIN_TEST_PASSWORD|GHIN_TEST_LOGIN/);
});
test("additive provider schema has unique identity, owner RLS and server-only writes",()=>{
  const sql=readFileSync("supabase/migrations/20261006184558_ghin_owned_score_import.sql","utf8");
  assert.match(sql,/primary key \(owner_id,provider,external_score_id\)/);assert.match(sql,/enable row level security/);assert.match(sql,/owner_id = \(select auth.uid\(\)\)/);
  assert.match(sql,/grant select on public.handicap_provider_scores to authenticated/);assert.match(sql,/grant select, insert, update on public.handicap_provider_scores to service_role/);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/GHIN_IMPORT_ROUND_OWNER_MISMATCH/);
  assert.doesNotMatch(sql,/\b(?:drop|delete|truncate)\s+(?:table|from)\b/i);assert.doesNotMatch(sql,/\b(?:password|bearer|cookie|raw_response)\s+(?:text|jsonb|bytea)/i);
});
