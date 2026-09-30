import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  GhinClientError,
  GhinReadOnlyClient,
  type GhinAuthDiagnostics,
  type GhinPortableSession,
} from "./client";
import { resolveGhinPreviewCapabilities } from "./config";
import type { NormalizedGhinGolfer } from "./core";
import type { GhinServerCredentials } from "./credentials.server";
import {
  diagnosticFailure,
  logAuthenticationTransport,
  logGhinProfileStage,
  traceGhinRead,
} from "./profile-diagnostics.server";

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 250;
const MAX_ACTIVE = 500;
const MAX_SEALED_SESSION_CHARS = 24_000;
const GHIN_SESSION_PURPOSE = "backyard-ghin-read-session-v1";

export const GHIN_SESSION_COOKIE_NAME = "__Secure-backyard-ghin-read";

export type GhinAuthorizationCandidate = {
  ghinNumber: string;
  playerName: string;
  homeClubName: string | null;
  handicapIndex: number | null;
  status: string | null;
  revisionDate: string | null;
};

export type GhinUserSession = {
  ownerId: string;
  ghinNumber: string;
  client: GhinReadOnlyClient;
  lastUsedAt: number;
};

type PendingAuthorization = GhinUserSession & {
  challengeId: string;
  candidate: GhinAuthorizationCandidate;
  golfer: NormalizedGhinGolfer;
  expiresAt: number;
};

type ConfirmationPayload = {
  version: 1;
  ownerId: string;
  expiresAt: number;
  golfer: NormalizedGhinGolfer;
};

const activeSessions = new Map<string, GhinUserSession>();
const pendingAuthorizations = new Map<string, PendingAuthorization>();

type SealedSessionPayload = {
  version: 1;
  ownerId: string;
  ghinNumber: string;
  expiresAt: number;
  session: GhinPortableSession;
};

function trimOldest<T extends { lastUsedAt: number }>(items: Map<string, T>, maximum: number) {
  if (items.size <= maximum) return;
  const oldest = [...items.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  for (const [key] of oldest.slice(0, items.size - maximum)) items.delete(key);
}

function prune(now = Date.now()) {
  for (const [challengeId, pending] of pendingAuthorizations) {
    if (pending.expiresAt <= now || !pending.client.hasUsableSession()) pendingAuthorizations.delete(challengeId);
  }
  for (const [ownerId, session] of activeSessions) {
    if (!session.client.hasUsableSession()) activeSessions.delete(ownerId);
  }
  trimOldest(pendingAuthorizations, MAX_PENDING);
  trimOldest(activeSessions, MAX_ACTIVE);
}

function candidate(golfer: NormalizedGhinGolfer): GhinAuthorizationCandidate {
  return {
    ghinNumber: golfer.ghinNumber,
    playerName: golfer.name ?? "Golfer GHIN",
    homeClubName: golfer.homeClubName ?? golfer.clubName,
    handicapIndex: golfer.handicapIndex,
    status: golfer.rawStatus ?? golfer.status,
    revisionDate: golfer.updatedAt,
  };
}

function confirmationKey() {
  const serverSecret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverSecret) throw new Error("GHIN_CONFIRMATION_KEY_UNAVAILABLE");
  return createHash("sha256").update("backyard-ghin-confirmation-v1\0").update(serverSecret).digest();
}

function sessionKey() {
  const serverSecret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverSecret) throw new Error("GHIN_SESSION_KEY_UNAVAILABLE");
  return createHash("sha256").update(`${GHIN_SESSION_PURPOSE}\0`).update(serverSecret).digest();
}

