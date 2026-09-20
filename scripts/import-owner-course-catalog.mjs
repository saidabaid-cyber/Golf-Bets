import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const QA_REF = 'bymeopxkxapfizeeqeyb';
const inputPath = process.argv[2];
if (!inputPath) throw Error('Usage: node scripts/import-owner-course-catalog.mjs <base_campos.json> [--apply]');
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const coordinates = JSON.parse(readFileSync(new URL('../data/course-verified-locations.json', import.meta.url), 'utf8'));
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canonical = { 'ghin:23233':['club-la-vista','course-la-vista'], 'ghin:23232':['club-campestre-puebla','course-campestre-puebla'],
  'ghin:23227':['club-el-cristo','course-el-cristo'], 'ghin:32608':['club-cola-de-lagarto','course-cola-de-lagarto'] };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clubKey = c => canonical[c.id]?.[0] || `review-club-${hash(normalize(c.club_name)).slice(0,20)}`;
const payloads = input.courses.map(c => {
  const cid = canonical[c.id]?.[1] || `review-course-${c.ghin_course_id}`;
  const geo = coordinates.find(g => g.sourceCourseId === c.id);
  const club = { id:clubKey(c),name:c.club_name,city:c.city_inventory || null,state:c.state_inventory || null,
    ...(geo ? {latitude:geo.latitude,longitude:geo.longitude,locationEvidence:geo} : {}) };
  const tees = input.tees.filter(t=>t.course_id===c.id).map(t=>({...t,
    holes:input.holes.filter(h=>h.tee_id===t.id),
    nineRatings:input.nine_hole_ratings.filter(n=>n.parent_tee_id===t.id),
    qa:input.qa.find(q=>q.tee_id===t.id),
  }));
  return {provider:'OWNER_CATALOG_REVIEW',originalSourceId:c.id,course:{...c,id:cid},club,tees,
    contentHash:hash({c,tees,club}),dataVersion:`owner-${input.manifest.observed_at}-v${input.manifest.version}`};
});
if(input.courses.length!==176 || input.tees.length!==769 || input.holes.length!==13536 || input.nine_hole_ratings.length!==1538) throw Error('Input manifest counts mismatch');
if(input.tees.some(t=>t.rating_category!==null)) throw Error('Unexpected rating category: review before import');
if(new Set(input.tees.map(t=>t.id)).size!==769) throw Error('Duplicate source tee ID');
console.log(JSON.stringify({dryRun:!process.argv.includes('--apply'),courses:payloads.length,clubs:new Set(payloads.map(p=>p.club.id)).size,
  tees:input.tees.length,holes:input.holes.length,nineRatings:input.nine_hole_ratings.length,complete:752,yardageDiscrepancies:21,missingCards:17,
  geolocatedClubs:new Set(payloads.filter(p=>p.club.locationEvidence).map(p=>p.club.id)).size}));
if(process.argv.includes('--apply')) {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${QA_REF}.supabase.co` || process.env.QA_CONFIRM_ISOLATED_PREVIEW!==QA_REF) throw Error('REF_MISMATCH_ABORT');
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let imported=0,unchanged=0;
  for(const payload of payloads) {
    const {data,error}=await client.rpc('import_review_course_v1',{payload}).abortSignal(AbortSignal.timeout(30000));
    if(error) throw Error(`Import stopped at ${payload.originalSourceId}: ${error.code} ${error.message}`);
    if(data.unchanged) unchanged++; else imported++;
  }
  console.log(JSON.stringify({qaRef:QA_REF,imported,unchanged}));
}
