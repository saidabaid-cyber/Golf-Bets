import assert from "node:assert/strict";
import test from "node:test";
import { newCoursePlayedEvent } from "../lib/new-course-activity";
import type { RoundSnapshot } from "../lib/types";
const catalog = { clubs: [{id:"home"},{id:"away"}], courses:[{id:"course",clubId:"away"}] };
const round: RoundSnapshot = {id:"r",date:"2026-09-17",completedAt:"2026-09-17T12:00:00Z",lifecycleState:"completed",
  ownerId:"b",ownerName:"B",courseName:"Synthetic QA",teeName:"QA",betResult:0,netResult:0,expenseTotal:0,categoryResults:{},
  expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0},
  players:[{id:"b",accountUserId:"B",name:"B",handicap:0}],order:[1,2,3,4,5,6,7,8,9],
  scores:Object.fromEntries(Array.from({length:9},(_,i)=>[i+1,{b:4}])),
  courseSnapshot:{id:"tee",name:"Synthetic QA",teeName:"QA",holes:[],catalogCourseId:"course",catalogClubId:"away"}};
test("new course is a stable canonical event, absent for missing/home/unplayed/prior courses",()=>{
  const event = newCoursePlayedEvent(round,[round],"B","home",catalog);
  assert.equal(event?.type,"NEW_COURSE_PLAYED");
  assert.deepEqual(newCoursePlayedEvent(round,[round,round],"B","home",catalog),event);
  assert.equal(newCoursePlayedEvent(round,[round],"B","away",catalog),null);
  assert.equal(newCoursePlayedEvent(round,[round],"B",null,catalog),null);
  assert.equal(newCoursePlayedEvent({...round,lifecycleState:"live"},[round],"B","home",catalog),null);
  assert.equal(newCoursePlayedEvent({...round,courseSnapshot:undefined},[round],"B","home",catalog),null);
  assert.equal(newCoursePlayedEvent(round,[round,{...round,id:"older",date:"2026-09-16"}],"B","home",catalog),null);
  assert.equal(newCoursePlayedEvent(round,[round],"outsider","home",catalog),null);
  assert.equal(newCoursePlayedEvent({...round,scores:{}},[round],"B","home",catalog),null);
});
