import assert from "node:assert/strict";
import test from "node:test";

import { buildGhinCourseSyncPlan } from "../lib/ghin/course-sync";
import { parseGhinCourse, parseGhinScorePostingTees, type NormalizedGhinScore } from "../lib/ghin/core";
import { reconcileLaVistaLayouts } from "../lib/ghin/la-vista-reconciliation";
import { buildGhinScorePostingDryRun, postGhinScoreExactlyOnce, type GhinScorePostingCandidate } from "../lib/ghin/score-posting";

function laVistaCourse(par = 72) {
  const course = parseGhinCourse({
    CourseId: par === 72 ? 23233 : 70000 + par,
    CourseName: par === 72 ? "La Vista Country Club" : `La Vista Temporary Par ${par}`,
    CourseStatus: "Active",
    Facility: { FacilityId: 44, FacilityName: "La Vista Country Club", FacilityStatus: "Active", GolfAssociationId: 9 },
    TeeSets: [
      {
        TeeSetRatingId: 106087,
        TeeSetRatingName: "Blue",
        TeeSetStatus: "Active",
        Gender: "Male",
        TotalPar: par,
        TotalYardage: par === 72 ? 7229 : 6790,
        Ratings: [{ RatingType: "Total", CourseRating: par === 72 ? 73.8 : 71.2, SlopeRating: par === 72 ? 135 : 128 }],
        Holes: Array.from({ length: 18 }, (_, index) => ({ HoleId: 100 + index, Number: index + 1, Par: index < (par === 72 ? 4 : 2) ? 5 : index < 8 ? 3 : 4, Length: 350 + index, Allocation: index + 1 })),
      },
    ],
  });
  assert.ok(course);
  return course;
}

test("el plan GHIN usa IDs externos, upserts estables y mapping explícito", () => {
  const course = laVistaCourse();
  const posting = parseGhinScorePostingTees([{ TeeSetRatingId: 106087, TeeSetRatingName: "Blue", RatingType: "Total", CourseRating: 73.8, SlopeRating: 135 }]);
  const input = {
    course,
    scorePostingTees: posting,
    targetClubId: "club-la-vista",
    targetCourseId: "course-la-vista",
    targetTeeIdsByProviderId: { "106087": "tee-la-vista-azules" },
    targetHoleIdsByNumber: { 1: "hole-la-vista-1" },
    targetYardageIdsByTeeAndHoleNumber: { "tee-la-vista-azules:1": "yardage-la-vista-blue-1" },
    confirmMapping: true,
    observedAt: "2026-09-27T20:00:00.000Z",
  } as const;
  const first = buildGhinCourseSyncPlan(input);
  const second = buildGhinCourseSyncPlan(input);

  assert.deepEqual(second, first);
  assert.equal(first.course.id, "course-la-vista");
  assert.equal(first.course.provider_external_id, "23233");
  assert.equal(first.tees[0].id, "tee-la-vista-azules");
  assert.equal(first.tees[0].provider_external_id, "106087");
  assert.equal(first.holes.length, 18);
  assert.equal(first.holes[0].id, "hole-la-vista-1");
  assert.equal(first.yardages[0].id, "yardage-la-vista-blue-1");
  assert.equal(new Set(first.holes.map((hole) => hole.id)).size, 18);
  assert.equal(new Set(first.yardages.map((row) => row.id)).size, 18);
  assert.equal(first.courseLink.sync_status, "CONFIRMED");
  assert.equal(first.completeForScorePosting, true);
});

test("un mapping candidato nunca habilita score posting", () => {
  const plan = buildGhinCourseSyncPlan({ course: laVistaCourse(), observedAt: "2026-09-27T20:00:00.000Z" });
  assert.equal(plan.courseLink.sync_status, "CANDIDATE");
  assert.equal(plan.completeForScorePosting, false);
  assert.match(plan.warnings.join(" "), /candidate/i);
});

