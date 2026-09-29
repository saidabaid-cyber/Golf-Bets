import { equipmentProfileFingerprint, normalizeEquipmentProfile, type EquipmentProfile } from "./golf-equipment";

export type EquipmentCloudRecord = {
  profile: EquipmentProfile;
  version: number;
  lastMutationId: string;
  updatedAt: string;
};

export class EquipmentSyncError extends Error {
  readonly status: number;
  readonly code: string;
  readonly remote: EquipmentCloudRecord | null;

  constructor(message: string, status: number, code = "EQUIPMENT_SYNC_FAILED", remote: EquipmentCloudRecord | null = null) {
    super(message);
    this.name = "EquipmentSyncError";
    this.status = status;
    this.code = code;
    this.remote = remote;
  }
}

export type EquipmentSyncScope = {
  generation: number;
  userId: string;
  accessToken: string | null;
};

/** Async equipment work is allowed to mutate client state only while it still
 * belongs to the exact account/session generation that started it. Comparing
 * the token as well as the user protects refreshes where the user id stays the
 * same but an older request finishes after the replacement session. */
export function isEquipmentSyncScopeCurrent(
  expected: EquipmentSyncScope | null,
  current: EquipmentSyncScope | null,
) {
  return Boolean(expected && current
    && expected.generation === current.generation
    && expected.userId === current.userId
    && expected.accessToken === current.accessToken);
}

/**
 * A value equal to the last confirmed cloud fingerprint still needs queuing
 * while another value is pending: that pending upload may otherwise overwrite
 * the cloud after the user has already reverted locally.
 */
export function shouldQueueEquipmentFingerprint(
  fingerprint: string | null,
  lastSyncedFingerprint: string | null,
  lastQueuedFingerprint: string | null,
) {
  if (!fingerprint || fingerprint === lastQueuedFingerprint) return false;
  return fingerprint !== lastSyncedFingerprint || lastQueuedFingerprint !== null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type EquipmentResponse = {
  data?: unknown;
  error?: string;
  code?: string;
  conflict?: unknown;
};

function normalizedRecord(value: unknown, expectedUserId: string): EquipmentCloudRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const profile = normalizeEquipmentProfile(record.profile, expectedUserId);
  const version = typeof record.version === "number" && Number.isSafeInteger(record.version) && record.version > 0 ? record.version : null;
  const lastMutationId = typeof record.lastMutationId === "string" && record.lastMutationId.trim() ? record.lastMutationId : null;
  const updatedAt = typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt)) ? record.updatedAt : null;
  return profile && version && lastMutationId && updatedAt ? { profile, version, lastMutationId, updatedAt } : null;
}

async function responsePayload(response: Response): Promise<EquipmentResponse> {
  return response.json().catch(() => ({})) as Promise<EquipmentResponse>;
}

function requiredToken(accessToken: string) {
  const token = accessToken.trim();
  if (!token) throw new EquipmentSyncError("Inicia sesión para sincronizar tu equipo.", 401, "AUTH_REQUIRED");
  return token;
}

function requiredUserId(value: string) {
  const id = value.trim();
  if (!id) throw new EquipmentSyncError("No se pudo identificar el perfil de equipo.", 400, "INVALID_EQUIPMENT_USER");
  return id;
}

export async function downloadEquipmentProfile(
  accessToken: string,
  userId: string,
  fetcher: FetchLike = fetch,
): Promise<EquipmentCloudRecord | null> {
  const token = requiredToken(accessToken);
  const expectedUserId = requiredUserId(userId);
  const response = await fetcher("/api/equipment", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new EquipmentSyncError(payload.error || "No se pudo consultar tu equipo.", response.status, payload.code);
  if (payload.data === null || payload.data === undefined) return null;
  const record = normalizedRecord(payload.data, expectedUserId);
  if (!record) throw new EquipmentSyncError("La nube respondió con un perfil de equipo inválido.", 502, "INVALID_EQUIPMENT_RESPONSE");
  return record;
}

export async function uploadEquipmentProfile(
  profileValue: EquipmentProfile,
  accessToken: string,
  options: { expectedVersion: number | null; mutationId: string; deviceId?: string | null },
  fetcher: FetchLike = fetch,
): Promise<EquipmentCloudRecord> {
  const token = requiredToken(accessToken);
  const profile = normalizeEquipmentProfile(profileValue, profileValue.userId);
  if (!profile) throw new EquipmentSyncError("El perfil de equipo local no es válido.", 400, "INVALID_EQUIPMENT_PROFILE");
  const response = await fetcher("/api/equipment", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ profile, expectedVersion: options.expectedVersion, mutationId: options.mutationId, deviceId: options.deviceId || null }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const remote = normalizedRecord(payload.conflict, profile.userId);
    throw new EquipmentSyncError(payload.error || "No se pudo sincronizar tu equipo.", response.status, payload.code, remote);
  }
  const record = normalizedRecord(payload.data, profile.userId);
  if (!record) throw new EquipmentSyncError("La nube no confirmó el perfil de equipo.", 502, "INVALID_EQUIPMENT_RESPONSE");
  return record;
}

