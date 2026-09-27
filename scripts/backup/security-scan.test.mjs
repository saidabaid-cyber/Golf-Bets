import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isReviewedFixtureFinding, scanTracked, secretKinds } from './security-scan.mjs';

const reviewedFixture = Object.freeze({
  kind: 'DATABASE_PASSWORD_URI',
  file: 'scripts/run-preview-rls-tests.test.mjs',
  objectId: '30e63f55a1d38d4832357f2a2b66ac01aac201b3',
  location: 'history',
});

function runGit(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args[0]} failed`);
}

test('reviewed Preview RLS fixture exception is immutable and history-only', () => {
  assert.equal(isReviewedFixtureFinding(reviewedFixture), true);
  assert.equal(isReviewedFixtureFinding({ ...reviewedFixture, location: 'current' }), false);
  assert.equal(isReviewedFixtureFinding({ ...reviewedFixture, objectId: `${reviewedFixture.objectId.slice(0, -1)}4` }), false);
  assert.equal(isReviewedFixtureFinding({ ...reviewedFixture, file: 'scripts/another.test.mjs' }), false);
  assert.equal(isReviewedFixtureFinding({ ...reviewedFixture, kind: 'GITHUB_TOKEN' }), false);
});

test('a real-shaped database credential equivalent remains detectable', async (t) => {
  const password = ['R3al', 'Credential', 'Value', '9xQ'].join('_');
  const credentialUri = ['postgresql://fixture-user:', password, '@db.example.com/postgres'].join('');
  assert.deepEqual(secretKinds(credentialUri), ['DATABASE_PASSWORD_URI']);

  const repo = await mkdtemp(join(tmpdir(), 'backyard-security-scan-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  runGit(repo, ['init', '--quiet']);
  runGit(repo, ['config', 'user.name', 'Backup Security Test']);
  runGit(repo, ['config', 'user.email', 'backup-security@example.invalid']);
  await mkdir(join(repo, 'scripts'), { recursive: true });
  await writeFile(join(repo, reviewedFixture.file), `export const connection = ${JSON.stringify(credentialUri)};\n`);
  runGit(repo, ['add', '--', reviewedFixture.file]);
  runGit(repo, ['commit', '--quiet', '-m', 'test fixture']);

  const result = await scanTracked(repo, { history: true });
  assert.equal(result.state, 'POTENTIAL_SECRET_EXPOSURE');
  assert.equal(result.reviewedFixtures, 0);
  assert.ok(result.findings.some(finding => finding.kind === 'DATABASE_PASSWORD_URI' && finding.location === 'current'));
  assert.ok(result.findings.some(finding => finding.kind === 'DATABASE_PASSWORD_URI' && finding.location === 'history'));
  assert.ok(result.findings.every(finding => finding.objectId !== reviewedFixture.objectId));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['action', 'file', 'kind', 'location', 'objectId']);
  }
});
