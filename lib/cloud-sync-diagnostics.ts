import type { CloudSyncTrigger } from "./cloud-sync-gate";

export type CloudSyncDiagnostic = {
  trigger: CloudSyncTrigger; method?: "GET" | "POST" | "PUT";
  endpoint?: "/api/cloud/sync" | "/api/cloud/rounds";
  fingerprint?: string; requestBytes?: number; responseBytes?: number;
  durationMs?: number; reason: string;
  result: "skipped" | "coalesced" | "performed" | "success" | "failure";
};
export function cloudSyncDiagnostic(event: CloudSyncDiagnostic) {
  // Vercel preview runs a production build. Use the canonical DEV hostname,
  // not NODE_ENV, and never send a telemetry request or log payloads/identities.
  if (typeof window !== "undefined" && window.location.hostname === "dev.thebackyard.com.mx")
    console.info("[backyard-cloud]", JSON.stringify(event));
}
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
