import { NextRequest, NextResponse } from "next/server";

import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";
import { authenticatedRequest } from "../../../../lib/server-auth";

const PRIVATE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().admin_v1) return NextResponse.json({ error: "Admin está desactivado.", code: "FEATURE_DISABLED" }, { status: 404, headers: PRIVATE });
  const account = await authenticatedRequest(request);
  if (!account.ok) return NextResponse.json({ error: account.error, code: account.code }, { status: account.status, headers: PRIVATE });
  const { data, error } = await account.client.rpc("phase2_admin_aggregate_metrics");
  if (error) {
    const pending = ["42883", "PGRST202"].includes(error.code || "");
    const forbidden = ["42501", "PGRST301"].includes(error.code || "");
    return NextResponse.json({ error: forbidden ? "No tienes acceso de administración." : pending ? "Admin estará disponible tras la migración controlada de Preview." : "No pudimos calcular las métricas.", code: forbidden ? "ADMIN_REQUIRED" : pending ? "ADMIN_SCHEMA_PENDING" : "ADMIN_METRICS_FAILED" }, { status: forbidden ? 403 : 503, headers: PRIVATE });
  }
  return NextResponse.json({ data }, { headers: PRIVATE });
}
