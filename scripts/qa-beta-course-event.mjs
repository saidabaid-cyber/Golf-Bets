import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {profileCloudQaConfig} from './qa-preview-profile-cloud.mjs';
import {credentialBoundFetch,deploymentMutationBoundFetch,verifyPreviewBundleBinding,verifyPreviewDeploymentIdentity} from './qa-preview-statistics.mjs';
const config=profileCloudQaConfig(process.env);assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const rawAppFetch=credentialBoundFetch(config.previewOrigin),databaseFetch=credentialBoundFetch(config.supabaseOrigin);await verifyPreviewBundleBinding(config,rawAppFetch,databaseFetch);const appFetch=deploymentMutationBoundFetch(config,rawAppFetch);
const require=createRequire(import.meta.url),catalog=require('../.test-dist/lib/golf-course-directory.js').INTERNAL_GOLF_COURSE_CATALOG;
// Independent run-owned fixtures: never reuse the owner deleted by shared-round QA.
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:databaseFetch}};
const admin=createClient(config.supabaseOrigin,config.secretKey,options),runId=randomUUID(),people=[];
for(const label of ['A','B']){
 const a={id:randomUUID(),email:`qa-course-${label}-${runId}@example.invalid`,password:`Qa!${randomBytes(24).toString('hex')}`};
 await verifyPreviewDeploymentIdentity(config,rawAppFetch);
 assert.equal((await admin.auth.admin.createUser({id:a.id,email:a.email,password:a.password,email_confirm:true,app_metadata:{qa_run_id:runId},user_metadata:{display_name:`Course QA ${label}`}})).error,null);
 a.client=createClient(config.supabaseOrigin,config.publicKey,options);
 const r=await a.client.auth.signInWithPassword({email:a.email,password:a.password});assert.equal(r.error,null);assert.equal(r.data.user.id,a.id);a.token=r.data.session.access_token;people.push(a);
}
const [a,b]=people,passed=[];
async function app(path,u,method='GET',body,status=200){const r=await appFetch(config.previewOrigin+path,{method,headers:{authorization:`Bearer ${u.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,d.code||path);return d;}
let failure=null;
try {
 await app('/api/account/privacy',a,'PATCH',{visibility:'public'});
 await app('/api/account/privacy',b,'PATCH',{visibility:'public'});
 await app('/api/social/preferences',a,'PUT',{enabledForFriends:true,shareRounds:true,shareAchievements:true,shareEquipment:false,shareCourses:true,notifyLike:false,notifyComment:false,notifyAttest:false,notifyFriendAchievement:false,notifyEquipment:false});
 await app('/api/social/connections',a,'POST',{action:'request',target:b.id,operationId:randomUUID()});
 const friend=(await app('/api/social/connections',b)).requests.find(r=>r.requester_id===a.id);
 await app('/api/social/connections',b,'POST',{action:'ACCEPTED',id:friend.id});
 const target=catalog.courses.find(c=>catalog.clubs.some(home=>home.id!==c.clubId));assert.ok(target);
 const home=catalog.clubs.find(c=>c.id!==target.clubId);assert.ok(home);
 const user=(await a.client.auth.getUser()).data.user,oldGolf=user.user_metadata.backyard_golf_profile_v1||{};
 assert.equal((await a.client.auth.updateUser({data:{backyard_golf_profile_v1:{...oldGolf,homeClubId:home.id}}})).error,null);
 const {createTotalScoreRound}=require('../.test-dist/lib/total-score-round.js');
 const base=createTotalScoreRound({id:randomUUID(),course:{id:`synthetic-${runId}`,name:'Synthetic QA course',teeName:'Unverified QA',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))},player:{id:`account-${a.id}`,accountUserId:a.id,name:'Course QA A',handicap:null},date:new Date().toISOString().slice(0,10),holes:18,start:1,total:80,now:new Date().toISOString()});
 const now=new Date().toISOString(),round={...base,id:randomUUID(),completedAt:now,updatedAt:now,backyardIndexSnapshots:[],courseName:'Synthetic QA event fixture',courseSnapshot:{...base.courseSnapshot,catalogCourseId:target.id,catalogClubId:target.clubId}};
 const created=await app('/api/cloud/rounds',a,'POST',{round},201);
 const getCard=async()=> (await app('/api/social/activity?friendsOnly=true',b)).data.find(c=>c.roundId===created.roundId&&c.author.userId===a.id);
 let card=await getCard();assert.equal(card?.courseEvent?.type,'NEW_COURSE_PLAYED');assert.equal(card.courseEvent.courseId,target.id);
 assert.equal((await getCard()).courseEvent.sourceRoundId,round.id);passed.push('REAL_CANONICAL_NEW_COURSE','RELOAD_ONE_SUMMARY');
 const second={...round,id:randomUUID(),completedAt:new Date(Date.now()+1).toISOString()};const later=await app('/api/cloud/rounds',a,'POST',{round:second},201);
 const cards=(await app('/api/social/activity?friendsOnly=true',b)).data;assert.equal(cards.find(c=>c.roundId===later.roundId)?.courseEvent,undefined);passed.push('PREVIOUS_COURSE_NO_REPEAT');
 const prefs=(await app('/api/social/preferences',a)).data;
 await app('/api/social/preferences',a,'PUT',{...prefs,shareCourses:false});assert.equal((await getCard()).courseEvent,undefined);passed.push('SHARE_COURSES_OFF_SERVER_REDACTION');
 await app('/api/social/preferences',a,'PUT',{...prefs,shareCourses:true});
 assert.equal((await a.client.auth.updateUser({data:{backyard_golf_profile_v1:{...oldGolf,homeClubId:target.clubId}}})).error,null);
 assert.equal((await getCard()).courseEvent,undefined);passed.push('HOME_CLUB_NO_EVENT');
 assert.equal((await a.client.auth.updateUser({data:{backyard_golf_profile_v1:oldGolf}})).error,null);
 await verifyPreviewDeploymentIdentity(config,rawAppFetch);
}catch(e){failure=String(e.message).slice(0,350);}
const report={preview:config.previewOrigin,ref:config.projectRef,runId,passed,failure,retainedSyntheticUsers:people.map(a=>a.id),qualification:'Real Preview API + QA DB; synthetic rounds referencing canonical catalog IDs, not a claim of a real played round.'};
writeFileSync('.qa-artifacts/beta-course-event.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure)process.exitCode=1;
