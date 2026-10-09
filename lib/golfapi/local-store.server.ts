import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GolfApiSnapshot } from './normalize.mjs';
import type { StoredGolfApiSnapshots } from './source.server';

/** Development-only read of the durable private directory, outside the app.
 * Deliberately imports no writer, API transport, ledger mutation or credential.
 * Deployment uses the separately guarded database reader, never these files. */
export function localGolfApiSnapshotStore(root: string, env: Record<string, string | undefined> = process.env): StoredGolfApiSnapshots {
  if (env.VERCEL) throw Error('GOLFAPI_LOCAL_FILES_NOT_DEPLOYMENT_PERSISTENCE');
  if (!root || !path.isAbsolute(root)) throw Error('GOLFAPI_DURABLE_STORE_REQUIRED');
  return { async readNormalized(externalId) {
    if (!/^\d+$/.test(externalId)) throw Error('GOLFAPI_COURSE_ID_INVALID');
    // External private data must be read at runtime, never traced into a deployment.
    const file = path.join(/* turbopackIgnore: true */ root, `normalized-${externalId}.json`);
    const snapshot = JSON.parse(await readFile(file, 'utf8')) as GolfApiSnapshot;
    if (snapshot.schemaVersion !== 1 || snapshot.provider !== 'GOLFAPI' || snapshot.externalCourseId !== externalId) throw Error('GOLFAPI_SAVED_SNAPSHOT_INVALID');
    return snapshot;
  } };
}
