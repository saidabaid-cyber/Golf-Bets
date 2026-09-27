import assert from "node:assert/strict";
import test from "node:test";

import { buildGhinCourseSyncPlan } from "../lib/ghin/course-sync";
import { parseGhinCourse, parseGhinScorePostingTees, type NormalizedGhinScore } from "../lib/ghin/core";
import { laVistaTeeTargetMappings, reconcileLaVistaLayouts } from "../lib/ghin/la-vista-reconciliation";
import { buildGhinScorePostingDryRun, ghinPostEligibility, postGhinScoreExactlyOnce, type GhinScorePostingCandidate } from "../lib/ghin/score-posting";

function laVistaCourse(par = 72) {
  const holes = (teeId: number) => Array.from({ length: 18 }, (_, index) => ({ HoleId: teeId * 100 + index, Number: index + 1, Par: index < 4 ? 5 : index < 8 ? 3 : 4, Length: 300 + index, Allocation: index + 1 }));
  const officialTees = [
    { TeeSetRatingId: 106087, TeeSetRatingName: "BLANCAS", TeeSetStatus: "Active", Gender: "Male", TotalPar: 72, TotalYardage: 6591, Ratings: [{ RatingType: "Total", CourseRating: 70.8, SlopeRating: 128 }], Holes: holes(106087) },
    { TeeSetRatingId: 106088, TeeSetRatingName: "DORADAS", TeeSetStatus: "Active", Gender: "Male", TotalPar: 72, TotalYardage: 6038, Ratings: [{ RatingType: "Total", CourseRating: 68.4, SlopeRating: 121 }], Holes: holes(106088) },
    { TeeSetRatingId: 106089, TeeSetRatingName: "BLANCAS", TeeSetStatus: "Active", Gender: "Female", TotalPar: 72, TotalYardage: 6591, Ratings: [{ RatingType: "Total", CourseRating: 77.4, SlopeRating: 153 }], Holes: holes(106089) },
    { TeeSetRatingId: 106090, TeeSetRatingName: "ROJAS", TeeSetStatus: "Active", Gender: "Female", TotalPar: 72, TotalYardage: 5476, Ratings: [{ RatingType: "Total", CourseRating: 71, SlopeRating: 137 }], Holes: holes(106090) },
    { TeeSetRatingId: 280984, TeeSetRatingName: "AZULES", TeeSetStatus: "Active", Gender: "Male", TotalPar: 72, TotalYardage: 7122, Ratings: [{ RatingType: "Total", CourseRating: 73.8, SlopeRating: 135 }], Holes: holes(280984) },
    { TeeSetRatingId: 281493, TeeSetRatingName: "NEGRAS", TeeSetStatus: "Active", Gender: "Male", TotalPar: 72, TotalYardage: 7326, Ratings: [{ RatingType: "Total", CourseRating: 74.3, SlopeRating: 142 }], Holes: holes(281493) },
  ];
  const course = parseGhinCourse({
    CourseId: par === 72 ? 23233 : 70000 + par,
    CourseName: par === 72 ? "La Vista Country Club" : `La Vista Temporary Par ${par}`,
    CourseStatus: "Active",
    Facility: { FacilityId: 19886, FacilityName: "La Vista Country Club", FacilityStatus: "Active", GolfAssociationId: 9 },
    TeeSets: par === 72 ? officialTees : [
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
  const mappings = laVistaTeeTargetMappings(course.tees);
  const input = {
    course,
    scorePostingTees: posting,
    targetClubId: "club-la-vista",
    targetCourseId: "course-la-vista",
    targetTeeIdsByProviderId: mappings,
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
  const blue = first.tees.find((tee) => tee.provider_external_id === "280984");
  const maleWhite = first.tees.find((tee) => tee.provider_external_id === "106087");
  const femaleWhite = first.tees.find((tee) => tee.provider_external_id === "106089");
  assert.equal(blue?.id, "tee-la-vista-azules");
  assert.equal(maleWhite?.id, "tee-la-vista-blancas");
  assert.equal(femaleWhite?.id, "ghin-tee-106089");
  assert.equal(new Set(first.tees.map((tee) => tee.id)).size, 6);
  assert.equal(first.holes.length, 18);
  assert.equal(first.holes[0].id, "hole-la-vista-1");
  assert.ok(first.yardages.some((row) => row.id === "yardage-la-vista-blue-1"));
  assert.equal(new Set(first.holes.map((hole) => hole.id)).size, 18);
  assert.equal(new Set(first.yardages.map((row) => row.id)).size, 108);
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
  const bellaVista = { ...par72, id: "13465", name: "Bella Vista Golf Course", facilityId: "11353", facilityName: "Bella Vista Golf Course" };
  const result = reconcileLaVistaLayouts([bellaVista, par72, incompletePar70], {
    "23233": parseGhinScorePostingTees([{ TeeSetRatingId: 106087, TeeSetRatingName: "Blue", RatingType: "Total", CourseRating: 73.8, SlopeRating: 135 }]),
  });
  const official = result.find((row) => row.layout === "PAR_72");
  assert.equal(official?.status, "GHIN_MATCH_CONFIRMED");
  assert.equal(official?.ghinCourseId, "23233");
  assert.deepEqual(official?.diffs.filter((diff) => diff.field === "yardage"), [
    { tee: "blue", field: "yardage", backyard: 7229, ghin: 7122 },
    { tee: "white", field: "yardage", backyard: 6590, ghin: 6591 },
  ]);
  assert.equal(result.find((row) => row.layout === "PAR_70")?.status, "MISSING_DATA");
  assert.equal(result.find((row) => row.layout === "PAR_69")?.status, "BACKYARD_ONLY");
});

test("mapping La Vista distingue tees con el mismo nombre por género", () => {
  const mappings = laVistaTeeTargetMappings(laVistaCourse().tees);
  assert.equal(mappings["106087"], "tee-la-vista-blancas");
  assert.equal(mappings["106089"], undefined);
  assert.equal(mappings["106090"], "tee-la-vista-rojas");
  assert.equal(mappings["280984"], "tee-la-vista-azules");
});

test("GHIN_POST_ELIGIBLE exige provider, IDs, mapping, status y tee publicable", () => {
  const official = ghinPostEligibility({ provider: "GHIN", providerCourseId: "23233", providerTeeSetId: "280984", providerStatus: "Active", mappingStatus: "CONFIRMED", sourceIsProvisional: false, scorePostingTeeSetIds: new Set(["280984"]) });
  assert.deepEqual(official, { eligible: true, code: "GHIN_POST_ELIGIBLE" });
  assert.equal(ghinPostEligibility({ provider: "GHIN", providerCourseId: "23233", providerTeeSetId: "280984", providerStatus: "Active", mappingStatus: "CONFIRMED", sourceIsProvisional: true }).code, "PROVISIONAL_LAYOUT_NOT_POSTABLE");
  assert.equal(ghinPostEligibility({ provider: "GHIN", providerCourseId: "23233", providerTeeSetId: "wrong-layout", providerStatus: "Active", mappingStatus: "CONFIRMED", sourceIsProvisional: false, scorePostingTeeSetIds: new Set(["280984"]) }).code, "GHIN_TEE_NOT_SCORE_POSTING_ENABLED");
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
