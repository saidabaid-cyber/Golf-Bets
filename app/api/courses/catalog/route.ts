import { NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { loadReviewedCourseCatalog,reviewCatalogQaEnabled } from '../../../../lib/review-course-catalog.server';
import { reviewedTeeToCourse,searchReviewedCourses } from '../../../../lib/review-course-catalog';
import { getCourseCatalog } from '../../../../lib/course-catalog-provider.server';
import { golfCourseSelectionToLegacyCourse } from '../../../../lib/golf-course-directory';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export async function GET(request:NextRequest) {
  if(!reviewCatalogQaEnabled()) return NextResponse.json({error:'Catálogo en revisión no disponible en este entorno.'},{status:503,headers});
  try {
    const auth=await authenticatedRequest(request);
    if(!auth.ok) return NextResponse.json({error:auth.error},{status:auth.status,headers});
    const [reviewed,catalog]=await Promise.all([loadReviewedCourseCatalog(),getCourseCatalog()]);
    const clubs=new Map(catalog.clubs.map(club=>[club.id,club]));
    const adminCourses=catalog.courses.filter(course=>course.active&&course.provider==='ADMIN_PUBLISHED');
    const adminIds=new Set(adminCourses.map(course=>course.id));
    const adminEntries=adminCourses.flatMap(course=>{const club=clubs.get(course.clubId);if(!club||!club.active)return[];const courseTees=catalog.tees.filter(tee=>tee.active&&tee.courseId===course.id);return[{id:course.id,clubId:club.id,name:course.name,clubName:club.name,holes:course.holes,city:club.city,stateRegion:club.stateRegion,aliases:[...(club.aliases||[]),...(course.aliases||[])],latitude:course.latitude??club.latitude,longitude:course.longitude??club.longitude,locationEvidence:club.latitude!==undefined&&club.longitude!==undefined&&club.sourceUrl&&club.verifiedAt?{sourceUrl:club.sourceUrl,verifiedAt:club.verifiedAt}:undefined,sourceUrl:course.sourceUrl||club.sourceUrl||'',observedAt:course.verifiedAt||club.verifiedAt||'',dataVersion:`admin-v${course.catalogVersion||1}`,teeCount:courseTees.length,completeCards:courseTees.filter(tee=>catalog.teeHoleYardages.filter(row=>row.teeId===tee.id&&row.yards!==undefined).length===course.holes).length}];});
    const data=[...reviewed.filter(course=>!adminIds.has(course.id)),...adminEntries];
    const id=request.nextUrl.searchParams.get('courseId');
    if(id) {
      const adminCourse=adminCourses.find(course=>course.id===id);
      if(adminCourse){const course=data.find(c=>c.id===id);const cards=catalog.tees.filter(tee=>tee.active&&tee.courseId===id).map(tee=>golfCourseSelectionToLegacyCourse(catalog,tee.id)).filter(Boolean);return NextResponse.json({course,cards},{headers});}
      const course=reviewed.find(c=>c.id===id);
      if(!course) return NextResponse.json({error:'No encontramos ese recorrido.'},{status:404,headers});
      return NextResponse.json({course,cards:course.tees.map(t=>reviewedTeeToCourse(course,t))},{headers});
    }
    const q=(request.nextUrl.searchParams.get('q')??'').slice(0,160);
    // Only verified club coordinates go to the browser; user's position never leaves it.
    const matches=searchReviewedCourses(data,q);
    return NextResponse.json({total:matches.length,courses:matches.map(c=>('tees' in c?((({tees,...entry})=>({...entry,teeCount:tees.length,completeCards:tees.filter(t=>t.holes.length===entry.holes).length}))(c)):c))},{headers});
  } catch { return NextResponse.json({error:'No pudimos cargar el catálogo. Reintenta o usa captura manual.'},{status:503,headers}); }
}
