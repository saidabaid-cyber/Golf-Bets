// Read-only release evidence. Existing synthetic identities, exact QA ref only.
// No email, OAuth provider interaction, administrative secret, or data mutation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig();
assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const request=credentialBoundFetch(config.previewOrigin);
await verifyPreviewBundleBinding(config,request);
const A=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json')).find(f=>f.label==='C');
const B=JSON.parse(readFileSync('.qa-artifacts/catalog-b.private.json'));
async function login(f){
 assert.equal(f.ref,config.projectRef);assert.ok(f.email.endsWith('@example.invalid'));
 const db=createClient(config.supabaseOrigin,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:credentialBoundFetch(config.supabaseOrigin)}});
 const r=await db.auth.signInWithPassword({email:f.email,password:f.password});assert.equal(r.error,null);assert.equal(r.data.user.id,f.id);
 return {db,token:r.data.session.access_token};
}
let a=await login(A);const b=await login(B);
const report={preview:config.previewOrigin,ref:config.projectRef,checks:[],mutations:0,emailsSent:0};
async function get(path,session=a,status=200){const r=await request(config.previewOrigin+path,{headers:session?{authorization:`Bearer ${session.token}`}:{}});const data=await r.json();assert.equal(r.status,status,`${path}: HTTP ${r.status}`);return data;}
const settings=await fetch(config.supabaseOrigin+'/auth/v1/settings',{headers:{apikey:config.publicKey}}).then(r=>r.json());
report.providers={google:settings.external?.google,email:settings.external?.email,apple:settings.external?.apple};
report.flags=await get('/api/features',null);
for(const path of ['/api/cloud/rounds','/api/account/completion','/api/account/entry'])await get(path,null,401);
await get('/api/account/entry?email=qa-enumeration@example.invalid',a,400);
report.checks.push('anonymous account/cloud/completion denied','account existence query selector rejected');
const entry=await get('/api/account/entry');assert.equal(entry.userId,A.id);assert.equal(entry.existingAccount,true);
const profile=await a.db.from('profiles').select('id,display_name,username').eq('id',A.id);assert.equal(profile.error,null);assert.equal(profile.data.length,1);
const completion=await get('/api/account/completion');assert.ok(completion.progress.percent>=0&&completion.progress.percent<=100);
const history=await get('/api/cloud/rounds');assert.equal(new Set(history.rounds.map(r=>r.id)).size,history.rounds.length);
const ownEquipment=await a.db.from('player_equipment_profiles').select('version,snapshot').eq('user_id',A.id);assert.equal(ownEquipment.error,null);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const [session,other] of [[a,B],[b,A]])for(const [table,key]of [['profiles','id'],['user_preferences','user_id'],['player_equipment_profiles','user_id'],['ai_processing_consents','user_id'],['profile_completion_choices','user_id']]){
 const result=await session.db.from(table).select(key).eq(key,other.id);assert.equal(result.error,null,table);assert.deepEqual(result.data,[],table);
 report.checks.push(`${session===a?'A→B':'B→A'} ${table} private read denied`);
}
await a.db.auth.signOut({scope:'local'});a=await login(A);
assert.equal((await get('/api/account/entry')).userId,A.id);
assert.deepEqual(await get('/api/account/completion'),completion);
const reloadedEquipment=await a.db.from('player_equipment_profiles').select('version,snapshot').eq('user_id',A.id);assert.equal(reloadedEquipment.error,null);assert.equal(hash(reloadedEquipment.data),hash(ownEquipment.data));
const later=await get('/api/cloud/rounds');assert.equal(hash(later.rounds),hash(history.rounds));
report.checks.push('one canonical profile','logout/login same identity','completion fresh-session readback','equipment fresh-session readback','history fresh-session readback / unique IDs');
report.rounds=history.rounds.length;report.completionPercent=completion.progress.percent;
report.onboarding=entry.onboardingProgress?.status;
writeFileSync('.qa-artifacts/release-readback-report.json',JSON.stringify(report,null,2));
writeFileSync('.qa-artifacts/release-baseline.private.json',JSON.stringify({ref:config.projectRef,userId:A.id,rounds:history.rounds}));
console.log(JSON.stringify(report,null,2));
