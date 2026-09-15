import pueblaCatalogJson from "../data/curated-puebla-courses.json";
import { inspectInternalCourse } from "./course-catalog";
import type { BackyardIndexRatedTeeEvidence, Course, Hole } from "./types";

/** Reviewed primary-source references, not an official WHS/GHIN rating directory. */
type CuratedSource = {
  authority: string;
  url: string;
  publishedAt?: string;
  verifiedAt: string;
};

export type CuratedPueblaClub = {
  id: string;
  courseId: string;
  name: string;
  countryCode: "MX";
  stateCode: "MX-PUE";
  city?: string;
  status: string;
  holesCount?: number;
  par?: number;
  source: CuratedSource;
  holePars?: number[];
  holeStrokeIndexes?: number[];
  notes: string;
};

export type CuratedPueblaTee = {
  id: string;
  courseId: string;
  name: string;
  color: string;
  defaultSelectionPriority?: number;
  status: "CLUB_SCORECARD_CONSISTENT_LOCAL_RATING" | "SOURCE_TOTAL_CONFLICT";
  clubPublishedRating: number;
  clubPublishedSlope: number;
  totalYards: number;
  publishedFrontYards?: number;
  publishedBackYards?: number;
  holeYards: number[];
};

export type CuratedTeeLookup = {
  tee: CuratedPueblaTee;
  club: CuratedPueblaClub;
  dataVersion: string;
  eligibleForLocalIndex: boolean;
  eligibleForOfficialGhin: false;
  courseStatus: "COURSE_AVAILABLE" | "COURSE_REFERENCE_ONLY";
  teeStatus: "TEE_UNVERIFIED" | "TEE_INDEX_ELIGIBLE";
  issues: string[];
};

type CuratedPueblaCatalog = {
  schemaVersion: 1;
  dataVersion: string;
  clubs: CuratedPueblaClub[];
  tees: CuratedPueblaTee[];
};

const catalog = pueblaCatalogJson as CuratedPueblaCatalog;

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function completeParAndStrokeIndex(club: CuratedPueblaClub) {
  const count = club.holesCount;
  if (count !== 9 && count !== 18) return false;
  if (club.holePars?.length !== count || club.holeStrokeIndexes?.length !== count) return false;
  if (!club.holePars.every((par) => Number.isInteger(par) && par >= 3 && par <= 6)) return false;
  if (sum(club.holePars) !== club.par) return false;
  const strokeIndexes = club.holeStrokeIndexes;
  return new Set(strokeIndexes).size === count
    && Array.from({ length: count }, (_, index) => index + 1).every((value) => strokeIndexes.includes(value));
}

function validPrimarySource(club: CuratedPueblaClub) {
  return Boolean(
    club.source
      && typeof club.source.authority === "string"
      && club.source.authority.trim()
      && /^https:\/\/[^\s]+$/i.test(club.source.url)
      && /^\d{4}-\d{2}-\d{2}$/.test(club.source.verifiedAt)
      && typeof catalog.dataVersion === "string"
      && catalog.dataVersion.trim(),
  );
}

/** Fail-closed validation: the club's displayed totals must match all hole rows. */
export function validateCuratedPueblaTee(tee: CuratedPueblaTee, club: CuratedPueblaClub): string[] {
  const issues: string[] = [];
  if (tee.courseId !== club.courseId) issues.push("COURSE_ID_MISMATCH");
  if (!validPrimarySource(club)) issues.push("PRIMARY_SOURCE_MISSING");
  if (!completeParAndStrokeIndex(club)) issues.push("HOLE_PAR_STROKE_INDEX_INCOMPLETE");
  if (!Number.isFinite(tee.clubPublishedRating) || tee.clubPublishedRating < 40 || tee.clubPublishedRating > 85) issues.push("RATING_INVALID");
  if (!Number.isInteger(tee.clubPublishedSlope) || tee.clubPublishedSlope < 55 || tee.clubPublishedSlope > 155) issues.push("SLOPE_INVALID");
  if (!Number.isInteger(tee.totalYards) || tee.totalYards <= 0) issues.push("TOTAL_YARDS_INVALID");
  if (!Array.isArray(tee.holeYards) || tee.holeYards.length !== club.holesCount || !tee.holeYards.every((yards) => Number.isInteger(yards) && yards > 0)) {
    issues.push("HOLE_YARDS_INCOMPLETE");
  } else {
    if (sum(tee.holeYards) !== tee.totalYards) issues.push("SOURCE_TOTAL_CONFLICT");
    if (tee.publishedFrontYards !== undefined && sum(tee.holeYards.slice(0, 9)) !== tee.publishedFrontYards) issues.push("SOURCE_FRONT_CONFLICT");
    if (tee.publishedBackYards !== undefined && sum(tee.holeYards.slice(9)) !== tee.publishedBackYards) issues.push("SOURCE_BACK_CONFLICT");
    if (tee.publishedFrontYards !== undefined && tee.publishedBackYards !== undefined && tee.publishedFrontYards + tee.publishedBackYards !== tee.totalYards) {
      issues.push("SOURCE_PUBLISHED_TOTAL_CONFLICT");
    }
  }
  if (tee.status !== "CLUB_SCORECARD_CONSISTENT_LOCAL_RATING") issues.push("TEE_NOT_SOURCE_CONSISTENT");
  return issues;
}

