import courseSeedJson from "../data/golf-course-catalog.seed.json";
import { withDefaultLaVistaRules } from "./local-rules";
import { curatedPueblaCourseProvider } from "./curated-puebla-course-data";
import { scorecardProfileIndexEvidence } from "./scorecard-index-evidence";
import type { Course } from "./types";
import type { ScorecardProfileProvenance } from "./course-scorecard-profiles";

export type CourseDataProvenance = {
  provider: string;
  providerExternalId?: string;
  catalogVersion?: number;
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  dataEnvironment?: "PRODUCTION" | "QA" | "TEST" | "SYNTHETIC";
};

export type GeographicPoint = {
  latitude: number;
  longitude: number;
};

export type GolfClub = CourseDataProvenance & {
  id: string;
  name: string;
  aliases?: string[];
  country?: string;
  stateRegion?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  phone?: string;
  website?: string;
  active: boolean;
};

export type GolfCourse = CourseDataProvenance & {
  id: string;
  clubId: string;
  name: string;
  aliases?: string[];
  holes: 9 | 18;
  latitude?: number;
  longitude?: number;
  active: boolean;
  origin?: "GHIN" | "BACKYARD_PROVISIONAL" | "BACKYARD_ADMIN";
  isProvisional?: boolean;
  providerStatus?: string;
  ghinPostEligible?: boolean;
};

export type GolfCourseTee = {
  id: string;
  courseId: string;
  legacySelectionId: string;
  name: string;
  color?: string;
  gender?: string;
  rating?: number;
  slope?: number;
  par?: number;
  totalYards?: number;
  totalMeters?: number;
  frontNineRating?: number;
  backNineRating?: number;
  active: boolean;
  dataEnvironment?: "PRODUCTION" | "QA" | "TEST" | "SYNTHETIC";
  provider?: string;
  providerCourseId?: string;
  providerTeeSetRatingId?: string;
  providerStatus?: string;
  ghinPostEligible?: boolean;
};

export type GolfScorecardProfileTee = {
  teeId: string;
  ratingGender: string;
  par: number | null;
  courseRating: number | null;
  bogeyRating: number | null;
  slopeRating: number | null;
  frontNineRating: number | null;
  frontNineSlope: number | null;
  backNineRating: number | null;
  backNineSlope: number | null;
  totalYards: number | null;
  totalMeters: number | null;
  sourceExternalId: string | null;
  providerStatus: string | null;
};

export type GolfScorecardProfileHole = { holeId: string; holeNumber: number; ratingGender: string; strokeIndex: number };
export type GolfScorecardProfile = {
  id: string;
  courseId: string;
  name: string;
  provenance: ScorecardProfileProvenance;
  sourceProvider: string;
  sourceExternalId: string | null;
  verifiedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  historical: boolean;
  defaultForPlay: boolean;
  status: string;
  tees: GolfScorecardProfileTee[];
  holes: GolfScorecardProfileHole[];
};

export function playerVisibleTeeRating(
  course: Pick<GolfCourse, "sourceUrl" | "verifiedAt">,
  tee: Pick<GolfCourseTee, "rating" | "slope"> | undefined,
) {
  const verified = Boolean(
    course.sourceUrl
    && course.verifiedAt
    && typeof tee?.rating === "number"
    && typeof tee.slope === "number",
  );
  return verified ? { verified: true as const, rating: tee!.rating!, slope: tee!.slope! } : { verified: false as const };
}

export type GolfHole = {
  id: string;
  courseId: string;
  holeNumber: number;
  par: number;
  strokeIndex: number;
  teeLatitude?: number;
  teeLongitude?: number;
  greenCenterLatitude?: number;
  greenCenterLongitude?: number;
  greenFrontLatitude?: number;
  greenFrontLongitude?: number;
  greenBackLatitude?: number;
  greenBackLongitude?: number;
};

export type TeeHoleYardage = {
  teeId: string;
  holeId: string;
  holeNumber: number;
  yards?: number;
  meters?: number;
};

export type GolfHoleGeoFeatureType =
  | "TEE"
  | "GREEN_CENTER"
  | "GREEN_FRONT"
  | "GREEN_BACK"
  | "BUNKER"
  | "WATER"
  | "LAYUP"
  | "DOGLEG"
  | "OB"
  | "PENALTY_AREA"
  | "LANDMARK"
  | "OTHER";

