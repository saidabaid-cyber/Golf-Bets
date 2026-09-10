import type { CloudDataBundle } from "./cloud-sync";

/**
 * Keeps the user-approved conflict resolution authoritative while React
 * commits the matching state update. Without this hand-off, an immediate
 * sync can flush the previous render back to storage and rediscover the same
 * conflict a second time.
 */
export class CloudConflictResolutionBuffer {
  private staged: CloudDataBundle | null = null;

  stage(bundle: CloudDataBundle) {
    this.staged = bundle;
  }

  read(fallback: () => CloudDataBundle) {
    return this.staged || fallback();
  }

  clear() {
    this.staged = null;
  }

  get pending() {
    return this.staged !== null;
  }
}
