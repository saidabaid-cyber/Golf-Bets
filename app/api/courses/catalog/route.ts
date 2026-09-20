import { NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { loadReviewedCourseCatalog,reviewCatalogQaEnabled } from '../../../../lib/review-course-catalog.server';
import { reviewedTeeToCourse,searchReviewedCourses } from '../../../../lib/review-course-catalog';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export async function GET(request:NextRequest) {
  if(!reviewCatalogQaEnabled()) return NextResponse.json({error:'Catálogo en revisión no disponible en este entorno.'},{status:503,headers});
  try {
    const auth=await authenticatedRequest(request);
    if(!auth.ok) return NextResponse.json({error:auth.error},{status:auth.status,headers});
    const data=await loadReviewedCourseCatalog();
    const id=request.nextUrl.searchParams.get('courseId');
    if(id) {
      const course=data.find(c=>c.id===id);
      if(!course) return NextResponse.json({error:'No encontramos ese recorrido.'},{status:404,headers});
      return NextResponse.json({course,cards:course.tees.map(t=>reviewedTeeToCourse(course,t))},{headers});
    }
    const q=(request.nextUrl.searchParams.get('q')??'').slice(0,160);
    // Only verified club coordinates go to the browser; user's position never leaves it.
    const matches=searchReviewedCourses(data,q);
    return NextResponse.json({total:matches.length,courses:matches.map(({tees,...c})=>({...c,teeCount:tees.length,completeCards:tees.filter(t=>t.holes.length===18).length}))},{headers});
  } catch { return NextResponse.json({error:'No pudimos cargar el catálogo. Reintenta o usa captura manual.'},{status:503,headers}); }
}
