import { NextRequest,NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { BET_REGISTRY } from "../../../../lib/bets/registry";
import { betVariantCapability,validatedBetVariant } from "../../../../lib/admin-bet-variants";
import { humanChanges } from "../../../../lib/admin-simple-catalog";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});
export async function GET(request:NextRequest){
 const access=await requireAdminMode(request,"bets");if(!access.ok)return json({error:access.error},access.status);
 const offset=Number(request.nextUrl.searchParams.get("offset")||0);if(!Number.isInteger(offset)||offset<0||offset>100000)return json({error:"Página no válida."},400);
 const published=await access.client.from("admin_bet_variant_versions").select("id,variant_id,version,status,payload",{count:"exact"}).eq("status","PUBLISHED").order("published_at",{ascending:false}).range(offset,offset+39);
 const drafts=await access.client.from("admin_bet_variant_versions").select("id,variant_id,version,base_version,status,payload").eq("status","DRAFT").order("created_at",{ascending:false}).limit(40);
 if(published.error||drafts.error)return json({error:"No pudimos cargar las apuestas."},503);
 return json({items:published.data,drafts:drafts.data,total:published.count,engines:BET_REGISTRY.flatMap(engine=>{const capability=betVariantCapability(engine.id);return capability?[{id:engine.id,label:engine.label}]:[];})});
}
export async function POST(request:NextRequest){
 const access=await requireAdminMode(request,"bets");if(!access.ok)return json({error:access.error},access.status);
 const raw=await request.text();if(raw.length>30000)return json({error:"Formulario demasiado grande."},413);
 try{const body=JSON.parse(raw);if(!["draft","preview","publish","archive"].includes(body.operation))throw new Error("Operación no válida.");
  const input=body.operation==="draft"?validatedBetVariant(body.values||{}):null;
  if(body.operation==="draft"&&body.copyFromId){const copy=await access.client.from("admin_bet_variant_versions").select("payload").eq("variant_id",body.copyFromId).eq("status","PUBLISHED").maybeSingle();if(!copy.data||copy.data.payload.engine!==input?.engine)throw new Error("La copia debe conservar el mismo tipo de apuesta.");}
  const result=await access.client.rpc("admin_bet_variant_operation_v3",{variant_key:body.id||null,operation:body.operation,input_values:input,expected_version:body.version??0,revision_id:body.revisionId||null,expected_hash:body.previewHash||null,change_reason:body.reason||null});
  if(result.error)throw new Error("No se guardó la apuesta. Revisa las opciones y recarga su versión actual.");
  return json(body.operation==="preview"?{preview:result.data,changes:humanChanges(result.data.before,result.data.after)}:{item:result.data});
 }catch(error){return json({error:error instanceof Error?error.message:"No se completó el cambio."},400);}
}
