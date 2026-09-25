import {
  LEGAL_EVIDENCE_DEFINITIONS,
  legalEvidenceDefinition,
  type LegalEvidenceAction,
  type LegalEvidenceSubject,
} from "./legal-evidence";
import type { CanonicalDataEnvironment } from "./runtime-environment";

export const GUEST_LEGAL_ACTOR_KEY = "backyard-guest-legal-actor-v1";
export const LEGAL_EVIDENCE_STATE_PREFIX = "backyard-legal-evidence-v2:";

export type LegalEnvironment = CanonicalDataEnvironment;
export type LegalActorContext = "authenticated" | "guest_local";
export type LegalSyncStatus = "local_only" | "pending" | "synced" | "failed";
export type LegalEvidenceOrigin = "access_notice" | "onboarding" | "existing_user_update" | "financial_gate" | "account_privacy";

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
  origin: LegalEvidenceOrigin;
  locale: "es-MX";
  clientOccurredAt: string;
  serverReceivedAt?: string;
  idempotencyKey: string;
  syncStatus: LegalSyncStatus;
};

export type LegalIdentity = { mode: "guest" | "authenticated"; userId: string };
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const GUEST_ACTOR = /^guest-local:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LEGAL_EVIDENCE_MAX_REMOTE_PAGE_EVENTS = 500;
export const LEGAL_EVIDENCE_MAX_REMOTE_PAGES = 20;
export const LEGAL_EVIDENCE_MAX_REMOTE_EVENTS = LEGAL_EVIDENCE_MAX_REMOTE_PAGE_EVENTS * LEGAL_EVIDENCE_MAX_REMOTE_PAGES;

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
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newLegalId(randomId?: () => string) {
  const value = randomId?.() || (typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : fallbackUuid());
  if (!UUID.test(value)) throw new Error("legal_id_invalid");
  return value;
}

export function getOrCreateGuestLegalActor(storage: WriteStorage, randomId?: () => string) {
  const current = storage.getItem(GUEST_LEGAL_ACTOR_KEY);
  if (current && GUEST_ACTOR.test(current)) return current;
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
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "app.thebackyard.com.mx") return "production";
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]") return "development";
  return "preview";
}

export function legalEvidenceStateKey(actorKey: string, environment: LegalEnvironment) {
  return `${LEGAL_EVIDENCE_STATE_PREFIX}${environment}:${actorKey}`;
}

function isLegalEvent(value: unknown, actorKey?: string, environment?: LegalEnvironment): value is LegalEvidenceEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
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
    && typeof item.documentHash === "string"
    && SHA256.test(item.documentHash)
    && typeof item.statementText === "string"
    && item.statementText.trim().length > 0
    && typeof item.statementHash === "string"
    && SHA256.test(item.statementHash)
    && item.statementKey === `${subject}.${action}.${item.documentVersion}`
    && typeof item.origin === "string"
    && ["access_notice", "onboarding", "existing_user_update", "financial_gate", "account_privacy"].includes(item.origin)
    && item.locale === "es-MX"
    && typeof item.clientOccurredAt === "string"
    && Number.isFinite(Date.parse(item.clientOccurredAt))
    && (item.serverReceivedAt === undefined || (typeof item.serverReceivedAt === "string" && Number.isFinite(Date.parse(item.serverReceivedAt))))
    && typeof item.idempotencyKey === "string"
    && UUID.test(item.idempotencyKey)
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

function sameLegalDecision(left: LegalEvidenceEvent, right: LegalEvidenceEvent) {
  return left.actorKey === right.actorKey
    && left.environment === right.environment
    && left.subject === right.subject
    && left.action === right.action
    && left.documentKey === right.documentKey
    && left.documentVersion === right.documentVersion
    && left.documentHash === right.documentHash
    && left.statementKey === right.statementKey
    && left.statementText === right.statementText
    && left.statementHash === right.statementHash
    && left.locale === right.locale;
}

export function replaceLegalEvidence(storage: WriteStorage, actorKey: string, environment: LegalEnvironment, events: LegalEvidenceEvent[]) {
  if (events.some((event) => !isLegalEvent(event, actorKey, environment))) throw new Error("legal_evidence_invalid");
  const ids = new Set(events.map((event) => event.idempotencyKey.toLowerCase()));
  if (ids.size !== events.length) throw new Error("legal_idempotency_conflict");
  storage.setItem(legalEvidenceStateKey(actorKey, environment), JSON.stringify(events));
  const verified = readLegalEvidence(storage, actorKey, environment);
  if (verified.length !== events.length) throw new Error("legal_evidence_not_persisted");
  return verified;
}

