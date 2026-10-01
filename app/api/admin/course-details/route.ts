import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { simpleCourses } from "../../../../lib/admin-simple-catalog.server";
import { membershipAllows } from "../../../../lib/admin-control-center";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});
export async function GET(request:NextRequest){
  const access=await requireAdminMode(request,"courses");if(!access.ok)return json({error:access.error},access.status);
  const courseId=request.nextUrl.searchParams.get("courseId")||"";
  if(!access.memberships.some(m=>membershipAllows(m,{entityType:"COURSE_CONFIGURATION",scopeType:"COURSE",scopeId:courseId},"READ")))return json({error:"No tienes permiso para este campo."},403);
  const [profiles,configurations,rules]=await Promise.all([
    access.client.from("course_scorecard_profiles").select("id,name,status,active,provenance,course_scorecard_profile_tees(*),course_scorecard_profile_holes(*)").eq("course_id",courseId).order("created_at",{ascending:false}).limit(40),
    access.client.from("course_configurations").select("id,name,status,effective_from,effective_until,course_configuration_holes(*)").eq("course_id",courseId).order("created_at",{ascending:false}).limit(40),
    access.client.from("admin_catalog_revisions").select("id,entity_id,status,payload").eq("entity_type","LOCAL_RULE_SET").eq("scope_id",courseId).in("status",["DRAFT","REVIEWED","VERIFIED","PUBLISHED"]).order("version",{ascending:false}).limit(40),
  ]);
  if([profiles,configurations,rules].some(r=>r.error))return json({error:"No pudimos cargar la operación del campo."},503);
  return json({profiles:profiles.data,configurations:configurations.data,rules:rules.data});
}
export async function POST(request:NextRequest){
  const access=await requireAdminMode(request,"courses");if(!access.ok)return json({error:access.error},access.status);
  const raw=await request.text();if(raw.length>150000)return json({error:"Formulario demasiado grande."},413);
  try{
    const body=JSON.parse(raw);const courseId=String(body.courseId||"");
    if(!access.memberships.some(m=>membershipAllows(m,{entityType:body.kind==="rules"?"LOCAL_RULE_SET":"COURSE_CONFIGURATION",scopeType:"COURSE",scopeId:courseId},"CREATE_DRAFT")))return json({error:"No tienes permiso para este campo."},403);
    const course=(await simpleCourses(access.client,access.memberships)).find(c=>c.id===courseId);if(!course)throw new Error("El campo no está disponible.");
    const values=body.values||{};const name=String(values.name||"").trim();const reason=String(body.reason||"").trim();
    if(body.operation==="draft"){
      if(!name||name.length>200||!String(values.sourceName||"").trim())throw new Error("Indica un nombre y fuente de información.");
      const baseHoles=course.values.holes as Record<string,unknown>[];const baseTees=course.values.tees as Record<string,unknown>[];
      if(body.kind==="profiles"){
        const result=await access.client.rpc("admin_create_scorecard_profile_v1",{profile_payload:{courseId,name,provenance:"ADMIN_VERIFIED",sourceProvider:values.sourceName,verifiedAt:values.verifiedAt||null,evidence:[{sourceName:values.sourceName,sourceUrl:values.sourceUrl||null}],tees:baseTees.map(t=>({teeId:t.id,ratingGender:t.category||"UNSPECIFIED",par:t.par||null,courseRating:t.rating||null,slopeRating:t.slope||null,totalYards:t.totalYards||null})),holes:baseHoles.map(h=>({holeId:h.id,holeNumber:h.holeNumber,strokeIndex:h.strokeIndex,ratingGender:"UNSPECIFIED"})),reason:"Nueva versión visual de tarjeta"}});
        if(result.error)throw new Error("No se guardó la tarjeta. Comprueba que el campo esté publicado y completo.");return json({item:result.data},201);
      }
      if(body.kind==="configurations"){
        if(!Number.isFinite(Date.parse(values.effectiveFrom))||values.effectiveUntil&&Date.parse(values.effectiveUntil)<=Date.parse(values.effectiveFrom)||baseHoles.length!==Number((course.values.course as Record<string,unknown>).holes))throw new Error("Revisa las fechas y la tarjeta completa del campo.");
        const result=await access.client.rpc("admin_create_course_configuration_v1",{configuration_payload:{courseId,scopeType:"COURSE",name,description:String(values.description||"").slice(0,2000),reason:String(values.description||name).slice(0,1000),sourceDescription:values.sourceName,effectiveFrom:values.effectiveFrom,effectiveUntil:values.effectiveUntil||null,dataEnvironment:"PRODUCTION",holes:baseHoles.map((h,i)=>({clientKey:`base-${i+1}`,sequence:i+1,runtimeHoleNumber:h.holeNumber,displayLabel:`Hoyo ${h.holeNumber}`,sourceBaseHoleId:h.id,sourceBaseHoleNumber:h.holeNumber,kind:"BASE",playable:true,temporaryGreen:values.temporaryGreen===true,temporaryTee:values.temporaryTee===true,operationalNote:String(values.description||"").slice(0,2000)}))}});
        if(result.error)throw new Error("No se guardó la configuración.");return json({item:result.data},201);
      }
      if(body.kind==="rules"){
        if(typeof values.body!=="string"||!values.body.trim()||values.body.length>20000)throw new Error("Escribe la regla local.");
        const result=await access.client.rpc("admin_create_revision_v1",{target_entity_type:"LOCAL_RULE_SET",target_entity_id:`local-rules-${crypto.randomUUID()}`,target_scope_type:"COURSE",target_scope_id:courseId,target_payload:{courseId,title:name,rules:[{title:name,body:values.body,shortSummary:values.body.slice(0,300),category:"GENERAL",holeRefs:[],active:true}],sourceName:values.sourceName,sourceUrl:values.sourceUrl||null,verifiedAt:values.verifiedAt||null,dataEnvironment:"PRODUCTION"},target_source_type:"ADMIN_RESEARCH",target_source_name:values.sourceName,target_source_url:values.sourceUrl||null,target_provenance_status:values.verifiedAt?"VERIFIED":"REPORTED",target_verified_at:values.verifiedAt||null,target_confidence:null,target_notes:null});
        if(result.error)throw new Error("No se guardó la regla local.");return json({item:result.data},201);
      }
    }
    if(reason.length<3||reason.length>1000)throw new Error("Indica un motivo para el cambio.");
    if(body.kind==="profiles"){
      const found=await access.client.from("course_scorecard_profiles").select("id,status").eq("id",body.id).eq("course_id",courseId).single();if(!found.data)throw new Error("La tarjeta no está disponible.");
      if(body.operation==="publish"&&body.confirmed===true&&found.data.status==="DRAFT"){const verified=await access.client.rpc("admin_transition_scorecard_profile_v1",{target_profile_id:body.id,target_action:"VERIFY",make_default:false,transition_reason:reason});if(verified.error)throw new Error("Verifica primero la evidencia de la tarjeta.");}
      if(!["publish","archive"].includes(body.operation)||body.confirmed!==true)throw new Error("Confirma el cambio de tarjeta.");
      const result=await access.client.rpc("admin_transition_scorecard_profile_v1",{target_profile_id:body.id,target_action:body.operation==="publish"?"PUBLISH":"ARCHIVE",make_default:body.makeDefault===true,transition_reason:reason});if(result.error)throw new Error("La tarjeta no cambió. Revisa su evidencia y datos.");return json({item:result.data});
    }
    if(body.kind==="configurations"){
      const found=await access.client.from("course_configurations").select("id,status").eq("id",body.id).eq("course_id",courseId).single();if(!found.data)throw new Error("La configuración no está disponible.");
      if(body.operation==="preview"){const result=await access.client.rpc("admin_prepare_course_configuration_v1",{configuration_id:body.id});if(result.error)throw new Error("No pudimos preparar la vista previa.");return json({preview:result.data});}
      if(body.operation==="publish"&&body.confirmed===true){const result=await access.client.rpc("admin_publish_course_configuration_v2",{configuration_id:body.id,expected_preview_hash:body.previewHash,overlap_resolution:"CANCEL",publish_reason:reason,request_id:crypto.randomUUID()});if(result.error)throw new Error("No se publicó. Revisa fechas, vista previa y configuraciones que se superponen.");return json({item:result.data});}
    }
    throw new Error("Operación no disponible.");
  }catch(e){return json({error:e instanceof Error?e.message:"No se completó el cambio."},400);}
}
