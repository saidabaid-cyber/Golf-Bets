import test from "node:test";
import assert from "node:assert/strict";
import {requestPrefill,requestTargetModule} from "../lib/admin-request-operations";
test("request routing never guesses equipment for unknown requests",()=>{assert.equal(requestTargetModule("COURSE_MISSING"),"courses");assert.equal(requestTargetModule("BALL_MISSING"),"balls");assert.equal(requestTargetModule("SHAFT_MISSING"),"equipment");assert.equal(requestTargetModule("GENERAL"),null);});
test("prefill contains known request information without inventing specifications",()=>{const seed={id:"request",title:"Campo solicitado",description:"Comentario",contextual_category:"COURSE"};const values=requestPrefill(seed,"courses");assert.equal(values.name,seed.title);assert.equal(values.requestId,seed.id);assert.ok(!("rating" in values));assert.ok(!("verifiedAt" in values));});
