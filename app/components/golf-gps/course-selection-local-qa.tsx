"use client";
import { GolfPlayQa } from '../../qa/scorecard/golf-play-qa';
import type { GpsCourse } from '../../../lib/golf-gps/types';
import { useMemo,useState } from 'react';
import { CatalogCoursePicker } from '../catalog-course-picker';
import { RoundTeePicker } from '../round-tee-picker';
import { RoundSetupWizard,RoundSetupStep,WizardReviewBlock } from '../round-setup-wizard';
import { collectRoundSetupPreflightIssues } from '../../../lib/round-setup-preflight';
import { teeCategoryLabel,freezeScorecardProfileSelection,roundTeeSelectionId } from '../../../lib/course-scorecard-profiles';
import type { Course } from '../../../lib/types';
export type CatalogQaSnapshot={courses:{id:string;clubId:string;clubName:string;name:string;holes:number;isProvisional:boolean;teeCount:number;completeCards:number}[];tees:{id:string;courseId:string;name:string;gender:string|null;rating:number|null;slope:number|null;totalYards:number|null;holes:{hole_number:number;par:number;stroke_index:number;yards?:number}[];sourceExternalId:string}[]};
/** Read-only catalog projection captured from DEV. No account or remote writes.
 * This harness and its dependency injection are unreachable in deployments. */
export function CourseSelectionLocalQa({snapshot,gpsCourses}:{snapshot:CatalogQaSnapshot;gpsCourses?:GpsCourse[]}){
 const [fullFlow,setFullFlow]=useState(false);
 const [cards,setCards]=useState<Course[]>([]),[selected,setSelected]=useState<Course|null>(null),[started,setStarted]=useState(false);
 const [pending,setPending]=useState<{name:string;catalogClubId?:string;catalogCourseId?:string;selectionIssue?:string}|null>(null);
 const requestCatalog=useMemo(()=>async(url:string)=>{
  const id=new URL(url,'http://localhost').searchParams.get('courseId');
  const course=snapshot.courses.find(row=>row.id===id);
  const tees=snapshot.tees.filter(row=>row.courseId===id);
  const cards=course?tees.filter(row=>row.holes.length===course.holes).map(tee=>({id:`${tee.id}::QA-READONLY::${tee.gender||'UNSPECIFIED'}`,name:course.name,teeName:tee.name,catalogCourseId:course.id,catalogClubId:course.clubId,catalogTeeId:tee.id,scorecardRatingGender:tee.gender||'UNSPECIFIED',scorecardProfileId:'QA-READONLY',scorecardProfileName:'Tarjeta guardada',scorecardProfileProvenance:'GHIN_OFFICIAL',rating:tee.rating??undefined,slope:tee.slope??undefined,totalYards:tee.totalYards??undefined,holes:tee.holes.map(h=>({number:h.hole_number,par:h.par,strokeIndex:h.stroke_index,yards:h.yards}))})):[];
  return new Response(JSON.stringify(id?{course,cards,availableTees:tees,cardIssue:cards.length?null:`Faltan las definiciones de los ${course?.holes} hoyos (par y ventaja/SI). ${tees.length} tees disponibles con datos agregados; esos totales no sustituyen una tarjeta por hoyo.`}:{courses:snapshot.courses}),{status:200});
 },[snapshot]);
 const issues=collectRoundSetupPreflightIssues({courseSelected:Boolean(selected),pendingCourse:pending,players:[{id:'LOCAL',name:'QA'}],betIssues:[]});
 if(fullFlow&&gpsCourses)return <GolfPlayQa token="LOCAL-QA-NOT-REAL" courses={gpsCourses} mapsEnabled={false} requestCatalog={requestCatalog}/>;
 return <main style={{maxWidth:680,margin:'auto',padding:12}}><p style={{background:'#ffe0b0',padding:8}}>QA LOCAL AISLADO · Catálogo real guardado · Ninguna ronda se guarda en DEV</p>{gpsCourses&&<button onClick={()=>setFullFlow(true)}>Probar Play → GPS → score (QA memoria)</button>}{started?<><h1>Snapshot QA · Solo memoria</h1><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({id:selected?.id,course:selected?.catalogCourseId,tee:selected?.catalogTeeId,category:selected?.scorecardRatingGender,rating:selected?.rating,slope:selected?.slope,profile:selected?freezeScorecardProfileSelection(selected):null},null,2)}</pre><button onClick={()=>{setStarted(false);setCards([]);setSelected(null);setPending(null);}}>Otra selección QA</button></>:<RoundSetupWizard storageKey="GPS-TOUCH-LOCAL-QA-ONLY" scoreOnly quickSolo issues={issues} onStart={async()=>{setStarted(true);return true;}} onSave={()=>true} onExit={()=>{setCards([]);setSelected(null);setPending(null);}}><RoundSetupStep step={1}>{!cards.length?<CatalogCoursePicker token="LOCAL-QA-NOT-A-REAL-TOKEN" permissionOwnerId="LOCAL-QA" selectedCourseId={pending?.catalogCourseId} selectedClubId={pending?.catalogClubId} onSelectClub={entry=>setPending({name:entry.clubName,catalogClubId:entry.clubId})} onConfigurationPending={(entry,issue)=>setPending({name:entry.name,catalogClubId:entry.clubId,catalogCourseId:entry.id,selectionIssue:issue})} onSelect={(course,cards)=>{setCards(cards);setPending({name:course.name,catalogCourseId:course.catalogCourseId});}} onRequest={name=>setPending(old=>({...old!,name:name||old?.name||'QA',selectionIssue:'Solicitud QA: abriría el formulario existente; no se envía en esta prueba.'}))} requestCatalog={requestCatalog}/>:<RoundTeePicker courseName={cards[0].name} tees={cards} selectedTeeId={selected?roundTeeSelectionId(selected):''} onSelect={setSelected} onBack={()=>{setCards([]);setSelected(null);}} onMissingTee={()=>setPending(old=>({...old!,selectionIssue:"Solicitud QA disponible desde Configuraciones del club; no se envía en esta prueba."}))}/>}</RoundSetupStep><RoundSetupStep step={2}><p>Jugador de prueba en memoria · Sin cuenta</p></RoundSetupStep><RoundSetupStep step={5}><WizardReviewBlock step={1} title="Campo"><p>{selected?.name} · {selected?.teeName} · {selected&&teeCategoryLabel(selected)} · {selected?.rating}/{selected?.slope}</p></WizardReviewBlock></RoundSetupStep></RoundSetupWizard>}</main>;
}
