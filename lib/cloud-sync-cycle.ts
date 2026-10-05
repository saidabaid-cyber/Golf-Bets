import { cloudSyncPayloadFingerprint, mergeLocalAndCloud, stableValue, stripLocalRoundUi, type CloudDataBundle } from "./cloud-sync";

export type SyncStatus = "local" | "saving" | "offline" | "syncing" | "synced" | "pending" | "error";
type CycleOptions = {
  read: () => CloudDataBundle;
  download: () => Promise<CloudDataBundle>;
  upload: (bundle: CloudDataBundle, remote: CloudDataBundle) => Promise<unknown>;
  media: (bundle: CloudDataBundle) => Promise<void>;
  apply: (bundle: CloudDataBundle) => void;
  current: () => boolean;
  status: (value: SyncStatus) => void;
  conflicts?: (local: CloudDataBundle, remote: CloudDataBundle) => boolean;
  retry?: () => void;
  merge?: (local: CloudDataBundle, remote: CloudDataBundle) => CloudDataBundle;
  shouldUpload?: (local: CloudDataBundle, remote: CloudDataBundle, merged: CloudDataBundle) => boolean;
};

/** One acknowledged cycle. Re-read before merging and before applying so UI
 * edits made while the network is busy are never replaced by a stale closure. */
export async function runCloudSyncCycle(options: CycleOptions) {
  const check = () => { if (!options.current()) throw new Error("Sync cancelled"); };
  const merge = options.merge || mergeLocalAndCloud;
  try {
    check(); options.status("syncing");
    const remote = await options.download(); check();
    const before = structuredClone(options.read());
    if (options.conflicts?.(before, remote)) {
      options.status("pending");
      return false;
    }
    const merged = merge(before, remote);
    const uploadNeeded = options.shouldUpload?.(before, remote, merged) ?? true;
    const receipt = uploadNeeded ? await options.upload(merged, remote) : null; check();
    // New servers return the actual winner after CAS, projection and shared
    // links. ACK-only legacy servers retain the safe full-read fallback.
    const received = receipt && typeof receipt === "object" && "data" in receipt ? receipt.data as CloudDataBundle : null;
    const canonical = received || (uploadNeeded ? await options.download() : remote); check();
    await options.media(canonical); check();
    const latest = options.read();
    if (cloudSyncPayloadFingerprint(before) !== cloudSyncPayloadFingerprint(latest)) {
      // Rebase the newer local edit on the write that the server actually
      // confirmed. This records the canonical base without letting an older
      // response overwrite text that changed while the request was in flight.
      // The common base for edits made during this request is the local
      // snapshot that entered it, not its older server acknowledgment.
      // Confirming an unchanged score can return a field to that older base;
      // comparing against it would import the in-flight pending edit again.
      const rebasingLocal = {
        ...latest,
        baseDraft: before.activeDraft,
        baseDraftFingerprint: JSON.stringify(stableValue(stripLocalRoundUi(before.activeDraft))),
        baseDraftUpdatedAt: before.activeDraftUpdatedAt,
      };
      if (options.conflicts?.(rebasingLocal, canonical)) {
        options.status("pending");
        return false;
      }
      options.apply(merge(rebasingLocal, canonical));
      options.status("pending");
      options.retry?.();
      return false;
    }
    options.apply(merge(latest, canonical));
    options.status("synced");
    return true;
  } catch (error) {
    if (options.current()) options.status("error");
    throw error;
  }
}
