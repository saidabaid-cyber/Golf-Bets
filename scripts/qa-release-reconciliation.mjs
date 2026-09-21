// Read-only reconciliation: existing synthetic identities, final immutable Preview.
// Does not send email, grant consent, alter Auth or mutate historical snapshots.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig();
assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const request=credentialBoundFetch(config.previewOrigin);
await verifyPreviewBundleBinding(config,request);
const require=createRequire(import.meta.url);
const catalogs=require('../.test-dist/lib/golf-equipment-catalog.js');
const {nearestReviewedClubs,reviewedClubsLocationSummary}=require('../.test-dist/lib/review-course-catalog.js');
const fixtures=[JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json')).find(f=>f.label==='C'),JSON.parse(readFileSync('.qa-artifacts/catalog-b.private.json'))];
const report={preview:config.previewOrigin,ref:config.projectRef,mutations:0,emails:0,consentWrites:0,checks:[],catalogs:[]};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json=value=>JSON.parse(JSON.stringify(value));
async function login(f){
 assert.equal(f.ref,config.projectRef);assert.ok(f.email.endsWith('@example.invalid'));
 const db=createClient(config.supabaseOrigin,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:credentialBoundFetch(config.supabaseOrigin)}});
 const r=await db.auth.signInWithPassword({email:f.email,password:f.password});assert.equal(r.error,null);assert.equal(r.data.user.id,f.id);
 return{db,token:r.data.session.access_token,user:r.data.user};
}
const sessions=await Promise.all(fixtures.map(login));
async function get(path,session=sessions[0]){const r=await request(config.previewOrigin+path,{headers:session?{authorization:`Bearer ${session.token}`}:{}});assert.equal(r.status,200,path);return r.json();}
for(const [kind,key]of [['CLUB','golfClubCatalog'],['BALL','golfBallCatalog'],['SHAFT','golfShaftCatalog']]){
 const expected=catalogs[key].filter(item=>item.bagEligible!==false),items=[],cursors=new Set();let cursor=null;
 do{
  const page=await get(`/api/catalog/equipment?type=${kind}&includeArchived=true&limit=50${cursor?'&cursor='+encodeURIComponent(cursor):''}`,null);
  items.push(...page.items);cursor=page.hasMore?page.nextCursor:null;
  if(cursor){assert.ok(!cursors.has(cursor),'pagination loop');cursors.add(cursor);}assert.ok(cursors.size<100);
 }while(cursor);
 assert.equal(items.length,expected.length);assert.equal(new Set(items.map(item=>item.id)).size,items.length);
 const byId=new Map(expected.map(item=>[item.id,json(item)]));for(const item of items)assert.deepEqual(item,byId.get(item.id),`${kind} versioned record`);
 const historical=expected.find(item=>!item.active);
 if(historical){const pinned=await get(`/api/catalog/equipment?type=${kind}&q=zzunmatchedquery&ids=${encodeURIComponent(historical.id)}`,null);assert.ok(pinned.items.some(item=>item.id===historical.id));}
 report.catalogs.push({kind,items:items.length,pages:cursors.size+1,fitEligible:items.filter(item=>item.fitEligible).length,exactVersionedContent:true,pinnedHistorical:Boolean(historical)});
}
report.checks.push('complete equipment API pagination equals versioned server catalog','shaft bag/fit eligibility and generations preserved','saved historical catalog IDs retrievable');
const catalog=await get('/api/courses/catalog');
const additions=JSON.parse(readFileSync('data/course-location-support-closeout.json'));
for(const addition of additions){
 const match=catalog.courses.find(c=>c.locationEvidence?.sourceUrl===addition.sourceUrl&&Math.abs(c.latitude-addition.latitude)<1e-9&&Math.abs(c.longitude-addition.longitude)<1e-9);
 assert.ok(match,'location missing from effective Preview API');
}
const remote=nearestReviewedClubs(catalog.courses,{latitude:40.7,longitude:-74});assert.ok(remote.every(c=>c.distanceKm>100));assert.match(reviewedClubsLocationSummary(remote),/más de 100 km/);
report.checks.push('all seven additional locations exposed by final API','distant location explicitly warned, not called local');
for(const [index,session]of sessions.entries()){
 const before={};
 for(const [table,columns,key]of [['profiles','id,display_name,username','id'],['user_preferences','*','user_id'],['ai_processing_consents','id,scope,decision_status,policy_version','user_id'],['player_equipment_profiles','version,snapshot','user_id']]){
  const r=await session.db.from(table).select(columns).eq(key,fixtures[index].id);assert.equal(r.error,null);before[table]=hash(r.data);
 }
 const beforeMetadata=hash(session.user.user_metadata);
 const pref=await get('/api/social/preferences',session);assert.equal(typeof pref.data.shareRounds,'boolean');assert.equal(typeof pref.data.notifyLike,'boolean');
 const consent=await get('/api/backyard-ai/consent',session);assert.ok(consent.decisions||Object.hasOwn(consent,'active'));
 const connections=await get('/api/social/connections',session);assert.ok(Array.isArray(connections.people));
 assert.ok(connections.people.every(person=>!Object.hasOwn(person,'email')));
 await get('/api/social/notifications',session);await get('/api/social/activity?friendsOnly=true',session);
 const groups=await get('/api/groups/invitations',session);report.groupEmailConfigured=groups.emailDeliveryConfigured;
 const next=await login(fixtures[index]);assert.equal(hash(next.user.user_metadata),beforeMetadata);
 for(const [table,columns,key]of [['profiles','id,display_name,username','id'],['user_preferences','*','user_id'],['ai_processing_consents','id,scope,decision_status,policy_version','user_id'],['player_equipment_profiles','version,snapshot','user_id']]){
  const r=await next.db.from(table).select(columns).eq(key,fixtures[index].id);assert.equal(r.error,null);assert.equal(hash(r.data),before[table],table);
 }
 assert.deepEqual(await get('/api/social/preferences',next),pref);
 report.checks.push(`synthetic ${index+1}: profile/preferences/index metadata/equipment/consents fresh session equal`,`synthetic ${index+1}: social/groups/notifications runtime available, no private email exposed`);
}
report.feedback=await get('/api/feedback',null);
report.rules=await get('/api/rules/ask',null);
report.aiSetup=await get('/api/backyard-ai/round-setup',null);
writeFileSync('.qa-artifacts/reconciliation-runtime-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
