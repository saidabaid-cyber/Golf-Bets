import type { GhinReadOnlyClient } from "./client";
import type { NormalizedGhinCourse, NormalizedGhinFacility, NormalizedGhinTee } from "./core";

export type GhinCourseLookupInput =
  | { operation: "search"; name: string }
  | { operation: "course"; courseId: string }
  | { operation: "tee"; teeId: string };
export type LookupOutcome<T> = { ok: true; data: T; httpStatus: number; fetchedAt: string }
  | { ok: false; code: string; httpStatus: number | null };
export type GhinCourseLookupResponse = {
  readOnly: true;
  facilities?: LookupOutcome<NormalizedGhinFacility[]>;
  courses?: LookupOutcome<NormalizedGhinCourse[]>;
  course?: LookupOutcome<NormalizedGhinCourse>;
  postingTees?: LookupOutcome<NormalizedGhinTee[]>;
  tee?: LookupOutcome<NormalizedGhinTee>;
};

export function parseCourseLookupInput(value: unknown): GhinCourseLookupInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const key = v.operation === "search" ? "name" : v.operation === "course" ? "courseId" : v.operation === "tee" ? "teeId" : null;
  if (!key || Object.keys(v).some(k => k !== "operation" && k !== key) || typeof v[key] !== "string") return null;
  const text = (v[key] as string).trim();
  if (key === "name" ? text.length < 2 || text.length > 100 : !/^\d{1,12}$/.test(text)) return null;
  return { operation: v.operation, [key]: text } as GhinCourseLookupInput;
}

async function outcome<T>(read: () => Promise<{ data: T; httpStatus: number; fetchedAt: string }>): Promise<LookupOutcome<T>> {
  try { const result = await read(); return { ok: true, ...result }; }
  catch (error) {
    // Return only a finite error code/status. Provider bodies and credentials never leave the server.
    const e = error as { code?: unknown; httpStatus?: unknown };
    return { ok: false, code: typeof e?.code === "string" && /^[a-z_]{1,80}$/i.test(e.code) ? e.code.toUpperCase() : "LOOKUP_FAILED",
      httpStatus: typeof e?.httpStatus === "number" ? e.httpStatus : null };
  }
}

/** Explicit reads on the linked golfer's own client. No global QA credentials,
 * writes, polling, scoring-record reads or posting are part of this lookup. */
export async function lookupGhinCourse(client: Pick<GhinReadOnlyClient, "searchFacilities" | "searchCourses" | "getCourse" | "getScorePostingTees" | "getTee">,
  input: GhinCourseLookupInput): Promise<GhinCourseLookupResponse> {
  if (input.operation === "search") {
    const [facilities, courses] = await Promise.all([
      outcome(() => client.searchFacilities({ name: input.name })),
      outcome(() => client.searchCourses(input.name, 10)),
    ]);
    return { readOnly: true, facilities, courses };
  }
  if (input.operation === "tee") return { readOnly: true, tee: await outcome(() => client.getTee(input.teeId)) };
  const course = await outcome(() => client.getCourse(input.courseId));
  // Do not query an entitlement for an unverified/mismatched provider identity.
  if (!course.ok || course.data.id !== input.courseId) return { readOnly: true, course };
  return { readOnly: true, course, postingTees: await outcome(() => client.getScorePostingTees(input.courseId)) };
}
