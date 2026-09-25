import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "../network-timeout";

let browserClient: SupabaseClient | null | undefined;
export const AUTH_SESSION_PERSISTENCE_KEY = "the-backyard:auth-session-persistence:v1";
export const CANONICAL_PREVIEW_SUPABASE_ORIGIN = "https://bymeopxkxapfizeeqeyb.supabase.co";
export const CANONICAL_PRODUCTION_SUPABASE_ORIGIN = "https://zhqmlpljloumldaczcfp.supabase.co";
const authMemory = new Map<string, string>();

type BrowserRuntimeLocation = Pick<Location, "hostname" | "protocol">;

function exactSupabaseOrigin(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) return null;
    return parsed.origin;
  } catch { return null; }
}

/** Browser Auth is bound before createClient can inspect or refresh a cached
 * session. Unknown preview hosts and cross-environment project refs fail closed. */
export function resolveBrowserSupabaseOrigin(rawUrl: string | undefined, location?: BrowserRuntimeLocation) {
  if (!rawUrl || !location) return null;
  const origin = exactSupabaseOrigin(rawUrl);
  if (!origin) return null;
  const hostname = location.hostname.toLowerCase();
  if (hostname === "dev.thebackyard.com.mx") {
    return location.protocol === "https:" && origin === CANONICAL_PREVIEW_SUPABASE_ORIGIN ? origin : null;
  }
  if (hostname === "app.thebackyard.com.mx") {
    return location.protocol === "https:" && origin === CANONICAL_PRODUCTION_SUPABASE_ORIGIN ? origin : null;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    if (origin === CANONICAL_PREVIEW_SUPABASE_ORIGIN) return origin;
    const target = new URL(origin);
    return (target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]")
      && (target.protocol === "http:" || target.protocol === "https:") ? origin : null;
  }
  return null;
}

export function setAuthSessionPersistence(remember: boolean) {
  try { localStorage.setItem(AUTH_SESSION_PERSISTENCE_KEY, remember ? "local" : "session"); }
  catch { /* The selected browser may block storage; Supabase can still use memory for this visit. */ }
}

export function authSessionPersistence() {
  try { return localStorage.getItem(AUTH_SESSION_PERSISTENCE_KEY) !== "session"; }
  catch { return true; }
}

const selectedAuthStorage = {
  getItem(key: string) {
    try {
      const value = authSessionPersistence() ? localStorage.getItem(key) : sessionStorage.getItem(key);
      return value ?? authMemory.get(key) ?? null;
    } catch { return authMemory.get(key) ?? null; }
  },
  setItem(key: string, value: string) {
    authMemory.set(key, value);
    try {
      if (authSessionPersistence()) { localStorage.setItem(key, value); sessionStorage.removeItem(key); }
      else { sessionStorage.setItem(key, value); localStorage.removeItem(key); }
    } catch { /* Keep this tab usable in memory-only browser modes. */ }
  },
  removeItem(key: string) {
    authMemory.delete(key);
    try { localStorage.removeItem(key); } catch { /* optional storage */ }
    try { sessionStorage.removeItem(key); } catch { /* optional storage */ }
  },
};

export function getSupabaseBrowser() {
  if (typeof window === "undefined") return null;
  if (browserClient !== undefined) return browserClient;
  const url = resolveBrowserSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, window.location);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    browserClient = null;
    return null;
  }
  browserClient = createClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
    auth: { persistSession: true, storage: selectedAuthStorage, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
  });
  return browserClient;
}

export const pollaCloudConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);
