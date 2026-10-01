"use client";
import { useState } from "react";
import { VisualField } from "./admin-visual-catalog";
import type { AdminField } from "../../lib/admin-simple-catalog";

export function AdminCourseGolfEditor({ values, patch }: { values: Record<string, unknown>; patch: (key: string, value: unknown) => void }) {
  const [teeIndex, setTeeIndex] = useState<number | null>(null);
  const tees = (Array.isArray(values.tees) ? values.tees : []) as Record<string, unknown>[];
  const holes = (Array.isArray(values.holes) ? values.holes : []) as Record<string, unknown>[];
  const teeFields: AdminField[] = [{key:"name",label:"Nombre",required:true},{key:"color",label:"Color"},{key:"category",label:"Categoría"},{key:"rating",label:"Rating",type:"number",min:40,max:100},{key:"slope",label:"Slope",type:"number",min:55,max:155},{key:"par",label:"Par",type:"number",min:27,max:120},{key:"totalYards",label:"Yardas",type:"number",min:100,max:15000},{key:"active",label:"Activo",type:"checkbox"}];
  function yardage(t: number, h: number) {
    const changes = (values.yardages || []) as Record<string, unknown>[];
    const changed = changes.find(row => row.teeIndex === t && row.holeIndex === h);
    return changed?.yards ?? ((values.teeHoleYardages || []) as Record<string, unknown>[]).find(row => row.teeId === tees[t]?.id && row.holeId === holes[h]?.id)?.yards ?? "";
  }
  function updateYards(t: number, h: number, yards: string) {
    const changes = (values.yardages || []) as Record<string, unknown>[];
    patch("yardages", [...changes.filter(row => row.teeIndex !== t || row.holeIndex !== h), {teeIndex:t,holeIndex:h,yards}]);
  }
  return <>
    <fieldset><legend>Tees</legend>{tees.map((tee,index) => <div className="adminV2TeeRow" key={String(tee.id || index)}><div><strong>{String(tee.name || "Tee nuevo")}</strong><br/><small>{String(tee.rating ?? "—")} / {String(tee.slope ?? "—")} · {tee.active === false ? "Inactivo" : "Activo"}</small></div><button type="button" className="secondary" onClick={() => setTeeIndex(teeIndex === index ? null : index)}>Editar</button></div>)}
      {teeIndex !== null && tees[teeIndex] && <section className="adminV2Stack" aria-label="Editar tee"><h3>Editar tee</h3><div className="adminV2FormGrid">{teeFields.map(field => <VisualField key={field.key} field={field} value={tees[teeIndex][field.key]} change={value => patch("tees", tees.map((tee,index) => index === teeIndex ? {...tee,[field.key]:value} : tee))}/>)}</div><button type="button" className="secondary" onClick={() => setTeeIndex(null)}>Cerrar edición de tee</button></section>}
      <button type="button" className="secondary" onClick={() => {patch("tees", [...tees,{name:"",active:true}]);setTeeIndex(tees.length);}}>+ Agregar tee</button>
    </fieldset>
    <fieldset><legend>Tarjeta actual</legend>{!holes.length ? <><p>Completa únicamente información verificada.</p><button type="button" className="secondary" onClick={() => patch("holes", Array.from({length:Number(values.holeCount) || 18},(_,index) => ({holeNumber:index+1,par:"",strokeIndex:""})))}>Completar tarjeta</button></> : <><p>Desliza la tarjeta para ver las yardas de cada tee.</p><div className="adminV2Scorecard" role="region" aria-label="Editar tarjeta por hoyo" tabIndex={0}><table><thead><tr><th scope="col">Hoyo</th><th scope="col">Par</th><th scope="col">HCP</th>{tees.map((tee,index) => <th scope="col" key={index}>{String(tee.name || "Tee nuevo")} · yd</th>)}</tr></thead><tbody>{holes.map((hole,index) => <tr key={String(hole.id || index)}><th scope="row">{String(hole.holeNumber || index+1)}</th>{["par","strokeIndex"].map(key => <td key={key}><input aria-label={`${key === "par" ? "Par" : "HCP"} hoyo ${index+1}`} type="number" inputMode="numeric" min={key === "par" ? 3 : 1} max={key === "par" ? 6 : Number(values.holeCount)} required value={String(hole[key] ?? "")} onChange={event => patch("holes",holes.map((row,i) => i === index ? {...row,[key]:event.target.value} : row))}/></td>)}{tees.map((tee,t) => <td key={t}><input type="number" inputMode="numeric" min={1} max={1000} aria-label={`Yardas ${String(tee.name)} hoyo ${index+1}`} value={String(yardage(t,index))} onChange={event => updateYards(t,index,event.target.value)}/></td>)}</tr>)}</tbody></table></div></>}</fieldset>
  </>;
}
