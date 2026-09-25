import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { profileCloudQaConfig } from './qa-preview-profile-cloud.mjs';
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from './qa-preview-statistics.mjs';

// Creates two synthetic QA accounts, retains all fixtures. Never deletes accounts,
// changes Auth configuration, sends mail, or follows credential-bearing redirects.
const config = profileCloudQaConfig(process.env);
assert.equal(config.projectRef, 'bymeopxkxapfizeeqeyb');
const rawAppFetch = credentialBoundFetch(config.previewOrigin);
const databaseFetch = credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config, rawAppFetch, databaseFetch);
const appFetch = deploymentMutationBoundFetch(config, rawAppFetch);
const require = createRequire(import.meta.url);
const domain = { ...require('../.test-dist/lib/cloud-account.js'), ...require('../.test-dist/lib/total-score-round.js'), ...require('../.test-dist/lib/backyard-index.js') };
const options = { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }, global:{ fetch:databaseFetch } };
const admin = createClient(config.supabaseOrigin, config.secretKey, options);
const runId=randomUUID(), passed=[], accounts=[];
let stage='CREATE_SYNTHETIC_USERS', failure=null;
function checked(result,label) { if(result.error) throw Error(`${label}:${result.error.code || result.error.status || 'unknown'}`); return result.data; }
async function app(path,account,method='GET',body,expected=200) {
 const response=await appFetch(config.previewOrigin+path,{method,cache:'no-store',headers:{...(account?.token?{authorization:`Bearer ${account.token}`} : {}),'content-type':'application/json',...(config.bypass?{'x-vercel-protection-bypass':config.bypass}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();
 assert.equal(response.status,expected,`${path}: HTTP${response.status} ${data.code||''}`);return data;
}
async function login(account) {
 account.client=createClient(config.supabaseOrigin,config.publicKey,options);
 const result=checked(await account.client.auth.signInWithPassword({email:account.email,password:account.password}),'login');
 assert.equal(result.user.id,account.id);account.token=result.session.access_token;
 writeFileSync(`.qa-artifacts/social-play-${account.label}-auth.private.json`,JSON.stringify({cookies:[],origins:[{origin:config.previewOrigin,localStorage:[{name:'sb-bymeopxkxapfizeeqeyb-auth-token',value:JSON.stringify(result.session)}]}]}));
}
function privateFixtures() { writeFileSync('.qa-artifacts/social-play-fixtures.private.json',JSON.stringify(accounts.map(({id,email,password,label,username})=>({id,email,password,label,username,runId,ref:config.projectRef,preview:config.previewOrigin})))); }
try {
 for(const label of ['A','B']) {
  const account={id:randomUUID(),email:`qa-social-play-${label}-${runId}@example.invalid`,password:`Qa!${randomBytes(28).toString('hex')}`,label,name:`Synthetic QA ${label}`,username:`qa_${label.toLowerCase()}_${runId.replaceAll('-','').slice(0,16)}`};accounts.push(account);privateFixtures();
  await verifyPreviewDeploymentIdentity(config, rawAppFetch);
  checked(await admin.auth.admin.createUser({id:account.id,email:account.email,password:account.password,email_confirm:true,app_metadata:{qa_run_id:runId},user_metadata:{display_name:account.name,given_name:'Synthetic',family_name:`QA ${label}`}}),'create QA');
  await login(account);
  await domain.saveCloudProfile(account.client,account.id,{displayName:account.name,username:account.username,defaultHandicap:null,avatarUrl:'',location:{countryCode:'MX',country:'México',stateCode:'MX-PUE',state:'Puebla'},locationUpdatedAt:new Date().toISOString()},new Date().toISOString(),{rebaseOnServerClock:true});
  checked(await account.client.from('social_profiles').update({username:account.username,display_name:account.name}).eq('user_id',account.id),'social identity');
  await app('/api/account/privacy',account,'PATCH',{visibility:'public'});
 }
 const [a,b]=accounts;
 stage='COMPLETION_SERVER_PERSISTENCE';
 await app('/api/account/completion',null,'GET',undefined,401);
 const choices={handicap_choice:'MANUAL',manual_hcp:18.2,not_applicable:['golf','equipment','ball','fitting']};
 assert.equal((await app('/api/account/completion',a,'PUT',choices)).progress.percent,100);
 await a.client.auth.signOut();await login(a);
 assert.equal((await app('/api/account/completion',a)).progress.percent,100);
 assert.equal((await app('/api/account/completion',a)).choices.manual_hcp,18.2);
 assert.notEqual((await app('/api/account/completion',b)).progress.percent,100);
 const foreign=await b.client.from('profile_completion_choices').select('*').eq('user_id',a.id);
 assert.deepEqual(checked(foreign,'RLS completion'),[]);
 const denied=await b.client.from('profile_completion_choices').upsert({user_id:a.id,...choices});assert.ok(denied.error);
 assert.equal((await app('/api/account/completion',a,'PUT',{...choices,handicap_choice:'UNKNOWN',manual_hcp:null})).progress.percent,100);
 passed.push('COMPLETION_100_WITHOUT_GHIN','COMPLETION_MANUAL_AND_UNKNOWN_CLOUD','COMPLETION_FRESH_AUTH_SESSION','COMPLETION_TWO_USER_RLS');
 stage='QR_IDENTITY_AND_CONNECTIONS';
 const person=(await app(`/api/social/connections?target=${b.id}`,a)).person;
 assert.equal(person.user_id,b.id);assert.equal(JSON.stringify(person).includes(b.email),false);
 await app('/api/social/connections',a,'POST',{action:'request',target:a.id,operationId:randomUUID()},403);
 const requestBody={action:'request',target:b.id,operationId:randomUUID()};
 await Promise.all([app('/api/social/connections',a,'POST',requestBody),app('/api/social/connections',a,'POST',requestBody)]);
 const pending=(await app('/api/social/connections',b)).requests.filter(r=>r.requester_id===a.id&&r.state==='PENDING');assert.equal(pending.length,1);
 const notification=(await app('/api/social/notifications',b)).data.find(n=>n.activityId===pending[0].id);assert.ok(notification);assert.equal(notification.readAt,null);
 await app('/api/social/notifications',b,'PATCH',{id:notification.id});
 await b.client.auth.signOut();await login(b);
 assert.ok((await app('/api/social/notifications',b)).data.find(n=>n.id===notification.id).readAt);
 await app('/api/social/connections',a,'POST',{action:'ACCEPTED',id:pending[0].id});
 assert.equal((await app('/api/social/connections',b)).friends.length,0);
 await app('/api/social/connections',b,'POST',{action:'ACCEPTED',id:pending[0].id});
 await app('/api/social/connections',b,'POST',{action:'ACCEPTED',id:pending[0].id});
 assert.deepEqual((await app('/api/social/connections',a)).friends,[b.id]);
 assert.deepEqual((await app('/api/social/connections',b)).friends,[a.id]);
 passed.push('QR_SAFE_STABLE_PROFILE','NO_SELF_REQUEST','CONCURRENT_REQUEST_DEDUP','RECIPIENT_ONLY_ACCEPT','ACCEPT_IDEMPOTENT','NOTIFICATION_READ_FRESH_SESSION');
 stage='TOTAL_ONLY_CLOUD_AND_FRIEND_FEED';
 const preferences={enabledForFriends:true,shareRounds:true,shareAchievements:true,shareEquipment:false,shareCourses:true,notifyLike:true,notifyComment:true,notifyAttest:true,notifyFriendAchievement:false,notifyEquipment:false};
 await app('/api/social/preferences',a,'PUT',preferences);
 await app('/api/account/privacy',a,'PATCH',{visibility:'friends'});
 const now=new Date().toISOString();
 const course={id:`synthetic-${runId}`,name:'QA synthetic course — not a real course',teeName:'QA unverified tee',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))};
 const player={id:`account-${a.id}`,accountUserId:a.id,name:a.name,handicap:null};
 const round=domain.createTotalScoreRound({id:randomUUID(),course,player,date:now.slice(0,10),holes:9,start:10,total:36,now});
 const created=await app('/api/cloud/rounds',a,'POST',{round},201);
 await app('/api/cloud/rounds',a,'POST',{round},409);
 let loaded=(await app('/api/cloud/rounds',a)).rounds.find(r=>r.id===round.id);assert.ok(loaded);assert.deepEqual(loaded.scores,{});assert.equal(loaded.totalScoreCapture.grossTotal,36);assert.equal(domain.createBackyardIndexRoundSnapshot(loaded,player.id).eligible,false);
 await a.client.auth.signOut();await login(a);
 loaded=(await app('/api/cloud/rounds',a)).rounds.find(r=>r.id===round.id);assert.deepEqual(loaded.order,[10,11,12,13,14,15,16,17,18]);
 await app('/api/social/activity',a);
 const feed=(await app('/api/social/activity?friendsOnly=true',b)).data;
 const card=feed.find(c=>c.round?.localRoundId===round.id);assert.ok(card,'friend sees one allowed total-only summary');assert.equal(card.round.ownerScore,36);assert.equal(card.round.totalOnly,true);assert.deepEqual(card.achievements,[]);assert.equal(card.round.scorecard,undefined);
 assert.equal((await app('/api/social/activity?friendsOnly=true',a)).data.some(c=>c.author.userId===a.id),false);
 const detailed=domain.completeTotalScoreHoles(round,Object.fromEntries(round.order.map(h=>[h,4])),new Date().toISOString());
 checked(await a.client.from('rounds_cloud').update({snapshot:detailed}).eq('id',created.roundId).eq('owner_id',a.id),'complete same round');
 const all=(await app('/api/cloud/rounds',a)).rounds.filter(r=>r.id===round.id);assert.equal(all.length,1);assert.equal(Object.keys(all[0].scores).length,9);assert.deepEqual(all[0].putts,{});
 await app('/api/social/activity',a);
 const changed=(await app('/api/social/activity?friendsOnly=true',b)).data.filter(c=>c.round?.localRoundId===round.id);assert.equal(changed.length,1);assert.notEqual(changed[0].currentHash,card.currentHash);assert.notEqual(changed[0].round.totalOnly,true);
 await app('/api/social/preferences',a,'PUT',{...preferences,shareRounds:false,shareAchievements:false});
 assert.equal((await app('/api/social/activity?friendsOnly=true',b)).data.some(c=>c.round?.localRoundId===round.id),false);
 passed.push('TOTAL_ONLY_9_HOLES_CLOUD','TOTAL_NO_FABRICATED_STATS_INDEX','TOTAL_FRESH_SESSION','ROUND_DUPLICATE_BLOCKED','FRIEND_FEED_REAL_SCORE','HOLE_DETAIL_SAME_ID','MATERIAL_REVISION_CHANGED','FEED_NO_DUPLICATE','SERVER_SHARING_REVOKED');
 stage='RECIPROCAL_BLOCK';
 await app('/api/social/connections',b,'POST',{action:'block',target:a.id});
 await app(`/api/social/connections?target=${b.id}`,a,'GET',undefined,404);
 await app(`/api/social/connections?target=${a.id}`,b,'GET',undefined,404);
 assert.deepEqual((await app('/api/social/connections',a)).friends,[]);
 assert.equal((await app('/api/social/activity?friendsOnly=true',b)).data.some(c=>c.author.userId===a.id),false);
 passed.push('RECIPROCAL_BLOCK_PRIVACY');
 await verifyPreviewDeploymentIdentity(config,rawAppFetch);
} catch(error) {failure={stage,message:String(error.message).slice(0,400)};}
const report={runId,preview:config.previewOrigin,ref:config.projectRef,passed,failure,retainedSyntheticUsers:accounts.map(a=>a.id),qualification:'Actual Preview APIs and Supabase authenticated requests with new sessions. No physical iPhone, Google OAuth, SMTP receipt or camera hardware claim. Fixtures retained; no data deleted.'};
writeFileSync('.qa-artifacts/social-play-v2-cloud.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failure)process.exitCode=1;
