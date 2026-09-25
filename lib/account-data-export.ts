import { ACCOUNT_STORAGE_KEYS, type BackyardProfile } from "./account-state";
import { WORKSPACE_OWNER_KEY } from "./account-workspace";
import { collectLocalCloudData } from "./cloud-sync";
import { GUEST_LEGAL_ACTOR_KEY, readLegalEvidence, type LegalEnvironment } from "./legal-evidence-client";

export const ACCOUNT_DATA_EXPORT_LIMIT = 500;

export type AccountExportEnvironment = "production" | "preview" | "development" | "test";
export type AccountExportSource = { available: boolean; data: unknown };

const PROFILE_FIELDS = [
  "display_name", "given_name", "family_name", "username", "avatar_url",
  "default_handicap", "home_club", "preferred_tee", "handedness", "bio",
  "profile_visibility", "city", "state", "country", "onboarding_completed_at",
  "created_at", "updated_at",
] as const;
const PREFERENCE_FIELDS = ["high_contrast", "locale", "default_handicap", "notifications_enabled", "created_at", "updated_at"] as const;
const LEGAL_ACCEPTANCE_FIELDS = ["type", "version", "accepted_at", "locale", "created_at"] as const;
const LEGAL_EVIDENCE_FIELDS = [
  "environment", "document_key", "purpose_key", "document_version", "document_hash",
  "statement_key", "statement_text", "statement_hash", "action", "locale", "origin",
  "client_occurred_at", "server_received_at", "idempotency_key",
] as const;
const AI_CONSENT_FIELDS = [
  "scope", "policy_version", "decision_status", "source", "decided_at",
  "accepted_at", "revoked_at", "locale", "created_at", "updated_at",
] as const;

type Scalar = string | number | boolean | null;
export type LocalExportIdentity = Pick<BackyardProfile, "userId" | "displayName" | "email" | "defaultHandicap">
  & Partial<Pick<BackyardProfile, "givenName" | "familyName" | "username" | "city" | "state" | "country" |
  "homeClub" | "homeCourse" | "preferredTee" | "handedness" | "profileVisibility">>
  & { mode: "guest" | "authenticated" };

const LOCAL_FORBIDDEN_KEY = /(?:^|_)(?:access|refresh|id)?token(?:$|_)|secret|password|credential|authorization|cookie|session/i;

function parseStoredValue(raw: string | null) {
  if (raw === null) return null;
  try { return JSON.parse(raw) as unknown; }
  catch { return null; }
}

/** Browser storage is untrusted and may contain old/malformed fields. Strip
 * credential-shaped keys and inline binary URLs recursively before download. */
function sanitizeLocalValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.startsWith("data:") || value.length > 100_000 ? undefined : value;
  if (Array.isArray(value)) return value.slice(0, ACCOUNT_DATA_EXPORT_LIMIT)
    .map((item) => sanitizeLocalValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !LOCAL_FORBIDDEN_KEY.test(key))
    .map(([key, item]) => [key, sanitizeLocalValue(item, depth + 1)])
    .filter(([, item]) => item !== undefined));
}

function localCollection(values: unknown[]) {
  return {
    status: "included" as const,
    truncated: values.length > ACCOUNT_DATA_EXPORT_LIMIT,
    records: sanitizeLocalValue(values.slice(0, ACCOUNT_DATA_EXPORT_LIMIT)) as unknown[],
  };
}

/**
 * Produces an owner-scoped copy of the currently mounted local workspace.
 * It deliberately refuses a stale identity/workspace pair instead of reading
 * global keys that may already belong to another signed-in account.
 */
