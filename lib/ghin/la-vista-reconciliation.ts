import type { NormalizedGhinCourse, NormalizedGhinTee } from "./core";

export type LaVistaReconciliationStatus = "GHIN_MATCH_CONFIRMED" | "BACKYARD_ONLY" | "AMBIGUOUS" | "MISSING_DATA";

export type LaVistaLayoutReconciliation = {
  layout: "PAR_72" | "PAR_70" | "PAR_69";
  status: LaVistaReconciliationStatus;
  ghinCourseId: string | null;
  postingTeeSetIds: string[];
  diffs: Array<{ tee: string; field: "yardage" | "rating" | "slope" | "par"; backyard: number; ghin: number | null }>;
  reason: string;
};

type ExpectedTee = { names: string[]; yardage?: number; rating: number; slope: number };
type ExpectedLayout = { par: number; tees: ExpectedTee[] };

const EXPECTED: Record<"PAR_72" | "PAR_70" | "PAR_69", ExpectedLayout> = {
  PAR_72: {
    par: 72,
    tees: [
      { names: ["blue", "azules"], yardage: 7229, rating: 73.8, slope: 135 },
      { names: ["white", "blancas"], yardage: 6590, rating: 70.8, slope: 128 },
      { names: ["gold", "golden", "doradas"], yardage: 6038, rating: 68.4, slope: 121 },
      { names: ["red", "ladies", "rojas"], yardage: 5476, rating: 71.0, slope: 137 },
    ],
  },
  PAR_70: {
    par: 70,
    tees: [
      { names: ["blue", "azules"], yardage: 6790, rating: 71.2, slope: 128 },
      { names: ["white", "blancas"], yardage: 6191, rating: 68.4, slope: 121 },
      { names: ["gold", "golden", "doradas"], yardage: 5656, rating: 66.0, slope: 115 },
      { names: ["red", "ladies", "rojas"], yardage: 5156, rating: 68.6, slope: 128 },
    ],
  },
  PAR_69: {
    par: 69,
    tees: [
      { names: ["blue", "azules"], rating: 70.2, slope: 126 },
      { names: ["white", "blancas"], rating: 67.5, slope: 119 },
      { names: ["gold", "golden", "doradas"], rating: 65.2, slope: 113 },
      { names: ["red", "ladies", "rojas"], rating: 67.9, slope: 127 },
    ],
  },
};

function normalized(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase("en-US");
}

function coursePar(course: NormalizedGhinCourse) {
  if (course.par !== null) return course.par;
  const pars = [...new Set(course.tees.map((tee) => tee.par).filter((value): value is number => value !== null))];
  return pars.length === 1 ? pars[0] : null;
}

function teeByAliases(tees: readonly NormalizedGhinTee[], aliases: readonly string[]) {
  const accepted = new Set(aliases.map((value) => normalized(value)));
  const matches = tees.filter((tee) => accepted.has(normalized(tee.displayName ?? tee.name)) || accepted.has(normalized(tee.name)));
  return matches.length === 1 ? matches[0] : null;
}

function diffs(course: NormalizedGhinCourse, expected: ExpectedLayout) {
  const result: LaVistaLayoutReconciliation["diffs"] = [];
  if (coursePar(course) !== expected.par) result.push({ tee: "layout", field: "par", backyard: expected.par, ghin: coursePar(course) });
  for (const expectedTee of expected.tees) {
    const tee = teeByAliases(course.tees, expectedTee.names);
    const label = expectedTee.names[0];
    if (expectedTee.yardage !== undefined && tee?.totalYards !== expectedTee.yardage) {
      result.push({ tee: label, field: "yardage", backyard: expectedTee.yardage, ghin: tee?.totalYards ?? null });
    }
    if (tee?.courseRating !== expectedTee.rating) result.push({ tee: label, field: "rating", backyard: expectedTee.rating, ghin: tee?.courseRating ?? null });
    if (tee?.slopeRating !== expectedTee.slope) result.push({ tee: label, field: "slope", backyard: expectedTee.slope, ghin: tee?.slopeRating ?? null });
  }
  return result;
}

