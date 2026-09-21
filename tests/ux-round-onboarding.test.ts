import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Session } from '@supabase/supabase-js';
import { finishOAuthOnce } from '../lib/oauth-callback-once';
import type { AuthFlowClient } from '../lib/auth-flow';
import { createBetaOnboardingProgress, advanceBetaOnboarding, normalizeBetaOnboardingProgress } from '../lib/beta-onboarding';
import { onboardingCheckpoint } from '../lib/onboarding-checkpoint';
import { preserveUnfinishedRound, unfinishedRoundDraft } from '../lib/unfinished-round';
import { canResumeActiveRound } from '../lib/active-round-navigation';
import { roundBetResult } from '../lib/round-betting-boundary';
import { hasRoundToPreserve } from '../lib/new-round-safety';
import { initialBets } from '../lib/new-round-bets';
import { buildGolfInsights } from '../lib/golf-insights';
import { saveRoundHistoryLocalFirst } from '../lib/round-history-save';
import { STORAGE_KEYS } from '../lib/round-utils';
import type { RoundSnapshot } from '../lib/types';

function authFixture() {
  let calls = 0;
  const session = { access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 9999999999, user: { id: 'A' } } as Session;
  const auth = { exchangeCodeForSession: async () => { calls++; return { error: null }; },
    getSession: async () => ({ data: { session }, error: null }), getUser: async () => ({ data: { user: session.user }, error: null }),
  } as unknown as AuthFlowClient & { exchangeCodeForSession: (code: string) => Promise<{ error: unknown }> };
  return { auth, calls: () => calls, session };
}
test('OAuth StrictMode and simultaneous callback effects consume the PKCE code exactly once', async () => {
  const f = authFixture(); const [a,b] = await Promise.all([finishOAuthOnce(f.auth,'one'), finishOAuthOnce(f.auth,'one')]);
  assert.equal(f.calls(),1); assert.equal(a,f.session); assert.equal(b,f.session);
  await finishOAuthOnce(f.auth,'different'); assert.equal(f.calls(),2);
});
test('OAuth failed exchange is shared, never retried silently or replaced by a stale session', async () => {
  const f = authFixture(); let reads=0, exchanges=0;
  f.auth.exchangeCodeForSession=async()=>{exchanges++;return{error:Error('invalid code')};};
  f.auth.getSession=async()=>{reads++;return{data:{session:f.session},error:null};};
  const results=await Promise.allSettled([finishOAuthOnce(f.auth,'bad'),finishOAuthOnce(f.auth,'bad')]);
  assert.equal(exchanges,1);assert.equal(reads,0);assert.ok(results.every(r=>r.status==='rejected'));
});
for(const mode of ['quick','complete'] as const) test(`${mode} onboarding includes Course and Index and survives account readback`,()=>{
  let progress={...createBetaOnboardingProgress('A'),mode};
  progress=advanceBetaOnboarding(progress,'course') as typeof progress;
  progress=advanceBetaOnboarding(progress,'ghin') as typeof progress;
  const restored=onboardingCheckpoint(JSON.parse(JSON.stringify(progress)),'A');
  assert.equal(restored?.step,'ghin');assert.equal(restored?.mode,mode);assert.ok(restored?.completedSteps.includes('course'));
  assert.equal(normalizeBetaOnboardingProgress(progress,'B'),null);
});
test('quick entry cannot bypass course/index and optional device permissions never become consent',()=>{
  const ui=readFileSync('app/components/beta-onboarding-flow.tsx','utf8');
  assert.match(ui,/onClick=\{\(\) => advance\("course"\)\}/);
  assert.match(ui,/entryMode === 'quick' \? "permissions" : "equipment"/);
  assert.match(ui,/CatalogCoursePicker/);assert.match(ui,/HandicapSourceSelector/);
  const permission=readFileSync('app/components/device-permissions.tsx','utf8');
  assert.doesNotMatch(permission,/localStorage|fetch\(|acceptConsent/);
  assert.match(permission,/permission\.onchange = null/);assert.match(permission,/cancel\.current\(\)/);
});
test('one completion calculation feeds Home and Profile, visual progress disappears at 100',()=>{
  for(const path of ['app/page.tsx','app/components/profile-account-panel.tsx']) assert.match(readFileSync(path,'utf8'),/ProfileCompletionRing/);
  const ring=readFileSync('app/components/profile-completion-ring.tsx','utf8');
  assert.match(ring,/api\/account\/completion/);assert.match(ring,/percent !== 100/);
});

function round():RoundSnapshot {
  const players=[{id:'A',name:'QA A',handicap:0,accountUserId:'11111111-1111-4111-8111-111111111111'},{id:'guest',name:'Invitado QA',handicap:null}];
  const course={id:'qa-only',name:'Campo sintético',teeName:'QA',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))};
  return {id:'round-A',snapshotVersion:2,lifecycleState:'completed',startedAt:'2026-09-21T10:00:00Z',completedAt:'2026-09-21T15:00:00Z',date:'2026-09-21',ownerId:'A',ownerName:'QA A',courseName:course.name,teeName:course.teeName,courseSnapshot:course,players,scores:{10:{A:5,guest:6}},roundHoles:18,startHole:10,order:[10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9],betConfig:initialBets([]),segments:[],presentation:{version:1,groupNassauTerm:'polla',playMode:'score_only'},betResult:200,expenseTotal:20,netResult:180,categoryResults:{Skins:200},expenses:{caddie:20,food:0,drinks:0,greenFee:0,cartRental:0,other:0}};
}
for(const state of ['live','cancelled'] as const) test(`${state} keeps scores, identity, tee, play mode; does not add sports stats or balances`,()=>{
  const original=round(), frozen=JSON.stringify(original), saved=preserveUnfinishedRound(original,2,state);
  assert.equal(JSON.stringify(original),frozen);assert.equal(saved.completedAt,undefined);assert.equal(saved.netResult,0);
  const draft=unfinishedRoundDraft(JSON.parse(JSON.stringify(saved)))!;
  assert.deepEqual(draft.scores,original.scores);assert.deepEqual(draft.players,original.players);assert.deepEqual(draft.course,original.courseSnapshot);
  assert.equal(draft.roundId,original.id);assert.equal(draft.currentIndex,2);assert.equal(draft.startHole,10);assert.equal(draft.presentation?.playMode,'score_only');
  assert.equal(buildGolfInsights([saved]).betBalance,undefined); // No completed financial record, not a fabricated settlement.
});
test('parking cannot overwrite a completed historical snapshot or a shared round',()=>{
  assert.throws(()=>preserveUnfinishedRound(round(),0,'live',round()));
  assert.throws(()=>preserveUnfinishedRound({...round(),cloudReadOnly:true},0,'live'));
  assert.equal(unfinishedRoundDraft(round()),null);
});
test('parked historical record does not disable the resumed active round navigation',()=>{
  const saved=preserveUnfinishedRound(round(),1,'live');
  const input={userId:'A',workspaceOwnerId:'A',hydrated:true,closed:false,draftAvailable:true,draft:{roundId:saved.id,startedAt:saved.startedAt,courseSelected:true,ownerId:'A',players:saved.players!,scores:saved.scores},history:[saved]};
  assert.equal(canResumeActiveRound(input),true);
  assert.equal(canResumeActiveRound({...input,history:[round()]}),false);
  assert.equal(canResumeActiveRound({...input,workspaceOwnerId:'B'}),false);
});
test('parking is idempotent across persistent readback and preserves other historical rounds',async()=>{
  const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v);}};
  const other={...round(),id:'other'};storage.setItem(STORAGE_KEYS.history,JSON.stringify([other]));
  const saved=preserveUnfinishedRound(round(),1,'live'); let writes=0;
  const options={storage,ownerId:'A',snapshot:saved,deviceId:'QA',defaultHandicap:null,hasLocalPreferenceState:false,queueForCloud:true,persistOffline:async(_id:string,bundle: {history:RoundSnapshot[]})=>{writes++;assert.equal(bundle.history.length,2);return'fingerprint';}};
  await saveRoundHistoryLocalFirst(options);await saveRoundHistoryLocalFirst(options);
  const reload=JSON.parse(storage.getItem(STORAGE_KEYS.history)!);
  assert.equal(reload.length,2);assert.deepEqual(reload.find((r:RoundSnapshot)=>r.id==='other'),other);assert.equal(writes,2);
});
for(const engine of ['calculateRabbits','calculateSkins','calculateUnits','calculateMonkey','calculateFoursomes','calculateBallFriend','calculatePersonalBets','calculatePolla','calculateMiniPolla','calculateManualBets','calculateCounterBet','calculateLoba','calculateSupplementalBets'] as const) test(`score-only never invokes ${engine}, including stale betting drafts`,()=>{
  let calls=0;const result=roundBetResult('score_only',engine,()=>{calls++;throw Error('must not calculate');});
  assert.equal(calls,0);assert.ok(result);
});
test('full-round boundary returns the identical deterministic result without modifying it',()=>{
  const result={events:[],won:{A:2},pending:1};let calls=0;
  assert.equal(roundBetResult('full','calculateRabbits',()=>{calls++;return result;}),result);assert.equal(calls,1);
});
test('catalog results occupy layout space instead of falling under onboarding actions',()=>{
  assert.match(readFileSync('app/components/catalog-course-picker.tsx','utf8'),/<AnchoredSearch inlineResults/);
  assert.match(readFileSync('app/components/anchored-search.tsx','utf8'),/inlineResults = false/);
  assert.match(readFileSync('app/globals.css','utf8'),/\.anchoredSearchInline \.anchoredSearchResults\{position:static/);
});
test('unavailable permission lookup never claims an unrequested permission',()=>{
  const source=readFileSync('app/components/device-permissions.tsx','utf8');
  assert.match(source,/catch \{ if \(alive\) setLocation\('unknown'\)/);
  assert.doesNotMatch(source,/result.status[^;]+: 'prompt'/);
});
test('fresh automatic owner is not an active round but real setup edits are preserved',()=>{
  const owner={id:'account-A',accountUserId:'A',name:'QA'};
  const fresh={players:[owner],bets:initialBets([owner.id]),scores:{},currentIndex:0,courseSelected:false};
  assert.equal(hasRoundToPreserve(fresh,'A'),false);
  assert.equal(hasRoundToPreserve({...fresh,startedAt:'2026-09-21T12:00:00Z'},'A'),true);
  assert.equal(hasRoundToPreserve({...fresh,players:[owner,{id:'guest',name:'Invitado'}]},'A'),true);
  assert.equal(hasRoundToPreserve({...fresh,scores:{1:{[owner.id]:5}}},'A'),true);
  assert.equal(hasRoundToPreserve({...fresh,manualBets:[{id:'manual'}]},'A'),true);
});
