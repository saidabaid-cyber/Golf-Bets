import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cloudServerEnabled, pollaLiveServerEnabled } from "../feature-flags";
import { previewDatabaseFeaturesAvailable } from "../preview-database";

function databaseBindingAllowed() {
  return previewDatabaseFeaturesAvailable();
}

export function getSupabaseAdmin(feature: "cloud" | "polla" = "cloud") {
  if (!cloudServerEnabled || !databaseBindingAllowed() || (feature === "polla" && !pollaLiveServerEnabled)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getSupabaseForUser(token: string, feature: "cloud" | "polla" = "cloud") {
  if (!cloudServerEnabled || !databaseBindingAllowed() || (feature === "polla" && !pollaLiveServerEnabled)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Least-privilege server reader for SECURITY DEFINER projections that expose
 * only effective, player-safe publication data. It deliberately cannot read
 * draft ledgers, audit rows or private documents directly. */
export function getSupabasePublic(feature: "cloud" | "polla" = "cloud") {
  if (!cloudServerEnabled || !databaseBindingAllowed() || (feature === "polla" && !pollaLiveServerEnabled)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publicKey) return null;
  return createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
