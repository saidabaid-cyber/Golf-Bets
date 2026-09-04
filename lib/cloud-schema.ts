import type { SupabaseClient } from "@supabase/supabase-js";

type SchemaClient = Pick<SupabaseClient, "from">;
type ProfileCapabilityRow = { version?: unknown; updated_by_device?: unknown; updated_at?: unknown };

const capabilityCache = new Map<string, { extended: boolean; expiresAt: number }>();

/**
 * Detect the additive cloud schema without requesting PostgREST's OpenAPI
 * document. Hosted Supabase no longer exposes GET /rest/v1/ to a normal user
 * JWT, even when that user is valid, so that endpoint must never gate sync.
 *
 * `profiles.select("*")` is an ordinary owner-scoped RLS query. Selecting all
 * existing columns works on both schema generations and lets us inspect the
 * returned row without deliberately requesting a missing column.
 */
export async function supportsExtendedCloudSchema(
  client: SchemaClient,
  userId: string,
  options: { now?: number; useCache?: boolean } = {},
) {
  if (!userId) throw new Error("cloud_schema_user_missing");
  const now = options.now ?? Date.now();
  const cached = capabilityCache.get(userId);
  if (options.useCache !== false && cached && cached.expiresAt > now) return cached.extended;

  const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  const row = (data || {}) as ProfileCapabilityRow;
  const extended = Object.hasOwn(row, "version")
    && Object.hasOwn(row, "updated_by_device")
    && Object.hasOwn(row, "updated_at");
  if (options.useCache !== false) capabilityCache.set(userId, { extended, expiresAt: now + 60_000 });
  return extended;
}
