import { stableValue } from "./cloud-sync";
import { cloudSyncDiagnostic, jsonBytes } from "./cloud-sync-diagnostics";
import type { RoundSnapshot } from "./types";

export function ownerRoundTransportPayload(snapshot: RoundSnapshot, live = true) {
  const { completedAt, updatedAt, ...rest } = snapshot;
  void updatedAt;
  return JSON.stringify(stableValue({ ...rest,
    ...(live ? { lifecycleState: "live" } : { completedAt }),
  }));
}
export function ownerRoundSyncFingerprint(serialized: string) {
  const round = JSON.parse(serialized) as RoundSnapshot;
  // Render-generated timestamps do not constitute new capture material, but
  // remain in the actual payload when a real edit is sent.
  const material = JSON.stringify(stableValue({ ...round,
    personalSlidingAdjustments: round.personalSlidingAdjustments?.map(item => {
      const { updatedAt, ...value } = item; void updatedAt; return value;
    }),
  }));
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) hash = Math.imul(hash ^ material.charCodeAt(i), 0x01000193);
  return `owner-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const flights = new Map<string, Promise<unknown>>();
const failed = new Map<string, string>();
export function ownerRoundAcknowledged(storage: StorageLike, key: string, fingerprint: string) {
  return storage.getItem(`${key}:ack`) === `${fingerprint}:${storage.getItem(key) || ""}`;
}
export function acknowledgeOwnerRound(storage: StorageLike, key: string, fingerprint: string) {
  storage.setItem(`${key}:ack`, `${fingerprint}:${storage.getItem(key) || ""}`);
}

/** Durable owner revision plus material ACK prevents unchanged remount writes.
 * Waiting callers recheck current(): superseded effects drop out, leaving
 * only the latest capture to follow the active flight. */
export async function syncOwnerRound(serialized: string, userId: string, accessToken: string,
  storage: StorageLike, current: () => boolean, request: typeof fetch = fetch, manual = false) {
  const round = JSON.parse(serialized) as RoundSnapshot;
  const key = `backyard-owner-round-revision:${userId}:${round.id}`;
  const fingerprint = ownerRoundSyncFingerprint(serialized);
  const previous = flights.get(key);
  if (previous) {
    cloudSyncDiagnostic({ trigger: "local", fingerprint, reason: "owner-in-flight", result: "coalesced" });
    await previous.catch(() => {});
    if (!current()) return null;
    return syncOwnerRound(serialized, userId, accessToken, storage, current, request, manual);
  }
  if (!current()) return null;
  if (ownerRoundAcknowledged(storage, key, fingerprint)) {
    cloudSyncDiagnostic({ trigger: "local", fingerprint, reason: "owner-acknowledged", result: "skipped" });
    return { unchanged: true };
  }
  if (!manual && failed.get(key) === fingerprint) throw new Error("Nube pendiente; tu captura local se conserva. Reintenta cuando puedas conectar.");
  const run = async () => {
    const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const started = Date.now();
    const read = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}&metadata=1`, { headers, cache: "no-store" });
    const existing = await read.json();
    cloudSyncDiagnostic({ trigger: manual ? "manual" : "local", endpoint: "/api/cloud/rounds", method: "GET", fingerprint,
      requestBytes: 0, responseBytes: jsonBytes(existing), durationMs: Date.now() - started,
      reason: "owner-revision", result: read.ok ? "success" : "failure" });
    if (!read.ok) throw new Error(existing.error || "No pudimos comprobar la ronda canónica.");
    if (!current()) return null;
    const remembered = Number(storage.getItem(key));
    if (existing.data && remembered !== Number(existing.data.version))
      throw new Error("La versión de nube cambió. Tu borrador sigue seguro; revisa la tarjeta antes de volver a sincronizar.");
    const body = { round: { ...round, updatedAt: new Date().toISOString() }, ...(existing.data ? { expectedVersion: remembered } : {}) };
    const method = existing.data ? "PUT" : "POST";
    const writeStarted = Date.now();
    const saved = await request("/api/cloud/rounds", { method, headers, cache: "no-store", body: JSON.stringify(body) });
    const result = await saved.json();
    cloudSyncDiagnostic({ trigger: manual ? "manual" : "local", endpoint: "/api/cloud/rounds", method, fingerprint,
      requestBytes: jsonBytes(body), responseBytes: jsonBytes(result), durationMs: Date.now() - writeStarted,
      reason: "owner-local-change", result: saved.ok ? "success" : "failure" });
    if (result.version) storage.setItem(key, String(result.version));
    if (!saved.ok) throw new Error(result.error || "Sincronización pendiente.");
    acknowledgeOwnerRound(storage, key, fingerprint); failed.delete(key);
    return result;
  };
  const promise = run(); flights.set(key, promise);
  try { return await promise; }
  catch (error) { failed.set(key, fingerprint); throw error; }
  finally { if (flights.get(key) === promise) flights.delete(key); }
}