function cloneClub(club: CuratedPueblaClub): CuratedPueblaClub {
  return {
    ...club,
    source: { ...club.source },
    ...(club.holePars ? { holePars: [...club.holePars] } : {}),
    ...(club.holeStrokeIndexes ? { holeStrokeIndexes: [...club.holeStrokeIndexes] } : {}),
  };
}

function cloneTee(tee: CuratedPueblaTee): CuratedPueblaTee {
  return { ...tee, holeYards: [...tee.holeYards] };
}

function byTeeId(teeId: string): CuratedTeeLookup | null {
  if (catalog.schemaVersion !== 1 || !teeId) return null;
  const tee = catalog.tees.find((row) => row.id === teeId);
  const club = tee && catalog.clubs.find((row) => row.courseId === tee.courseId);
  if (!tee || !club) return null;
  const issues = validateCuratedPueblaTee(tee, club);
  const courseAvailable = catalog.tees.some((candidate) => candidate.courseId === club.courseId && validateCuratedPueblaTee(candidate, club).length === 0);
  return {
    tee: cloneTee(tee),
    club: cloneClub(club),
    dataVersion: catalog.dataVersion,
    eligibleForLocalIndex: issues.length === 0,
    eligibleForOfficialGhin: false,
    courseStatus: courseAvailable ? "COURSE_AVAILABLE" : "COURSE_REFERENCE_ONLY",
    teeStatus: issues.length === 0 ? "TEE_INDEX_ELIGIBLE" : "TEE_UNVERIFIED",
    issues,
  };
}

function evidenceFor(lookup: CuratedTeeLookup): BackyardIndexRatedTeeEvidence | null {
  if (!lookup.eligibleForLocalIndex) return null;
  return {
    kind: "CURATED_RATED_TEE",
    authority: lookup.club.source.authority,
    sourceUrl: lookup.club.source.url,
    verifiedAt: lookup.club.source.verifiedAt,
    dataVersion: lookup.dataVersion,
    courseId: lookup.club.courseId,
    teeId: lookup.tee.id,
    courseRating: lookup.tee.clubPublishedRating,
    slopeRating: lookup.tee.clubPublishedSlope,
  };
}

function playableSelectionFor(lookup: CuratedTeeLookup): Course | null {
  if (!lookup.eligibleForLocalIndex) return null;
  const holePars = lookup.club.holePars;
  const holeStrokeIndexes = lookup.club.holeStrokeIndexes;
  if (!holePars || !holeStrokeIndexes) return null;
  const holes: Hole[] = holePars.map((par, index) => ({
    number: index + 1,
    par,
    strokeIndex: holeStrokeIndexes[index],
    yards: lookup.tee.holeYards[index],
  }));
  const evidence = evidenceFor(lookup);
  if (!evidence) return null;
  return {
    id: lookup.tee.id,
    name: lookup.club.name,
    teeName: lookup.tee.name,
    rating: lookup.tee.clubPublishedRating,
    slope: lookup.tee.clubPublishedSlope,
    totalYards: lookup.tee.totalYards,
    holes,
    builtIn: true,
    catalogClubId: lookup.club.id,
    catalogCourseId: lookup.club.courseId,
    catalogTeeId: lookup.tee.id,
    clubName: lookup.club.name,
    city: lookup.club.city,
    stateRegion: "Puebla",
    country: "México",
    provider: "BACKYARD_CURATED_PUEBLA",
    sourceName: lookup.club.source.authority,
    sourceAuthority: lookup.club.source.authority,
    sourceUrl: lookup.club.source.url,
    verifiedAt: lookup.club.source.verifiedAt,
    dataVersion: lookup.dataVersion,
    indexRatingEvidence: evidence,
  };
}

