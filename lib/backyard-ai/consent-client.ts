import {
  reconcileAuthoritativeAiProcessingConsent,
  type AiProcessingConsentReconcileResult,
} from "./processing-consent";
import { BACKYARD_AI_PROVIDER_CONSENT_VERSION } from "./privacy";
import type { BackyardAiProcessingConsentScope } from "./privacy";
import { AI_PROCESSING_CONSENT_SCOPES, type AiConsentCheckpointSource, type AiConsentDecisionInput, type AiConsentDecisionSource, type AiConsentDecisionStatus } from "./consent-record";

export type { AiConsentCheckpointSource, AiConsentDecisionInput } from "./consent-record";

export type RemoteAiProcessingConsent = {
  recordId?: string | null;
  active: boolean;
  scope: BackyardAiProcessingConsentScope;
  policyVersion: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type AuthoritativeAiProcessingConsentResolution = RemoteAiProcessingConsent
  & AiProcessingConsentReconcileResult
  & { discarded: boolean };

export type RemoteAiConsentDecision = RemoteAiProcessingConsent & {
  status: AiConsentDecisionStatus;
  source: AiConsentDecisionSource | null;
  decidedAt: string | null;
};

export type RemoteAiConsentDecisions = {
  policyVersion: string;
  decisions: RemoteAiConsentDecision[];
  resolved: boolean;
};

const consentMutationEpochs = new Map<string, number>();

function consentMutationKey(userId: string, scope: BackyardAiProcessingConsentScope) {
  return `${userId}:${scope}`;
}

export function aiProcessingConsentMutationEpoch(userId: string, scope: BackyardAiProcessingConsentScope) {
  return consentMutationEpochs.get(consentMutationKey(userId, scope)) ?? 0;
}

/** Invalidates every in-flight GET for this owner/scope before a mutation. */
export function beginAiProcessingConsentMutation(userId: string, scope: BackyardAiProcessingConsentScope) {
  const key = consentMutationKey(userId, scope);
  const next = (consentMutationEpochs.get(key) ?? 0) + 1;
  consentMutationEpochs.set(key, next);
  return next;
}

export class RemoteAiProcessingConsentError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "RemoteAiProcessingConsentError";
    this.status = status;
    this.code = code;
  }
}