export type GolfHoleGeoFeature = CourseDataProvenance & {
  id: string;
  holeId: string;
  type: GolfHoleGeoFeatureType;
  latitude?: number;
  longitude?: number;
  geometry?: Readonly<Record<string, unknown>>;
  label?: string;
};

export type GolfCourseCatalog = {
  schemaVersion: 1;
  clubs: GolfClub[];
  courses: GolfCourse[];
  tees: GolfCourseTee[];
  holes: GolfHole[];
  teeHoleYardages: TeeHoleYardage[];
  geoFeatures: GolfHoleGeoFeature[];
  scorecardProfiles?: GolfScorecardProfile[];
};

type SeedClub = {
  id: string;
  name: string;
  country: string | null;
  stateRegion: string | null;
  city: string | null;
  address: string | null;
  timezone: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  provider: string;
  providerExternalId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  active: boolean;
};

type SeedCourse = {
  id: string;
  clubId: string;
  name: string;
  holes: number;
  latitude: number | null;
  longitude: number | null;
  pars: number[];
  strokeIndexes: number[];
  provider: string;
  providerExternalId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  active: boolean;
};

type SeedTee = {
  id: string;
  courseId: string;
  legacySelectionId: string;
  name: string;
  color: string | null;
  gender: string | null;
  rating: number | null;
  slope: number | null;
  par: number | null;
  totalYards: number | null;
  totalMeters: number | null;
  yardages: number[] | null;
  active: boolean;
};

type SeedLegacySelection = {
  id: string;
  name: string;
  teeName: string;
  rating: number | null;
  slope: number | null;
  pars: number[];
  strokeIndexes: number[];
  updatedAt?: string;
};

type CourseSeedFile = {
  schemaVersion: number;
  clubs: SeedClub[];
  courses: SeedCourse[];
  tees: SeedTee[];
  legacySelections: SeedLegacySelection[];
};

const courseSeed = courseSeedJson as CourseSeedFile;

function optionalText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function geographicPoint(latitude: number | null | undefined, longitude: number | null | undefined) {
  if (latitude === null && longitude === null) return {};
  const validLatitude = typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
  const validLongitude = typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!validLatitude || !validLongitude) throw new Error("Invalid or incomplete golf course coordinates");
  return { latitude, longitude } as GeographicPoint;
}

function validHoleDefinition(course: SeedCourse) {
  if (course.holes !== 9 && course.holes !== 18) return false;
  if (course.pars.length !== course.holes || course.strokeIndexes.length !== course.holes) return false;
  if (!course.pars.every((par) => Number.isInteger(par) && par >= 3 && par <= 6)) return false;
  const expected = Array.from({ length: course.holes }, (_, index) => index + 1);
  return new Set(course.strokeIndexes).size === course.holes
    && expected.every((strokeIndex) => course.strokeIndexes.includes(strokeIndex));
}

function provenance(value: Pick<SeedClub | SeedCourse, "provider" | "providerExternalId" | "sourceName" | "sourceUrl" | "verifiedAt">): CourseDataProvenance {
  return {
    provider: value.provider,
    ...(optionalText(value.providerExternalId) ? { providerExternalId: optionalText(value.providerExternalId) } : {}),
    ...(optionalText(value.sourceName) ? { sourceName: optionalText(value.sourceName) } : {}),
    ...(optionalText(value.sourceUrl) ? { sourceUrl: optionalText(value.sourceUrl) } : {}),
    ...(optionalText(value.verifiedAt) ? { verifiedAt: optionalText(value.verifiedAt) } : {}),
  };
}

