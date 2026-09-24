import "server-only";

import { createHash } from "node:crypto";

import { GhinReadOnlyClient } from "./client";
import { resolveGhinPreviewCapabilities, type GhinPreviewCapabilities } from "./config";
import { readGhinServerCredentials } from "./credentials.server";

export type GhinRuntimeBlocker =
  | "PREVIEW_ONLY"
  | "MASTER_FLAG_DISABLED"
  | "CREDENTIALS_NOT_CONFIGURED"
  | "INVALID_API_BASE_URL";

export type GhinRuntime =
  | { ok: true; client: GhinReadOnlyClient; capabilities: GhinPreviewCapabilities }
  | { ok: false; blocker: GhinRuntimeBlocker; capabilities: GhinPreviewCapabilities };

let singleton: { signature: string; client: GhinReadOnlyClient } | null = null;

function runtimeSignature(values: readonly (string | undefined)[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function resolveGhinRuntime(
  env: Record<string, string | undefined> = process.env,
): GhinRuntime {
  const capabilities = resolveGhinPreviewCapabilities(env);
  if (!capabilities.previewOnly) return { ok: false, blocker: "PREVIEW_ONLY", capabilities };
  if (!capabilities.masterEnabled) return { ok: false, blocker: "MASTER_FLAG_DISABLED", capabilities };
  if (!capabilities.apiBaseUrl) return { ok: false, blocker: "INVALID_API_BASE_URL", capabilities };
  const credentials = readGhinServerCredentials(env);
  if (!credentials) return { ok: false, blocker: "CREDENTIALS_NOT_CONFIGURED", capabilities };

  const signature = runtimeSignature([
    capabilities.apiBaseUrl,
    credentials.login,
    credentials.password,
    credentials.loginBootstrapToken,
  ]);
  if (!singleton || singleton.signature !== signature) {
    singleton = {
      signature,
      client: new GhinReadOnlyClient({
        baseUrl: capabilities.apiBaseUrl,
        credentials,
      }),
    };
  }
  return { ok: true, client: singleton.client, capabilities };
}
