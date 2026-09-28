import { createHash } from "node:crypto";

import type {
  NormalizedGhinCourse,
  NormalizedGhinFacility,
  NormalizedGhinTee,
} from "./core";
import { ghinPostEligibility } from "./score-posting";

export type GhinCourseSyncOrigin = "GHIN";

export type GhinCourseSyncPlan = {
  schemaVersion: 1;
  provider: "GHIN";
  facility: Record<string, unknown>;
  course: Record<string, unknown>;
  tees: Array<Record<string, unknown>>;
  holes: Array<Record<string, unknown>>;
  yardages: Array<Record<string, unknown>>;
  courseLink: Record<string, unknown>;
  teeLinks: Array<Record<string, unknown>>;
  completeForPlay: boolean;
  completeForScorePosting: boolean;
  warnings: string[];
};

export type ExistingCourseTeeIdentity = {
  id: string;
  provider?: string | null;
  active?: boolean | null;
};

function safeId(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function sourceUrl(courseId: string) {
  return `https://www.ghin.com/post-score/hole-by-hole/round-setup/${encodeURIComponent(courseId)}`;
}

function statusActive(status: string) {
  return status !== "inactive";
}

function gender(value: string | null) {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  if (normalized === "male") return "MEN";
  if (normalized === "female") return "WOMEN";
  if (normalized === "mixed") return "UNISEX";
  return value ? "OTHER" : null;
}

function isoOrNull(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function coordinates(latitude: number | null, longitude: number | null) {
  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

function canonicalHoleTemplate(tees: readonly NormalizedGhinTee[]) {
  return [...tees]
    .sort((left, right) => right.holeData.length - left.holeData.length)
    .find((tee) => tee.holeData.length === 9 || tee.holeData.length === 18)?.holeData ?? [];
}

function teeMetadata(tee: NormalizedGhinTee, postingEligibility: ReturnType<typeof ghinPostEligibility>, providerCourseId: string) {
  return {
    id: tee.id,
    name: tee.name,
    displayName: tee.displayName,
    course_rating: tee.courseRating,
    slope_rating: tee.slopeRating,
    bogey_rating: tee.bogeyRating,
    yards: tee.totalYards,
    meters: tee.totalMeters,
    par: tee.par,
    gender: tee.gender,
    provider: "GHIN",
    provider_course_id: providerCourseId,
    provider_tee_set_rating_id: tee.id,
    provider_status: tee.rawStatus,
    provider_mapping_status: postingEligibility.eligible ? "CONFIRMED" : null,
    ghin_post_eligible: postingEligibility.eligible,
    ghin_post_eligibility_code: postingEligibility.code,
    rating_category: null,
    qa_status: "GHIN_LIVE",
    source_limitation: null,
    holes: tee.holeData.map((hole) => ({
      hole_number: hole.number,
      provider_hole_id: hole.id,
      par: hole.par,
      stroke_index: hole.strokeIndex,
      yards: hole.yardage,
    })),
    nineRatings: tee.ratings.filter((rating) => rating.type === "front" || rating.type === "back").map((rating) => ({
      segment: rating.type === "front" ? "FRONT" : "BACK",
      course_rating: rating.courseRating,
      slope_rating: rating.slopeRating,
      bogey_rating: rating.bogeyRating,
    })),
    qa: { status: "GHIN_LIVE", errors: [] },
  };
}

function eligibilityProviderStatus(tee: NormalizedGhinTee) {
  if (tee.status === "active") return "Active";
  if (tee.status === "inactive") return "Inactive";
  return tee.rawStatus;
}

export function supersededReviewedTeeIds(
  existingTees: readonly ExistingCourseTeeIdentity[],
  plannedTeeIds: ReadonlySet<string>,
  providerCourseId: string,
) {
  const importedPrefix = `ghin:${providerCourseId}:tee:`;
  return existingTees.flatMap((tee) => (
    tee.active !== false
    && tee.provider === "OWNER_CATALOG_REVIEW"
    && tee.id.startsWith(importedPrefix)
    && !plannedTeeIds.has(tee.id)
      ? [tee.id]
      : []
  ));
}

export function ghinScorePostingTeeIds(tees: readonly NormalizedGhinTee[]) {
  return new Set(tees.flatMap((tee) => tee.id ? [tee.id] : []));
}

export function buildGhinCourseSyncPlan(input: {
  course: NormalizedGhinCourse;
  facility?: NormalizedGhinFacility | null;
  scorePostingTees?: readonly NormalizedGhinTee[];
  targetClubId?: string;
  targetCourseId?: string;
  targetTeeIdsByProviderId?: Readonly<Record<string, string>>;
  targetHoleIdsByNumber?: Readonly<Record<number, string>>;
  targetYardageIdsByTeeAndHoleNumber?: Readonly<Record<string, string>>;
  confirmMapping?: boolean;
  observedAt?: string;
}): GhinCourseSyncPlan {
  const { course } = input;
  if (!course.id || !course.facilityId || !course.name) throw new Error("GHIN_COURSE_IDENTITY_INCOMPLETE");
  if (course.holes !== 9 && course.holes !== 18) throw new Error("GHIN_COURSE_HOLE_COUNT_INCOMPLETE");
  const observedAt = input.observedAt ?? new Date().toISOString();
  const verifiedAt = isoOrNull(observedAt) ?? new Date().toISOString();
  const externalFacilityId = course.facilityId;
  const externalCourseId = course.id;
  const clubId = input.targetClubId ?? `ghin-facility-${safeId(externalFacilityId)}`;
  const courseId = input.targetCourseId ?? `ghin-course-${safeId(externalCourseId)}`;
  const mappingStatus = input.confirmMapping ? "CONFIRMED" : "CANDIDATE";
  const livePostingIds = ghinScorePostingTeeIds(input.scorePostingTees ?? []);
  const facility = input.facility ?? null;
  const facilityCoordinates = coordinates(facility?.latitude ?? course.latitude, facility?.longitude ?? course.longitude);
  const courseCoordinates = coordinates(course.latitude, course.longitude);
  const canonicalHoles = canonicalHoleTemplate(course.tees);
  const warnings: string[] = [];
  if (!input.confirmMapping) warnings.push("Provider mapping is a candidate; existing Backyard course data must not be overwritten yet.");
  if (canonicalHoles.length !== 9 && canonicalHoles.length !== 18) warnings.push("No complete GHIN hole configuration was available.");

  const facilityRow = {
    id: clubId,
    name: facility?.name ?? course.facilityName ?? course.name,
    address: [facility?.address1 ?? course.address1, facility?.address2 ?? course.address2, facility?.postalCode ?? course.postalCode]
      .filter((value): value is string => Boolean(value))
      .join(", ") || null,
    city: facility?.city ?? course.city,
    state_region: facility?.state ?? course.state,
    country: facility?.country ?? course.country,
    ...facilityCoordinates,
    provider: "GHIN",
    provider_external_id: externalFacilityId,
    source_url: sourceUrl(externalCourseId),
    verified_at: verifiedAt,
    active: statusActive(facility?.status ?? course.status),
    visibility: "PRIVATE",
    catalog_metadata: {
      provider: "GHIN",
      association_ids: facility?.associationIds ?? (course.associationId ? [course.associationId] : []),
      postal_code: facility?.postalCode ?? course.postalCode,
      observed_at: observedAt,
      source_updated_at: facility?.updatedAt ?? course.updatedAt,
    },
    origin: "GHIN" satisfies GhinCourseSyncOrigin,
    is_provisional: false,
    provider_status: facility?.rawStatus ?? course.rawStatus,
    last_synced_at: observedAt,
    source_updated_at: isoOrNull(facility?.updatedAt ?? course.updatedAt),
  };

  const courseRow = {
    id: courseId,
    club_id: clubId,
    name: course.name,
    holes: course.holes,
    ...courseCoordinates,
    provider: "GHIN",
    provider_external_id: externalCourseId,
    source_url: sourceUrl(externalCourseId),
    active: statusActive(course.status),
    visibility: "PRIVATE",
    verified_at: verifiedAt,
    catalog_metadata: {
      provider: "GHIN",
      facility_id: externalFacilityId,
      course_id: externalCourseId,
      course_number: course.courseNumber,
      observed_at: observedAt,
      source_updated_at: course.updatedAt,
      dataVersion: `ghin-live-${externalCourseId}`,
      search_aliases: [course.name],
      origin: "GHIN",
      layout_type: "STANDARD",
      operational_status: course.rawStatus,
      ghin_post_eligible: input.confirmMapping === true
        && course.tees.some((tee) => tee.id !== null && livePostingIds.has(tee.id)),
    },
    origin: "GHIN" satisfies GhinCourseSyncOrigin,
    layout_type: "STANDARD",
    is_provisional: false,
    provider_status: course.rawStatus,
    course_number: course.courseNumber,
    total_par: course.par,
    season: course.season,
    last_synced_at: observedAt,
    source_updated_at: isoOrNull(course.updatedAt),
  };

  const holes = canonicalHoles.flatMap((hole) => {
    if (hole.par === null || hole.strokeIndex === null) return [];
    return [{
      id: input.targetHoleIdsByNumber?.[hole.number] ?? `${courseId}:hole:${hole.number}`,
      course_id: courseId,
      hole_number: hole.number,
      par: hole.par,
      stroke_index: hole.strokeIndex,
      provider: "GHIN",
      provider_external_id: hole.id,
      source_url: sourceUrl(externalCourseId),
      verified_at: verifiedAt,
      origin: "GHIN" satisfies GhinCourseSyncOrigin,
      active: true,
      provider_status: "Active",
      last_synced_at: observedAt,
      source_updated_at: isoOrNull(course.updatedAt),
    }];
  });
  const holeByNumber = new Map(holes.map((hole) => [hole.hole_number, hole]));

  const tees = course.tees.flatMap((tee) => {
    if (!tee.id || !tee.name) return [];
    const internalTeeId = input.targetTeeIdsByProviderId?.[tee.id] ?? `ghin-tee-${safeId(tee.id)}`;
    const postingEligibility = ghinPostEligibility({
      provider: "GHIN",
      providerCourseId: externalCourseId,
      providerTeeSetId: tee.id,
      providerStatus: eligibilityProviderStatus(tee),
      mappingStatus,
      sourceIsProvisional: false,
      scorePostingTeeSetIds: livePostingIds,
    });
    return [{
      id: internalTeeId,
      course_id: courseId,
      name: tee.name,
      display_name: tee.displayName,
      gender: gender(tee.gender),
      rating: tee.courseRating,
      slope: tee.slopeRating,
      par: tee.par,
      total_yards: tee.totalYards,
      total_meters: tee.totalMeters,
      front_nine_rating: tee.frontRating,
      back_nine_rating: tee.backRating,
      provider: "GHIN",
      provider_external_id: tee.id,
      source_url: sourceUrl(externalCourseId),
      verified_at: verifiedAt,
      active: statusActive(tee.status),
      catalog_metadata: teeMetadata(tee, postingEligibility, externalCourseId),
      origin: "GHIN" satisfies GhinCourseSyncOrigin,
      provider_status: tee.rawStatus ?? eligibilityProviderStatus(tee),
      bogey_rating: tee.bogeyRating,
      front_nine_slope: tee.frontSlope,
      back_nine_slope: tee.backSlope,
      front_nine_bogey_rating: tee.frontBogeyRating,
      back_nine_bogey_rating: tee.backBogeyRating,
      is_shorter: tee.isShorter,
      stroke_allocation: tee.strokeAllocation,
      eligible_sides: tee.eligibleSides,
      last_synced_at: observedAt,
      source_updated_at: isoOrNull(course.updatedAt),
    }];
  });

  const yardages = course.tees.flatMap((tee) => {
    if (!tee.id) return [];
    const providerTeeId = tee.id;
    const internalTeeId = input.targetTeeIdsByProviderId?.[providerTeeId] ?? `ghin-tee-${safeId(providerTeeId)}`;
    return tee.holeData.flatMap((hole) => {
      const canonical = holeByNumber.get(hole.number);
      if (!canonical || hole.yardage === null) return [];
      return [{
        id: input.targetYardageIdsByTeeAndHoleNumber?.[`${internalTeeId}:${hole.number}`] ?? `${internalTeeId}:hole:${hole.number}`,
        course_id: courseId,
        tee_id: internalTeeId,
        hole_id: canonical.id,
        yards: hole.yardage,
        meters: null,
        tee_par: hole.par,
        tee_stroke_index: hole.strokeIndex,
        provider: "GHIN",
        provider_external_id: `${providerTeeId}:${hole.id ?? hole.number}`,
        source_url: sourceUrl(externalCourseId),
        verified_at: verifiedAt,
      }];
    });
  });

  const courseLink = {
    course_id: courseId,
    provider: "GHIN",
    external_facility_id: externalFacilityId,
    external_course_id: externalCourseId,
    match_method: input.confirmMapping ? "EXACT_ID" : "MANUAL",
    sync_status: mappingStatus,
    source_url: sourceUrl(externalCourseId),
    last_observed_at: observedAt,
    last_verified_at: input.confirmMapping ? observedAt : null,
    last_error_code: null,
  };
  const teeLinks = tees.map((tee) => ({
    course_id: courseId,
    tee_id: tee.id,
    provider: "GHIN",
    external_tee_set_id: tee.provider_external_id,
    match_method: input.confirmMapping ? "EXACT_ID" : "MANUAL",
    sync_status: mappingStatus,
    source_url: sourceUrl(externalCourseId),
    last_observed_at: observedAt,
    last_verified_at: input.confirmMapping ? observedAt : null,
    last_error_code: null,
  }));

  const completeForPlay = canonicalHoles.length > 0 && holes.length === canonicalHoles.length
    && tees.some((tee) => course.tees.find((candidate) => candidate.id === tee.provider_external_id)?.holeData.length === canonicalHoles.length);
  const completeForScorePosting = tees.some((tee) => tee.catalog_metadata
    && typeof tee.catalog_metadata === "object"
    && "ghin_post_eligible" in tee.catalog_metadata
    && tee.catalog_metadata.ghin_post_eligible === true);
  if (!completeForScorePosting) warnings.push("No confirmed TeeSetRatingId valid for score posting is attached to this layout.");

  return {
    schemaVersion: 1,
    provider: "GHIN",
    facility: facilityRow,
    course: courseRow,
    tees,
    holes,
    yardages,
    courseLink,
    teeLinks,
    completeForPlay,
    completeForScorePosting,
    warnings,
  };
}

export function ghinCourseSyncFingerprint(plan: GhinCourseSyncPlan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}
