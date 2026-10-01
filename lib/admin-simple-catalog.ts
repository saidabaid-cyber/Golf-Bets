import type { AdminEntityType } from "./admin-control-center";
export type AdminRecord = { id: string; title: string; subtitle: string; active: boolean; kind: AdminEntityType; values: Record<string, unknown>; version?: number };
export type AdminField = { key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" | "select" | "url" | "date" | "datetime-local"; required?: boolean; options?: readonly string[]; min?: number; max?: number };
export function adminOptionLabel(value:string) {
  return ({OEM_OFFICIAL:"Fabricante oficial",DISTRIBUTOR:"Distribuidor",SECONDARY_ARCHIVE:"Archivo de referencia",USER_SUBMITTED:"Enviado por un jugador",ADMIN_RESEARCH:"Verificación administrativa",OTHER:"Otro",POLLA:"Polla",TOURNAMENT:"Torneo",LEAGUE:"Liga",EVENT:"Evento",PRIVATE:"Privado",PUBLIC:"Público",VERY_LOW:"Muy bajo",LOW:"Bajo",MID:"Medio",HIGH:"Alto",VERY_HIGH:"Muy alto",WOOD:"Madera",FAIRWAY:"Madera de fairway",FAIRWAY_WOOD:"Madera de fairway",HYBRID:"Híbrido",UTILITY:"Utility",IRON:"Hierro",IRON_SET:"Set de hierros",WEDGE:"Wedge",PUTTER:"Putter",DRIVER:"Driver"} as Record<string,string>)[value] || value;
}
export function adminCatalogPage(items:AdminRecord[],search:string,state:string,offsetValue:string|null) {
  const offset=Number(offsetValue || 0);
  if(!Number.isInteger(offset)||offset<0||offset>100000||!["all","active","inactive"].includes(state))throw new Error("Página no válida.");
  const query=search.trim().toLocaleLowerCase("es-MX");
  const filtered=items.filter(i=>`${i.title} ${i.subtitle}`.toLocaleLowerCase("es-MX").includes(query)&&(state==="all"||i.active===(state==="active")));
  return {items:filtered.slice(offset,offset+40),total:filtered.length,offset,nextOffset:offset+40<filtered.length?offset+40:null};
}
export const EQUIPMENT_FIELDS: AdminField[]=[{key:"brand",label:"Marca",required:true},{key:"model",label:"Modelo",required:true},{key:"generation",label:"Generación"},{key:"year",label:"Año",type:"number",min:1900,max:2200},{key:"active",label:"Actual / activo",type:"checkbox"},{key:"bagEligible",label:"Visible en Mi Bolsa",type:"checkbox"},{key:"fitEligible",label:"Visible en fitting (requiere datos verificables)",type:"checkbox"},{key:"aliasesText",label:"Otros nombres (separados por coma)"},{key:"sourceType",label:"Tipo de fuente",type:"select",required:true,options:["OEM_OFFICIAL","DISTRIBUTOR","SECONDARY_ARCHIVE","USER_SUBMITTED","ADMIN_RESEARCH","OTHER"]}];
export function catalogFields(kind:AdminEntityType):AdminField[]{
  if(kind==="COURSE")return COURSE_FIELDS;
  if(kind==="COMPETITION")return [{key:"name",label:"Nombre",required:true},{key:"description",label:"Descripción",type:"textarea"},{key:"type",label:"Tipo",type:"select",required:true,options:["POLLA","TOURNAMENT","LEAGUE","EVENT"]},{key:"visibility",label:"Visibilidad",type:"select",required:true,options:["PRIVATE","PUBLIC"]},{key:"startsAt",label:"Fecha de inicio",type:"datetime-local"},{key:"endsAt",label:"Fecha de fin",type:"datetime-local"},{key:"format",label:"Formato"},{key:"organizer",label:"Organizador"},{key:"handicapMaximum",label:"Handicap máximo",type:"number",min:0,max:54},{key:"handicapPercentage",label:"Porcentaje de handicap",type:"number",min:0,max:100},{key:"ruleBody",label:"Reglas informativas del evento",type:"textarea",required:true}];
  if(kind==="BALL")return [...EQUIPMENT_FIELDS,{key:"construction",label:"Construcción"},{key:"coverMaterial",label:"Material de cubierta"},...["flight","driverSpin","ironSpin","shortGameSpin","feel"].map((key,index):AdminField=>({key,label:["Vuelo","Spin de driver","Spin de hierros","Spin de juego corto","Sensación"][index],type:"select",options:["VERY_LOW","LOW","MID","HIGH","VERY_HIGH"]})),{key:"compression",label:"Compresión",type:"number",min:1,max:200},{key:"compressionSource",label:"Fuente de compresión"},{key:"compressionSourceUrl",label:"Referencia de compresión",type:"url"}];
  return [...EQUIPMENT_FIELDS,...(kind==="SHAFT"?[{key:"usage",label:"Uso",type:"select" as const,required:true,options:["WOOD","FAIRWAY","HYBRID","UTILITY","IRON","WEDGE","PUTTER"]},{key:"weightsText",label:"Pesos en gramos (separados por coma)"},{key:"flexesText",label:"Flex (separados por coma)"},{key:"torqueText",label:"Torque (separados por coma)"},{key:"launch",label:"Lanzamiento"},{key:"spin",label:"Spin"}]:[{key:"category",label:"Categoría",type:"select" as const,required:true,options:["DRIVER","FAIRWAY_WOOD","HYBRID","IRON_SET","WEDGE","PUTTER"]},{key:"loftsText",label:"Lofts en grados (separados por coma)"},{key:"handsText",label:"Manos (RH, LH)"},{key:"standardLength",label:"Longitud estándar",type:"number" as const,min:1,max:60},{key:"lie",label:"Lie",type:"number" as const,min:0,max:90},{key:"setMakeup",label:"Composición del set"}])];
}
export function buildCompetitionPayload(base:Record<string,unknown>,input:Record<string,unknown>):Record<string,unknown>{
  const values=safeFields(input,catalogFields("COMPETITION"));
  for(const key of ["startsAt","endsAt"])if(values[key]){if(!Number.isFinite(Date.parse(String(values[key]))))throw new Error("Revisa las fechas.");values[key]=new Date(String(values[key])).toISOString();}
  const rules=Array.isArray(base.rules)?base.rules as Record<string,unknown>[]:[];
  const informational=rules.findIndex(r=>r.category==="OTHER"&&r.title==="Información del evento");
  const next={category:"OTHER",title:"Información del evento",body:values.ruleBody,active:true};const newRules=[...rules];if(informational>=0)newRules[informational]={...newRules[informational],...next};else newRules.push(next);
  delete values.ruleBody;
  return {...base,...values,id:base.id,courseId:input.courseId,sourceName:input.sourceName,sourceUrl:input.sourceUrl||null,verifiedAt:input.verifiedAt||null,rules:newRules};
}
export function buildEquipmentPayload(base:Record<string,unknown>,input:Record<string,unknown>,kind:AdminEntityType):Record<string,unknown>{
  const values=safeFields(input,catalogFields(kind));
  const list=(key:string)=>String(values[key]||"").split(",").map(v=>v.trim()).filter(Boolean);
  const numbers=(key:string,min:number,max:number)=>{const result=list(key).map(Number);if(result.some(n=>!Number.isFinite(n)||n<min||n>max))throw new Error("Revisa las especificaciones numéricas.");return result;};
  const payload:Record<string,unknown>={...base,...values,aliases:list("aliasesText"),id:base.id,sourceName:input.sourceName,sourceUrl:input.sourceUrl||null,verifiedAt:input.verifiedAt||null};
  for(const key of ["aliasesText","loftsText","handsText","weightsText","flexesText","torqueText"])delete payload[key];
  if(kind==="BALL")return {...payload,colors:Array.isArray(base.colors)?base.colors:[],targetProfile:Array.isArray(base.targetProfile)?base.targetProfile:[]};
  if(kind==="SHAFT")return {...payload,weightOptions:numbers("weightsText",1,300),flexOptions:list("flexesText"),torqueRange:numbers("torqueText",0,30)};
  return {...payload,lofts:numbers("loftsText",0,90),handedness:list("handsText"),variants:Array.isArray(base.variants)?base.variants:[]};
}
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
  const oldHoles=Array.isArray(base.holes)?base.holes as Record<string,unknown>[]:[];
  const holes=Array.isArray(input.holes)?input.holes.map((raw:unknown,index:number)=>{
    if(!raw||typeof raw!=="object")throw new Error("Revisa la tarjeta.");const hole=raw as Record<string,unknown>;
    const old=oldHoles.find(h=>h.id===hole.id);if(hole.id&&!old)throw new Error("El hoyo no pertenece al campo.");
    const fields:AdminField[]=[{key:"par",label:`Par del hoyo ${index+1}`,type:"number",min:3,max:6},{key:"strokeIndex",label:`Stroke Index del hoyo ${index+1}`,type:"number",min:1,max:Number(values.holeCount)}];
    const result=safeFields(hole,fields);if(result.par===null||result.strokeIndex===null)throw new Error("Completa el par y Stroke Index de cada hoyo.");
    return {...old,...result,id:old?.id||`hole-${crypto.randomUUID()}`,holeNumber:old?.holeNumber||index+1};
  }):oldHoles;
  for(const old of oldHoles)if(!holes.some(h=>h.id===old.id))throw new Error("Conserva los hoyos que ya tienen históricos.");
  let yardages=Array.isArray(base.teeHoleYardages)?base.teeHoleYardages as Record<string,unknown>[]:[];
  if(Array.isArray(input.yardages)){
    const updated=new Map(yardages.map(y=>[`${y.teeId}:${y.holeId}`,y]));
    for(const raw of input.yardages){
      if(!raw||typeof raw!=="object")throw new Error("Revisa las yardas.");const row=raw as Record<string,unknown>;
      const tee=tees[Number(row.teeIndex)],hole=holes[Number(row.holeIndex)];
      if(!Number.isInteger(row.teeIndex)||!Number.isInteger(row.holeIndex)||!tee||!hole)throw new Error("Revisa las yardas del tee y hoyo.");
      if(row.yards===""||row.yards==null)continue;
      const yards=Number(row.yards);if(!Number.isFinite(yards)||yards<=0||yards>1000)throw new Error("Las yardas deben ser positivas y menores a 1000.");
      const key=`${tee.id}:${hole.id}`;updated.set(key,{...updated.get(key),teeId:tee.id,holeId:hole.id,yards});
    }
    yardages=[...updated.values()];
  }
  return { ...base, course: { ...course, id: course.id, name: values.name, holes: Number(values.holeCount), active: values.active }, club: { ...club, name: values.clubName, city: values.city, stateRegion: values.stateRegion, country: values.country, address: values.address, latitude: values.latitude, longitude: values.longitude }, tees,holes,teeHoleYardages:yardages };
}
const LABELS: Record<string,string> = {name:"Nombre",clubName:"Club",city:"Ciudad",stateRegion:"Región",active:"Activo",rating:"Rating",slope:"Slope",par:"Par",totalYards:"Yardas",brand:"Marca",model:"Modelo",year:"Año",generation:"Generación",description:"Descripción",visibility:"Visibilidad",fitEligible:"Visible en Ball Fit",bagEligible:"Visible en Mi Bolsa",sourceName:"Fuente",sourceUrl:"Referencia",verifiedAt:"Fecha verificada",startsAt:"Inicio",endsAt:"Fin",handicapMaximum:"Handicap máximo",handicapPercentage:"Porcentaje de handicap",body:"Texto",title:"Título",color:"Color",holes:"Hoyos"};
export type HumanChange = { label: string; before: string; after: string };
export function humanChanges(before: unknown, after: unknown, prefix = ""): HumanChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (after && typeof after === "object" || before && typeof before === "object") {
    const a = (after || {}) as Record<string,unknown>, b = (before || {}) as Record<string,unknown>;
    return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k => !/(^id$|Id$|_id$|provider|schema|revision|legacy|catalogVersion|dataEnvironment|data_environment|engineContract)/i.test(k)).flatMap(k => humanChanges(b[k],a[k],`${prefix}${LABELS[k] || ({club:"Club",course:"Campo",tees:"Tees",rules:"Reglas",payload:"Cambio",role:"Rol",status:"Estado",shortSummary:"Resumen",holeNumber:"Hoyo",strokeIndex:"Stroke Index",totalMeters:"Metros",category:"Categoría",handedness:"Mano",aliases:"Otros nombres",sourceType:"Fuente",country:"País",address:"Dirección",latitude:"Latitud",longitude:"Longitud",construction:"Construcción",coverMaterial:"Cubierta",flight:"Vuelo",feel:"Sensación",driverSpin:"Spin de driver",ironSpin:"Spin de hierros",shortGameSpin:"Spin de juego corto",order:"Orden",icon:"Icono",instructions:"Instrucciones",format:"Formato",organizer:"Organizador",changedAt:"Fecha",effectiveFrom:"Inicio",effectiveUntil:"Fin",description:"Descripción"} as Record<string,string>)[k] || (Array.isArray(after) ? `Elemento ${Number(k)+1}` : "Información")} · `));
  }
  const display = (value: unknown) => value == null || value === "" ? "—" : typeof value === "boolean" ? value ? "Sí" : "No" : typeof value === "object" ? "Información agregada" : String(value);
  return [{label:prefix.replace(/ · $/,""),before:display(before),after:display(after)}];
}
