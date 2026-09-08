import { LEGAL_DOCUMENT_VERSIONS } from "./legal-config";
import { PRIVACY_CONTENT_ID } from "./privacy-content";
import { normalizePlanId, type PlanId } from "./plans";

export type AccountMode = "undecided" | "guest" | "authenticated";
export const BETTING_DATA_CONSENT_TYPE = "betting_financial" as const;
export const BETTING_DATA_CONSENT_VERSION = `${PRIVACY_CONTENT_ID}:express-betting-data`;

export type GeneralConsentType = keyof typeof LEGAL_DOCUMENT_VERSIONS;
export type ConsentType = GeneralConsentType | typeof BETTING_DATA_CONSENT_TYPE;
export type ConsentPersistenceStatus = "persisted";
export type ConsentSyncStatus = "local_only" | "pending" | "synced";

export type LegalAcceptance = {
  userId: string;
  type: ConsentType;
  documentVersion: string;
  acceptedAt: string;
  locale: string;
  persistenceStatus?: ConsentPersistenceStatus;
  syncStatus?: ConsentSyncStatus;
};

export type BackyardProfile = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  defaultHandicap: number | null;
} & Partial<BackyardProfileDetails>;

export const DRIVER_SWING_SPEED_BANDS = ["UNDER_85", "FROM_85_TO_95", "FROM_95_TO_105", "OVER_105"] as const;
export type DriverSwingSpeedBand = (typeof DRIVER_SWING_SPEED_BANDS)[number] | "";

export const USUAL_TRAJECTORIES = ["LOW", "MID", "HIGH"] as const;
export type UsualTrajectory = (typeof USUAL_TRAJECTORIES)[number] | "";

export const SHOT_TENDENCIES = ["DRAW", "FADE", "HOOK", "SLICE", "STRAIGHT", "VARIABLE"] as const;
export type ShotTendency = (typeof SHOT_TENDENCIES)[number] | "";

export const GREEN_SPEEDS = ["SLOW", "MID", "FAST", "VARIABLE"] as const;
export type GreenSpeed = (typeof GREEN_SPEEDS)[number] | "";

export const GAME_PRIORITIES = ["DISTANCE", "CONTROL", "ACCURACY", "FEEL", "SHORT_GAME"] as const;
export type GamePriority = (typeof GAME_PRIORITIES)[number] | "";

export const PRICE_IMPORTANCE_LEVELS = ["LOW", "MID", "HIGH"] as const;
export type PriceImportance = (typeof PRICE_IMPORTANCE_LEVELS)[number] | "";

export const GOLF_IMPROVEMENT_GOALS = [
  "DRIVER",
  "IRONS",
  "APPROACH",
  "SHORT_GAME",
  "BUNKER",
  "PUTTING",
  "CONSISTENCY",
  "COURSE_STRATEGY",
  "MENTAL_CONFIDENCE",
  "LOWER_HANDICAP",
] as const;
export type GolfImprovementGoal = (typeof GOLF_IMPROVEMENT_GOALS)[number];

export const GOLF_PRIMARY_GOALS = [
  "LOWER_HANDICAP",
  "MORE_CONSISTENT",
  "SPECIFIC_AREA",
  "ENJOY_MORE",
  "COMPETE_TOURNAMENTS",
] as const;
export type GolfPrimaryGoal = (typeof GOLF_PRIMARY_GOALS)[number] | "";

export const GHIN_LINK_STATUSES = ["NOT_CONNECTED", "SKIPPED", "COMING_SOON"] as const;
export type GhinLinkStatus = (typeof GHIN_LINK_STATUSES)[number];

export type BackyardProfileDetails = {
  givenName: string;
  familyName: string;
  username: string;
  city: string;
  state: string;
  country: string;
  homeClub: string;
  preferredTee: string;
  handedness: "right" | "left" | "ambidextrous" | "";
  typicalScore: number | null;
  driverDistanceYards: number | null;
  driverSwingSpeedBand: DriverSwingSpeedBand;
  usualTrajectory: UsualTrajectory;
  shotTendency: ShotTendency;
  greenSpeed: GreenSpeed;
  gamePriority: GamePriority;
  priceImportance: PriceImportance;
  improvementGoals: GolfImprovementGoal[];
  primaryGoal: GolfPrimaryGoal;
  targetHandicap: number | null;
  planId: PlanId;
  ghinLinkStatus: GhinLinkStatus;
  golfProfileUpdatedAt: string | null;
  bio: string;
  profileVisibility: "private" | "friends";
};

