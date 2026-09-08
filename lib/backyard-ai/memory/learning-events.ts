import { GROUP_AI_PREFERENCES_NAMESPACE } from "./group-memory";
import { USER_AI_PREFERENCES_NAMESPACE } from "./personal-memory";
import {
  emptyMemoryDocument,
  memoryStorageKey,
  readMemoryDocument,
  removeMemoryDocument,
  writeMemoryDocument,
  type MemoryReadableStorage,
} from "./storage";
import {
  boundedConfidence,
  cleanMemoryId,
  isJsonValue,
  validIsoDate,
  type AIAction,
  type AICorrection,
  type AIInteraction,
  type GlobalLearningEvent,
  type JsonObject,
  type JsonValue,
  type LearningAuditRecord,
  type LearningConsent,
  type LearningEventType,
  type PersonalLearningEvent,
  type PersonalLearningRecord,
  type ScorecardCorrection,
} from "./types";

export const BACKYARD_AI_MEMORY_POLICY_VERSION = "ai-first-phase1-v1";

export const LEARNING_RECORDS_NAMESPACE = "learning-records";
export const LEARNING_CONSENT_NAMESPACE = "learning-consent";
export const MAX_LOCAL_LEARNING_RECORDS = 2_000;

const RECORD_TYPES = new Set([
  "AI_INTERACTION",
  "AI_ACTION",
  "AI_CORRECTION",
  "LEARNING_EVENT",
  "SCORECARD_CORRECTION",
  "LEARNING_AUDIT",
]);

const GLOBAL_PAYLOAD_KEYS = new Set([
  "actionType",
  "amount",
  "betKey",
  "cellCount",
  "confidence",
  "correctedScore",
  "correctedValue",
  "durationMs",
  "errorCode",
  "extractedScore",
  "fieldPath",
  "gameKey",
  "hole",
  "proposedValue",
  "questionCount",
  "reason",
  "roundHoles",
  "ruleset",
  "source",
  "startHole",
  "success",
]);

const SAFE_STRING_KEYS = new Set([
  "actionType",
  "betKey",
  "errorCode",
  "fieldPath",
  "gameKey",
  "reason",
  "ruleset",
  "source",
]);

const SENSITIVE_KEYS = new Set([
  "email",
  "groupid",
  "imagereference",
  "input",
  "inputreference",
  "name",
  "ownerid",
  "phone",
  "photoreference",
  "playerid",
  "playername",
  "prompt",
  "rawinput",
  "rawprompt",
  "roundid",
  "roundplayerid",
  "transcript",
  "userid",
]);

export function learningRecordsStorageKey(ownerId: string) {
  return memoryStorageKey(LEARNING_RECORDS_NAMESPACE, ownerId);
}

export function learningConsentStorageKey(ownerId: string) {
  return memoryStorageKey(LEARNING_CONSENT_NAMESPACE, ownerId);
}

export function defaultLearningConsent(
  ownerId: string,
  policyVersion: string,
  now = new Date().toISOString(),
): LearningConsent {
  return {
    schemaVersion: 1,
    ownerId: cleanMemoryId(ownerId) ?? "",
    personalMemoryEnabled: false,
    globalLearningEnabled: false,
    retainPrivateInputs: false,
    policyVersion: cleanMemoryId(policyVersion, 80) ?? "unversioned",
    updatedAt: validIsoDate(now) ? now : new Date(0).toISOString(),
  };
}

export function normalizeLearningConsent(value: unknown, ownerId: string): LearningConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const normalizedOwner = cleanMemoryId(ownerId);
  const storedOwner = cleanMemoryId(source.ownerId);
  const policyVersion = cleanMemoryId(source.policyVersion, 80);
  if (
    source.schemaVersion !== 1
    || !normalizedOwner
    || storedOwner !== normalizedOwner
    || typeof source.personalMemoryEnabled !== "boolean"
    || typeof source.globalLearningEnabled !== "boolean"
    || typeof source.retainPrivateInputs !== "boolean"
    || !policyVersion
    || !validIsoDate(source.updatedAt)
  ) return null;
  return {
    schemaVersion: 1,
    ownerId: normalizedOwner,
    personalMemoryEnabled: source.personalMemoryEnabled,
    globalLearningEnabled: source.globalLearningEnabled,
    retainPrivateInputs: source.retainPrivateInputs,
    policyVersion,
    updatedAt: source.updatedAt,
    ...(validIsoDate(source.grantedAt) ? { grantedAt: source.grantedAt } : {}),
    ...(validIsoDate(source.revokedAt) ? { revokedAt: source.revokedAt } : {}),
  };
}

