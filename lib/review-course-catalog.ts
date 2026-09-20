import type { Course } from './types';
import { haversineDistanceKm, type CourseGeographicPoint } from './course-distance';

export type ReviewedNineRating = { id:string; segment:'FRONT'|'BACK'|'UNSPECIFIED'; course_rating:number; slope_rating:number; par:number; rating_category:null; source_url:string; observed_at:string };
export type ReviewedTeeSource = { id:string; name:string; course_rating:number|null; slope_rating:number|null; yards:number|null; par:number|null;
  rating_category:null; qa_status:string; source_limitation:string|null; holes:{hole_number:number;par:number;stroke_index:number;yards:number|null}[];
  nineRatings:ReviewedNineRating[]; qa:{status:string;errors:string[];source_limitation?:string|null} };
export type ReviewedCatalogCourse = { id:string; clubId:string; name:string; clubName:string; city?:string; stateRegion?:string; aliases:string[];
  latitude?:number; longitude?:number; locationEvidence?:{sourceUrl:string;verifiedAt:string}; sourceUrl:string; observedAt:string; dataVersion:string;
  tees:ReviewedTeeSource[] };
export function normalizeCourseSearch(value:string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX').trim(); }
export function searchReviewedCourses<T extends Omit<ReviewedCatalogCourse,'tees'>>(courses:T[],query:string) {
  const tokens=normalizeCourseSearch(query).split(/\s+/).filter(Boolean);
  return courses.filter(c=>tokens.every(token=>normalizeCourseSearch([c.name,c.clubName,c.city,c.stateRegion,...c.aliases].join(' ')).includes(token)))
    .sort((a,b)=>a.clubName.localeCompare(b.clubName,'es') || a.name.localeCompare(b.name,'es'));
}
export function nearestReviewedClubs<T extends Omit<ReviewedCatalogCourse,'tees'>>(courses:T[],origin:CourseGeographicPoint) {
  const clubs=new Map<string,T>();
  for(const course of courses) if(course.locationEvidence && !clubs.has(course.clubId)) clubs.set(course.clubId,course);
  return [...clubs.values()].flatMap(c=>{
    const distance=haversineDistanceKm(origin,{latitude:c.latitude!,longitude:c.longitude!});
    return distance===null ? [] : [{...c,distanceKm:distance}];
  }).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,3);
}
/** Ratings are preserved as evidence, never applied until their category is verified.
 * Holes retain the original 18-hole SI even when playing one nine. */
export function reviewedTeeToCourse(c:ReviewedCatalogCourse,t:ReviewedTeeSource):Course {
  return {id:t.id,name:c.name,teeName:t.name,catalogClubId:c.clubId,catalogCourseId:c.id,catalogTeeId:t.id,clubName:c.clubName,
    city:c.city,stateRegion:c.stateRegion,country:'México',provider:'OWNER_CATALOG_REVIEW',providerExternalId:t.id,
    sourceUrl:c.sourceUrl,sourceAuthority:'Catálogo aportado por el owner · categoría por verificar',verifiedAt:c.observedAt,dataVersion:c.dataVersion,
    ...(t.yards!==null?{totalYards:t.yards}:{}),
    holes:t.holes.map(h=>({number:h.hole_number,par:h.par,strokeIndex:h.stroke_index,...(h.yards!==null?{yards:h.yards}:{})})),
    catalogReview:{ratingCategory:null,categoryVerified:false,reuseStatus:'LEGAL_REVIEW_REQUIRED',qaStatus:t.qa_status,
      issues:t.qa?.errors??[],limitation:t.source_limitation,reportedRating:t.course_rating,reportedSlope:t.slope_rating,
      nineRatings:structuredClone(t.nineRatings),sourceObservedAt:c.observedAt},
  };
}
