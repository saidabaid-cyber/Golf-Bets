import type { Course } from './types';
import { haversineDistanceKm, type CourseGeographicPoint } from './course-distance';
import { readCourseRatingEvidenceBundle, type CourseRatingEvidenceBundleV1 } from './course-rating-evidence';
import type { ScorecardProfileProvenance } from './course-scorecard-profiles';

export type ReviewedNineRating = { id:string; segment:'FRONT'|'BACK'|'UNSPECIFIED'; course_rating:number; slope_rating:number; par:number; rating_category:null; source_url:string; observed_at:string };
export type ReviewedTeeSource = { id:string; name:string; displayName?:string|null; gender?:string|null; course_rating:number|null; slope_rating:number|null; yards:number|null; par:number|null;
  provider?:string; provider_course_id?:string|null; provider_tee_set_rating_id?:string|null; provider_status?:string|null; provider_mapping_status?:string|null;
  ghin_post_eligible?:boolean; ghin_post_eligibility_code?:string;
  rating_category:string|null; qa_status:string; source_limitation:string|null; holes:{hole_number:number;par:number;stroke_index:number;yards:number|null}[];
  nineRatings:ReviewedNineRating[]; qa:{status:string;errors:string[];source_limitation?:string|null};
  ratingEvidenceV1?:CourseRatingEvidenceBundleV1;
  supplement?:{sourceUrl:string;authority:string;observedAt:string;hash:string;physicalHoles?:9|18;schemaVersion?:1|2;courseId?:string;teeId?:string};
  supplementOriginal?:ReviewedTeeSource };
export type ReviewedScorecardProfileTee = {
  teeId:string; ratingGender:string; par:number|null; courseRating:number|null; bogeyRating:number|null; slopeRating:number|null;
  frontNineRating:number|null; frontNineSlope:number|null; backNineRating:number|null; backNineSlope:number|null;
  totalYards:number|null; totalMeters:number|null; sourceExternalId:string|null; providerStatus:string|null;
};
export type ReviewedScorecardProfileHole = { holeId:string; holeNumber:number; ratingGender:string; strokeIndex:number };
export type ReviewedScorecardProfile = {
  id:string; courseId:string; name:string; provenance:ScorecardProfileProvenance; sourceProvider:string;
  sourceExternalId:string|null; verifiedAt:string|null; effectiveFrom:string|null; effectiveTo:string|null;
  active:boolean; historical:boolean; defaultForPlay:boolean; status:string;
  tees:ReviewedScorecardProfileTee[]; holes:ReviewedScorecardProfileHole[];
};
export type ReviewedCatalogCourse = { id:string; clubId:string; name:string; clubName:string; holes:9|18; country?:string; city?:string; stateRegion?:string; address?:string; timezone?:string; aliases:string[];
  latitude?:number; longitude?:number; locationEvidence?:{sourceUrl:string;verifiedAt:string}; sourceUrl:string; observedAt:string; dataVersion:string;
  provider?:string; ratingReuseStatus?:'AUTHORIZED'|'LEGAL_REVIEW_REQUIRED';
  origin?:'GHIN'|'BACKYARD_PROVISIONAL'|'BACKYARD_ADMIN'; isProvisional?:boolean; providerCourseId?:string; providerStatus?:string;
  tees:ReviewedTeeSource[]; scorecardProfiles?:ReviewedScorecardProfile[] };
