import {
  LEGAL_EVIDENCE_DEFINITIONS,
  legalEvidenceDefinition,
  type LegalEvidenceAction,
  type LegalEvidenceSubject,
} from "./legal-documents";

export const GUEST_LEGAL_ACTOR_KEY = "backyard-guest-legal-actor-v1";
export const LEGAL_EVIDENCE_STATE_PREFIX = "backyard-legal-evidence-v2:";

export type LegalEnvironment = "production" | "preview" | "development" | "test";
export type LegalActorContext = "authenticated" | "guest_local";
export type LegalSyncStatus = "local_only" | "pending" | "synced" | "failed";

export type LegalEvidenceEvent = {
  actorKey: string;
  actorContext: LegalActorContext;
  environment: LegalEnvironment;
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  documentKey: "terms" | "privacy_integral" | "privacy_simplified";
  documentVersion: string;
  documentHash: string;
  statementKey: string;
  statementText: string;
  statementHash: string;
  origin: string;
  locale: "es-MX";
  clientOccurredAt: string;
  serverReceivedAt?: string;
  idempotencyKey: string;
  syncStatus: LegalSyncStatus;
};

export type LegalIdentity = { mode: "guest" | "authenticated"; userId: string };
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function actionMatchesSubject(subject: LegalEvidenceSubject, action: LegalEvidenceAction) {
  return subject === "privacy_notice" ? action === "presented" : action === "accepted" || action === "rejected" || action === "revoked";
}

function documentMatchesSubject(subject: LegalEvidenceSubject, documentKey: unknown) {
  if (subject === "terms" || subject === "age_declaration") return documentKey === "terms";
  if (subject === "privacy_notice") return documentKey === "privacy_simplified";
  return documentKey === "privacy_integral";
}

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newLegalId(randomId?: () => string) {
  const value = randomId?.() || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackUuid());
  if (!isUuid(value)) throw new Error("legal_id_invalid");
  return value;
}

function validGuestActor(value: string | null) {
  return Boolean(value && /^guest-local:[0-9a-f-]{36}$/i.test(value));
}

export function getOrCreateGuestLegalActor(storage: WriteStorage, randomId?: () => string) {
  const current = storage.getItem(GUEST_LEGAL_ACTOR_KEY);
  if (validGuestActor(current)) return current!;
  const generated = `guest-local:${newLegalId(randomId)}`;
  storage.setItem(GUEST_LEGAL_ACTOR_KEY, generated);
  if (storage.getItem(GUEST_LEGAL_ACTOR_KEY) !== generated) throw new Error("guest_legal_actor_not_persisted");
  return generated;
}

export function legalActorForIdentity(storage: WriteStorage, identity: LegalIdentity, randomId?: () => string) {
  if (identity.mode === "authenticated") {
    if (!identity.userId || identity.userId === "guest") throw new Error("authenticated_legal_actor_invalid");
    return { actorKey: `account:${identity.userId}`, actorContext: "authenticated" as const };
  }
  return { actorKey: getOrCreateGuestLegalActor(storage, randomId), actorContext: "guest_local" as const };
}

export function legalClientEnvironment(hostname = typeof window === "undefined" ? "localhost" : window.location.hostname): LegalEnvironment {
  if (hostname === "app.thebackyard.com.mx") return "production";
  if (hostname === "localhost" || hostname === "127.0.0.1") return "development";
  return "preview";
}

export function legalEvidenceStateKey(actorKey: string, environment: LegalEnvironment) {
  return `${LEGAL_EVIDENCE_STATE_PREFIX}${environment}:${actorKey}`;
}

