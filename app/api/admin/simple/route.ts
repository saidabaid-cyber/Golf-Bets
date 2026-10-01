import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { SIMPLE_ADMIN_MODULES, type SimpleAdminModule } from "../../../../lib/admin-mode";
import { simpleCourses, simpleEquipment } from "../../../../lib/admin-simple-catalog.server";
import { adminCatalogPage, buildCoursePayload, buildEquipmentPayload, buildCompetitionPayload, competitionFormValues, humanChanges } from "../../../../lib/admin-simple-catalog";
import { coursePayloadIssues, equipmentPayloadIssues, competitionPayloadIssues } from "../../../../lib/admin-payload-validation";
import { getCourseCatalog } from "../../../../lib/course-catalog-provider.server";
import { membershipAllows, type AdminEntityType } from "../../../../lib/admin-control-center";
import { isOperationalAdminData } from "../../../../lib/admin-data-environment";
import { adminCourseFamilies, adminCatalogFacets, adminListSummary, filterAdminCatalog } from "../../../../lib/admin-operations";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const section = request.nextUrl.searchParams.get("module");
  if (section && !(SIMPLE_ADMIN_MODULES as readonly string[]).includes(section)) return json({ error: "Sección no válida." }, 400);
  const access = await requireAdminMode(request, section as SimpleAdminModule | undefined);
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  if (!section) return json({ role: access.role, modules: access.modules });
  const offset=request.nextUrl.searchParams.get("offset");const state=request.nextUrl.searchParams.get("state")||"all";const search=request.nextUrl.searchParams.get("q")||"";
  try{adminCatalogPage([],search,state,offset);}catch{return json({error:"Página no válida."},400);}
  if(section==="competitions"){
    const result=await access.client.from("admin_catalog_revisions").select("id,entity_id,status,payload,version").eq("entity_type","COMPETITION").in("status",["DRAFT","REVIEWED","VERIFIED","PUBLISHED"]).order("version",{ascending:false}).limit(1000);if(result.error)return json({error:"No pudimos cargar las competiciones."},503);
    const definitions=await access.client.from("competition_definitions").select("id,status").limit(1000);
    if(definitions.error)return json({error:"No pudimos confirmar los estados."},503);
    const states=new Map((definitions.data||[]).map(row=>[row.id,row.status]));
    const seen=new Set<string>();const items=(result.data||[]).filter(isOperationalAdminData).filter(row=>row.status==="PUBLISHED").flatMap(row=>{
      if(seen.has(row.entity_id))return [];seen.add(row.entity_id);const p=row.payload;const status=states.get(row.entity_id)||"PUBLISHED";
      return [{id:row.entity_id,title:p.name,subtitle:status==="PUBLISHED"?"Publicado":status==="COMPLETED"?"Finalizado":status==="ARCHIVED"?"Archivado":"Sin publicar",active:status!=="ARCHIVED",kind:"COMPETITION" as const,values:{...competitionFormValues(p),competitionStatus:status},version:row.version}];
    });
    const id=request.nextUrl.searchParams.get("id");if(id)return json({item:items.find(item=>item.id===id)||null});
    return json({...adminCatalogPage(items,search,state,offset),drafts:(result.data||[]).filter(isOperationalAdminData).filter(row=>row.status!=="PUBLISHED"),courses:(await getCourseCatalog(access.client)).courses.filter(course=>course.active&&isOperationalAdminData(course)).map(course=>({id:course.id,title:course.name}))});
  }
  if(section==="equipment"||section==="balls"){
    const items=await simpleEquipment(access.memberships,section==="balls");const q=(request.nextUrl.searchParams.get("q")||"").toLowerCase();
    const id=request.nextUrl.searchParams.get("id");
    if(id)return json({item:items.find(item=>item.id===id)||null});
    const drafts=await access.client.from("admin_catalog_revisions").select("id,entity_id,entity_type,status,payload").in("entity_type",section==="balls"?["BALL"]:["CLUB_EQUIPMENT","SHAFT"]).in("status",["DRAFT","REVIEWED","VERIFIED"]).order("created_at",{ascending:false}).limit(40);
    if(drafts.error)return json({error:"No pudimos cargar los borradores."},503);
    const filtered=filterAdminCatalog(items,Object.fromEntries(["brand","category","year"].map(key=>[key,request.nextUrl.searchParams.get(key)||""])));
    const page=adminCatalogPage(filtered,q,state,offset);
    return json({...page,items:page.items.map(adminListSummary),facets:adminCatalogFacets(items),drafts:(drafts.data||[]).filter(isOperationalAdminData)});
  }
  if (section === "courses") {
    const items = await simpleCourses(access.client, access.memberships);
    const id = request.nextUrl.searchParams.get("id"); const query=(request.nextUrl.searchParams.get("q") || "").toLowerCase();
    if (id) {
      const item=items.find(i=>i.id===id);
      const family=adminCourseFamilies(items).find(group=>(group.values.family as {id:string}[]).some(child=>child.id===id));
      return json({item:item?{...item,values:{...item.values,family:family?.values.family}}:null});
    }
    const drafts=await access.client.from("admin_catalog_revisions").select("id,entity_id,entity_type,status,payload").eq("entity_type","COURSE").in("status",["DRAFT","REVIEWED","VERIFIED"]).order("created_at",{ascending:false}).limit(40);
    if(drafts.error)return json({error:"No pudimos cargar los borradores."},503);
    const page=adminCatalogPage(adminCourseFamilies(items),query,state,offset);
    return json({ ...page,items:page.items.map(adminListSummary), drafts:(drafts.data||[]).filter(isOperationalAdminData) });
  }
  if (section === "users") {
    const result = await access.client.rpc("admin_user_directory_v2", { search_text: search.slice(0,160), page_offset: Number(offset||0) });
    return result.error ? json({ error: "No pudimos cargar los usuarios." }, 503) : json({ items: result.data });
  }
  return json({ error: "Sección no disponible." }, 404);
}
export async function POST(request: NextRequest) {
  const raw = await request.text(); if (raw.length>250000) return json({error:"El formulario es demasiado grande."},413);
  let body: Record<string,unknown>; try { body=JSON.parse(raw); } catch { return json({error:"Formulario no válido."},400); }
  const section=body?.module; if (typeof section!=="string" || !(SIMPLE_ADMIN_MODULES as readonly string[]).includes(section)) return json({error:"Sección no válida."},400);
  const access=await requireAdminMode(request,section as SimpleAdminModule);
  if (!access.ok) return json({error:access.error,code:access.code},access.status);
  try {
    if(["inspect","archive-record","activate-record","delete-record"].includes(String(body.operation))){
      const allowed:Record<string,string[]>={courses:["COURSE","TEE"],equipment:["CLUB_EQUIPMENT","SHAFT"],balls:["BALL"],competitions:["COMPETITION"]};
      if(!allowed[section]?.includes(String(body.kind))||typeof body.id!=="string"||body.id.length>240)throw new Error("Registro no válido.");
      const operation=String(body.operation).replace("-record","");
      if(operation!=="inspect"&&body.confirmed!==true)throw new Error("Confirma el cambio antes de continuar.");
      const result=await access.client.rpc("admin_catalog_lifecycle_v3",{kind:body.kind,item_id:body.id,operation,change_reason:body.reason||null});
      if(result.error)throw new Error("No pudimos completar el cambio. El registro y sus históricos se conservan.");
      return json({item:result.data});
    }
    if(body.operation==="competition-status"&&section==="competitions"){
      if(body.confirmed!==true)throw new Error("Confirma el cambio.");
      const result=await access.client.rpc("admin_competition_status_v3",{competition_key:body.id,expected_status:body.expectedStatus,next_status:body.status,change_reason:body.reason});
      if(result.error)throw new Error("No se cambió el torneo. Recarga y comprueba su estado.");
      return json({item:result.data});
    }
    if(body.operation==="draft"&&section==="competitions"){
      const values=body.values as Record<string,unknown>;if(!values||typeof values!=="object"||Array.isArray(values))throw new Error("Revisa la competición.");
      const id=typeof body.id==="string"&&body.id?body.id:crypto.randomUUID();
      const existing=body.id?await access.client.from("admin_catalog_revisions").select("payload").eq("entity_type","COMPETITION").eq("entity_id",id).eq("status","PUBLISHED").order("version",{ascending:false}).limit(1).maybeSingle():null;
      const resume=typeof body.baseRevisionId==="string"?await access.client.from("admin_catalog_revisions").select("payload,entity_id").eq("id",body.baseRevisionId).eq("entity_type","COMPETITION").eq("status","DRAFT").single():null;
      if(resume&&resume.data?.entity_id!==id)return json({error:"Borrador no disponible."},403);
      if(body.id&&!existing?.data&&!resume?.data)return json({error:"Competición no disponible."},403);
      const copy=typeof body.copyFromId==="string"?await access.client.from("admin_catalog_revisions").select("payload").eq("entity_type","COMPETITION").eq("entity_id",body.copyFromId).eq("status","PUBLISHED").order("version",{ascending:false}).limit(1).maybeSingle():null;
      if(copy&&!copy.data)return json({error:"No puedes duplicar este torneo."},403);
      const payload=buildCompetitionPayload({...copy?.data?.payload,...existing?.data?.payload,...resume?.data?.payload,id},values,true);
      if(payload.courseId&&!(await getCourseCatalog(access.client)).courses.some(course=>course.id===payload.courseId&&course.active&&isOperationalAdminData(course)))throw new Error("Selecciona un campo publicado.");
      if(!values.sourceName)throw new Error("Indica la fuente de la información.");
      const result=await access.client.rpc("admin_create_revision_v1",{target_entity_type:"COMPETITION",target_entity_id:id,target_scope_type:"COMPETITION",target_scope_id:id,target_payload:{...payload,dataEnvironment:"PRODUCTION"},target_source_type:"ADMIN_RESEARCH",target_source_name:values.sourceName,target_source_url:values.sourceUrl||null,target_provenance_status:values.verifiedAt?"VERIFIED":"REPORTED",target_verified_at:values.verifiedAt||null,target_confidence:null,target_notes:null});if(result.error)throw new Error("No se guardó la competición.");return json({item:result.data},201);
    }
    if(body.operation==="draft"&&(section==="equipment"||section==="balls")){
      const kind=body.kind as AdminEntityType;if(!(section==="balls"?["BALL"]:["CLUB_EQUIPMENT","SHAFT"]).includes(kind)||!body.values||typeof body.values!=="object"||Array.isArray(body.values))throw new Error("Revisa el equipo seleccionado.");
      const id=typeof body.id==="string"&&body.id?body.id:`equipment-${crypto.randomUUID()}`;
      const existing=(await simpleEquipment(access.memberships,section==="balls")).find(i=>i.id===id&&i.kind===kind);
      if(body.id&&!existing)return json({error:"Este equipo no está disponible para tu cuenta."},403);
      const copy=typeof body.copyFromId==="string"?(await simpleEquipment(access.memberships,section==="balls")).find(i=>i.id===body.copyFromId&&i.kind===kind):null;
      if(body.copyFromId&&!copy)return json({error:"No puedes duplicar este registro."},403);
      const payload=buildEquipmentPayload(existing?.values||{...copy?.values,id},body.values as Record<string,unknown>,kind);const issues=equipmentPayloadIssues(payload,kind,id);if(issues.length)throw new Error(issues.join(" "));
      const result=await access.client.rpc("admin_create_revision_v1",{target_entity_type:kind,target_entity_id:id,target_scope_type:"CATALOG",target_scope_id:"equipment",target_payload:{...payload,dataEnvironment:"PRODUCTION"},target_source_type:payload.sourceType,target_source_name:payload.sourceName,target_source_url:payload.sourceUrl,target_provenance_status:payload.verifiedAt?"VERIFIED":"REPORTED",target_verified_at:payload.verifiedAt,target_confidence:null,target_notes:null});
      if(result.error)throw new Error("No se guardó el borrador de equipo.");return json({item:result.data},201);
    }
    if (body.operation==="draft" && section==="courses") {
      if (!body.values || typeof body.values!=="object" || Array.isArray(body.values)) throw new Error("Revisa el formulario.");
      const id = typeof body.id==="string" && body.id ? body.id : `course-${crypto.randomUUID()}`;
      const existing = (await simpleCourses(access.client,access.memberships)).find(i=>i.id===id);
      if (body.id && !existing) return json({error:"El campo no está disponible para tu cuenta."},403);
      if (!access.memberships.some(m=>membershipAllows(m,{entityType:"COURSE",scopeType:"COURSE",scopeId:id},"CREATE_DRAFT"))) return json({error:"No puedes agregar este campo."},403);
      const base = existing?.values || {club:{id:`club-${crypto.randomUUID()}`},course:{id},tees:[],holes:[],teeHoleYardages:[]};
      const payload=buildCoursePayload(base,body.values as Record<string,unknown>);
      const issues=coursePayloadIssues(payload,id); if (issues.length) throw new Error(issues.join(" "));
      const values=body.values as Record<string,unknown>; const sourceName=String(values.sourceName || "").trim(); const sourceUrl=String(values.sourceUrl || "").trim() || null; const verifiedAt=String(values.verifiedAt || "").trim() || null;
      if (!sourceName || sourceName.length>240 || sourceUrl && !/^https:\/\//.test(sourceUrl) || verifiedAt && !Number.isFinite(Date.parse(verifiedAt))) throw new Error("Revisa la fuente y la fecha de verificación.");
      const result=await access.client.rpc("admin_create_revision_v1",{target_entity_type:"COURSE",target_entity_id:id,target_scope_type:"COURSE",target_scope_id:id,target_payload:{...payload,sourceName,sourceUrl,verifiedAt,dataEnvironment:"PRODUCTION"},target_source_type:"ADMIN_RESEARCH",target_source_name:sourceName,target_source_url:sourceUrl,target_provenance_status:verifiedAt?"VERIFIED":"REPORTED",target_verified_at:verifiedAt,target_confidence:null,target_notes:null});
      if (result.error) throw new Error("No se guardó el borrador. Comprueba la disponibilidad del sistema.");
      return json({item:result.data,changes:humanChanges(base,payload)},201);
    }
    if (["preview","publish","archive"].includes(String(body.operation))) {
      if (typeof body.revisionId!=="string" || !/^[\da-f-]{36}$/i.test(body.revisionId)) throw new Error("El borrador no es válido.");
      const candidate=await access.client.from("admin_catalog_revisions").select("*").eq("id",body.revisionId).single(); const row=candidate.data;
      const types: Record<string,string[]>={courses:["COURSE","LOCAL_RULE_SET"],equipment:["CLUB_EQUIPMENT","SHAFT"],balls:["BALL"],competitions:["COMPETITION"]};
      if (!row || !types[section]?.includes(row.entity_type) || !isOperationalAdminData(row) || !access.memberships.some(m=>membershipAllows(m,{entityType:row.entity_type as AdminEntityType,scopeType:row.scope_type,scopeId:row.scope_id},body.operation==="publish"?"PUBLISH":"READ"))) return json({error:"No tienes permiso sobre este borrador."},403);
      if (body.operation==="preview") {
        if(row.entity_type==="COMPETITION"){const issues=competitionPayloadIssues(row.payload,row.entity_id);if(issues.length)throw new Error("Completa el borrador antes de publicar: "+issues.join(" "));}
        const prior=await access.client.from("admin_catalog_revisions").select("payload").eq("entity_type",row.entity_type).eq("entity_id",row.entity_id).eq("status","PUBLISHED").order("version",{ascending:false}).limit(1).maybeSingle();
        if(prior.error)throw new Error("No pudimos confirmar la versión actual.");
        let previous:unknown=prior.data?.payload;
        if(!previous&&row.entity_type==="COURSE")previous=(await simpleCourses(access.client,access.memberships)).find(i=>i.id===row.entity_id)?.values;
        if(!previous&&["CLUB_EQUIPMENT","SHAFT","BALL"].includes(row.entity_type))previous=(await simpleEquipment(access.memberships,row.entity_type==="BALL")).find(i=>i.id===row.entity_id)?.values;
        const result=await access.client.rpc("admin_prepare_revision_v1",{revision_id:row.id}); if (result.error) throw new Error("No pudimos preparar la vista previa.");
        return json({preview:result.data,changes:humanChanges(previous || {},row.payload)});
      }
      const reason=String(body.reason || "").trim(); if (reason.length<3 || reason.length>1000) throw new Error("Describe el motivo del cambio.");
      if (body.operation==="archive") {
        const result=await access.client.rpc("admin_transition_revision_v1",{revision_id:row.id,next_status:"ARCHIVED",transition_reason:reason,request_id:crypto.randomUUID()}); if (result.error) throw new Error("No se archivó el borrador."); return json({item:result.data});
      }
      if (body.confirmed!==true || typeof body.previewHash!=="string" || !/^[\da-f]{64}$/i.test(body.previewHash)) throw new Error("Confirma la vista previa antes de publicar.");
      for (const status of row.status==="DRAFT" ? ["REVIEWED","VERIFIED"] : row.status==="REVIEWED" ? ["VERIFIED"] : []) {
        const transition=await access.client.rpc("admin_transition_revision_v1",{revision_id:row.id,next_status:status,transition_reason:reason,request_id:crypto.randomUUID()}); if (transition.error) throw new Error("Falta evidencia verificada para publicar.");
      }
      const result=await access.client.rpc("admin_publish_revision_v1",{revision_id:row.id,expected_preview_hash:body.previewHash,publish_reason:reason,request_id:crypto.randomUUID()}); if (result.error) throw new Error("No se publicó. Genera otra vista previa y revisa los cambios.");
      return json({item:result.data});
    }
    return json({error:"Operación no disponible."},400);
  } catch (error) { return json({error:error instanceof Error?error.message:"No se completó la operación."},400); }
}
