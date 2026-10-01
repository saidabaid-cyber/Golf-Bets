import test from "node:test";
import assert from "node:assert/strict";
import { physicalCourseOperationHoles } from "../lib/admin-course-operation-references";

function layout(count = 18) {
  return {
    visible: Array.from({length:count},(_,i)=>({id:`course:hole:${i+1}`,courseId:"course",holeNumber:i+1,par:4,strokeIndex:count-i})),
    physical: Array.from({length:count},(_,i)=>({id:`physical-${i+1}`,course_id:"course",hole_number:i+1,par:4})),
  };
}
test("scorecard/configuration composition resolves display references to persisted IDs without altering facts or source data",()=>{
  for(const count of [9,18]) {
    const {visible,physical}=layout(count);
    const resolved=physicalCourseOperationHoles("course",count,visible,[...physical].reverse());
    assert.deepEqual(resolved.map(h=>h.id),physical.map(h=>h.id));
    assert.deepEqual(resolved.map(h=>h.strokeIndex),visible.map(h=>h.strokeIndex));
    assert.equal(visible[0].id,"course:hole:1");
    assert.equal(physical[0].id,"physical-1");
  }
});
test("unmaterialized and incomplete layouts fail closed instead of fabricating IDs",()=>{
  const {visible,physical}=layout();
  for(const [count,v,p] of [[18,visible,[]],[18,visible.slice(1),physical],[18,visible,physical.slice(1)],[17,visible,physical]] as const)
    assert.throws(()=>physicalCourseOperationHoles("course",count,v,p),/hoyos físicos registrados/);
});
test("physical references cannot cross layouts or hide duplicates, out-of-range holes and changed physical par",()=>{
  const {visible,physical}=layout();
  assert.throws(()=>physicalCourseOperationHoles("different",18,visible,physical),/hoyos físicos registrados/);
  assert.throws(()=>physicalCourseOperationHoles("course",18,[{...visible[0],courseId:"other"},...visible.slice(1)],physical),/hoyos físicos registrados/);
  assert.throws(()=>physicalCourseOperationHoles("course",18,[visible[1],...visible.slice(1)],physical),/hoyos físicos registrados/);
  for(const changed of [{...physical[0],hole_number:19},{...physical[0],id:physical[1].id},{...physical[0],hole_number:physical[1].hole_number}])
    assert.throws(()=>physicalCourseOperationHoles("course",18,visible,[changed,...physical.slice(1)]),/hoyos físicos registrados/);
  assert.throws(()=>physicalCourseOperationHoles("course",18,[{...visible[0],par:3},...visible.slice(1)],physical),/par publicado no coincide/);
});
