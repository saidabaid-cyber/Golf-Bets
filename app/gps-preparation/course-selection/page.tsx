import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import { localGolfApiSnapshotStore } from '../../../lib/golfapi/local-store.server';
import { GPS_SAVED_COURSES,gpsCourseProjection } from '../../../lib/golf-gps/projection';
import { CourseSelectionLocalQa, type CatalogQaSnapshot } from '../../components/golf-gps/course-selection-local-qa';
export const dynamic='force-dynamic';
export default async function CourseSelectionQa(){
  if(process.env.GPS_LOCAL_QA_ENABLED!=='true'||process.env.VERCEL||process.env.NODE_ENV!=='development')notFound();
  const host=(await headers()).get('host');if(!['localhost:3217','127.0.0.1:3217'].includes(host||''))notFound();
  const snapshot=JSON.parse(await readFile(/* turbopackIgnore: true */ process.env.GPS_LOCAL_QA_CATALOG_PATH||'', 'utf8')) as CatalogQaSnapshot;
  const store=localGolfApiSnapshotStore(process.env.GOLFAPI_STORE_PATH||'');
  const gpsCourses=await Promise.all(GPS_SAVED_COURSES.map(async row=>gpsCourseProjection(await store.readNormalized(row.externalId))));
  return <CourseSelectionLocalQa snapshot={snapshot} gpsCourses={gpsCourses}/>;
}