export function buildLocalAccountExport(
  storage: Pick<Storage, "getItem">,
  identity: LocalExportIdentity,
  environment: LegalEnvironment,
  generatedAt = new Date().toISOString(),
) {
  const workspaceOwner = storage.getItem(WORKSPACE_OWNER_KEY) || "guest";
  if (!identity.userId || workspaceOwner !== identity.userId) throw new Error("local_export_owner_mismatch");
  const bundle = collectLocalCloudData(storage, identity.defaultHandicap);
  // Shared/read-only history belongs to another account's server-owned view.
  // Account-owned templates may reference playing partners because those
  // templates are records created inside this owner's workspace.
  const ownedHistory = bundle.history.filter((round) => round.cloudReadOnly !== true && !round.id.startsWith("shared:"));
  const legacy = parseStoredValue(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
  const legacyLegalRecords = Array.isArray(legacy)
    ? legacy.filter((item) => item && typeof item === "object" && (item as { userId?: unknown }).userId === identity.userId)
    : [];
  const actorKey = identity.mode === "authenticated" ? `account:${identity.userId}` : storage.getItem(GUEST_LEGAL_ACTOR_KEY);
  const legalEvidence = actorKey ? readLegalEvidence(storage, actorKey, environment) : [];
  const safeProfile = sanitizeLocalValue({
    userId: identity.userId,
    displayName: identity.displayName,
    email: identity.mode === "authenticated" ? identity.email : "",
    defaultHandicap: identity.defaultHandicap,
    givenName: identity.givenName,
    familyName: identity.familyName,
    username: identity.username,
    city: identity.city,
    state: identity.state,
    country: identity.country,
    homeClub: identity.homeClub,
    homeCourse: identity.homeCourse,
    preferredTee: identity.preferredTee,
    handedness: identity.handedness,
    profileVisibility: identity.profileVisibility,
  });
  return {
    exportVersion: 2,
    generatedAt,
    account: { userId: identity.userId, environment, context: identity.mode === "authenticated" ? "authenticated_local_workspace" : "guest_local_workspace" },
    scope: {
      kind: "owner_scoped_local_workspace_copy",
      completeDeviceExport: false,
      included: ["profile", "round_history", "active_round_draft", "frequent_players", "frequent_groups", "opponent_templates", "courses", "preferences", "legacy_legal_records", "legal_evidence"],
      omitted: [
        "authentication and session tokens",
        "secrets and provider credentials",
        "other account workspaces and shared read-only rounds",
        "binary scorecard photos, avatars and other blobs",
        "IndexedDB/offline records outside the active owner workspace",
        "browser keys not explicitly enumerated",
      ],
    },
    data: {
      profile: { status: "included" as const, record: safeProfile },
      roundHistory: localCollection(ownedHistory),
      activeRoundDraft: { status: "included" as const, record: sanitizeLocalValue(bundle.activeDraft) },
      frequentPlayers: localCollection(bundle.frequentPlayers),
      frequentGroups: localCollection(bundle.frequentGroups),
      opponentTemplates: localCollection(bundle.rivals),
      courses: localCollection(bundle.courses),
      preferences: { status: "included" as const, record: sanitizeLocalValue(bundle.preferences) },
      legacyLegalRecords: localCollection(legacyLegalRecords),
      legalEvidence: localCollection(legalEvidence),
    },
    note: "Copia local acotada al workspace activo del owner indicado. No es una exportación integral del dispositivo ni una respuesta formal ARCO.",
  };
}

export function buildCombinedAccountExport(input: {
  local: ReturnType<typeof buildLocalAccountExport>;
  cloud?: ReturnType<typeof buildLimitedAccountExport> | null;
  cloudStatus?: "included" | "not_requested" | "unavailable_session" | "unavailable_offline" | "unavailable_service";
  generatedAt?: string;
}) {
  if (input.cloud && input.cloud.account.userId !== input.local.account.userId) throw new Error("account_export_owner_mismatch");
  return {
    exportVersion: 3,
    generatedAt: input.generatedAt || new Date().toISOString(),
    account: input.local.account,
    scope: {
      kind: input.cloud ? "combined_limited_cloud_and_owner_local_copy" : "owner_scoped_local_copy",
      completeAccountExport: false,
      sources: input.cloud ? ["limited_cloud", "owner_local_workspace"] : ["owner_local_workspace"],
    },
    data: { cloud: input.cloud || { status: input.cloudStatus || "not_requested" }, local: input.local },
    note: "El archivo enumera su alcance y omisiones. No incluye tokens, secretos, workspaces de otras cuentas ni blobs.",
  };
}

type ExportFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Local export is the durable baseline. Cloud enrichment is deliberately
 * best-effort, so an expired/offline session or a 503 never withholds the
 * owner's current device copy. */
export async function buildDownloadableAccountExport(args: {
  storage: Pick<Storage, "getItem">;
  identity: LocalExportIdentity;
  environment: LegalEnvironment;
  accessToken: string | null;
  online: boolean;
  request?: ExportFetch;
  generatedAt?: string;
}) {
  const local = buildLocalAccountExport(args.storage, args.identity, args.environment, args.generatedAt);
  let cloud: ReturnType<typeof buildLimitedAccountExport> | null = null;
  let cloudStatus: NonNullable<Parameters<typeof buildCombinedAccountExport>[0]["cloudStatus"]> = "not_requested";
  if (args.identity.mode === "authenticated" && !args.accessToken) cloudStatus = "unavailable_session";
  else if (args.identity.mode === "authenticated" && !args.online) cloudStatus = "unavailable_offline";
  else if (args.identity.mode === "authenticated" && args.accessToken) {
    try {
      const response = await (args.request || fetch)("/api/account/export", {
        method: "GET",
        headers: { authorization: `Bearer ${args.accessToken}` },
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20_000) : undefined,
      });
      const result = await response.json().catch(() => null) as ReturnType<typeof buildLimitedAccountExport> | null;
      if (!response.ok || !result || typeof result !== "object" || result.account?.userId !== args.identity.userId) throw new Error("cloud_export_unavailable");
      cloud = result;
      cloudStatus = "included";
    } catch { cloudStatus = "unavailable_service"; }
  }
  return { payload: buildCombinedAccountExport({ local, cloud, cloudStatus, generatedAt: args.generatedAt }), cloudStatus };
}

