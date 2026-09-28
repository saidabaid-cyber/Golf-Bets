import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isReviewedFixtureFinding, scanTracked, secretKinds } from './security-scan.mjs';

const reviewedFixtureObjectIds = Object.freeze([
  '30e63f55a1d38d4832357f2a2b66ac01aac201b3',
  'a77013672a41fbaae97ccb55d950e0f9bdb5b7aa',
  '85d3e5be045a191476e4ea1fe6c5f7c3c0f7c0b0',
  '3f1a2b51e2e0f51f8de88ab1a597aa5b951ff968',
  'ef02463e05327ff1b81a0d637b997a88f7cd5339',
  '27af27a50eb495bb96a2497a10afec701ffd0d36',
]);

function reviewedFixture(objectId = reviewedFixtureObjectIds[0]) {
  return {
    kind: 'DATABASE_PASSWORD_URI',
    file: 'scripts/run-preview-rls-tests.test.mjs',
    objectId,
    location: 'history',
  };
}

function runGit(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args[0]} failed`);
}

test('reviewed Preview RLS fixture exception is immutable and history-only', () => {
  for (const objectId of reviewedFixtureObjectIds) {
    const finding = reviewedFixture(objectId);
    assert.equal(isReviewedFixtureFinding(finding), true);
    assert.equal(isReviewedFixtureFinding({ ...finding, location: 'current' }), false);
  }

  const finding = reviewedFixture();
  assert.equal(isReviewedFixtureFinding({ ...finding, objectId: `${finding.objectId.slice(0, -1)}4` }), false);
  assert.equal(isReviewedFixtureFinding({ ...finding, file: 'scripts/another.test.mjs' }), false);
  assert.equal(isReviewedFixtureFinding({ ...finding, kind: 'GITHUB_TOKEN' }), false);
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
  const fixture = reviewedFixture();
  await writeFile(join(repo, fixture.file), `export const connection = ${JSON.stringify(credentialUri)};\n`);
  runGit(repo, ['add', '--', fixture.file]);
  runGit(repo, ['commit', '--quiet', '-m', 'test fixture']);

  const result = await scanTracked(repo, { history: true });
  assert.equal(result.state, 'POTENTIAL_SECRET_EXPOSURE');
  assert.equal(result.reviewedFixtures, 0);
  assert.ok(result.findings.some(finding => finding.kind === 'DATABASE_PASSWORD_URI' && finding.location === 'current'));
  assert.ok(result.findings.some(finding => finding.kind === 'DATABASE_PASSWORD_URI' && finding.location === 'history'));
  assert.ok(result.findings.every(finding => !reviewedFixtureObjectIds.includes(finding.objectId)));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['action', 'file', 'kind', 'location', 'objectId']);
  }
});
