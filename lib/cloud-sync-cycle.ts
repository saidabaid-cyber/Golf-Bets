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
};

/** One acknowledged cycle. Re-read before merging and before applying so UI
 * edits made while the network is busy are never replaced by a stale closure. */
export async function runCloudSyncCycle(options: CycleOptions) {
  const check = () => { if (!options.current()) throw new Error("Sync cancelled"); };
  try {
    check(); options.status("syncing");
    const remote = await options.download(); check();
    const before = options.read();
    if (options.conflicts?.(before, remote)) {
      options.status("pending");
      return false;
    }
    const merged = mergeLocalAndCloud(before, remote);
    await options.upload(merged); check();
    // Refetch the canonical result: another device may have won a conflict.
    const canonical = await options.download(); check();
    await options.media(canonical); check();
    const latest = options.read();
    if (cloudDataFingerprint(before) !== cloudDataFingerprint(latest)) {
      // Do not set synced or overwrite new local state; next cycle will merge it.
      options.status("pending");
      return false;
    }
    options.apply(canonical);
    options.status("synced");
    return true;
  } catch (error) {
    if (options.current()) options.status("error");
    throw error;
  }
}
