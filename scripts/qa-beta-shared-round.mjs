import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { profileCloudQaConfig } from './qa-preview-profile-cloud.mjs';
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from './qa-preview-statistics.mjs';
const config=profileCloudQaConfig(process.env);
assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const rawAppFetch=credentialBoundFetch(config.previewOrigin);
const databaseFetch=credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config,rawAppFetch,databaseFetch);
const appFetch=deploymentMutationBoundFetch(config,rawAppFetch);
const require=createRequire(import.meta.url);
const {buildGolfInsights}=require('../.test-dist/lib/golf-insights.js');
const {buildBalanceLedger}=require('../.test-dist/lib/balance-ledger.js');
const {attributableHistory}=require('../.test-dist/lib/participant-history.js');
const {calculateBackyardIndex}=require('../.test-dist/lib/backyard-index.js');
const {roundsEligibleForStatistics}=require('../.test-dist/lib/statistics-reset.js');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:databaseFetch}};
const admin=createClient(config.supabaseOrigin,config.secretKey,options),runId=randomUUID(),accounts=[],passed=[];
let stage='IDENTITY',failure=null;
const deletedSyntheticAccounts=[];
function check(result,label){if(result.error)throw Error(`${label}:${result.error.code||result.error.status}`);return result.data;}
async function app(path,a,method='GET',body,status=200){
 const res=await appFetch(config.previewOrigin+path,{method,cache:'no-store',headers:{authorization:`Bearer ${a.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json();assert.equal(res.status,status,`${path}: ${res.status} ${data.code||''}`);return data;
}
async function login(a){a.client=createClient(config.supabaseOrigin,config.publicKey,options);const {user,session}=check(await a.client.auth.signInWithPassword({email:a.email,password:a.password}),'login');assert.equal(user.id,a.id);a.token=session.access_token;
 writeFileSync(`.qa-artifacts/beta-${a.label}-auth.private.json`,JSON.stringify({cookies:[],origins:[{origin:config.previewOrigin,localStorage:[{name:'sb-bymeopxkxapfizeeqeyb-auth-token',value:JSON.stringify(session)}]}]}));}
try {
 for(const label of ['A','B','C']){
  const a={id:randomUUID(),label,name:`Beta QA ${label}`,email:`qa-beta-${label}-${runId}@example.invalid`,password:`Qa!${randomBytes(24).toString('hex')}`};accounts.push(a);
  await verifyPreviewDeploymentIdentity(config,rawAppFetch);check(await admin.auth.admin.createUser({id:a.id,email:a.email,password:a.password,email_confirm:true,app_metadata:{qa_run_id:runId},user_metadata:{display_name:a.name}}),'create own synthetic');await login(a);
  await app('/api/account/privacy',a,'PATCH',{visibility:'public'});
  await app('/api/social/preferences',a,'PUT',{enabledForFriends:true,shareRounds:true,shareAchievements:true,shareEquipment:false,shareCourses:true,notifyLike:true,notifyComment:true,notifyAttest:true,notifyFriendAchievement:true,notifyEquipment:false});
  check(await a.client.auth.updateUser({data:{backyard_index_preference_v1:{version:1,userId:a.id,enabled:true,handicapSource:'BACKYARD',updatedAt:'2026-09-01T00:00:00.000Z',localPccZeroDeclaredAt:'2026-09-01T00:00:00.000Z'}}}),'index activation');
 }
 const [a,b,c]=accounts;
 await app('/api/social/connections',a,'POST',{action:'request',target:b.id,operationId:randomUUID()});
 const req=(await app('/api/social/connections',b)).requests.find(r=>r.requester_id===a.id);
 await app('/api/social/connections',b,'POST',{action:'ACCEPTED',id:req.id});
 stage='CANONICAL_ROUND';
 const now=new Date().toISOString(),pa=`player-${a.id}`,pb=`player-${b.id}`,localId=`beta-${runId}`;
 const holes=Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}));
 // Explicit synthetic rating evidence: exercises arithmetic, NOT licensed course facts.
 const evidence={kind:'OFFICIAL_RATED_TEE',authority:'Synthetic QA fixture — NOT a real course',sourceUrl:'https://ratings.example.invalid/qa',verifiedAt:'2026-09-01T00:00:00.000Z',courseId:'qa-course',teeId:'qa-tee',courseRating:72,slopeRating:113};
 const round={id:localId,lifecycleState:'completed',date:now.slice(0,10),startedAt:now,completedAt:now,ownerId:pa,ownerName:a.name,accountUserId:a.id,courseName:'QA synthetic — NOT a real course',teeName:'QA fixture',roundHoles:18,startHole:1,
  players:[{id:pa,accountUserId:a.id,name:a.name,handicap:0},{id:pb,accountUserId:b.id,name:b.name,handicap:0}],
  courseSnapshot:{id:'qa-tee',catalogCourseId:'qa-course',catalogTeeId:'qa-tee',name:'QA synthetic — NOT a real course',teeName:'QA fixture',rating:72,slope:113,holes},
  playerTeeAssignments:[pa,pb].map(playerId=>({playerId,courseId:'qa-course',teeId:'qa-tee',teeName:'QA fixture',source:'catalog',rating:72,slope:113,capturedAt:now,indexRatingEvidence:evidence})),
  order:holes.map(h=>h.number),scores:Object.fromEntries(holes.map(h=>[h.number,{[pa]:4,[pb]:5}])),putts:Object.fromEntries(holes.map(h=>[h.number,{[pa]:2,[pb]:2}])),
  playerBalances:{[pa]:100,[pb]:-100},categoryBalances:{manual:{[pa]:100,[pb]:-100}},categoryResults:{manual:100},betResult:100,expenses:{caddie:15,food:0,drinks:0,greenFee:0,cartRental:0,other:0},expenseTotal:15,netResult:85};
 const {roundId}=await app('/api/cloud/rounds',a,'POST',{round},201);
 let card=(await app('/api/social/activity',a)).data.find(x=>x.roundId===roundId&&x.type==='ROUND_COMPLETED');assert.ok(card);
 const confirm={playerKey:pb,expectedVersion:card.sourceVersion,expectedHash:card.currentHash};
 await app(`/api/social/rounds/${roundId}/links`,c,'POST',confirm,403);
 assert.equal((await app('/api/cloud/rounds',b)).rounds.some(r=>r.cloudRoundId===roundId),false);
 passed.push('UNCONFIRMED_EXCLUDED','OUTSIDER_CANNOT_CLAIM');
 stage='SELF_CONFIRM_TO_HISTORY';
 await app(`/api/social/rounds/${roundId}/links`,b,'POST',confirm);
 let history=(await app('/api/cloud/rounds',b)).rounds;
 let shared=history.find(r=>r.cloudRoundId===roundId);assert.ok(shared,'Confirmed B must receive canonical round in history');
 assert.equal(shared.cloudReadOnly,true);assert.equal(shared.ownerId,pa);assert.equal(shared.cloudParticipant?.accountUserId,b.id);
 assert.equal(buildGolfInsights(history).averageScore,90);assert.equal(buildGolfInsights(history).betBalance,-100);assert.equal(buildGolfInsights(history).expenseRounds,0);
 assert.equal(buildGolfInsights([shared,shared]).scoredRounds,1);
 assert.equal(buildBalanceLedger(attributableHistory([shared,shared],b.id)).entries.find(e=>e.accountUserId===b.id).balance,-100);
 const index=calculateBackyardIndex(history,b.id);assert.equal(index.eligibleRoundCount,1);assert.equal(index.records[0].scoreDifferential,18);
 passed.push('CONFIRMED_SHARED_HISTORY','B_SCORE90_NOT_A72','B_BALANCE_MINUS100_ONCE','ORGANIZER_EXPENSES_NOT_ATTRIBUTED','B_FROZEN_INDEX_DIFFERENTIAL18');
 stage='READ_ONLY_RLS_SESSION';
 const forbidden=await b.client.from('rounds_cloud').update({snapshot:{...round,courseName:'ATTACK'}}).eq('id',roundId).select('id');assert.deepEqual(check(forbidden,'RLS no writes'),[]);
 assert.deepEqual(check(await c.client.from('rounds_cloud').select('id').eq('id',roundId),'outsider RLS'),[]);
 await b.client.auth.signOut();await login(b);history=(await app('/api/cloud/rounds',b)).rounds;assert.equal(buildGolfInsights(history).averageScore,90);
 await app(`/api/social/rounds/${roundId}/links`,b,'POST',confirm);assert.equal((await app('/api/cloud/rounds',b)).rounds.filter(r=>r.cloudRoundId===roundId).length,1);
 card=(await app(`/api/social/activity/${card.id}`,b)).data;
 await app(`/api/social/rounds/${roundId}/attest`,b,'POST',{targetUserId:a.id,expectedVersion:card.sourceVersion,expectedHash:card.currentHash});
 passed.push('NEW_SESSION_SHARED_PERSISTENCE','CONFIRM_RETRY_DEDUP','RLS_READ_ONLY_OUTSIDER_DENIED','B_ATTEST');
 stage='RESET_B_KEEP_A';
 assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
 const reset=await app('/api/account/statistics',b,'DELETE',{confirmation:'ELIMINAR',requestId:randomUUID()});
 assert.equal(buildGolfInsights(roundsEligibleForStatistics(history,reset.resetAt)).rounds,0);
 assert.equal((await app('/api/cloud/rounds',b)).rounds.length,history.length);
 assert.equal(buildGolfInsights((await app('/api/cloud/rounds',a)).rounds).averageScore,72);
 passed.push('B_RESET_EXCLUDES_SHARED_PERFORMANCE','RESET_PRESERVES_SHARED_HISTORY','A_STATS_INTACT');
 stage='DELETE_OWNER_KEEP_CONFIRMED_ONLY_PEER';
 assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
 const owner=check(await admin.auth.admin.getUserById(a.id),'verify synthetic owner');
 assert.equal(owner.user.app_metadata.qa_run_id,runId);
 assert.ok(owner.user.email.endsWith('@example.invalid'));
 const operation={confirmation:'ELIMINAR',dataPolicy:'delete_golf_data',requestId:randomUUID(),recoveryToken:randomBytes(32).toString('hex')};
 const removed=await app('/api/account/delete',a,'DELETE',operation);
 assert.equal(removed.deleted,true);
 assert.ok((await admin.auth.admin.getUserById(a.id)).error,'Auth must be deleted');
 deletedSyntheticAccounts.push(a.id);
 await app('/api/cloud/rounds',a,'GET',null,401);
 await login(b);
 const retained=(await app('/api/cloud/rounds',b)).rounds.find(r=>r.cloudRoundId===roundId);
 assert.ok(retained,'Confirmed-only peer keeps the shared round after owner deletion');
 assert.equal(retained.cloudParticipant.accountUserId,b.id);
 const erased=retained.players.find(p=>p.id===pa);
 assert.equal(erased.name,'Jugador eliminado');
 assert.ok(!erased.accountUserId);
 assert.ok(!JSON.stringify(retained).includes(a.email));
 assert.equal(buildGolfInsights([retained]).averageScore,90);
 assert.equal(buildGolfInsights([retained]).betBalance,-100);
 assert.equal(calculateBackyardIndex([retained],b.id).records[0].scoreDifferential,18);
 passed.push('OWNER_AUTH_DELETED_OLD_SESSION_DENIED','CONFIRMED_ONLY_SHARED_ROUND_SURVIVES_DELETE','OWNER_ANONYMIZED_PEER_SCORE_BALANCE_INDEX_INTACT');
 await verifyPreviewDeploymentIdentity(config,rawAppFetch);
} catch(e){failure={stage,message:String(e.message).slice(0,400)};}
writeFileSync('.qa-artifacts/beta-fixtures.private.json',JSON.stringify(accounts.map(({id,email,password,label})=>({id,email,password,label,runId,ref:config.projectRef,preview:config.previewOrigin}))));
const report={runId,preview:config.previewOrigin,ref:config.projectRef,passed,failure,deletedSyntheticAccounts,retainedSyntheticAccounts:accounts.map(a=>a.id).filter(id=>!deletedSyntheticAccounts.includes(id)),scope:'Real Preview/Supabase A/B/C HTTP. Synthetic score/rating fixtures, no claim of physical Safari/SMTP/Google or licensed tee verification.'};
writeFileSync('.qa-artifacts/beta-shared-round.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failure)process.exitCode=1;
