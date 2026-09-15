export const ACCOUNT_DATA_POLICIES = ["delete_golf_data", "retain_history"] as const;
export type AccountDataPolicy = (typeof ACCOUNT_DATA_POLICIES)[number];
const REQUEST_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAccountDeletionChoice(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Object.keys(source).every(key => ["confirmation", "dataPolicy", "requestId", "recoveryToken"].includes(key))) return null;
  if (source.recoveryToken !== undefined && (typeof source.recoveryToken !== "string" || !/^[a-f0-9]{64}$/.test(source.recoveryToken))) return null;
  return source.confirmation === "ELIMINAR" && ACCOUNT_DATA_POLICIES.includes(source.dataPolicy as AccountDataPolicy)
    && typeof source.requestId === "string" && REQUEST_UUID_V4.test(source.requestId)
    ? { dataPolicy: source.dataPolicy as AccountDataPolicy, requestId: source.requestId,
      ...(typeof source.recoveryToken === "string" ? { recoveryToken: source.recoveryToken } : {}) } : null;
}
