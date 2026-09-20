import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const ref='bymeopxkxapfizeeqeyb';
if(process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${ref}.supabase.co`||process.env.QA_CONFIRM_ISOLATED_PREVIEW!==ref)throw Error('REF_MISMATCH_ABORT');
const rows=['course-additional-locations.json','course-osm-locations.json','course-location-followup.json'].flatMap(file=>JSON.parse(readFileSync(new URL(`../data/${file}`,import.meta.url),'utf8')));
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
let updated=0,unchanged=0;
for(const geo of rows){
  if(!Number.isFinite(geo.latitude)||Math.abs(geo.latitude)>90||!Number.isFinite(geo.longitude)||Math.abs(geo.longitude)>180||!geo.sourceUrl?.startsWith('https://')||!geo.verifiedAt)throw Error('Invalid evidenced location');
  const course=await db.from('golf_courses').select('club_id').eq('provider','OWNER_CATALOG_REVIEW').eq('catalog_metadata->>originalSourceId',geo.sourceCourseId).single();
  if(course.error)throw Error('Source course not found');
  const club=await db.from('golf_clubs').select('id,latitude,longitude,catalog_metadata').eq('id',course.data.club_id).eq('provider','OWNER_CATALOG_REVIEW').single();
  if(club.error)throw Error('Review club not found');
  if(club.data.latitude!==null||club.data.longitude!==null){if(club.data.latitude===geo.latitude&&club.data.longitude===geo.longitude){unchanged++;continue;}throw Error('LOCATION_CONFLICT_REVIEW_REQUIRED');}
  if(process.argv.includes('--apply')){const result=await db.from('golf_clubs').update({latitude:geo.latitude,longitude:geo.longitude,catalog_metadata:{...club.data.catalog_metadata,locationEvidence:geo}}).eq('id',club.data.id).eq('provider','OWNER_CATALOG_REVIEW').is('latitude',null).is('longitude',null).select('id');if(result.error||result.data.length!==1)throw Error('Location update conflict');}
  updated++;
}
console.log(JSON.stringify({qaRef:ref,dryRun:!process.argv.includes('--apply'),updated,unchanged,cardDataChanged:false}));
