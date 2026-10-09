import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { validatePrivateImport, importIntoLocalDatabase, preparedImportSql, preparedRollbackSql, preparedPreflightSql, receiptFromPreflight } from './golfapi-private-import.mjs';

/** Actual saved-data verification on DISK, no remote transport. Prints counts
 * only; provider payloads and PostgreSQL files stay in the private store. */
export async function checkSavedPersistence(env = process.env) {
  if (!env.GOLFAPI_STORE_PATH || !path.isAbsolute(env.GOLFAPI_STORE_PATH) || env.VERCEL) throw Error('PRIVATE_LOCAL_STORE_REQUIRED');
  const root = path.resolve(env.GOLFAPI_STORE_PATH);
  const output = path.join(root, 'persistence-check-' + randomUUID());
  await mkdir(output, { mode: 0o700 });
  const ledgerBefore = await readFile(path.join(root, 'ledger.json'));
  const planText = await readFile(path.join(root, 'private-import-plan.json'), 'utf8');
  const plan = JSON.parse(planText), checked = validatePrivateImport(plan);
  await writeFile(path.join(output, 'private-import-plan.backup.json'), planText, { mode: 0o600 });
  await writeFile(path.join(output, 'private-import.pending.sql'), preparedImportSql(plan), { mode: 0o600 });
  await writeFile(path.join(root, 'private-preflight.pending.sql'), preparedPreflightSql(plan), { mode: 0o600 });
  let db = new PGlite(path.join(output, 'postgres-local'));
  let networkCalls = 0; const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw Error('ALL_EXTERNAL_NETWORK_FORBIDDEN_IN_PERSISTENCE_CHECK'); };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.golf_clubs(id text primary key);
      create table public.golf_courses(id text primary key, club_id text references public.golf_clubs(id));
      grant usage on schema public to service_role, anon, authenticated;
      grant select on public.golf_clubs, public.golf_courses to service_role;`);
    for (const { snapshot } of checked.snapshots) {
      await db.query('insert into public.golf_clubs(id) values($1)', [snapshot.mapping.clubId]);
      await db.query('insert into public.golf_courses(id,club_id) values($1,$2)', [snapshot.mapping.courseId, snapshot.mapping.clubId]);
    }
    await db.exec('alter default privileges grant all on tables to anon, authenticated, service_role');
    await db.exec(await readFile('scripts/sql/golfapi-private-cache.pending.sql', 'utf8'));
    // A pre-existing response must survive rollback. It is reused, not owned
    // by this import receipt, even though it appears in the saved batch.
    await db.exec('set role service_role');
    await db.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify(checked.responses[0])]);
    const baseline = (await db.query(preparedPreflightSql(plan))).rows[0].private_preimport_backup;
    await writeFile(path.join(output, 'LOCAL-ONLY-preimport-backup.json'), JSON.stringify(baseline, null, 2), { mode: 0o600 });
    const first = await importIntoLocalDatabase(db, plan);
    assert.deepEqual(first, receiptFromPreflight(baseline, plan));
    const second = await importIntoLocalDatabase(db, plan);
    assert.equal(first.insertedResponses.length, 9); assert.equal(first.insertedSnapshots.length, 4);
    assert.equal(second.insertedResponses.length, 0); assert.equal(second.insertedSnapshots.length, 0);
    const counts = async () => (await db.query('select (select count(*) from private.golfapi_saved_responses)::int responses,(select count(*) from private.golfapi_source_versions)::int snapshots,(select count(*) from public.golf_courses)::int courses')).rows[0];
    assert.deepEqual(await counts(), { responses: 10, snapshots: 4, courses: 4 });
    for (const role of ['anon', 'authenticated']) {
      await db.exec('reset role; set role ' + role);
      await assert.rejects(() => db.query("select public.read_golfapi_snapshot_v1('01213326512553886')"), /permission denied/);
      await assert.rejects(() => db.query('select * from private.golfapi_saved_responses'), /permission denied/);
    }
    await db.exec('reset role; set role service_role');
    await assert.rejects(() => db.query('delete from private.golfapi_source_versions'), /permission denied/);
    await db.close(); db = new PGlite(path.join(output, 'postgres-local'));
    await db.exec('set role service_role');
    assert.deepEqual(await counts(), { responses: 10, snapshots: 4, courses: 4 });
    for (const { snapshot } of checked.snapshots) {
      const saved = (await db.query('select public.read_golfapi_snapshot_v1($1) as snapshot', [snapshot.externalCourseId])).rows[0].snapshot;
      assert.deepEqual(saved, snapshot);
    }
    const rollback = preparedRollbackSql(first, plan);
    await writeFile(path.join(output, 'private-import.receipt.json'), JSON.stringify(first, null, 2), { mode: 0o600 });
    await writeFile(path.join(output, 'private-rollback.pending.sql'), rollback, { mode: 0o600 });
    await db.exec('reset role'); await db.exec(rollback);
    assert.deepEqual(await counts(), { responses: 1, snapshots: 0, courses: 4 });
    // Restore the same saved data so this durable local DB remains inspectable.
    await db.exec('set role service_role'); await importIntoLocalDatabase(db, plan);
    const finalCounts = await counts(); assert.deepEqual(finalCounts, { responses: 10, snapshots: 4, courses: 4 });
    assert.equal(networkCalls, 0);
    assert.deepEqual(await readFile(path.join(root, 'ledger.json')), ledgerBefore);
    const evidence = { status: 'PASS_LOCAL_ONLY', checkedAt: new Date().toISOString(), database: 'PGlite filesystem; minimal catalog FK fixture, actual saved provider payloads', output, firstInsert: { responses: 9, snapshots: 4 }, preExistingResponses: 1, secondInsert: { responses: 0, snapshots: 0 }, afterReopen: finalCounts, deniedRoles: ['anon', 'authenticated'], serviceRoleDeleteDenied: true, rollbackPreservedPreexistingResponse: true, catalogRowsPreserved: 4, externalRequests: 0, remoteDbWrites: 0, ledgerSha256: createHash('sha256').update(ledgerBefore).digest('hex'), planSha256: createHash('sha256').update(planText).digest('hex') };
    await writeFile(path.join(root, 'persistence-verification.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    return evidence;
  } finally { await db.close(); globalThis.fetch = previousFetch; }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/golfapi-private-persistence-check.mjs')) {
  try { console.log(JSON.stringify(await checkSavedPersistence())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