export function buildSeedGolfCourseCatalog(): GolfCourseCatalog {
  if (courseSeed.schemaVersion !== 1) throw new Error("Unsupported golf course seed version");
  const clubs: GolfClub[] = courseSeed.clubs.map((club) => ({
    id: club.id,
    name: club.name.trim(),
    ...provenance(club),
    ...(optionalText(club.country) ? { country: optionalText(club.country) } : {}),
    ...(optionalText(club.stateRegion) ? { stateRegion: optionalText(club.stateRegion) } : {}),
    ...(optionalText(club.city) ? { city: optionalText(club.city) } : {}),
    ...(optionalText(club.address) ? { address: optionalText(club.address) } : {}),
    ...geographicPoint(club.latitude, club.longitude),
    ...(optionalText(club.timezone) ? { timezone: optionalText(club.timezone) } : {}),
    ...(optionalText(club.phone) ? { phone: optionalText(club.phone) } : {}),
    ...(optionalText(club.website) ? { website: optionalText(club.website) } : {}),
    active: club.active,
  }));
  const clubIds = new Set(clubs.map((club) => club.id));
  const courses: GolfCourse[] = courseSeed.courses.map((course) => {
    if (!clubIds.has(course.clubId) || !validHoleDefinition(course)) throw new Error(`Invalid golf course seed: ${course.id}`);
    return {
      id: course.id,
      clubId: course.clubId,
      name: course.name.trim(),
      holes: course.holes as 9 | 18,
      ...geographicPoint(course.latitude, course.longitude),
      ...provenance(course),
      active: course.active,
    };
  });
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const holes: GolfHole[] = courseSeed.courses.flatMap((course) => course.pars.map((par, index) => ({
    id: `${course.id}-hole-${index + 1}`,
    courseId: course.id,
    holeNumber: index + 1,
    par,
    strokeIndex: course.strokeIndexes[index],
  })));
  const holeByCourseAndNumber = new Map(holes.map((hole) => [`${hole.courseId}:${hole.holeNumber}`, hole]));
  const tees: GolfCourseTee[] = courseSeed.tees.map((tee) => {
    const course = courseById.get(tee.courseId);
    if (!course || (tee.yardages && tee.yardages.length !== course.holes)) throw new Error(`Invalid golf course tee seed: ${tee.id}`);
    return {
      id: tee.id,
      courseId: tee.courseId,
      legacySelectionId: tee.legacySelectionId,
      name: tee.name.trim(),
      ...(optionalText(tee.color) ? { color: optionalText(tee.color) } : {}),
      ...(optionalText(tee.gender) ? { gender: optionalText(tee.gender) } : {}),
      ...(optionalNumber(tee.rating) !== undefined ? { rating: optionalNumber(tee.rating) } : {}),
      ...(optionalNumber(tee.slope) !== undefined ? { slope: optionalNumber(tee.slope) } : {}),
      ...(optionalNumber(tee.par) !== undefined ? { par: optionalNumber(tee.par) } : {}),
      ...(optionalNumber(tee.totalYards) !== undefined ? { totalYards: optionalNumber(tee.totalYards) } : {}),
      ...(optionalNumber(tee.totalMeters) !== undefined ? { totalMeters: optionalNumber(tee.totalMeters) } : {}),
      active: tee.active,
    };
  });
  const teeHoleYardages: TeeHoleYardage[] = courseSeed.tees.flatMap((tee) => (tee.yardages ?? []).map((yards, index) => {
    const hole = holeByCourseAndNumber.get(`${tee.courseId}:${index + 1}`);
    if (!hole) throw new Error(`Missing hole for golf course tee seed: ${tee.id}`);
    return { teeId: tee.id, holeId: hole.id, holeNumber: hole.holeNumber, yards };
  }));
  return { schemaVersion: 1, clubs, courses, tees, holes, teeHoleYardages, geoFeatures: [] };
}

export const INTERNAL_GOLF_COURSE_CATALOG = buildSeedGolfCourseCatalog();

