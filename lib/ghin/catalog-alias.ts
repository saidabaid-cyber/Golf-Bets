import { createHash } from "node:crypto";
import type { Hole, PlayerTeeAssignmentSnapshot } from "../types";

export type AliasCourse = { id: string; club_id: string | null; origin: string; is_provisional: boolean; holes: number; total_par: number; catalog_metadata: Record<string, unknown> };
export type AliasTee = { id: string; course_id: string; catalog_metadata: Record<string, unknown> };
export type AliasCourseLink = { id: string; course_id: string; external_course_id: string; external_facility_id: string | null; sync_status: string };
export type AliasTeeLink = { id: string; course_id: string; tee_id: string; external_tee_set_id: string; course_provider_link_id: string; sync_status: string };
export type GhinCatalogAlias = {
  providerCourseId: string; providerTeeSetId: string; canonicalCourseId: string; canonicalTeeId: string;
  /** A physical/rating mapping does not replace the frozen stroke allocation. */
  strokeAllocationDiffers: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function ghinHoleGeometryHash(holes: readonly { hole_number: number; par: number; yards: number }[]) {
  return createHash("sha256").update(JSON.stringify([...holes].sort((a,b)=>a.hole_number-b.hole_number).map(h=>[h.hole_number,h.par,h.yards]))).digest("hex");
}

/** Resolve an audited server-managed physical alias without rewriting any
 * round identifiers, scores, ratings or handicap/stroke-allocation snapshots.
 * A name match or a generic search alias is never sufficient. Posting must
 * additionally revalidate live entitlement and the linked golfer's gender. */
export function resolveGhinCatalogAlias(input: {
  assignment: PlayerTeeAssignmentSnapshot; holes: number; frozenHoles: readonly Hole[];
  courses: readonly AliasCourse[]; tees: readonly AliasTee[];
  courseLinks: readonly AliasCourseLink[]; teeLinks: readonly AliasTeeLink[];
}): GhinCatalogAlias | null {
  const a = input.assignment, course = input.courses.find(c=>c.id===a.courseId), tee = input.tees.find(t=>t.id===a.teeId && t.course_id===a.courseId);
  if (!course || !tee || course.origin!=="BACKYARD_ADMIN" || course.is_provisional || input.holes!==18 || course.holes!==18 || course.total_par!==a.par) return null;
  if ([a.par,a.rating,a.slope,a.yards].some(n=>typeof n!=="number" || !Number.isFinite(n) || n<=0)) return null;
  const ca = record(course.catalog_metadata.ghin_provider_alias_v1), ta = record(tee.catalog_metadata.ghin_provider_alias_v1);
  if (!ca || !ta || ca.status!=="CONFIRMED" || ta.status!=="CONFIRMED" || ca.provider!=="GHIN" || ta.provider!=="GHIN"
    || ca.club_id!==course.club_id || ca.canonical_course_id!==ta.canonical_course_id || ca.course_provider_link_id!==ta.course_provider_link_id
    || typeof ca.verified_at!=="string" || !Number.isFinite(Date.parse(ca.verified_at))
    || typeof ta.verified_at!=="string" || !Number.isFinite(Date.parse(ta.verified_at))) return null;
  const cl = input.courseLinks.find(c=>c.id===ca.course_provider_link_id && c.course_id===ca.canonical_course_id && c.sync_status==="CONFIRMED"
    && c.external_course_id===ca.provider_course_id && c.external_facility_id===ca.provider_facility_id);
  const tl = input.teeLinks.find(t=>t.id===ta.tee_provider_link_id && t.course_id===ca.canonical_course_id && t.tee_id===ta.canonical_tee_id
    && t.course_provider_link_id===cl?.id && t.sync_status==="CONFIRMED" && t.external_tee_set_id===ta.provider_tee_set_id);
  const expected = record(ta.snapshot_attributes), proof = record(ta.evidence);
  const geometry = tee.catalog_metadata.holes;
  if (!cl || !tl || !expected || !proof || !Array.isArray(geometry) || geometry.length!==18) return null;
  if (geometry.some((h,index)=>!record(h) || h.hole_number!==index+1 || !Number.isInteger(h.par) || !Number.isInteger(h.yards))) return null;
  const localHash = ghinHoleGeometryHash(geometry);
  if (proof.local_geometry_hash!==localHash || proof.provider_geometry_hash!==localHash || proof.course_id!==cl.external_course_id || proof.tee_id!==tl.external_tee_set_id) return null;
  if (input.frozenHoles.length!==18 || input.frozenHoles.some(h=>!Number.isInteger(h.yards) || !Number.isInteger(h.par))
    || ghinHoleGeometryHash(input.frozenHoles.map(h=>({hole_number:h.number,par:h.par,yards:h.yards!})))!==localHash) return null;
  if (expected.holes!==input.holes || expected.par!==a.par || expected.rating!==a.rating || expected.slope!==a.slope || expected.yards!==a.yards
    || !["MEN","WOMEN"].includes(String(expected.rating_gender)) || expected.rating_gender!==a.indexRatingEvidence?.ratingGender
    || a.indexRatingEvidence?.courseId!==a.courseId || a.indexRatingEvidence?.teeId!==a.teeId
    || a.indexRatingEvidence?.courseRating!==a.rating || a.indexRatingEvidence?.slopeRating!==a.slope) return null;
  return {providerCourseId:cl.external_course_id,providerTeeSetId:tl.external_tee_set_id,canonicalCourseId:cl.course_id,canonicalTeeId:tl.tee_id,
    strokeAllocationDiffers:proof.stroke_allocation_differs===true};
}
