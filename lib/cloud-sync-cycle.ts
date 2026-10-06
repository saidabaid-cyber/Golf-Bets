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
  trace?: (event: CloudCycleTrace) => void;
};

export type CloudCycleTrace = {
  stage: string;
  result: "performed" | "success" | "failure";
  persisted: boolean;
  category?: "persistence" | "canonical" | "post-persistence-client" | "secondary-side-effect";
  errorName?: string;
  errorCode?: string;
  httpStatus?: number;
};

/** Only categorical error metadata, never messages or payloads. */
export function cloudCycleErrorFields(error: unknown) {
  const value = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; status?: unknown } : {};
  const names = ["Error", "TypeError", "RangeError", "DOMException", "QuotaExceededError", "CloudSyncHttpError"];
  return {
    errorName: typeof value.name === "string" && names.includes(value.name) ? value.name : "Error",
    ...(typeof value.code === "string" && /^(?:[A-Z][A-Z0-9_]{0,49}|[0-9]{5})$/.test(value.code) ? { errorCode: value.code } : {}),
    ...(typeof value.status === "number" && value.status >= 100 && value.status <= 599 ? { httpStatus: value.status } : {}),
  };
}

/** One acknowledged cycle. Re-read before merging and before applying so UI
 * edits made while the network is busy are never replaced by a stale closure. */
export async function runCloudSyncCycle(options: CycleOptions) {
  let stage = "sync:current-check", persisted = false;
  const trace = (next: string, result: CloudCycleTrace["result"] = "performed") => {
    stage = next; options.trace?.({ stage, result, persisted });
  };
  const check = () => { trace("sync:current-check"); if (!options.current()) throw new Error("Sync cancelled"); };
  const merge = options.merge || mergeLocalAndCloud;
  try {
    check(); options.status("syncing");
    trace("sync:download:start");
    const remote = await options.download(); trace("sync:download:success", "success"); check();
    trace("sync:local-read");
    const before = structuredClone(options.read());
    if (options.conflicts?.(before, remote)) {
      options.status("pending");
      return false;
    }
    const merged = merge(before, remote);
    const uploadNeeded = options.shouldUpload?.(before, remote, merged) ?? true;
    trace("sync:upload-decision");
    if (uploadNeeded) trace("sync:upload:start");
    const receipt = uploadNeeded ? await options.upload(merged, remote) : null;
    if (uploadNeeded) { persisted = true; trace("sync:upload:validation-success", "success"); }
    check();
    // New servers return the actual winner after CAS, projection and shared
    // links. ACK-only legacy servers retain the safe full-read fallback.
    const received = receipt && typeof receipt === "object" && "data" in receipt ? receipt.data as CloudDataBundle : null;
    trace(received ? "sync:canonical-receipt" : "sync:canonical-read");
    const canonical = received || (uploadNeeded ? await options.download() : remote); check();
    trace("sync:media:start");
    await options.media(canonical); trace("sync:media:success", "success"); check();
    trace("sync:local-read-after-persistence");
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
      trace("sync:apply:start");
      options.apply(merge(rebasingLocal, canonical)); trace("sync:apply:success", "success");
      options.status("pending");
      options.retry?.();
      return false;
    }
    trace("sync:apply:start");
    options.apply(merge(latest, canonical)); trace("sync:apply:success", "success");
    options.status("synced");
    trace("sync:cycle:success", "success");
    return true;
  } catch (error) {
    options.trace?.({ stage, result: "failure", persisted,
      category: stage === "sync:media:start" || stage === "sync:apply:start" ? "secondary-side-effect"
        : persisted ? "post-persistence-client" : stage === "sync:upload:start" ? "canonical" : "persistence",
      ...cloudCycleErrorFields(error) });
    if (options.current()) options.status("error");
    throw error;
  }
}