export function persistLegalEvidence(storage: WriteStorage, event: LegalEvidenceEvent) {
  if (!isLegalEvent(event)) throw new Error("legal_evidence_invalid");
  const current = readLegalEvidence(storage, event.actorKey, event.environment);
  const prior = current.find((item) => item.idempotencyKey.toLowerCase() === event.idempotencyKey.toLowerCase());
  if (prior && !sameEvent(prior, event)) throw new Error("legal_idempotency_conflict");
  if (prior) return prior;
  return replaceLegalEvidence(storage, event.actorKey, event.environment, [...current, event]).at(-1)!;
}

export function buildLegalEvidenceEvent(args: {
  actorKey: string;
  actorContext: LegalActorContext;
  environment: LegalEnvironment;
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  origin: LegalEvidenceOrigin;
  syncStatus: LegalSyncStatus;
  clientOccurredAt?: string;
  idempotencyKey?: string;
  randomId?: () => string;
}): LegalEvidenceEvent {
  const definition = legalEvidenceDefinition(args.subject, args.action);
  if (!definition) throw new Error("legal_action_not_allowed");
  const clientOccurredAt = args.clientOccurredAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(clientOccurredAt))) throw new Error("legal_client_time_invalid");
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
    origin: args.origin,
    locale: "es-MX",
    clientOccurredAt,
    idempotencyKey: args.idempotencyKey || newLegalId(args.randomId),
    syncStatus: args.syncStatus,
  };
}

export function latestLegalEvidence(events: LegalEvidenceEvent[], subject: LegalEvidenceSubject) {
  const version = LEGAL_EVIDENCE_DEFINITIONS[subject].version;
  return events.filter((event) => event.subject === subject && event.documentVersion === version).at(-1) || null;
}

export function recordLocalLegalEvidenceBatch(storage: WriteStorage, identity: LegalIdentity, args: {
  environment: LegalEnvironment;
  choices: Array<{ subject: LegalEvidenceSubject; action: LegalEvidenceAction }>;
  origin: LegalEvidenceOrigin;
  clientOccurredAt?: string;
  randomId?: () => string;
}) {
  const actor = legalActorForIdentity(storage, identity, args.randomId);
  const current = readLegalEvidence(storage, actor.actorKey, args.environment);
  const recorded: LegalEvidenceEvent[] = [];
  let next = current;
  for (const choice of args.choices) {
    const latest = latestLegalEvidence(next, choice.subject);
    if (latest?.action === choice.action) continue;
    const event = buildLegalEvidenceEvent({
      ...actor,
      environment: args.environment,
      subject: choice.subject,
      action: choice.action,
      origin: args.origin,
      syncStatus: identity.mode === "authenticated" ? "pending" : "local_only",
      clientOccurredAt: args.clientOccurredAt,
      randomId: args.randomId,
    });
    recorded.push(event);
    next = [...next, event];
  }
  const events = recorded.length ? replaceLegalEvidence(storage, actor.actorKey, args.environment, next) : current;
  return { ...actor, events, recorded };
}

export function hasCurrentCoreLegalChoices(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "privacy_notice")?.action === "presented"
    && latestLegalEvidence(events, "terms")?.action === "accepted"
    && latestLegalEvidence(events, "age_declaration")?.action === "accepted";
}

export function hasCurrentFinancialConsent(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "financial_data")?.action === "accepted";
}

/** Legacy positive consent remains compatible only after this actor/environment
 * has been resolved. A later rejection or revocation always wins. */
export function hasResolvedFinancialConsent(events: LegalEvidenceEvent[], legacyAccepted: boolean, resolved: boolean) {
  if (!resolved) return false;
  const latest = latestLegalEvidence(events, "financial_data");
  if (latest?.action === "accepted") return true;
  if (latest?.action === "rejected" || latest?.action === "revoked") return false;
  return legacyAccepted;
}

export function hasCurrentMarketingConsent(events: LegalEvidenceEvent[]) {
  return latestLegalEvidence(events, "marketing")?.action === "accepted";
}

export function hasResolvedMarketingConsent(events: LegalEvidenceEvent[], localAccepted: boolean, resolved: boolean) {
  if (!resolved) return false;
  const latest = latestLegalEvidence(events, "marketing");
  if (latest?.action === "accepted") return true;
  if (latest?.action === "rejected" || latest?.action === "revoked") return false;
  return localAccepted;
}

