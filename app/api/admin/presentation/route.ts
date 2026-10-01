import { NextRequest,NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { BET_REGISTRY } from "../../../../lib/bets/registry";
import { humanChanges,safeFields,type AdminField } from "../../../../lib/admin-simple-catalog";
export const dynamic="force-dynamic";const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});
const content=[{id:"coach_ball_fit",title:"Ball Fit",body:"Encuentra tu bola con tus datos y preferencias."},{id:"coach_launch_monitor",title:"Launch Monitor",body:"Captura y analiza tus mediciones."},{id:"home_empty_feed",title:"Tu comunidad empieza aquí",body:"Tu actividad y la de tus amigos aparecerán aquí."}];
export async function GET(request:NextRequest){
  const section=request.nextUrl.searchParams.get("module")==="content"?"content":"bets";const access=await requireAdminMode(request,section);if(!access.ok)return json({error:access.error},access.status);
  const result=await access.client.from("admin_visual_versions").select("id,target_key,version,status,values:payload").eq("target_kind",section==="bets"?"BET":"CONTENT").order("version",{ascending:false});if(result.error)return json({error:"Este módulo requiere activar su publicación en la base independiente."},503);
  const current=new Map((result.data||[]).filter(r=>r.status==="PUBLISHED").map(r=>[r.target_key,r]));
  const records=section==="bets"?BET_REGISTRY.map((b,index)=>({id:b.id,title:b.label,description:b.description,instructions:"",icon:b.icon,order:index*10,active:true})):content.map(c=>({...c,active:true}));
  return json({items:records.map(r=>({id:r.id,version:current.get(r.id)?.version||0,values:{...r,...current.get(r.id)?.values}})),drafts:(result.data||[]).filter(r=>["DRAFT","VERIFIED"].includes(r.status))});
}
export async function POST(request:NextRequest){
  const raw=await request.text();if(raw.length>50000)return json({error:"Formulario demasiado grande."},413);
  try{const body=JSON.parse(raw);if(!["bets","content"].includes(body.module))return json({error:"Módulo no válido."},400);const access=await requireAdminMode(request,body.module);if(!access.ok)return json({error:access.error},access.status);
    if(body.operation==="draft"){
      if(!(body.module==="bets"?BET_REGISTRY:content).some(r=>r.id===body.id))throw new Error("Crear esta función requiere desarrollo.");
      const fields:AdminField[]=[{key:"title",label:"Nombre mostrado",required:true},{key:"active",label:"Visible / activo",type:"checkbox"},...(body.module==="bets"?[{key:"description",label:"Descripción",type:"textarea" as const},{key:"instructions",label:"Instrucciones",type:"textarea" as const},{key:"icon",label:"Icono"},{key:"order",label:"Orden",type:"number" as const,min:0,max:1000}]:[{key:"body",label:"Texto",type:"textarea" as const}])];
      const values=safeFields(body.values||{},fields);const result=await access.client.rpc("admin_save_visual_draft_v2",{content_kind:body.module==="bets"?"BET":"CONTENT",content_key:body.id,content_values:values,expected_version:body.version});if(result.error)throw new Error("No se guardó el borrador. Recarga para comprobar su versión.");return json({item:result.data},201);
    }
    const candidate=await access.client.from("admin_visual_versions").select("id,target_kind").eq("id",body.id).single();if(!candidate.data||candidate.data.target_kind!==(body.module==="bets"?"BET":"CONTENT"))return json({error:"Borrador no disponible."},403);
    if(body.operation==="preview"){const result=await access.client.rpc("admin_preview_visual_v2",{visual_id:body.id});if(result.error)throw new Error("No se preparó la vista previa.");return json({preview:result.data,changes:humanChanges(result.data.before,result.data.after)});}
    if(body.operation==="publish"&&body.confirmed===true){const result=await access.client.rpc("admin_publish_visual_v2",{visual_id:body.id,expected_hash:body.previewHash,publish_reason:body.reason});if(result.error)throw new Error("No se publicó. Revisa la vista previa y la versión actual.");return json({item:result.data});}
    throw new Error("Operación no disponible.");
  }catch(e){return json({error:e instanceof Error?e.message:"No se completó la operación."},400);}
}
