import {NextRequest,NextResponse} from "next/server";
import {requireAdminMode} from "../../../../lib/admin-mode.server";
import {humanChanges} from "../../../../lib/admin-simple-catalog";
import {auditFilters} from "../../../../lib/admin-audit-filters";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const access=await requireAdminMode(request,"audit");const headers={"cache-control":"private, no-store"};
 if(!access.ok)return NextResponse.json({error:access.error},{status:access.status,headers});
 try{
 const filters=auditFilters(request.nextUrl.searchParams);
 let query=access.client.from("admin_audit_log").select("id,actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason,created_at").order("created_at",{ascending:false}).range(filters.offset,filters.offset+39);
 if(filters.actor)query=query.eq("actor_id",filters.actor);if(filters.entity)query=query.eq("entity_type",filters.entity);if(filters.action)query=query.ilike("action","%"+filters.action+"%");if(filters.from)query=query.gte("created_at",filters.from);if(filters.until)query=query.lt("created_at",filters.until);
 const [result,directory]=await Promise.all([query,access.client.rpc("admin_user_directory_v2",{search_text:"",page_offset:0})]);
 if(result.error)throw new Error("No pudimos cargar la auditoría.");
 const actors=(directory.data||[]).filter((user:{role:string})=>user.role!=="PLAYER").map((user:{user_id:string;display_name:string;email:string})=>({id:user.user_id,name:user.display_name||user.email}));
 const names=new Map(actors.map((actor:{id:string;name:string})=>[actor.id,actor.name]));
 return NextResponse.json({actors,items:(result.data||[]).map(row=>({id:row.id,actor:names.get(row.actor_id)||"Administrador",role:row.actor_role,action:row.action,entity:row.entity_type,title:row.after_state?.name||row.after_state?.title||row.after_state?.course?.name||row.before_state?.name||"Cambio administrativo",reason:row.reason,date:row.created_at,changes:humanChanges(row.before_state,row.after_state)}))},{headers});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No pudimos cargar la auditoría."},{status:400,headers});}
}