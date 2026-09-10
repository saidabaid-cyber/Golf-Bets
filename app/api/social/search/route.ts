import { NextRequest, NextResponse } from "next/server";
import { serverPhase2FeatureFlags } from "../../../../../features/feature-flags/server";
import { normalizeUsernameSearch } from "../../../../../features/social/domain";
import { authenticatedRequest } from "../../../../../lib/server-auth";

const PRIVATE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().social_v2) return NextResponse.json({ error: "Social V2 está desactivado.", code: "FEATURE_DISABLED" }, { status: 404, headers: PRIVATE });
  const account = await authenticatedRequest(request);
  if (!account.ok) return NextResponse.json({ error: account.error, code: account.code }, { status: account.status, headers: PRIVATE });
  const username = normalizeUsernameSearch(request.nextUrl.searchParams.get("username"));
  if (username.length < 2) return NextResponse.json({ data: [] }, { headers: PRIVATE });
  const { data, error } = await account.client.from("social_profiles")
    .select("user_id,username,display_name,avatar_url,handicap,club_name,privacy")
    .ilike("username", `%${username}%`)
    .neq("user_id", account.userId)
    .limit(20);
  if (error) {
    const schemaMissing = ["42P01", "PGRST204", "PGRST205"].includes(error.code || "");
    return NextResponse.json({
      error: schemaMissing ? "Social estará disponible cuando se aplique la migración controlada de Preview." : "No se pudo buscar en este momento.",
      code: schemaMissing ? "SOCIAL_SCHEMA_PENDING" : "SOCIAL_SEARCH_FAILED",
    }, { status: 503, headers: PRIVATE });
  }
  return NextResponse.json({ data: data ?? [] }, { headers: PRIVATE });
}

