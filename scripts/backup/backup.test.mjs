import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { encrypt, decrypt, encryptionKey, verifyEncrypted } from './crypto.mjs';
import { safeChild, databaseEnvironment, storageConfig, enumerateStorage, backupStorage, runBackup, verifyBackup, command, hashFile, listFiles, jsonFile, QA_REF, OWNER_REF, OWNER_SESSION_POOLER_HOST, OWNER_SESSION_POOLER_USER, decryptBackup, backupDatabase, assertDatabaseReadOnly, storageReadOnlyFetch } from './core.mjs';
import { secretKinds } from './security-scan.mjs';
import { environmentInventory } from './inventory.mjs';
import { verifyDatabaseFile } from './core.mjs';
import { fileURLToPath } from 'node:url';

const temp=()=>mkdtemp(join(tmpdir(),'backyard-dr-test-'));
const keyEnv=()=>({BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
const processEnvWithoutBackup=()=>Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('BACKUP_')));
test('sensitive bytes encrypted, authenticated and recoverable without provider',async()=>{
  const dir=await temp(),env=keyEnv(),key=encryptionKey(env),input=randomBytes(200000),file=join(dir,'data.enc');
  await encrypt(Readable.from([input]),file,key);assert.equal((await readFile(file)).includes(input.subarray(0,40)),false);
  const chunks=[];await decrypt(file,new Writable({write(b,_,done){chunks.push(b);done();}}),key);assert.deepEqual(Buffer.concat(chunks),input);
  assert.equal(await verifyEncrypted(file,key),input.length);
});
test('wrong key, bit flip and truncation cannot verify',async()=>{
  const dir=await temp(),file=join(dir,'data.enc'),key=encryptionKey(keyEnv());await encrypt(Readable.from(['private fixture']),file,key);
  await assert.rejects(verifyEncrypted(file,encryptionKey(keyEnv())));
  const bytes=await readFile(file);bytes[20]^=1;await writeFile(file,bytes);await assert.rejects(verifyEncrypted(file,key));
  await writeFile(file,bytes.subarray(0,10));await assert.rejects(verifyEncrypted(file,key));
});
test('zero byte Storage files are legitimate and encrypted output never overwrites',async()=>{
  const dir=await temp(),file=join(dir,'empty.enc'),key=encryptionKey(keyEnv());await encrypt(Readable.from([]),file,key);assert.equal(await verifyEncrypted(file,key),0);
  await assert.rejects(encrypt(Readable.from(['replacement']),file,key));assert.equal(await verifyEncrypted(file,key),0);
});
test('encryption key is required and never substituted with a default',()=>{
  for(const BACKUP_ENCRYPTION_KEY of ['', 'x', randomBytes(16).toString('base64')]) assert.throws(()=>encryptionKey({BACKUP_ENCRYPTION_KEY}));
});
test('manifest rejects traversal, Windows drives, streams and absolute paths',()=>{
  const root=resolve('backups');for(const path of ['../private','/root','C:/secret','a\\b','x:stream','a/../b','a//b',''])assert.throws(()=>safeChild(root,path));
  assert.equal(safeChild(root,'storage/object.enc'),resolve(root,'storage/object.enc'));
});
test('QA database remains authorized with sanitized libpq options and TLS',()=>{
  const env={BACKUP_SOURCE:'qa',BACKUP_EXPECTED_REF:QA_REF,BACKUP_PGHOST:`db.${QA_REF}.supabase.co`,BACKUP_PGUSER:'postgres',BACKUP_PGPASSWORD:'synthetic-only'};
  const pg=databaseEnvironment(env);assert.equal(pg.PGOPTIONS,undefined);assert.equal(pg.PGSSLMODE,'verify-full');
  assert.equal(pg.PGPASSWORD,env.BACKUP_PGPASSWORD);
  for(const change of [{BACKUP_EXPECTED_REF:'wrong'},{BACKUP_PGHOST:'db.zhqmlpljloumldaczcfp.supabase.co'},{BACKUP_PGHOST:'evil.example'},{BACKUP_PGPORT:'6543'},{BACKUP_SOURCE:'production'}])assert.throws(()=>databaseEnvironment({...env,...change}));
  assert.throws(()=>databaseEnvironment({...env,BACKUP_PGHOST:'aws-0-us-east-1.pooler.supabase.com',BACKUP_PGUSER:`postgres.${QA_REF}`}));
});
const ownerEnv=()=>({BACKUP_SOURCE:'owner',BACKUP_EXPECTED_REF:OWNER_REF,BACKUP_PGHOST:`db.${OWNER_REF}.supabase.co`,BACKUP_PGUSER:'postgres',BACKUP_PGPASSWORD:'synthetic-only',...keyEnv()});
const ownerPoolerEnv=()=>({...ownerEnv(),BACKUP_PGHOST:OWNER_SESSION_POOLER_HOST,BACKUP_PGPORT:'5432',BACKUP_PGUSER:OWNER_SESSION_POOLER_USER});
test('owner database accepts only the exact direct or Session Pooler identity',()=>{
  const env=ownerEnv(),direct=databaseEnvironment(env),poolerEnv=ownerPoolerEnv(),pooler=databaseEnvironment(poolerEnv);
  assert.equal(OWNER_REF,'zhqmlpljloumldaczcfp');
  assert.equal(OWNER_SESSION_POOLER_HOST,'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(OWNER_SESSION_POOLER_USER,'postgres.zhqmlpljloumldaczcfp');
  assert.equal(direct.PGHOST,`db.${OWNER_REF}.supabase.co`);assert.equal(direct.PGUSER,'postgres');assert.equal(direct.PGSSLMODE,'verify-full');
  assert.equal(pooler.PGHOST,'aws-0-us-east-1.pooler.supabase.com');assert.equal(pooler.PGPORT,'5432');assert.equal(pooler.PGUSER,'postgres.zhqmlpljloumldaczcfp');
  assert.equal(pooler.PGOPTIONS,undefined);assert.equal(pooler.PGSSLMODE,'verify-full');
  for(const change of [
    {BACKUP_SOURCE:'production'},{BACKUP_SOURCE:'qa'},{BACKUP_SOURCE:'local'},
    {BACKUP_EXPECTED_REF:QA_REF},{BACKUP_EXPECTED_REF:'another-project'},
    {BACKUP_PGHOST:`db.${QA_REF}.supabase.co`},{BACKUP_PGHOST:'localhost'},{BACKUP_PGHOST:'127.0.0.1'},
    {BACKUP_PGHOST:'db.other.supabase.co',BACKUP_EXPECTED_REF:'other',BACKUP_ALLOW_PRODUCTION:'true'},
    {BACKUP_PGHOST:`db.${OWNER_REF}.supabase.co.evil.invalid`},{BACKUP_PGHOST:`db.${OWNER_REF}.supabase.co,evil.invalid`},
    {BACKUP_PGUSER:`postgres.${QA_REF}`},{BACKUP_PGUSER:'other'},
    {BACKUP_PGPORT:'6543'},{BACKUP_PGPORT:'5433'},
    {BACKUP_PGDATABASE:'host=evil.invalid dbname=postgres'},
    {BACKUP_PGDATABASE:'postgresql://evil.invalid/postgres'}, {BACKUP_PGDATABASE:'another_database'}
  ])assert.throws(()=>databaseEnvironment({...env,...change}),undefined,JSON.stringify(Object.keys(change)));
  for(const change of [
    {BACKUP_PGHOST:'aws-1-us-east-1.pooler.supabase.com'},
    {BACKUP_PGHOST:'aws-0-us-west-1.pooler.supabase.com'},
    {BACKUP_PGHOST:`${OWNER_SESSION_POOLER_HOST}.evil.invalid`},
    {BACKUP_PGUSER:'postgres'},{BACKUP_PGUSER:`postgres.${QA_REF}`},{BACKUP_PGUSER:`${OWNER_SESSION_POOLER_USER}.other`},
    {BACKUP_EXPECTED_REF:QA_REF},{BACKUP_EXPECTED_REF:'another-project'},
    {BACKUP_SOURCE:'qa'},{BACKUP_SOURCE:'production'},
    {BACKUP_PGPORT:'6543'},{BACKUP_PGPORT:'5433'}
  ])assert.throws(()=>databaseEnvironment({...poolerEnv,...change}),undefined,JSON.stringify(Object.keys(change)));
  assert.ok(databaseEnvironment({...env,BACKUP_SOURCE:'local',BACKUP_PGHOST:'127.0.0.1',BACKUP_PGPORT:'54322',BACKUP_PGDATABASE:'test_local'}));
});
test('inherited libpq settings and alternate connection strings cannot redirect or inject startup options',()=>{
  const pg=databaseEnvironment({...ownerEnv(),PATH:'test-path',PGHOSTADDR:'203.0.113.10',pghostaddr:'203.0.113.11',PGSERVICE:'untrusted',PGSERVICEFILE:'untrusted',PGPASSFILE:'untrusted',PGDATABASE:'host=untrusted',PGOPTIONS:'-c default_transaction_read_only=off',pgoptions:'-c transaction_read_only=off',PGSSLMODE:'disable',BACKUP_STORAGE_KEY:'synthetic-storage-key'});
  assert.equal(pg.PATH,'test-path');assert.equal(pg.PGHOSTADDR,undefined);assert.equal(pg.pghostaddr,undefined);
  for(const name of ['PGSERVICE','PGSERVICEFILE','PGPASSFILE'])assert.ok(!Object.hasOwn(pg,name));
  assert.equal(pg.PGSSLMODE,'verify-full');assert.equal(pg.PGDATABASE,'postgres');
  assert.ok(!Object.keys(pg).some(k=>/^PGOPTIONS$/i.test(k)));
  assert.ok(!Object.keys(pg).some(k=>k.startsWith('BACKUP_')));
});
function databaseTools(replies=['on\n']){
  const calls=[];let checks=0;
  return{calls,tools:{
    command:async(executable,args,{env})=>{
      calls.push({executable,args,env});
      if(executable==='psql'){const result=replies[Math.min(checks++,replies.length-1)];if(result instanceof Error)throw result;return result;}
      return 'pg_dump (PostgreSQL) 17.11\n';
    },
    encryptedCommand:async(executable,args,file,key,env,input)=>{calls.push({executable,args,file,key,env,input});}
  }};
}
test('explicit read-only transaction preflight protects direct and Session Pooler exports',async()=>{
  for(const env of [ownerEnv(),ownerPoolerEnv()])for(const schemaOnly of [false,true]){
    const fixture=databaseTools(),result=await backupDatabase(await temp(),env,schemaOnly,fixture.tools);
    assert.equal(result.state,'PASS');
    const calls=fixture.calls,checks=calls.filter(c=>c.executable==='psql');assert.equal(checks.length,schemaOnly?1:2);
    for(const c of calls){assert.ok(!Object.keys(c.env).some(k=>/^PGOPTIONS$/i.test(k)));assert.ok(!c.args.some(a=>a.includes(env.BACKUP_PGPASSWORD)));assert.equal(c.env.BACKUP_ENCRYPTION_KEY,undefined);assert.equal(c.env.PGSSLMODE,'verify-full');}
    for(const c of checks){assert.ok(c.args.includes('-X'));assert.ok(c.args.includes('--no-password'));assert.ok(c.args.includes('--quiet'));assert.ok(c.args.includes('--tuples-only'));assert.ok(c.args.includes('--no-align'));assert.ok(c.args.includes('--set=ON_ERROR_STOP=1'));assert.deepEqual(c.args.filter(a=>a.startsWith('--command=')),['--command=BEGIN TRANSACTION READ ONLY; SHOW transaction_read_only; ROLLBACK;']);assert.ok(!c.args.some(a=>a.includes('default_transaction_read_only')));}
    const exports=calls.filter(c=>c.file);assert.equal(exports.length,schemaOnly?1:4);
    assert.ok(calls.indexOf(checks[0])<calls.indexOf(exports[0]));
    if(!schemaOnly){assert.ok(calls.indexOf(checks[1])<calls.indexOf(exports[3]));assert.equal(exports[3].executable,'pg_dumpall');}
    for(const c of exports){assert.ok(c.file.endsWith('.enc'));assert.equal(c.key.length,32);if(c.executable==='pg_restore'){assert.ok(c.args.includes('--file=-'));assert.ok(c.input.endsWith('.enc'));assert.ok(!c.args.some(a=>a.startsWith('--dbname')));}}
  }
});
test('off, malformed or failed explicit read-only checks abort before any dump or output directory',async()=>{
  for(const output of ['off\n','','on\non\n','BEGIN\non\nROLLBACK\n','on\nprivate-diagnostic',null,new Error('private-diagnostic')]){
    for(const schemaOnly of [false,true]){
      const dir=await temp(),fixture=databaseTools([output]);
      await assert.rejects(backupDatabase(dir,ownerEnv(),schemaOnly,fixture.tools),e=>/READ_ONLY_/.test(e.message)&&!e.message.includes('private-diagnostic'));
      assert.equal(fixture.calls.filter(c=>c.file).length,0);assert.deepEqual(await readdir(dir),[]);
    }
  }
  await assertDatabaseReadOnly(databaseEnvironment(ownerPoolerEnv()),databaseTools(['on\r\n']).tools.command);
});
test('a changed role-export read-only check aborts instead of running pg_dumpall',async()=>{
  const fixture=databaseTools(['on\n','off\n']);
  await assert.rejects(backupDatabase(await temp(),ownerEnv(),false,fixture.tools),/READ_ONLY_NOT_CONFIRMED/);
  assert.equal(fixture.calls.filter(c=>c.file&&c.executable==='pg_dumpall').length,0);
});
test('DB and Storage reject missing encryption before connecting or writing local payloads',async()=>{
  const env=ownerEnv();delete env.BACKUP_ENCRYPTION_KEY;
  const dir=await temp(),fixture=databaseTools();let storageCreated=false;
  await assert.rejects(backupDatabase(dir,env,false,fixture.tools),/ENCRYPTION_KEY/);assert.equal(fixture.calls.length,0);
  await assert.rejects(backupStorage(dir,{...env,BACKUP_STORAGE_URL:`https://${OWNER_REF}.supabase.co`,BACKUP_STORAGE_KEY:'synthetic'},()=>{storageCreated=true;}),/ENCRYPTION_KEY/);
  assert.equal(storageCreated,false);assert.deepEqual(await readdir(dir),[]);
});
test('provider and process diagnostics never appear in thrown errors',async()=>{
  await assert.rejects(command(process.execPath,['-e',"process.stderr.write('private-diagnostic');process.exit(1)"]),e=>e.message==='COMMAND_FAILED');
  await assert.rejects(assertDatabaseReadOnly(databaseEnvironment(ownerEnv()),async()=>{throw Error('private-diagnostic');}),e=>e.message==='READ_ONLY_CHECK_FAILED');
});
test('Storage binds source/ref and exact HTTPS URL; modern keys pass through only in memory',()=>{
  for(const [source,ref]of [['owner',OWNER_REF],['qa',QA_REF]]){
    const env={BACKUP_SOURCE:source,BACKUP_EXPECTED_REF:ref,BACKUP_STORAGE_URL:`https://${ref}.supabase.co`,BACKUP_STORAGE_KEY:'sb_secret_'+'synthetic-fixture'};
    assert.equal(storageConfig(env).key,env.BACKUP_STORAGE_KEY);
    for(const change of [{BACKUP_SOURCE:'production'},{BACKUP_EXPECTED_REF:'other'},
      {BACKUP_STORAGE_URL:`https://${ref===OWNER_REF?QA_REF:OWNER_REF}.supabase.co`},
      {BACKUP_STORAGE_URL:env.BACKUP_STORAGE_URL+'/'},{BACKUP_STORAGE_URL:env.BACKUP_STORAGE_URL+'.evil.invalid'},
      {BACKUP_STORAGE_URL:env.BACKUP_STORAGE_URL+'?override=true'},{BACKUP_STORAGE_URL:env.BACKUP_STORAGE_URL.replace('https:','http:')},
      {BACKUP_STORAGE_URL:'https://other.supabase.co',BACKUP_EXPECTED_REF:'other',BACKUP_ALLOW_PRODUCTION:'true'}
    ])assert.throws(()=>storageConfig({...env,...change}),/STORAGE_REF_NOT_AUTHORIZED/);
  }
});
test('Storage transport allows only bucket list, object list and download, without redirects',async()=>{
  const origin=`https://${OWNER_REF}.supabase.co`,calls=[],transport=storageReadOnlyFetch(origin,async(input,init)=>{calls.push({input,init});return new Response('[]');});
  for(const [path,method]of [['/storage/v1/bucket','GET'],['/storage/v1/object/list/private','POST'],['/storage/v1/object/private/folder/a.png','GET'],['/storage/v1/object/authenticated/private/a.png','GET']])await transport(origin+path,{method});
  assert.equal(calls.length,4);assert.ok(calls.every(c=>c.init.redirect==='error'&&c.init.signal));
  for(const [path,method]of [['/storage/v1/bucket','POST'],['/storage/v1/bucket/private','DELETE'],['/storage/v1/object/private/a.png','PUT'],['/storage/v1/object/private/a.png','POST'],['/storage/v1/object/private/a.png','DELETE'],['/storage/v1/object/move','POST'],['/auth/v1/token','POST'],['/rest/v1/feedback','GET']])assert.throws(()=>transport(origin+path,{method}),/STORAGE_OPERATION_NOT_READ_ONLY/);
  assert.throws(()=>transport(`https://${QA_REF}.supabase.co/storage/v1/bucket`),/CROSS_ORIGIN/);
  assert.throws(()=>transport(origin.replace('https://','https://synthetic@')+'/storage/v1/bucket'),/CROSS_ORIGIN/);
  assert.equal(calls.length,4);
});
test('actual Supabase SDK with modern secret credential uses read-only Storage routes and encrypted payloads',async(t)=>{
  const env={...ownerEnv(),BACKUP_STORAGE_URL:`https://${OWNER_REF}.supabase.co`,BACKUP_STORAGE_KEY:'sb_secret_'+'synthetic-fixture'},calls=[];
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const url=new URL(input),headers=new Headers(init.headers);calls.push({path:url.pathname,method:init.method||'GET'});
    assert.equal(url.origin,env.BACKUP_STORAGE_URL);assert.equal(headers.get('apikey'),env.BACKUP_STORAGE_KEY);
    assert.equal(init.redirect,'error');
    if(url.pathname==='/storage/v1/bucket')return Response.json([{id:'private',public:false}]);
    if(url.pathname==='/storage/v1/object/list/private')return Response.json([{id:'fixture-id',name:'a.png',metadata:{size:3}}]);
    if(url.pathname==='/storage/v1/object/private/a.png')return new Response('abc');
    throw Error('unexpected route');
  });
  const dir=await temp(),result=await backupStorage(dir,env);assert.equal(result.state,'PASS');assert.equal(result.objects,1);
  assert.deepEqual(calls.map(c=>c.method),['GET','POST','GET','GET','POST']);
  assert.ok((await listFiles(dir)).every(f=>f.endsWith('.enc')));
  const chunks=[];await decrypt(join(dir,'storage/index.json.enc'),new Writable({write(b,_,cb){chunks.push(b);cb();}}),encryptionKey(env));
  const index=JSON.parse(Buffer.concat(chunks));assert.equal(index.objects[0].name,'a.png');assert.equal(await verifyEncrypted(join(dir,index.objects[0].file),encryptionKey(env)),3);
});
test('Storage refuses wrong ref before making any request',()=>{
  assert.throws(()=>storageConfig({BACKUP_SOURCE:'qa',BACKUP_EXPECTED_REF:QA_REF,BACKUP_STORAGE_URL:'https://zhqmlpljloumldaczcfp.supabase.co',BACKUP_STORAGE_KEY:'test'}));
});
function mockStorage({changed=false,deny=false}={}){
  let listings=0;
  const record=(name)=>({id:name,name,updated_at:'2026-01-01',metadata:{size:3,mimetype:'image/png'}});
  return{storage:{listBuckets:async()=>({data:[{id:'private',public:false}],error:null}),from:()=>({
    list:async(prefix,{offset})=>{if(deny)return{error:{message:'secret-not-logged'}};if(!prefix){listings++;return{data:offset?[]:[{id:null,metadata:null,name:'nested'}]};}return{data:offset?[]:[{...record('object.png'),updated_at:changed&&listings>1?'new':'old'}]};},
    download:async()=>({data:new Blob(['abc'],{type:'image/png'}),error:null})
  })}};
}
test('Storage directory traversal and pagination cover more than 1000 objects',async()=>{
  const entries=Array.from({length:1001},(_,i)=>({id:String(i),name:`item${i}`,metadata:{size:1}}));const offsets=[];
  const client={storage:{listBuckets:async()=>({data:[{id:'bucket',public:false}]}),from:()=>({list:async(_,{offset,limit})=>{offsets.push(offset);return{data:entries.slice(offset,offset+limit)};}})}};
  const result=await enumerateStorage(client);assert.equal(result.objects.length,1001);assert.deepEqual(offsets,[0,1000]);
});
test('Storage exports bucket metadata, private names index and actual bytes separately',async()=>{
  const dir=await temp(),env={...keyEnv(),BACKUP_SOURCE:'qa',BACKUP_EXPECTED_REF:QA_REF,BACKUP_STORAGE_URL:`https://${QA_REF}.supabase.co`,BACKUP_STORAGE_KEY:'synthetic'};
  const result=await backupStorage(dir,env,()=>mockStorage());assert.equal(result.objects,1);assert.equal(result.buckets,1);
  assert.equal((await listFiles(dir)).length,2);assert.ok((await readdir(join(dir,'storage/objects'))).every(f=>/^[a-f0-9]{64}\.enc$/.test(f)));
  const chunks=[];await decrypt(join(dir,'storage/index.json.enc'),new Writable({write(b,_,cb){chunks.push(b);cb();}}),encryptionKey(env));
  const index=JSON.parse(Buffer.concat(chunks));assert.equal(index.buckets[0].public,false);assert.equal(index.objects[0].name,'nested/object.png');
});
test('Storage changing during backup and denied listing never become success',async()=>{
  const env={...keyEnv(),BACKUP_SOURCE:'qa',BACKUP_EXPECTED_REF:QA_REF,BACKUP_STORAGE_URL:`https://${QA_REF}.supabase.co`,BACKUP_STORAGE_KEY:'synthetic'};
  await assert.rejects(backupStorage(await temp(),env,()=>mockStorage({changed:true})),/STORAGE_CHANGED/);
  await assert.rejects(backupStorage(await temp(),env,()=>mockStorage({deny:true})),/STORAGE_OBJECT_LIST_FAILED/);
});
async function fixtureRepo(){const repo=await temp();await command('git',['init','-b','infra/dr-test',repo]);await command('git',['config','user.name','Synthetic QA'],{cwd:repo});await command('git',['config','user.email','qa@example.invalid'],{cwd:repo});await writeFile(join(repo,'README.md'),'recoverable source\n');await writeFile(join(repo,'.gitignore'),'backups/\n');await command('git',['add','.'],{cwd:repo});await command('git',['commit','-m','synthetic fixture'],{cwd:repo});return repo;}
test('master continues with independent Git backup when DB/Storage access missing; repeated runs do not overwrite',async()=>{
  const repo=await fixtureRepo(),env={...processEnvWithoutBackup(),BACKUP_ROOT:''};const first=await runBackup({repo,env});
  assert.equal(first.manifest.components.source.state,'PASS');assert.equal(first.manifest.databaseBackup,false);assert.equal(first.manifest.storageBackup,false);
  assert.equal(first.manifest.components.database.state,'BLOCKED_EXTERNAL');
  const verification=await verifyBackup(first.directory,{});assert.equal(verification.integrity,'PASS');assert.equal(verification.recoveryComplete,false);
  const second=await runBackup({repo,env});assert.notEqual(first.directory,second.directory);
  assert.equal(await readFile(join(repo,'README.md'),'utf8'),'recoverable source\n');
  const restored=join(await temp(),'restored');await command('git',['-c','core.autocrlf=false','clone',join(first.directory,'source/repository.bundle'),restored]);await command('git',['fsck','--full'],{cwd:restored});assert.equal(await readFile(join(restored,'README.md'),'utf8'),'recoverable source\n');
  await appendFile(join(first.directory,'source/HEAD.tar'),'corruption');await assert.rejects(verifyBackup(first.directory,{}),/CHECKSUM/);
});
test('backups never target a served or tracked app directory',async()=>{
  const repo=await fixtureRepo();for(const path of [repo,join(repo,'public'),join(repo,'.git'),join(repo,'app'),join(repo,'..not-outside')])await assert.rejects(runBackup({repo,env:{BACKUP_ROOT:path}}),/BACKUP_ROOT/);
});
test('verifier refuses false database completeness and undeclared files',async()=>{
  const repo=await fixtureRepo(),b=await runBackup({repo,env:{}}),path=join(b.directory,'metadata/manifest.json');
  b.manifest.databaseBackup=true;await writeFile(path,JSON.stringify(b.manifest));await assert.rejects(verifyBackup(b.directory,{}),/FALSE_COMPLETENESS/);
  b.manifest.databaseBackup=false;await writeFile(path,JSON.stringify(b.manifest));await writeFile(join(b.directory,'unlisted'),'x');await assert.rejects(verifyBackup(b.directory,{}),/UNLISTED/);
});
test('Storage verifier checks listing-to-object completeness, not merely listing existence',async()=>{
  const dir=await temp(),env=keyEnv(),key=encryptionKey(env);await mkdir(join(dir,'storage'));await mkdir(join(dir,'metadata'));
  await encrypt(Readable.from([JSON.stringify({buckets:[{id:'b'}],objects:[{bucket:'b',name:'x',file:'storage/missing.enc'}]})]),join(dir,'storage/index.json.enc'),key);
  const manifest={formatVersion:1,project:'The Backyard',createdAt:new Date().toISOString(),gitCommit:'1'.repeat(40),gitBranch:'infra/test',databaseBackup:false,schemaBackup:false,storageBackup:true,components:{storage:{state:'PASS',objects:1,buckets:1}},files:[{path:'storage/index.json.enc',...await hashFile(join(dir,'storage/index.json.enc')),encrypted:true}]};
  await jsonFile(join(dir,'metadata/manifest.json'),manifest);await assert.rejects(verifyBackup(dir,env),/STORAGE_OBJECT_MISSING/);
});
test('decrypt requires explicit local acknowledgment and never overwrites target',async()=>{
  const repo=await fixtureRepo(),b=await runBackup({repo,env:{}}),out=join(await temp(),'new');await assert.rejects(decryptBackup(b.directory,out,{}),/ACK_REQUIRED/);
  await mkdir(out);await assert.rejects(decryptBackup(b.directory,out,{BACKUP_DECRYPT_ACK:'PRIVATE_LOCAL_DIRECTORY'}));
});
test('secret scanner reports categories only; public anon is not service role',()=>{
  const token=(role)=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.'+'s'.repeat(40);
  // Explicit service JWT fixture starts with the conventional header prefix.
  const jwt=(role)=>'eyJhbGciOiJIUzI1NiJ9.'+token(role).split('.').slice(1).join('.');
  assert.deepEqual(secretKinds(jwt('anon')),[]);assert.deepEqual(secretKinds(jwt('service_role')),['SUPABASE_SERVICE_ROLE_JWT']);
  assert.deepEqual(secretKinds('gh'+'p_'+'a'.repeat(40)),['GITHUB_TOKEN']);
  assert.deepEqual(secretKinds('-----BEGIN '+'PRIVATE KEY-----'),['PRIVATE_KEY']);
});

