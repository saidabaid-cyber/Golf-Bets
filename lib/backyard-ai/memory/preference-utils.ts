import {
  boundedConfidence,
  cleanMemoryId,
  isJsonValue,
  validIsoDate,
  type GroupPreference,
  type PreferenceContext,
  type UserPreference,
} from "./types";

type PreferenceFields = Omit<UserPreference, "recordType" | "ownerId">;

function optionalId(value: unknown) {
  return value === undefined ? undefined : cleanMemoryId(value) ?? undefined;
}

function normalizeContext(value: unknown): PreferenceContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const context: PreferenceContext = {
    ...(optionalId(source.region) ? { region: optionalId(source.region) } : {}),
    ...(optionalId(source.courseId) ? { courseId: optionalId(source.courseId) } : {}),
    ...(optionalId(source.gameKey) ? { gameKey: optionalId(source.gameKey) } : {}),
    ...(optionalId(source.ruleset) ? { ruleset: optionalId(source.ruleset) } : {}),
  };
  return Object.keys(context).length ? context : undefined;
}

function normalizePreferenceFields(value: Record<string, unknown>): PreferenceFields | null {
  const id = cleanMemoryId(value.id);
  const key = cleanMemoryId(value.key, 160);
  const confidence = boundedConfidence(value.confidence);
  const createdAt = validIsoDate(value.createdAt) ? value.createdAt : null;
  const updatedAt = validIsoDate(value.updatedAt) ? value.updatedAt : null;
  const origins = new Set(["USER", "CORRECTION", "HISTORY", "INFERRED"]);
  const statuses = new Set(["CONFIRMED", "INFERRED", "REVOKED"]);
  const useCount = typeof value.useCount === "number" && Number.isInteger(value.useCount) && value.useCount >= 0
    ? Math.min(value.useCount, Number.MAX_SAFE_INTEGER)
    : null;
  if (
    value.schemaVersion !== 1
    || !id
    || !key
    || !isJsonValue(value.value)
    || !origins.has(String(value.origin))
    || !statuses.has(String(value.status))
    || confidence === null
    || !createdAt
    || !updatedAt
    || useCount === null
    || value.dataScope !== "PERSONAL"
    || value.trainingUse !== "EXCLUDED"
  ) return null;

  return {
    schemaVersion: 1,
    id,
    key,
    value: value.value,
    ...(normalizeContext(value.context) ? { context: normalizeContext(value.context) } : {}),
    origin: value.origin as PreferenceFields["origin"],
    status: value.status as PreferenceFields["status"],
    confidence,
    ...(optionalId(value.sourceInteractionId) ? { sourceInteractionId: optionalId(value.sourceInteractionId) } : {}),
    ...(optionalId(value.sourceCorrectionId) ? { sourceCorrectionId: optionalId(value.sourceCorrectionId) } : {}),
    createdAt,
    updatedAt,
    ...(validIsoDate(value.confirmedAt) ? { confirmedAt: value.confirmedAt } : {}),
    ...(validIsoDate(value.lastUsedAt) ? { lastUsedAt: value.lastUsedAt } : {}),
    useCount,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
}

export function normalizeUserPreference(value: unknown): UserPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const ownerId = cleanMemoryId(source.ownerId);
  const fields = normalizePreferenceFields(source);
  if (source.recordType !== "USER_PREFERENCE" || !ownerId || !fields) return null;
  return { recordType: "USER_PREFERENCE", ownerId, ...fields };
}

export function normalizeGroupPreference(value: unknown): GroupPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const ownerId = cleanMemoryId(source.ownerId);
  const groupId = cleanMemoryId(source.groupId);
  const fields = normalizePreferenceFields(source);
  if (source.recordType !== "GROUP_PREFERENCE" || !ownerId || !groupId || !fields) return null;
  return { recordType: "GROUP_PREFERENCE", ownerId, groupId, ...fields };
}

function stableContext(context: PreferenceContext | undefined) {
  return JSON.stringify({
    courseId: context?.courseId ?? "",
    gameKey: context?.gameKey ?? "",
    region: context?.region ?? "",
    ruleset: context?.ruleset ?? "",
  });
}

export function preferenceSemanticKey(
  preference: Pick<UserPreference, "key" | "context"> | Pick<GroupPreference, "key" | "context" | "groupId">,
) {
  const groupId = "groupId" in preference ? preference.groupId : "";
  return JSON.stringify([groupId, preference.key, stableContext(preference.context)]);
}

export function upsertPreference<T extends UserPreference | GroupPreference>(items: readonly T[], preference: T): T[] {
  const semanticKey = preferenceSemanticKey(preference);
  return [
    preference,
    ...items.filter((item) => item.id !== preference.id && preferenceSemanticKey(item) !== semanticKey),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function activePreferences<T extends UserPreference | GroupPreference>(items: readonly T[]) {
  return items.filter((item) => item.status !== "REVOKED");
}