export type BackyardProfileUpdate = Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">
  & Partial<BackyardProfileDetails>;

const EMPTY_PROFILE_DETAILS: BackyardProfileDetails = {
  givenName: "",
  familyName: "",
  username: "",
  city: "",
  state: "",
  country: "",
  homeClub: "",
  preferredTee: "",
  handedness: "",
  typicalScore: null,
  driverDistanceYards: null,
  driverSwingSpeedBand: "",
  usualTrajectory: "",
  shotTendency: "",
  greenSpeed: "",
  gamePriority: "",
  priceImportance: "",
  improvementGoals: [],
  primaryGoal: "",
  targetHandicap: null,
  planId: "free",
  ghinLinkStatus: "NOT_CONNECTED",
  golfProfileUpdatedAt: null,
  bio: "",
  profileVisibility: "private",
};

export function emptyBackyardProfileDetails() {
  return { ...EMPTY_PROFILE_DETAILS };
}

function profileText(value: unknown, fallback = "", maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function optionalProfileNumber(value: unknown, fallback: number | null | undefined, minimum: number, maximum: number) {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback ?? null;
}

function profileChoice<const T extends readonly string[]>(value: unknown, choices: T, fallback: T[number] | "" | undefined) {
  if (value === "") return "";
  return typeof value === "string" && (choices as readonly string[]).includes(value)
    ? value as T[number]
    : fallback ?? "";
}

function profileTimestamp(value: unknown, fallback: string | null | undefined) {
  if (value === null) return null;
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback ?? null;
}

function profileImprovementGoals(value: unknown, fallback: GolfImprovementGoal[] | undefined) {
  if (!Array.isArray(value)) return [...(fallback || [])];
  return [...new Set(value.filter((item): item is GolfImprovementGoal => (
    typeof item === "string" && (GOLF_IMPROVEMENT_GOALS as readonly string[]).includes(item)
  )))];
}

function profileDetails(candidate: Partial<BackyardProfile>, fallback?: BackyardProfile) {
  return {
    givenName: profileText(candidate.givenName, fallback?.givenName, 80),
    familyName: profileText(candidate.familyName, fallback?.familyName, 100),
    username: profileText(candidate.username, fallback?.username, 40).replace(/^@+/, ""),
    city: profileText(candidate.city, fallback?.city, 100),
    state: profileText(candidate.state, fallback?.state, 100),
    country: profileText(candidate.country, fallback?.country, 100),
    homeClub: profileText(candidate.homeClub, fallback?.homeClub, 120),
    preferredTee: profileText(candidate.preferredTee, fallback?.preferredTee, 80),
    handedness: candidate.handedness === ""
      ? ""
      : candidate.handedness === "right" || candidate.handedness === "left" || candidate.handedness === "ambidextrous"
        ? candidate.handedness
        : fallback?.handedness || "",
    typicalScore: optionalProfileNumber(candidate.typicalScore, fallback?.typicalScore, 40, 200),
    driverDistanceYards: optionalProfileNumber(candidate.driverDistanceYards, fallback?.driverDistanceYards, 50, 500),
    driverSwingSpeedBand: profileChoice(candidate.driverSwingSpeedBand, DRIVER_SWING_SPEED_BANDS, fallback?.driverSwingSpeedBand),
    usualTrajectory: profileChoice(candidate.usualTrajectory, USUAL_TRAJECTORIES, fallback?.usualTrajectory),
    shotTendency: profileChoice(candidate.shotTendency, SHOT_TENDENCIES, fallback?.shotTendency),
    greenSpeed: profileChoice(candidate.greenSpeed, GREEN_SPEEDS, fallback?.greenSpeed),
    gamePriority: profileChoice(candidate.gamePriority, GAME_PRIORITIES, fallback?.gamePriority),
    priceImportance: profileChoice(candidate.priceImportance, PRICE_IMPORTANCE_LEVELS, fallback?.priceImportance),
    improvementGoals: profileImprovementGoals(candidate.improvementGoals, fallback?.improvementGoals),
    primaryGoal: profileChoice(candidate.primaryGoal, GOLF_PRIMARY_GOALS, fallback?.primaryGoal),
    targetHandicap: optionalProfileNumber(candidate.targetHandicap, fallback?.targetHandicap, -15, 54),
    planId: normalizePlanId(candidate.planId ?? fallback?.planId),
    ghinLinkStatus: candidate.ghinLinkStatus === "NOT_CONNECTED" || candidate.ghinLinkStatus === "SKIPPED" || candidate.ghinLinkStatus === "COMING_SOON"
      ? candidate.ghinLinkStatus
      : fallback?.ghinLinkStatus || "NOT_CONNECTED",
    golfProfileUpdatedAt: profileTimestamp(candidate.golfProfileUpdatedAt, fallback?.golfProfileUpdatedAt),
    bio: profileText(candidate.bio, fallback?.bio, 280),
    profileVisibility: candidate.profileVisibility === "friends" || candidate.profileVisibility === "private"
      ? candidate.profileVisibility
      : fallback?.profileVisibility || "private",
  } satisfies typeof EMPTY_PROFILE_DETAILS;
}

/** Guest is a storage context, never an account identity. Legacy guest
 * preferences may keep an HCP default, but names/emails/avatars are ignored. */
export function guestBackyardProfile(value: unknown = null): BackyardProfile {
  const candidate = value && typeof value === "object" ? value as Partial<BackyardProfile> : {};
  return {
    userId: "guest",
    displayName: "",
    email: "",
    avatarUrl: "",
    defaultHandicap: typeof candidate.defaultHandicap === "number" && Number.isFinite(candidate.defaultHandicap) ? candidate.defaultHandicap : null,
    ...EMPTY_PROFILE_DETAILS,
  };
}

export function normalizeBackyardProfileCache(value: unknown, fallback: BackyardProfile): BackyardProfile {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<BackyardProfile>;
  return {
    userId: fallback.userId,
    email: fallback.email,
    displayName: typeof candidate.displayName === "string" && candidate.displayName.trim() ? candidate.displayName.trim() : fallback.displayName,
    avatarUrl: typeof candidate.avatarUrl === "string" ? candidate.avatarUrl : fallback.avatarUrl,
    defaultHandicap: candidate.defaultHandicap === null || (typeof candidate.defaultHandicap === "number" && Number.isFinite(candidate.defaultHandicap)) ? candidate.defaultHandicap : fallback.defaultHandicap,
    ...profileDetails(candidate, fallback),
  };
}

export function mergeBackyardProfile<T extends BackyardProfile>(current: T, patch: BackyardProfileUpdate): T {
  return {
    ...current,
    ...patch,
    displayName: patch.displayName.trim(),
    avatarUrl: patch.avatarUrl.trim(),
    ...profileDetails(patch, current),
  };
}

export type ProfileDraftValidation =
  | { ok: true; displayName: string; defaultHandicap: number | null }
  | { ok: false; message: string };

/** Profile handicap is an Index, not a round Playing Handicap. Internally a
 * plus Index is negative, while the user-facing golf notation remains +1.2. */
export function profileHandicapInput(value: number | null) {
  if (value === null) return "";
  return value < 0 ? `+${Math.abs(value)}` : String(value);
}

export function profileHandicapLabel(value: number | null) {
  return value === null ? "Sin capturar" : profileHandicapInput(value);
}

export function validateProfileDraft(name: string, handicapInput: string): ProfileDraftValidation {
  const displayName = name.trim();
  if (!displayName) return { ok: false, message: "Escribe tu nombre para continuar." };
  const normalized = handicapInput.trim().replace(",", ".");
  if (!normalized) return { ok: true, displayName, defaultHandicap: null };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { ok: false, message: "Escribe un HCP Index válido entre +15.0 y 54.0." };
  }
  const numeric = Number(normalized);
  const defaultHandicap = normalized.startsWith("+") ? -Math.abs(numeric) : numeric;
  if (!Number.isFinite(defaultHandicap) || defaultHandicap < -15 || defaultHandicap > 54) {
    return { ok: false, message: "Escribe un HCP Index válido entre +15.0 y 54.0." };
  }
  return { ok: true, displayName, defaultHandicap };
}

