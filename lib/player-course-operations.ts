import type { Course, LocalRule } from "./types";

export type PlayerResolvedHole = { id: string; runtimeHoleNumber: number; displayLabel: string; par: number; strokeIndex: number };
export type PlayerResolvedTee = { id: string; name: string; rating: number | null; slope: number | null; yardages: Record<string, number | null> };
export type PlayerResolvedCourse = {
  sourceCourseId: string;
  baseVersion: number;
  configurationIds: string[];
  configurationVersions: number[];
  configurationHashes: string[];
  resolvedHoles: PlayerResolvedHole[];
  resolvedTees: PlayerResolvedTee[];
  warnings: string[];
  effectiveAt: string;
};

export type PlayerCourseOperationsResponse = {
  resolved: PlayerResolvedCourse;
  localRules: unknown[];
  badges: string[];
  competitionId?: string | null;
  competitionRuleSet?: { id: string; version: number } | null;
  warning?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function localRules(values: readonly unknown[]): LocalRule[] {
  return values.flatMap((value, index) => {
    const row = record(value); if (!row || typeof row.title !== "string" || typeof row.body !== "string") return [];
    const holes = Array.isArray(row.holeRefs) ? row.holeRefs.filter((hole): hole is number => Number.isInteger(hole) && hole >= 1 && hole <= 18) : [];
    return [{ id: typeof row.id === "string" ? row.id : `admin-rule-${index}`, title: row.title, text: row.body, enabled: row.active !== false, hole: holes.length === 1 ? holes[0] : null }];
  });
}

/** Creates a new immutable Course snapshot. The input Course is never mutated. */
export function courseWithResolvedOperations(course: Course, response: PlayerCourseOperationsResponse): Course {
  const resolved = response.resolved;
  if ((course.catalogCourseId ?? course.id) !== resolved.sourceCourseId) throw new Error("COURSE_OPERATION_ID_MISMATCH");
  if (![9, 18].includes(resolved.resolvedHoles.length)) throw new Error("INVALID_OPERATION_HOLE_COUNT");
  const selectedTee = resolved.resolvedTees.find((tee) => tee.id === course.catalogTeeId) ?? resolved.resolvedTees[0] ?? null;
  const holes = resolved.resolvedHoles.map((hole) => {
    if (!Number.isInteger(hole.runtimeHoleNumber) || hole.runtimeHoleNumber < 1 || hole.runtimeHoleNumber > 18 || hole.par < 3 || hole.par > 6 || hole.strokeIndex < 1 || hole.strokeIndex > 18) throw new Error("INVALID_OPERATION_HOLE");
    const yards = selectedTee?.yardages[hole.id];
    return { number: hole.runtimeHoleNumber, displayLabel: hole.displayLabel, par: hole.par, strokeIndex: hole.strokeIndex, ...(typeof yards === "number" && yards > 0 ? { yards } : {}) };
  });
  return {
    ...structuredClone(course),
    holes,
    ...(selectedTee ? { teeName: selectedTee.name, catalogTeeId: selectedTee.id, rating: selectedTee.rating ?? undefined, slope: selectedTee.slope ?? undefined, totalYards: holes.every((hole) => hole.yards !== undefined) ? holes.reduce((total, hole) => total + (hole.yards || 0), 0) : undefined } : {}),
    localRules: localRules(response.localRules),
    localRulesUpdatedAt: resolved.effectiveAt,
    operationsSnapshot: {
      baseCourseId: resolved.sourceCourseId,
      baseCourseVersion: resolved.baseVersion,
      configurationIds: [...resolved.configurationIds],
      configurationVersions: [...resolved.configurationVersions],
      configurationHashes: [...resolved.configurationHashes],
      competitionId: response.competitionId ?? null,
      competitionRuleSetId: response.competitionRuleSet?.id ?? null,
      competitionRuleVersion: response.competitionRuleSet?.version ?? null,
      effectiveAt: resolved.effectiveAt,
      warnings: [...resolved.warnings, ...(response.warning ? [response.warning] : [])],
    },
  };
}

export async function loadCourseOperations(course: Course, at: string, competitionId: string | null = null, accessToken: string | null = null, fetcher: typeof fetch = fetch) {
  const courseId = course.catalogCourseId ?? course.id;
  const parameters = new URLSearchParams({ at });
  if (competitionId) parameters.set("competitionId", competitionId);
  const response = await fetcher(`/api/courses/${encodeURIComponent(courseId)}/operations?${parameters}`, { cache: "no-store", headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined });
  if (!response.ok) return course;
  const payload: unknown = await response.json();
  const row = record(payload);
  if (!row || !record(row.resolved) || !Array.isArray(row.localRules) || !Array.isArray(row.badges)) return course;
  return courseWithResolvedOperations(course, payload as PlayerCourseOperationsResponse);
}
