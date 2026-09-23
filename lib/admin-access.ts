import { ADMIN_ROLES, ADMIN_SCOPE_TYPES, type AdminRole, type AdminScopeType } from "./admin-control-center";

export type AdminAccess = {
  hasAccess: boolean;
  roles: AdminRole[];
  scopes: Array<{ type: AdminScopeType; id: string | null }>;
};

export const NO_ADMIN_ACCESS: AdminAccess = { hasAccess: false, roles: [], scopes: [] };

export function normalizeAdminAccess(value: unknown): AdminAccess {
  if (!value || typeof value !== "object" || (value as { hasAccess?: unknown }).hasAccess !== true) return NO_ADMIN_ACCESS;
  const source = value as { roles?: unknown; scopes?: unknown };
  const roles = Array.isArray(source.roles)
    ? [...new Set(source.roles.filter((role): role is AdminRole => typeof role === "string" && (ADMIN_ROLES as readonly string[]).includes(role)))]
    : [];
  const scopes = Array.isArray(source.scopes)
    ? source.scopes.flatMap((scope) => {
      if (!scope || typeof scope !== "object") return [];
      const type = (scope as { type?: unknown }).type;
      const id = (scope as { id?: unknown }).id;
      if (typeof type !== "string" || !(ADMIN_SCOPE_TYPES as readonly string[]).includes(type)) return [];
      return [{ type: type as AdminScopeType, id: typeof id === "string" && id.trim() ? id : null }];
    })
    : [];
  return roles.length ? { hasAccess: true, roles, scopes } : NO_ADMIN_ACCESS;
}

export async function readAdminAccess(accessToken: string, signal?: AbortSignal) {
  const response = await fetch("/api/admin/access", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("admin_access_unavailable");
  return normalizeAdminAccess(await response.json());
}
