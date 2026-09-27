// Existing synthetic account only. Creates new QA rounds with --write-rounds;
// never edits/deletes existing history, Auth, catalog, preferences or emails.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,deploymentMutationBoundFetch,verifyPreviewBundleBinding,verifyPreviewDeploymentIdentity} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig(process.env);
assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const rawRequest=credentialBoundFetch(config.previewOrigin),databaseFetch=credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config,rawRequest,databaseFetch);const request=deploymentMutationBoundFetch(config,rawRequest);
const require=createRequire(import.meta.url);
const {nearestReviewedClubs}=require('../.test-dist/lib/review-course-catalog.js');
const {createTotalScoreRound,totalScoreOrder}=require('../.test-dist/lib/total-score-round.js');
const {teeAssignmentSnapshot}=require('../.test-dist/lib/player-tee-assignments.js');
const {initialBets}=require('../.test-dist/lib/new-round-bets.js');
const fixture=JSON.parse(readFileSync(process.env.CATALOG_QA_FIXTURE||'.qa-artifacts/catalog-b.private.json','utf8'));
assert.equal(fixture.ref,config.projectRef);assert.ok(fixture.email.endsWith('@example.invalid'));
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:databaseFetch}};
let db,session;
async function login(){db=createClient(config.supabaseOrigin,config.publicKey,options);const r=await db.auth.signInWithPassword({email:fixture.email,password:fixture.password});assert.equal(r.error,null);assert.equal(r.data.user.id,fixture.id);session=r.data.session;}
await login();
async function app(path,method='GET',body,expected=200){
 const r=await request(config.previewOrigin+path,{method,headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.equal(r.status,expected,`${path}: ${r.status} ${data.code||''}`);return data;
}
const report={preview:config.previewOrigin,ref:config.projectRef,geographic:[],rounds:[],emailsSent:0,authChanges:0,historicalWrites:0};
for(const [query,expectedId] of [['Cristo','course-el-cristo'],['lagarto','course-cola-de-lagarto']]){
 const response=await rawRequest(`${config.previewOrigin}/api/courses/search?q=${encodeURIComponent(query)}`,{cache:'no-store'});
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.total,1);assert.deepEqual(body.courses.map(course=>course.courseId),[expectedId]);
}
{
 const response=await rawRequest(`${config.previewOrigin}/api/courses/search?nearby=1&lat=19.008297&lng=-98.254634`,{cache:'no-store'});
 const body=await response.json();assert.equal(response.status,401);assert.deepEqual(body,{error:'authentication_required',code:'AUTH_REQUIRED'});
 report.publicNearby={status:response.status,code:body.code};
}
{
 const nearby=await app('/api/courses/search?nearby=1&lat=19.008297&lng=-98.254634&limit=3');
 const expected=[
  ['club-la-vista','LA VISTA COUNTRY CLUB'],
  ['club-campestre-puebla','CLUB CAMPESTRE DE PUEBLA'],
  ['review-club-75f6ac3a0e37a69eabd3','CLUB DE GOLF LAS FUENTES'],
  ['review-club-9c0700f229794a278011','CLUB DE GOLF LA HUERTA'],
  ['club-cola-de-lagarto','COLA DE LAGARTO CAMPO MÍTICO'],
  ['club-el-cristo','CLUB CAMPESTRE EL CRISTO'],
 ];
 assert.equal(nearby.total,expected.length);assert.deepEqual(nearby.courses.map(course=>[course.clubId,course.clubName]),expected);
 assert.equal(new Set(nearby.courses.map(course=>course.clubId)).size,expected.length);
 assert.ok(nearby.courses.every((course,index)=>course.distanceKm<=50&&(index===0||nearby.courses[index-1].distanceKm<=course.distanceKm)));
 report.nearbyEndpoint={origin:{latitude:19.008297,longitude:-98.254634},radiusKm:50,provider:nearby.provider,courses:nearby.courses.map(course=>({clubId:course.clubId,name:course.clubName,distanceKm:course.distanceKm}))};
}
const catalog=await app('/api/courses/catalog');assert.equal(catalog.total,176);
const expectedCatalog=JSON.parse(readFileSync('data/qa/course-audit-source.json','utf8'));
const expectedGeolocated=new Set(expectedCatalog.clubs.filter(club=>Number.isFinite(club.latitude)&&Number.isFinite(club.longitude)&&club.locationEvidence).map(club=>club.id)).size;
const catalogCounts={clubs:new Set(catalog.courses.map(c=>c.clubId)).size,courses:catalog.courses.length,
 geolocated:new Set(catalog.courses.filter(c=>c.locationEvidence&&Number.isFinite(c.latitude)).map(c=>c.clubId)).size,
 tees:catalog.courses.reduce((sum,c)=>sum+c.teeCount,0),complete:catalog.courses.reduce((sum,c)=>sum+c.completeCards,0)};
assert.deepEqual(catalogCounts,{clubs:153,courses:176,geolocated:expectedGeolocated,tees:769,complete:758});
assert.equal(new Set(catalog.courses.map(c=>c.clubId)).size,153);
assert.equal(new Set(catalog.courses.filter(c=>c.locationEvidence&&Number.isFinite(c.latitude)).map(c=>c.clubId)).size,expectedGeolocated);
for(const [city,point] of Object.entries({Puebla:[19.02,-98.25],CDMX:[19.4326,-99.1332],Monterrey:[25.67,-100.31],Guadalajara:[20.67,-103.35],Queretaro:[20.59,-100.39],Leon:[21.12,-101.68],Cancun:[21.16,-86.83],LosCabos:[22.9,-109.91],PuertoVallarta:[20.65,-105.23],Acapulco:[16.81,-99.82]})){
 const nearby=nearestReviewedClubs(catalog.courses,{latitude:point[0],longitude:point[1]});assert.ok(nearby.length>=3);assert.equal(new Set(nearby.map(c=>c.clubId)).size,nearby.length);assert.ok(nearby.every((club,index)=>index===0||nearby[index-1].distanceKm<=club.distanceKm));assert.ok(nearby.every(club=>club.distanceKm<=50));
 report.geographic.push({city,clubs:nearby.map(c=>({name:c.clubName,km:Math.round(c.distanceKm*10)/10}))});
}
const mexico=await app('/api/courses/catalog?q=Mexico'),accent=await app('/api/courses/catalog?q=M%C3%A9xico');assert.deepEqual(mexico.courses.map(c=>c.id),accent.courses.map(c=>c.id));
const vista=(await app('/api/courses/catalog?courseId=course-la-vista')).cards;
const campestre=(await app('/api/courses/catalog?courseId=course-campestre-puebla')).cards;
assert.equal(vista.length,4);assert.equal(campestre.length,5);
{
 const cards=(await app('/api/courses/catalog?courseId=review-course-31612')).cards;
 assert.equal(cards.filter(c=>c.holes.length===18).length,3);assert.ok(cards.every(c=>c.rating===undefined));
}
{
 const cards=(await app('/api/courses/catalog?courseId=review-course-36036')).cards;
 assert.equal(cards.filter(c=>c.holes.length===9).length,3);assert.ok(cards.every(c=>c.rating===undefined));
}
const historyBefore=(await app('/api/cloud/rounds')).rounds;
const hash=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
const baseline=new Map(historyBefore.map(r=>[r.id,hash(r)]));
const owner={id:`account-${fixture.id}`,accountUserId:fixture.id,name:'Catálogo QA sintético',handicap:null};
if(process.argv.includes('--write-rounds')){
 for(const [mode,holes,start] of ['full','score_only','total'].flatMap(mode=>[[mode,9,1],[mode,9,10],[mode,18,1]])){
  const cards=mode==='full'?campestre:vista,course=structuredClone(cards[0]),now=new Date().toISOString();
  const order=totalScoreOrder(holes,start);const total=order.reduce((sum,n)=>sum+course.holes.find(h=>h.number===n).par,0);
  let round=createTotalScoreRound({id:`catalog-qa-${randomUUID()}`,course,player:owner,date:now.slice(0,10),holes,start,total,now});
  if(mode!=='total'){
   delete round.totalScoreCapture;
   const guest={id:`guest-${randomUUID()}`,name:'Invitado QA sintético',handicap:18};
   round.players=[owner,guest];round.betConfig=initialBets(round.players.map(p=>p.id));
   round.playerTeeAssignments=[teeAssignmentSnapshot(owner.id,course,now),teeAssignmentSnapshot(guest.id,cards[1],now)];
   round.scores=Object.fromEntries(order.map(n=>[n,{[owner.id]:course.holes.find(h=>h.number===n).par,[guest.id]:cards[1].holes.find(h=>h.number===n).par+1}]));
   if(mode==='score_only')round.presentation.playMode='score_only';else delete round.presentation.playMode;
  }
  const original=structuredClone(round);const saved=await app('/api/cloud/rounds','POST',{round},201);
  await app('/api/cloud/rounds','POST',{round},409);
  // Changing an in-memory catalog object must not change the persisted snapshot.
  course.holes[0].yards=1;course.teeName='LOCAL_MUTATION_NOT_PERSISTED';
  await login();const loaded=(await app('/api/cloud/rounds')).rounds.filter(r=>r.id===round.id);assert.equal(loaded.length,1);
  assert.deepEqual(loaded[0].courseSnapshot,original.courseSnapshot);assert.deepEqual(loaded[0].playerTeeAssignments,original.playerTeeAssignments);
  assert.deepEqual(loaded[0].order,order);assert.deepEqual(loaded[0].scores,original.scores);assert.equal(loaded[0].presentation.playMode,original.presentation.playMode);
  if(mode==='total'){assert.deepEqual(loaded[0].scores,{});assert.equal(loaded[0].totalScoreCapture.grossTotal,total);}
  else assert.notEqual(loaded[0].playerTeeAssignments[0].teeId,loaded[0].playerTeeAssignments[1].teeId);
  report.rounds.push({mode,holes,start,id:round.id,cloudId:saved.roundId,snapshotReadback:true,newSession:true,noDuplicate:true});
 }
}
const historyAfter=(await app('/api/cloud/rounds')).rounds;
for(const [id,fingerprint]of baseline){assert.equal(hash(historyAfter.find(r=>r.id===id)),fingerprint,`Existing snapshot changed: ${id}`);}
if(process.argv.includes('--verify-created')){
 const previous=JSON.parse(readFileSync('.qa-artifacts/catalog-applied-cloud-report.json','utf8'));
 assert.equal(previous.ref,config.projectRef);assert.equal(previous.rounds.length,9);
 for(const expected of previous.rounds){
  const matches=historyAfter.filter(r=>r.id===expected.id);assert.equal(matches.length,1);
  const round=matches[0];assert.equal(round.roundHoles,expected.holes);assert.equal(round.startHole,expected.start);
  assert.deepEqual(round.order,totalScoreOrder(expected.holes,expected.start));assert.equal(round.courseSnapshot.holes.length,18);
  assert.equal(round.presentation?.playMode,expected.mode==='full'?undefined:'score_only');
  if(expected.mode==='total'){assert.deepEqual(round.scores,{});assert.ok(round.totalScoreCapture.grossTotal>0);}
  else {assert.equal(Object.keys(round.scores).length,expected.holes);assert.notEqual(round.playerTeeAssignments[0].teeId,round.playerTeeAssignments[1].teeId);}
 }
 report.rounds=previous.rounds;report.finalDeploymentReadback=true;
}
await verifyPreviewDeploymentIdentity(config,rawRequest);report.existingHistoryPreserved=baseline.size;report.catalogCounts=catalogCounts;
writeFileSync('.qa-artifacts/catalog-applied-cloud-report.json',JSON.stringify(report,null,2));
writeFileSync('.qa-artifacts/catalog-applied-auth.private.json',JSON.stringify({cookies:[],origins:[{origin:config.previewOrigin,localStorage:[{name:`sb-${config.projectRef}-auth-token`,value:JSON.stringify(session)}]}]}));
console.log(JSON.stringify(report,null,2));