export type EquipmentProfileConflict = {
  path: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
};

export type EquipmentProfileMergeResult = {
  profile: EquipmentProfile;
  conflicts: EquipmentProfileConflict[];
};

export type EquipmentReconciliation = {
  profile: EquipmentProfile | null;
  conflicts: EquipmentProfileConflict[];
  needsUpload: boolean;
  needsLocalWrite: boolean;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticValue);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(Object.keys(source)
    .filter((key) => key !== "updatedAt")
    .sort()
    .map((key) => [key, semanticValue(source[key])]));
}

function sameSemanticValue(left: unknown, right: unknown) {
  return JSON.stringify(semanticValue(left)) === JSON.stringify(semanticValue(right));
}

export function equipmentProfilesSemanticallyEqual(left: EquipmentProfile | null, right: EquipmentProfile | null) {
  if (!left || !right) return left === right;
  return equipmentProfileFingerprint(left, left.userId) === equipmentProfileFingerprint(right, right.userId);
}

function timestamp(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(...values: unknown[]) {
  const valid = values.filter((value): value is string => typeof value === "string" && timestamp(value) > 0);
  return valid.sort((left, right) => timestamp(right) - timestamp(left))[0];
}

function idArray(value: unknown): value is Array<UnknownRecord & { id: string }> {
  return Array.isArray(value) && value.every((item) => {
    const candidate = record(item);
    return Boolean(candidate && typeof candidate.id === "string" && candidate.id.trim());
  });
}

function pointer(parts: string[]) {
  return `/${parts.map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function mergeEquipmentNode(
  base: unknown,
  local: unknown,
  remote: unknown,
  parts: string[],
  conflicts: EquipmentProfileConflict[],
  conflictChoice?: "local" | "remote",
): unknown {
  if (parts.at(-1) === "updatedAt") return latestTimestamp(local, remote, base) || local || remote || base;
  if (sameSemanticValue(local, remote)) return structuredClone(local);
  if (sameSemanticValue(local, base)) return structuredClone(remote);
  if (sameSemanticValue(remote, base)) return structuredClone(local);

  const localRecord = record(local);
  const remoteRecord = record(remote);
  const baseRecord = record(base);
  if (localRecord && remoteRecord && (base === undefined || base === null || baseRecord)) {
    const result: UnknownRecord = {};
    for (const key of new Set([
      ...Object.keys(baseRecord || {}),
      ...Object.keys(localRecord),
      ...Object.keys(remoteRecord),
    ])) {
      const merged = mergeEquipmentNode(baseRecord?.[key], localRecord[key], remoteRecord[key], [...parts, key], conflicts, conflictChoice);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }

  if (idArray(local) && idArray(remote) && (base === undefined || base === null || idArray(base))) {
    const baseRows = idArray(base) ? base : [];
    const baseById = new Map(baseRows.map((item) => [item.id, item]));
    const localById = new Map(local.map((item) => [item.id, item]));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const order = [...remote.map((item) => item.id), ...local.map((item) => item.id).filter((id) => !remoteById.has(id))];
    return order.map((id) => mergeEquipmentNode(
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
      [...parts, `@${id}`],
      conflicts,
      conflictChoice,
    )).filter((item) => item !== undefined);
  }

  const conflict = {
    path: pointer(parts),
    baseValue: structuredClone(base),
    localValue: structuredClone(local),
    remoteValue: structuredClone(remote),
  } satisfies EquipmentProfileConflict;
  conflicts.push(conflict);
  return structuredClone(conflictChoice === "remote" ? remote : local);
}

export function mergeEquipmentProfiles(
  baseValue: EquipmentProfile,
  localValue: EquipmentProfile,
  remoteValue: EquipmentProfile,
  conflictChoice?: "local" | "remote",
): EquipmentProfileMergeResult {
  const userId = localValue.userId;
  const base = normalizeEquipmentProfile(baseValue, userId);
  const local = normalizeEquipmentProfile(localValue, userId);
  const remote = normalizeEquipmentProfile(remoteValue, userId);
  if (!base || !local || !remote) throw new Error("equipment_merge_profile_invalid");
  const conflicts: EquipmentProfileConflict[] = [];
  const value = mergeEquipmentNode(base, local, remote, [], conflicts, conflictChoice);
  const source = record(value);
  if (source) source.updatedAt = latestTimestamp(local.updatedAt, remote.updatedAt, base.updatedAt) || local.updatedAt;
  const profile = normalizeEquipmentProfile(value, userId);
  if (!profile) throw new Error("equipment_merge_result_invalid");
  return { profile, conflicts };
}

function mergeBootstrapCollection<T extends { id: string; updatedAt: string }>(local: T[], remote: T[]) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) {
    const current = merged.get(item.id);
    if (!current || timestamp(item.updatedAt) >= timestamp(current.updatedAt)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

/** Existing installations predate durable sync metadata. They have no honest
 * common base, so bootstrap once without inventing a conflict: retain the
 * newest scalar snapshot and union independently versioned equipment rows. */
export function bootstrapEquipmentProfiles(localValue: EquipmentProfile, remoteValue: EquipmentProfile) {
  const userId = localValue.userId;
  const local = normalizeEquipmentProfile(localValue, userId);
  const remote = normalizeEquipmentProfile(remoteValue, userId);
  if (!local || !remote) throw new Error("equipment_bootstrap_profile_invalid");
  if (equipmentProfilesSemanticallyEqual(local, remote)) return timestamp(remote.updatedAt) >= timestamp(local.updatedAt) ? remote : local;
  const preferred = timestamp(local.updatedAt) >= timestamp(remote.updatedAt) ? local : remote;
  const alternate = preferred === local ? remote : local;
  const localFitAt = timestamp(local.lastBallFit?.completedAt);
  const remoteFitAt = timestamp(remote.lastBallFit?.completedAt);
  const profile = normalizeEquipmentProfile({
    ...alternate,
    ...preferred,
    clubs: mergeBootstrapCollection(local.clubs, remote.clubs),
    balls: mergeBootstrapCollection(local.balls, remote.balls),
    distances: mergeBootstrapCollection(local.distances, remote.distances),
    lastBallFit: localFitAt || remoteFitAt
      ? (localFitAt >= remoteFitAt ? local.lastBallFit : remote.lastBallFit)
      : preferred.lastBallFit,
    createdAt: timestamp(local.createdAt) <= timestamp(remote.createdAt) ? local.createdAt : remote.createdAt,
    updatedAt: latestTimestamp(local.updatedAt, remote.updatedAt) || preferred.updatedAt,
  }, userId);
  if (!profile) throw new Error("equipment_bootstrap_result_invalid");
  return profile;
}

export function reconcileEquipmentProfiles(
  base: EquipmentProfile | null,
  local: EquipmentProfile | null,
  remote: EquipmentProfile | null,
): EquipmentReconciliation {
  if (!local && !remote) return { profile: null, conflicts: [], needsUpload: false, needsLocalWrite: false };
  if (!local && remote) return { profile: remote, conflicts: [], needsUpload: false, needsLocalWrite: true };
  if (local && !remote) return { profile: local, conflicts: [], needsUpload: true, needsLocalWrite: false };
  if (equipmentProfilesSemanticallyEqual(local, remote)) {
    return { profile: remote, conflicts: [], needsUpload: false, needsLocalWrite: false };
  }
  const result = base
    ? mergeEquipmentProfiles(base, local!, remote!)
    : { profile: bootstrapEquipmentProfiles(local!, remote!), conflicts: [] };
  return {
    profile: result.profile,
    conflicts: result.conflicts,
    needsUpload: !result.conflicts.length && !equipmentProfilesSemanticallyEqual(result.profile, remote),
    needsLocalWrite: !equipmentProfilesSemanticallyEqual(result.profile, local),
  };
}

export function resolveEquipmentProfileConflicts(
  base: EquipmentProfile,
  local: EquipmentProfile,
  remote: EquipmentProfile,
  choice: "local" | "remote",
) {
  return mergeEquipmentProfiles(base, local, remote, choice).profile;
}

export type EquipmentMergeDecision = "local" | "remote" | "equal" | "merge" | "conflict";

/** Backwards-compatible decision helper used by narrow callers/tests. New sync
 * code consumes `reconcileEquipmentProfiles` so a compatible merge is retained. */
export function chooseEquipmentProfile(
  local: EquipmentProfile | null,
  remote: EquipmentCloudRecord | null,
  base: EquipmentProfile | null = null,
): EquipmentMergeDecision {
  if (!local && !remote) return "equal";
  if (local && !remote) return "local";
  if (!local && remote) return "remote";
  if (equipmentProfilesSemanticallyEqual(local, remote!.profile)) return "equal";
  const result = reconcileEquipmentProfiles(base, local, remote!.profile);
  if (result.conflicts.length) return "conflict";
  if (equipmentProfilesSemanticallyEqual(result.profile, local)) return "local";
  if (equipmentProfilesSemanticallyEqual(result.profile, remote!.profile)) return "remote";
  return "merge";
}
