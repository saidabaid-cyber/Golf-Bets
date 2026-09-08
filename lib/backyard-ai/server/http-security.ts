import { isIP } from "node:net";

export const BACKYARD_AI_PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export type JsonBodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid_json" | "invalid_length" | "too_large" | "unsupported_media_type" };

function declaredBodyLength(request: Request) {
  const value = request.headers.get("content-length");
  if (value === null) return { ok: true as const, value: null };
  const clean = value.trim();
  if (!/^\d+$/.test(clean)) return { ok: false as const };
  const parsed = Number(clean);
  return Number.isSafeInteger(parsed) ? { ok: true as const, value: parsed } : { ok: false as const };
}

export function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") === "application/json";
}

/** Rejects browser cross-site calls without relying on a spoofable Origin alone. */
export function isCrossSiteRequest(request: Request) {
  if (request.headers.get("sec-fetch-site")?.toLocaleLowerCase("en-US") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

/**
 * Reads a JSON body incrementally, so a missing or dishonest Content-Length
 * cannot make the route buffer an unbounded request before rejecting it.
 */
export async function readJsonBodyWithLimit(request: Request, maxBytes: number): Promise<JsonBodyReadResult> {
  if (!isJsonRequest(request)) return { ok: false, reason: "unsupported_media_type" };
  const declared = declaredBodyLength(request);
  if (!declared.ok) return { ok: false, reason: "invalid_length" };
  if (declared.value !== null && declared.value > maxBytes) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function normalizedAddress(value: string | null) {
  if (!value) return null;
  const candidate = value.split(",", 1)[0]?.trim() || "";
  // Accept only a compact IP-like token. The platform remains responsible for
  // replacing forwarded headers; arbitrary attacker-controlled strings collapse
  // into one "unknown" bucket instead of growing the limiter map.
  return candidate.length <= 64 && isIP(candidate) !== 0 ? candidate.toLocaleLowerCase("en-US") : null;
}

export function backyardAiClientAddress(request: Request) {
  return normalizedAddress(request.headers.get("x-real-ip"))
    || normalizedAddress(request.headers.get("x-forwarded-for"))
    || "unknown";
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
