/**
 * Local-first contracts for Backyard AI.
 *
 * These records intentionally separate private operational data from the
 * de-identified learning dataset. Nothing in this module authorizes model
 * training or bypasses the deterministic round engine.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ConfidenceSource =
  | "USER_CONFIRMED"
  | "PERSONAL_MEMORY"
  | "GROUP_MEMORY"
  | "ROUND_HISTORY"
  | "CATALOG"
  | "OCR"
  | "VISION"
  | "LLM"
  | "DETERMINISTIC";

export type ConfidenceValue<T> = {
  value: T;
  confidence: number;
  source: ConfidenceSource;
};

export type PersonalDataScope = "PERSONAL";
export type LearningDataScope = "GLOBAL_DEIDENTIFIED";
export type TrainingUse = "EXCLUDED" | "ELIGIBLE" | "EXPORTED";

export type AIInteraction = {
  recordType: "AI_INTERACTION";
  schemaVersion: 1;
  id: string;
  ownerId: string;
  groupId?: string;
  roundId?: string;
  kind: "ROUND_SETUP" | "SCORECARD" | "ROUND_RECAP" | "RULES" | "OTHER";
  channel: "TEXT" | "VOICE" | "PHOTO" | "SYSTEM";
  locale: string;
  status: "STARTED" | "NEEDS_INPUT" | "VALIDATED" | "COMPLETED" | "FAILED" | "CANCELLED";
  /** Private, redacted display copy. Full media belongs in private storage. */
  redactedInput?: string;
  inputReference?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  actionSchemaVersion: string;
  questionCount: number;
  latencyMs?: number;
  confidence?: number;
  failureCode?: string;
  startedAt: string;
  completedAt?: string;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

export type AIActionEvidence = {
  source: ConfidenceSource;
  confidence: number;
  /** Opaque local reference; never required in a global learning event. */
  reference?: string;
};

export type AIAction = {
  recordType: "AI_ACTION";
  schemaVersion: 1;
  id: string;
  ownerId: string;
  interactionId: string;
  actionType: string;
  /** JSON Pointer-like path, for example `/bets/skins/value`. */
  targetPath: string;
  proposedPayload: JsonValue;
  validatedPayload?: JsonValue;
  confidence: number;
  evidence: AIActionEvidence[];
  validationStatus: "PROPOSED" | "VALID" | "INVALID" | "REJECTED" | "EXECUTED";
  validationErrors?: string[];
  idempotencyKey?: string;
  deterministicEngineVersion?: string;
  createdAt: string;
  executedAt?: string;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

export type AICorrection = {
  recordType: "AI_CORRECTION";
  schemaVersion: 1;
  id: string;
  ownerId: string;
  interactionId: string;
  actionId?: string;
  correctionType: "SETUP" | "SCORECARD" | "MATCH" | "OTHER";
  fieldPath: string;
  proposedValue: JsonValue;
  correctedValue: JsonValue;
  source: "USER" | "VALIDATOR" | "DETERMINISTIC_ENGINE";
  verified: boolean;
  createdAt: string;
  verifiedAt?: string;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

export type LearningEventType =
  | "SETUP_ACCEPTED"
  | "SETUP_CORRECTED"
  | "SCORECARD_ACCEPTED"
  | "SCORECARD_CORRECTED"
  | "MATCH_CORRECTED"
  | "PREFERENCE_CONFIRMED"
  | "PREFERENCE_REVOKED"
  | "AI_FAILURE";

type LearningEventBase = {
  recordType: "LEARNING_EVENT";
  schemaVersion: 1;
  id: string;
  eventType: LearningEventType;
  locale?: string;
  region?: string;
  payload: JsonObject;
  verified: boolean;
  occurredAt: string;
};

export type PersonalLearningEvent = LearningEventBase & {
  ownerId: string;
  groupId?: string;
  interactionId?: string;
  correctionId?: string;
  dataScope: PersonalDataScope;
  deidentified: false;
  trainingUse: "EXCLUDED";
};

export type GlobalLearningEvent = LearningEventBase & {
  dataScope: LearningDataScope;
  deidentified: true;
  trainingUse: "ELIGIBLE" | "EXPORTED";
  consentPolicyVersion: string;
  deidentifiedAt: string;
  /** Optional non-reversible digest supplied by a trusted server process. */
  sourceDigest?: string;
  datasetVersion?: string;
};

export type LearningEvent = PersonalLearningEvent | GlobalLearningEvent;

export type ScorecardCorrection = {
  recordType: "SCORECARD_CORRECTION";
  schemaVersion: 1;
  id: string;
  ownerId: string;
  interactionId: string;
  roundId: string;
  /** Opaque round-player id. Player names are deliberately not stored here. */
  roundPlayerId: string;
  hole: number;
  extractedScore: number | null;
  correctedScore: number;
  confidence: number;
  source: "OCR" | "VISION" | "DIGITAL_SCORE" | "MANUAL";
  imageReference?: string;
  cellReference?: string;
  reason?: "LOW_CONFIDENCE" | "TOTAL_MISMATCH" | "DIGITAL_MISMATCH" | "OUT_OF_RANGE" | "OTHER";
  createdAt: string;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

export type PreferenceOrigin = "USER" | "CORRECTION" | "HISTORY" | "INFERRED";
export type PreferenceStatus = "CONFIRMED" | "INFERRED" | "REVOKED";

export type PreferenceContext = {
  region?: string;
  courseId?: string;
  gameKey?: string;
  ruleset?: string;
};

type PreferenceBase = {
  schemaVersion: 1;
  id: string;
  key: string;
  value: JsonValue;
  context?: PreferenceContext;
  origin: PreferenceOrigin;
  status: PreferenceStatus;
  confidence: number;
  sourceInteractionId?: string;
  sourceCorrectionId?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  lastUsedAt?: string;
  useCount: number;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

/** AI preference rows are distinct from the existing UI `user_preferences`. */
export type UserPreference = PreferenceBase & {
  recordType: "USER_PREFERENCE";
  ownerId: string;
};

/** Phase 1 is owner-scoped; a future shared group may add membership RLS. */
export type GroupPreference = PreferenceBase & {
  recordType: "GROUP_PREFERENCE";
  ownerId: string;
  groupId: string;
};

export type LearningConsent = {
  schemaVersion: 1;
  ownerId: string;
  personalMemoryEnabled: boolean;
  globalLearningEnabled: boolean;
  retainPrivateInputs: boolean;
  policyVersion: string;
  updatedAt: string;
  grantedAt?: string;
  revokedAt?: string;
};

export type LearningAuditRecord = {
  recordType: "LEARNING_AUDIT";
  schemaVersion: 1;
  id: string;
  ownerId: string;
  operation: "DEIDENTIFIED" | "EXPORT_REJECTED" | "DELETED" | "CONSENT_CHANGED";
  sourceRecordId?: string;
  outputRecordId?: string;
  policyVersion: string;
  removedFields: string[];
  occurredAt: string;
  dataScope: PersonalDataScope;
  trainingUse: "EXCLUDED";
};

export type PersonalLearningRecord =
  | AIInteraction
  | AIAction
  | AICorrection
  | PersonalLearningEvent
  | ScorecardCorrection
  | LearningAuditRecord;

export type PersonalMemoryRecord = UserPreference | GroupPreference | PersonalLearningRecord;

export function cleanMemoryId(value: unknown, maxLength = 240): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

export function boundedConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).every(([key, candidate]) => key.length <= 240 && isJsonValue(candidate));
}