export function readLearningConsent(
  storage: MemoryReadableStorage,
  ownerId: string,
  policyVersion: string,
  now = new Date().toISOString(),
): { ok: true; consent: LearningConsent; recoveredMalformed: boolean } | {
  ok: false;
  consent: LearningConsent;
  error: "identity_missing" | "storage_read_failed";
} {
  const fallback = defaultLearningConsent(ownerId, policyVersion, now);
  const key = learningConsentStorageKey(ownerId);
  if (!key) return { ok: false, consent: fallback, error: "identity_missing" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, consent: fallback, recoveredMalformed: false };
    try {
      const normalized = normalizeLearningConsent(JSON.parse(raw) as unknown, ownerId);
      return normalized && normalized.policyVersion === fallback.policyVersion
        ? { ok: true, consent: normalized, recoveredMalformed: false }
        : { ok: true, consent: fallback, recoveredMalformed: true };
    } catch {
      return { ok: true, consent: fallback, recoveredMalformed: true };
    }
  } catch {
    return { ok: false, consent: fallback, error: "storage_read_failed" };
  }
}

export function writeLearningConsent(
  storage: Pick<Storage, "setItem">,
  consentValue: LearningConsent,
): { ok: true; persisted: true; consent: LearningConsent } | {
  ok: false;
  persisted: false;
  consent: LearningConsent;
  error: "invalid_consent" | "identity_missing" | "storage_write_failed";
} {
  const consent = normalizeLearningConsent(consentValue, consentValue.ownerId);
  if (!consent) return { ok: false, persisted: false, consent: consentValue, error: "invalid_consent" };
  const key = learningConsentStorageKey(consent.ownerId);
  if (!key) return { ok: false, persisted: false, consent, error: "identity_missing" };
  try {
    storage.setItem(key, JSON.stringify(consent));
    return { ok: true, persisted: true, consent };
  } catch {
    return { ok: false, persisted: false, consent, error: "storage_write_failed" };
  }
}