function isTemporaryName(course: NormalizedGhinCourse) {
  return /temporary|temporal|\btemp\b/.test(normalized(`${course.name ?? ""} ${course.facilityName ?? ""}`));
}

function signatureMatches(course: NormalizedGhinCourse, expected: ExpectedLayout) {
  if (coursePar(course) !== expected.par) return false;
  if (!expected.tees.every((tee) => tee.yardage !== undefined)) return false;
  if (course.holes !== 9 && course.holes !== 18) return false;
  const completeHoleConfiguration = course.tees.some((tee) => tee.holeData.length === course.holes
    && tee.holeData.every((hole) => hole.par !== null && hole.strokeIndex !== null));
  if (!completeHoleConfiguration) return false;
  return expected.tees.every((expectedTee) => {
    const tee = teeByAliases(course.tees, expectedTee.names);
    return Boolean(tee
      && tee.courseRating === expectedTee.rating
      && tee.slopeRating === expectedTee.slope
      && (expectedTee.yardage === undefined || tee.totalYards === expectedTee.yardage));
  });
}

function postingIdsForCourse(course: NormalizedGhinCourse, postingTeesByCourseId: Readonly<Record<string, readonly NormalizedGhinTee[]>>) {
  return course.id ? (postingTeesByCourseId[course.id] ?? []).flatMap((tee) => tee.id ? [tee.id] : []) : [];
}

export function reconcileLaVistaLayouts(
  courses: readonly NormalizedGhinCourse[],
  postingTeesByCourseId: Readonly<Record<string, readonly NormalizedGhinTee[]>>,
): LaVistaLayoutReconciliation[] {
  const vista = courses.filter((course) => normalized(`${course.name ?? ""} ${course.facilityName ?? ""}`).includes("la vista"));
  const par72Candidates = vista.filter((course) => course.id === "23233"
    || (!isTemporaryName(course) && coursePar(course) === 72));
  const par72 = par72Candidates.length === 1 ? par72Candidates[0] : null;
  const output: LaVistaLayoutReconciliation[] = [{
    layout: "PAR_72",
    status: par72Candidates.length > 1 ? "AMBIGUOUS" : par72 ? "GHIN_MATCH_CONFIRMED" : "MISSING_DATA",
    ghinCourseId: par72?.id ?? null,
    postingTeeSetIds: par72 ? postingIdsForCourse(par72, postingTeesByCourseId) : [],
    diffs: par72 ? diffs(par72, EXPECTED.PAR_72) : [],
    reason: par72Candidates.length > 1
      ? "Multiple GHIN Par 72 candidates require manual reconciliation."
      : par72
        ? "The known La Vista GHIN course identity is present; differences are reported and never silently overwritten."
        : "The known La Vista Par 72 identity was not returned with sufficient data.",
  }];

  for (const layout of ["PAR_70", "PAR_69"] as const) {
    const expected = EXPECTED[layout];
    const exact = vista.filter((course) => isTemporaryName(course) && signatureMatches(course, expected));
    const samePar = vista.filter((course) => isTemporaryName(course) && coursePar(course) === expected.par);
    const match = exact.length === 1 ? exact[0] : null;
    output.push({
      layout,
      status: exact.length > 1 ? "AMBIGUOUS" : match ? "GHIN_MATCH_CONFIRMED" : samePar.length ? "MISSING_DATA" : "BACKYARD_ONLY",
      ghinCourseId: match?.id ?? null,
      postingTeeSetIds: match ? postingIdsForCourse(match, postingTeesByCourseId) : [],
      diffs: samePar.length === 1 ? diffs(samePar[0], expected) : [],
      reason: exact.length > 1
        ? "Multiple GHIN temporary layouts have the same complete signature."
        : match
          ? "Par, tees, ratings, slopes and known yardages match the Backyard layout signature."
          : samePar.length
            ? "A GHIN temporary layout has the same par but lacks an exact full-data signature match."
            : "No GHIN temporary layout matches; the Backyard provisional identity remains separate and non-postable.",
    });
  }
  return output;
}
