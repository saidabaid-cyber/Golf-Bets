// Actual immutable Preview/provider, explicitly synthetic fixtures, QA ref only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {profileCloudQaConfig} from './qa-preview-profile-cloud.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const c=profileCloudQaConfig(process.env);assert.equal(c.projectRef,'bymeopxkxapfizeeqeyb');
const request=credentialBoundFetch(c.previewOrigin);await verifyPreviewBundleBinding(c,request);
const fixture=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json','utf8')).find(a=>a.label==='C');
assert.equal(fixture.ref,c.projectRef);assert.ok(fixture.email.endsWith('@example.invalid'));
const client=createClient(c.supabaseOrigin,c.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:credentialBoundFetch(c.supabaseOrigin)}});
const auth=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});
assert.equal(auth.error,null);assert.equal(auth.data.user.id,fixture.id);
const token=auth.data.session.access_token,scope='AI_PROVIDER_PROCESSING_CONSENT';
const require=createRequire(import.meta.url);
const {planRoundSetup}=require('../.test-dist/lib/backyard-ai/runtime/round-setup.js');
const {createRoundSetupDraft}=require('../.test-dist/lib/backyard-ai/schemas/round-setup.js');
const {validateCanonicalRoundCommand}=require('../.test-dist/lib/backyard-ai/runtime/canonical-command-guard.js');
const activeDraft=createRoundSetupDraft({date:'2026-09-17',ownerId:'a',players:[{id:'a',name:'Alfa',handicap:0},{id:'b',name:'Bravo',handicap:8}],course:{id:'qa',name:'Synthetic QA course',teeName:'Azules',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))}});
async function call(path,method='GET',body){const r=await request(c.previewOrigin+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
const inputs=[
 ['OLD_502_EXACT','Somos Alfa y Bravo. Nassau match de 100, 100 y 200. Salimos por el hoyo 10. Sin presiones.'],
 ['FULL_EXPLICIT','Somos Alfa y Bravo. Jugamos 18 hoyos. Salimos por el hoyo 10. Skins de 100. Sin presiones. Tee azules.'],
 ['SIMPLE_EQUIVALENT','Skins de 100.'],
];
assert.equal((await call('/api/backyard-ai/consent','PATCH',{scope})).status,200);
const consent={granted:true,version:'2026-09-08-v2',scope};
assert.equal((await call('/api/backyard-ai/round-setup','POST',{input:inputs[0][1],consent})).status,403);
assert.equal((await call('/api/backyard-ai/consent','POST',{scope})).status,200);
const results=[];
for(const [check,input] of inputs){
 const {status,data}=await call('/api/backyard-ai/round-setup','POST',{input,consent});
 assert.equal(status,200,`${check}:${data.code}`);
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
// Private session artifact is for actual browser review at THIS same origin only.
writeFileSync('.qa-artifacts/final-ai-auth.private.json',JSON.stringify({cookies:[],origins:[{origin:c.previewOrigin,localStorage:[{name:'sb-bymeopxkxapfizeeqeyb-auth-token',value:JSON.stringify(auth.data.session)}]}]}));
const report={preview:c.previewOrigin,ref:c.projectRef,results,consentRevokedDenied:true,syntheticOnly:true,roundsCreated:0};
writeFileSync('.qa-artifacts/final-ai-provider.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
