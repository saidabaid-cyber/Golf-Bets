import type { CloudSyncTrigger } from "./cloud-sync-gate";
import { cloudDiagnosticHostAllowed } from "./cloud-diagnostic-host";

export type CloudSyncDiagnostic = {
  trigger: CloudSyncTrigger; method?: "GET" | "POST" | "PUT";
  endpoint?: "/api/cloud/sync" | "/api/cloud/rounds";
  fingerprint?: string; requestBytes?: number; responseBytes?: number;
  durationMs?: number; reason: string;
  stage?: string; persisted?: boolean; knownCloud?: boolean;
  category?: string; errorName?: string; errorCode?: string; httpStatus?: number;
  effectGeneration?: number; retryNumber?: number;
  result: "skipped" | "coalesced" | "performed" | "success" | "failure";
};
export function cloudSyncDiagnostic(event: CloudSyncDiagnostic) {
  // Include this exact DEV deployment so an independent-origin clean login can
  // be measured too. Production/beta/other preview builds get no extra host.
  if (typeof window !== "undefined" && cloudDiagnosticHostAllowed(window.location.hostname, process.env.NEXT_PUBLIC_CLOUD_DIAGNOSTIC_PREVIEW_HOST))
    console.info("[backyard-cloud]", JSON.stringify(event));
}
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
