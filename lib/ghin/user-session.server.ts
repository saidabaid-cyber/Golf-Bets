import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { GhinClientError, GhinReadOnlyClient, type GhinAuthDiagnostics } from "./client";
import { resolveGhinPreviewCapabilities } from "./config";
import type { NormalizedGhinGolfer } from "./core";
import type { GhinServerCredentials } from "./credentials.server";

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 250;
const MAX_ACTIVE = 500;

export type GhinAuthorizationCandidate = {
  ghinNumber: string;
  playerName: string;
  homeClubName: string | null;
  handicapIndex: number | null;
  status: string | null;
  revisionDate: string | null;
};

type UserSession = {
  ownerId: string;
  ghinNumber: string;
  client: GhinReadOnlyClient;
  lastUsedAt: number;
};

type PendingAuthorization = UserSession & {
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

const activeSessions = new Map<string, UserSession>();
const pendingAuthorizations = new Map<string, PendingAuthorization>();

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

async function authenticateIdentity(credentials: GhinServerCredentials, expectedGhinNumber?: string) {
  const client = clientFor(credentials);
  try {
    const auth = await client.authenticate(true);
    const loginNumber = /^\d{5,12}$/.test(credentials.login.trim()) ? credentials.login.trim() : null;
    const loginEmail = !loginNumber && credentials.login.includes("@") ? credentials.login.trim() : null;
    const authenticatedGolfer = auth.golferNumber
      ? await client.lookupGolfer(auth.golferNumber)
      : loginNumber
        ? await client.lookupGolfer(loginNumber)
        : loginEmail
          ? await client.lookupGolferByEmail(loginEmail)
          : null;
    const ghinNumber = authenticatedGolfer?.data.ghinNumber ?? null;
    if (!authenticatedGolfer || !ghinNumber || (expectedGhinNumber && ghinNumber !== expectedGhinNumber)) {
      throw new GhinClientError({ code: "unauthorized", message: "La sesión GHIN no corresponde al vínculo.", httpStatus: 403, retryable: false }, "/golfer_login.json");
    }
    if (authenticatedGolfer.data.ghinNumber !== ghinNumber || (expectedGhinNumber && authenticatedGolfer.data.ghinNumber !== expectedGhinNumber)) {
      throw new GhinClientError({ code: "unauthorized", message: "La sesión GHIN no corresponde al vínculo.", httpStatus: 403, retryable: false }, authenticatedGolfer.endpoint);
    }
    if (!authenticatedGolfer.data.name) {
      throw new GhinClientError({ code: "invalid_response", message: "GHIN devolvió una identidad incompleta.", httpStatus: 502, retryable: true }, authenticatedGolfer.endpoint);
    }
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
}> {
  prune();
  const authenticated = await authenticateIdentity(credentials);
  const now = Date.now();
  const expiresAt = now + PENDING_TTL_MS;
  const challengeId = confirmationTicket(ownerId, authenticated.golfer, expiresAt);
  pendingAuthorizations.set(challengeId, {
    challengeId,
    ownerId,
    ghinNumber: authenticated.golfer.ghinNumber,
    client: authenticated.client,
    golfer: authenticated.golfer,
    candidate: candidate(authenticated.golfer),
    expiresAt,
    lastUsedAt: now,
  });
  trimOldest(pendingAuthorizations, MAX_PENDING);
  return { challengeId, candidate: candidate(authenticated.golfer), auth: authenticated.auth };
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

export function activateGhinSession(session: UserSession) {
  const activated = { ...session, lastUsedAt: Date.now() };
  activeSessions.set(session.ownerId, activated);
  trimOldest(activeSessions, MAX_ACTIVE);
}

export function getGhinUserSession(ownerId: string, ghinNumber: string) {
  prune();
  const session = activeSessions.get(ownerId) ?? null;
  if (!session || session.ghinNumber !== ghinNumber) return null;
  session.lastUsedAt = Date.now();
  return session;
}

export async function reauthorizeGhinSession(ownerId: string, expectedGhinNumber: string, credentials: GhinServerCredentials) {
  prune();
  const authenticated = await authenticateIdentity(credentials, expectedGhinNumber);
  const session: UserSession = {
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