export type ProfileAvatarValidation =
  | { ok: true; avatarUrl: string }
  | { ok: false; message: string };

/** Remote profile images must be transport-secure and must not carry embedded
 * credentials. An empty string is intentional: it removes a previously saved
 * avatar without allowing an OAuth fallback to revive it on the next sync. */
export function validateProfileAvatarUrl(input: string): ProfileAvatarValidation {
  const avatarUrl = input.trim();
  if (!avatarUrl) return { ok: true, avatarUrl: "" };
  const message = "Usa una URL HTTPS válida o deja el campo vacío.";
  if (avatarUrl.length > 2048) return { ok: false, message };
  try {
    const parsed = new URL(avatarUrl);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      return { ok: false, message };
    }
    return { ok: true, avatarUrl };
  } catch {
    return { ok: false, message };
  }
}

export const ACCOUNT_STORAGE_KEYS = {
  mode: "backyard-account-mode-v1",
  acceptances: "backyard-legal-acceptances-v1",
  guestProfile: "backyard-guest-profile-v1",
  migrationDecision: "backyard-local-migration-decision-v1",
} as const;

export const ACCOUNT_DELETION_MARKER_PREFIX = "backyard-account-deletion-v1:";

type OfflineProfileStorage = Pick<Storage, "getItem">;