function encryptSessionPayload(payload: SealedSessionPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

function decryptSessionPayload(value: string): SealedSessionPayload | null {
  if (!value || value.length > MAX_SEALED_SESSION_CHARS) return null;
  const [version, encodedIv, encodedPayload, encodedTag, ...extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload || !encodedTag || extra.length) return null;
  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const encrypted = Buffer.from(encodedPayload, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    const decoded = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const payload = decoded as Partial<SealedSessionPayload>;
    if (payload.version !== 1 || typeof payload.ownerId !== "string" || typeof payload.ghinNumber !== "string"
      || !/^\d{5,12}$/.test(payload.ghinNumber) || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= Date.now() || !payload.session || typeof payload.session !== "object") return null;
    return payload as SealedSessionPayload;
  } catch {
    return null;
  }
}

function confirmationTicket(ownerId: string, golfer: NormalizedGhinGolfer, expiresAt: number) {
  const payload: ConfirmationPayload = { version: 1, ownerId, expiresAt, golfer };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", confirmationKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifiedTicket(ownerId: string, ticket: string): ConfirmationPayload | null {
  const [encoded, suppliedSignature, ...extra] = ticket.split(".");
  if (!encoded || !suppliedSignature || extra.length || ticket.length > 3_000) return null;
  const expectedSignature = createHmac("sha256", confirmationKey()).update(encoded).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<ConfirmationPayload>;
  const golfer = payload.golfer;
  if (payload.version !== 1 || payload.ownerId !== ownerId || typeof payload.expiresAt !== "number"
    || payload.expiresAt <= Date.now() || !golfer || !/^\d{5,12}$/.test(golfer.ghinNumber)
    || typeof golfer.name !== "string" || !golfer.name) return null;
  return payload as ConfirmationPayload;
}

function clientFor(credentials: GhinServerCredentials) {
  const capabilities = resolveGhinPreviewCapabilities(process.env);
  if (!capabilities.previewOnly || !capabilities.readOnlyEnabled || !capabilities.golferLookup
    || capabilities.scorePostingEnabled || !capabilities.apiBaseUrl) {
    throw new Error("GHIN_USER_FLOW_DISABLED");
  }
  return new GhinReadOnlyClient({ baseUrl: capabilities.apiBaseUrl, credentials });
}

function clientForPortableSession(session: GhinPortableSession) {
  const capabilities = resolveGhinPreviewCapabilities(process.env);
  if (!capabilities.previewOnly || !capabilities.readOnlyEnabled || !capabilities.golferLookup
    || capabilities.scorePostingEnabled || !capabilities.apiBaseUrl) {
    throw new Error("GHIN_USER_FLOW_DISABLED");
  }
  return new GhinReadOnlyClient({ baseUrl: capabilities.apiBaseUrl, session });
}

async function authenticateIdentity(
  credentials: GhinServerCredentials,
  operation: "authorize" | "reauthorize",
  expectedGhinNumber?: string,
) {
  let client: GhinReadOnlyClient;
  try {
    client = clientFor(credentials);
  } catch (error) {
    logGhinProfileStage({
      operation,
      stage: "authorization_state",
      ...diagnosticFailure(error, "/authorization-state", "authorization_state_failed"),
      durationMs: 0,
    });
    throw error;
  }
  try {
    let auth: GhinAuthDiagnostics;
    try {
      auth = await client.authenticate(true);
      logAuthenticationTransport(operation, client.getTrace());
      logGhinProfileStage({
        operation,
        stage: "golfer_token_extraction",
        endpoint: auth.endpoint,
        httpStatus: auth.httpStatus,
        code: null,
        retryable: false,
        durationMs: 0,
      });
      logGhinProfileStage({
        operation,
        stage: "golfer_identity_from_login",
        endpoint: auth.endpoint,
        httpStatus: auth.httpStatus,
        code: auth.golferNumber ? null : "identity_not_present",
        retryable: false,
        durationMs: 0,
      });
    } catch (error) {
      logAuthenticationTransport(operation, client.getTrace(), error);
      throw error;
    }
    const loginNumber = /^\d{5,12}$/.test(credentials.login.trim()) ? credentials.login.trim() : null;
    const loginEmail = !loginNumber && credentials.login.includes("@") ? credentials.login.trim() : null;
    const authenticatedGolfer = auth.golferNumber
      ? await traceGhinRead(operation, "lookup_by_ghin", "/golfers/search.json", () => client.lookupGolfer(auth.golferNumber as string))
      : loginNumber
        ? await traceGhinRead(operation, "lookup_by_ghin", "/golfers/search.json", () => client.lookupGolfer(loginNumber))
        : loginEmail
          ? await traceGhinRead(operation, "lookup_by_email", "/golfers/search.json", () => client.lookupGolferByEmail(loginEmail))
          : null;
    const ghinNumber = authenticatedGolfer?.data.ghinNumber ?? null;
    if (!authenticatedGolfer || !ghinNumber || (expectedGhinNumber && ghinNumber !== expectedGhinNumber)) {
      logGhinProfileStage({
        operation,
        stage: "identity_validation",
        endpoint: "/identity",
        httpStatus: authenticatedGolfer?.httpStatus ?? null,
        code: "identity_mismatch",
        retryable: false,
        durationMs: 0,
      });
      throw new GhinClientError({ code: "unauthorized", message: "La sesión GHIN no corresponde al vínculo.", httpStatus: 403, retryable: false }, "/golfer_login.json");
    }
    if (authenticatedGolfer.data.ghinNumber !== ghinNumber || (expectedGhinNumber && authenticatedGolfer.data.ghinNumber !== expectedGhinNumber)) {
      logGhinProfileStage({
        operation,
        stage: "identity_validation",
        endpoint: "/identity",
        httpStatus: authenticatedGolfer.httpStatus,
        code: "identity_mismatch",
        retryable: false,
        durationMs: 0,
      });
      throw new GhinClientError({ code: "unauthorized", message: "La sesión GHIN no corresponde al vínculo.", httpStatus: 403, retryable: false }, authenticatedGolfer.endpoint);
    }
    if (!authenticatedGolfer.data.name) {
      logGhinProfileStage({
        operation,
        stage: "identity_validation",
        endpoint: "/identity",
        httpStatus: authenticatedGolfer.httpStatus,
        code: "identity_incomplete",
        retryable: true,
        durationMs: 0,
      });
      throw new GhinClientError({ code: "invalid_response", message: "GHIN devolvió una identidad incompleta.", httpStatus: 502, retryable: true }, authenticatedGolfer.endpoint);
    }
    logGhinProfileStage({
      operation,
      stage: "identity_validation",
      endpoint: "/identity",
      httpStatus: authenticatedGolfer.httpStatus,
      code: null,
      retryable: false,
      durationMs: 0,
    });
    return { client, auth, golfer: authenticatedGolfer.data };
  } finally {
    // A normal-user password is never retained for an automatic relogin.
    client.discardCredentials();
  }
}

export async function beginGhinAuthorization(ownerId: string, credentials: GhinServerCredentials): Promise<{
  challengeId: string;
  candidate: GhinAuthorizationCandidate;
  auth: GhinAuthDiagnostics;
  session: GhinUserSession;
}> {
  prune();
  const authenticated = await authenticateIdentity(credentials, "authorize");
  const now = Date.now();
  const expiresAt = now + PENDING_TTL_MS;
  const stateStartedAt = Date.now();
  try {
    const challengeId = confirmationTicket(ownerId, authenticated.golfer, expiresAt);
    const session: PendingAuthorization = {
      challengeId,
      ownerId,
      ghinNumber: authenticated.golfer.ghinNumber,
      client: authenticated.client,
      golfer: authenticated.golfer,
      candidate: candidate(authenticated.golfer),
      expiresAt,
      lastUsedAt: now,
    };
    pendingAuthorizations.set(challengeId, session);
    trimOldest(pendingAuthorizations, MAX_PENDING);
    logGhinProfileStage({
      operation: "authorize",
      stage: "authorization_state",
      endpoint: "/authorization-state",
      httpStatus: null,
      code: null,
      retryable: false,
      durationMs: Date.now() - stateStartedAt,
    });
    return { challengeId, candidate: candidate(authenticated.golfer), auth: authenticated.auth, session };
  } catch (error) {
    logGhinProfileStage({
      operation: "authorize",
      stage: "authorization_state",
      ...diagnosticFailure(error, "/authorization-state", "authorization_state_failed"),
      durationMs: Date.now() - stateStartedAt,
    });
    throw error;
  }
}

export function consumeGhinAuthorization(ownerId: string, challengeId: string) {
  prune();
  const pending = pendingAuthorizations.get(challengeId) ?? null;
  if (pending?.ownerId === ownerId) {
    pendingAuthorizations.delete(challengeId);
    return { golfer: pending.golfer, session: pending };
  }
  const signed = verifiedTicket(ownerId, challengeId);
  return signed ? { golfer: signed.golfer, session: null } : null;
}

export function cancelGhinAuthorization(ownerId: string, challengeId: string) {
  const pending = pendingAuthorizations.get(challengeId);
  if (pending?.ownerId === ownerId) pendingAuthorizations.delete(challengeId);
}

export function activateGhinSession(session: GhinUserSession) {
  const activated = { ...session, lastUsedAt: Date.now() };
  activeSessions.set(session.ownerId, activated);
  trimOldest(activeSessions, MAX_ACTIVE);
}

export function sealGhinUserSession(session: GhinUserSession) {
  const portable = session.client.exportPortableSession();
  if (!portable || (portable.golferNumber && portable.golferNumber !== session.ghinNumber)) {
    throw new Error("GHIN_SESSION_INVALID");
  }
  const expiresAt = portable.effectiveExpiresAt;
  return {
    value: encryptSessionPayload({
      version: 1,
      ownerId: session.ownerId,
      ghinNumber: session.ghinNumber,
      expiresAt,
      session: portable,
    }),
    expiresAt,
  };
}

export function restoreGhinUserSession(ownerId: string, ghinNumber: string, sealed: string | null | undefined) {
  const payload = sealed ? decryptSessionPayload(sealed) : null;
  if (!payload || payload.ownerId !== ownerId || payload.ghinNumber !== ghinNumber
    || (payload.session.golferNumber && payload.session.golferNumber !== ghinNumber)) return null;
  try {
    return {
      ownerId,
      ghinNumber,
      client: clientForPortableSession(payload.session),
      lastUsedAt: Date.now(),
    } satisfies GhinUserSession;
  } catch {
    return null;
  }
}

export function getGhinUserSession(ownerId: string, ghinNumber: string, sealed?: string | null) {
  prune();
  // The authenticated, encrypted cookie is the portable source of truth. The
  // process-local map is only a bounded cache and must never grant access when
  // the browser did not present a valid sealed session (for example after a
  // serverless cold start, cookie expiry or explicit cookie deletion).
  const restored = restoreGhinUserSession(ownerId, ghinNumber, sealed);
  if (!restored) {
    activeSessions.delete(ownerId);
    return null;
  }
  activateGhinSession(restored);
  return restored;
}

export async function reauthorizeGhinSession(ownerId: string, expectedGhinNumber: string, credentials: GhinServerCredentials) {
  prune();
  const authenticated = await authenticateIdentity(credentials, "reauthorize", expectedGhinNumber);
  const session: GhinUserSession = {
    ownerId,
    ghinNumber: expectedGhinNumber,
    client: authenticated.client,
    lastUsedAt: Date.now(),
  };
  activateGhinSession(session);
  return { ...authenticated, session };
}

export function clearGhinUserSession(ownerId: string) {
  activeSessions.delete(ownerId);
  for (const [challengeId, pending] of pendingAuthorizations) {
    if (pending.ownerId === ownerId) pendingAuthorizations.delete(challengeId);
  }
}
