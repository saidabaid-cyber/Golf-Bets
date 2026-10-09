import { NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { searchReviewedCourses } from '../../../../lib/review-course-catalog';
import { getCourseCatalog } from '../../../../lib/course-catalog-provider.server';
import { golfCourseSelectionToLegacyCourse } from '../../../../lib/golf-course-directory';
import { courseConfigurationLabel,scorecardProvenancePlayPriority } from '../../../../lib/course-scorecard-profiles';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export async function GET(request:NextRequest) {
  try {
    const auth=await authenticatedRequest(request);
    if(!auth.ok) return NextResponse.json({error:auth.error},{status:auth.status,headers});
    const catalog=request.nextUrl.searchParams.get('fresh')==='1'
      ?await getCourseCatalog(auth.client,{requireQaReviewedCatalog:true,forceFresh:true})
      :await getCourseCatalog(auth.client,{requireQaReviewedCatalog:true});
    const clubs=new Map(catalog.clubs.map(club=>[club.id,club]));
    const data=catalog.courses.flatMap(course=>{const club=clubs.get(course.clubId);if(!course.active||!club?.active)return[];const courseTees=catalog.tees.filter(tee=>tee.active&&tee.courseId===course.id);const profiles=(catalog.scorecardProfiles??[]).filter(profile=>profile.courseId===course.id&&profile.active&&!profile.historical).sort((left,right)=>Number(right.defaultForPlay)-Number(left.defaultForPlay)||scorecardProvenancePlayPriority(left.provenance)-scorecardProvenancePlayPriority(right.provenance));const primaryProfile=profiles[0];const totalPar=primaryProfile?.tees.find(tee=>typeof tee.par==='number')?.par??courseTees.find(tee=>typeof tee.par==='number')?.par??null;return[{id:course.id,clubId:club.id,name:course.name,configurationLabel:courseConfigurationLabel({courseName:course.name,clubName:club.name,totalPar,profile:primaryProfile}),configurationPriority:scorecardProvenancePlayPriority(primaryProfile?.provenance),clubName:club.name,holes:course.holes,city:club.city,stateRegion:club.stateRegion,aliases:[...(club.aliases||[]),...(course.aliases||[])],latitude:course.latitude??club.latitude,longitude:course.longitude??club.longitude,locationEvidence:club.latitude!==undefined&&club.longitude!==undefined&&club.sourceUrl&&club.verifiedAt?{sourceUrl:club.sourceUrl,verifiedAt:club.verifiedAt}:undefined,sourceUrl:course.sourceUrl||club.sourceUrl||'',observedAt:course.verifiedAt||club.verifiedAt||'',dataVersion:`${course.provider.toLowerCase()}-v${course.catalogVersion||1}`,origin:course.origin,isProvisional:course.isProvisional,providerCourseId:course.providerExternalId,providerStatus:course.providerStatus,ghinPostEligible:courseTees.some(tee=>tee.ghinPostEligible===true),teeCount:courseTees.length,completeCards:courseTees.filter(tee=>catalog.teeHoleYardages.filter(row=>row.teeId===tee.id&&typeof row.yards==='number').length===course.holes).length}];}).sort((left,right)=>left.clubName.localeCompare(right.clubName,'es-MX')||left.configurationPriority-right.configurationPriority||left.configurationLabel.localeCompare(right.configurationLabel,'es-MX'));
    const id=request.nextUrl.searchParams.get('courseId');
    if(id) {
      const course=data.find(c=>c.id===id);
      if(!course) return NextResponse.json({error:'No encontramos ese recorrido.'},{status:404,headers});
      const profiles=(catalog.scorecardProfiles??[]).filter(profile=>profile.courseId===id&&profile.active&&!profile.historical)
        .sort((left,right)=>Number(right.defaultForPlay)-Number(left.defaultForPlay)||left.name.localeCompare(right.name,'es-MX'));
      // A club's verified playing profile may have no public source document.
      // Bind Index provenance to this real authenticated projection instead of
      // borrowing a location URL or disclosing private supporting documents.
      const profileSourceUrl=new URL(request.nextUrl.pathname,request.nextUrl.origin);
      profileSourceUrl.searchParams.set('courseId',id);
      const cards=profiles.length
        ? profiles.flatMap(profile=>profile.tees.map(profileTee=>golfCourseSelectionToLegacyCourse(catalog,profileTee.teeId,profile.id,profileTee.ratingGender,profileSourceUrl.href)).filter(Boolean))
        : catalog.tees.filter(tee=>tee.active&&tee.courseId===id).map(tee=>golfCourseSelectionToLegacyCourse(catalog,tee.id)).filter(Boolean);
      const availableTees=catalog.tees.filter(tee=>tee.active&&tee.courseId===id).map(tee=>({id:tee.id,name:tee.name,gender:tee.gender??null,rating:tee.rating??null,slope:tee.slope??null,totalYards:tee.totalYards??null}));
      const holeCount=catalog.holes.filter(hole=>hole.courseId===id).length;
      const cardIssue=cards.length ? null : holeCount!==course.holes
        ? `Falta la tarjeta numerada de los ${course.holes} hoyos: orden y par para llevar score. Las ventajas/SI son necesarias para handicap; la correspondencia de hoyos físicos, para GPS. Los totales registrados no sustituyen esa tarjeta.`
        : 'Falta completar una tarjeta utilizable de 9 o 18 hoyos para los tees de esta configuración.';
      return NextResponse.json({course,cards,availableTees,cardIssue},{headers});
    }
    const q=(request.nextUrl.searchParams.get('q')??'').slice(0,160);
    // Only verified club coordinates go to the browser; user's position never leaves it.
    const matches=searchReviewedCourses(data,q);
    return NextResponse.json({total:matches.length,courses:matches},{headers});
  } catch { return NextResponse.json({error:'No pudimos cargar el catálogo. Reintenta o usa captura manual.'},{status:503,headers}); }
}
