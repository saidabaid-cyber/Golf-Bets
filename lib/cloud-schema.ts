type SchemaEnvironment = Pick<NodeJS.ProcessEnv,
  "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | "NEXT_PUBLIC_SUPABASE_ANON_KEY">;

type OpenApiSchema = {
  definitions?: Record<string, { properties?: Record<string, unknown> }>;
  components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
};

let cachedCapability: { projectUrl: string; extended: boolean; expiresAt: number } | null = null;

/** Inspect PostgREST's authenticated OpenAPI document instead of deliberately
 * selecting a column that may not exist. This keeps the temporary legacy
 * fallback quiet while an additive migration is rolling out. */
export async function supportsExtendedCloudSchema(
  accessToken: string,
  options: {
    env?: SchemaEnvironment;
    fetcher?: typeof fetch;
    now?: number;
    useCache?: boolean;
  } = {},
) {
  const env = options.env || process.env;
  const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!projectUrl || !publishableKey || !accessToken) throw new Error("cloud_schema_configuration_missing");

  const now = options.now ?? Date.now();
  if (options.useCache !== false && cachedCapability?.projectUrl === projectUrl && cachedCapability.expiresAt > now) {
    return cachedCapability.extended;
  }

  const response = await (options.fetcher || fetch)(`${projectUrl}/rest/v1/`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw Object.assign(new Error("cloud_schema_unavailable"), { status: response.status });
  const document = await response.json() as OpenApiSchema;
  const schemas = document.definitions || document.components?.schemas || {};
  const hasColumns = (table: string, columns: string[]) => {
    const properties = schemas[table]?.properties || {};
    return columns.every((column) => Object.hasOwn(properties, column));
  };
  const extended = hasColumns("round_scores_cloud", ["version", "updated_by_device", "updated_at"])
    && hasColumns("profiles", ["version", "updated_by_device", "updated_at"])
    && hasColumns("account_data_migrations", ["last_attempt_at", "last_error_code"]);
  if (options.useCache !== false) cachedCapability = { projectUrl, extended, expiresAt: now + 5 * 60_000 };
  return extended;
}

