import 'server-only';
import { getSupabaseAdmin } from './supabase/server';
import { isolatedPreviewDatabaseEnabled } from './preview-database';
import type { ReviewedCatalogCourse, ReviewedTeeSource } from './review-course-catalog';

export function reviewCatalogQaEnabled() {
  return isolatedPreviewDatabaseEnabled() && process.env.PREVIEW_DB_REF==='bymeopxkxapfizeeqeyb';
}
let cached:{expires:number;data:ReviewedCatalogCourse[]}|undefined;
export async function loadReviewedCourseCatalog():Promise<ReviewedCatalogCourse[]> {
  if(!reviewCatalogQaEnabled()) throw Error('CATALOG_QA_ONLY');
  if(cached && cached.expires>Date.now()) return cached.data;
  const db=getSupabaseAdmin(); if(!db) throw Error('CATALOG_UNAVAILABLE');
  const [clubs,courses,tees]=await Promise.all([
    db.from('golf_clubs').select('id,name,city,state_region,latitude,longitude,catalog_metadata').eq('provider','OWNER_CATALOG_REVIEW').eq('active',true).limit(1000).abortSignal(AbortSignal.timeout(12000)),
    db.from('golf_courses').select('id,club_id,name,holes,source_url,verified_at,catalog_metadata').eq('provider','OWNER_CATALOG_REVIEW').eq('active',true).limit(1000).abortSignal(AbortSignal.timeout(12000)),
    db.from('golf_course_tees').select('id,course_id,catalog_metadata').eq('provider','OWNER_CATALOG_REVIEW').eq('active',true).limit(1000).abortSignal(AbortSignal.timeout(12000)),
  ]);
  if(clubs.error||courses.error||tees.error) throw Error('CATALOG_READ_FAILED');
  const byClub=new Map(clubs.data.map(c=>[c.id,c]));
  const data:ReviewedCatalogCourse[]=courses.data.flatMap(c=>{
    const club=byClub.get(c.club_id); if(!club) return [];
    return [{id:c.id,clubId:club.id,name:c.name,clubName:club.name,holes:c.holes===9?9:18,city:club.city??undefined,stateRegion:club.state_region??undefined,
      aliases:c.catalog_metadata.search_aliases??[],latitude:club.latitude??undefined,longitude:club.longitude??undefined,
      locationEvidence:club.catalog_metadata.locationEvidence,sourceUrl:c.source_url,observedAt:c.catalog_metadata.observed_at,
      dataVersion:c.catalog_metadata.dataVersion,tees:tees.data.filter(t=>t.course_id===c.id).map(t=>t.catalog_metadata as ReviewedTeeSource)}];
  });
  if(data.length) cached={data,expires:Date.now()+60_000};
  return data;
}
