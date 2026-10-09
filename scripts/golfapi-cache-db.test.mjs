import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('pending private cache SQL executes locally: permissions, versions, mappings, idempotence and cap', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.golf_clubs(id text primary key);
    create table public.golf_courses(id text primary key, club_id text references public.golf_clubs(id));
    insert into public.golf_clubs values ('synthetic-club');
    insert into public.golf_courses values ('synthetic-course', 'synthetic-club');
    grant usage on schema public to service_role, anon, authenticated;
    grant select on public.golf_clubs, public.golf_courses to service_role;`);
  // Supabase defaults can grant broader table access; own cache must remove it.
  await db.exec('alter default privileges grant all on tables to anon, authenticated, service_role');
  await db.exec(await readFile('scripts/sql/golfapi-private-cache.pending.sql', 'utf8'));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query("select public.read_golfapi_snapshot_v1('100')"), /permission denied/);
    await assert.rejects(() => db.query('select * from private.golfapi_saved_responses'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(() => db.query('delete from private.golfapi_source_versions'), /permission denied/);
  await assert.rejects(() => db.query("update private.golfapi_saved_responses set stage_id='outside'"), /permission denied/);
  const envelope = { provider: 'GOLFAPI', schemaVersion: 1, requestKey: 'a'.repeat(64), bodySha256: 'b'.repeat(64), bodyText: '{"synthetic":true}', endpoint: 'coordinates/100', httpStatus: 200 };
  await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify(envelope)]);
  await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify(envelope)]);
  assert.equal((await db.query('select count(*) from private.golfapi_saved_responses')).rows[0].count, 1);
  await assert.rejects(() => db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify({ ...envelope, bodySha256: 'c'.repeat(64) })]), /VERSION_CONFLICT/);
  const snapshot = { provider: 'GOLFAPI', schemaVersion: 1, externalCourseId: '100', mapping: { courseId: 'synthetic-course', clubId: 'synthetic-club' }, source: { coordinatesRequestKey: envelope.requestKey, sourceVersion: '1'.repeat(64) }, synthetic: true };
  await db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify(snapshot), '1'.repeat(64)]);
  await db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify(snapshot), '1'.repeat(64)]);
  assert.equal((await db.query('select count(*) from private.golfapi_source_versions')).rows[0].count, 1);
  assert.equal((await db.query("select public.read_golfapi_snapshot_v1('100') as snapshot")).rows[0].snapshot.synthetic, true);
  await assert.rejects(() => db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify({ ...envelope, provider: null })]), /ENVELOPE_INVALID/);
  for (const invalid of [{ ...snapshot, schemaVersion: null }, { ...snapshot, provider: null }, { ...snapshot, source: { coordinatesRequestKey: envelope.requestKey } }]) await assert.rejects(() => db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify(invalid), '1'.repeat(64)]), /MAPPING_OR_SOURCE_INVALID/);
  await assert.rejects(() => db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify({ ...snapshot, synthetic: false }), '1'.repeat(64)]), /VERSION_CONFLICT/);
  await assert.rejects(() => db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify({ ...snapshot, externalCourseId: '999' }), '2'.repeat(64)]), /MAPPING_OR_SOURCE_INVALID/);
  await assert.rejects(() => db.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify({ ...snapshot, mapping: { courseId: 'outsider', clubId: 'synthetic-club' } }), '2'.repeat(64)]), /MAPPING_OR_SOURCE_INVALID/);
  for (let index = 1; index <= 9; index++) await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify({ ...envelope, requestKey: index.toString(16).repeat(64) })]);
  await assert.rejects(() => db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify({ ...envelope, requestKey: 'e'.repeat(64) })]), /BUDGET_EXHAUSTED/);
  assert.equal((await db.query('select count(*) from private.golfapi_saved_responses')).rows[0].count, 10);
  assert.equal((await db.query('select count(*) from public.golf_courses')).rows[0].count, 1);
});
