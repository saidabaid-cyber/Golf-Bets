import { membershipAllows, type AdminEntityType, type AdminMembership } from "./admin-control-center";

export const APPLICATION_ROLES = ["PLAYER", "ADMIN", "SUPER_ADMIN"] as const;
export type ApplicationRole = typeof APPLICATION_ROLES[number];
export const SIMPLE_ADMIN_MODULES = ["courses", "equipment", "balls", "bets", "competitions", "requests", "users", "content", "administrators", "audit", "advanced"] as const;
export type SimpleAdminModule = typeof SIMPLE_ADMIN_MODULES[number];
const MODULE_ENTITIES: Partial<Record<SimpleAdminModule, readonly AdminEntityType[]>> = {
  courses: ["COURSE", "COURSE_CONFIGURATION", "LOCAL_RULE_SET"], equipment: ["CLUB_EQUIPMENT", "SHAFT"],
  balls: ["BALL"], competitions: ["COMPETITION", "COMPETITION_RULE_SET"], requests: ["REQUEST"],
};
export function applicationRole(memberships: readonly AdminMembership[]): ApplicationRole {
  if (memberships.some(m => m.active && m.role === "SUPER_ADMIN" && m.scopeType === "GLOBAL" && m.scopeId === null)) return "SUPER_ADMIN";
  return memberships.some(m => m.active && m.role !== "SUPER_ADMIN") ? "ADMIN" : "PLAYER";
}
export function simpleAdminModules(memberships: readonly AdminMembership[]): SimpleAdminModule[] {
  const role = applicationRole(memberships);
  if (role === "PLAYER") return [];
  if (role === "SUPER_ADMIN") return [...SIMPLE_ADMIN_MODULES];
  return SIMPLE_ADMIN_MODULES.filter(module => {
    if (["administrators", "audit", "advanced"].includes(module)) return false;
    if (module === "users") return true;
    if (module === "bets" || module === "content") return memberships.some(m => m.active && m.scopeType === "GLOBAL" && (m.role === "ADMIN" || m.role === "CONTENT_ADMIN"));
    return (MODULE_ENTITIES[module] || []).some(entityType => memberships.some(m => membershipAllows(m, { entityType, scopeType: m.scopeType, scopeId: m.scopeId }, "READ")));
  });
}

/** A separate Git branch must never silently write to the frozen DEV database. */
export function adminModeDatabaseIsolated(env: Record<string, string | undefined> = process.env) {
  if (env.ADMIN_MODE_V2_ENABLED !== "true") return false;
  if (env.VERCEL !== undefined && (env.VERCEL_ENV !== "preview" || !/^feature\/admin-mode-v2(?:-|$)/.test(env.VERCEL_GIT_COMMIT_REF || ""))) return false;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL === undefined) return false;
  const ref = env.ADMIN_MODE_ISOLATED_DB_REF || "";
  if (!/^[a-z]{20}$/.test(ref) || ["bymeopxkxapfizeeqeyb", "zhqmlpljloumldaczcfp"].includes(ref)) return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.protocol === "https:" && url.hostname === `${ref}.supabase.co` && !url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}
