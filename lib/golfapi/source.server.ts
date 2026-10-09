import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseCatalogProvider } from '../course-catalog-provider';
import { savedGolfApiCatalogProvider } from './catalog';
import { isolatedPreviewDatabaseEnabled } from '../preview-database';
import type { GolfApiSnapshot } from './normalize.mjs';

/** Read-only persistent boundary. The provider NEVER fetches upstream during
 * reads, hole changes, GPS updates, rendering, builds or tests. */
export interface StoredGolfApiSnapshots { readNormalized(externalCourseId: string): Promise<GolfApiSnapshot> }

/** Activated only AFTER the pending SQL cache is applied under a separate,
 * coordinated DEV change. Does not create tables or change deployment config. */
export function devGolfApiSnapshotStore(database: SupabaseClient, env: Record<string, string | undefined> = process.env): StoredGolfApiSnapshots {
  if (!isolatedPreviewDatabaseEnabled(env)) throw Error('GOLFAPI_ISOLATED_DEV_BINDING_REQUIRED');
  return {
    async readNormalized(externalCourseId) {
      if (!/^\d+$/.test(externalCourseId)) throw Error('GOLFAPI_COURSE_ID_INVALID');
      const { data, error } = await database.rpc('read_golfapi_snapshot_v1', { p_external_course_id: externalCourseId });
      if (error || !data || data.provider !== 'GOLFAPI' || data.externalCourseId !== externalCourseId || data.schemaVersion !== 1) throw Error('GOLFAPI_SAVED_SNAPSHOT_UNAVAILABLE');
      return data as GolfApiSnapshot;
    },
  };
}

export async function storedGolfApiCatalogProvider(store: StoredGolfApiSnapshots, externalCourseIds: readonly string[]): Promise<CourseCatalogProvider> {
  const snapshots = await Promise.all([...new Set(externalCourseIds)].map(id => store.readNormalized(id)));
  return savedGolfApiCatalogProvider(snapshots);
}
