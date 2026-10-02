import {buildCoursePayload} from "../lib/admin-simple-catalog";
import test from "node:test";
import assert from "node:assert/strict";
import { adminCurrentDrafts, adminLatestDrafts, adminCourseFamilies, adminListSummary, filterAdminCatalog, structuredNumbers } from "../lib/admin-operations";
import type { AdminRecord } from "../lib/admin-simple-catalog";
import { buildEquipmentPayload } from "../lib/admin-simple-catalog";
const item=(id:string,title:string,values:Record<string,unknown>):AdminRecord=>({id,title,values,subtitle:"Puebla · 18 hoyos",kind:"COURSE",active:true});
test("course and its scorecard are one family without changing historical IDs",()=>{
 const rows=[item("course","Club",{club:{id:"club",name:"Club"}}),item("card","Tarjeta actual",{club:{id:"club",name:"Club"}}),item("other","Otro",{club:{id:"other",name:"Otro"}})];
 const groups=adminCourseFamilies(rows);assert.equal(groups.length,2);assert.equal(groups[0].id,"course");assert.deepEqual(groups[0].values.family,[{id:"course",title:"Club",active:true},{id:"card",title:"Tarjeta actual",active:true}]);assert.equal(rows[1].id,"card");
});
test("summaries omit scorecard and evidence while details retain them",()=>{const full=item("a","Modelo",{brand:"Marca",holes:[{par:4}],sourceUrl:"https://example.com",metadata:{provider:"x"}});assert.equal(adminListSummary(full).values.holes,undefined);assert.ok(full.values.holes);});
test("catalog facets are exact and numeric arrays cannot smuggle invalid specs",()=>{const rows=[item("a","A",{brand:"Marca",year:2025}),item("b","B",{brand:"Otra",year:2025})];assert.equal(filterAdminCatalog(rows,{brand:"Marca",year:"2025"}).length,1);assert.deepEqual(structuredNumbers([56,"56",60],0,90),[56,60]);assert.throws(()=>structuredNumbers(["NaN"],0,90));assert.throws(()=>structuredNumbers([200],0,90));});
test("structured equipment controls persist arrays and preserve source identity",()=>{
 const values={brand:"Marca",model:"Modelo",category:"WEDGE",active:true,bagEligible:true,fitEligible:false,sourceType:"ADMIN_RESEARCH",loftsText:[56,60],handsText:["RH","LH"],year:2025};
 const result=buildEquipmentPayload({id:"new-item",variants:[{loft:56,bounce:10}]},values,"CLUB_EQUIPMENT");
 assert.deepEqual(result.lofts,[56,60]);assert.deepEqual(result.handedness,["RH","LH"]);assert.equal(result.id,"new-item");assert.throws(()=>buildEquipmentPayload({id:"x"},{...values,handsText:["script"]},"CLUB_EQUIPMENT"));
});

test("new course preserves its parent club for persistent publication",()=>{
 const payload=buildCoursePayload({club:{id:"new-club"},course:{id:"new-course"},tees:[],holes:[]},{name:"New",clubName:"New club",holeCount:"9",active:true});
 assert.equal(payload.course.clubId,"new-club");
});

test("daily draft list selects the latest version and retains the immutable history",()=>{const rows=[{entity_type:"COURSE",entity_id:"a",version:1},{entity_type:"COURSE",entity_id:"a",version:3},{entity_type:"BALL",entity_id:"a",version:2}];assert.deepEqual(adminLatestDrafts(rows),[rows[1],rows[2]]);assert.equal(rows.length,3);});

test("published versions suppress obsolete drafts without archiving or deleting them",()=>{const drafts=[{entity_type:"BALL",entity_id:"a",version:2},{entity_type:"BALL",entity_id:"b",version:4}];assert.deepEqual(adminCurrentDrafts(drafts,[{entity_type:"BALL",entity_id:"a",version:3}]),[drafts[1]]);assert.equal(drafts.length,2);});
