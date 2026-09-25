const BYPASS_VALUE = /^[A-Za-z0-9._~-]{1,512}$/;
export const CANONICAL_QA_ORIGIN = "https://dev.thebackyard.com.mx";
export const CANONICAL_QA_SUPABASE_ORIGIN = "https://bymeopxkxapfizeeqeyb.supabase.co";

const THIRD_PARTY_SAFE_HEADERS = new Set([
  "accept", "accept-encoding", "accept-language", "cache-control", "if-modified-since", "if-none-match", "pragma", "range", "user-agent",
]);
const SUPABASE_SAFE_HEADERS = new Set([
  ...THIRD_PARTY_SAFE_HEADERS,
  "accept-profile", "apikey", "authorization", "content-profile", "content-type", "prefer", "range-unit", "x-client-info",
  "x-supabase-api-version", "x-supabase-client-platform", "x-supabase-client-platform-version",
  "x-supabase-client-runtime", "x-supabase-client-runtime-version",
]);

function destinationKind(value, canonicalOrigin) {
  const raw = typeof value === "string" ? value : String(value);
  let parsed;
  try { parsed = new URL(raw); } catch { return "third-party"; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "third-party";
  if ((raw === canonicalOrigin || raw.startsWith(`${canonicalOrigin}/`)) && parsed.origin === canonicalOrigin) return "canonical";
  if ((raw === CANONICAL_QA_SUPABASE_ORIGIN || raw.startsWith(`${CANONICAL_QA_SUPABASE_ORIGIN}/`)) && parsed.origin === CANONICAL_QA_SUPABASE_ORIGIN) return "supabase";
  return "third-party";
}

function retainOnly(headers, allowed) {
  for (const name of [...headers.keys()]) if (!allowed.has(name.toLowerCase())) headers.delete(name);
}

export function canonicalPreviewRequestHeaders(url, canonicalOrigin, bypassSecret = "", initialHeaders = {}) {
  if (canonicalOrigin !== CANONICAL_QA_ORIGIN) throw new Error("canonical Preview origin mismatch.");
  const headers = new Headers(initialHeaders);
  const destination = destinationKind(url, canonicalOrigin);
  // CDP may surface headers inherited across redirects. Always strip a prior
  // bypass before deciding whether the destination is the canonical origin.
  headers.delete("x-vercel-protection-bypass");
  headers.delete("proxy-authorization");
  headers.delete("x-api-key");
  if (destination === "supabase") {
    // Supabase Auth/REST legitimately needs its own bearer + public apikey.
    // App cookies and Vercel bypass credentials never belong there.
    retainOnly(headers, SUPABASE_SAFE_HEADERS);
  } else if (destination !== "canonical") {
    // Owner QA never authenticates a third-party origin. Replacing the paused
    // CDP request with a strict negotiation-only allowlist prevents redirect
    // inheritance from re-injecting app/Supabase credentials.
    retainOnly(headers, THIRD_PARTY_SAFE_HEADERS);
  } else {
    // The canonical app never needs a Supabase apikey header; its user bearer
    // and cookies are valid only because this destination is exact.
    headers.delete("apikey");
  }
  const bypass = String(bypassSecret || "").trim();
  if (bypass && !BYPASS_VALUE.test(bypass)) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET has an invalid header value.");
  if (bypass && destination === "canonical") headers.set("x-vercel-protection-bypass", bypass);
  return Object.fromEntries(headers.entries());
}

export function canonicalPreviewCdpHeaders(url, canonicalOrigin, bypassSecret = "", initialHeaders = {}) {
  return Object.entries(canonicalPreviewRequestHeaders(url, canonicalOrigin, bypassSecret, initialHeaders))
    .map(([name, value]) => ({ name, value }));
}