export function createAIInteraction(input: {
  id: string;
  ownerId: string;
  groupId?: string;
  roundId?: string;
  kind: AIInteraction["kind"];
  channel: AIInteraction["channel"];
  locale: string;
  status: AIInteraction["status"];
  inputText?: string;
  identifiersToRedact?: readonly string[];
  inputReference?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  actionSchemaVersion: string;
  questionCount?: number;
  latencyMs?: number;
  confidence?: number;
  failureCode?: string;
  startedAt?: string;
  completedAt?: string;
}): AIInteraction | null {
  const id = cleanMemoryId(input.id);
  const ownerId = cleanMemoryId(input.ownerId);
  const locale = cleanMemoryId(input.locale, 32);
  const actionSchemaVersion = cleanMemoryId(input.actionSchemaVersion, 80);
  const startedAt = input.startedAt ?? new Date().toISOString();
  const confidence = input.confidence === undefined ? undefined : boundedConfidence(input.confidence);
  const questionCount = input.questionCount ?? 0;
  if (
    !id
    || !ownerId
    || !locale
    || !actionSchemaVersion
    || !validIsoDate(startedAt)
    || (input.completedAt !== undefined && !validIsoDate(input.completedAt))
    || !Number.isInteger(questionCount)
    || questionCount < 0
    || (input.latencyMs !== undefined && (!Number.isFinite(input.latencyMs) || input.latencyMs < 0))
    || confidence === null
  ) return null;
  return {
    recordType: "AI_INTERACTION",
    schemaVersion: 1,
    id,
    ownerId,
    ...(cleanMemoryId(input.groupId) ? { groupId: cleanMemoryId(input.groupId) as string } : {}),
    ...(cleanMemoryId(input.roundId) ? { roundId: cleanMemoryId(input.roundId) as string } : {}),
    kind: input.kind,
    channel: input.channel,
    locale,
    status: input.status,
    ...(input.inputText ? { redactedInput: redactSensitiveText(input.inputText, input.identifiersToRedact).slice(0, 2_000) } : {}),
    ...(cleanMemoryId(input.inputReference, 500) ? { inputReference: cleanMemoryId(input.inputReference, 500) as string } : {}),
    ...(cleanMemoryId(input.provider, 80) ? { provider: cleanMemoryId(input.provider, 80) as string } : {}),
    ...(cleanMemoryId(input.model, 120) ? { model: cleanMemoryId(input.model, 120) as string } : {}),
    ...(cleanMemoryId(input.promptVersion, 80) ? { promptVersion: cleanMemoryId(input.promptVersion, 80) as string } : {}),
    actionSchemaVersion,
    questionCount,
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(cleanMemoryId(input.failureCode, 120) ? { failureCode: cleanMemoryId(input.failureCode, 120) as string } : {}),
    startedAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
}

export function createAIAction(input: {
  id: string;
  ownerId: string;
  interactionId: string;
  actionType: string;
  targetPath: string;
  proposedPayload: JsonValue;
  validatedPayload?: JsonValue;
  confidence: number;
  evidence?: AIAction["evidence"];
  validationStatus?: AIAction["validationStatus"];
  validationErrors?: string[];
  idempotencyKey?: string;
  deterministicEngineVersion?: string;
  createdAt?: string;
  executedAt?: string;
}): AIAction | null {
  const id = cleanMemoryId(input.id);
  const ownerId = cleanMemoryId(input.ownerId);
  const interactionId = cleanMemoryId(input.interactionId);
  const actionType = cleanMemoryId(input.actionType, 120);
  const targetPath = cleanMemoryId(input.targetPath, 500);
  const confidence = boundedConfidence(input.confidence);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const evidence = input.evidence ?? [];
  if (
    !id
    || !ownerId
    || !interactionId
    || !actionType
    || !targetPath?.startsWith("/")
    || !isJsonValue(input.proposedPayload)
    || (input.validatedPayload !== undefined && !isJsonValue(input.validatedPayload))
    || confidence === null
    || !validIsoDate(createdAt)
    || (input.executedAt !== undefined && !validIsoDate(input.executedAt))
    || evidence.some((candidate) => boundedConfidence(candidate.confidence) === null)
  ) return null;
  return {
    recordType: "AI_ACTION",
    schemaVersion: 1,
    id,
    ownerId,
    interactionId,
    actionType,
    targetPath,
    proposedPayload: input.proposedPayload,
    ...(input.validatedPayload !== undefined ? { validatedPayload: input.validatedPayload } : {}),
    confidence,
    evidence: evidence.map((candidate) => ({
      source: candidate.source,
      confidence: candidate.confidence,
      ...(cleanMemoryId(candidate.reference, 500) ? { reference: cleanMemoryId(candidate.reference, 500) as string } : {}),
    })),
    validationStatus: input.validationStatus ?? "PROPOSED",
    ...(input.validationErrors?.length ? { validationErrors: input.validationErrors.map((candidate) => candidate.slice(0, 240)).slice(0, 20) } : {}),
    ...(cleanMemoryId(input.idempotencyKey, 240) ? { idempotencyKey: cleanMemoryId(input.idempotencyKey, 240) as string } : {}),
    ...(cleanMemoryId(input.deterministicEngineVersion, 80) ? { deterministicEngineVersion: cleanMemoryId(input.deterministicEngineVersion, 80) as string } : {}),
    createdAt,
    ...(input.executedAt ? { executedAt: input.executedAt } : {}),
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
}

export function createAICorrection(input: {
  id: string;
  ownerId: string;
  interactionId: string;
  actionId?: string;
  correctionType: AICorrection["correctionType"];
  fieldPath: string;
  proposedValue: JsonValue;
  correctedValue: JsonValue;
  source: AICorrection["source"];
  verified?: boolean;
  createdAt?: string;
  verifiedAt?: string;
}): AICorrection | null {
  const id = cleanMemoryId(input.id);
  const ownerId = cleanMemoryId(input.ownerId);
  const interactionId = cleanMemoryId(input.interactionId);
  const fieldPath = cleanMemoryId(input.fieldPath, 500);
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (
    !id
    || !ownerId
    || !interactionId
    || !fieldPath?.startsWith("/")
    || !isJsonValue(input.proposedValue)
    || !isJsonValue(input.correctedValue)
    || !validIsoDate(createdAt)
    || (input.verifiedAt !== undefined && !validIsoDate(input.verifiedAt))
  ) return null;
  return {
    recordType: "AI_CORRECTION",
    schemaVersion: 1,
    id,
    ownerId,
    interactionId,
    ...(cleanMemoryId(input.actionId) ? { actionId: cleanMemoryId(input.actionId) as string } : {}),
    correctionType: input.correctionType,
    fieldPath,
    proposedValue: input.proposedValue,
    correctedValue: input.correctedValue,
    source: input.source,
    verified: input.verified === true,
    createdAt,
    ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
}

export function createPersonalLearningEvent(input: {
  id: string;
  ownerId: string;
  eventType: LearningEventType;
  payload: JsonObject;
  verified?: boolean;
  occurredAt?: string;
  groupId?: string;
  interactionId?: string;
  correctionId?: string;
  locale?: string;
  region?: string;
}): PersonalLearningEvent | null {
  const id = cleanMemoryId(input.id);
  const ownerId = cleanMemoryId(input.ownerId);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (!id || !ownerId || !isJsonValue(input.payload) || !validIsoDate(occurredAt)) return null;
  return {
    recordType: "LEARNING_EVENT",
    schemaVersion: 1,
    id,
    ownerId,
    eventType: input.eventType,
    payload: input.payload,
    verified: input.verified === true,
    occurredAt,
    ...(cleanMemoryId(input.groupId) ? { groupId: cleanMemoryId(input.groupId) as string } : {}),
    ...(cleanMemoryId(input.interactionId) ? { interactionId: cleanMemoryId(input.interactionId) as string } : {}),
    ...(cleanMemoryId(input.correctionId) ? { correctionId: cleanMemoryId(input.correctionId) as string } : {}),
    ...(cleanMemoryId(input.locale, 32) ? { locale: cleanMemoryId(input.locale, 32) as string } : {}),
    ...(cleanMemoryId(input.region, 80) ? { region: cleanMemoryId(input.region, 80) as string } : {}),
    dataScope: "PERSONAL",
    deidentified: false,
    trainingUse: "EXCLUDED",
  };
}

export function createScorecardCorrection(input: Omit<ScorecardCorrection, "recordType" | "schemaVersion" | "dataScope" | "trainingUse">): ScorecardCorrection | null {
  const confidence = boundedConfidence(input.confidence);
  if (
    !cleanMemoryId(input.id)
    || !cleanMemoryId(input.ownerId)
    || !cleanMemoryId(input.interactionId)
    || !cleanMemoryId(input.roundId)
    || !cleanMemoryId(input.roundPlayerId)
    || !Number.isInteger(input.hole)
    || input.hole < 1
    || input.hole > 18
    || (input.extractedScore !== null && (!Number.isInteger(input.extractedScore) || input.extractedScore < 1 || input.extractedScore > 20))
    || !Number.isInteger(input.correctedScore)
    || input.correctedScore < 1
    || input.correctedScore > 20
    || confidence === null
    || !validIsoDate(input.createdAt)
  ) return null;
  return {
    ...input,
    id: cleanMemoryId(input.id) as string,
    ownerId: cleanMemoryId(input.ownerId) as string,
    interactionId: cleanMemoryId(input.interactionId) as string,
    roundId: cleanMemoryId(input.roundId) as string,
    roundPlayerId: cleanMemoryId(input.roundPlayerId) as string,
    confidence,
    recordType: "SCORECARD_CORRECTION",
    schemaVersion: 1,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
}

export function scorecardCorrectionLearningEvent(
  correction: ScorecardCorrection,
  eventId: string,
): PersonalLearningEvent | null {
  return createPersonalLearningEvent({
    id: eventId,
    ownerId: correction.ownerId,
    eventType: "SCORECARD_CORRECTED",
    verified: true,
    interactionId: correction.interactionId,
    correctionId: correction.id,
    occurredAt: correction.createdAt,
    payload: {
      hole: correction.hole,
      extractedScore: correction.extractedScore,
      correctedScore: correction.correctedScore,
      confidence: correction.confidence,
      source: correction.source,
      ...(correction.reason ? { reason: correction.reason } : {}),
    },
  });
}

export function normalizePersonalLearningRecord(value: unknown): PersonalLearningRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = cleanMemoryId(source.id);
  const ownerId = cleanMemoryId(source.ownerId);
  const recordType = String(source.recordType);
  let jsonCopy: JsonValue;
  try {
    jsonCopy = JSON.parse(JSON.stringify(source)) as JsonValue;
  } catch {
    return null;
  }
  if (
    source.schemaVersion !== 1
    || !id
    || !ownerId
    || !RECORD_TYPES.has(recordType)
    || source.dataScope !== "PERSONAL"
    || source.trainingUse !== "EXCLUDED"
    || !isJsonValue(jsonCopy)
  ) return null;
  const date = recordType === "AI_INTERACTION"
    ? source.startedAt
    : recordType === "AI_ACTION" || recordType === "AI_CORRECTION" || recordType === "SCORECARD_CORRECTION"
      ? source.createdAt
      : source.occurredAt;
  if (!validIsoDate(date)) return null;
  if (recordType === "LEARNING_EVENT" && (source.deidentified !== false || !isJsonValue(source.payload))) return null;
  return { ...(jsonCopy as Record<string, JsonValue>), id, ownerId } as PersonalLearningRecord;
}

export function readLearningRecords(storage: MemoryReadableStorage, ownerId: string, now?: string) {
  const result = readMemoryDocument(storage, LEARNING_RECORDS_NAMESPACE, ownerId, normalizePersonalLearningRecord, now);
  return {
    ...result,
    document: {
      ...result.document,
      items: result.document.items.filter((item) => item.ownerId === result.document.ownerId),
    },
  };
}

export function writeLearningRecords(
  storage: Pick<Storage, "setItem">,
  ownerId: string,
  records: readonly PersonalLearningRecord[],
  now?: string,
) {
  const owner = cleanMemoryId(ownerId) ?? "";
  const seenIds = new Set<string>();
  const normalized = records
    .map(normalizePersonalLearningRecord)
    .filter((record): record is PersonalLearningRecord => record !== null && record.ownerId === owner)
    .filter((record) => {
      if (seenIds.has(record.id)) return false;
      seenIds.add(record.id);
      return true;
    })
    .slice(0, MAX_LOCAL_LEARNING_RECORDS);
  return writeMemoryDocument(storage, LEARNING_RECORDS_NAMESPACE, owner, normalized, now);
}

export function appendLearningRecord(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerId: string,
  recordValue: PersonalLearningRecord,
  now = new Date().toISOString(),
) {
  const owner = cleanMemoryId(ownerId) ?? "";
  const record = normalizePersonalLearningRecord(recordValue);
  if (!record || record.ownerId !== owner) {
    return { ok: false as const, persisted: false as const, document: emptyMemoryDocument<PersonalLearningRecord>(owner, now), error: "invalid_record" as const };
  }
  const current = readLearningRecords(storage, owner, now);
  if (!current.ok) return { ok: false as const, persisted: false as const, document: current.document, error: current.error };
  const records = [record, ...current.document.items.filter((candidate) => candidate.id !== record.id)]
    .slice(0, MAX_LOCAL_LEARNING_RECORDS);
  return writeLearningRecords(storage, owner, records, now);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSensitiveText(value: string, identifiers: readonly string[] = []) {
  let output = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?52[\s.-]?)?(?:\d[\s.-]?){10}\b/g, "[REDACTED_PHONE]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]");
  for (const identifier of identifiers.map((item) => item.trim()).filter((item) => item.length >= 3)) {
    output = output.replace(new RegExp(escapeRegExp(identifier), "gi"), "[REDACTED]");
  }
  return output;
}

function sanitizeGlobalValue(
  value: JsonValue,
  key: string,
  path: string,
  identifiers: readonly string[],
  removedFields: string[],
): JsonValue | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!SAFE_STRING_KEYS.has(key)) {
      removedFields.push(path);
      return undefined;
    }
    const redacted = redactSensitiveText(value, identifiers);
    return redacted.includes("[REDACTED") ? "[REDACTED]" : redacted.slice(0, 160);
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item, index) => sanitizeGlobalValue(item, key, `${path}/${index}`, identifiers, removedFields))
      .filter((item): item is JsonValue => item !== undefined);
    return values;
  }
  const result: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const normalizedKey = childKey.toLocaleLowerCase("en-US");
    const childPath = `${path}/${childKey}`;
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      removedFields.push(childPath);
      continue;
    }
    const sanitized = sanitizeGlobalValue(childValue, childKey, childPath, identifiers, removedFields);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  return result;
}