export function normalizeCourseSearch(value:string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
export function searchReviewedCourses<T extends Omit<ReviewedCatalogCourse,'tees'>>(courses:T[],query:string) {
  const tokens=normalizeCourseSearch(query).split(/\s+/).filter(Boolean);
  return courses.filter(c=>tokens.every(token=>normalizeCourseSearch([c.name,c.clubName,c.city,c.stateRegion,c.country,...c.aliases].join(' ')).includes(token)))
    .sort((a,b)=>a.clubName.localeCompare(b.clubName,'es') || a.name.localeCompare(b.name,'es'));
}
export function homeCourseSelection<T extends Pick<ReviewedCatalogCourse,'id'|'clubId'|'name'|'clubName'>>(course:T) {
  return {clubId:course.clubId,clubName:course.clubName,courseId:course.id,courseName:course.name};
}
export function singleReviewedCourseLayout<T extends Pick<ReviewedCatalogCourse,'clubId'>>(courses:readonly T[],clubId:string) {
  const layouts=courses.filter(course=>course.clubId===clubId);
  return layouts.length===1?layouts[0]:null;
}
export function courseSelectionLabel(selection:{clubName:string;courseName:string}) {
  return normalizeCourseSearch(selection.clubName)===normalizeCourseSearch(selection.courseName)
    ? selection.clubName
    : `${selection.clubName} · ${selection.courseName}`;
}
export function nearestReviewedClubs<T extends Omit<ReviewedCatalogCourse,'tees'>>(courses:T[],origin:CourseGeographicPoint) {
  const clubs=new Map<string,T>();
  for(const course of courses) if(course.locationEvidence && !clubs.has(course.clubId)) clubs.set(course.clubId,course);
  return [...clubs.values()].flatMap(c=>{
    const distance=haversineDistanceKm(origin,{latitude:c.latitude!,longitude:c.longitude!});
    return distance===null || distance>REVIEWED_NEARBY_DISTANCE_KM ? [] : [{...c,distanceKm:distance}];
  }).sort((a,b)=>a.distanceKm-b.distanceKm || a.clubName.localeCompare(b.clubName,'es-MX') || a.clubId.localeCompare(b.clubId));
}
/** Product radius for verified nearby clubs. Distances are geographic, not driving distance. */
export const REVIEWED_NEARBY_DISTANCE_KM = 50;
export function reviewedClubsLocationSummary(clubs: readonly { distanceKm: number }[]) {
  if (!clubs.length) return 'No hay campos con ubicación disponible cerca de ti. La búsqueda manual sigue disponible.';
  return `Encontramos ${clubs.length} campos a 50 km o menos · ${clubs.length} clubes distintos.`;
}
export function reviewedTeeRatingIsAuthorized(c:ReviewedCatalogCourse,t:ReviewedTeeSource) {
  const confirmedGhinRating=c.provider==='GHIN'&&t.provider==='GHIN'
    &&t.provider_mapping_status==='CONFIRMED'
    &&Boolean(c.providerCourseId&&t.provider_course_id&&t.provider_tee_set_rating_id)
    &&c.providerCourseId===t.provider_course_id;
  return c.ratingReuseStatus==='AUTHORIZED'||confirmedGhinRating;
}
/** Ratings are preserved as evidence, never applied until their category is verified.
 * Holes retain the original 18-hole SI even when playing one nine. */
export function reviewedTeeToCourse(c:ReviewedCatalogCourse,t:ReviewedTeeSource):Course {
  const ratingEvidence=readCourseRatingEvidenceBundle(t.ratingEvidenceV1,{courseId:c.id,teeId:t.id});
  const providerBackedRating=reviewedTeeRatingIsAuthorized(c,t)
    && typeof t.course_rating==='number'&&typeof t.slope_rating==='number';
  return {id:t.id,name:c.name,teeName:t.displayName??t.name,catalogClubId:c.clubId,catalogCourseId:c.id,catalogTeeId:t.id,clubName:c.clubName,
    city:c.city,stateRegion:c.stateRegion,country:c.country,provider:t.provider??c.provider??c.origin??'OWNER_CATALOG_REVIEW',providerExternalId:t.provider_tee_set_rating_id??t.id,
    sourceUrl:t.supplement?.sourceUrl??c.sourceUrl,sourceAuthority:t.supplement?.authority??(c.ratingReuseStatus==='AUTHORIZED'?`Proveedor autorizado · ${t.provider??'Course Master'}`:'Catálogo aportado por el owner · categoría por verificar'),verifiedAt:t.supplement?.observedAt??c.observedAt,dataVersion:t.supplement?`${c.dataVersion}:card-${t.supplement.hash.slice(0,12)}`:c.dataVersion,
    ...(providerBackedRating?{rating:t.course_rating!,slope:t.slope_rating!}:{}),
    ...(t.yards!==null?{totalYards:t.yards}:{}),
    ...(c.origin?{layoutOrigin:c.origin}:{}),...(c.isProvisional!==undefined?{isProvisional:c.isProvisional}:{}),
    ...(t.provider_course_id?{providerCourseId:t.provider_course_id}:{}),...(t.provider_tee_set_rating_id?{providerTeeSetRatingId:t.provider_tee_set_rating_id}:{}),
    ...(t.provider_status?{providerStatus:t.provider_status}:{}),...(t.ghin_post_eligible!==undefined?{ghinPostEligible:t.ghin_post_eligible}:{}),
    holes:t.holes.map(h=>({number:h.hole_number,par:h.par,strokeIndex:h.stroke_index,...(h.yards!==null?{yards:h.yards}:{})})),
    catalogReview:{...(ratingEvidence?{ratingEvidence}:{}),ratingCategory:t.rating_category,categoryVerified:c.ratingReuseStatus==='AUTHORIZED',reuseStatus:c.ratingReuseStatus??'LEGAL_REVIEW_REQUIRED',qaStatus:t.qa_status,
      issues:t.qa?.errors??[],limitation:t.source_limitation,reportedRating:t.course_rating,reportedSlope:t.slope_rating,
      nineRatings:structuredClone(t.nineRatings),sourceObservedAt:c.observedAt},
  };
}
