import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { localGolfApiSnapshotStore } from '../../lib/golfapi/local-store.server';
import { GPS_SAVED_COURSES, gpsCourseProjection } from '../../lib/golf-gps/projection';
import { GolfGpsLocalQa } from '../components/golf-gps/golf-gps-local-qa';

export const dynamic = 'force-dynamic';
/** Local-only QA surface in THIS repository. No new project/deployment.
 * Never available on DEV/Preview/Production; no auth bypass for real routes. */
export default async function LocalGpsPreparation() {
  if (process.env.GPS_LOCAL_QA_ENABLED !== 'true' || process.env.VERCEL || process.env.NODE_ENV !== 'development') notFound();
  const host = (await headers()).get('host');
  if (host !== '127.0.0.1:3217' && host !== 'localhost:3217') notFound();
  const store = localGolfApiSnapshotStore(process.env.GOLFAPI_STORE_PATH ?? '');
  const courses = await Promise.all(GPS_SAVED_COURSES.map(async row => gpsCourseProjection(await store.readNormalized(row.externalId))));
  return <GolfGpsLocalQa courses={courses} />;
}