export function isCurrentLegalEvidence(event: LegalEvidenceEvent) {
  const definition = legalEvidenceDefinition(event.subject, event.action);
  return Boolean(definition
    && event.documentKey === definition.documentKey
    && event.documentVersion === definition.version
    && event.documentHash === definition.documentHash
    && event.statementKey === `${event.subject}.${event.action}.${definition.version}`
    && event.statementText === definition.statement
    && event.statementHash === definition.statementHash);
}

export function pendingLegalEvidence(events: LegalEvidenceEvent[]) {
  return events.filter((event) => event.actorContext === "authenticated"
    && (event.syncStatus === "pending" || event.syncStatus === "failed")
    && isCurrentLegalEvidence(event));
}

export function markLegalEvidenceSynced(events: LegalEvidenceEvent[], receipts: Array<{ idempotencyKey: string; serverReceivedAt: string }>) {
  const received = new Map(receipts.map((item) => [item.idempotencyKey.toLowerCase(), item.serverReceivedAt]));
  return events.map((event) => received.has(event.idempotencyKey.toLowerCase())
    ? { ...event, syncStatus: "synced" as const, serverReceivedAt: received.get(event.idempotencyKey.toLowerCase()) }
    : event);
}

export function markLegalEvidenceFailed(events: LegalEvidenceEvent[], ids: string[]) {
  const failed = new Set(ids.map((id) => id.toLowerCase()));
  return events.map((event) => failed.has(event.idempotencyKey.toLowerCase()) ? { ...event, syncStatus: "failed" as const } : event);
}

export function markLegalEvidencePending(events: LegalEvidenceEvent[], ids: string[]) {
  const pending = new Set(ids.map((id) => id.toLowerCase()));
  return events.map((event) => pending.has(event.idempotencyKey.toLowerCase()) ? { ...event, syncStatus: "pending" as const } : event);
}

