import type { AdminEntityType } from "./admin-control-center";
export type AdminRecord = { id: string; title: string; subtitle: string; active: boolean; kind: AdminEntityType; values: Record<string, unknown>; version?: number };
export type AdminField = { key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" | "select" | "url" | "date" | "datetime-local"; required?: boolean; options?: readonly string[]; min?: number; max?: number };
export const COURSE_FIELDS: AdminField[] = [{ key: "name", label: "Nombre del recorrido", required: true },{key:"clubName",label:"Nombre del club",required:true},{key:"city",label:"Ciudad"},{key:"stateRegion",label:"Estado / región"},{key:"country",label:"País"},{key:"address",label:"Dirección"},{key:"latitude",label:"Latitud",type:"number",min:-90,max:90},{key:"longitude",label:"Longitud",type:"number",min:-180,max:180},{key:"holeCount",label:"Hoyos",type:"select",options:["9","18"],required:true},{key:"active",label:"Activo",type:"checkbox"}];
export function safeFields(input: Record<string, unknown>, fields: readonly AdminField[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field.key];
    if (field.type === "checkbox") { if (typeof value !== "boolean") throw new Error(`Revisa ${field.label}.`); result[field.key] = value; }
    else if (field.type === "number") { const number = value === "" || value == null ? null : Number(value); if (number !== null && (!Number.isFinite(number) || field.min !== undefined && number < field.min || field.max !== undefined && number > field.max)) throw new Error(`Revisa ${field.label}.`); result[field.key] = number; }
    else { if (value !== undefined && typeof value !== "string" && typeof value !== "number") throw new Error(`Revisa ${field.label}.`); const text = String(value ?? "").trim(); if (text.length > (field.type === "textarea" ? 20000 : 500) || field.required && !text || field.options && text && !field.options.includes(text)) throw new Error(`Revisa ${field.label}.`); if (field.type === "url" && text && !/^https:\/\//i.test(text)) throw new Error(`Revisa ${field.label}.`); result[field.key] = text || null; }
  }
  return result;
}
export function buildCoursePayload(base: Record<string, unknown>, input: Record<string, unknown>) {
  const values = safeFields(input, COURSE_FIELDS); const course = base.course as Record<string, unknown>; const club = base.club as Record<string, unknown>;
  const oldTees = Array.isArray(base.tees) ? base.tees as Record<string, unknown>[] : [];
  const tees = Array.isArray(input.tees) ? input.tees.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Revisa los tees."); const tee = raw as Record<string, unknown>;
    const old = oldTees.find(t => t.id === tee.id); if (tee.id && !old) throw new Error("El tee no pertenece a este recorrido.");
    const fields: AdminField[] = [{key:"name",label:"Nombre del tee",required:true},{key:"color",label:"Color"},{key:"category",label:"Categoría"},{key:"rating",label:"Rating",type:"number",min:40,max:100},{key:"slope",label:"Slope",type:"number",min:55,max:155},{key:"par",label:"Par",type:"number",min:27,max:120},{key:"totalYards",label:"Yardas",type:"number",min:100,max:15000},{key:"active",label:"Tee activo",type:"checkbox"}];
    return { ...old, ...safeFields(tee, fields), id: old?.id || `tee-${crypto.randomUUID()}` };
  }) : oldTees;
  // Removing a tee from a form must never delete a historically referenced tee.
  for (const old of oldTees) if (!tees.some(t => t.id === old.id)) throw new Error("Desactiva el tee en lugar de eliminarlo.");
  return { ...base, course: { ...course, id: course.id, name: values.name, holes: Number(values.holeCount), active: values.active }, club: { ...club, name: values.clubName, city: values.city, stateRegion: values.stateRegion, country: values.country, address: values.address, latitude: values.latitude, longitude: values.longitude }, tees };
}
const LABELS: Record<string,string> = {name:"Nombre",clubName:"Club",city:"Ciudad",stateRegion:"Región",active:"Activo",rating:"Rating",slope:"Slope",par:"Par",totalYards:"Yardas",brand:"Marca",model:"Modelo",year:"Año",generation:"Generación",description:"Descripción",visibility:"Visibilidad",fitEligible:"Visible en Ball Fit",bagEligible:"Visible en Mi Bolsa",sourceName:"Fuente",sourceUrl:"Referencia",verifiedAt:"Fecha verificada",startsAt:"Inicio",endsAt:"Fin",handicapMaximum:"Handicap máximo",handicapPercentage:"Porcentaje de handicap",body:"Texto",title:"Título",color:"Color",holes:"Hoyos"};
export type HumanChange = { label: string; before: string; after: string };
export function humanChanges(before: unknown, after: unknown, prefix = ""): HumanChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (after && typeof after === "object" || before && typeof before === "object") {
    const a = (after || {}) as Record<string,unknown>, b = (before || {}) as Record<string,unknown>;
    return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k => !["id","courseId","clubId","providerExternalId","dataEnvironment","data_environment","engineContract"].includes(k)).flatMap(k => humanChanges(b[k],a[k],`${prefix}${LABELS[k] || (Array.isArray(after) ? `Elemento ${Number(k)+1}` : k)} · `));
  }
  const display = (value: unknown) => value == null || value === "" ? "—" : typeof value === "boolean" ? value ? "Sí" : "No" : typeof value === "object" ? "Información agregada" : String(value);
  return [{label:prefix.replace(/ · $/,""),before:display(before),after:display(after)}];
}
