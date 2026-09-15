import assert from "node:assert/strict";
import test from "node:test";
import {
  curatedPueblaCourseProvider,
  getCourseDataStatusForSelection,
  getCuratedIndexRatedTeeEvidenceForCourse,
  validateCuratedPueblaTee,
} from "../lib/curated-puebla-course-data";
import { reconcilePlayerTeeAssignments, teeAssignmentSnapshot, teeOptionsForCourse } from "../lib/player-tee-assignments";
import { DEFAULT_COURSES } from "../lib/golf-course-directory";
import { searchInternalCourses } from "../lib/golf-providers";
import type { Course, Player } from "../lib/types";

test("P · Puebla references distinguish verified identity from missing rating evidence", () => {
  const clubs = curatedPueblaCourseProvider.listCourses();
  assert.equal(clubs.length, 5);
  assert.equal(curatedPueblaCourseProvider.dataVersion, "puebla-primary-2026-09-15.v1");
  const vista = clubs.find((club) => club.courseId === "course-la-vista");
  assert.equal(vista?.holesCount, 18);
  assert.equal(vista?.par, 72);
  assert.match(vista?.source.url || "", /golfsur\.com\.mx\/.*La-Vista\.pdf/);
  assert.equal(clubs.find((club) => club.courseId === "course-las-fuentes")?.holesCount, undefined);
  assert.equal(curatedPueblaCourseProvider.getIndexRatedTeeEvidenceById("tee-la-vista-blancas"), null);
  assert.equal(curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-la-vista-blancas"), null);
  assert.equal(curatedPueblaCourseProvider.getCourseStatusById("course-la-vista"), "COURSE_REFERENCE_ONLY");
  assert.ok(clubs.every((club) => club.source.authority && club.source.url.startsWith("https://") && club.source.verifiedAt));
  const curatedDefault = DEFAULT_COURSES.find((course) => course.id === "tee-el-cristo-blancas");
  assert.ok(curatedDefault);
  assert.equal(curatedDefault.indexRatingEvidence?.kind, "CURATED_RATED_TEE");
  assert.deepEqual(getCourseDataStatusForSelection(curatedDefault), { courseStatus: "COURSE_AVAILABLE", teeStatus: "TEE_INDEX_ELIGIBLE" });
  assert.deepEqual(getCourseDataStatusForSelection(DEFAULT_COURSES.find((course) => course.id === "el-cristo-general")!), { courseStatus: "COURSE_AVAILABLE", teeStatus: "TEE_UNVERIFIED" });
  assert.deepEqual(getCourseDataStatusForSelection(DEFAULT_COURSES.find((course) => course.id === "lavista-blancas")!), { courseStatus: "COURSE_AVAILABLE", teeStatus: "TEE_UNVERIFIED" });
  assert.deepEqual(teeOptionsForCourse(curatedDefault, DEFAULT_COURSES).map((course) => course.id), [
    "el-cristo-general", "tee-el-cristo-blancas", "tee-el-cristo-azules",
  ]);
  assert.deepEqual(curatedPueblaCourseProvider.listPlayableSelections().map((course) => course.id), ["tee-el-cristo-blancas", "tee-el-cristo-azules"]);
  assert.ok(searchInternalCourses({ courses: DEFAULT_COURSES, query: "cristo", limit: 12 }).courses.some((course) => course.id === curatedDefault.id));
});

test("Q · only source-consistent El Cristo tees qualify for a LOCAL index, never GHIN", () => {
  for (const id of ["tee-el-cristo-azules", "tee-el-cristo-blancas"]) {
    const lookup = curatedPueblaCourseProvider.getTeeById(id);
    assert.equal(lookup?.eligibleForLocalIndex, true);
    assert.equal(lookup?.eligibleForOfficialGhin, false);
    assert.equal(lookup?.courseStatus, "COURSE_AVAILABLE");
    assert.equal(lookup?.teeStatus, "TEE_INDEX_ELIGIBLE");
    assert.deepEqual(lookup?.issues, []);
    const evidence = curatedPueblaCourseProvider.getIndexRatedTeeEvidenceById(id);
    assert.equal(evidence?.kind, "CURATED_RATED_TEE");
    assert.equal(evidence?.courseId, "course-el-cristo");
    assert.equal(evidence?.teeId, id);
    assert.equal(evidence?.dataVersion, curatedPueblaCourseProvider.dataVersion);
    assert.match(evidence?.sourceUrl || "", /elcristo\.com\.mx\/campo-golf/);
    const selection = curatedPueblaCourseProvider.getPlayableSelectionByTeeId(id);
    assert.equal(selection?.holes.length, 18);
    assert.equal(selection?.holes.reduce((total, hole) => total + hole.par, 0), 72);
    assert.equal(selection?.holes.reduce((total, hole) => total + (hole.yards || 0), 0), selection?.totalYards);
    assert.deepEqual(getCuratedIndexRatedTeeEvidenceForCourse(selection as Course), evidence);
  }
  for (const id of ["tee-el-cristo-doradas", "tee-el-cristo-rojas"]) {
    const lookup = curatedPueblaCourseProvider.getTeeById(id);
    assert.equal(lookup?.eligibleForLocalIndex, false);
    assert.equal(lookup?.eligibleForOfficialGhin, false);
    assert.equal(lookup?.courseStatus, "COURSE_AVAILABLE");
    assert.equal(lookup?.teeStatus, "TEE_UNVERIFIED");
    assert.ok(lookup?.issues.includes("SOURCE_TOTAL_CONFLICT"));
    assert.equal(curatedPueblaCourseProvider.getIndexRatedTeeEvidenceById(id), null);
    assert.equal(curatedPueblaCourseProvider.getPlayableSelectionByTeeId(id), null);
  }
  assert.equal(curatedPueblaCourseProvider.getTeeById("no-such-tee"), null);
});

test("R · tee selection freezes verified evidence; manual, edited or legacy courses fail closed", () => {
  const course = curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-el-cristo-blancas");
  assert.ok(course);
  const capturedAt = "2026-09-15T12:00:00.000Z";
  const selected = teeAssignmentSnapshot("said", course, capturedAt);
  assert.equal(selected.source, "catalog");
  assert.equal(selected.par, 72);
  assert.equal(selected.indexRatingEvidence?.kind, "CURATED_RATED_TEE");
  assert.equal(selected.indexRatingEvidence?.courseRating, 68.6);
  assert.equal(selected.sourceUrl, "https://elcristo.com.mx/campo-golf");
  assert.equal(selected.dataVersion, curatedPueblaCourseProvider.dataVersion);

  course.rating = 70;
  course.indexRatingEvidence!.courseRating = 70;
  assert.equal(selected.rating, 68.6);
  assert.equal(selected.indexRatingEvidence?.courseRating, 68.6);
  assert.equal(getCuratedIndexRatedTeeEvidenceForCourse(course), null);
  assert.equal(teeAssignmentSnapshot("juan", course, capturedAt).indexRatingEvidence, undefined);
  assert.equal(teeAssignmentSnapshot("juan", course, capturedAt, "manual").indexRatingEvidence, undefined);

  const players: Player[] = [{ id: "said", name: "Said", handicap: 7 }];
  const reconciled = reconcilePlayerTeeAssignments([selected], players, course, "2026-09-16T12:00:00.000Z");
  assert.deepEqual(reconciled[0].indexRatingEvidence, selected.indexRatingEvidence);
  assert.notEqual(reconciled[0].indexRatingEvidence, selected.indexRatingEvidence);
  assert.equal(reconciled[0].capturedAt, capturedAt);
  assert.equal(reconciled[0].rating, 68.6);

  const freshCourse = curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-el-cristo-blancas")!;
  const newPlayer = reconcilePlayerTeeAssignments([], players, freshCourse, capturedAt, { allowCuratedNewAssignment: true });
  assert.equal(newPlayer[0].source, "catalog");
  assert.equal(newPlayer[0].indexRatingEvidence?.kind, "CURATED_RATED_TEE");
  assert.equal(reconcilePlayerTeeAssignments([], players, freshCourse, capturedAt)[0].indexRatingEvidence, undefined);
  const previousLegacy = teeAssignmentSnapshot("said", freshCourse, "2026-09-14T12:00:00.000Z", "legacy");
  const keptLegacy = reconcilePlayerTeeAssignments([previousLegacy], players, freshCourse, capturedAt, { allowCuratedNewAssignment: true });
  assert.equal(keptLegacy[0].source, "legacy");
  assert.equal(keptLegacy[0].indexRatingEvidence, undefined);
  assert.equal(keptLegacy[0].capturedAt, previousLegacy.capturedAt);
});

test("S · provider returns defensive copies and invalid primary scorecards cannot be promoted", () => {
  const lookup = curatedPueblaCourseProvider.getTeeById("tee-el-cristo-azules");
  assert.ok(lookup);
  lookup.tee.holeYards[0] = 999;
  lookup.club.holePars![0] = 3;
  assert.equal(curatedPueblaCourseProvider.getTeeById("tee-el-cristo-azules")?.tee.holeYards[0], 511);
  const pristine = curatedPueblaCourseProvider.getTeeById("tee-el-cristo-azules");
  assert.ok(pristine);
  assert.ok(validateCuratedPueblaTee({ ...pristine.tee, holeYards: [...pristine.tee.holeYards, 200] }, pristine.club).includes("HOLE_YARDS_INCOMPLETE"));
  assert.ok(validateCuratedPueblaTee({ ...pristine.tee, totalYards: 6500 }, pristine.club).includes("SOURCE_TOTAL_CONFLICT"));
  assert.ok(validateCuratedPueblaTee(pristine.tee, { ...pristine.club, source: { ...pristine.club.source, url: "" } }).includes("PRIMARY_SOURCE_MISSING"));
  const fake: Course = { ...curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-el-cristo-azules")!, provider: "BACKYARD_INTERNAL" };
  assert.equal(getCuratedIndexRatedTeeEvidenceForCourse(fake), null);
});
