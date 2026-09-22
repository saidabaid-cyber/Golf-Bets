import "server-only";

import { getSupabasePublic } from "./supabase/server";

export type PublishedCatalogRevision = {
  entity_type: string;
  entity_id: string;
  version: number;
  status: "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  payload: unknown;
  effective_from: string | null;
  effective_until: string | null;
};

/** Reads only the reviewed projection exposed by the DB function. The anon
 * client has no table privileges for the private revision ledger. */
export async function readPublishedCatalog(entityTypes: readonly string[]) {
  const client = getSupabasePublic("cloud");
  if (!client) return [] as PublishedCatalogRevision[];
  const result = await client.rpc("player_published_catalog_v1", { requested_entity_types: [...entityTypes] });
  if (result.error || !Array.isArray(result.data)) return [] as PublishedCatalogRevision[];
  return result.data.flatMap((row): PublishedCatalogRevision[] => {
    if (!row || typeof row !== "object") return [];
    const candidate = row as Record<string, unknown>;
    if (typeof candidate.entity_type !== "string" || typeof candidate.entity_id !== "string" || typeof candidate.version !== "number" || !["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(String(candidate.status))) return [];
    return [{
      entity_type: candidate.entity_type,
      entity_id: candidate.entity_id,
      version: candidate.version,
      status: candidate.status as PublishedCatalogRevision["status"],
      payload: candidate.payload,
      effective_from: typeof candidate.effective_from === "string" ? candidate.effective_from : null,
      effective_until: typeof candidate.effective_until === "string" ? candidate.effective_until : null,
    }];
  });
}
