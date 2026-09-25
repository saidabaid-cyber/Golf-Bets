// Canonical fixed Preview/provider, exact SHA, explicitly synthetic fixtures, QA ref only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,deploymentMutationBoundFetch,verifyPreviewBundleBinding,verifyPreviewDeploymentIdentity} from './qa-preview-statistics.mjs';
const c=publicPreviewConfig(process.env);assert.equal(c.projectRef,'bymeopxkxapfizeeqeyb');
const databaseFetch=credentialBoundFetch(c.supabaseOrigin),rawRequest=credentialBoundFetch(c.previewOrigin);
await verifyPreviewBundleBinding(c,rawRequest,databaseFetch);const request=deploymentMutationBoundFetch(c,rawRequest);
const fixture=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json','utf8')).find(a=>a.label==='C');
assert.equal(fixture.ref,c.projectRef);assert.ok(fixture.email.endsWith('@example.invalid'));
const client=createClient(c.supabaseOrigin,c.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:databaseFetch}});
const auth=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});
assert.equal(auth.error,null);assert.equal(auth.data.user.id,fixture.id);
const token=auth.data.session.access_token,scope='AI_PROVIDER_PROCESSING_CONSENT',version='2026-09-08-v2';
const require=createRequire(import.meta.url);
const {planRoundSetup}=require('../.test-dist/lib/backyard-ai/runtime/round-setup.js');
const {createRoundSetupDraft}=require('../.test-dist/lib/backyard-ai/schemas/round-setup.js');
const {validateCanonicalRoundCommand}=require('../.test-dist/lib/backyard-ai/runtime/canonical-command-guard.js');
const activeDraft=createRoundSetupDraft({date:'2026-09-17',ownerId:'a',players:[{id:'a',name:'Alfa',handicap:0},{id:'b',name:'Bravo',handicap:8}],course:{id:'qa',name:'Synthetic QA course',teeName:'Azules',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))}});
async function call(path,method='GET',body){
 const r=await request(c.previewOrigin+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(c.bypass?{'x-vercel-protection-bypass':c.bypass}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await r.text();assert.ok(raw.length<=1_000_000,'bounded Preview API response');let data;
 try{data=JSON.parse(raw);}catch{throw new Error(`Preview API returned invalid JSON (${r.status}).`);}
 return {status:r.status,data};
}
function assertDecision(value,{active,status,source}){
 assert.equal(value.status,200);assert.equal(value.data.scope,scope);assert.equal(value.data.policyVersion,version);
 assert.equal(value.data.active,active);assert.equal(value.data.status,status);assert.equal(value.data.source,source);
}
async function readDecision(){const value=await call(`/api/backyard-ai/consent?scope=${scope}`);assertDecision(value,{active:value.data.active,status:value.data.status,source:value.data.source});return value.data;}
async function restoreDecision(original){
 let restored;
 if(original.status==='accepted'){
  // A prior revocation makes an old onboarding checkpoint intentionally stale;
  // Settings is the only public reauthorization path that can restore active.
  restored=await call('/api/backyard-ai/consent','POST',{scope});
 }else if(original.status==='declined'){
  const source=['onboarding','account_update'].includes(original.source)?original.source:'account_update';
  restored=await call('/api/backyard-ai/consent','POST',{source,decisions:[{scope,accepted:false}]});
 }else restored=await call('/api/backyard-ai/consent','PATCH',{scope});
 const row=restored.data.decisions?.find(item=>item.scope===scope)??restored.data;
 assert.equal(restored.status,200);assert.equal(row.status,original.status);assert.equal(row.active,original.active);
 const readback=await readDecision();assert.equal(readback.status,original.status);assert.equal(readback.active,original.active);
}
const inputs=[
 ['OLD_502_EXACT','Somos Alfa y Bravo. Nassau match de 100, 100 y 200. Salimos por el hoyo 10. Sin presiones.'],
 ['FULL_EXPLICIT','Somos Alfa y Bravo. Jugamos 18 hoyos. Salimos por el hoyo 10. Skins de 100. Sin presiones. Tee azules.'],
 ['SIMPLE_EQUIVALENT','Skins de 100.'],
];
const consent={granted:true,version,scope},results=[];let original=null,shouldRestore=false,restored=false,loggedOut=false;
try{
 original=await readDecision();
 assert.ok(['accepted','declined','revoked'].includes(original.status),'Fixture consent must already have a restorable explicit decision.');
 shouldRestore=true;
 const revoked=await call('/api/backyard-ai/consent','PATCH',{scope});assertDecision(revoked,{active:false,status:'revoked',source:'settings'});
 const revokedReadback=await readDecision();assert.equal(revokedReadback.status,'revoked');assert.equal(revokedReadback.active,false);
 const denied=await call('/api/backyard-ai/round-setup','POST',{input:inputs[0][1],consent});assert.equal(denied.status,403);assert.equal(denied.data.code,'consent_required');
 const accepted=await call('/api/backyard-ai/consent','POST',{scope});assertDecision(accepted,{active:true,status:'accepted',source:'settings'});
 const acceptedReadback=await readDecision();assert.equal(acceptedReadback.status,'accepted');assert.equal(acceptedReadback.active,true);
 for(const [check,input] of inputs){
  const {status,data}=await call('/api/backyard-ai/round-setup','POST',{input,consent});
  assert.equal(status,200,`${check}:${typeof data.code==='string'?data.code.slice(0,64):'unexpected_response'}`);
  assert.ok(['AI_PROVIDER_CANONICAL','SAFE_LOCAL_FALLBACK'].includes(data.mode));
  assert.equal(validateCanonicalRoundCommand(input,data.canonicalCommand).ok,true);
  if(data.mode==='SAFE_LOCAL_FALLBACK'){assert.equal(data.canonicalCommand,input);assert.equal(data.clarification,null);assert.ok(data.integrityIssueCodes.length);}
  const plan=planRoundSetup(data.canonicalCommand,{activeDraft,today:'2026-09-17',courses:[activeDraft.course]});
  assert.equal(plan.draft.roundHoles,18);assert.deepEqual(plan.draft.players.map(p=>p.name),['Alfa','Bravo']);
  assert.equal('roundId' in data,false);assert.equal(plan.draft.bets.foursome.enabled,false);
  assert.equal(plan.questions.some(q=>q.field==='bets.pressures'),false);
  if(check!=='SIMPLE_EQUIVALENT')assert.equal(plan.draft.startHole,10);
  if(check==='OLD_502_EXACT'){assert.equal(plan.canConfirm,false);assert.ok(plan.questions.some(q=>q.prompt.includes('monto')));assert.equal(plan.draft.supplementalBets.length,0);}
  else {assert.equal(plan.draft.bets.skins.enabled,true);assert.equal(plan.draft.bets.skins.value,100);}
  if(check==='FULL_EXPLICIT')assert.equal(plan.draft.course.teeName,'Azules');
  results.push({check,http:status,mode:data.mode,issueCodes:data.integrityIssueCodes,startHole:plan.draft.startHole,roundHoles:plan.draft.roundHoles,skins:plan.draft.bets.skins.enabled?plan.draft.bets.skins.value:null,clarificationRequired:!plan.canConfirm,autoStarted:false});
 }
}finally{
 try{if(shouldRestore){await restoreDecision(original);restored=true;}}finally{const out=await client.auth.signOut({scope:'local'});assert.equal(out.error,null);loggedOut=true;}
}
await verifyPreviewDeploymentIdentity(c,rawRequest);
const report={preview:c.previewOrigin,ref:c.projectRef,buildSha:c.expectedSha,results,consentRevokedDenied:true,consentEffectiveStateRestored:restored,authSessionLoggedOut:loggedOut,sessionArtifactPersisted:false,syntheticOnly:true,roundsCreated:0};
writeFileSync('.qa-artifacts/final-ai-provider.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
