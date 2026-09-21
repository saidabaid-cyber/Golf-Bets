// Real isolated QA: existing synthetic identities; no Auth/profile/history mutations.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig(),request=credentialBoundFetch(config.previewOrigin);
await verifyPreviewBundleBinding(config,request);
const fixtures=JSON.parse(readFileSync('.qa-artifacts/beta-fixtures.private.json','utf8'));
fixtures.push({...JSON.parse(readFileSync('.qa-artifacts/catalog-b.private.json','utf8')),label:'CATALOG_B'});
async function login(label){const fixture=fixtures.find(f=>f.label===label);assert.equal(fixture.ref,config.projectRef);assert.ok(fixture.email.endsWith('@example.invalid'));const db=createClient(config.supabaseOrigin,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:credentialBoundFetch(config.supabaseOrigin)}});const r=await db.auth.signInWithPassword({email:fixture.email,password:fixture.password});assert.equal(r.error,null);assert.equal(r.data.user.id,fixture.id);return{db,token:r.data.session.access_token,id:fixture.id};}
let A=await login('C');const B=await login('CATALOG_B');assert.notEqual(A.id,B.id);
const idsFile='.qa-artifacts/feedback-live-ids.json';
const ids=existsSync(idsFile)?JSON.parse(readFileSync(idsFile,'utf8')):Object.fromEntries(['COURSE','BUG','CLUB','BET'].map(c=>[c,randomUUID()]));
writeFileSync(idsFile,JSON.stringify(ids));
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIoAAAAAASUVORK5CYII=';
const base={name:'Solicitud QA sintética — no es un dato de catálogo',description:'Prueba controlada de recepción interna y persistencia. No incorporar estos datos al catálogo.',replyEmail:'feedback-qa@example.invalid',city:'Ciudad QA',state:'Estado QA',brand:'Marca QA sintética',model:'Modelo QA sintético',rules:'Regla sintética: no modificar motores.'};
const report={preview:config.previewOrigin,ref:config.projectRef,requests:[],checks:[],newAuthUsers:0,historicalWrites:0};
async function post(body,user=A,expected=200){const r=await request(config.previewOrigin+'/api/feedback',{method:'POST',headers:{authorization:`Bearer ${user.token}`,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,`feedback status ${r.status}`);return data;}
const availability=await(await request(config.previewOrigin+'/api/feedback')).json();assert.equal(availability.internalRequestsAvailable,true);report.mailerConfigured=availability.serverEmailAvailable;
// No live test email is authorized. Stop before creating anything if enabled.
assert.equal(availability.serverEmailAvailable,false,'Mailer active: separate owner authorization is required before live requests.');
for(const category of Object.keys(ids)){
 const body={id:ids[category],input:{...base,category},screen:'qa-feedback-live',contextualCategory:category,...(category==='BUG'?{attachment:{mime:'image/png',data:image}}:{})};
 const [one,two]=await Promise.all([post(body),post(body)]);assert.equal(one.received,true);assert.equal(two.received,true);assert.equal(one.id,two.id);
 const own=await A.db.from('feedback_requests').select('id,category,request_status,attachment_path,attachment_status,title,source_screen').eq('id',body.id);assert.equal(own.error,null);assert.equal(own.data.length,1);assert.equal(own.data[0].request_status,'NEW');assert.equal(own.data[0].source_screen,'qa-feedback-live');
 const other=await B.db.from('feedback_requests').select('id,description').eq('id',body.id);assert.equal(other.error,null);assert.deepEqual(other.data,[]);
 const mutation=await B.db.from('feedback_requests').update({description:'FORBIDDEN QA mutation'}).eq('id',body.id).select('id');assert.ok(mutation.error?.code==='42501'||mutation.data?.length===0);
 await post(body,B,409);
 if(category==='BUG'){
  assert.equal(own.data[0].attachment_status,'READY');const path=own.data[0].attachment_path;
  const ownImage=await A.db.storage.from('feedback-private').download(path);assert.equal(ownImage.error,null);assert.ok(ownImage.data.size>0);
  const foreignImage=await B.db.storage.from('feedback-private').download(path);assert.ok(foreignImage.error);
  const publicImage=await credentialBoundFetch(config.supabaseOrigin)(config.supabaseOrigin+'/storage/v1/object/public/feedback-private/'+path);assert.ok(!publicImage.ok);
  report.checks.push('private image owner read, foreign/anonymous denied');
 }
 report.requests.push({category,id:body.id,oneRow:true,received:true});
}
const notes=await A.db.from('feedback_requests').select('admin_notes');assert.equal(notes.error?.code,'42501');
await post({id:randomUUID(),input:{...base,category:'BUG'},attachment:{mime:'image/png',data:Buffer.from('<svg>not png</svg>').toString('base64')}},A,400);
const signout=await A.db.auth.signOut({scope:'local'});assert.equal(signout.error,null);A=await login('C');
const after=await A.db.from('feedback_requests').select('id,category,request_status').in('id',Object.values(ids));assert.equal(after.error,null);assert.equal(after.data.length,4);
report.checks.push('four category API creations','concurrent identical requests one row','A/B real authenticated RLS read/write','foreign ID replay rejected','private admin notes denied','spoofed image rejected before persistence','logout/new client login readback four records');
writeFileSync('.qa-artifacts/feedback-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