function isLegalEvent(value: unknown, actorKey?: string, environment?: LegalEnvironment): value is LegalEvidenceEvent {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LegalEvidenceEvent>;
  if (!item.subject || !Object.hasOwn(LEGAL_EVIDENCE_DEFINITIONS, item.subject) || !item.action) return false;
  const subject = item.subject as LegalEvidenceSubject;
  const action = item.action as LegalEvidenceAction;
  if (!actionMatchesSubject(subject, action)) return false;
  const currentDefinition = legalEvidenceDefinition(subject, action);
  const structurallyValid = Boolean(
    (!actorKey || item.actorKey === actorKey)
    && (!environment || item.environment === environment)
    && (item.actorContext === "authenticated" || item.actorContext === "guest_local")
    && documentMatchesSubject(subject, item.documentKey)
    && typeof item.documentVersion === "string"
    && item.documentVersion.trim().length > 0
    && isSha256(item.documentHash)
    && typeof item.statementText === "string"
    && item.statementText.trim().length > 0
    && isSha256(item.statementHash)
    && item.statementKey === `${subject}.${action}.${item.documentVersion}`
    && typeof item.origin === "string"
    && item.origin.trim().length > 0
    && item.origin.length <= 80
    && item.locale === "es-MX"
    && typeof item.clientOccurredAt === "string"
    && Number.isFinite(Date.parse(item.clientOccurredAt))
    && (item.serverReceivedAt === undefined || (typeof item.serverReceivedAt === "string" && Number.isFinite(Date.parse(item.serverReceivedAt))))
    && isUuid(item.idempotencyKey || "")
    && (item.syncStatus === "local_only" || item.syncStatus === "pending" || item.syncStatus === "synced" || item.syncStatus === "failed")
  );
  if (!structurallyValid) return false;
  if (!currentDefinition || item.documentVersion !== currentDefinition.version) return true;
  return item.documentKey === currentDefinition.documentKey
    && item.documentHash === currentDefinition.documentHash
    && item.statementText === currentDefinition.statement
    && item.statementHash === currentDefinition.statementHash;
}

export function readLegalEvidence(storage: ReadStorage, actorKey: string, environment: LegalEnvironment) {
  try {
    const parsed = JSON.parse(storage.getItem(legalEvidenceStateKey(actorKey, environment)) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is LegalEvidenceEvent => isLegalEvent(item, actorKey, environment)) : [];
  } catch {
    return [] as LegalEvidenceEvent[];
  }
}

function sameEvent(left: LegalEvidenceEvent, right: LegalEvidenceEvent) {
  return left.actorKey === right.actorKey
    && left.environment === right.environment
    && left.subject === right.subject
    && left.action === right.action
    && left.documentHash === right.documentHash
    && left.statementHash === right.statementHash
    && left.origin === right.origin
    && left.clientOccurredAt === right.clientOccurredAt;
}

export function persistLegalEvidence(storage: WriteStorage, event: LegalEvidenceEvent) {
  if (!isLegalEvent(event)) throw new Error("legal_evidence_invalid");
  const current = readLegalEvidence(storage, event.actorKey, event.environment);
  const prior = current.find((item) => item.idempotencyKey === event.idempotencyKey);
  if (prior && !sameEvent(prior, event)) throw new Error("legal_idempotency_conflict");
  if (prior) return prior;
  const next = [...current, event];
  storage.setItem(legalEvidenceStateKey(event.actorKey, event.environment), JSON.stringify(next));
  const verified = readLegalEvidence(storage, event.actorKey, event.environment).find((item) => item.idempotencyKey === event.idempotencyKey);
  if (!verified || !sameEvent(verified, event)) throw new Error("legal_evidence_not_persisted");
  return verified;
}

export function buildLegalEvidenceEvent(args: {
  actorKey: string;
  actorContext: LegalActorContext;
  environment: LegalEnvironment;
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  origin: string;
  syncStatus: LegalSyncStatus;
  clientOccurredAt?: string;
  idempotencyKey?: string;
  randomId?: () => string;
}): LegalEvidenceEvent {
  const definition = legalEvidenceDefinition(args.subject, args.action);
  if (!definition) throw new Error("legal_action_not_allowed");
  const clientOccurredAt = args.clientOccurredAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(clientOccurredAt))) throw new Error("legal_client_time_invalid");
  const origin = args.origin.trim();
  if (!origin || origin.length > 80) throw new Error("legal_origin_invalid");
  return {
    actorKey: args.actorKey,
    actorContext: args.actorContext,
    environment: args.environment,
    subject: args.subject,
    action: args.action,
    documentKey: definition.documentKey,
    documentVersion: definition.version,
    documentHash: definition.documentHash,
    statementKey: `${args.subject}.${args.action}.${definition.version}`,
    statementText: definition.statement,
    statementHash: definition.statementHash,
    origin,
    locale: "es-MX",
    clientOccurredAt,
    idempotencyKey: args.idempotencyKey || newLegalId(args.randomId),
    syncStatus: args.syncStatus,
  };
}

export function recordLocalLegalEvidence(storage: WriteStorage, identity: LegalIdentity, args: {
  environment: LegalEnvironment;
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  origin: string;
  syncStatus?: LegalSyncStatus;
  clientOccurredAt?: string;
  idempotencyKey?: string;
  randomId?: () => string;
}) {
  const actor = legalActorForIdentity(storage, identity, args.randomId);
  const event = buildLegalEvidenceEvent({
    ...args,
    ...actor,
    syncStatus: args.syncStatus || (identity.mode === "authenticated" ? "pending" : "local_only"),
  });
  return persistLegalEvidence(storage, event);
}

