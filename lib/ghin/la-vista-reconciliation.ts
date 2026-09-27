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

type ExpectedTee = { names: string[]; gender?: "male" | "female"; yardage?: number; rating: number; slope: number };
type ExpectedLayout = { par: number; tees: ExpectedTee[] };

const LA_VISTA_GHIN_IDENTITY = {
  facilityId: "19886",
  courseId: "23233",
  facilityName: "La Vista Country Club",
  courseName: "La Vista Country Club",
} as const;

const EXPECTED: Record<"PAR_72" | "PAR_70" | "PAR_69", ExpectedLayout> = {
  PAR_72: {
    par: 72,
    tees: [
      { names: ["blue", "azules"], gender: "male", yardage: 7229, rating: 73.8, slope: 135 },
      { names: ["white", "blancas"], gender: "male", yardage: 6590, rating: 70.8, slope: 128 },
      { names: ["gold", "golden", "doradas"], gender: "male", yardage: 6038, rating: 68.4, slope: 121 },
      { names: ["red", "ladies", "rojas"], gender: "female", yardage: 5476, rating: 71.0, slope: 137 },
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

function teeByAliases(tees: readonly NormalizedGhinTee[], expected: ExpectedTee) {
  const accepted = new Set(expected.names.map((value) => normalized(value)));
  const matches = tees.filter((tee) => {
    const nameMatches = accepted.has(normalized(tee.displayName ?? tee.name)) || accepted.has(normalized(tee.name));
    return nameMatches && (!expected.gender || normalized(tee.gender) === expected.gender);
  });
  return matches.length === 1 ? matches[0] : null;
}

function diffs(course: NormalizedGhinCourse, expected: ExpectedLayout) {
  const result: LaVistaLayoutReconciliation["diffs"] = [];
  if (coursePar(course) !== expected.par) result.push({ tee: "layout", field: "par", backyard: expected.par, ghin: coursePar(course) });
  for (const expectedTee of expected.tees) {
    const tee = teeByAliases(course.tees, expectedTee);
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
    const tee = teeByAliases(course.tees, expectedTee);
    return Boolean(tee
      && tee.courseRating === expectedTee.rating
      && tee.slopeRating === expectedTee.slope
      && (expectedTee.yardage === undefined || tee.totalYards === expectedTee.yardage));
  });
}

function exactOfficialIdentity(course: NormalizedGhinCourse) {
  return course.id === LA_VISTA_GHIN_IDENTITY.courseId
    && course.facilityId === LA_VISTA_GHIN_IDENTITY.facilityId
    && normalized(course.name) === normalized(LA_VISTA_GHIN_IDENTITY.courseName)
    && normalized(course.facilityName) === normalized(LA_VISTA_GHIN_IDENTITY.facilityName);
}

function officialPar72SignatureIsSufficient(course: NormalizedGhinCourse) {
  if (!exactOfficialIdentity(course) || coursePar(course) !== 72 || course.holes !== 18) return false;
  return EXPECTED.PAR_72.tees.every((expectedTee) => {
    const tee = teeByAliases(course.tees, expectedTee);
    return Boolean(tee
      && tee.courseRating === expectedTee.rating
      && tee.slopeRating === expectedTee.slope
      && tee.holeData.length === 18);
  });
}

function postingIdsForCourse(course: NormalizedGhinCourse, postingTeesByCourseId: Readonly<Record<string, readonly NormalizedGhinTee[]>>) {
  return course.id ? (postingTeesByCourseId[course.id] ?? []).flatMap((tee) => tee.id ? [tee.id] : []) : [];
}

export function laVistaTeeTargetMappings(tees: readonly NormalizedGhinTee[]) {
  const aliases: Array<[string, string[], "male" | "female"]> = [
    ["tee-la-vista-azules", ["blue", "azules"], "male"],
    ["tee-la-vista-blancas", ["white", "blancas"], "male"],
    ["tee-la-vista-doradas", ["gold", "golden", "doradas"], "male"],
    ["tee-la-vista-rojas", ["red", "ladies", "rojas"], "female"],
    ["tee-la-vista-negras", ["black", "negras"], "male"],
  ];
  return Object.fromEntries(tees.flatMap((tee) => {
    if (!tee.id) return [];
    const name = normalized(tee.displayName ?? tee.name);
    const teeGender = normalized(tee.gender);
    const target = aliases.find(([, names, expectedGender]) => names.includes(name) && teeGender === expectedGender);
    return target ? [[tee.id, target[0]]] : [];
  }));
}

export function reconcileLaVistaLayouts(
  courses: readonly NormalizedGhinCourse[],
  postingTeesByCourseId: Readonly<Record<string, readonly NormalizedGhinTee[]>>,
): LaVistaLayoutReconciliation[] {
  // Search results such as Bella Vista and Chula Vista are not La Vista. Keep
  // provider identity separate from fuzzy search text before comparing tees.
  const vista = courses.filter((course) => course.facilityId === LA_VISTA_GHIN_IDENTITY.facilityId
    && normalized(course.facilityName) === normalized(LA_VISTA_GHIN_IDENTITY.facilityName));
  const exactPar72Candidates = vista.filter(exactOfficialIdentity);
  const par72 = exactPar72Candidates.length === 1 ? exactPar72Candidates[0] : null;
  const par72Confirmed = Boolean(par72 && officialPar72SignatureIsSufficient(par72));
  const otherPar72Candidates = vista.filter((course) => !exactOfficialIdentity(course)
    && !isTemporaryName(course)
    && coursePar(course) === 72);
  const par72Ambiguous = exactPar72Candidates.length > 1
    || (par72 !== null && !par72Confirmed)
    || (par72 === null && otherPar72Candidates.length > 0);
  const output: LaVistaLayoutReconciliation[] = [{
    layout: "PAR_72",
    status: par72Confirmed ? "GHIN_MATCH_CONFIRMED" : par72Ambiguous ? "AMBIGUOUS" : "MISSING_DATA",
    ghinCourseId: par72?.id ?? null,
    postingTeeSetIds: par72 ? postingIdsForCourse(par72, postingTeesByCourseId) : [],
    diffs: par72 ? diffs(par72, EXPECTED.PAR_72) : [],
    reason: par72Confirmed
      ? "FacilityId 19886 and CourseId 23233 match the official La Vista identity; Par 72, four reference tee rating/slope pairs and 18-hole cards agree. Yardage differences remain explicit."
      : par72Ambiguous
        ? "The provider identity or the Par 72 tee/hole signature conflicts with the official La Vista evidence."
        : "FacilityId 19886 / CourseId 23233 was not returned with sufficient data.",
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