async function consentRequest(
  accessToken: string,
  scope: BackyardAiProcessingConsentScope,
  method: "GET" | "POST" | "PATCH",
  signal?: AbortSignal,
) {
  const suffix = method === "GET" ? `?scope=${encodeURIComponent(scope)}` : "";
  const response = await fetch(`/api/backyard-ai/consent${suffix}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify({ scope }) }),
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => null) as {
    active?: unknown;
    scope?: unknown;
    policyVersion?: unknown;
    acceptedAt?: unknown;
    revokedAt?: unknown;
    recordId?: unknown;
    error?: unknown;
    code?: unknown;
  } | null;
  if (!response.ok) {
    throw new RemoteAiProcessingConsentError(
      response.status,
      typeof body?.error === "string" ? body.error : "No pude sincronizar la autorización de IA.",
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  const acceptedAt = typeof body?.acceptedAt === "string" ? body.acceptedAt : null;
  const revokedAt = typeof body?.revokedAt === "string" ? body.revokedAt : null;
  const active = body?.active === true;
  const acceptedTime = acceptedAt ? Date.parse(acceptedAt) : Number.NaN;
  const revokedTime = revokedAt ? Date.parse(revokedAt) : Number.NaN;
  if (
    body?.scope !== scope
    || (body?.recordId !== undefined && body.recordId !== null && (typeof body.recordId !== "string" || !/^[1-9]\d{0,19}$/.test(body.recordId)))
    || body?.policyVersion !== BACKYARD_AI_PROVIDER_CONSENT_VERSION
    || (active && (!acceptedAt || !Number.isFinite(acceptedTime) || revokedAt !== null))
    || (!active && ((acceptedAt === null) !== (revokedAt === null)))
    || (!active && acceptedAt !== null && (!Number.isFinite(acceptedTime) || !Number.isFinite(revokedTime) || revokedTime < acceptedTime))
  ) {
    throw new RemoteAiProcessingConsentError(502, "La respuesta del registro de autorizaciones no es válida.", "invalid_consent_response");
  }
  return { active, scope, policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, acceptedAt, revokedAt,
    ...(body?.recordId === undefined ? {} : { recordId: body.recordId as string | null }),
  } satisfies RemoteAiProcessingConsent;
}

export function readRemoteAiProcessingConsent(accessToken: string, scope: BackyardAiProcessingConsentScope, signal?: AbortSignal) {
  return consentRequest(accessToken, scope, "GET", signal);
}

export function acceptRemoteAiProcessingConsent(accessToken: string, userId: string, scope: BackyardAiProcessingConsentScope, signal?: AbortSignal) {
  beginAiProcessingConsentMutation(userId, scope);
  return consentRequest(accessToken, scope, "POST", signal);
}

export function revokeRemoteAiProcessingConsent(accessToken: string, userId: string, scope: BackyardAiProcessingConsentScope, signal?: AbortSignal) {
  beginAiProcessingConsentMutation(userId, scope);
  return consentRequest(accessToken, scope, "PATCH", signal);
}

function parseRemoteAiConsentDecisions(body: unknown): RemoteAiConsentDecisions {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const fail = () => { throw new RemoteAiProcessingConsentError(502, "La respuesta del registro de autorizaciones no es válida.", "invalid_consent_response"); };
  if (!value || value.policyVersion !== BACKYARD_AI_PROVIDER_CONSENT_VERSION || !Array.isArray(value.decisions)
    || value.decisions.length !== AI_PROCESSING_CONSENT_SCOPES.length || typeof value.resolved !== "boolean") return fail();
  const decisions: RemoteAiConsentDecision[] = [];
  for (const scope of AI_PROCESSING_CONSENT_SCOPES) {
    const matches = value.decisions.filter((row) => row && typeof row === "object" && row.scope === scope);
    if (matches.length !== 1) return fail();
    const row = matches[0] as Record<string, unknown>;
    const { status, source, decidedAt, acceptedAt, revokedAt, recordId } = row;
    if (!["accepted", "declined", "revoked", "missing"].includes(String(status))
      || row.policyVersion !== BACKYARD_AI_PROVIDER_CONSENT_VERSION
      || typeof row.active !== "boolean" || row.active !== (status === "accepted")
      || (recordId !== undefined && recordId !== null && (typeof recordId !== "string" || !/^[1-9]\d{0,19}$/.test(recordId)))) return fail();
    const validDate = (date: unknown): date is string => typeof date === "string" && Number.isFinite(Date.parse(date));
    if (status === "missing") {
      if (source !== null || decidedAt !== null || acceptedAt !== null || revokedAt !== null) return fail();
    } else {
      if (!["onboarding", "account_update", "settings", "legacy"].includes(String(source)) || !validDate(decidedAt)) return fail();
      if (status === "declined" && (acceptedAt !== null || revokedAt !== null)) return fail();
      if (status === "accepted" && (!validDate(acceptedAt) || revokedAt !== null)) return fail();
      if (status === "revoked" && (!validDate(acceptedAt) || !validDate(revokedAt) || Date.parse(revokedAt) < Date.parse(acceptedAt))) return fail();
    }
    decisions.push({ scope, policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, active: row.active,
      status: status as AiConsentDecisionStatus, source: source as AiConsentDecisionSource | null,
      decidedAt: decidedAt as string | null, acceptedAt: acceptedAt as string | null, revokedAt: revokedAt as string | null,
      ...(recordId === undefined ? {} : { recordId: recordId as string | null }),
    });
  }
  const resolved = decisions.every((decision) => decision.status !== "missing");
  if (resolved !== value.resolved) return fail();
  return { policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, decisions, resolved };
}

async function consentDecisionsRequest(accessToken: string, body?: { decisions: AiConsentDecisionInput[]; source: AiConsentCheckpointSource }, signal?: AbortSignal) {
  const response = await fetch("/api/backyard-ai/consent", {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal,
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result && typeof result === "object" ? result as Record<string, unknown> : null;
    throw new RemoteAiProcessingConsentError(response.status,
      typeof error?.error === "string" ? error.error : "No pude guardar tus preferencias de IA. Inténtalo nuevamente.",
      typeof error?.code === "string" ? error.code : undefined);
  }
  return parseRemoteAiConsentDecisions(result);
}

/** Always reads the server. Neither a local prompt flag nor localStorage can resolve the checkpoint. */
export function readRemoteAiConsentDecisions(accessToken: string, signal?: AbortSignal) {
  return consentDecisionsRequest(accessToken, undefined, signal);
}

export function saveRemoteAiConsentDecisions(accessToken: string, userId: string, decisions: AiConsentDecisionInput[], source: AiConsentCheckpointSource, signal?: AbortSignal) {
  for (const decision of decisions) beginAiProcessingConsentMutation(userId, decision.scope);
  return consentDecisionsRequest(accessToken, { decisions, source }, signal);
}

export async function resolveAuthoritativeAiProcessingConsent(input: {
  accessToken: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  userId: string;
  scope: BackyardAiProcessingConsentScope;
  signal?: AbortSignal;
}): Promise<AuthoritativeAiProcessingConsentResolution> {
  const observedEpoch = aiProcessingConsentMutationEpoch(input.userId, input.scope);
  const remote = await readRemoteAiProcessingConsent(input.accessToken, input.scope, input.signal);
  if (input.signal?.aborted || observedEpoch !== aiProcessingConsentMutationEpoch(input.userId, input.scope)) {
    return {
      ...remote,
      active: false,
      consent: null,
      cachePersisted: false,
      pendingLocalRevocation: true,
      discarded: true,
    };
  }
  const reconciled = reconcileAuthoritativeAiProcessingConsent(
    input.storage,
    input.userId,
    input.scope,
    remote,
  );
  return { ...remote, ...reconciled, discarded: false };
}