function deidentifiedPayload(payload: JsonObject, identifiers: readonly string[]) {
  const result: JsonObject = {};
  const removedFields: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!GLOBAL_PAYLOAD_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLocaleLowerCase("en-US"))) {
      removedFields.push(`/${key}`);
      continue;
    }
    const sanitized = sanitizeGlobalValue(value, key, `/${key}`, identifiers, removedFields);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return { payload: result, removedFields: Array.from(new Set(removedFields)).sort() };
}

export type DeidentifyLearningResult =
  | { ok: true; event: GlobalLearningEvent; audit: LearningAuditRecord }
  | { ok: false; reason: "consent_missing" | "consent_revoked" | "not_verified" | "owner_mismatch" | "invalid_output_id" };

/**
 * Creates a separate global record through an allow-list. The private source is
 * unchanged and remains excluded from training. This function never exports or
 * uploads either record.
 */
export function deidentifyLearningEvent(
  event: PersonalLearningEvent,
  consent: LearningConsent,
  options: {
    outputId: string;
    auditId: string;
    identifiers?: readonly string[];
    sourceDigest?: string;
    now?: string;
  },
): DeidentifyLearningResult {
  if (event.ownerId !== consent.ownerId) return { ok: false, reason: "owner_mismatch" };
  if (!consent.globalLearningEnabled || !consent.grantedAt) return { ok: false, reason: "consent_missing" };
  if (consent.revokedAt) return { ok: false, reason: "consent_revoked" };
  if (!event.verified) return { ok: false, reason: "not_verified" };
  const outputId = cleanMemoryId(options.outputId);
  const auditId = cleanMemoryId(options.auditId);
  if (!outputId || !auditId) return { ok: false, reason: "invalid_output_id" };
  const now = options.now ?? new Date().toISOString();
  const sanitized = deidentifiedPayload(event.payload, options.identifiers ?? []);
  const locale = event.locale && /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(event.locale) ? event.locale : undefined;
  const region = event.region && /^[a-z0-9_-]{2,16}$/i.test(event.region) ? event.region : undefined;
  const sourceDigest = options.sourceDigest && /^sha256:[a-f0-9]{64}$/i.test(options.sourceDigest)
    ? options.sourceDigest.toLocaleLowerCase("en-US")
    : undefined;
  const globalEvent: GlobalLearningEvent = {
    recordType: "LEARNING_EVENT",
    schemaVersion: 1,
    id: outputId,
    eventType: event.eventType,
    payload: sanitized.payload,
    verified: true,
    occurredAt: event.occurredAt,
    ...(locale ? { locale } : {}),
    ...(region ? { region } : {}),
    dataScope: "GLOBAL_DEIDENTIFIED",
    deidentified: true,
    trainingUse: "ELIGIBLE",
    consentPolicyVersion: consent.policyVersion,
    deidentifiedAt: validIsoDate(now) ? now : new Date().toISOString(),
    ...(sourceDigest ? { sourceDigest } : {}),
  };
  const audit: LearningAuditRecord = {
    recordType: "LEARNING_AUDIT",
    schemaVersion: 1,
    id: auditId,
    ownerId: event.ownerId,
    operation: "DEIDENTIFIED",
    sourceRecordId: event.id,
    outputRecordId: outputId,
    policyVersion: consent.policyVersion,
    removedFields: sanitized.removedFields,
    occurredAt: globalEvent.deidentifiedAt,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
  };
  return { ok: true, event: globalEvent, audit };
}