export function golfCourseSelectionToLegacyCourse(
  catalog: GolfCourseCatalog,
  teeId: string,
  scorecardProfileId?: string,
  ratingGender?: string,
  scorecardSourceUrl?: string,
): Course | null {
  const tee = catalog.tees.find((candidate) => candidate.id === teeId && candidate.active);
  if (!tee) return null;
  const golfCourse = catalog.courses.find((candidate) => candidate.id === tee.courseId && candidate.active);
  if (!golfCourse) return null;
  const club = catalog.clubs.find((candidate) => candidate.id === golfCourse.clubId && candidate.active);
  if (!club) return null;
  const yardages = new Map(catalog.teeHoleYardages.filter((record) => record.teeId === tee.id).map((record) => [record.holeNumber, record.yards]));
  const profile = scorecardProfileId
    ? catalog.scorecardProfiles?.find((candidate) => candidate.id === scorecardProfileId && candidate.courseId === golfCourse.id && candidate.active && !candidate.historical)
    : undefined;
  const profileTee = profile?.tees.find((candidate) => candidate.teeId === tee.id && (!ratingGender || candidate.ratingGender === ratingGender));
  const profileStrokeIndexes = new Map((profile?.holes || [])
    .filter((hole) => !profileTee || hole.ratingGender === profileTee.ratingGender || hole.ratingGender === "UNSPECIFIED")
    .sort((left, right) => Number(right.ratingGender !== profileTee?.ratingGender) - Number(left.ratingGender !== profileTee?.ratingGender))
    .map((hole) => [hole.holeNumber, hole.strokeIndex]));
  const holes = catalog.holes
    .filter((hole) => hole.courseId === golfCourse.id)
    .sort((left, right) => left.holeNumber - right.holeNumber)
    .map((hole) => ({
      number: hole.holeNumber,
      par: hole.par,
      strokeIndex: profileStrokeIndexes.get(hole.holeNumber) ?? hole.strokeIndex,
      ...(yardages.get(hole.holeNumber) !== undefined ? { yards: yardages.get(hole.holeNumber) } : {}),
      ...(hole.teeLatitude !== undefined ? { teeLatitude: hole.teeLatitude, teeLongitude: hole.teeLongitude } : {}),
      ...(hole.greenFrontLatitude !== undefined ? { greenFrontLatitude: hole.greenFrontLatitude, greenFrontLongitude: hole.greenFrontLongitude } : {}),
      ...(hole.greenCenterLatitude !== undefined ? { greenCenterLatitude: hole.greenCenterLatitude, greenCenterLongitude: hole.greenCenterLongitude } : {}),
      ...(hole.greenBackLatitude !== undefined ? { greenBackLatitude: hole.greenBackLatitude, greenBackLongitude: hole.greenBackLongitude } : {}),
    }));
  if (holes.length !== golfCourse.holes) return null;
  const point = golfCourse.latitude !== undefined && golfCourse.longitude !== undefined
    ? { latitude: golfCourse.latitude, longitude: golfCourse.longitude }
    : club.latitude !== undefined && club.longitude !== undefined
      ? { latitude: club.latitude, longitude: club.longitude }
      : null;
  const profileRating = profileTee && typeof profileTee.courseRating === "number" && typeof profileTee.slopeRating === "number"
    ? { verified: true as const, rating: profileTee.courseRating, slope: profileTee.slopeRating }
    : null;
  const visibleRating = profileRating ?? playerVisibleTeeRating(golfCourse, tee);
  const selectionId = profile ? `${tee.legacySelectionId}::${profile.id}::${profileTee?.ratingGender || "UNSPECIFIED"}` : tee.legacySelectionId;
  const indexRatingEvidence = scorecardProfileIndexEvidence(
    { ...golfCourse, sourceUrl: scorecardSourceUrl || golfCourse.sourceUrl }, tee, profile, profileTee, ratingGender,
  );
  return withDefaultLaVistaRules({
    id: selectionId,
    name: golfCourse.name,
    teeName: tee.name,
    ...(visibleRating.verified ? { rating: visibleRating.rating, slope: visibleRating.slope } : {}),
    ...((profileTee?.totalYards ?? tee.totalYards) !== undefined && (profileTee?.totalYards ?? tee.totalYards) !== null ? { totalYards: (profileTee?.totalYards ?? tee.totalYards)! } : {}),
    holes,
    builtIn: true,
    catalogClubId: club.id,
    catalogCourseId: golfCourse.id,
    catalogTeeId: tee.id,
    roundTeeSelectionId: selectionId,
    ...(profileTee?.ratingGender || tee.gender ? { scorecardRatingGender: profileTee?.ratingGender || tee.gender } : {}),
    ...(indexRatingEvidence ? { indexRatingEvidence } : {}),
    ...(profile ? {
      scorecardProfileId: profile.id,
      scorecardProfileName: profile.name,
      scorecardProfileProvenance: profile.provenance,
      scorecardProfileDefaultForPlay: profile.defaultForPlay,
      scorecardProfileHistorical: profile.historical,
      ...(profile.effectiveFrom ? { scorecardProfileEffectiveFrom: profile.effectiveFrom } : {}),
      ...(profile.effectiveTo ? { scorecardProfileEffectiveTo: profile.effectiveTo } : {}),
      ...(profile.verifiedAt ? { scorecardProfileVerifiedAt: profile.verifiedAt } : {}),
      ...(indexRatingEvidence ? { scorecardProfileSourceUrl: indexRatingEvidence.sourceUrl } : {}),
    } : {}),
    clubName: club.name,
    ...(club.city ? { city: club.city } : {}),
    ...(club.stateRegion ? { stateRegion: club.stateRegion } : {}),
    ...(club.country ? { country: club.country } : {}),
    ...(club.address ? { address: club.address } : {}),
    ...(point ?? {}),
    ...(club.timezone ? { timezone: club.timezone } : {}),
    provider: golfCourse.provider,
    ...(golfCourse.providerExternalId ? { providerExternalId: golfCourse.providerExternalId } : {}),
    ...(golfCourse.sourceName ? { sourceName: golfCourse.sourceName } : {}),
    ...(golfCourse.sourceUrl ? { sourceUrl: golfCourse.sourceUrl } : {}),
    ...(golfCourse.verifiedAt ? { verifiedAt: golfCourse.verifiedAt } : {}),
    ...(golfCourse.origin ? { layoutOrigin: golfCourse.origin } : {}),
    ...(golfCourse.isProvisional !== undefined ? { isProvisional: golfCourse.isProvisional } : {}),
    ...(tee.providerCourseId ? { providerCourseId: tee.providerCourseId } : {}),
    ...(tee.providerTeeSetRatingId ? { providerTeeSetRatingId: tee.providerTeeSetRatingId } : {}),
    ...(tee.providerStatus ? { providerStatus: tee.providerStatus } : {}),
    ...(tee.ghinPostEligible !== undefined ? { ghinPostEligible: tee.ghinPostEligible } : {}),
  });
}

