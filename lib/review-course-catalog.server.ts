import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase/server';
import { isolatedPreviewDatabaseEnabled } from './preview-database';
import type { ReviewedCatalogCourse, ReviewedTeeSource } from './review-course-catalog';

export function reviewCatalogQaEnabled() {
  return isolatedPreviewDatabaseEnabled() && process.env.PREVIEW_DB_REF==='bymeopxkxapfizeeqeyb';
}
let cached:{expires:number;data:ReviewedCatalogCourse[]}|undefined;
export async function loadReviewedCourseCatalog(database?:SupabaseClient|null):Promise<ReviewedCatalogCourse[]> {
  if(!reviewCatalogQaEnabled()) throw Error('CATALOG_QA_ONLY');
  if(cached && cached.expires>Date.now()) return cached.data;
  // Player reads use their own JWT through a narrow, read-only projection.
  // The underlying reviewed rows remain private and protected by RLS.
  const db=database??getSupabaseAdmin(); if(!db) throw Error('CATALOG_UNAVAILABLE');
  const response=await db.rpc('read_owner_course_catalog_v1').abortSignal(AbortSignal.timeout(12000));
  if(response.error||!response.data||typeof response.data!=='object'||Array.isArray(response.data)) throw Error('CATALOG_READ_FAILED');
  const payload=response.data as {clubs?:unknown;courses?:unknown;tees?:unknown};
  if(!Array.isArray(payload.clubs)||!Array.isArray(payload.courses)||!Array.isArray(payload.tees)) throw Error('CATALOG_READ_FAILED');
  const clubs=payload.clubs as Array<{id:string;name:string;city:string|null;state_region:string|null;latitude:number|null;longitude:number|null;catalog_metadata:Record<string,unknown>}>;
  const courses=payload.courses as Array<{id:string;club_id:string;name:string;holes:number;source_url:string;verified_at:string|null;catalog_metadata:Record<string,unknown>}>;
  const tees=payload.tees as Array<{id:string;course_id:string;catalog_metadata:ReviewedTeeSource}>;
  const byClub=new Map(clubs.map(c=>[c.id,c]));
  const data:ReviewedCatalogCourse[]=courses.flatMap(c=>{
    const club=byClub.get(c.club_id); if(!club) return [];
    return [{id:c.id,clubId:club.id,name:c.name,clubName:club.name,holes:c.holes===9?9:18,city:club.city??undefined,stateRegion:club.state_region??undefined,
      aliases:Array.isArray(c.catalog_metadata.search_aliases)?c.catalog_metadata.search_aliases.filter((value):value is string=>typeof value==='string'):[],latitude:club.latitude??undefined,longitude:club.longitude??undefined,
      locationEvidence:club.catalog_metadata.locationEvidence as ReviewedCatalogCourse['locationEvidence'],sourceUrl:c.source_url,observedAt:String(c.catalog_metadata.observed_at??c.verified_at??''),
      dataVersion:String(c.catalog_metadata.dataVersion??''),tees:tees.filter(t=>t.course_id===c.id).map(t=>t.catalog_metadata)}];
  });
  if(data.length) cached={data,expires:Date.now()+60_000};
  return data;
}
