export type LazyCourseImportStatus =
  | "LOCAL_HIT"
  | "IMPORTED"
  | "PROVIDER_MISS"
  | "PROVIDER_AMBIGUOUS"
  | "PROVIDER_BUSY"
  | "BLOCKED_EXTERNAL"
  | "PROVIDER_UNAVAILABLE";

export type LazyCourseImportResult = {
  status: LazyCourseImportStatus;
  courseIds: string[];
  upstreamCalls: number;
  cached: boolean;
};

export type LocalFirstCourseLookup<T> = {
  local: T[];
  result: LazyCourseImportResult;
};

/** Provider-agnostic local-first contract. A provider is never invoked when
 * the shared Course Master already has a match. */
export async function localFirstCourseLookup<T>(input: {
  local: () => Promise<T[]>;
  remote: () => Promise<LazyCourseImportResult>;
  reload: () => Promise<T[]>;
}): Promise<LocalFirstCourseLookup<T>> {
  const first = await input.local();
  if (first.length) return {
    local: first,
    result: { status: "LOCAL_HIT", courseIds: [], upstreamCalls: 0, cached: false },
  };
  const result = await input.remote();
  return { local: result.status === "IMPORTED" ? await input.reload() : [], result };
}
