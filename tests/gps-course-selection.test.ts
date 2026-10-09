import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERNAL_GOLF_COURSE_CATALOG, golfCourseSelectionToLegacyCourse } from '../lib/golf-course-directory';
import { beginRoundCourseSelection, completeRoundTeeSelection } from '../lib/round-course-selection';
import { freezeScorecardProfileSelection, roundTeeSelectionId, teeCategoryLabel } from '../lib/course-scorecard-profiles';
import { teeAssignmentSnapshot } from '../lib/player-tee-assignments';
import { normalizeRoundSetupCourseIdentity, resolveManualRoundCourseState } from '../lib/backyard-ai/runtime/manual-course-focus';
import { collectRoundSetupPreflightIssues } from '../lib/round-setup-preflight';

test('same-color categories retain independent IDs and ratings through selection and detached snapshots', () => {
  const catalog=structuredClone(INTERNAL_GOLF_COURSE_CATALOG);
  const white=catalog.tees.find(tee=>tee.id==='tee-la-vista-blancas')!;
  assert.ok(white);
  const course=catalog.courses.find(row=>row.id===white.courseId)!;
  course.sourceUrl='https://example.test/authorized-scorecard';course.verifiedAt='2026-10-09';
  white.gender='MEN';white.rating=70.8;white.slope=128;
  const women={...white,id:'qa-women-white',legacySelectionId:'qa-women-selection',gender:'WOMEN',rating:77.4,slope:153};
  catalog.tees.push(women);
  catalog.teeHoleYardages.push(...catalog.teeHoleYardages.filter(row=>row.teeId===white.id).map(row=>({...row,teeId:women.id})));
  const cards=[white,women].map(tee=>golfCourseSelectionToLegacyCourse(catalog,tee.id)!);
  const pending=beginRoundCourseSelection(cards);assert.equal(pending.ok,true);if(!pending.ok)return;
  for(const [i,category] of ['MEN','WOMEN'].entries()){
    const selected=completeRoundTeeSelection(pending,roundTeeSelectionId(cards[i]));assert.equal(selected.ok,true);if(!selected.ok)continue;
    assert.equal(selected.course.catalogTeeId,[white,women][i].id);
    assert.equal(selected.course.scorecardRatingGender,category);
    assert.equal(teeAssignmentSnapshot('qa-player',selected.course,'2026-10-09').scorecardRatingGender,category);
    const withProfile={...selected.course,scorecardProfileId:'QA-PROFILE',scorecardProfileName:'QA card'};
    const frozen=freezeScorecardProfileSelection(withProfile)!;
    assert.equal(frozen.ratingGender,category);assert.equal(frozen.teeId,selected.course.catalogTeeId);
    assert.equal(frozen.rating,[70.8,77.4][i]);assert.equal(frozen.slope,[128,153][i]);
    withProfile.rating=1;assert.equal(frozen.rating,[70.8,77.4][i]);
  }
  assert.equal(teeCategoryLabel(cards[0]),'Hombres');assert.equal(teeCategoryLabel(cards[1]),'Mujeres');
  assert.equal(teeCategoryLabel({}), 'Categoría no informada');
});

test('an incomplete temporary configuration survives draft normalization and reports its actual card blocker',()=>{
  const issue='Falta la tarjeta numerada de los 18 hoyos: orden y par para llevar score. Las ventajas/SI son necesarias para handicap; la correspondencia de hoyos físicos, para GPS.';
  const original={name:'La Vista Temporary — Par 70',catalogClubId:'club-la-vista',catalogCourseId:'course-la-vista-temporary-par-70',candidateCourseIds:[],selectionIssue:issue};
  const restored=normalizeRoundSetupCourseIdentity(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored,original);
  const [blocker]=collectRoundSetupPreflightIssues({courseSelected:false,pendingCourse:restored,players:[{id:'qa',name:'QA'}],betIssues:[]});
  assert.equal(blocker.label,'Tarjeta de la configuración');assert.equal(blocker.detail,issue);
  assert.equal(beginRoundCourseSelection([]).ok,false);
  const official={id:'official',catalogCourseId:'course-la-vista',clubName:original.name,name:original.name,teeName:'Blancas',holes:[]};
  const resumed=resolveManualRoundCourseState({currentCourse:official,availableCourses:[official],draftCourse:null,draftCourseSelected:false,courseIdentity:restored});
  assert.equal(resumed.courseSelected,false);assert.deepEqual(resumed.pendingIdentity,original);assert.deepEqual(resumed.candidates,[]);
});

test('a real selected layout waiting for tee is not reported as a missing field',()=>{
  const [blocker]=collectRoundSetupPreflightIssues({courseSelected:false,pendingCourse:{name:'QA layout',catalogCourseId:'qa'},players:[],betIssues:[]});
  assert.equal(blocker.label,'Tee de salida');assert.match(blocker.detail,/tee/);
  assert.equal(collectRoundSetupPreflightIssues({courseSelected:true,pendingCourse:null,players:[{id:'qa',name:'QA'}],betIssues:[]}).length,0);
});
