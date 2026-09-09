import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "../network-timeout";

let browserClient: SupabaseClient | null | undefined;
export const AUTH_SESSION_PERSISTENCE_KEY = "the-backyard:auth-session-persistence:v1";
const authMemory = new Map<string, string>();

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
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
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
