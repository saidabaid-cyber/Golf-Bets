import { cloudDataFingerprint, mergeLocalAndCloud, type CloudDataBundle } from "./cloud-sync";

export type SyncStatus = "local" | "saving" | "offline" | "syncing" | "synced" | "pending" | "error";
type CycleOptions = {
  read: () => CloudDataBundle;
  download: () => Promise<CloudDataBundle>;
  upload: (bundle: CloudDataBundle) => Promise<unknown>;
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
    const before = options.read();
    if (options.conflicts?.(before, remote)) {
      options.status("pending");
      return false;
    }
    const merged = merge(before, remote);
    const uploadNeeded = options.shouldUpload?.(before, remote, merged) ?? true;
    if (uploadNeeded) {
      await options.upload(merged); check();
    }
    // A write is refetched to detect a concurrent winner. An unchanged
    // foreground poll stays GET-only.
    const canonical = uploadNeeded ? await options.download() : remote; check();
    await options.media(canonical); check();
    const latest = options.read();
    if (cloudDataFingerprint(before) !== cloudDataFingerprint(latest)) {
      // Rebase the newer local edit on the write that the server actually
      // confirmed. This records the canonical base without letting an older
      // response overwrite text that changed while the request was in flight.
      if (options.conflicts?.(latest, canonical)) {
        options.status("pending");
        return false;
      }
      options.apply(merge(latest, canonical));
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
