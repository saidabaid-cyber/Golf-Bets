"use client";
import type {ReactNode} from "react";
import {catalogFields,type AdminField} from "../../lib/admin-simple-catalog";
export const TOURNAMENT_STEPS=[
 {title:"Información",keys:["name","description","type","startsAt","endsAt","organizer"]},
 {title:"Campo y formato",keys:["format"]},
 {title:"Handicap",keys:["handicapMaximum","handicapPercentage"]},
 {title:"Reglas",keys:["ruleBody","visibility"]},
 {title:"Revisión",keys:[]},
];
export function AdminTournamentWizard({step,setStep,values,courses,patch,render}:{step:number;setStep:(step:number)=>void;values:Record<string,unknown>;courses:{id:string;title:string}[];patch:(key:string,value:unknown)=>void;render:(field:AdminField)=>ReactNode}){
 const current=TOURNAMENT_STEPS[step];
 return <section className="adminV2Stack"><nav className="adminV2Tabs adminV2DesktopOnly" aria-label="Pasos del torneo">{TOURNAMENT_STEPS.map((item,index)=><button type="button" key={item.title} aria-current={step===index?"step":undefined} className={step===index?"primary":"secondary"} onClick={()=>setStep(index)}>{index+1}. {item.title}</button>)}</nav><div aria-live="polite"><p className="adminV2Hint">Paso {step+1} de {TOURNAMENT_STEPS.length}</p><h3 className="adminV2Subheading">{current.title}</h3></div><div className="adminV2FormGrid">{catalogFields("COMPETITION").filter(field=>current.keys.includes(field.key)).map(field=>render({...field,required:false}))}</div>
 {step===1&&<label>Campo<select value={String(values.courseId||"")} onChange={event=>patch("courseId",event.target.value)}><option value="">Elegir después</option>{courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label>}
 {step===1&&<p className="adminV2Hint">Elige el campo y el formato del evento.</p>}
 {step===3&&<p className="adminV2Hint">Gestiona inscripciones, participantes y premios desde Administración avanzada.</p>}
 {step===4&&<><h4>{String(values.name||"Torneo sin nombre")}</h4><p>{courses.find(course=>course.id===values.courseId)?.title||"Falta elegir campo"} · {values.visibility==="PUBLIC"?"Público":"Privado"}</p><p>{String(values.description||"Sin descripción")}</p><p>Guarda el borrador y abre su vista previa para verificar y publicar. Puedes guardar en cualquier paso.</p></>}
 </section>;
}
