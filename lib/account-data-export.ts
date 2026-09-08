import { ACCOUNT_STORAGE_KEYS, type BackyardProfile } from "./account-state";
import { STORAGE_KEYS } from "./round-utils";
import { GUEST_LEGAL_ACTOR_KEY, legalEvidenceStateKey, type LegalEnvironment } from "./legal-choice-state";

const EXPORT_STORAGE_KEYS = [
  STORAGE_KEYS.history,
  STORAGE_KEYS.draft,
  STORAGE_KEYS.frequentPlayers,
  STORAGE_KEYS.frequentGroups,
  STORAGE_KEYS.rivals,
  STORAGE_KEYS.courses,
  STORAGE_KEYS.contrast,
] as const;

function parseStoredValue(raw: string | null) {
  if (raw === null) return null;
  try { return JSON.parse(raw) as unknown; }
  catch { return raw; }
}

/** Export only the user's known Backyard records. Auth/session tokens and
 * unrelated browser storage are intentionally excluded. */
export function buildLocalAccountExport(
  storage: Pick<Storage, "getItem">,
  identity: Pick<BackyardProfile, "userId" | "displayName" | "email" | "defaultHandicap"> & { mode: "guest" | "authenticated" },
  generatedAt = new Date().toISOString(),
) {
  const records = Object.fromEntries(EXPORT_STORAGE_KEYS.map((key) => [key, parseStoredValue(storage.getItem(key))]));
  const acceptances = (() => {
    const value = parseStoredValue(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && (item as { userId?: unknown }).userId === identity.userId) : [];
  })();
  const actorKey = identity.mode === "authenticated"
    ? `account:${identity.userId}`
    : storage.getItem(GUEST_LEGAL_ACTOR_KEY);
  const legalEvidence = actorKey ? Object.fromEntries(
    (["production", "preview", "development", "test"] as LegalEnvironment[]).map((environment) => [
      environment,
      parseStoredValue(storage.getItem(legalEvidenceStateKey(actorKey, environment))),
    ]),
  ) : {};
  return {
    exportVersion: 1,
    generatedAt,
    context: identity.mode === "authenticated" ? "authenticated_local_copy" : "guest_local",
    profile: {
      displayName: identity.displayName,
      email: identity.mode === "authenticated" ? identity.email : "",
      defaultHandicap: identity.defaultHandicap,
    },
    records,
    legacyLegalRecords: acceptances,
    legalEvidence,
    note: "Las fotografías almacenadas como archivos binarios y los datos que sólo existan en la nube no forman parte de esta copia local.",
  };
}
