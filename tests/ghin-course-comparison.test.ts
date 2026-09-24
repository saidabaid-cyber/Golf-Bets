import assert from "node:assert/strict";
import test from "node:test";

import {
  compareGhinCourseDryRun,
  isSyntheticReviewedGhinTeeId,
  proposeLaVistaGhinMappings,
  type GhinTeeMatchRule,
} from "../lib/ghin/course-comparison";
import type { NormalizedGhinCourse, NormalizedGhinTee } from "../lib/ghin/core";
import {
  INTERNAL_GOLF_COURSE_CATALOG,
  type GolfCourseCatalog,
} from "../lib/golf-course-directory";

const SYNTHETIC_TEE_IDS = {
  Azules: "ghin:23233:tee:a5be40b61705",
  Blancas: "ghin:23233:tee:ad652458406f",
  Doradas: "ghin:23233:tee:468e7646a10f",
} as const;

function catalogTee(
  catalog: GolfCourseCatalog,
  teeId: string,
  overrides: Partial<NormalizedGhinTee> = {},
): NormalizedGhinTee {
  const tee = catalog.tees.find((candidate) => candidate.id === teeId);
  assert.ok(tee);
  const holes = catalog.holes
    .filter((hole) => hole.courseId === tee.courseId)
    .sort((left, right) => left.holeNumber - right.holeNumber);
  const yardageByHole = new Map(
    catalog.teeHoleYardages
      .filter((yardage) => yardage.teeId === tee.id)
      .map((yardage) => [yardage.holeNumber, yardage.yards ?? null]),
  );
  return {
    id: SYNTHETIC_TEE_IDS[tee.name as keyof typeof SYNTHETIC_TEE_IDS] ?? `source:${tee.id}`,
    name: tee.name,
    gender: tee.gender ?? null,
    holes: holes.length,
    par: tee.par ?? null,
    courseRating: tee.rating ?? null,
    slopeRating: tee.slope ?? null,
    totalYards: tee.totalYards ?? null,
    frontRating: null,
    frontSlope: null,
    backRating: null,
    backSlope: null,
    holeData: holes.map((hole) => ({
      number: hole.holeNumber,
      par: hole.par,
      yardage: yardageByHole.get(hole.holeNumber) ?? null,
      strokeIndex: hole.strokeIndex,
    })),
    ...overrides,
  };
}

function laVistaGhin(
  catalog: GolfCourseCatalog = INTERNAL_GOLF_COURSE_CATALOG,
): NormalizedGhinCourse {
  const azules = catalogTee(catalog, "tee-la-vista-azules", {
    courseRating: 74.4,
    totalYards: 7_229,
    frontSlope: 145,
  });
  const blancas = catalogTee(catalog, "tee-la-vista-blancas");
  const doradas = catalogTee(catalog, "tee-la-vista-doradas", { name: "Gold" });
  const negras: NormalizedGhinTee = {
    id: "ghin:23233:tee:6b76f06adc0e",
    name: "Negras",
    gender: null,
    holes: 18,
    par: 72,
    courseRating: 76.1,
    slopeRating: 151,
    totalYards: 7_520,
    frontRating: null,
    frontSlope: null,
    backRating: null,
    backSlope: null,
    holeData: [],
  };
  return {
    id: "23233",
    facilityId: null,
    name: "La Vista",
    facilityName: "La Vista Country Club",
    city: null,
    state: "Puebla",
    country: "Mexico",
    holes: 18,
    status: "active",
    rawStatus: "Active",
    tees: [azules, blancas, doradas, negras],
  };
}

const TEE_RULES: readonly GhinTeeMatchRule[] = [
  { backyardTeeId: "tee-la-vista-doradas", aliases: ["Gold"] },
];

test("genera un dry-run humano y machine-readable sin mutar el catálogo ni la respuesta GHIN", () => {
  const catalog = structuredClone(INTERNAL_GOLF_COURSE_CATALOG);
  const ghin = laVistaGhin(catalog);
  const catalogBefore = structuredClone(catalog);
  const ghinBefore = structuredClone(ghin);

  const report = compareGhinCourseDryRun(catalog, ghin, {
    backyardCourseId: "course-la-vista",
    teeMatches: TEE_RULES,
  });

  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.readOnly, true);
  assert.equal(report.applied, false);
  assert.equal(report.backyard.courseId, "course-la-vista");
  assert.equal(report.ghin.courseId, "23233");
  assert.equal(report.summary.fields, report.fields.length + report.tees.flatMap((tee) => tee.fields).length);
  for (const status of ["MATCH", "DIFFERENT", "MISSING_IN_BACKYARD", "MISSING_IN_GHIN", "UNKNOWN"] as const) {
    assert.ok(report.summary[status] > 0, `el reporte incluye al menos un campo ${status}`);
    assert.match(report.humanReport, new RegExp(`\\[${status}\\]`));
  }
  assert.match(report.humanReport, /DRY RUN · NO CHANGES APPLIED/);
  assert.ok(report.warnings.some((warning) => warning.includes("claves sintéticas")));
  assert.deepEqual(catalog, catalogBefore);
  assert.deepEqual(ghin, ghinBefore);
});