/** Restore only non-sensitive display data for an already selected local
 * workspace. This is not an authenticated session and never contains a JWT. */
export function readOfflineAuthenticatedProfile(storage: OfflineProfileStorage, userId: string): BackyardProfile | null {
  if (!userId || userId === "guest" || storage.getItem(ACCOUNT_STORAGE_KEYS.mode) !== "authenticated") return null;
  try {
    const cached = JSON.parse(storage.getItem(`backyard-profile-cache-v1:${userId}`) || "null");
    if (!cached || typeof cached !== "object") return null;
    const displayName = typeof cached.displayName === "string" && cached.displayName.trim() ? cached.displayName.trim() : "Jugador";
    return {
      userId,
      displayName,
      email: typeof cached.email === "string" ? cached.email : "",
      avatarUrl: typeof cached.avatarUrl === "string" ? cached.avatarUrl : "",
      defaultHandicap: cached.defaultHandicap === null || (typeof cached.defaultHandicap === "number" && Number.isFinite(cached.defaultHandicap)) ? cached.defaultHandicap : null,
      ...profileDetails(cached),
    };
  } catch { return null; }
}

export function migrationDecisionStorageKey(userId: string) {
  return `${ACCOUNT_STORAGE_KEYS.migrationDecision}:${userId}`;
}

/** Records that this identity already saw the one-time access update. It is
 * presentation state only; it never counts as consent. */
export function bettingConsentPromptStorageKey(userId: string) {
  return `backyard-betting-consent-prompt-v1:${userId}:${BETTING_DATA_CONSENT_VERSION}`;
}

/** Synchronous local barrier checked by every cloud/media sync before deletion. */
export function accountDeletionMarkerKey(userId: string) {
  return `${ACCOUNT_DELETION_MARKER_PREFIX}${userId}`;
}

export const REQUIRED_CONSENTS = Object.keys(LEGAL_DOCUMENT_VERSIONS) as GeneralConsentType[];
export const KNOWN_CONSENT_TYPES: ConsentType[] = [...REQUIRED_CONSENTS, BETTING_DATA_CONSENT_TYPE];

export function buildLegalAcceptances(userId: string, acceptedAt: string, locale = "es-MX"): LegalAcceptance[] {
  return REQUIRED_CONSENTS.map((type) => ({
    userId,
    type,
    documentVersion: LEGAL_DOCUMENT_VERSIONS[type],
    acceptedAt,
    locale,
  }));
}

export function buildBettingDataAcceptance(
  userId: string,
  acceptedAt: string,
  syncStatus: ConsentSyncStatus,
  locale = "es-MX",
): LegalAcceptance {
  return {
    userId,
    type: BETTING_DATA_CONSENT_TYPE,
    documentVersion: BETTING_DATA_CONSENT_VERSION,
    acceptedAt,
    locale,
    persistenceStatus: "persisted",
    syncStatus,
  };
}

export function parseLegalAcceptances(raw: string | null): LegalAcceptance[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is LegalAcceptance => Boolean(
        item && typeof item.userId === "string" && KNOWN_CONSENT_TYPES.includes(item.type)
          && typeof item.documentVersion === "string" && typeof item.acceptedAt === "string",
      ))
      : [];
  } catch {
    return [];
  }
}