export function latestLegalEvidence(events: LegalEvidenceEvent[], subject: LegalEvidenceSubject) {
  const version = LEGAL_EVIDENCE_DEFINITIONS[subject].version;
  return events.filter((event) => event.subject === subject && event.documentVersion === version).at(-1) || null;
}

export function hasCurrentCoreLegalChoices(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "privacy_notice")?.action === "presented"
    && latestLegalEvidence(events, "terms")?.action === "accepted"
    && latestLegalEvidence(events, "age_declaration")?.action === "accepted";
}

export function hasCurrentFinancialConsent(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "financial_data")?.action === "accepted";
}

export function hasCurrentMarketingConsent(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "marketing")?.action === "accepted";
}

export function pendingLegalEvidence(events: LegalEvidenceEvent[]) {
  return events.filter((event) => event.actorContext === "authenticated" && (event.syncStatus === "pending" || event.syncStatus === "failed"));
}

export function markLegalEvidenceSynced(events: LegalEvidenceEvent[], receipts: Array<{ idempotencyKey: string; serverReceivedAt: string }>) {
  const received = new Map(receipts.map((item) => [item.idempotencyKey, item.serverReceivedAt]));
  return events.map((event) => received.has(event.idempotencyKey)
    ? { ...event, syncStatus: "synced" as const, serverReceivedAt: received.get(event.idempotencyKey) }
    : event);
}

export function markLegalEvidenceFailed(events: LegalEvidenceEvent[], ids: string[]) {
  const failed = new Set(ids);
  return events.map((event) => failed.has(event.idempotencyKey) ? { ...event, syncStatus: "failed" as const } : event);
}

export function replaceLegalEvidence(storage: WriteStorage, actorKey: string, environment: LegalEnvironment, events: LegalEvidenceEvent[]) {
  if (events.some((event) => !isLegalEvent(event, actorKey, environment))) throw new Error("legal_evidence_invalid");
  storage.setItem(legalEvidenceStateKey(actorKey, environment), JSON.stringify(events));
  const verified = readLegalEvidence(storage, actorKey, environment);
  if (verified.length !== events.length) throw new Error("legal_evidence_not_persisted");
  return verified;
}

export function legalEvidenceRequestBody(event: LegalEvidenceEvent) {
  return {
    subject: event.subject,
    action: event.action,
    origin: event.origin,
    clientOccurredAt: event.clientOccurredAt,
    idempotencyKey: event.idempotencyKey,
  };
}

export type LegalEvidenceServerRow = {
  environment: LegalEnvironment;
  document_key: LegalEvidenceEvent["documentKey"];
  purpose_key: LegalEvidenceSubject;
  document_version: string;
  document_hash: string;
  statement_key: string;
  statement_text: string;
  statement_hash: string;
  action: LegalEvidenceAction;
  locale: "es-MX";
  origin: string;
  client_occurred_at: string;
  server_received_at: string;
  idempotency_key: string;
};

export function mergeServerLegalEvidence(
  local: LegalEvidenceEvent[],
  rows: LegalEvidenceServerRow[],
  userId: string,
  expectedEnvironment: LegalEnvironment,
) {
  const remote = rows.map((row): LegalEvidenceEvent | null => {
    const event: LegalEvidenceEvent = {
      actorKey: `account:${userId}`,
      actorContext: "authenticated",
      environment: row.environment,
      subject: row.purpose_key,
      action: row.action,
      documentKey: row.document_key,
      documentVersion: row.document_version,
      documentHash: row.document_hash,
      statementKey: row.statement_key,
      statementText: row.statement_text,
      statementHash: row.statement_hash,
      origin: row.origin,
      locale: row.locale,
      clientOccurredAt: row.client_occurred_at,
      serverReceivedAt: row.server_received_at,
      idempotencyKey: row.idempotency_key,
      syncStatus: "synced",
    };
    return isLegalEvent(event, event.actorKey, expectedEnvironment) ? event : null;
  }).filter((event): event is LegalEvidenceEvent => Boolean(event));
  const remoteIds = new Set(remote.map((event) => event.idempotencyKey));
  return [...remote, ...local.filter((event) => !remoteIds.has(event.idempotencyKey))];
}
