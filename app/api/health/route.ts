import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { runtimeIdentity } from "../../../lib/server-runtime";

export async function GET() {
  const runtime = runtimeIdentity(); const admin = getSupabaseAdmin();
  let database: "ok" | "unavailable" = "unavailable"; let auth: "ok" | "unavailable" = "unavailable";
  if (admin) {
    const profileProbe = await admin.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
    database = profileProbe.error ? "unavailable" : "ok";
    const authProbe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    auth = authProbe.error ? "unavailable" : "ok";
  }
  const state = database === "ok" && auth === "ok" ? "ok" : "degraded";
  return NextResponse.json({ state, app: "ok", database, auth, version: runtime.appVersion, buildSha: runtime.buildSha, environment: runtime.environment }, {
    status: state === "ok" ? 200 : 503, headers: { "cache-control": "no-store" },
  });
}
