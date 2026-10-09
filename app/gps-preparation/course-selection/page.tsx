import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import { CourseSelectionLocalQa, type CatalogQaSnapshot } from '../../components/golf-gps/course-selection-local-qa';
export const dynamic='force-dynamic';
export default async function CourseSelectionQa(){
  if(process.env.GPS_LOCAL_QA_ENABLED!=='true'||process.env.VERCEL||process.env.NODE_ENV!=='development')notFound();
  const host=(await headers()).get('host');if(!['localhost:3217','127.0.0.1:3217'].includes(host||''))notFound();
  const snapshot=JSON.parse(await readFile(/* turbopackIgnore: true */ process.env.GPS_LOCAL_QA_CATALOG_PATH||'', 'utf8')) as CatalogQaSnapshot;
  return <CourseSelectionLocalQa snapshot={snapshot}/>;
}
