import {
  AI_IMAGE_PROCESSING_CONSENT,
  AI_PROVIDER_PROCESSING_CONSENT,
  BACKYARD_AI_PROVIDER_CONSENT_VERSION,
  type BackyardAiProcessingConsentScope,
} from "./privacy";
import {
  readMemoryDocument,
  removeMemoryDocument,
  writeMemoryDocument,
  type MemoryStorage,
} from "./memory/storage";
import { cleanMemoryId, validIsoDate } from "./memory/types";

const AI_PROCESSING_CONSENT_NAMESPACE = "processing-consents";
export const AI_PROCESSING_CONSENT_UPDATED_EVENT = "backyard-ai-processing-consent-updated";

const PROCESSING_SCOPES = new Set<BackyardAiProcessingConsentScope>([
  AI_PROVIDER_PROCESSING_CONSENT,
  AI_IMAGE_PROCESSING_CONSENT,
]);

// Safari Private Browsing can expose Storage while throwing on read or write.
// This owner/scope-scoped fallback lasts only for the current JS session. It is
// never authority for authenticated users; their server record is.
const volatileProcessingConsents = new Map<string, AiProcessingConsent>();
const unavailableBrowserStorage: MemoryStorage = {
  getItem() { throw new Error("browser_storage_unavailable"); },
  setItem() { throw new Error("browser_storage_unavailable"); },
  removeItem() { throw new Error("browser_storage_unavailable"); },
};

function volatileConsentKey(userId: string, scope: BackyardAiProcessingConsentScope, policyVersion: string) {
  return `${userId}:${scope}:${policyVersion}`;
}

function hasVolatileConsent(userId: string, scope: BackyardAiProcessingConsentScope, policyVersion: string) {
  const normalizedUserId = cleanMemoryId(userId);
  return Boolean(normalizedUserId && volatileProcessingConsents.has(volatileConsentKey(normalizedUserId, scope, policyVersion)));
}

/** Accessing window.localStorage can itself throw in private/restricted modes. */
export function browserAiProcessingConsentStorage(): MemoryStorage {
  try {
    return window.localStorage;
  } catch {
    return unavailableBrowserStorage;
  }
}

export type AiProcessingConsent = {
  schemaVersion: 1;
  userId: string;
  policyVersion: string;
  acceptedAt: string;
  revokedAt: string | null;
  scope: BackyardAiProcessingConsentScope;
};

export type AiProcessingConsentWriteResult =
  | { ok: true; persisted: boolean; consent: AiProcessingConsent }
  | { ok: false; persisted: false; consent: null; error: "identity_missing" | "consent_missing" | "storage_read_failed" | "storage_write_failed" };

export type AuthoritativeAiProcessingConsent = {
  active: boolean;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type AiProcessingConsentReconcileResult = {
  active: boolean;
  consent: AiProcessingConsent | null;
  cachePersisted: boolean;
  pendingLocalRevocation: boolean;
};

function normalizeAiProcessingConsent(value: unknown): AiProcessingConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const userId = cleanMemoryId(source.userId);
  const policyVersion = cleanMemoryId(source.policyVersion, 80);
  if (
    source.schemaVersion !== 1
    || !userId
    || !policyVersion
    || !PROCESSING_SCOPES.has(source.scope as BackyardAiProcessingConsentScope)
    || !validIsoDate(source.acceptedAt)
    || !(source.revokedAt === null || validIsoDate(source.revokedAt))
    || (typeof source.revokedAt === "string" && Date.parse(source.revokedAt) < Date.parse(String(source.acceptedAt)))
  ) return null;
  return {
    schemaVersion: 1,
    userId,
    policyVersion,
    acceptedAt: source.acceptedAt,
    revokedAt: source.revokedAt,
    scope: source.scope as BackyardAiProcessingConsentScope,
  };
}

function announceConsentUpdate(consent: AiProcessingConsent) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiProcessingConsent>(AI_PROCESSING_CONSENT_UPDATED_EVENT, { detail: consent }));
}

function readConsentDocument(storage: Pick<Storage, "getItem">, userId: string) {
  return readMemoryDocument(storage, AI_PROCESSING_CONSENT_NAMESPACE, userId, normalizeAiProcessingConsent);
}

export function readAiProcessingConsent(
  storage: Pick<Storage, "getItem">,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  policyVersion = BACKYARD_AI_PROVIDER_CONSENT_VERSION,
) {
  const normalizedUserId = cleanMemoryId(userId);
  if (!normalizedUserId) return null;
  const volatile = volatileProcessingConsents.get(volatileConsentKey(normalizedUserId, scope, policyVersion));
  if (volatile) return volatile;
  const result = readConsentDocument(storage, normalizedUserId);
  if (!result.ok) return null;
  return result.document.items.find((item) =>
    item.userId === normalizedUserId
    && item.scope === scope
    && item.policyVersion === policyVersion
  ) ?? null;
}

export function hasActiveAiProcessingConsent(
  storage: Pick<Storage, "getItem">,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  policyVersion = BACKYARD_AI_PROVIDER_CONSENT_VERSION,
) {
  return readAiProcessingConsent(storage, userId, scope, policyVersion)?.revokedAt === null;
}