export type PersonalAiDeletionAudit = {
  ownerId: string;
  requestedAt: string;
  removedNamespaces: string[];
  failedNamespaces: string[];
  complete: boolean;
};

/** Removes only Phase 1 AI state. It is safe to call repeatedly. */
export function deletePersonalAiData(
  storage: Pick<Storage, "removeItem">,
  ownerId: string,
  now = new Date().toISOString(),
): PersonalAiDeletionAudit {
  const namespaces = [
    USER_AI_PREFERENCES_NAMESPACE,
    GROUP_AI_PREFERENCES_NAMESPACE,
    LEARNING_RECORDS_NAMESPACE,
    LEARNING_CONSENT_NAMESPACE,
    "personal-knowledge",
    "metrics",
  ];
  const removedNamespaces: string[] = [];
  const failedNamespaces: string[] = [];
  for (const namespace of namespaces) {
    const result = removeMemoryDocument(storage, namespace, ownerId);
    (result.ok ? removedNamespaces : failedNamespaces).push(namespace);
  }
  return {
    ownerId: cleanMemoryId(ownerId) ?? "",
    requestedAt: validIsoDate(now) ? now : new Date().toISOString(),
    removedNamespaces,
    failedNamespaces,
    complete: failedNamespaces.length === 0,
  };
}
