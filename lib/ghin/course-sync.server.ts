import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ghinCourseSyncFingerprint, type GhinCourseSyncPlan } from "./course-sync";

type SyncMode = "DRY_RUN" | "APPLY";

export type PersistGhinCourseSyncResult = {
  applied: boolean;
  candidateOnly: boolean;
  courseId: string;
  courseLinkId: string;
  fingerprint: string;
  counts: { tees: number; holes: number; yardages: number };
};

function rowId(row: Record<string, unknown>, label: string) {
  const value = row.id;
  if (typeof value !== "string" || !value) throw new Error(`${label}_ID_REQUIRED`);
  return value;
}

function externalId(row: Record<string, unknown>, label: string) {
  const value = row.provider_external_id;
  if (typeof value !== "string" || !value) throw new Error(`${label}_EXTERNAL_ID_REQUIRED`);
  return value;
}

function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "GHIN_COURSE_SYNC_FAILED";
  return /^[A-Z0-9_:-]{3,120}$/.test(error.message) ? error.message.slice(0, 120) : "GHIN_COURSE_SYNC_FAILED";
}

async function throwIfError(promise: PromiseLike<{ error: { message: string } | null }>, code: string) {
  const result = await promise;
  if (result.error) throw new Error(code);
}

export async function persistGhinCourseSyncPlan(
  database: SupabaseClient,
  plan: GhinCourseSyncPlan,
  options: {
    mode: SyncMode;
    actorId: string;
    diffSummary?: Record<string, unknown>;
  },
): Promise<PersistGhinCourseSyncResult> {
  const courseId = rowId(plan.course, "COURSE");
  const clubId = rowId(plan.facility, "FACILITY");
  const fingerprint = ghinCourseSyncFingerprint(plan);
  const existingCourseResult = await database
    .from("golf_courses")
    .select("id,provider,provider_external_id,catalog_metadata")
    .eq("id", courseId)
    .maybeSingle();
  if (existingCourseResult.error) throw new Error("GHIN_COURSE_LOOKUP_FAILED");
  const existingCourse = existingCourseResult.data as Record<string, unknown> | null;
  const candidateOnly = Boolean(existingCourse && plan.courseLink.sync_status !== "CONFIRMED");

  let courseLinkId = "";

  const normalizedSummary = {
    fingerprint,
    facilityId: externalId(plan.facility, "FACILITY"),
    courseId: externalId(plan.course, "COURSE"),
    teeCount: plan.tees.length,
    holeCount: plan.holes.length,
    yardageCount: plan.yardages.length,
    completeForPlay: plan.completeForPlay,
    completeForScorePosting: plan.completeForScorePosting,
  };

  if (options.mode === "DRY_RUN" || candidateOnly) {
    await throwIfError(database.from("golf_provider_sync_runs").insert({
      provider: "GHIN",
      external_facility_id: normalizedSummary.facilityId,
      external_course_id: normalizedSummary.courseId,
      course_id: existingCourse ? courseId : null,
      mode: "DRY_RUN",
      status: candidateOnly ? "BLOCKED" : "NO_CHANGE",
      normalized_summary: normalizedSummary,
      diff_summary: options.diffSummary ?? {},
      error_code: candidateOnly ? "MAPPING_REVIEW_REQUIRED" : null,
      created_by: options.actorId,
    }), "GHIN_SYNC_RUN_INSERT_FAILED");
    return {
      applied: false,
      candidateOnly,
      courseId,
      courseLinkId,
      fingerprint,
      counts: { tees: plan.tees.length, holes: plan.holes.length, yardages: plan.yardages.length },
    };
  }

  try {
    if (existingCourse) {
      const linkResult = await database
        .from("golf_course_provider_links")
        .upsert(plan.courseLink, { onConflict: "course_id,provider" })
        .select("id")
        .single();
      if (linkResult.error || !linkResult.data?.id) throw new Error("GHIN_COURSE_LINK_UPSERT_FAILED");
      courseLinkId = String(linkResult.data.id);
    }
    const existingClubResult = await database
      .from("golf_clubs")
      .select("id,provider,provider_external_id,catalog_metadata")
      .eq("id", clubId)
      .maybeSingle();
    if (existingClubResult.error) throw new Error("GHIN_FACILITY_LOOKUP_FAILED");
    const existingClub = existingClubResult.data as Record<string, unknown> | null;
    const facilityRow = existingClub ? {
      ...plan.facility,
      provider: existingClub.provider,
      provider_external_id: existingClub.provider_external_id,
      catalog_metadata: {
        ...((existingClub.catalog_metadata as Record<string, unknown> | null) ?? {}),
        ...((plan.facility.catalog_metadata as Record<string, unknown> | null) ?? {}),
      },
    } : plan.facility;
    await throwIfError(database.from("golf_clubs").upsert(facilityRow, { onConflict: "id" }), "GHIN_FACILITY_UPSERT_FAILED");

    const courseRow = existingCourse ? {
      ...plan.course,
      provider: existingCourse.provider,
      provider_external_id: existingCourse.provider_external_id,
      catalog_metadata: {
        ...((existingCourse.catalog_metadata as Record<string, unknown> | null) ?? {}),
        ...((plan.course.catalog_metadata as Record<string, unknown> | null) ?? {}),
      },
    } : plan.course;
    await throwIfError(database.from("golf_courses").upsert(courseRow, { onConflict: "id" }), "GHIN_COURSE_UPSERT_FAILED");

    const existingTeesResult = await database
      .from("golf_course_tees")
      .select("id,name")
      .eq("course_id", courseId);
    if (existingTeesResult.error) throw new Error("GHIN_TEE_LOOKUP_FAILED");
    const existingNames = new Map((existingTeesResult.data ?? []).map((tee) => [String(tee.name).toLocaleLowerCase("en-US"), String(tee.id)]));
    for (const tee of plan.tees) {
      const name = String(tee.name ?? "").toLocaleLowerCase("en-US");
      const collision = existingNames.get(name);
      if (collision && collision !== rowId(tee, "TEE")) throw new Error("GHIN_TEE_MAPPING_REQUIRED");
    }

    if (plan.holes.length) await throwIfError(database.from("golf_holes").upsert(plan.holes, { onConflict: "id" }), "GHIN_HOLE_UPSERT_FAILED");
    if (plan.tees.length) await throwIfError(database.from("golf_course_tees").upsert(plan.tees, { onConflict: "id" }), "GHIN_TEE_UPSERT_FAILED");
    if (plan.yardages.length) await throwIfError(database.from("golf_tee_hole_yardages").upsert(plan.yardages, { onConflict: "id" }), "GHIN_YARDAGE_UPSERT_FAILED");

    if (!courseLinkId) {
      const linkResult = await database
        .from("golf_course_provider_links")
        .upsert(plan.courseLink, { onConflict: "course_id,provider" })
        .select("id")
        .single();
      if (linkResult.error || !linkResult.data?.id) throw new Error("GHIN_COURSE_LINK_UPSERT_FAILED");
      courseLinkId = String(linkResult.data.id);
    }

    if (plan.teeLinks.length) {
      await throwIfError(database.from("golf_tee_provider_links").upsert(
        plan.teeLinks.map((link) => ({ ...link, course_provider_link_id: courseLinkId })),
        { onConflict: "tee_id,provider" },
      ), "GHIN_TEE_LINK_UPSERT_FAILED");
    }
    await throwIfError(database.from("golf_provider_sync_runs").insert({
      provider: "GHIN",
      external_facility_id: normalizedSummary.facilityId,
      external_course_id: normalizedSummary.courseId,
      course_id: courseId,
      mode: "APPLY",
      status: "SUCCESS",
      normalized_summary: normalizedSummary,
      diff_summary: options.diffSummary ?? {},
      created_by: options.actorId,
    }), "GHIN_SYNC_RUN_INSERT_FAILED");
  } catch (error) {
    await database.from("golf_provider_sync_runs").insert({
      provider: "GHIN",
      external_facility_id: normalizedSummary.facilityId,
      external_course_id: normalizedSummary.courseId,
      course_id: existingCourse ? courseId : null,
      mode: "APPLY",
      status: "FAILED",
      normalized_summary: normalizedSummary,
      diff_summary: options.diffSummary ?? {},
      error_code: safeErrorCode(error),
      created_by: options.actorId,
    });
    throw error;
  }

  return {
    applied: true,
    candidateOnly: false,
    courseId,
    courseLinkId,
    fingerprint,
    counts: { tees: plan.tees.length, holes: plan.holes.length, yardages: plan.yardages.length },
  };
}
