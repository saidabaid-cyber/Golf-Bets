export type DistanceUnit = "yards" | "meters";

export type AccountUiPreferences = {
  version: 1;
  distanceUnit: DistanceUnit;
  push: boolean;
  email: boolean;
  rounds: boolean;
  reminders: boolean;
};

export const DEFAULT_ACCOUNT_UI_PREFERENCES: AccountUiPreferences = {
  version: 1,
  distanceUnit: "yards",
  push: false,
  email: false,
  rounds: false,
  reminders: false,
};

export function accountUiPreferencesKey(userId: string) {
  return `the-backyard:ui-preferences:v1:${encodeURIComponent(userId || "guest")}`;
}

export function normalizeAccountUiPreferences(value: unknown): AccountUiPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_ACCOUNT_UI_PREFERENCES };
  const candidate = value as Partial<AccountUiPreferences>;
  return {
    version: 1,
    distanceUnit: candidate.distanceUnit === "meters" ? "meters" : "yards",
    push: candidate.push === true,
    email: candidate.email === true,
    rounds: candidate.rounds === true,
    reminders: candidate.reminders === true,
  };
}

export function readAccountUiPreferences(storage: Pick<Storage, "getItem">, userId: string) {
  try { return normalizeAccountUiPreferences(JSON.parse(storage.getItem(accountUiPreferencesKey(userId)) || "null")); }
  catch { return { ...DEFAULT_ACCOUNT_UI_PREFERENCES }; }
}

export function writeAccountUiPreferences(storage: Pick<Storage, "setItem">, userId: string, preferences: AccountUiPreferences) {
  const normalized = normalizeAccountUiPreferences(preferences);
  storage.setItem(accountUiPreferencesKey(userId), JSON.stringify(normalized));
  return normalized;
}

/** Stored golf distances remain yards. This helper converts only the rendered value. */
export function displayDistanceFromStoredYards(yards: number, unit: DistanceUnit) {
  if (!Number.isFinite(yards)) return "—";
  return unit === "meters"
    ? `${Math.round(yards * 0.9144).toLocaleString("es-MX")} m`
    : `${Math.round(yards).toLocaleString("es-MX")} yd`;
}