function safeScalar(value: unknown): Scalar | undefined {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function project(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const projected: Record<string, Scalar> = {};
  for (const field of fields) {
    const scalar = safeScalar(source[field]);
    if (scalar !== undefined) projected[field] = scalar;
  }
  return projected;
}

function exportCollection(source: AccountExportSource, fields: readonly string[], limit = ACCOUNT_DATA_EXPORT_LIMIT) {
  if (!source.available) return { status: "unavailable" as const, truncated: false, records: [] as Record<string, Scalar>[] };
  const values = Array.isArray(source.data) ? source.data : source.data ? [source.data] : [];
  const records = values.slice(0, limit).map((value) => project(value, fields)).filter((value): value is Record<string, Scalar> => Boolean(value));
  return { status: "included" as const, truncated: values.length > limit, records };
}

/**
 * Produces a deliberately limited account copy. Every field is re-projected,
 * even though the route also uses explicit SELECT lists, so an accidental `*`
 * cannot leak a token, secret, another account id, or an internal column.
 */
export function buildLimitedAccountExport(input: {
  userId: string;
  environment: AccountExportEnvironment;
  generatedAt?: string;
  profile: AccountExportSource;
  preferences: AccountExportSource;
  legalAcceptances: AccountExportSource;
  legalEvidence: AccountExportSource;
  aiProcessingConsents: AccountExportSource;
}) {
  return {
    exportVersion: 2,
    generatedAt: input.generatedAt || new Date().toISOString(),
    account: { userId: input.userId, environment: input.environment },
    scope: {
      kind: "limited_account_copy",
      completeCloudExport: false,
      included: ["profile", "preferences", "legal_acceptances", "legal_evidence", "ai_processing_consents"],
      omitted: [
        "authentication and session tokens",
        "secrets and provider credentials",
        "records owned by other people",
        "shared round, group, social and betting records",
        "binary files and images",
        "browser-local records not synchronized to this Preview database",
        "cloud tables not explicitly listed above",
      ],
    },
    data: {
      profile: exportCollection(input.profile, PROFILE_FIELDS, 1),
      preferences: exportCollection(input.preferences, PREFERENCE_FIELDS, 1),
      legalAcceptances: exportCollection(input.legalAcceptances, LEGAL_ACCEPTANCE_FIELDS),
      legalEvidence: exportCollection(input.legalEvidence, LEGAL_EVIDENCE_FIELDS),
      aiProcessingConsents: exportCollection(input.aiProcessingConsents, AI_CONSENT_FIELDS),
    },
    note: "Esta es una copia técnica limitada de las fuentes enumeradas; no afirma ser una exportación completa de todos los datos en nube o del dispositivo. Para ejercer derechos ARCO escribe a privacidad@thebackyard.com.mx.",
  };
}