test("reconciliación no acepta un temporary sólo por nombre", () => {
  const par72 = laVistaCourse();
  const incompletePar70 = laVistaCourse(70);
  const result = reconcileLaVistaLayouts([par72, incompletePar70], {
    "23233": parseGhinScorePostingTees([{ TeeSetRatingId: 106087, TeeSetRatingName: "Blue", RatingType: "Total", CourseRating: 73.8, SlopeRating: 135 }]),
  });
  assert.equal(result.find((row) => row.layout === "PAR_72")?.status, "GHIN_MATCH_CONFIRMED");
  assert.equal(result.find((row) => row.layout === "PAR_70")?.status, "MISSING_DATA");
  assert.equal(result.find((row) => row.layout === "PAR_69")?.status, "BACKYARD_ONLY");
});

test("Par 69 no se confirma sin yardajes y tarjeta Backyard reconciliados", () => {
  const par69 = laVistaCourse(69);
  const result = reconcileLaVistaLayouts([par69], {});
  assert.equal(result.find((row) => row.layout === "PAR_69")?.status, "MISSING_DATA");
});

function candidate(overrides: Partial<GhinScorePostingCandidate> = {}): GhinScorePostingCandidate {
  return {
    ownerId: "owner",
    roundId: "round",
    golferId: "11103349",
    providerCourseId: "23233",
    providerTeeSetId: "106087",
    providerMappingConfirmed: true,
    sourceIsProvisional: false,
    teeSetSide: "All18",
    playedAt: "2026-09-27",
    scoreType: "H",
    gender: "M",
    numberOfHoles: 18,
    holeDetails: Array.from({ length: 18 }, (_, index) => ({ holeNumber: index + 1, rawScore: 4 })),
    courseName: "La Vista Country Club",
    teeName: "Blue",
    ...overrides,
  };
}

test("dry-run bloquea provisional, datos incompletos y duplicados", () => {
  const provisional = buildGhinScorePostingDryRun(candidate({ sourceIsProvisional: true }), []);
  assert.equal(provisional.status, "BLOCKED");
  assert.ok(provisional.errors.includes("PROVISIONAL_LAYOUT_NOT_POSTABLE"));

  const existing: NormalizedGhinScore = {
    id: "score-1", playedOn: "2026-09-27", courseId: "23233", courseName: "La Vista Country Club",
    teeId: "106087", teeName: "Blue", grossScore: 72, adjustedGrossScore: 72, differential: 1,
    courseRating: 73.8, slopeRating: 135, scoreType: "H", postingMethod: "Internet", holes: 18,
  };
  const duplicate = buildGhinScorePostingDryRun(candidate(), [existing]);
  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(duplicate.duplicateScoreId, "score-1");
});

test("dry-run conserva los valores TeeSetSide aceptados por GHIN", () => {
  const front = buildGhinScorePostingDryRun(candidate({
    teeSetSide: "F9",
    numberOfHoles: 9,
    holeDetails: Array.from({ length: 9 }, (_, index) => ({ holeNumber: index + 1, rawScore: 4 })),
  }), []);
  const back = buildGhinScorePostingDryRun(candidate({
    teeSetSide: "B9",
    numberOfHoles: 9,
    holeDetails: Array.from({ length: 9 }, (_, index) => ({ holeNumber: index + 10, rawScore: 4 })),
  }), []);
  assert.equal(front.payload?.tee_set_side, "F9");
  assert.equal(back.payload?.tee_set_side, "B9");
  assert.equal(buildGhinScorePostingDryRun(candidate({
    teeSetSide: "B9",
    numberOfHoles: 9,
    holeDetails: Array.from({ length: 9 }, (_, index) => ({ holeNumber: index + 1, rawScore: 4 })),
  }), []).errors.includes("TEE_SET_SIDE_HOLES_MISMATCH"), true);
});

test("coordinador publica exactamente una vez después de claim", async () => {
  const dryRun = buildGhinScorePostingDryRun(candidate(), []);
  assert.equal(dryRun.status, "READY");
  let claimed = false;
  let posts = 0;
  let finalized = 0;
  const run = () => postGhinScoreExactlyOnce({
    dryRun,
    claim: async () => claimed ? { acquired: false, prior: { id: "score-1" } } : (claimed = true, { acquired: true }),
    post: async () => (++posts, { id: "score-1" }),
    finalize: async () => { finalized += 1; },
    fail: async () => undefined,
  });

  assert.equal((await run()).posted, true);
  assert.equal((await run()).posted, false);
  assert.equal(posts, 1);
  assert.equal(finalized, 1);
});