export function acceptAiProcessingConsent(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  now = new Date().toISOString(),
  policyVersion = BACKYARD_AI_PROVIDER_CONSENT_VERSION,
): AiProcessingConsentWriteResult {
  const normalizedUserId = cleanMemoryId(userId);
  if (!normalizedUserId || !validIsoDate(now)) {
    return { ok: false, persisted: false, consent: null, error: "identity_missing" };
  }
  const key = volatileConsentKey(normalizedUserId, scope, policyVersion);
  const current = readConsentDocument(storage, normalizedUserId);
  const volatile = volatileProcessingConsents.get(key);
  const active = (volatile ? [volatile] : current.document.items).find((item) =>
    item.userId === normalizedUserId && item.scope === scope && item.policyVersion === policyVersion && item.revokedAt === null
  );
  if (active) return { ok: true, persisted: current.ok && !volatile, consent: active };
  const consent: AiProcessingConsent = active ?? {
    schemaVersion: 1,
    userId: normalizedUserId,
    policyVersion,
    acceptedAt: now,
    revokedAt: null,
    scope,
  };
  const items = current.document.items.filter((item) => item.scope !== scope || item.policyVersion !== policyVersion);
  const written = current.ok
    ? writeMemoryDocument(storage, AI_PROCESSING_CONSENT_NAMESPACE, normalizedUserId, [...items, consent], now)
    : { ok: false as const };
  if (written.ok) volatileProcessingConsents.delete(key);
  else volatileProcessingConsents.set(key, consent);
  announceConsentUpdate(consent);
  return { ok: true, persisted: written.ok, consent };
}

export function revokeAiProcessingConsent(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  now = new Date().toISOString(),
  policyVersion = BACKYARD_AI_PROVIDER_CONSENT_VERSION,
): AiProcessingConsentWriteResult {
  const normalizedUserId = cleanMemoryId(userId);
  if (!normalizedUserId || !validIsoDate(now)) {
    return { ok: false, persisted: false, consent: null, error: "identity_missing" };
  }
  const key = volatileConsentKey(normalizedUserId, scope, policyVersion);
  const current = readConsentDocument(storage, normalizedUserId);
  const existing = volatileProcessingConsents.get(key) ?? current.document.items.find((item) =>
    item.userId === normalizedUserId && item.scope === scope && item.policyVersion === policyVersion
  );
  if (!existing) return { ok: false, persisted: false, consent: null, error: "consent_missing" };
  if (existing.revokedAt !== null) return { ok: true, persisted: current.ok && !volatileProcessingConsents.has(key), consent: existing };
  const consent: AiProcessingConsent = { ...existing, revokedAt: existing.revokedAt ?? now };
  const items = current.document.items.filter((item) => item.scope !== scope || item.policyVersion !== policyVersion);
  const written = current.ok
    ? writeMemoryDocument(storage, AI_PROCESSING_CONSENT_NAMESPACE, normalizedUserId, [...items, consent], now)
    : { ok: false as const };
  if (written.ok) volatileProcessingConsents.delete(key);
  else volatileProcessingConsents.set(key, consent);
  announceConsentUpdate(consent);
  return { ok: true, persisted: written.ok, consent };
}

/**
 * Mirrors an authenticated account's server state into the local cache.
 * A newer local revocation is kept as a fail-closed tombstone until that
 * explicit revocation reaches the server; a stale local acceptance can never
 * recreate or override a remote revocation.
 */
export function reconcileAuthoritativeAiProcessingConsent(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  remote: AuthoritativeAiProcessingConsent,
  now = new Date().toISOString(),
  policyVersion = BACKYARD_AI_PROVIDER_CONSENT_VERSION,
): AiProcessingConsentReconcileResult {
  const current = readAiProcessingConsent(storage, userId, scope, policyVersion);
  if (remote.active && remote.acceptedAt && validIsoDate(remote.acceptedAt) && remote.revokedAt === null) {
    // A revocation is a fail-closed tombstone. Clock skew or a stale active GET
    // must never revive it; only another explicit acceptance may replace it.
    if (current?.revokedAt) {
      return { active: false, consent: current, cachePersisted: !hasVolatileConsent(userId, scope, policyVersion), pendingLocalRevocation: true };
    }
    if (current?.revokedAt === null && current.acceptedAt === remote.acceptedAt) {
      return { active: true, consent: current, cachePersisted: !hasVolatileConsent(userId, scope, policyVersion), pendingLocalRevocation: false };
    }
    const accepted = acceptAiProcessingConsent(storage, userId, scope, remote.acceptedAt, policyVersion);
    return accepted.ok
      ? { active: true, consent: accepted.consent, cachePersisted: accepted.persisted, pendingLocalRevocation: false }
      : {
          active: true,
          consent: {
            schemaVersion: 1,
            userId,
            policyVersion,
            acceptedAt: remote.acceptedAt,
            revokedAt: null,
            scope,
          },
          cachePersisted: false,
          pendingLocalRevocation: false,
        };
  }

  if (!current) return { active: false, consent: null, cachePersisted: true, pendingLocalRevocation: false };
  if (current.revokedAt !== null) return { active: false, consent: current, cachePersisted: !hasVolatileConsent(userId, scope, policyVersion), pendingLocalRevocation: false };
  const remoteRevokedAt = remote.revokedAt && validIsoDate(remote.revokedAt) && Date.parse(remote.revokedAt) >= Date.parse(current.acceptedAt)
    ? remote.revokedAt
    : now;
  const revoked = revokeAiProcessingConsent(storage, userId, scope, remoteRevokedAt, policyVersion);
  return revoked.ok
    ? { active: false, consent: revoked.consent, cachePersisted: revoked.persisted, pendingLocalRevocation: false }
    : { active: false, consent: current, cachePersisted: false, pendingLocalRevocation: false };
}

export function deleteAiProcessingConsents(storage: MemoryStorage, userId: string) {
  const normalizedUserId = cleanMemoryId(userId);
  if (normalizedUserId) {
    for (const key of volatileProcessingConsents.keys()) {
      if (key.startsWith(`${normalizedUserId}:`)) volatileProcessingConsents.delete(key);
    }
  }
  return removeMemoryDocument(storage, AI_PROCESSING_CONSENT_NAMESPACE, userId);
}
