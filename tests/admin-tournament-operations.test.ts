import test from "node:test";
import assert from "node:assert/strict";
import {buildCompetitionPayload,competitionFormValues} from "../lib/admin-simple-catalog";
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
