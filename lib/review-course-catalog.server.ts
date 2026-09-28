import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase/server';
import { isolatedPreviewDatabaseEnabled } from './preview-database';
import type { ReviewedCatalogCourse, ReviewedScorecardProfile, ReviewedTeeSource } from './review-course-catalog';
import { SCORECARD_PROFILE_PROVENANCE } from './course-scorecard-profiles';

export function reviewCatalogQaEnabled() {
  return isolatedPreviewDatabaseEnabled() && process.env.PREVIEW_DB_REF==='bymeopxkxapfizeeqeyb';
}
let cached:{expires:number;data:ReviewedCatalogCourse[]}|undefined;
export function invalidateReviewedCourseCatalogCache(){cached=undefined;}
export async function loadReviewedCourseCatalog(database?:SupabaseClient|null):Promise<ReviewedCatalogCourse[]> {
  if(!reviewCatalogQaEnabled()) throw Error('CATALOG_QA_ONLY');
  if(cached && cached.expires>Date.now()) return cached.data;
  // Player reads use their own JWT through a narrow, read-only projection.
  // The underlying reviewed rows remain private and protected by RLS.
  const db=database??getSupabaseAdmin(); if(!db) throw Error('CATALOG_UNAVAILABLE');
  const primary=await db.rpc('read_backyard_course_master_v1').abortSignal(AbortSignal.timeout(12000));
  // Keep Preview usable during the controlled migration window. Only a
  // genuinely missing RPC may fall back; permission and runtime errors remain
  // fail-closed and visible to QA.
  const response=primary.error&&['42883','PGRST202'].includes(primary.error.code)
    ? await db.rpc('read_owner_course_catalog_v1').abortSignal(AbortSignal.timeout(12000))
    : primary;
  if(response.error||!response.data||typeof response.data!=='object'||Array.isArray(response.data)) throw Error('CATALOG_READ_FAILED');
  const payload=response.data as {clubs?:unknown;courses?:unknown;tees?:unknown};
  if(!Array.isArray(payload.clubs)||!Array.isArray(payload.courses)||!Array.isArray(payload.tees)) throw Error('CATALOG_READ_FAILED');
  const profileRead=await db.rpc('read_backyard_scorecard_profiles_v1').abortSignal(AbortSignal.timeout(12000));
  const profilePayload=profileRead.error&&['42883','PGRST202'].includes(profileRead.error.code)
    ? {profiles:[],tees:[],holes:[]}
    : profileRead.error||!profileRead.data||typeof profileRead.data!=='object'||Array.isArray(profileRead.data)
      ? null
      : profileRead.data as {profiles?:unknown;tees?:unknown;holes?:unknown};
  if(!profilePayload||!Array.isArray(profilePayload.profiles)||!Array.isArray(profilePayload.tees)||!Array.isArray(profilePayload.holes)) throw Error('SCORECARD_PROFILE_READ_FAILED');
  const clubs=payload.clubs as Array<{id:string;name:string;country:string|null;city:string|null;state_region:string|null;address:string|null;timezone:string|null;latitude:number|null;longitude:number|null;source_url:string|null;verified_at:string|null;catalog_metadata:Record<string,unknown>}>;
  const courses=payload.courses as Array<{id:string;club_id:string;name:string;holes:number;source_url:string;verified_at:string|null;catalog_metadata:Record<string,unknown>}>;
  const tees=payload.tees as Array<{id:string;course_id:string;catalog_metadata:ReviewedTeeSource}>;
  const profileRows=profilePayload.profiles as Array<Record<string,unknown>>;
  const profileTeeRows=profilePayload.tees as Array<Record<string,unknown>>;
  const profileHoleRows=profilePayload.holes as Array<Record<string,unknown>>;
  const profiles:ReviewedScorecardProfile[]=profileRows.flatMap(row=>{
    const provenance=String(row.provenance??'');
    if(typeof row.id!=='string'||typeof row.course_id!=='string'||typeof row.name!=='string'||!SCORECARD_PROFILE_PROVENANCE.includes(provenance as (typeof SCORECARD_PROFILE_PROVENANCE)[number]))return[];
    const optional=(value:unknown)=>typeof value==='string'&&value.trim()?value:null;
    const numberOrNull=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
    return [{id:row.id,courseId:row.course_id,name:row.name,provenance:provenance as ReviewedScorecardProfile['provenance'],sourceProvider:String(row.source_provider??''),sourceExternalId:optional(row.source_external_id),verifiedAt:optional(row.verified_at),effectiveFrom:optional(row.effective_from),effectiveTo:optional(row.effective_to),active:row.active===true,historical:row.historical===true,defaultForPlay:row.default_for_play===true,status:String(row.status??''),
      tees:profileTeeRows.filter(tee=>tee.profile_id===row.id&&typeof tee.tee_id==='string').map(tee=>({teeId:String(tee.tee_id),ratingGender:String(tee.rating_gender??'UNSPECIFIED'),par:numberOrNull(tee.par),courseRating:numberOrNull(tee.course_rating),bogeyRating:numberOrNull(tee.bogey_rating),slopeRating:numberOrNull(tee.slope_rating),frontNineRating:numberOrNull(tee.front_nine_rating),frontNineSlope:numberOrNull(tee.front_nine_slope),backNineRating:numberOrNull(tee.back_nine_rating),backNineSlope:numberOrNull(tee.back_nine_slope),totalYards:numberOrNull(tee.total_yards),totalMeters:numberOrNull(tee.total_meters),sourceExternalId:optional(tee.source_external_id),providerStatus:optional(tee.provider_status)})),
      holes:profileHoleRows.filter(hole=>hole.profile_id===row.id&&typeof hole.hole_id==='string'&&typeof hole.hole_number==='number'&&typeof hole.stroke_index==='number').map(hole=>({holeId:String(hole.hole_id),holeNumber:Number(hole.hole_number),ratingGender:String(hole.rating_gender??'UNSPECIFIED'),strokeIndex:Number(hole.stroke_index)}))}];
  });
  const byClub=new Map(clubs.map(c=>[c.id,c]));
  const data:ReviewedCatalogCourse[]=courses.flatMap(c=>{
    const club=byClub.get(c.club_id); if(!club) return [];
    const origin=String(c.catalog_metadata.origin??'');
    const supportedOrigin=['GHIN','BACKYARD_PROVISIONAL','BACKYARD_ADMIN'].includes(origin)?origin as ReviewedCatalogCourse['origin']:undefined;
    const ratingReuseStatus=c.catalog_metadata.rating_reuse_status==='AUTHORIZED'?'AUTHORIZED':'LEGAL_REVIEW_REQUIRED';
    const provider=typeof c.catalog_metadata.provider==='string'?c.catalog_metadata.provider:undefined;
    const clubAliases=Array.isArray(club.catalog_metadata.search_aliases)?club.catalog_metadata.search_aliases.filter((value):value is string=>typeof value==='string'):[];
    const courseAliases=Array.isArray(c.catalog_metadata.search_aliases)?c.catalog_metadata.search_aliases.filter((value):value is string=>typeof value==='string'):[];
    return [{id:c.id,clubId:club.id,name:c.name,clubName:club.name,holes:c.holes===9?9:18,country:club.country??undefined,city:club.city??undefined,stateRegion:club.state_region??undefined,address:club.address??undefined,timezone:club.timezone??undefined,
      aliases:[...new Set([...clubAliases,...courseAliases])],latitude:club.latitude??undefined,longitude:club.longitude??undefined,
      locationEvidence:(club.catalog_metadata.locationEvidence as ReviewedCatalogCourse['locationEvidence'])??(club.source_url&&club.verified_at?{sourceUrl:club.source_url,verifiedAt:club.verified_at}:undefined),sourceUrl:c.source_url,observedAt:String(c.catalog_metadata.observed_at??c.verified_at??''),
      dataVersion:String(c.catalog_metadata.dataVersion??c.catalog_metadata.data_version??''),...(provider?{provider}:{}),ratingReuseStatus,...(supportedOrigin?{origin:supportedOrigin}:{}),isProvisional:supportedOrigin==='BACKYARD_PROVISIONAL',
      ...(typeof c.catalog_metadata.course_id==='string'?{providerCourseId:c.catalog_metadata.course_id}:{}),
      ...(typeof c.catalog_metadata.operational_status==='string'?{providerStatus:c.catalog_metadata.operational_status}:{}),
      tees:tees.filter(t=>t.course_id===c.id).map(t=>({...t.catalog_metadata,id:t.id})),scorecardProfiles:profiles.filter(profile=>profile.courseId===c.id)}];
  });
  if(data.length) cached={data,expires:Date.now()+60_000};
  return data;
}
