import "server-only";
import type { NextRequest } from "next/server";
import { authenticatedRequest } from "./server-auth";
import { adminModeDatabaseIsolated, applicationRole, simpleAdminModules, type SimpleAdminModule } from "./admin-mode";
import { ADMIN_ROLES, ADMIN_SCOPE_TYPES, type AdminMembership } from "./admin-control-center";
import { isCrossSiteRequest } from "./backyard-ai/server/http-security";

export async function requireAdminMode(request: NextRequest, module?: SimpleAdminModule) {
  if (isCrossSiteRequest(request)) return { ok: false as const, status: 403, error: "Solicitud no permitida.", code: "CROSS_SITE_DENIED" };
  const account = await authenticatedRequest(request);
  if (!account.ok) return account;
  const result = await account.client.from("admin_memberships").select("user_id,role,scope_type,scope_id,active").eq("user_id", account.userId).eq("active", true);
  if (result.error) return { ok: false as const, status: 503, error: "No pudimos confirmar tus permisos.", code: "ADMIN_ACCESS_UNAVAILABLE" };
  const memberships: AdminMembership[] = (result.data || []).flatMap(row => {
    if (!(ADMIN_ROLES as readonly string[]).includes(row.role) || !(ADMIN_SCOPE_TYPES as readonly string[]).includes(row.scope_type)) return [];
    if (row.scope_type === "GLOBAL" ? row.scope_id !== null : !row.scope_id) return [];
    return [{ userId: account.userId, role: row.role, scopeType: row.scope_type, scopeId: row.scope_id, active: row.active } as AdminMembership];
  });
  const role = applicationRole(memberships); const modules = simpleAdminModules(memberships);
  if (role === "PLAYER" || module && !modules.includes(module)) return { ok: false as const, status: 403, error: "Tu cuenta no tiene permiso para esta operación.", code: "ADMIN_PERMISSION_DENIED" };
  if (!adminModeDatabaseIsolated()) return { ok: false as const, status: 503, error: "Modo administrador pendiente de activación en este entorno.", code: "ADMIN_ISOLATED_DATABASE_PENDING" };
  return { ...account, role, modules, memberships };
}