export function legalEvidenceRequestBody(event: LegalEvidenceEvent) {
  return {
    subject: event.subject,
    action: event.action,
    documentKey: event.documentKey,
    documentVersion: event.documentVersion,
    documentHash: event.documentHash,
    statementKey: event.statementKey,
    statementText: event.statementText,
    statementHash: event.statementHash,
    locale: event.locale,
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
  origin: LegalEvidenceOrigin;
  client_occurred_at: string;
  server_received_at: string;
  idempotency_key: string;
};

function legalEvidenceOrder(left: LegalEvidenceEvent, right: LegalEvidenceEvent) {
  const leftLocalPending = left.syncStatus === "pending" || left.syncStatus === "failed";
  const rightLocalPending = right.syncStatus === "pending" || right.syncStatus === "failed";
  if (leftLocalPending !== rightLocalPending) return leftLocalPending ? 1 : -1;
  const leftTime = Date.parse(left.serverReceivedAt || left.clientOccurredAt);
  const rightTime = Date.parse(right.serverReceivedAt || right.clientOccurredAt);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.idempotencyKey.localeCompare(right.idempotencyKey);
}

export function mergeServerLegalEvidence(
  local: LegalEvidenceEvent[],
  rows: LegalEvidenceServerRow[],
  userId: string,
  expectedEnvironment: LegalEnvironment,
) {
  const remote = new Map<string, LegalEvidenceEvent>();
  for (const row of rows) {
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
    if (isLegalEvent(event, event.actorKey, expectedEnvironment)) remote.set(event.idempotencyKey.toLowerCase(), event);
  }
  const remoteIds = new Set(remote.keys());
  return [...remote.values(), ...local.filter((event) => !remoteIds.has(event.idempotencyKey.toLowerCase()))].sort(legalEvidenceOrder);
}

export class LegalEvidenceSyncError extends Error {
  status: number;
  resolutionBlocked: boolean;
  constructor(message: string, status = 0, resolutionBlocked = false) {
    super(message);
    this.name = "LegalEvidenceSyncError";
    this.status = status;
    this.resolutionBlocked = resolutionBlocked;
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function timeoutSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8_000) : undefined;
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function syncError(payload: Record<string, unknown>, status: number, fallback: string) {
  return new LegalEvidenceSyncError(typeof payload.error === "string" ? payload.error : fallback, status);
}

/**
 * Downloads the owner's append-only ledger before uploading local events. Each
 * successful batch is persisted immediately, so retries reuse the same UUIDs.
 * A 503 leaves events pending because Preview may not have the migration yet.
 */
export async function synchronizeLegalEvidence(args: {
  storage: WriteStorage;
  userId: string;
  accessToken: string;
  environment: LegalEnvironment;
  request?: FetchLike;
  isCurrentIdentity?: () => boolean;
}) {
  const request = args.request || fetch;
  const actorKey = `account:${args.userId}`;
  const isCurrent = args.isCurrentIdentity || (() => true);
  let current = readLegalEvidence(args.storage, actorKey, args.environment);
  const authorization = { authorization: `Bearer ${args.accessToken}` };

  const remoteRows: LegalEvidenceServerRow[] = [];
  const seenCursors = new Set<string>();
  let getUrl = "/api/legal/evidence";
  let downloadedPages = 0;
  while (true) {
    if (downloadedPages >= LEGAL_EVIDENCE_MAX_REMOTE_PAGES) {
      throw new LegalEvidenceSyncError("legal_evidence_download_limit", 409, true);
    }
    downloadedPages++;
    let getResponse: Response;
    try {
      getResponse = await request(getUrl, {
        method: "GET",
        headers: authorization,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: timeoutSignal(),
      });
    } catch (error) {
      throw new LegalEvidenceSyncError(error instanceof Error ? error.message : "No pudimos consultar tus elecciones legales.");
    }
    const getPayload = await responseJson(getResponse);
    if (!getResponse.ok) {
      if (getResponse.status === 503 && pendingLegalEvidence(current).length) {
        current = readLegalEvidence(args.storage, actorKey, args.environment);
        current = markLegalEvidencePending(current, pendingLegalEvidence(current).map((event) => event.idempotencyKey));
        if (isCurrent()) replaceLegalEvidence(args.storage, actorKey, args.environment, current);
      }
      throw syncError(getPayload, getResponse.status, "No pudimos consultar tus elecciones legales.");
    }
    if (getPayload.environment !== args.environment || !Array.isArray(getPayload.events) || typeof getPayload.truncated !== "boolean") {
      throw new LegalEvidenceSyncError("legal_evidence_environment_mismatch", 409, true);
    }
    if (getPayload.events.length > LEGAL_EVIDENCE_MAX_REMOTE_PAGE_EVENTS
      || remoteRows.length + getPayload.events.length > LEGAL_EVIDENCE_MAX_REMOTE_EVENTS) {
      throw new LegalEvidenceSyncError("legal_evidence_download_limit", 409, true);
    }
    remoteRows.push(...getPayload.events as LegalEvidenceServerRow[]);
    if (!getPayload.truncated) break;
    if (downloadedPages >= LEGAL_EVIDENCE_MAX_REMOTE_PAGES
      || remoteRows.length >= LEGAL_EVIDENCE_MAX_REMOTE_EVENTS) {
      throw new LegalEvidenceSyncError("legal_evidence_download_limit", 409, true);
    }
    const cursor = getPayload.nextCursor;
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) throw new LegalEvidenceSyncError("legal_evidence_cursor_missing", 409, true);
    const beforeReceivedAt = (cursor as Record<string, unknown>).beforeReceivedAt;
    const beforeId = (cursor as Record<string, unknown>).beforeId;
    if (typeof beforeReceivedAt !== "string" || !ISO_TIMESTAMP.test(beforeReceivedAt) || !Number.isFinite(Date.parse(beforeReceivedAt)) || typeof beforeId !== "string" || !UUID.test(beforeId)) {
      throw new LegalEvidenceSyncError("legal_evidence_cursor_invalid", 409, true);
    }
    const cursorKey = `${beforeReceivedAt}:${beforeId.toLowerCase()}`;
    if (seenCursors.has(cursorKey)) throw new LegalEvidenceSyncError("legal_evidence_cursor_repeated", 409, true);
    seenCursors.add(cursorKey);
    const params = new URLSearchParams({ beforeReceivedAt, beforeId });
    getUrl = `/api/legal/evidence?${params.toString()}`;
  }
  if (!isCurrent()) throw new LegalEvidenceSyncError("legal_identity_changed", 409);
  // Re-read after every await. A ceremony can append an event while GET is in
  // flight; replacing the initial snapshot would otherwise delete that event.
  current = readLegalEvidence(args.storage, actorKey, args.environment);
  current = mergeServerLegalEvidence(current, remoteRows, args.userId, args.environment);
  current = replaceLegalEvidence(args.storage, actorKey, args.environment, current);

  while (true) {
    current = readLegalEvidence(args.storage, actorKey, args.environment);
    if (!pendingLegalEvidence(current).length) break;
    const batch = pendingLegalEvidence(current).slice(0, 20);
    let postResponse: Response;
    try {
      postResponse = await request("/api/legal/evidence", {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ events: batch.map(legalEvidenceRequestBody) }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: timeoutSignal(),
      });
    } catch (error) {
      const ids = batch.map((event) => event.idempotencyKey);
      current = readLegalEvidence(args.storage, actorKey, args.environment);
      current = markLegalEvidencePending(current, ids);
      if (isCurrent()) replaceLegalEvidence(args.storage, actorKey, args.environment, current);
      throw new LegalEvidenceSyncError(error instanceof Error ? error.message : "No pudimos guardar tus elecciones legales.");
    }
    const postPayload = await responseJson(postResponse);
    if (!postResponse.ok) {
      const ids = batch.map((event) => event.idempotencyKey);
      current = readLegalEvidence(args.storage, actorKey, args.environment);
      current = postResponse.status === 503 || postResponse.status === 429
        ? markLegalEvidencePending(current, ids)
        : markLegalEvidenceFailed(current, ids);
      if (isCurrent()) replaceLegalEvidence(args.storage, actorKey, args.environment, current);
      throw syncError(postPayload, postResponse.status, "No pudimos guardar tus elecciones legales.");
    }
    const receipts = Array.isArray(postPayload.receipts) ? postPayload.receipts as Array<{
      idempotencyKey?: unknown;
      canonicalIdempotencyKey?: unknown;
      serverReceivedAt?: unknown;
    }> : [];
    const validReceipts = receipts.filter((receipt) => typeof receipt.idempotencyKey === "string"
      && UUID.test(receipt.idempotencyKey)
      && (receipt.canonicalIdempotencyKey === undefined
        || (typeof receipt.canonicalIdempotencyKey === "string" && UUID.test(receipt.canonicalIdempotencyKey)))
      && typeof receipt.serverReceivedAt === "string"
      && ISO_TIMESTAMP.test(receipt.serverReceivedAt)
      && Number.isFinite(Date.parse(receipt.serverReceivedAt)));
    const receiptMap = new Map(validReceipts.map((receipt) => [String(receipt.idempotencyKey).toLowerCase(), {
      serverReceivedAt: String(receipt.serverReceivedAt),
      canonicalIdempotencyKey: String(receipt.canonicalIdempotencyKey || receipt.idempotencyKey).toLowerCase(),
    }]));
    if (validReceipts.length !== batch.length
      || receiptMap.size !== batch.length
      || batch.some((event) => !receiptMap.has(event.idempotencyKey.toLowerCase()))) {
      current = readLegalEvidence(args.storage, actorKey, args.environment);
      current = markLegalEvidenceFailed(current, batch.map((event) => event.idempotencyKey));
      if (isCurrent()) replaceLegalEvidence(args.storage, actorKey, args.environment, current);
      throw new LegalEvidenceSyncError("legal_evidence_receipts_incomplete", 502);
    }
    if (!isCurrent()) throw new LegalEvidenceSyncError("legal_identity_changed", 409);
    current = readLegalEvidence(args.storage, actorKey, args.environment);
    current = markLegalEvidenceSynced(current, [...receiptMap].map(([idempotencyKey, receipt]) => ({ idempotencyKey, serverReceivedAt: receipt.serverReceivedAt })));
    for (const [requestedId, receipt] of receiptMap) {
      if (requestedId === receipt.canonicalIdempotencyKey) continue;
      const requested = current.find((event) => event.idempotencyKey.toLowerCase() === requestedId);
      const canonical = current.find((event) => event.idempotencyKey.toLowerCase() === receipt.canonicalIdempotencyKey);
      if (requested && canonical && sameLegalDecision(requested, canonical)) {
        current = current.filter((event) => event.idempotencyKey.toLowerCase() !== requestedId);
      }
    }
    current = replaceLegalEvidence(args.storage, actorKey, args.environment, current);
  }
  return current;
}

export function legalEvidenceSyncMessage(error: unknown, online: boolean) {
  if (!online) return "Sin conexión · tus elecciones legales están guardadas en este dispositivo y pendientes de recepción.";
  const status = error instanceof LegalEvidenceSyncError ? error.status : 0;
  if (status === 503) return "Tus elecciones legales están guardadas en este dispositivo. La recepción en Preview queda pendiente hasta habilitar el ledger.";
  if (status === 429) return "Tus elecciones legales están guardadas en este dispositivo. Alcanzaste el límite temporal de recepción; reintenta más tarde.";
  if (status === 401 || status === 403) return "No pudimos verificar tu sesión para recibir la evidencia legal. Tu copia local se conserva.";
  if (status === 409) return "La evidencia local se conserva, pero requiere revisión antes de sincronizarse.";
  return "Tus elecciones legales están guardadas en este dispositivo y pendientes de sincronizar.";
}