export const curatedPueblaCourseProvider = {
  id: "backyard-curated-puebla",
  kind: "curated-primary-source" as const,
  dataVersion: catalog.dataVersion,
  listCourses(): CuratedPueblaClub[] {
    return catalog.clubs.map(cloneClub);
  },
  getTeeById: byTeeId,
  getCourseStatusById(courseId: string): "COURSE_AVAILABLE" | "COURSE_REFERENCE_ONLY" | null {
    const club = catalog.clubs.find((row) => row.courseId === courseId);
    if (!club) return null;
    return catalog.tees.some((tee) => tee.courseId === courseId && validateCuratedPueblaTee(tee, club).length === 0)
      ? "COURSE_AVAILABLE"
      : "COURSE_REFERENCE_ONLY";
  },
  getIndexRatedTeeEvidenceById(teeId: string): BackyardIndexRatedTeeEvidence | null {
    const lookup = byTeeId(teeId);
    return lookup ? evidenceFor(lookup) : null;
  },
  getPlayableSelectionByTeeId(teeId: string): Course | null {
    const lookup = byTeeId(teeId);
    return lookup ? playableSelectionFor(lookup) : null;
  },
  listPlayableSelections(): Course[] {
    return [...catalog.tees]
      .sort((left, right) => (left.defaultSelectionPriority ?? 999) - (right.defaultSelectionPriority ?? 999) || left.name.localeCompare(right.name, "es-MX"))
      .map((tee) => byTeeId(tee.id))
      .map((lookup) => lookup ? playableSelectionFor(lookup) : null)
      .filter((course): course is Course => course !== null);
  },
};

/** Casual scoring availability and Index tee eligibility are independent states. */
export function getCourseDataStatusForSelection(course: Course): {
  courseStatus: "COURSE_AVAILABLE" | "COURSE_REFERENCE_ONLY";
  teeStatus: "TEE_UNVERIFIED" | "TEE_INDEX_ELIGIBLE";
} {
  const playable = inspectInternalCourse(course).playable;
  return {
    courseStatus: playable ? "COURSE_AVAILABLE" : "COURSE_REFERENCE_ONLY",
    teeStatus: playable && getCuratedIndexRatedTeeEvidenceForCourse(course) ? "TEE_INDEX_ELIGIBLE" : "TEE_UNVERIFIED",
  };
}

/** A modified/legacy course with matching IDs is not enough: all tee facts and provenance must match. */
export function getCuratedIndexRatedTeeEvidenceForCourse(course: Course): BackyardIndexRatedTeeEvidence | null {
  if (course.provider !== "BACKYARD_CURATED_PUEBLA" || !course.catalogTeeId) return null;
  const expected = curatedPueblaCourseProvider.getPlayableSelectionByTeeId(course.catalogTeeId);
  if (!expected) return null;
  if (course.id !== expected.id || course.catalogClubId !== expected.catalogClubId || course.catalogCourseId !== expected.catalogCourseId) return null;
  if (course.sourceAuthority !== expected.sourceAuthority || course.sourceUrl !== expected.sourceUrl || course.verifiedAt !== expected.verifiedAt || course.dataVersion !== expected.dataVersion) return null;
  if (course.rating !== expected.rating || course.slope !== expected.slope || course.totalYards !== expected.totalYards || course.holes.length !== expected.holes.length) return null;
  if (!course.holes.every((hole, index) => (
    hole.number === expected.holes[index].number
      && hole.par === expected.holes[index].par
      && hole.strokeIndex === expected.holes[index].strokeIndex
      && hole.yards === expected.holes[index].yards
  ))) return null;
  return expected.indexRatingEvidence ? { ...expected.indexRatingEvidence } : null;
}