function legacySeedCourse(selection: SeedLegacySelection): Course {
  if (selection.pars.length !== 18 || selection.strokeIndexes.length !== 18) throw new Error(`Invalid legacy course seed: ${selection.id}`);
  return withDefaultLaVistaRules({
    id: selection.id,
    name: selection.name,
    teeName: selection.teeName,
    ...(optionalNumber(selection.rating) !== undefined ? { rating: optionalNumber(selection.rating) } : {}),
    ...(optionalNumber(selection.slope) !== undefined ? { slope: optionalNumber(selection.slope) } : {}),
    holes: selection.pars.map((par, index) => ({ number: index + 1, par, strokeIndex: selection.strokeIndexes[index] })),
    builtIn: true,
    ...(selection.updatedAt ? { updatedAt: selection.updatedAt } : {}),
    provider: "BACKYARD_LEGACY",
    sourceName: "The Backyard legacy scorecard",
  });
}

const catalogSelections = INTERNAL_GOLF_COURSE_CATALOG.tees
  .map((tee) => golfCourseSelectionToLegacyCourse(INTERNAL_GOLF_COURSE_CATALOG, tee.id))
  .filter((selection): selection is Course => selection !== null);
const selectionById = new Map(catalogSelections.map((selection) => [selection.id, selection]));
const legacySelections = courseSeed.legacySelections.map(legacySeedCourse);
const preferredOrder = [
  "lavista-blancas",
  "lavista-temporal-white",
  "lavista-azules",
  "lavista-doradas",
  "lavista-rojas",
  "campestre-puebla-general",
  "el-cristo-general",
  "cola-de-lagarto-general",
];

export const DEFAULT_COURSES: Course[] = [
  ...preferredOrder.map((id) => selectionById.get(id) ?? legacySelections.find((selection) => selection.id === id))
    .filter((selection): selection is Course => Boolean(selection)),
  ...curatedPueblaCourseProvider.listPlayableSelections(),
];

export const DEFAULT_LA_VISTA_COURSE = DEFAULT_COURSES.find((course) => course.id === "lavista-blancas")!;
export const DEFAULT_LA_VISTA_TEMPORAL_COURSE = DEFAULT_COURSES.find((course) => course.id === "lavista-temporal-white")!;
