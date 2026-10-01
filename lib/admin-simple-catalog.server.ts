import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCourseCatalog } from "./course-catalog-provider.server";
import { isOperationalAdminData } from "./admin-data-environment";
import { membershipAllows, type AdminMembership } from "./admin-control-center";
import type { AdminRecord } from "./admin-simple-catalog";
import { loadLayeredEquipmentCatalogs } from "./equipment-catalog-provider.server";
export async function simpleEquipment(memberships:AdminMembership[],balls=false){
  const catalogs=await loadLayeredEquipmentCatalogs();
  const rows=balls?catalogs.balls: [...catalogs.clubs,...catalogs.shafts];
  return rows.filter(isOperationalAdminData).flatMap((entry):AdminRecord[]=>{
    const row=entry as unknown as Record<string,unknown>;const kind=balls?"BALL":"usage" in row?"SHAFT":"CLUB_EQUIPMENT";
    if(!memberships.some(m=>membershipAllows(m,{entityType:kind,scopeType:"CATALOG",scopeId:"equipment"},"READ")))return [];
    const csv=(key:string)=>Array.isArray(row[key])?(row[key] as unknown[]).join(", "):"";
    return [{id:entry.id,title:`${entry.brand} ${entry.model}`,subtitle:[row.generation,row.year,kind==="SHAFT"?"Varilla":row.category].filter(Boolean).join(" · "),active:entry.active,kind,values:{...row,bagEligible:row.bagEligible!==false,fitEligible:row.fitEligible===true,sourceType:row.sourceType||"ADMIN_RESEARCH",aliasesText:csv("aliases"),loftsText:csv("lofts"),handsText:csv("handedness"),weightsText:csv("weightOptions"),flexesText:csv("flexOptions"),torqueText:csv("torqueRange")}}];
  });
}
export async function simpleCourses(client: SupabaseClient, memberships: AdminMembership[]) {
  const catalog = await getCourseCatalog(client, { forceFresh: true });
  const items: AdminRecord[] = catalog.courses.filter(course => isOperationalAdminData(course) && memberships.some(m => membershipAllows(m,{entityType:"COURSE",scopeType:"COURSE",scopeId:course.id},"READ"))).map(course => {
    const club = catalog.clubs.find(c => c.id===course.clubId)!;
    const tees = catalog.tees.filter(t=>t.courseId===course.id).map(t=>({...t,category:t.gender || "",frontRating:t.frontNineRating,backRating:t.backNineRating}));
    const holes = catalog.holes.filter(h=>h.courseId===course.id); const ids = new Set(tees.map(t=>t.id));
    const payload = {club,course,tees,holes,teeHoleYardages:catalog.teeHoleYardages.filter(y=>ids.has(y.teeId)),sourceName:course.sourceName || club.sourceName,sourceUrl:course.sourceUrl || club.sourceUrl,verifiedAt:course.verifiedAt || club.verifiedAt};
    return {id:course.id,title:course.name,subtitle:[club.city,club.stateRegion,`${course.holes} hoyos`].filter(Boolean).join(" · "),active:course.active,kind:"COURSE",version:course.catalogVersion || 0,values:{...payload,name:course.name,clubName:club.name,city:club.city || "",stateRegion:club.stateRegion || "",country:club.country || "",address:club.address || "",latitude:club.latitude,longitude:club.longitude,active:course.active,holeCount:String(course.holes)}};
  });
  return items;
}
