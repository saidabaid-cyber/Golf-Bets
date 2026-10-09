import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gpsMeasurements, validCoordinate } from '../lib/golf-gps/model.mjs';

// Offline evidence against private saved responses. No fetch, API key or writes
// to the cache. Run after `tsc -p tsconfig.test.json`; output remains private.
const [storePath, outputPath] = process.argv.slice(2);
if (!storePath || !outputPath || !path.isAbsolute(storePath) || !path.isAbsolute(outputPath)) throw Error('Usage: node scripts/golf-gps-saved-data-check.mjs ABSOLUTE_PRIVATE_STORE ABSOLUTE_REPORT');
globalThis.fetch = () => { throw Error('NO_UPSTREAM_REQUEST_AUTHORIZED'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
const { GPS_SAVED_COURSES, gpsCourseProjection } = require('../.test-dist/lib/golf-gps/projection.js');
const ledgerBefore = await readFile(path.join(storePath, 'ledger.json'));
const ledger = JSON.parse(ledgerBefore); assert.equal(ledger.attempts.length, 10);
for (const attempt of ledger.attempts) {
  const envelope = JSON.parse(await readFile(path.join(storePath, attempt.responseFile), 'utf8'));
  assert.equal(hash(envelope.bodyText), envelope.bodySha256); assert.equal(envelope.httpStatus, 200);
}
const courses = [];
for (const identity of GPS_SAVED_COURSES) {
  const bytes = await readFile(path.join(storePath, `normalized-${identity.externalId}.json`));
  const snapshot = JSON.parse(bytes), dto = gpsCourseProjection(snapshot);
  const original = JSON.stringify(snapshot);
  for (const hole of dto.holes) {
    const source = snapshot.positions.find(position => position.number === hole.position);
    for (const role of ['front', 'center', 'back']) { assert.deepEqual(hole.green[role], source.green[role]?.coordinate ?? null); if (hole.green[role]) assert.ok(validCoordinate(hole.green[role])); }
    for (const reference of hole.references) assert.ok(validCoordinate(reference.coordinate));
    // Explicit numerical test at a stored point, not device/field evidence.
    const reading = { active: true, simulated: true, reading: { wgs84: hole.green.center, timestamp: 100000, accuracyMeters: 8, synthetic: true } };
    assert.equal(gpsMeasurements(hole, reading, null, 100000).center.meters, 0);
  }
  assert.equal(JSON.stringify(snapshot), original);
  if (dto.physicalHoleCount === 9) {
    assert.equal(dto.holes.length, 18); assert.equal(new Set(dto.holes.map(h => h.physicalHoleId)).size, 9);
    for (let i = 0; i < 9; i++) {
      assert.equal(dto.holes[i].physicalHoleId, dto.holes[i + 9].physicalHoleId);
      assert.equal(dto.holes[i].lap, 1); assert.equal(dto.holes[i + 9].lap, 2);
    }
  }
  courses.push({ id: dto.id, name: dto.name, normalizedSha256: hash(bytes), physicalHoles: dto.physicalHoleCount, cardPositions: dto.cardPositionCount,
    greenRoles: Object.fromEntries(['front', 'center', 'back'].map(role => [role, dto.holes.filter(h => h.green[role]).length])),
    safeReferences: dto.holes.reduce((sum, h) => sum + h.references.length, 0), teeReferences: dto.holes.reduce((sum, h) => sum + h.references.filter(r => r.kind.endsWith('TEE')).length, 0),
    quarantinedPointsExcluded: snapshot.rejectedPoints.length, maximumPairedGreenDifferenceMeters: Math.max(0, ...dto.holes.flatMap(h => Object.values(h.pairingDifferencesMeters ?? {}).filter(n => Number.isFinite(n)))),
    sourceUpdatedAt: dto.source.recordUpdatedAt, fieldVerified: false });
}
const ledgerAfter = await readFile(path.join(storePath, 'ledger.json')); assert.equal(hash(ledgerBefore), hash(ledgerAfter));
const evidence = { checkedAt: new Date().toISOString(), status: 'PASS', newGolfApiRequests: 0, totalStageRequests: 10, ledgerUnchangedSha256: hash(ledgerAfter), completeRawResponsesVerified: 10, courses, deviceValidation: 'PENDING_DEVICE_QA', upstreamDisabled: true };
await writeFile(outputPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
