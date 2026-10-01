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
 return <section className="adminV2Stack"><nav className="adminV2Tabs" aria-label="Pasos del torneo">{TOURNAMENT_STEPS.map((item,index)=><button type="button" key={item.title} aria-current={step===index?"step":undefined} className={step===index?"primary":"secondary"} onClick={()=>setStep(index)}>{index+1}. {item.title}</button>)}</nav><h3>{current.title}</h3><div className="adminV2FormGrid">{catalogFields("COMPETITION").filter(field=>current.keys.includes(field.key)).map(field=>render({...field,required:false}))}</div>
 {step===1&&<label>Campo<select value={String(values.courseId||"")} onChange={event=>patch("courseId",event.target.value)}><option value="">Elegir después</option>{courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label>}
 {step===1&&<p>El formato describe el evento. Los motores de puntuación conservan sus reglas actuales.</p>}
 {step===3&&<p>Inscripciones, participantes y premios requieren el módulo correspondiente de Administración avanzada. Este formulario publica información y reglas existentes.</p>}
 {step===4&&<><h4>{String(values.name||"Torneo sin nombre")}</h4><p>{courses.find(course=>course.id===values.courseId)?.title||"Falta elegir campo"} · {values.visibility==="PUBLIC"?"Público":"Privado"}</p><p>{String(values.description||"Sin descripción")}</p><p>Guarda el borrador y abre su vista previa para verificar y publicar. Puedes guardar en cualquier paso.</p></>}
 <div className="adminV2Actions"><button type="button" className="secondary" disabled={!step} onClick={()=>setStep(step-1)}>Anterior</button><button type="button" className="secondary" disabled={step===TOURNAMENT_STEPS.length-1} onClick={()=>setStep(step+1)}>Siguiente</button></div></section>;
}
