import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOMATION_TIME_ZONE,
  OWNER_BACKUP_CONFIG,
  RETENTION_LIMITS,
  assertPublishable,
  createPortablePackage,
  driveTargetsForDate,
  executeAutomatedBackup,
  initialReport,
  mexicoDateParts,
  planRetention,
  portableNames,
  safeErrorCode,
  validateAutomationEnvironment,
  validatePortableChecksum,
  writeGithubOutputs,
} from './automation.mjs';
import { assertDatabaseReadOnly, databaseEnvironment } from './core.mjs';
import { GoogleDriveClient, googleDriveInternals, publishToGoogleDrive, serviceAccountAccessToken } from './google-drive.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = '.github/workflows/automated-offsite-backup.yml';
const automationDocs = [
  'docs/disaster-recovery/AUTOMATED_BACKUPS.md',
  'docs/disaster-recovery/GITHUB_SECRETS_SETUP.md',
  'docs/disaster-recovery/GOOGLE_DRIVE_SERVICE_ACCOUNT_SETUP.md',
  'docs/disaster-recovery/RETENTION_POLICY.md',
  'docs/disaster-recovery/AUTOMATED_BACKUP_RUNBOOK.md',
];
const secretNames = [
  'BACKUP_PGPASSWORD',
  'BACKUP_STORAGE_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'GDRIVE_SERVICE_ACCOUNT_JSON',
];

