import { NextRequest, NextResponse } from "next/server";

import { ADMIN_ROLES, ADMIN_SCOPE_TYPES, type AdminRole, type AdminScopeType } from "../../../../lib/admin-control-center";
import { isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE });
}

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (request.nextUrl.search) return json({ error: "Este recurso no acepta selectores de usuario." }, 400);
  if (!serverPhase2FeatureFlags().admin_v1) return json({ hasAccess: false });
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);

  // The JWT owner is the only allowed selector. Even SUPER_ADMIN cannot use
  // this lightweight endpoint to enumerate another administrator.
  const memberships = await account.client
    .from("admin_memberships")
    .select("role,scope_type,scope_id")
    .eq("user_id", account.userId)
    .eq("active", true);
  if (memberships.error) return json({ error: "No fue posible comprobar el acceso administrativo." }, 503);
  const rows = (memberships.data || []).filter((row) => (
    (ADMIN_ROLES as readonly string[]).includes(String(row.role))
    && (ADMIN_SCOPE_TYPES as readonly string[]).includes(String(row.scope_type))
  ));
  if (!rows.length) return json({ hasAccess: false });
  const roles = [...new Set(rows.map((row) => row.role as AdminRole))];
  const scopes = rows.map((row) => ({ type: row.scope_type as AdminScopeType, id: typeof row.scope_id === "string" ? row.scope_id : null }));
  return json({ hasAccess: true, roles, scopes });
}
