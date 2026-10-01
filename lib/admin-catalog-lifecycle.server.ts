import "server-only";
import { adminModeDatabaseIsolated } from "./admin-mode";
import { getSupabasePublic } from "./supabase/server";
export type CatalogLifecycle = { entity_type: string; entity_id: string; state: "ACTIVE" | "ARCHIVED" | "DELETED" };
export async function catalogLifecycle() {
  if (!adminModeDatabaseIsolated()) return [] as CatalogLifecycle[];
  const client = getSupabasePublic("cloud");
  if (!client) return [] as CatalogLifecycle[];
  const result = await client.rpc("player_catalog_lifecycle_v3");
  if (result.error) throw new Error("No pudimos comprobar el estado del catálogo.");
  return (result.data || []) as CatalogLifecycle[];
}
export function applyCatalogLifecycle<T extends { id: string; active: boolean }>(items: readonly T[], states: CatalogLifecycle[], kind: string): T[] {
  const byId = new Map(states.filter(row => row.entity_type === kind).map(row => [row.entity_id,row.state]));
  return items.flatMap(item => byId.get(item.id) === "DELETED" ? [] : byId.has(item.id) ? [{...item,active:byId.get(item.id) === "ACTIVE"}] : [item]);
}