const readRepo = (path) => readFile(join(repo, path), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function yamlValue(document, name) {
  const match = document.match(new RegExp(`^\\s+${escapeRegExp(name)}:\\s*(.*?)\\s*$`, 'm'));
  assert.ok(match, `missing workflow value ${name}`);
  const value = match[1];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function automationEnvironment(overrides = {}) {
  return {
    ...OWNER_BACKUP_CONFIG,
    BACKUP_PGPASSWORD: 'fixture-database-credential',
    BACKUP_STORAGE_KEY: 'fixture-storage-credential',
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
    GDRIVE_SERVICE_ACCOUNT_JSON: '{"fixture":true}',
    GDRIVE_BACKUP_ROOT_FOLDER_ID: 'fixture_root_folder_123',
    ...overrides,
  };
}

function completeBackup() {
  return {
    directory: join(tmpdir(), 'fixture-snapshot'),
    manifest: {
      gitCommit: 'a'.repeat(40),
      databaseBackup: true,
      schemaBackup: true,
      storageBackup: true,
      encryption: 'AES-256-GCM / BYDR1; key NEVER stored here',
      components: {
        source: { state: 'PASS' },
        database: { state: 'PASS' },
        storage: { state: 'PASS' },
      },
      files: [
        { path: 'source/repository.bundle', encrypted: false },
        { path: 'database/full.dump.enc', encrypted: true },
        { path: 'storage/index.json.enc', encrypted: true },
      ],
    },
  };
}

function completeVerification(backup = completeBackup()) {
  return { integrity: 'PASS', recoveryComplete: true, gitCommit: backup.manifest.gitCommit };
}

test('workflow has only controlled scheduled/manual entry points and minimum permissions', async () => {
  const workflow = await readRepo(workflowPath);
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}schedule:\s*$/m);
  assert.match(workflow, /^\s{4}- cron: ["']0 9 \* \* \*["']\s*$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|pull_request_target|workflow_run|repository_dispatch):/m);
  assert.doesNotMatch(workflow, /pull_request_target/i);

  const permissions = workflow.match(/^permissions:\s*\r?\n((?: {2}[^\r\n]+(?:\r?\n|$))*)/m);
  assert.ok(permissions, 'top-level permissions block is required');
  assert.deepEqual(permissions[1].trim().split(/\r?\n/).map((line) => line.trim()), ['contents: read']);
  assert.doesNotMatch(workflow, /(?:write-all|id-token:\s*write|contents:\s*write)/i);
  assert.match(workflow, /^\s{2}cancel-in-progress:\s*false\s*$/m);
  assert.match(workflow, /^\s{4}if:\s*\$\{\{\s*github\.ref == 'refs\/heads\/main'\s*\}\}\s*$/m);
});

test('workflow supply-chain inputs are immutable or explicitly version pinned', async () => {
  const workflow = await readRepo(workflowPath);
  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 3, 'expected checkout, Node setup and artifact actions');
  for (const action of uses) assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/, action);
  assert.doesNotMatch(workflow, /uses:\s*[^\s#]+@(?:main|master|latest|v\d+)(?:\s|#|$)/i);
  assert.match(workflow, /npm install --global pnpm@10\.17\.1/);
  assert.doesNotMatch(workflow, /pnpm@(?:latest|next|\^|~)/i);
  assert.match(workflow, /test "\$\{fingerprint\}" = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"/);
  assert.match(workflow, /^\s{4}runs-on:\s*ubuntu-24\.04\s*$/m);
  assert.equal(yamlValue(workflow, 'node-version'), '24');
  assert.match(workflow, /pnpm install --frozen-lockfile/);
});

test('workflow installs and verifies the complete PostgreSQL 17 client set', async () => {
  const workflow = await readRepo(workflowPath);
  assert.match(workflow, /postgresql-client-17/);
  assert.ok(workflow.includes('postgresql_bin="/usr/lib/postgresql/17/bin"'));
  assert.ok(workflow.includes(`printf '%s\\n' "\${postgresql_bin}" >> "\${GITHUB_PATH}"`));
  assert.ok(workflow.includes(`export PATH="\${postgresql_bin}:\${PATH}"`));
  assert.ok(workflow.includes('for executable in psql pg_dump pg_restore pg_dumpall; do'));
  assert.ok(workflow.includes('resolved="$(command -v "${executable}")"'));
  assert.ok(workflow.includes('test "${resolved}" = "${postgresql_bin}/${executable}"'));
  assert.ok(workflow.includes('version="$("${resolved}" --version)"'));
  assert.ok(workflow.includes(`grep -Eq ' 17\\.' <<< "\${version}"`));
  assert.doesNotMatch(workflow, /\/usr\/bin\/(?:psql|pg_dump|pg_restore|pg_dumpall)/);
});

test('workflow pins the authorized owner and keeps retention disabled by default', async () => {
  const workflow = await readRepo(workflowPath);
  for (const [name, expected] of Object.entries(OWNER_BACKUP_CONFIG)) assert.equal(yamlValue(workflow, name), expected, name);
  for (const name of secretNames) assert.equal(yamlValue(workflow, name), `\${{ secrets.${name} }}`, name);
  assert.equal(yamlValue(workflow, 'GDRIVE_BACKUP_ROOT_FOLDER_ID'), '${{ vars.GDRIVE_BACKUP_ROOT_FOLDER_ID }}');
  assert.equal(yamlValue(workflow, 'BACKUP_RETENTION_APPLY'), "${{ vars.BACKUP_RETENTION_APPLY || 'false' }}");
  assert.equal(yamlValue(workflow, 'BACKUP_PGSSLROOTCERT'), 'system');
  assert.equal(yamlValue(workflow, 'BACKUP_ROOT'), '${{ runner.temp }}/the-backyard-snapshots');
  assert.doesNotMatch(workflow, /secrets\.GDRIVE_BACKUP_ROOT_FOLDER_ID/);
  assert.doesNotMatch(workflow, /^\s+BACKUP_RETENTION_APPLY:\s*(?:true|['"]true['"])\s*$/m);
});

test('recovery artifact is success-gated and contains only package plus checksum', async () => {
  const workflow = await readRepo(workflowPath);
  const upload = workflow.indexOf('uses: actions/upload-artifact@');
  assert.notEqual(upload, -1);
  const marker = workflow.lastIndexOf('- name:', upload);
  assert.notEqual(marker, -1);
  const step = workflow.slice(marker);
  assert.match(step, /^\s*if:\s*\$\{\{\s*success\(\)\s*\}\}\s*$/m);
  assert.match(step, /actions\/upload-artifact@[a-f0-9]{40}/);
  const outputPaths = [...step.matchAll(/^\s*\$\{\{\s*steps\.automated_backup\.outputs\.([a-z_]+)\s*\}\}\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(outputPaths, ['package_path', 'checksum_path']);
  assert.match(step, /^\s*if-no-files-found:\s*error\s*$/m);
  assert.match(step, /^\s*retention-days:\s*7\s*$/m);
  assert.match(step, /^\s*overwrite:\s*false\s*$/m);
  assert.doesNotMatch(step, /(?:BACKUP_(?:PGPASSWORD|STORAGE_KEY|ENCRYPTION_KEY|ROOT)|GDRIVE_SERVICE_ACCOUNT_JSON|\.env|snapshot)/);
});

test('Vercel blocks backup branches and ignores reviewed backup-only merge commits without changing normal app deploys', async () => {
  const configuration = JSON.parse(await readRepo('vercel.json'));
  assert.equal(configuration.git?.deploymentEnabled?.['infra/backup-automation'], false);
  assert.equal(configuration.git?.deploymentEnabled?.['hotfix/cloud-backup-*'], false);
  assert.ok(Object.values(configuration.git.deploymentEnabled).every((enabled) => enabled === false));
  assert.equal(configuration.ignoreCommand, 'node scripts/backup/skip-vercel-deploy.mjs');

  const script = join(repo, 'scripts/backup/skip-vercel-deploy.mjs');
  for (const [ref, message, status] of [
    ['main', 'fix: ordinary application change', 1],
    ['feature/application-change', 'fix: application [backup-only:no-deploy]', 1],
    ['main', 'fix: cloud backup [backup-only:no-deploy]', 0],
  ]) {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_COMMIT_MESSAGE: message },
      encoding: 'utf8',
    });
    assert.equal(result.status, status, `${ref}: ${message}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('automation constants and owner environment are exact and fail closed', () => {
  assert.equal(AUTOMATION_TIME_ZONE, 'America/Mexico_City');
  assert.deepEqual(OWNER_BACKUP_CONFIG, {
    BACKUP_SOURCE: 'owner',
    BACKUP_EXPECTED_REF: 'zhqmlpljloumldaczcfp',
    BACKUP_PGHOST: 'aws-0-us-east-1.pooler.supabase.com',
    BACKUP_PGPORT: '5432',
    BACKUP_PGUSER: 'postgres.zhqmlpljloumldaczcfp',
    BACKUP_PGDATABASE: 'postgres',
    BACKUP_STORAGE_URL: 'https://zhqmlpljloumldaczcfp.supabase.co',
  });
  assert.ok(Object.isFrozen(OWNER_BACKUP_CONFIG));
  assert.equal(googleDriveInternals.ROOT_FOLDER_NAME, 'The Backyard - Backups');
  assert.equal(googleDriveInternals.DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive');
  assert.equal(googleDriveInternals.TOKEN_ENDPOINT, 'https://oauth2.googleapis.com/token');

  assert.deepEqual(validateAutomationEnvironment(automationEnvironment()), { retentionApply: false });
  assert.deepEqual(validateAutomationEnvironment(automationEnvironment({ BACKUP_RETENTION_APPLY: 'false' })), { retentionApply: false });
  assert.deepEqual(validateAutomationEnvironment(automationEnvironment({ BACKUP_RETENTION_APPLY: 'true' })), { retentionApply: true });
  for (const invalid of ['', 'TRUE', '1', 'yes']) {
    if (invalid === '') continue;
    assert.throws(() => validateAutomationEnvironment(automationEnvironment({ BACKUP_RETENTION_APPLY: invalid })), /INVALID_BACKUP_RETENTION_APPLY/);
  }
  for (const [name, expected] of Object.entries(OWNER_BACKUP_CONFIG)) {
    assert.throws(() => validateAutomationEnvironment(automationEnvironment({ [name]: `${expected}-changed` })), /OWNER_BACKUP_CONFIG_NOT_AUTHORIZED/, name);
  }
  for (const name of [...secretNames, 'GDRIVE_BACKUP_ROOT_FOLDER_ID']) {
    assert.throws(() => validateAutomationEnvironment(automationEnvironment({ [name]: '' })), new RegExp(`MISSING_${name}`), name);
  }
  assert.equal(initialReport(new Date('2026-09-21T12:00:00Z')).retention, 'DRY_RUN');
});

test('PostgreSQL preflight is one explicit read-only transaction and only exact on passes', async () => {
  const pg = databaseEnvironment(automationEnvironment({
    PGOPTIONS: '-c default_transaction_read_only=off',
    pgoptions: '-c transaction_read_only=off',
  }));
  assert.ok(!Object.keys(pg).some((name) => /^PGOPTIONS$/i.test(name)));
  const calls = [];
  await assertDatabaseReadOnly(pg, async (executable, args, options) => {
    calls.push({ executable, args, options });
    return 'on\n';
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'psql');
  assert.deepEqual(calls[0].args, [
    '-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
    '--command=BEGIN TRANSACTION READ ONLY; SHOW transaction_read_only; ROLLBACK;',
  ]);
  assert.equal(calls[0].options.env, pg);
  assert.equal(typeof calls[0].options.classifyStderr, 'function');
  assert.doesNotMatch(String(assertDatabaseReadOnly), /default_transaction_read_only/);
  await assertDatabaseReadOnly(pg, async () => 'on\r\n');

  for (const output of ['off\n', 'ON\n', '', 'on\non\n', 'BEGIN\non\nROLLBACK\n', 'on \n', undefined, null]) {
    await assert.rejects(assertDatabaseReadOnly(pg, async () => output), /READ_ONLY_NOT_CONFIRMED/);
  }
  await assert.rejects(
    assertDatabaseReadOnly(pg, async () => { throw new Error('provider diagnostic with a credential'); }),
    (error) => error.code === 'READ_ONLY_CHECK_FAILED' && !error.message.includes('diagnostic'),
  );
});

test('Mexico City calendar produces deterministic daily, weekly and monthly targets', () => {
  const ordinary = new Date('2026-09-21T12:34:56Z');
  assert.deepEqual(mexicoDateParts(ordinary), {
    date: '2026-09-21', month: '2026-09', time: '063456', isSunday: false, isMonthStart: false,
  });
  assert.deepEqual(portableNames(ordinary), {
    date: '2026-09-21', month: '2026-09', time: '063456', isSunday: false, isMonthStart: false,
    packageName: 'The-Backyard-Backup-2026-09-21-063456.tar.gz',
    checksumName: 'The-Backyard-Backup-2026-09-21-063456.tar.gz.sha256',
  });
  assert.deepEqual(driveTargetsForDate(ordinary), [{ tier: 'daily', bucket: '2026-09-21' }]);
  assert.deepEqual(driveTargetsForDate(new Date('2026-09-20T12:00:00Z')), [
    { tier: 'daily', bucket: '2026-09-20' },
    { tier: 'weekly', bucket: '2026-09-20' },
  ]);
  assert.deepEqual(driveTargetsForDate(new Date('2026-10-01T12:00:00Z')), [
    { tier: 'daily', bucket: '2026-10-01' },
    { tier: 'monthly', bucket: '2026-10' },
  ]);
  assert.deepEqual(driveTargetsForDate(new Date('2026-02-01T12:00:00Z')), [
    { tier: 'daily', bucket: '2026-02-01' },
    { tier: 'weekly', bucket: '2026-02-01' },
    { tier: 'monthly', bucket: '2026-02' },
  ]);
});

test('portable checksum requires the exact lowercase SHA-256 sidecar and basename', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backyard-automation-checksum-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = portableNames(new Date('2026-09-21T12:34:56Z'));
  const packagePath = join(directory, names.packageName);
  const checksumPath = join(directory, names.checksumName);
  const bytes = Buffer.from('synthetic portable package bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(packagePath, bytes);
  await writeFile(checksumPath, `${sha256}  ${names.packageName}\n`);
  assert.deepEqual(await validatePortableChecksum(packagePath, checksumPath), { bytes: bytes.length, sha256 });

  for (const sidecar of [
    `${'0'.repeat(64)}  ${names.packageName}\n`,
    `${sha256}  different.tar.gz\n`,
    `${sha256.toUpperCase()}  ${names.packageName}\n`,
    `${sha256} ${names.packageName}\n`,
    `${sha256}  ${names.packageName}\nextra\n`,
  ]) {
    await writeFile(checksumPath, sidecar);
    await assert.rejects(validatePortableChecksum(packagePath, checksumPath), /PORTABLE_CHECKSUM_(?:INVALID|MISMATCH)/);
  }
});

test('portable package generation creates a tar.gz and validates its SHA-256 sidecar', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backyard-portable-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = join(directory, 'snapshot-fixture'), output = join(directory, 'portable');
  await mkdir(join(snapshot, 'metadata'), { recursive: true });
  await writeFile(join(snapshot, 'metadata', 'manifest.json'), '{"fixture":true}\n');
  await writeFile(join(snapshot, 'encrypted-payload.enc'), Buffer.from('synthetic encrypted fixture'));
  const result = await createPortablePackage(snapshot, output, new Date('2026-09-21T12:34:56Z'));
  assert.equal(result.packageName, 'The-Backyard-Backup-2026-09-21-063456.tar.gz');
  assert.ok(result.bytes > 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await validatePortableChecksum(result.packagePath, result.checksumPath), {
    bytes: result.bytes, sha256: result.sha256,
  });
  await assert.rejects(createPortablePackage(snapshot, snapshot, new Date('2026-09-21T12:34:57Z')), /PORTABLE_PACKAGE_INSIDE_SNAPSHOT/);
});

test('GitHub outputs expose only the two portable artifact paths and reject line injection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backyard-github-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'github-output.txt');
  const packageInfo = {
    packagePath: join(directory, 'The-Backyard-Backup-2026-09-21-060000.tar.gz'),
    checksumPath: join(directory, 'The-Backyard-Backup-2026-09-21-060000.tar.gz.sha256'),
  };
  await writeGithubOutputs(packageInfo, output);
  assert.equal(await readFile(output, 'utf8'), `package_path=${packageInfo.packagePath}\nchecksum_path=${packageInfo.checksumPath}\n`);
  for (const field of ['packagePath', 'checksumPath']) {
    await assert.rejects(writeGithubOutputs({ ...packageInfo, [field]: `${packageInfo[field]}\nsecret_path=x` }, output), /UNSAFE_GITHUB_OUTPUT/);
  }
});

test('publication gate requires complete PASS states, encryption and independent verification', () => {
  const backup = completeBackup();
  assert.deepEqual(assertPublishable(backup, completeVerification(backup)), {
    source: 'PASS', database: 'PASS', storage: 'PASS', encryption: 'PASS', verification: 'PASS', recoveryComplete: true,
  });

  const categorized = completeBackup();
  categorized.manifest.components.database = { state: 'FAIL', reason: 'POSTGRES_SSL' };
  assert.throws(
    () => assertPublishable(categorized, completeVerification(categorized)),
    (error) => error.code === 'POSTGRES_SSL' && error.message === 'POSTGRES_SSL',
  );
  const unsafe = completeBackup();
  unsafe.manifest.components.database = { state: 'FAIL', reason: 'provider diagnostic with private details' };
  assert.throws(
    () => assertPublishable(unsafe, completeVerification(unsafe)),
    (error) => error.code === 'DATABASE_NOT_PASS' && !error.message.includes('private'),
  );

  const cases = [
    ['SOURCE_NOT_PASS', (b) => { b.manifest.components.source.state = 'FAIL'; }, () => {}],
    ['DATABASE_NOT_PASS', (b) => { b.manifest.components.database.state = 'FAIL'; }, () => {}],
    ['STORAGE_NOT_PASS', (b) => { b.manifest.components.storage.state = 'FAIL'; }, () => {}],
    ['BACKUP_INCOMPLETE', (b) => { b.manifest.databaseBackup = false; }, () => {}],
    ['BACKUP_INCOMPLETE', (b) => { b.manifest.schemaBackup = false; }, () => {}],
    ['BACKUP_INCOMPLETE', (b) => { b.manifest.storageBackup = false; }, () => {}],
    ['ENCRYPTION_NOT_CONFIRMED', (b) => { b.manifest.encryption = 'unknown'; }, () => {}],
    ['ENCRYPTION_NOT_CONFIRMED', (b) => { b.manifest.files[1].encrypted = false; }, () => {}],
    ['VERIFICATION_NOT_PASS', () => {}, (v) => { v.integrity = 'FAIL'; }],
    ['RECOVERY_NOT_COMPLETE', () => {}, (v) => { v.recoveryComplete = false; }],
    ['VERIFICATION_GIT_MISMATCH', () => {}, (v) => { v.gitCommit = 'b'.repeat(40); }],
  ];
  for (const [code, alterBackup, alterVerification] of cases) {
    const candidate = completeBackup(), verification = completeVerification(candidate);
    alterBackup(candidate); alterVerification(verification);
    assert.throws(() => assertPublishable(candidate, verification), (error) => error.code === code, code);
  }
});

test('orchestrator scans, backs up and verifies before package or Drive publication', async () => {
  const calls = [], backup = completeBackup(), verification = completeVerification(backup);
  const packageInfo = {
    packageName: 'The-Backyard-Backup-2026-09-21-060000.tar.gz', checksumName: 'The-Backyard-Backup-2026-09-21-060000.tar.gz.sha256',
    packagePath: join(tmpdir(), 'fixture.tar.gz'), checksumPath: join(tmpdir(), 'fixture.tar.gz.sha256'), bytes: 123, sha256: 'c'.repeat(64),
  };
  const result = await executeAutomatedBackup({
    repo: join(tmpdir(), 'fixture-repository'), env: automationEnvironment({ RUNNER_TEMP: tmpdir() }), now: new Date('2026-09-21T12:00:00Z'),
    dependencies: {
      scanTracked: async () => { calls.push('security'); return { state: 'PASS' }; },
      runBackup: async () => { calls.push('backup'); return backup; },
      verifyBackup: async () => { calls.push('verify'); return verification; },
      createPortablePackage: async () => { calls.push('package'); return packageInfo; },
      publishToGoogleDrive: async () => {
        calls.push('drive');
        return { daily: 'PASS', weekly: 'NOT_DUE', monthly: 'NOT_DUE', retentionCandidates: [] };
      },
      writeGithubOutputs: async () => { calls.push('outputs'); },
    },
  });
  assert.deepEqual(calls, ['security', 'backup', 'verify', 'package', 'drive', 'outputs']);
  assert.equal(result.report.recoveryComplete, true);
  assert.equal(result.report.sha256, packageInfo.sha256);

  for (const failure of ['source', 'database', 'storage', 'integrity', 'recovery']) {
    const blockedBackup = completeBackup(), blockedVerification = completeVerification(blockedBackup);
    if (failure === 'integrity') blockedVerification.integrity = 'FAIL';
    else if (failure === 'recovery') blockedVerification.recoveryComplete = false;
    else blockedBackup.manifest.components[failure].state = 'FAIL';
    let packaged = false, published = false;
    await assert.rejects(executeAutomatedBackup({
      repo: join(tmpdir(), 'fixture-repository'), env: automationEnvironment({ RUNNER_TEMP: tmpdir() }),
      dependencies: {
        scanTracked: async () => ({ state: 'PASS' }),
        runBackup: async () => blockedBackup,
        verifyBackup: async () => blockedVerification,
        createPortablePackage: async () => { packaged = true; },
        publishToGoogleDrive: async () => { published = true; },
      },
    }));
    assert.equal(packaged, false, `${failure} must block packaging`);
    assert.equal(published, false, `${failure} must block Drive publication`);
  }
});

function retentionPair(name, createdAt, overrides = {}) {
  return {
    name,
    checksumName: `${name}.sha256`,
    packageId: `${name}-package`,
    checksumId: `${name}-checksum`,
    createdAt,
    verified: true,
    ...overrides,
  };
}

test('retention limits are exact and only older verified complete pairs become candidates', () => {
  assert.deepEqual(RETENTION_LIMITS, { daily: 7, weekly: 4, monthly: 6 });
  assert.ok(Object.isFrozen(RETENTION_LIMITS));
  const entries = Array.from({ length: 8 }, (_, index) => retentionPair(
    `backup-${index}`,
    new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
  ));
  const shuffled = [entries[2], entries[7], entries[0], entries[5], entries[1], entries[6], entries[4], entries[3]];
  const plan = planRetention(shuffled, RETENTION_LIMITS.daily);
  assert.equal(plan.keep, 7);
  assert.equal(plan.valid, 8);
  assert.deepEqual(plan.candidates.map((entry) => entry.name), ['backup-0']);
  assert.ok(!plan.candidates.some((entry) => entry.name === 'backup-7'), 'newest backup is never a candidate');

  assert.deepEqual(planRetention([entries[7]], 1).candidates, [], 'the only verified recovery is never removed');
  assert.deepEqual(planRetention([
    retentionPair('same-a', '2026-09-21T00:00:00Z'),
    retentionPair('same-b', '2026-09-21T00:00:00Z'),
  ], 1).candidates, [], 'ties are preserved when no strictly newer recovery exists');

  const invalid = [
    retentionPair('unverified', '2026-01-01T00:00:00Z', { verified: false }),
    retentionPair('orphan-package', '2026-01-02T00:00:00Z', { checksumId: '' }),
    retentionPair('orphan-checksum', '2026-01-03T00:00:00Z', { packageId: '' }),
    retentionPair('wrong-sidecar', '2026-01-04T00:00:00Z', { checksumName: 'other.sha256' }),
    retentionPair('bad-date', 'not-a-date'),
  ];
  const safe = planRetention([entries[7], ...invalid], 1);
  assert.equal(safe.valid, 1);
  assert.deepEqual(safe.candidates, []);
  assert.throws(() => planRetention(entries, 0), /INVALID_RETENTION_LIMIT/);
});

async function packageFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'backyard-drive-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = portableNames(new Date('2026-09-21T12:00:00Z'));
  const packagePath = join(directory, names.packageName), checksumPath = join(directory, names.checksumName);
  const body = Buffer.from('verified package fixture');
  const sha256 = createHash('sha256').update(body).digest('hex');
  await writeFile(packagePath, body);
  await writeFile(checksumPath, `${sha256}  ${names.packageName}\n`);
  return { ...names, packagePath, checksumPath, bytes: body.length, sha256 };
}

class MemoryDrive {
  constructor(packageInfo, { corruptRemoteHash = false, corruptSidecar = false } = {}) {
    this.packageInfo = packageInfo;
    this.corruptRemoteHash = corruptRemoteHash;
    this.corruptSidecar = corruptSidecar;
    this.files = new Map();
    this.children = new Map();
    this.counter = 0;
    this.hashDownloads = [];
    this.trashed = [];
  }

  add(file) {
    this.files.set(file.id, file);
    for (const parent of file.parents || []) {
      if (!this.children.has(parent)) this.children.set(parent, []);
      this.children.get(parent).push(file);
    }
    return file;
  }

  async getFile(id) {
    if (id === 'fixture_root_folder_123') return { id, name: googleDriveInternals.ROOT_FOLDER_NAME, mimeType: googleDriveInternals.FOLDER_MIME, trashed: false };
    return this.files.get(id);
  }

  async ensureFolder(parentId, name) {
    const existing = (this.children.get(parentId) || []).find((file) => file.name === name);
    if (existing) return existing;
    return this.add({ id: `folder-${++this.counter}`, name, mimeType: googleDriveInternals.FOLDER_MIME, parents: [parentId], trashed: false });
  }

  async uploadFile(parentId, path, name, mimeType, appProperties) {
    const info = await stat(path);
    return this.add({ id: `upload-${++this.counter}`, name, mimeType, size: String(info.size), parents: [parentId], appProperties, trashed: false });
  }

  async copyFile(id, parentId, name, appProperties) {
    const source = this.files.get(id);
    return this.add({ ...source, id: `copy-${++this.counter}`, name, parents: [parentId], appProperties, trashed: false });
  }

  async downloadText() {
    const sha256 = this.corruptSidecar ? '0'.repeat(64) : this.packageInfo.sha256;
    return `${sha256}  ${this.packageInfo.packageName}\n`;
  }

  async downloadHash(id) {
    this.hashDownloads.push(id);
    return {
      bytes: this.packageInfo.bytes,
      sha256: this.corruptRemoteHash ? '0'.repeat(64) : this.packageInfo.sha256,
    };
  }

  async updateProperties(id, appProperties) {
    const file = this.files.get(id);
    file.appProperties = appProperties;
    return file;
  }

  async listChildren(parentId) {
    return [...(this.children.get(parentId) || [])];
  }

  async trashFile(id) {
    this.trashed.push(id);
    this.files.get(id).trashed = true;
  }
}

test('daily Drive publication re-downloads and hashes the package, verifies its sidecar, and never trashes in dry-run', async (t) => {
  const packageInfo = await packageFixture(t), client = new MemoryDrive(packageInfo);
  const result = await publishToGoogleDrive({
    credentialsJson: '{}', rootFolderId: 'fixture_root_folder_123', packageInfo,
    now: new Date('2026-09-21T12:00:00Z'), retentionApply: false, client,
  });
  assert.deepEqual(result, { daily: 'PASS', weekly: 'NOT_DUE', monthly: 'NOT_DUE', retention: 'DRY_RUN', retentionCandidates: [] });
  assert.equal(client.hashDownloads.length, 1, 'daily publication requires an independent remote package hash');
  assert.deepEqual(client.trashed, []);
});

test('a locally changed package is rejected before any Drive publication', async (t) => {
  const packageInfo = await packageFixture(t), client = new MemoryDrive(packageInfo);
  await writeFile(packageInfo.packagePath, Buffer.alloc(packageInfo.bytes, 0));
  await assert.rejects(publishToGoogleDrive({
    credentialsJson: '{}', rootFolderId: 'fixture_root_folder_123', packageInfo,
    now: new Date('2026-09-21T12:00:00Z'), retentionApply: false, client,
  }), /GDRIVE_PACKAGE_INFO_INVALID/);
  assert.equal(client.files.size, 0);
});

test('daily sidecar mismatch and daily full-package checksum mismatch block Drive PASS', async (t) => {
  const dailyPackage = await packageFixture(t), dailyClient = new MemoryDrive(dailyPackage, { corruptSidecar: true });
  await assert.rejects(publishToGoogleDrive({
    credentialsJson: '{}', rootFolderId: 'fixture_root_folder_123', packageInfo: dailyPackage,
    now: new Date('2026-09-21T12:00:00Z'), retentionApply: false, client: dailyClient,
  }), /GDRIVE_REMOTE_CHECKSUM_SIDECAR_MISMATCH/);

  const packageInfo = await packageFixture(t), client = new MemoryDrive(packageInfo, { corruptRemoteHash: true });
  await assert.rejects(publishToGoogleDrive({
    credentialsJson: '{}', rootFolderId: 'fixture_root_folder_123', packageInfo,
    now: new Date('2026-09-20T12:00:00Z'), retentionApply: false, client,
  }), /GDRIVE_REMOTE_PACKAGE_CHECKSUM_MISMATCH/);
  assert.equal(client.hashDownloads.length, 1);
});

test('Drive resumable upload recovers from a transient chunk failure without changing the byte ranges', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backyard-drive-resumable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const name = 'The-Backyard-Backup-2026-09-21-060000.tar.gz';
  const path = join(directory, name), bytes = Buffer.alloc((2 * 256 * 1024) + 19, 42);
  await writeFile(path, bytes);
  const ranges = []; let firstChunkAttempts = 0, statusQueries = 0;
  const transport = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers || {});
    assert.equal(headers.get('authorization'), 'Bearer fixture-access-token');
    if (url.pathname === '/drive/v3/files' && init.method === 'GET') {
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
      return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture' } });
    }
    assert.equal(url.pathname, '/upload/drive/v3/files');
    assert.equal(init.method, 'PUT');
    const range = headers.get('content-range');
    if (range === `bytes */${bytes.length}`) {
      statusQueries += 1;
      return new Response(null, { status: 308 });
    }
    let uploadedBytes = 0;
    for await (const chunk of init.body) uploadedBytes += chunk.length;
    ranges.push({ range, uploadedBytes });
    if (range === `bytes 0-${(256 * 1024) - 1}/${bytes.length}` && firstChunkAttempts++ === 0) {
      return new Response(null, { status: 503 });
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    assert.ok(match);
    assert.equal(uploadedBytes, Number(match[2]) - Number(match[1]) + 1);
    if (Number(match[2]) + 1 < bytes.length) {
      return new Response(null, { status: 308, headers: { range: `bytes=0-${match[2]}` } });
    }
    return new Response(JSON.stringify({ id: 'uploaded_123', name, size: String(bytes.length), trashed: false }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const client = new GoogleDriveClient('fixture-access-token', transport, {
    uploadChunkBytes: 256 * 1024, uploadMaxRetries: 2, uploadTimeoutMs: 120000, wait: async () => {},
  });
  const uploaded = await client.uploadFile('parent_12345', path, name, 'application/gzip', { app: 'the-backyard-backup' });
  assert.equal(uploaded.id, 'uploaded_123');
  assert.equal(statusQueries, 1);
  assert.equal(ranges.length, 4);
  assert.equal(ranges[0].range, ranges[1].range, 'the failed first range is retried from the server-confirmed offset');
  assert.deepEqual(ranges.slice(1).map(({ range }) => range), [
    `bytes 0-${(256 * 1024) - 1}/${bytes.length}`,
    `bytes ${256 * 1024}-${(512 * 1024) - 1}/${bytes.length}`,
    `bytes ${512 * 1024}-${bytes.length - 1}/${bytes.length}`,
  ]);
});

test('Drive authentication is in-memory, origin restricted and caller headers cannot replace it', async () => {
  const credentials = JSON.stringify({
    type: 'service_account', client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
    private_key: 'synthetic-signing-key', token_uri: googleDriveInternals.TOKEN_ENDPOINT,
  });
  let signedClaims;
  const token = await serviceAccountAccessToken(credentials, {
    now: () => 1_800_000_000_000,
    signer: (unsigned, key) => { signedClaims = { unsigned, key }; return Buffer.from('fixture-signature'); },
    transport: async (url, init) => {
      assert.equal(url, googleDriveInternals.TOKEN_ENDPOINT);
      assert.equal(init.method, 'POST');
      assert.doesNotMatch(String(init.body), /synthetic-signing-key/);
      return new Response(JSON.stringify({ access_token: 'fixture-access-token' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(token, 'fixture-access-token');
  assert.equal(signedClaims.key, 'synthetic-signing-key');
  const claims = JSON.parse(Buffer.from(signedClaims.unsigned.split('.')[1], 'base64url'));
  assert.deepEqual({ iss: claims.iss, scope: claims.scope, aud: claims.aud, exp: claims.exp - claims.iat }, {
    iss: 'fixture@fixture-project.iam.gserviceaccount.com', scope: googleDriveInternals.DRIVE_SCOPE,
    aud: googleDriveInternals.TOKEN_ENDPOINT, exp: 3600,
  });

  const client = new GoogleDriveClient(token, async (_url, init) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-access-token');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await client.fetch('https://www.googleapis.com/drive/v3/files', { headers: { authorization: 'Bearer caller-value' } });
  await assert.rejects(client.fetch('https://example.invalid/drive/v3/files'), /GDRIVE_CROSS_ORIGIN_BLOCKED/);
});

test('failure reporting and executable logs expose only bounded status codes', async () => {
  assert.equal(safeErrorCode(new Error('credential-like provider diagnostic\nsecond line')), 'AUTOMATED_BACKUP_FAILED');
  assert.equal(safeErrorCode({ code: 'SAFE_FAILURE_CODE' }), 'SAFE_FAILURE_CODE');
  assert.equal(safeErrorCode({ code: 'UNSAFE:credential-like-value' }), 'AUTOMATED_BACKUP_FAILED');
  const entrypoint = await readRepo('scripts/backup/automated-backup.mjs');
  assert.match(entrypoint, /AUTOMATED_BACKUP_PASS/);
  assert.match(entrypoint, /AUTOMATED_BACKUP_FAIL:\$\{safeErrorCode\(error\)\}/);
  assert.doesNotMatch(entrypoint, /console\.(?:log|error)\([^\n]*(?:process\.env|JSON\.stringify|error\.(?:message|stack)|GDRIVE_SERVICE_ACCOUNT_JSON|BACKUP_PGPASSWORD)/);
  for (const path of ['scripts/backup/automation.mjs', 'scripts/backup/google-drive.mjs', 'scripts/backup/retention.mjs']) {
    assert.doesNotMatch(await readRepo(path), /console\.(?:log|error|warn|debug)\s*\(/, path);
  }
});

test('automation implementation and documentation contain no credential-shaped literals', async () => {
  const paths = [
    workflowPath,
    'scripts/backup/automation.mjs',
    'scripts/backup/automated-backup.mjs',
    'scripts/backup/google-drive.mjs',
    'scripts/backup/retention.mjs',
    ...automationDocs,
  ];
  const credentialShapes = [
    /\bsb_secret_[A-Za-z0-9_-]{8,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /-----BEGIN (?:RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}-----END (?:RSA )?PRIVATE KEY-----/,
  ];
  for (const path of paths) {
    const contents = await readRepo(path);
    for (const shape of credentialShapes) assert.doesNotMatch(contents, shape, path);
  }
});

test('secret-bearing variables stay empty or secret-backed and automation docs contain no credential values', async () => {
  const workflow = await readRepo(workflowPath), example = await readRepo('.env.example');
  for (const name of secretNames) {
    assert.equal(yamlValue(workflow, name), `\${{ secrets.${name} }}`, name);
    assert.match(example, new RegExp(`^${name}=\\s*$`, 'm'));
  }
  assert.match(example, /^GDRIVE_BACKUP_ROOT_FOLDER_ID=\s*$/m);
  assert.match(example, /^BACKUP_RETENTION_APPLY=false\s*$/m);

  const documents = await Promise.all(automationDocs.map(async (path) => ({ path, text: await readRepo(path) })));
  for (const { path, text } of documents) {
    assert.match(text, /NOT_ACTIVE_PENDING_OWNER_SETUP/, path);
    for (const name of secretNames) {
      const assignedValue = new RegExp(`${name}\\s*=\\s*(?:["'][^"']+["']|[^\\s\x60|]+)`);
      assert.doesNotMatch(text, assignedValue, `${path} must name ${name} without assigning a value`);
    }
    assert.doesNotMatch(text, /\bsb_secret_[A-Za-z0-9_-]{8,}\b/);
    assert.doesNotMatch(text, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/);
    assert.doesNotMatch(text, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/);
    assert.doesNotMatch(text, /-----BEGIN (?:RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}-----END (?:RSA )?PRIVATE KEY-----/);
  }

  const contract = documents.map(({ text }) => text).join('\n');
  for (const token of [
    '0 9 * * *', 'workflow_dispatch', ...secretNames, 'GDRIVE_BACKUP_ROOT_FOLDER_ID',
    'BACKUP_RETENTION_APPLY=false', 'Source', 'Database', 'Storage', 'Encryption', 'Verification', 'recoveryComplete',
  ]) assert.ok(contract.includes(token), `automation docs must contain ${token}`);
  assert.match(contract, /(?:daily[^\n]{0,80}\b7\b|\b7\b[^\n]{0,80}daily)/i);
  assert.match(contract, /(?:weekly[^\n]{0,80}\b4\b|\b4\b[^\n]{0,80}weekly)/i);
  assert.match(contract, /(?:monthly[^\n]{0,80}\b6\b|\b6\b[^\n]{0,80}monthly)/i);
  assert.match(contract, /domain-wide delegation/i);
  assert.match(contract, /(?:scope amplio de Google Drive|Google Drive API scope)/i);
});
