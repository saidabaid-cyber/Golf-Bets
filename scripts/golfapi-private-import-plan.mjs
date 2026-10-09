import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GolfApiFileStore, documentedRequest } from '../lib/golfapi/controlled-store.mjs';

/** PRIVATE offline handoff; prepares RPC arguments, never executes them.
 * Apply only after the visual handoff and controlled DEV SQL application.
 * Neither Supabase nor GolfAPI is contacted by this command. */
export async function preparePrivateGolfApiImport(env = process.env) {
  const store = new GolfApiFileStore(env.GOLFAPI_STORE_PATH);
  const ledger = await store.ledger();
  if (ledger.halted || ledger.attempts.some(row => row.state !== 'SAVED')) throw Error('GOLFAPI_IMPORT_INCOMPLETE_LEDGER');
  const coverage = JSON.parse(await readFile(path.join(store.root, 'coverage.json'), 'utf8'));
  const operations = [];
  for (const attempt of ledger.attempts) {
    const envelope = await store.cached(documentedRequest(attempt.endpoint, attempt.parameters));
    if (!envelope || envelope.httpStatus !== 200) throw Error('GOLFAPI_IMPORT_INVALID_RESPONSE');
    operations.push({ rpc: 'save_golfapi_response_v1', arguments: { p_envelope: envelope } });
  }
  for (const course of coverage.summaries.filter(row => row.externalCourseId && row.coverage)) {
    const snapshot = await store.readNormalized(course.externalCourseId);
    const version = snapshot.source.sourceVersion;
    const original = structuredClone(snapshot); delete original.source.sourceVersion;
    if (!version || createHash('sha256').update(JSON.stringify(original)).digest('hex') !== version) throw Error('GOLFAPI_IMPORT_VERSION_HASH_MISMATCH');
    operations.push({ rpc: 'save_golfapi_snapshot_v1', arguments: { p_snapshot: snapshot, p_source_version: version } });
  }
  const plan = { schemaVersion: 1, status: 'PENDING_CONTROLLED_DB_APPLY', stageId: ledger.stageId, actualRemoteWrites: 0, activation: 'AFTER_VISUAL_HANDOFF_AND_VERIFIED_CANONICAL_DEV_DB_ONLY', operations };
  await writeFile(path.join(store.root, 'private-import-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
  return { status: plan.status, savedResponses: ledger.attempts.length, snapshots: operations.length - ledger.attempts.length, actualRemoteWrites: 0 };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/golfapi-private-import-plan.mjs')) {
  try { console.log(JSON.stringify(await preparePrivateGolfApiImport())); }
  catch { console.error('GOLFAPI_PRIVATE_IMPORT_PLAN_FAILED_NO_NETWORK'); process.exitCode = 1; }
}
