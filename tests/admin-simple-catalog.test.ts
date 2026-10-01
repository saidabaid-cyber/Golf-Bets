import test from "node:test";
import assert from "node:assert/strict";
import { buildCoursePayload, humanChanges, safeFields, COURSE_FIELDS } from "../lib/admin-simple-catalog";
import { coursePayloadIssues } from "../lib/admin-payload-validation";
const base={club:{id:"club-a",name:"Club",city:"Ciudad"},course:{id:"course-a",name:"Campo",holes:18,active:true},tees:[{id:"tee-a",name:"Azul",rating:72,slope:136,active:true}],holes:[],teeHoleYardages:[]};
const values={name:"Campo",clubName:"Club",holeCount:"18",active:true,tees:[{...base.tees[0],rating:72.1,slope:134}]};
test("course edits preserve IDs and existing scorecard references, rating/slope validate together",()=>{const payload=buildCoursePayload(base,values);assert.equal(payload.course.id,"course-a");assert.equal(payload.tees[0].id,"tee-a");assert.deepEqual(coursePayloadIssues(payload,"course-a"),[]);assert.ok(humanChanges(base,payload).some(c=>c.label.includes("Slope")&&c.before==="136"&&c.after==="134"));});
test("forged or removed historically referenced tees and invalid coordinates are rejected",()=>{assert.throws(()=>buildCoursePayload(base,{...values,tees:[]}),/Desactiva/);assert.throws(()=>buildCoursePayload(base,{...values,tees:[{...base.tees[0],id:"other-course-tee"}]}),/no pertenece/);assert.throws(()=>safeFields({...values,latitude:200},COURSE_FIELDS),/Latitud/);});
test("new record preview spells out actual fields instead of raw JSON",()=>{const changes=humanChanges({},base);assert.ok(changes.some(c=>c.label.includes("Rating")&&c.after==="72"));assert.ok(!changes.some(c=>c.label.endsWith("id")));});