test("empareja tees sólo por reglas explícitas, nombre exacto o alias y conserva faltantes", () => {
  const report = compareGhinCourseDryRun(INTERNAL_GOLF_COURSE_CATALOG, laVistaGhin(), {
    backyardCourseId: "course-la-vista",
    teeMatches: TEE_RULES,
  });
  const byBackyardId = new Map(report.tees.map((tee) => [tee.backyardTeeId, tee]));

  assert.equal(byBackyardId.get("tee-la-vista-azules")?.matchKind, "EXACT_NAME");
  assert.equal(byBackyardId.get("tee-la-vista-blancas")?.matchKind, "EXACT_NAME");
  assert.equal(byBackyardId.get("tee-la-vista-doradas")?.matchKind, "ALIAS");
  assert.equal(byBackyardId.get("tee-la-vista-doradas")?.ghinTeeName, "Gold");
  assert.equal(byBackyardId.get("tee-la-vista-rojas")?.matchKind, "UNMATCHED_BACKYARD");
  assert.ok(report.tees.some((tee) => tee.backyardTeeId === null && tee.ghinTeeName === "Negras" && tee.matchKind === "UNMATCHED_GHIN"));
  assert.equal(report.summary.matchedTees, 3);
  assert.equal(report.summary.backyardOnlyTees, 1);
  assert.equal(report.summary.ghinOnlyTees, 1);

  const blueFields = byBackyardId.get("tee-la-vista-azules")?.fields ?? [];
  assert.equal(blueFields.find((field) => field.path.endsWith(".rating"))?.status, "DIFFERENT");
  assert.equal(blueFields.find((field) => field.path.endsWith(".slope"))?.status, "MATCH");
  assert.equal(blueFields.find((field) => field.path.endsWith(".frontRating"))?.status, "UNKNOWN");
  assert.equal(blueFields.find((field) => field.path.endsWith(".frontSlope"))?.status, "MISSING_IN_BACKYARD");
  assert.equal(blueFields.find((field) => field.path.endsWith(".backRating"))?.status, "UNKNOWN");
  assert.equal(blueFields.find((field) => field.path.endsWith(".backSlope"))?.status, "UNKNOWN");
  assert.equal(blueFields.find((field) => field.path.endsWith(".par"))?.status, "MATCH");
  assert.equal(blueFields.find((field) => field.path.endsWith(".totalYards"))?.status, "DIFFERENT");
  assert.equal(blueFields.find((field) => field.path.endsWith(".holes.1.par"))?.status, "MATCH");
  assert.equal(blueFields.find((field) => field.path.endsWith(".holes.1.yards"))?.status, "MATCH");
  assert.equal(blueFields.find((field) => field.path.endsWith(".holes.1.strokeIndex"))?.status, "MATCH");
});

test("la propuesta La Vista nunca promueve un ID sintético a TeeSet ID", () => {
  const ghin = laVistaGhin();
  const proposal = proposeLaVistaGhinMappings(INTERNAL_GOLF_COURSE_CATALOG, ghin, {
    teeMatches: TEE_RULES,
    verifiedTeeSetIdsBySourceId: {
      [SYNTHETIC_TEE_IDS.Azules]: "verified-tee-set-42",
      [SYNTHETIC_TEE_IDS.Blancas]: SYNTHETIC_TEE_IDS.Blancas,
    },
  });
  const blue = proposal.tees.find((tee) => tee.backyardTeeId === "tee-la-vista-azules");
  const white = proposal.tees.find((tee) => tee.backyardTeeId === "tee-la-vista-blancas");

  assert.equal(proposal.mode, "DRY_RUN");
  assert.equal(proposal.applied, false);
  assert.equal(proposal.course.proposedProviderExternalId, "23233");
  assert.equal(blue?.syntheticSourceId, true);
  assert.equal(blue?.proposedProviderExternalId, "verified-tee-set-42");
  assert.equal(blue?.verifiedTeeSetId, "verified-tee-set-42");
  assert.equal(white?.proposedProviderExternalId, null);
  assert.equal(white?.verifiedTeeSetId, null);
  assert.deepEqual(proposal.unmatchedBackyardTeeIds, ["tee-la-vista-rojas"]);
  assert.deepEqual(proposal.unmatchedGhinTeeSourceIds, ["ghin:23233:tee:6b76f06adc0e"]);
  assert.ok(proposal.warnings.some((warning) => warning.includes("nunca se usa como provider_external_id ni TeeSet ID")));
  assert.ok(proposal.warnings.some((warning) => warning.includes("TeeSet ID rechazado por ser sintético")));
  assert.equal(isSyntheticReviewedGhinTeeId(SYNTHETIC_TEE_IDS.Azules), true);
  assert.equal(isSyntheticReviewedGhinTeeId("106087"), false);
});

test("un nombre duplicado queda ambiguo en vez de producir un match heurístico", () => {
  const ghin = laVistaGhin();
  const blue = ghin.tees[0];
  ghin.tees.splice(1, 0, { ...blue, id: "duplicate-blue" });

  const report = compareGhinCourseDryRun(INTERNAL_GOLF_COURSE_CATALOG, ghin, {
    backyardCourseId: "course-la-vista",
    teeMatches: TEE_RULES,
  });
  const blueResult = report.tees.find((tee) => tee.backyardTeeId === "tee-la-vista-azules");

  assert.equal(blueResult?.matchKind, "AMBIGUOUS");
  assert.equal(blueResult?.ghinTeeSourceId, null);
  assert.ok(report.warnings.some((warning) => warning.includes("Tee ambiguo")));
  assert.equal(report.tees.filter((tee) => tee.ghinTeeName === "Azules" && tee.matchKind === "UNMATCHED_GHIN").length, 2);
});
