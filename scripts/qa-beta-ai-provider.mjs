// Explicit synthetic requests only; no user text/photos or application money decisions.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {createCanvas} from '@napi-rs/canvas';
import {profileCloudQaConfig} from './qa-preview-profile-cloud.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const c=profileCloudQaConfig(process.env);assert.equal(c.projectRef,'bymeopxkxapfizeeqeyb');
const request=credentialBoundFetch(c.previewOrigin);await verifyPreviewBundleBinding(c,request);
const fixture=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json','utf8')).find(a=>a.label==='C');
assert.equal(fixture.ref,c.projectRef);assert.ok(fixture.email.endsWith('@example.invalid'));
const client=createClient(c.supabaseOrigin,c.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:credentialBoundFetch(c.supabaseOrigin)}});
const auth=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});
assert.equal(auth.error,null);assert.equal(auth.data.user.id,fixture.id);
const token=auth.data.session.access_token,version='2026-09-08-v2',scope='AI_PROVIDER_PROCESSING_CONSENT',imageScope='AI_IMAGE_PROCESSING_CONSENT';
const results=[];
async function call(path,method='GET',body){const r=await request(c.previewOrigin+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
const consent=(s=scope)=>({granted:true,version,scope:s});
for(const name of ['round-setup','scorecard','insights','live-question']) results.push({check:`READINESS_${name}`,...await call(`/api/backyard-ai/${name}`)});
const setup={input:'Somos Alfa y Bravo. Nassau match de 100, 100 y 200. Salimos por el hoyo 10. Sin presiones.',consent:consent()};
await call('/api/backyard-ai/consent','PATCH',{scope});
results.push({check:'REVOKED_DENIES_PROVIDER',...await call('/api/backyard-ai/round-setup','POST',setup)});
for(const s of [scope,imageScope]) assert.equal((await call('/api/backyard-ai/consent','POST',{scope:s})).status,200);
results.push({check:'ROUND_SETUP_PROVIDER',...await call('/api/backyard-ai/round-setup','POST',setup)});
results.push({check:'INSIGHTS_PROVIDER',...await call('/api/backyard-ai/insights','POST',{aggregates:{sampleRounds:3,scoreScopeHoles:18,averageScore:82,averagePutts:32,trends:[]},consent:consent()})});
results.push({check:'LIVE_PROVIDER',...await call('/api/backyard-ai/live-question','POST',{question:'¿Cómo voy?',facts:{kind:'HOW_AM_I',status:'PROVISIONAL',player:{gross:20,net:null,relativeToPar:0,thru:5},balance:null,engineVersion:'synthetic-qa'},consent:consent()})});
// A local test drawing, not an uploaded photograph or third-party asset.
const canvas=createCanvas(1000,500),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,500);ctx.fillStyle='black';ctx.font='bold 30px sans-serif';ctx.fillText('SYNTHETIC QA SCORECARD',40,55);ctx.font='26px sans-serif';
for(const [i,line] of ['Course: QA Test','Player: Alfa','Hole:     1    2    3    4    5    6    7    8    9','Par:      4    4    4    4    4    4    4    4    4','Alfa:     4    4    4    4    4    4    4    4    4','Total: 36'].entries())ctx.fillText(line,40,115+i*50);
results.push({check:'SCORECARD_PROVIDER',...await call('/api/backyard-ai/scorecard','POST',{photos:[{id:'synthetic-scorecard',dataUrl:canvas.toDataURL('image/png')}],round:{courseName:'QA Test',playerNames:['Alfa'],roundHoles:9},consent:consent(imageScope)})});
for(const s of [scope,imageScope]) assert.equal((await call('/api/backyard-ai/consent','PATCH',{scope:s})).status,200);
results.push({check:'REVOKE_PERSISTED',...await call('/api/backyard-ai/consent')});
const report={preview:c.previewOrigin,ref:c.projectRef,results,scope:'Real provider requests with explicit synthetic QA consent. No private content. No claim of field/photo accuracy or legal approval.'};
writeFileSync('.qa-artifacts/beta-ai-provider.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(results.some(r=>r.check==='REVOKED_DENIES_PROVIDER'?r.status!==403:r.status!==200)) process.exitCode=1;
