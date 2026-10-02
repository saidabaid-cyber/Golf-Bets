import test from "node:test";
import assert from "node:assert/strict";
import {buildCompetitionPayload,competitionFormValues,catalogDraftFormValues} from "../lib/admin-simple-catalog";
import {competitionPayloadIssues} from "../lib/admin-payload-validation";
test("tournament drafts can be incomplete; publication stays strict",()=>{
 const id="dc2a60f1-1ce9-409b-b265-487003ed585b";
 const payload=buildCompetitionPayload({id},{name:"Borrador",type:"TOURNAMENT",visibility:"PRIVATE"},true);
 assert.equal(payload.name,"Borrador");assert.ok(competitionPayloadIssues(payload,id).length);
 assert.throws(()=>buildCompetitionPayload({id},{name:"",type:"TOURNAMENT",visibility:"PRIVATE"}));
 assert.throws(()=>buildCompetitionPayload({id},{handicapPercentage:101},true));
});
test("resume and duplicate preserve safe settings and reject new engine data",()=>{
 const original={id:"event",engineContract:{version:1},rules:[{category:"SCORING",title:"Original",body:"Existing",engineContract:{version:1}}]};
 const payload=buildCompetitionPayload(original,{name:"Updated",ruleBody:"Information",type:"TOURNAMENT",visibility:"PRIVATE",sourceName:"Verified",engineContract:{code:"invalid"}},true);
 assert.deepEqual(payload.engineContract,original.engineContract);
 assert.equal(competitionFormValues(payload).ruleBody,"Information");assert.equal((payload.rules as unknown[]).length,2);
});

test("wizard dates serialize persistently and survive a resumed draft",()=>{const original={id:"event",startsAt:"2026-10-03T14:00:00.000Z",endsAt:"2026-10-03T20:00:00.000Z"};const form=competitionFormValues(original);const result=buildCompetitionPayload(original,{...form,startsAt:"2026-10-03T14:00",endsAt:"2026-10-03T20:00",name:"QA",type:"TOURNAMENT",visibility:"PRIVATE"},true);assert.equal(result.startsAt,original.startsAt);assert.equal(result.endsAt,original.endsAt);assert.throws(()=>buildCompetitionPayload(original,{startsAt:"invalid"},true));});

test("reviewed catalog drafts reopen with supported fields and retained references",()=>{const course={club:{id:"club",name:"Club",city:"Puebla"},course:{id:"course",clubId:"club",name:"Campo",holes:9,active:true},tees:[{id:"tee",name:"Blue",active:true}]};const form=catalogDraftFormValues("COURSE",course);assert.equal(form.name,"Campo");assert.equal(form.holeCount,"9");assert.deepEqual(form.tees,course.tees);const equipment=catalogDraftFormValues("CLUB_EQUIPMENT",{id:"club",model:"Model",lofts:[10,12],handedness:["RH"],aliases:["Alias"]});assert.deepEqual(equipment.loftsText,[10,12]);assert.deepEqual(equipment.handsText,["RH"]);assert.equal(equipment.aliasesText,"Alias");});
