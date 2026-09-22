import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveCourse, type BaseCourseDefinition, type CourseConfiguration } from "../lib/course-configuration-resolver";

function baseCourse(): BaseCourseDefinition {
  return {
    id: "synthetic-course",
    name: "Synthetic Course",
    version: 1,
    holes: Array.from({ length: 18 }, (_, index) => ({ id: `h${index + 1}`, holeNumber: index + 1, par: 4, strokeIndex: index + 1 })),
    tees: [{
      id: "white",
      name: "Blancas",
      rating: 72,
      slope: 120,
      category: null,
      yardages: Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`h${index + 1}`, 350 + index])),
    }],
  };
}

function temporaryConfiguration(): CourseConfiguration {
  const holes = Array.from({ length: 18 }, (_, index) => {
    const sourceNumber = index < 2 ? index + 1 : index === 2 ? 4 : index;
    const temporary = index === 3;
    return {
      id: temporary ? "temporary-4b" : `configured-${sourceNumber}`,
      sequence: index + 1,
      runtimeHoleNumber: index + 1,
      displayLabel: temporary ? "4B" : sourceNumber === 4 ? "4A" : String(sourceNumber),
      sourceBaseHoleId: temporary ? null : `h${sourceNumber}`,
      sourceBaseHoleNumber: temporary ? null : sourceNumber,
      kind: temporary ? "TEMPORARY" as const : "BASE" as const,
      playable: true,
      parOverride: temporary ? 3 : sourceNumber === 4 ? 4 : null,
      strokeIndexOverride: temporary ? 18 : null,
      notes: null,
      temporaryGreen: false,
      temporaryTee: temporary,
      dropZoneNote: sourceNumber === 5 ? "Zona de dropeo señalizada" : null,
      operationalNote: null,
    };
  });
  return {
    id: "config-1",
    courseId: "synthetic-course",
    competitionId: null,
    scopeType: "COURSE",
    status: "PUBLISHED",
    version: 1,
    revisionHash: "hash-1",
    effectiveFrom: "2026-09-22T00:00:00Z",
    effectiveUntil: null,
    holes,
    teeHoles: [{ configurationHoleId: "temporary-4b", teeId: "white", yardsOverride: 160, source: "Synthetic fixture", verifiedAt: "2026-09-22T00:00:00Z" }],
    ratings: [],
  };
}

test("temporary resolver closes H3, splits H4 and keeps engine hole numbers valid", () => {
  const configuration = temporaryConfiguration();
  configuration.holes = [
    ...configuration.holes.slice(0, 2),
    { id: "closed-h3", sequence: 3, runtimeHoleNumber: null, displayLabel: "3", sourceBaseHoleId: "h3", sourceBaseHoleNumber: 3, kind: "BASE", playable: false, parOverride: null, strokeIndexOverride: null, notes: "Cerrado", temporaryGreen: false, temporaryTee: false, dropZoneNote: null, operationalNote: "Hoyo cerrado" },
    ...configuration.holes.slice(2).map((hole) => ({ ...hole, sequence: hole.sequence + 1 })),
  ];
  const result = resolveEffectiveCourse({ base: baseCourse(), configurations: [configuration], at: "2026-09-22T12:00:00Z" });
  assert.equal(configuration.holes.length, 19);
  assert.equal(result.resolvedHoles.length, 18);
  assert.equal(result.resolvedHoles.some((hole) => hole.sourceBaseHoleNumber === 3), false);
  assert.deepEqual(result.resolvedHoles.slice(2, 4).map((hole) => hole.displayLabel), ["4A", "4B"]);
  assert.deepEqual(result.resolvedHoles.map((hole) => hole.runtimeHoleNumber), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.equal(result.par, 71);
  assert.equal(result.resolvedTees[0].yardages["temporary-4b"], 160);
  assert.equal(result.configurationHashes[0], "hash-1");
});

test("round snapshot is not reinterpreted after current configuration changes", () => {
  const configuration = temporaryConfiguration();
  const snapshot = resolveEffectiveCourse({ base: baseCourse(), configurations: [configuration], at: "2026-09-22T12:00:00Z" });
  configuration.holes[3].parOverride = 4;
  assert.equal(snapshot.resolvedHoles[3].par, 3);
  assert.match(snapshot.snapshotPayload, /temporary-4b/);
});

test("overlapping active configurations fail closed", () => {
  const first = temporaryConfiguration();
  const second = { ...temporaryConfiguration(), id: "config-2", version: 2 };
  assert.throws(() => resolveEffectiveCourse({ base: baseCourse(), configurations: [first, second], at: "2026-09-22T12:00:00Z" }), /OVERLAPPING_COURSE_CONFIGURATIONS/);
});

test("an invalid temporary hole never invents par or stroke index", () => {
  const configuration = temporaryConfiguration();
  configuration.holes[3] = { ...configuration.holes[3], parOverride: null };
  assert.throws(() => resolveEffectiveCourse({ base: baseCourse(), configurations: [configuration], at: "2026-09-22T12:00:00Z" }), /INVALID_RESOLVED_HOLE/);
});

test("competition override drops warnings for Course holes it replaces", () => {
  const courseConfiguration = temporaryConfiguration();
  courseConfiguration.teeHoles = [];
  const competitionConfiguration: CourseConfiguration = {
    ...temporaryConfiguration(),
    id: "competition-config-1",
    competitionId: "competition-1",
    scopeType: "COMPETITION",
    revisionHash: "competition-hash-1",
    holes: baseCourse().holes.map((hole, index) => ({
      id: `competition-${hole.id}`,
      sequence: index + 1,
      runtimeHoleNumber: index + 1,
      displayLabel: String(hole.holeNumber),
      sourceBaseHoleId: hole.id,
      sourceBaseHoleNumber: hole.holeNumber,
      kind: "BASE",
      playable: true,
      parOverride: hole.par,
      strokeIndexOverride: hole.strokeIndex,
      notes: null,
      temporaryGreen: false,
      temporaryTee: false,
      dropZoneNote: null,
      operationalNote: null,
    })),
    teeHoles: [],
  };

  const result = resolveEffectiveCourse({
    base: baseCourse(),
    configurations: [courseConfiguration, competitionConfiguration],
    at: "2026-09-22T12:00:00Z",
    competitionId: "competition-1",
  });

  assert.deepEqual(result.configurationIds, ["config-1", "competition-config-1"]);
  assert.equal(result.resolvedHoles.some((hole) => hole.displayLabel === "4B"), false);
  assert.equal(result.warnings.some((warning) => warning.includes("4B")), false);
});
