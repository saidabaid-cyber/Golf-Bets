import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { documentedRequest } from '../lib/golfapi/controlled-store.mjs';
import { validatePrivateImport, preparedImportSql, preparedRollbackSql, importIntoLocalDatabase, preparedPreflightSql, receiptFromPreflight } from './golfapi-private-import.mjs';

// Contract fixture only. [0,0] is NOT a measured location of any real course.
function syntheticPlan() {
  const mapping = [['01213326512553886', 'course-la-vista', 'club-la-vista', 18], ['0121254756996467', 'course-campestre-puebla', 'club-campestre-puebla', 18], ['0121235348037759', 'review-course-24458', 'review-club-75f6ac3a0e37a69eabd3', 9], ['0121165709980130', 'course-el-cristo', 'club-el-cristo', 18]];
  const responses = Array.from({ length: 10 }, (_, i) => {
    const request = i < 4 ? documentedRequest('coordinates/' + mapping[i][0]) : documentedRequest('courses', { name: 'Synthetic ' + i });
    const bodyText = JSON.stringify({ synthetic: true, i });
    const metadata = { endpoint: request.endpoint, parameters: request.parameters, requestKey: request.requestKey };
    return { ...metadata, provider: 'GOLFAPI', schemaVersion: 1, httpStatus: 200, bodyText, bodySha256: createHash('sha256').update(bodyText).digest('hex') };
  });
  const snapshots = mapping.map(([externalCourseId, courseId, clubId, physicalCount], i) => {
    const positions = Array.from({ length: 18 }, (_, n) => ({ number: n + 1, lap: Math.floor(n / physicalCount) + 1, physicalHoleId: 'synthetic-' + n % physicalCount, green: { front: null, center: { coordinate: [0, 0], position: n + 1, isFlag: false }, back: null }, points: [] }));
    const physicalHoles = Array.from({ length: physicalCount }, (_, n) => ({ id: 'synthetic-' + n, cardPositions: positions.filter(p => p.physicalHoleId === 'synthetic-' + n).map(p => p.number) }));
    const snapshot = { schemaVersion: 1, provider: 'GOLFAPI', externalCourseId, mapping: { courseId, clubId }, positions, physicalHoles, source: { coordinatesRequestKey: responses[i].requestKey }, synthetic: true };
    const version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'); snapshot.source.sourceVersion = version;
    return { rpc: 'save_golfapi_snapshot_v1', arguments: { p_snapshot: snapshot, p_source_version: version } };
  });
  return { schemaVersion: 1, stageId: 'puebla-source-20261007', actualRemoteWrites: 0, operations: [...responses.map(p_envelope => ({ rpc: 'save_golfapi_response_v1', arguments: { p_envelope } })), ...snapshots] };
}
test('offline plan validates complete saved stage, stable mappings, longitude/latitude and physical laps', () => {
  const valid = validatePrivateImport(syntheticPlan()); assert.equal(valid.responses.length, 10); assert.equal(valid.snapshots.length, 4);
  const fuentes = valid.snapshots[2].snapshot; assert.equal(fuentes.physicalHoles.length, 9); assert.equal(fuentes.positions.length, 18); assert.equal(fuentes.positions[0].physicalHoleId, fuentes.positions[9].physicalHoleId);
  assert.equal(fuentes.positions[9].lap, 2);
});
test('tampered raw response, duplicate operation, missing operation and unexpected RPC stop before DB use', () => {
  for (const mutate of [p => p.operations[0].arguments.p_envelope.bodyText = '{}', p => p.operations[1] = structuredClone(p.operations[0]), p => p.operations.pop(), p => p.operations[0].rpc = 'delete_all']) {
    const p = syntheticPlan(); mutate(p); assert.throws(() => validatePrivateImport(p), /IMPORT_/);
  }
});
test('identity, snapshot hash, coordinate order and physical assignment cannot be changed silently', () => {
  for (const [mutate, error] of [[s => s.mapping.courseId = 'outside', /IMPORT_SNAPSHOT_INTEGRITY/], [s => s.positions[0].green.center.coordinate = [19, -98], /IMPORT_COORDINATE_INVALID/], [s => s.positions[9].physicalHoleId = 'wrong', /IMPORT_PHYSICAL_MAPPING_INVALID/], [s => s.source.sourceVersion = 'x', /IMPORT_SNAPSHOT_INTEGRITY/]]) {
    const p = syntheticPlan(), args = p.operations[12].arguments; mutate(args.p_snapshot);
    // Re-sign changed fixtures to test geography/mapping independently of hash
    // detection. A green with swapped lon/lat must still be refused.
    if (args.p_snapshot.source.sourceVersion !== 'x') {
      const original = structuredClone(args.p_snapshot); delete original.source.sourceVersion;
      args.p_source_version = createHash('sha256').update(JSON.stringify(original)).digest('hex'); args.p_snapshot.source.sourceVersion = args.p_source_version;
    }
    assert.throws(() => validatePrivateImport(p), error);
  }
});
test('prepared SQL contains only saved cache RPCs in one transaction and rollback refuses foreign keys', () => {
  const plan = syntheticPlan(), sql = preparedImportSql(plan); assert.match(sql, /begin;/); assert.match(sql, /commit;/);
  assert.equal((sql.match(/select public.save_golfapi_/g) ?? []).length, 14); assert.doesNotMatch(sql, /fetch|https:|update public|insert into public|drop table/i);
  const receipt = { schemaVersion: 1, stageId: plan.stageId, insertedResponses: [], insertedSnapshots: [] };
  assert.doesNotMatch(preparedRollbackSql(receipt, plan), /delete from/);
  receipt.insertedResponses.push({ key: 'x', bodySha256: 'y' }); assert.throws(() => preparedRollbackSql(receipt, plan), /OUTSIDE_BATCH/);
});
test('batch is idempotent, full conflict rejects atomically, receipt rollback preserves reused rows', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const plan = syntheticPlan(), data = validatePrivateImport(plan);
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.golf_clubs(id text primary key); create table public.golf_courses(id text primary key,club_id text references public.golf_clubs(id)); grant select on public.golf_courses,public.golf_clubs to service_role;');
  for (const { snapshot: s } of data.snapshots) { await db.query('insert into public.golf_clubs values($1)', [s.mapping.clubId]); await db.query('insert into public.golf_courses values($1,$2)', [s.mapping.courseId, s.mapping.clubId]); }
  await db.exec(await readFile('scripts/sql/golfapi-private-cache.pending.sql', 'utf8'));
  await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify({ ...data.responses[9], fetchedAt: 'different-existing-metadata' })]);
  await assert.rejects(() => importIntoLocalDatabase(db, plan), /EXISTING_RESPONSE_CONFLICT/);
  assert.equal((await db.query('select count(*) from private.golfapi_saved_responses')).rows[0].count, 1);
  await db.query('delete from private.golfapi_saved_responses where request_key=$1', [data.responses[9].requestKey]);
  await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify(data.responses[0])]);
  const baseline = (await db.query(preparedPreflightSql(plan))).rows[0].private_preimport_backup;
  const first = await importIntoLocalDatabase(db, plan), second = await importIntoLocalDatabase(db, plan);
  assert.deepEqual(receiptFromPreflight(baseline, plan), first);
  assert.throws(() => receiptFromPreflight({ ...baseline, responses: [{ outside: true }] }, plan), /BASELINE_RESPONSE_CONFLICT/);
  assert.equal(first.insertedResponses.length, 9); assert.equal(first.insertedSnapshots.length, 4); assert.equal(second.insertedResponses.length, 0); assert.equal(second.reusedSnapshots, 4);
  await db.exec(preparedRollbackSql(second, plan)); assert.equal((await db.query('select count(*) from private.golfapi_source_versions')).rows[0].count, 4);
  await db.exec(preparedRollbackSql(first, plan)); assert.equal((await db.query('select count(*) from private.golfapi_saved_responses')).rows[0].count, 1);
  assert.equal((await db.query('select count(*) from public.golf_courses')).rows[0].count, 4);
});