export function hasCurrentLegalConsent(acceptances: LegalAcceptance[], userId: string) {
  return REQUIRED_CONSENTS.every((type) => acceptances.some((acceptance) => (
    acceptance.userId === userId
    && acceptance.type === type
    && acceptance.documentVersion === LEGAL_DOCUMENT_VERSIONS[type]
  )));
}

export function hasCurrentBettingDataConsent(acceptances: LegalAcceptance[], userId: string) {
  return acceptances.some((acceptance) => (
    acceptance.userId === userId
    && acceptance.type === BETTING_DATA_CONSENT_TYPE
    && acceptance.documentVersion === BETTING_DATA_CONSENT_VERSION
    && acceptance.persistenceStatus === "persisted"
  ));
}

export function markLegalAcceptancesSynced(current: LegalAcceptance[], synced: LegalAcceptance[]) {
  const keys = new Set(synced.map((item) => `${item.userId}:${item.type}:${item.documentVersion}`));
  let changed = false;
  const next = current.map((item) => {
    if (!keys.has(`${item.userId}:${item.type}:${item.documentVersion}`)) return item;
    if (item.persistenceStatus === "persisted" && item.syncStatus === "synced") return item;
    changed = true;
    return { ...item, persistenceStatus: item.persistenceStatus || "persisted", syncStatus: "synced" } as LegalAcceptance;
  });
  return changed ? next : current;
}

export function mergeLegalAcceptances(current: LegalAcceptance[], next: LegalAcceptance[]) {
  const replacements = new Set(next.map((item) => `${item.userId}:${item.type}:${item.documentVersion}`));
  return [...current.filter((item) => !replacements.has(`${item.userId}:${item.type}:${item.documentVersion}`)), ...next];
}

/** A guest entry is a new local legal ceremony. Authenticated acceptances are
 * intentionally untouched and no golf data is removed. */
export function clearLegalAcceptancesForUser(current: LegalAcceptance[], userId: string) {
  return current.filter((item) => item.userId !== userId);
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function normalizeOtp(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function authErrorMessage(error: unknown, context: "google" | "apple" | "email" | "otp" | "logout" = "email") {
  const detail = error && typeof error === "object" ? error as { message?: string; code?: string; status?: number } : null;
  const message = `${detail?.code || ""} ${detail?.message || String(error || "")}`.toLowerCase();
  if (message.includes("account_session_missing")) return "No se pudo confirmar tu sesión. No has iniciado sesión; vuelve a verificar el código o solicita uno nuevo.";
  if (detail?.status === 429) return "Demasiados intentos. Espera un momento antes de solicitar otro código.";
  if (message.includes("provider") && (message.includes("disabled") || message.includes("not enabled") || message.includes("unsupported"))) return `Acceso con ${context === "google" ? "Google" : context === "apple" ? "Apple" : "correo"} pendiente de configuración.`;
  if (message.includes("rate") || message.includes("too many")) return "Demasiados intentos. Espera un momento antes de intentarlo nuevamente.";
  if (message.includes("expired")) return "El código expiró. Solicita uno nuevo.";
  if (message.includes("invalid") || message.includes("token")) return context === "otp" ? "El código no es correcto. Revísalo o solicita uno nuevo." : "Revisa la información e intenta nuevamente.";
  if (message.includes("abort") || message.includes("timeout")) return "La conexión tardó demasiado. Revisa tu correo antes de reenviar el código o inténtalo nuevamente.";
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) return "No hay conexión. Intenta nuevamente.";
  if (context === "google") return "No pudimos iniciar sesión con Google.";
  if (context === "apple") return "No pudimos iniciar sesión con Apple.";
  if (context === "otp") return "No pudimos verificar el código.";
  if (context === "logout") return "No pudimos cerrar la sesión. Intenta nuevamente.";
  return "No pudimos enviar el código. Intenta nuevamente.";
}

export function hasLocalGolfData(storage: Pick<Storage, "getItem">) {
  const keys = [
    "golfbets-history",
    "golfbets-draft-v1",
    "golfbets-frequent-players-v1",
    "golfbets-frequent-groups-v1",
    "golfbets-personal-rivals",
    "golfbets-courses",
    "golfbets-high-contrast-v1",
  ];
  return keys.some((key) => {
    const value = storage.getItem(key);
    return Boolean(value && value !== "[]" && value !== "{}" && value !== "null");
  });
}