test('SQL and custom archive verification rejects encrypted garbage, not only empty files',async()=>{
  const dir=await temp(),key=encryptionKey(keyEnv());
  for(const [name,text,valid] of [
    ['good-schema','-- PostgreSQL database dump\nCREATE TABLE example(id integer);',true],
    ['garbage','provider error body',false],['empty-schema','-- PostgreSQL database dump\n-- no definitions',false]
  ]){const path=join(dir,name+'.enc');await encrypt(Readable.from([text]),path,key);
    if(valid)await verifyDatabaseFile(path,'schema.sql.enc',key);else await assert.rejects(verifyDatabaseFile(path,'schema.sql.enc',key));
  }
  const archive=join(dir,'custom.enc');await encrypt(Readable.from(['not a pg archive']),archive,key);
  await assert.rejects(verifyDatabaseFile(archive,'full.dump.enc',key),/INVALID_POSTGRES_ARCHIVE/);
});

test('environment example contains empty assignments and every detected runtime/tool variable',async()=>{
  const repo=fileURLToPath(new URL('../../',import.meta.url));
  const lines=(await readFile(join(repo,'.env.example'),'utf8')).trim().split(/\r?\n/);
  assert.ok(lines.every(l=>/^[A-Z][A-Z0-9_]*=$/.test(l)));
  const names=lines.map(l=>l.slice(0,-1));assert.equal(names.length,new Set(names).size);
  const document=await readFile(join(repo,'docs/disaster-recovery/ENVIRONMENT_VARIABLES.md'),'utf8');
  for(const {name}of await environmentInventory(repo)){assert.ok(names.includes(name),name);assert.ok(document.includes('`'+name+'`'),name);}
});

test('ignore rules block backups, env and keys without hiding source migrations',async()=>{
  const repo=fileURLToPath(new URL('../../',import.meta.url));
  for(const name of ['backups/test/database/full.dump','restore-private/data.sql','.env.local','private.pem','schema.sql']){
    assert.ok((await command('git',['check-ignore',name],{cwd:repo})).trim());
  }
  await assert.rejects(command('git',['check-ignore','.env.example'],{cwd:repo}));
  await assert.rejects(command('git',['check-ignore','supabase/migrations/202609010001_golf_bets_v3.sql'],{cwd:repo}));
});

test('decryption cannot write sensitive plaintext into the served application',async()=>{
  const repo=await fixtureRepo(),backup=await runBackup({repo,env:{}});
  const realRepo=fileURLToPath(new URL('../../',import.meta.url));
  for(const target of [join(realRepo,'public','private-backup'),join(realRepo,'app','private-backup'),join(realRepo,'..not-outside')])
    await assert.rejects(decryptBackup(backup.directory,target,{BACKUP_DECRYPT_ACK:'PRIVATE_LOCAL_DIRECTORY'}),/DECRYPT_TARGET_MUST_BE_PRIVATE_NOT_SERVED/);
});
