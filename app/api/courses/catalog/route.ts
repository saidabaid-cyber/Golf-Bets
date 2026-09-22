import { NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { searchReviewedCourses } from '../../../../lib/review-course-catalog';
import { getCourseCatalog } from '../../../../lib/course-catalog-provider.server';
import { golfCourseSelectionToLegacyCourse } from '../../../../lib/golf-course-directory';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export async function GET(request:NextRequest) {
  try {
    const auth=await authenticatedRequest(request);
    if(!auth.ok) return NextResponse.json({error:auth.error},{status:auth.status,headers});
    const catalog=await getCourseCatalog();
    const clubs=new Map(catalog.clubs.map(club=>[club.id,club]));
    const data=catalog.courses.flatMap(course=>{const club=clubs.get(course.clubId);if(!course.active||!club?.active)return[];const courseTees=catalog.tees.filter(tee=>tee.active&&tee.courseId===course.id);return[{id:course.id,clubId:club.id,name:course.name,clubName:club.name,holes:course.holes,city:club.city,stateRegion:club.stateRegion,aliases:[...(club.aliases||[]),...(course.aliases||[])],latitude:course.latitude??club.latitude,longitude:course.longitude??club.longitude,locationEvidence:club.latitude!==undefined&&club.longitude!==undefined&&club.sourceUrl&&club.verifiedAt?{sourceUrl:club.sourceUrl,verifiedAt:club.verifiedAt}:undefined,sourceUrl:course.sourceUrl||club.sourceUrl||'',observedAt:course.verifiedAt||club.verifiedAt||'',dataVersion:`${course.provider.toLowerCase()}-v${course.catalogVersion||1}`,teeCount:courseTees.length,completeCards:courseTees.filter(tee=>catalog.teeHoleYardages.filter(row=>row.teeId===tee.id&&typeof row.yards==='number').length===course.holes).length}];});
    const id=request.nextUrl.searchParams.get('courseId');
    if(id) {
      const course=data.find(c=>c.id===id);
      if(!course) return NextResponse.json({error:'No encontramos ese recorrido.'},{status:404,headers});
      const cards=catalog.tees.filter(tee=>tee.active&&tee.courseId===id).map(tee=>golfCourseSelectionToLegacyCourse(catalog,tee.id)).filter(Boolean);
      return NextResponse.json({course,cards},{headers});
    }
    const q=(request.nextUrl.searchParams.get('q')??'').slice(0,160);
    // Only verified club coordinates go to the browser; user's position never leaves it.
    const matches=searchReviewedCourses(data,q);
    return NextResponse.json({total:matches.length,courses:matches},{headers});
  } catch { return NextResponse.json({error:'No pudimos cargar el catálogo. Reintenta o usa captura manual.'},{status:503,headers}); }
}
