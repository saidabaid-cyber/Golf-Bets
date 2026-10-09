import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { devGolfApiSnapshotStore } from '../golfapi/source.server';
import { GPS_SAVED_COURSES, gpsCourseProjection, reviewedClubCardGps } from './projection';
import type { GpsCourse } from './types';

// Only an optimization of private, durable DB reads. No upstream client exists
// here. Authorization remains in each caller, before reaching this function.
let pending: Promise<{ courses: GpsCourse[]; unavailable: string[] }> | null = null;
let expires = 0;
export function readSavedGpsCourses(database: SupabaseClient) {
  const store = devGolfApiSnapshotStore(database); // Check isolated binding even on cache hits.
  if (pending && Date.now() < expires) return pending;
  expires = Date.now() + 60_000;
  pending = Promise.allSettled(GPS_SAVED_COURSES.map(async row => gpsCourseProjection(await store.readNormalized(row.externalId))))
    .then(async rows => {
      const courses = rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []);
      if (!courses.length) throw Error('GPS_SAVED_DATA_UNAVAILABLE');
      // Reuse the already approved eighteen-hole physical alias. No GHIN call
      // or catalog mutation; keep the round's own card and tee facts intact.
      try {
        const { data, error } = await database.from('golf_courses').select('id,club_id,holes,is_provisional,catalog_metadata').eq('id','course-la-vista-club-current').maybeSingle();
        if (!error) { const alias = reviewedClubCardGps(courses, data); if (alias) courses.push(alias); }
      } catch { /* An unavailable alias must never be guessed. Canonical data remains usable. */ }
      return { courses, unavailable: rows.flatMap((row, index) => row.status === 'rejected' ? [GPS_SAVED_COURSES[index].id] : []) };
    }).catch(error => { pending = null; expires = 0; throw error; });
  return pending;
}
