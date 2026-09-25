// Isolated QA only: synthetic identities; additive round fixture and UX checkpoint.
// No deletes, provider configuration, emails or modifications to previous history.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,deploymentMutationBoundFetch,verifyPreviewBundleBinding,verifyPreviewDeploymentIdentity} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig();assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const rawRequest=credentialBoundFetch(config.previewOrigin),databaseFetch=credentialBoundFetch(config.supabaseOrigin);await verifyPreviewBundleBinding(config,rawRequest,databaseFetch);const request=deploymentMutationBoundFetch(config,rawRequest);
const require=createRequire(import.meta.url),{preserveUnfinishedRound,unfinishedRoundDraft}=require('../.test-dist/lib/unfinished-round.js');
const {initialBets}=require('../.test-dist/lib/new-round-bets.js');
const {createBetaOnboardingProgress,completeBetaOnboarding}=require('../.test-dist/lib/beta-onboarding.js');
const A=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json')).find(f=>f.label==='C');
const B=JSON.parse(readFileSync('.qa-artifacts/catalog-b.private.json'));
async function login(f){assert.equal(f.ref,config.projectRef);assert.ok(f.email.endsWith('@example.invalid'));const db=createClient(config.supabaseOrigin,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:databaseFetch}});const r=await db.auth.signInWithPassword({email:f.email,password:f.password});assert.equal(r.error,null);assert.equal(r.data.user.id,f.id);return {db,token:r.data.session.access_token,user:r.data.user};}
let a=await login(A);const b=await login(B);
async function app(path,method='GET',body,expected=200,session=a){const r=await request(config.previewOrigin+path,{method,headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,expected,`${path} ${r.status} ${data.code||''}`);return data;}
const report={preview:config.previewOrigin,ref:config.projectRef,checks:[],emailsSent:0,deletedRows:0};
if(process.argv.includes('--verify-browser-lifecycle')){
 const id=JSON.parse(readFileSync('.qa-artifacts/ux-round-live-id.json')).id;
 const entry=await app('/api/account/entry');assert.equal(entry.onboardingProgress.status,'complete');
 const history=(await app('/api/cloud/rounds')).rounds, saved=history.filter(r=>r.id===id);
 assert.equal(saved.length,1);assert.equal(saved[0].lifecycleState,'cancelled');assert.equal(Boolean(saved[0].completedAt),false);
 assert.deepEqual(Object.values(saved[0].scores[10]).sort(),[5,6]);assert.deepEqual(Object.values(saved[0].putts[10]),[2,2]);
 assert.equal(saved[0].presentation.playMode,'score_only');assert.equal(saved[0].resumeHoleIndex,1);
 const foreign=await b.db.from('rounds_cloud').select('id').eq('owner_id',A.id).eq('local_round_id',id);assert.equal(foreign.error,null);assert.deepEqual(foreign.data,[]);
 report.checks.push('browser completed onboarding persisted','browser soft close persisted in new session','same round ID / scores / putts / hole / score-only intact','no completed statistics fabricated','private round RLS B denied');
 writeFileSync('.qa-artifacts/ux-browser-cloud-readback.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(0);
}
const beforeMeta=JSON.stringify(a.user.user_metadata.backyard_golf_profile_v1);
const progress={...createBetaOnboardingProgress(A.id),mode:'quick'};
await app('/api/account/onboarding','PUT',progress);
let entry=await app('/api/account/entry');assert.equal(entry.existingAccount,true);assert.equal(entry.onboardingProgress.step,'welcome');
await app('/api/account/onboarding','PUT',progress,400,b);
a=await login(A);entry=await app('/api/account/entry');assert.equal(entry.onboardingProgress.userId,A.id);assert.equal(entry.onboardingProgress.mode,'quick');assert.equal(JSON.stringify(a.user.user_metadata.backyard_golf_profile_v1),beforeMeta);
report.checks.push('server checkpoint reload/new session','other account cannot write checkpoint','golf metadata preserved');
if(!process.argv.includes('--prepare-onboarding')){await app('/api/account/onboarding','PUT',completeBetaOnboarding(progress));assert.equal((await app('/api/account/entry')).onboardingProgress.status,'complete');}
const idsFile='.qa-artifacts/ux-round-live-id.json';const id=existsSync(idsFile)?JSON.parse(readFileSync(idsFile)).id:`ux-lifecycle-qa-${randomUUID()}`;writeFileSync(idsFile,JSON.stringify({id}));
const course=(await app('/api/courses/catalog?courseId=course-la-vista')).cards[0];
const owner={id:`account-${A.id}`,accountUserId:A.id,name:'UX QA Sintético',handicap:null},guest={id:'guest-ux-qa',name:'Invitado QA',handicap:null};
const now=new Date().toISOString();const source={id,snapshotVersion:2,date:now.slice(0,10),startedAt:now,ownerId:owner.id,ownerName:owner.name,courseName:course.name,teeName:course.teeName,courseSnapshot:course,players:[owner,guest],scores:{10:{[owner.id]:5,[guest.id]:6}},putts:{10:{[owner.id]:2,[guest.id]:2}},roundHoles:9,startHole:10,order:[10,11,12,13,14,15,16,17,18],betConfig:initialBets([]),segments:[],presentation:{version:1,groupNassauTerm:'polla',playMode:'score_only'},expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0},betResult:0,expenseTotal:0,netResult:0,categoryResults:{},updatedAt:now};
// Match the normal app snapshot shape, so fixtures do not create conflicts
// merely because the app fills missing optional defaults on hydration.
const {restoreRoundSnapshot}=require('../.test-dist/lib/round-editing.js');
const parked=preserveUnfinishedRound(restoreRoundSnapshot(source),1,'live');let history=(await app('/api/cloud/rounds')).rounds;
if(!history.some(r=>r.id===id))await app('/api/cloud/rounds','POST',{round:parked},201);
await app('/api/cloud/rounds','POST',{round:parked},409);
a=await login(A);history=(await app('/api/cloud/rounds')).rounds;const saved=history.filter(r=>r.id===id);assert.equal(saved.length,1);assert.equal(saved[0].lifecycleState,'live');assert.deepEqual(saved[0].scores,source.scores);assert.deepEqual(saved[0].putts,source.putts);assert.equal(unfinishedRoundDraft(saved[0]).presentation.playMode,'score_only');assert.equal(unfinishedRoundDraft(saved[0]).currentIndex,1);
const foreign=await b.db.from('rounds_cloud').select('id').eq('owner_id',A.id).eq('local_round_id',id);assert.equal(foreign.error,null);assert.deepEqual(foreign.data,[]);
report.checks.push('paused round real cloud','new session retains scores/putts/tee/playMode','idempotent ID','B cannot read private A round');
const completion=await app('/api/account/completion');assert.ok(completion.progress.percent>=0&&completion.progress.percent<=100);report.checks.push('shared completion API real read');
await verifyPreviewDeploymentIdentity(config,rawRequest);report.parkedRoundId=id;report.onboardingLeftPending=process.argv.includes('--prepare-onboarding');
writeFileSync('.qa-artifacts/ux-round-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
