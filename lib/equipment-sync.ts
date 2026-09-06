import { normalizeEquipmentProfile, type EquipmentProfile } from "./golf-equipment";

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

export type EquipmentMergeDecision = "local" | "remote" | "equal" | "conflict";

/** A whole-profile snapshot is deliberately conservative: once both sides
 * exist, any divergence requires an explicit user choice. A client timestamp
 * is useful context, but is not trusted to resurrect equipment removed on a
 * different device. */
export function chooseEquipmentProfile(
  local: EquipmentProfile | null,
  remote: EquipmentCloudRecord | null,
): EquipmentMergeDecision {
  if (!local && !remote) return "equal";
  if (local && !remote) return "local";
  if (!local && remote) return "remote";
  return JSON.stringify(local) === JSON.stringify(remote!.profile) ? "equal" : "conflict";
}
