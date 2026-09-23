import type { Course } from '../../lib/types';
export function CourseReviewNotice({course,roundHoles,startHole}:{course:Course;roundHoles:9|18;startHole:number}) {
  const review=course.catalogReview;if(!review)return null;
  const nineSegment=startHole===1?'FRONT':startHole===10?'BACK':null;
  const nine=nineSegment?review.nineRatings.find(n=>n.segment===nineSegment):undefined;
  return <aside className="notice"><b>{course.teeName} · {roundHoles===9?(startHole===1?'Hoyos 1–9':startHole===10?'Hoyos 10–18':`9 hoyos · salida H${startHole}`):'18 hoyos'}</b>
    <p>Rating informado: {roundHoles===9?nine?.course_rating??'No disponible':review.reportedRating??'No disponible'} · Slope: {roundHoles===9?nine?.slope_rating??'No disponible':review.reportedSlope??'No disponible'}</p>
    <p>Categoría sin verificar: no se aplicará este rating automáticamente ni se considerará oficial. En Jugadores puedes declarar manualmente Rating/Slope de 18 hoyos y su categoría/fuente. No se convierte un rating de 18 en uno de 9.</p>
    {review.issues.length>0&&<p role="status">Datos señalados: {review.issues.join(', ')}. Yardas declaradas: {course.totalYards}; suma de hoyos: {course.holes.reduce((n,h)=>n+(h.yards??0),0)}. Se conservan ambas cifras.</p>}
    {review.limitation&&<p>{review.limitation}</p>}
    <small>Consultado {review.sourceObservedAt} · revisión de derechos pendiente. No es integración oficial GHIN.</small>
  </aside>;
}
