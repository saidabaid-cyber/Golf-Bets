import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { encryptionKey, encrypt, decrypt, verifyEncrypted } from './crypto.mjs';

export const QA_REF = 'bymeopxkxapfizeeqeyb';
export const FORMAT = 1;
export class BackupError extends Error { constructor(code, state = 'FAIL') { super(code); this.code = code; this.state = state; } }
export function safeChild(root, name) {
  if (!name || name.includes('\\') || name.includes(':') || isAbsolute(name) || name.split('/').some(s => !s || s === '.' || s === '..')) throw new BackupError('UNSAFE_PATH');
  const result = resolve(root, name), rel = relative(resolve(root), result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new BackupError('UNSAFE_PATH');
  return result;
}
export async function command(executable, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env || process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new BackupError('COMMAND_TIMEOUT')); }, options.timeout || 120000);
    child.stdout.on('data', data => { size += data.length; if (size < 8e6) output.push(data); else child.kill(); });
    child.stderr.resume(); // Never log DB/client diagnostics: they can contain credentials or object names.
    child.on('error', () => { clearTimeout(timer); reject(new BackupError('TOOL_UNAVAILABLE', 'BLOCKED_EXTERNAL')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0 && size < 8e6) resolveResult(Buffer.concat(output).toString('utf8')); else reject(new BackupError('COMMAND_FAILED')); });
  });
}
export async function hashFile(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
export async function listFiles(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new BackupError('SYMLINK_NOT_ALLOWED');
    if (entry.isDirectory()) found.push(...await listFiles(resolve(root, entry.name), name + '/'));
    else if (entry.isFile()) found.push(name);
    else throw new BackupError('SPECIAL_FILE_NOT_ALLOWED');
  }
  return found.sort();
}
export async function jsonFile(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
export async function verifyDatabaseFile(path, name, key) {
  const pieces=[]; let retained=0;
  await decrypt(path,new Writable({write(chunk,_,done){
    if(retained<131072){const part=chunk.subarray(0,131072-retained);pieces.push(part);retained+=part.length;}done();
  }}),key);
  const prefix=Buffer.concat(pieces);
  if(name.endsWith('full.dump.enc')) {
    if(prefix.subarray(0,5).toString('ascii')!=='PGDMP')throw new BackupError('INVALID_POSTGRES_ARCHIVE');
  } else {
    const text=prefix.toString('utf8');
    if(!/PostgreSQL database(?: cluster)? dump/.test(text))throw new BackupError('INVALID_POSTGRES_SQL');
    if(name.endsWith('schema.sql.enc')&&!/\b(?:CREATE|ALTER)\s/.test(text))throw new BackupError('SCHEMA_DEFINITIONS_MISSING');
  }
}
export function databaseEnvironment(env) {
  const host = env.BACKUP_PGHOST, user = env.BACKUP_PGUSER;
  if (!host || !user || !env.BACKUP_PGPASSWORD) throw new BackupError('SET_BACKUP_PGHOST_PGUSER_PGPASSWORD', 'BLOCKED_EXTERNAL');
  const local = env.BACKUP_SOURCE === 'local' && ['localhost', '127.0.0.1', '::1'].includes(host);
  const qa = env.BACKUP_SOURCE === 'qa' && env.BACKUP_EXPECTED_REF === QA_REF &&
    ((host === `db.${QA_REF}.supabase.co` && user === 'postgres') || (/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === `postgres.${QA_REF}`));
  if (!local && !qa) throw new BackupError('SOURCE_NOT_AUTHORIZED_QA_OR_LOCAL');
  if (!/^\d{2,5}$/.test(env.BACKUP_PGPORT || '5432') || Number(env.BACKUP_PGPORT || '5432') > 65535 || env.BACKUP_PGPORT === '6543') throw new BackupError('USE_DIRECT_OR_SESSION_POOLER');
  return { ...env, PGHOST: host, PGUSER: user, PGPASSWORD: env.BACKUP_PGPASSWORD,
    PGDATABASE: env.BACKUP_PGDATABASE || 'postgres', PGPORT: env.BACKUP_PGPORT || '5432',
    PGSERVICE: '', PGSERVICEFILE: '', PGPASSFILE: '', PGOPTIONS: '-c default_transaction_read_only=on',
    PGSSLMODE: local ? 'disable' : 'verify-full', PGSSLROOTCERT: env.BACKUP_PGSSLROOTCERT || 'system', PGCONNECT_TIMEOUT: '15' };
}
export function storageConfig(env) {
  if (!env.BACKUP_STORAGE_URL || !env.BACKUP_STORAGE_KEY) throw new BackupError('SET_BACKUP_STORAGE_URL_AND_KEY', 'BLOCKED_EXTERNAL');
  if (env.BACKUP_SOURCE !== 'qa' || env.BACKUP_EXPECTED_REF !== QA_REF || env.BACKUP_STORAGE_URL !== `https://${QA_REF}.supabase.co`) throw new BackupError('STORAGE_REF_NOT_AUTHORIZED');
  return { url: env.BACKUP_STORAGE_URL, key: env.BACKUP_STORAGE_KEY };
}
async function encryptedCommand(executable, args, file, key, env, encryptedInput) {
  const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: [encryptedInput ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const completed = new Promise((res, rej) => { child.on('error', () => rej(new BackupError('TOOL_UNAVAILABLE', 'BLOCKED_EXTERNAL'))); child.on('close', c => c === 0 ? res() : rej(new BackupError('DUMP_COMMAND_FAILED'))); });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
  try { await Promise.all([completed, encrypt(child.stdout, file, key), encryptedInput ? decrypt(encryptedInput, child.stdin, key) : Promise.resolve()]); }
  finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); }
}
export async function backupDatabase(dir, env, schemaOnly = false) {
  const pg = databaseEnvironment(env), key = encryptionKey(env);
  await command('pg_dump', ['--version'], { env: pg });
  await mkdir(resolve(dir, 'database'), { mode: 0o700 });
  if (schemaOnly) {
    await encryptedCommand('pg_dump', ['--schema-only', '--no-owner', '--no-password'], resolve(dir, 'database/schema.sql.enc'), key, pg);
    return { state: 'PASS', coverage: 'schema only; not data or Storage bytes' };
  }
  await command('pg_restore', ['--version'], { env: pg });
  await command('pg_dumpall', ['--version'], { env: pg });
  const archive = resolve(dir, 'database/full.dump.enc');
  await encryptedCommand('pg_dump', ['--format=custom', '--no-owner', '--no-password'], archive, key, pg);
  // Derive both views from ONE logical snapshot, not two inconsistent pg_dump runs.
  await encryptedCommand('pg_restore', ['--schema-only', '--no-owner', '--file=-'], resolve(dir, 'database/schema.sql.enc'), key, pg, archive);
  await encryptedCommand('pg_restore', ['--data-only', '--no-owner', '--file=-'], resolve(dir, 'database/data.sql.enc'), key, pg, archive);
  await encryptedCommand('pg_dumpall', ['--roles-only', '--no-role-passwords', '--no-password'], resolve(dir, 'database/roles.sql.enc'), key, pg);
  return { state: 'PASS', coverage: 'one logical PostgreSQL archive; auth/storage schemas included when role permits; files separate', tool: (await command('pg_dump', ['--version'], { env: pg })).trim() };
}
export async function enumerateStorage(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error || !Array.isArray(buckets)) throw new BackupError('STORAGE_BUCKET_LIST_DENIED', 'BLOCKED_EXTERNAL');
  const objects = [], visited = new Set();
  for (const bucket of buckets) {
    const queue = [''];
    while (queue.length) {
      const prefix = queue.shift(), marker = `${bucket.id}/${prefix}`;
      if (visited.has(marker)) throw new BackupError('STORAGE_DIRECTORY_CYCLE'); visited.add(marker);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from(bucket.id).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error || !Array.isArray(data)) throw new BackupError('STORAGE_OBJECT_LIST_FAILED');
        if (!data.length) break;
        for (const item of data) {
          if (!item.name || item.name.includes('/') || item.name === '.' || item.name === '..') throw new BackupError('UNSUPPORTED_STORAGE_NAME');
          const name = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.id === null && item.metadata === null) queue.push(name);
          else if (item.id) objects.push({ bucket: bucket.id, name, id: item.id, updatedAt: item.updated_at, metadata: item.metadata });
          else throw new BackupError('UNRECOGNIZED_STORAGE_ENTRY');
        }
        if (data.length < 1000) break;
        if (offset > 10000000) throw new BackupError('STORAGE_LIST_LIMIT');
      }
    }
  }
  return { buckets, objects: objects.sort((a,b) => `${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`)) };
}
export async function backupStorage(dir, env, clientFactory) {
  const config = storageConfig(env), key = encryptionKey(env);
  const factory = clientFactory || (await import('@supabase/supabase-js')).createClient;
  const client = factory(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => {
    if (new URL(typeof url === 'string' ? url : url.url || url.href).origin !== config.url) throw new BackupError('CROSS_ORIGIN_STORAGE_REQUEST');
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(120000) });
  } } });
  const before = await enumerateStorage(client);
  await mkdir(resolve(dir, 'storage/objects'), { recursive: true, mode: 0o700 });
  for (const object of before.objects) {
    const { data, error } = await client.storage.from(object.bucket).download(object.name);
    if (error || !data) throw new BackupError('STORAGE_DOWNLOAD_FAILED');
    if (typeof object.metadata?.size === 'number' && object.metadata.size !== data.size) throw new BackupError('STORAGE_SIZE_CHANGED');
    object.file = `storage/objects/${createHash('sha256').update(JSON.stringify([object.bucket, object.name])).digest('hex')}.enc`;
    await encrypt(Readable.fromWeb(data.stream()), safeChild(dir, object.file), key);
  }
  const after = await enumerateStorage(client);
  if (JSON.stringify(before.objects.map(({ file, ...rest }) => { void file; return rest; })) !== JSON.stringify(after.objects) || JSON.stringify(before.buckets) !== JSON.stringify(after.buckets)) throw new BackupError('STORAGE_CHANGED_DURING_BACKUP_RETRY_NEW_SNAPSHOT');
  await encrypt(Readable.from([JSON.stringify(before)]), resolve(dir, 'storage/index.json.enc'), key);
  return { state: 'PASS', buckets: before.buckets.length, objects: before.objects.length, consistency: 'stable pre/post listing; DB and Storage not cross-service atomic' };
}
export async function sourceBackup(dir, repo) {
  const git = (...args) => command('git', args, { cwd: repo });
  if ((await git('rev-parse', '--is-shallow-repository')).trim() !== 'false') throw new BackupError('SHALLOW_CLONE_FETCH_HISTORY_FIRST', 'BLOCKED_EXTERNAL');
  await mkdir(resolve(dir, 'source'), { mode: 0o700 });
  const bundle = resolve(dir, 'source/repository.bundle');
  await git('bundle', 'create', bundle, '--all');
  await git('bundle', 'verify', bundle);
  await git('archive', '--format=tar', '--output=' + resolve(dir, 'source/HEAD.tar'), 'HEAD');
  const refs = await git('for-each-ref', '--format=%(objectname) %(refname)');
  await writeFile(resolve(dir, 'source/refs.txt'), refs, { flag: 'wx', mode: 0o600 });
  const dirty = Boolean((await git('status', '--porcelain')).trim());
  return { state: 'PASS', allLocalRefs: true, dirtyWorktreeNotIncluded: dirty, coverage: 'committed HEAD and fetched refs; no untracked files, LFS object contents or external secrets', refs: refs.trim().split('\n').length };
}
export async function runBackup({ repo = process.cwd(), env = process.env, only } = {}) {
  const realRepo = await realpath(repo), root = resolve(env.BACKUP_ROOT || resolve(realRepo, 'backups'));
  if (root !== resolve(realRepo, 'backups') && (!relative(realRepo, root).startsWith('..') && !isAbsolute(relative(realRepo, root)))) throw new BackupError('BACKUP_ROOT_MUST_BE_BACKUPS_OR_OUTSIDE_REPO');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== root) throw new BackupError('BACKUP_ROOT_SYMLINK_NOT_ALLOWED');
  const dir = resolve(root, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0,8));
  await mkdir(dir, { mode: 0o700 }); await mkdir(resolve(dir, 'metadata'), { mode: 0o700 });
  const manifest = { formatVersion: FORMAT, project: 'The Backyard', createdAt: new Date().toISOString(), gitCommit: (await command('git', ['rev-parse','HEAD'], { cwd: repo })).trim(), gitBranch: (await command('git', ['branch','--show-current'], { cwd: repo })).trim(), sourceRef: env.BACKUP_SOURCE === 'qa' ? QA_REF : env.BACKUP_SOURCE === 'local' ? 'local' : null, databaseBackup:false, schemaBackup:false, storageBackup:false, encryption:'AES-256-GCM / BYDR1; key NEVER stored here', components:{}, files:[] };
  for (const [name, fn] of [['source', () => sourceBackup(dir,repo)], ['database', () => backupDatabase(dir,env,only === 'schema')], ['storage', () => backupStorage(dir,env)]]) {
    if (only && name !== (only === 'schema' ? 'database' : only)) { manifest.components[name] = { state:'BLOCKED_EXTERNAL', reason:'NOT_REQUESTED' }; continue; }
    try { manifest.components[name] = await fn(); }
    catch (error) { manifest.components[name] = { state:error instanceof BackupError ? error.state : error.message?.startsWith('ENCRYPTION_KEY') ? 'BLOCKED_EXTERNAL' : 'FAIL', reason:error instanceof BackupError ? error.code : error.message?.startsWith('ENCRYPTION_KEY') ? 'SET_BACKUP_ENCRYPTION_KEY_IN_SECRET_MANAGER' : 'BACKUP_FAILED_NO_SECRET_DIAGNOSTICS' }; }
  }
  manifest.schemaBackup = manifest.components.database.state === 'PASS';
  manifest.databaseBackup = manifest.schemaBackup && only !== 'schema';
  manifest.storageBackup = manifest.components.storage.state === 'PASS';
  for (const name of await listFiles(dir)) manifest.files.push({ path:name, ...await hashFile(safeChild(dir,name)), encrypted:name.endsWith('.enc') });
  await jsonFile(resolve(dir,'metadata/manifest.json'),manifest);
  return { directory:dir, manifest };
}
export async function verifyBackup(dir, env = process.env) {
  const root = await realpath(dir), manifest = JSON.parse(await readFile(resolve(root,'metadata/manifest.json'),'utf8'));
  if (manifest.formatVersion !== FORMAT || manifest.project !== 'The Backyard' || !/^[a-f0-9]{40,64}$/.test(manifest.gitCommit) || !manifest.gitBranch || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || !manifest.components) throw new BackupError('INVALID_MANIFEST');
  const seen = new Set(), files = await listFiles(root), verified = [];
  for (const item of manifest.files) {
    const path = safeChild(root,item.path);
    if (seen.has(item.path) || item.path === 'metadata/manifest.json' || item.encrypted !== item.path.endsWith('.enc')) throw new BackupError('INVALID_MANIFEST_ENTRY'); seen.add(item.path);
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new BackupError('UNSAFE_BACKUP_FILE');
    const actual = await hashFile(path);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw new BackupError('CHECKSUM_MISMATCH');
    if (item.encrypted) {
      const bytes = await verifyEncrypted(path,encryptionKey(env));
      if (item.path.startsWith('database/')) {
        if (!bytes) throw new BackupError('EMPTY_DUMP');
        await verifyDatabaseFile(path,item.path,encryptionKey(env));
      }
    }
    verified.push(item.path);
  }
  if (files.some(f => f !== 'metadata/manifest.json' && !seen.has(f))) throw new BackupError('UNLISTED_FILE');
  for (const [flag, component, required] of [['databaseBackup','database',['database/full.dump.enc','database/data.sql.enc','database/roles.sql.enc']], ['schemaBackup','database',['database/schema.sql.enc']], ['storageBackup','storage',['storage/index.json.enc']]]) {
    if (typeof manifest[flag] !== 'boolean' || (manifest[flag] && (manifest.components[component]?.state !== 'PASS' || required.some(f => !seen.has(f))))) throw new BackupError('FALSE_COMPLETENESS_CLAIM');
  }
  if (manifest.components.source?.state === 'PASS') {
    for (const file of ['source/repository.bundle','source/HEAD.tar','source/refs.txt']) if (!seen.has(file) || !(await lstat(resolve(root,file))).size) throw new BackupError('INCOMPLETE_SOURCE');
    // Empty independent repository proves the bundle has no missing prerequisites.
    // Retain this empty verification directory; never remove user data.
    const verificationRepo=await mkdtemp(join(tmpdir(),'backyard-bundle-verify-'));
    await command('git',['init','--bare',verificationRepo]);
    await command('git',['bundle','verify',resolve(root,'source/repository.bundle')],{cwd:verificationRepo});
    const heads = await command('git',['bundle','list-heads',resolve(root,'source/repository.bundle')]);
    if (!heads.split('\n').some(line => line === `${manifest.gitCommit} refs/heads/${manifest.gitBranch}`)) throw new BackupError('BUNDLE_HEAD_MISMATCH');
  }
  if (manifest.storageBackup) {
    const pieces=[]; await decrypt(resolve(root,'storage/index.json.enc'),new Writable({write(b,_,done){pieces.push(b);done();}}),encryptionKey(env));
    const index=JSON.parse(Buffer.concat(pieces).toString('utf8'));
    if (!Array.isArray(index.buckets)||!Array.isArray(index.objects)||index.objects.length!==manifest.components.storage.objects||index.buckets.length!==manifest.components.storage.buckets) throw new BackupError('STORAGE_INDEX_INCOMPLETE');
    const keys=new Set();
    for(const object of index.objects){const key=JSON.stringify([object.bucket,object.name]);if(keys.has(key)||!index.buckets.some(b=>b.id===object.bucket)||!/^storage\/objects\/[a-f0-9]{64}\.enc$/.test(object.file)||!seen.has(object.file))throw new BackupError('STORAGE_OBJECT_MISSING');keys.add(key);}
  }
  return { integrity:'PASS', recoveryComplete:Boolean(manifest.databaseBackup&&manifest.storageBackup&&manifest.components.source?.state==='PASS'&&!manifest.components.source.dirtyWorktreeNotIncluded), restoreDrill:'PENDING_INTERACTIVE_QA', note:'Payload integrity is not proof of a running restored application or recovered external configuration.', verifiedFiles:verified.length, components:manifest.components, gitCommit:manifest.gitCommit };
}
export async function decryptBackup(dir, output, env = process.env) {
  await verifyBackup(dir,env);
  if (env.BACKUP_DECRYPT_ACK !== 'PRIVATE_LOCAL_DIRECTORY') throw new BackupError('DECRYPT_ACK_REQUIRED');
  const target=resolve(output); await mkdir(target,{mode:0o700}); // must not exist; never overwrite
  const manifest=JSON.parse(await readFile(resolve(dir,'metadata/manifest.json'),'utf8'));
  for(const file of manifest.files.filter(f=>f.encrypted)){
    const name=file.path.slice(0,-4), out=safeChild(target,name);await mkdir(dirname(out),{recursive:true,mode:0o700});
    await decrypt(safeChild(dir,file.path),createWriteStream(out,{flags:'wx',mode:0o600}),encryptionKey(env));
  }
  return {state:'PASS',directory:target,note:'Plaintext sensitive recovery staging; no database or Storage writes performed'};
}
