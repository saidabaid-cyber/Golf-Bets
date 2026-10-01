import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { SIMPLE_ADMIN_MODULES, type SimpleAdminModule } from "../../../../lib/admin-mode";
import { simpleCourses, simpleEquipment } from "../../../../lib/admin-simple-catalog.server";
import { buildCoursePayload, buildEquipmentPayload, humanChanges } from "../../../../lib/admin-simple-catalog";
import { coursePayloadIssues, equipmentPayloadIssues } from "../../../../lib/admin-payload-validation";
import { membershipAllows, type AdminEntityType } from "../../../../lib/admin-control-center";
import { isOperationalAdminData } from "../../../../lib/admin-data-environment";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const module = request.nextUrl.searchParams.get("module");
  if (module && !(SIMPLE_ADMIN_MODULES as readonly string[]).includes(module)) return json({ error: "Sección no válida." }, 400);
  const access = await requireAdminMode(request, module as SimpleAdminModule | undefined);
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  if (!module) return json({ role: access.role, modules: access.modules });
  if(module==="equipment"||module==="balls"){
    const items=await simpleEquipment(access.memberships,module==="balls");const q=(request.nextUrl.searchParams.get("q")||"").toLowerCase();
    const drafts=await access.client.from("admin_catalog_revisions").select("id,entity_id,entity_type,status,payload").in("entity_type",module==="balls"?["BALL"]:["CLUB_EQUIPMENT","SHAFT"]).in("status",["DRAFT","REVIEWED","VERIFIED"]).order("created_at",{ascending:false}).limit(40);
    if(drafts.error)return json({error:"No pudimos cargar los borradores."},503);
    return json({items:items.filter(i=>`${i.title} ${i.subtitle}`.toLowerCase().includes(q)),drafts:(drafts.data||[]).filter(isOperationalAdminData)});
  }
  if (module === "courses") {
    const items = await simpleCourses(access.client, access.memberships);
    const id = request.nextUrl.searchParams.get("id"); const query=(request.nextUrl.searchParams.get("q") || "").toLowerCase();
    if (id) return json({ item: items.find(i=>i.id===id) || null });
    return json({ items: items.filter(i=>`${i.title} ${i.subtitle}`.toLowerCase().includes(query)), drafts: (await access.client.from("admin_catalog_revisions").select("id,entity_id,entity_type,status,payload").eq("entity_type","COURSE").in("status",["DRAFT","REVIEWED","VERIFIED"]).order("created_at",{ascending:false}).limit(40)).data || [] });
  }
  if (module === "users") {
    const result = await access.client.rpc("admin_user_directory_v2", { search_text: (request.nextUrl.searchParams.get("q") || "").slice(0,160), page_offset: 0 });
    return result.error ? json({ error: "No pudimos cargar los usuarios." }, 503) : json({ items: result.data });
  }
  return json({ error: "Sección no disponible." }, 404);
}
export async function POST(request: NextRequest) {
  const raw = await request.text(); if (raw.length>250000) return json({error:"El formulario es demasiado grande."},413);
  let body: Record<string,unknown>; try { body=JSON.parse(raw); } catch { return json({error:"Formulario no válido."},400); }
  const module=body?.module; if (typeof module!=="string" || !(SIMPLE_ADMIN_MODULES as readonly string[]).includes(module)) return json({error:"Sección no válida."},400);
  const access=await requireAdminMode(request,module as SimpleAdminModule);
  if (!access.ok) return json({error:access.error,code:access.code},access.status);
  try {
    if(body.operation==="draft"&&(module==="equipment"||module==="balls")){
      const kind=body.kind as AdminEntityType;if(!(module==="balls"?["BALL"]:["CLUB_EQUIPMENT","SHAFT"]).includes(kind)||!body.values||typeof body.values!=="object"||Array.isArray(body.values))throw new Error("Revisa el equipo seleccionado.");
      const id=typeof body.id==="string"&&body.id?body.id:`equipment-${crypto.randomUUID()}`;
      const existing=(await simpleEquipment(access.memberships,module==="balls")).find(i=>i.id===id&&i.kind===kind);
      if(body.id&&!existing)return json({error:"Este equipo no está disponible para tu cuenta."},403);
      const payload=buildEquipmentPayload(existing?.values||{id},body.values as Record<string,unknown>,kind);const issues=equipmentPayloadIssues(payload,kind,id);if(issues.length)throw new Error(issues.join(" "));
      const result=await access.client.rpc("admin_create_revision_v1",{target_entity_type:kind,target_entity_id:id,target_scope_type:"CATALOG",target_scope_id:"equipment",target_payload:{...payload,dataEnvironment:"PRODUCTION"},target_source_type:payload.sourceType,target_source_name:payload.sourceName,target_source_url:payload.sourceUrl,target_provenance_status:payload.verifiedAt?"VERIFIED":"REPORTED",target_verified_at:payload.verifiedAt,target_confidence:null,target_notes:null});
      if(result.error)throw new Error("No se guardó el borrador de equipo.");return json({item:result.data},201);
    }
    if (body.operation==="draft" && module==="courses") {
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
      if (!row || !types[module]?.includes(row.entity_type) || !isOperationalAdminData(row) || !access.memberships.some(m=>membershipAllows(m,{entityType:row.entity_type as AdminEntityType,scopeType:row.scope_type,scopeId:row.scope_id},body.operation==="publish"?"PUBLISH":"READ"))) return json({error:"No tienes permiso sobre este borrador."},403);
      if (body.operation==="preview") {
        const prior=await access.client.from("admin_catalog_revisions").select("payload").eq("entity_type",row.entity_type).eq("entity_id",row.entity_id).eq("status","PUBLISHED").order("version",{ascending:false}).limit(1).maybeSingle();
        const result=await access.client.rpc("admin_prepare_revision_v1",{revision_id:row.id}); if (result.error) throw new Error("No pudimos preparar la vista previa.");
        return json({preview:result.data,changes:humanChanges(prior.data?.payload || {},row.payload)});
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
