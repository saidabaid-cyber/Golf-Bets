import { CLOUD_TOMBSTONES_KEY, collectLocalCloudData, type CloudDataBundle, type CloudTombstone } from "./cloud-sync";
import { persistOfflineBundle } from "./offline-store";
import { upsertRoundSnapshot } from "./round-editing";
import { persistRoundHistory, readStoredJson, STORAGE_KEYS } from "./round-utils";
import type { RoundSnapshot } from "./types";

type RoundHistoryStorage = Pick<Storage, "getItem" | "setItem">;

type PersistOffline = (
  ownerId: string,
  bundle: CloudDataBundle,
  queueForCloud: boolean,
) => Promise<string>;

export type SaveRoundHistoryOptions = {
  storage: RoundHistoryStorage;
  ownerId: string;
  snapshot: RoundSnapshot;
  deviceId: string;
  defaultHandicap: number | null;
  hasLocalPreferenceState: boolean;
  queueForCloud: boolean;
  persistOffline?: PersistOffline;
};

export type SaveRoundHistoryResult = {
  history: RoundSnapshot[];
  bundle: CloudDataBundle;
  fingerprint: string;
};

/**
 * Finalizes a round locally before any cloud work is allowed to affect the UI.
 * The current localStorage history is always re-read, upserted and verified so
 * a delayed React closure cannot drop another round. IndexedDB receives the
 * same final snapshot with no active draft and, for linked accounts, becomes
 * the idempotent cloud outbox item.
 */
export async function saveRoundHistoryLocalFirst({
  storage,
  ownerId,
  snapshot,
  deviceId,
  defaultHandicap,
  hasLocalPreferenceState,
  queueForCloud,
  persistOffline = persistOfflineBundle,
}: SaveRoundHistoryOptions): Promise<SaveRoundHistoryResult> {
  const stored = readStoredJson<unknown>(storage, STORAGE_KEYS.history, []);
  const latestHistory = Array.isArray(stored) ? stored as RoundSnapshot[] : [];
  const nextHistory = upsertRoundSnapshot(latestHistory, snapshot);

  persistRoundHistory(storage, nextHistory);
  const verifiedValue = readStoredJson<unknown>(storage, STORAGE_KEYS.history, []);
  const verifiedHistory = Array.isArray(verifiedValue) ? verifiedValue as RoundSnapshot[] : [];
  if (!verifiedHistory.some((round) => round.id === snapshot.id)) {
    throw new Error("No se pudo comprobar la ronda en el Histórico local.");
  }

  // A round corrected or re-saved with the same stable id is live again. A
  // stale deletion marker must never remove this newly confirmed snapshot.
  const tombstoneValue = readStoredJson<unknown>(storage, CLOUD_TOMBSTONES_KEY, []);
  const tombstones = Array.isArray(tombstoneValue) ? tombstoneValue as CloudTombstone[] : [];
  const liveTombstones = tombstones.filter((item) => !(item?.entityType === "round" && item.localId === snapshot.id));
  if (liveTombstones.length !== tombstones.length) {
    storage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify(liveTombstones));
  }

  const bundle = collectLocalCloudData(storage, defaultHandicap, hasLocalPreferenceState);
  bundle.deviceId = deviceId;
  bundle.history = verifiedHistory;
  bundle.activeDraft = null;
  bundle.activeDraftUpdatedAt = snapshot.updatedAt || snapshot.completedAt || new Date().toISOString();
  const fingerprint = await persistOffline(ownerId, bundle, queueForCloud);

  return { history: verifiedHistory, bundle, fingerprint };
}
