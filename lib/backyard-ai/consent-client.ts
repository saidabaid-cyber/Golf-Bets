import {
  reconcileAuthoritativeAiProcessingConsent,
  type AiProcessingConsentReconcileResult,
} from "./processing-consent";
import { BACKYARD_AI_PROVIDER_CONSENT_VERSION } from "./privacy";
import type { BackyardAiProcessingConsentScope } from "./privacy";

export type RemoteAiProcessingConsent = {
  active: boolean;
  scope: BackyardAiProcessingConsentScope;
  policyVersion: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type AuthoritativeAiProcessingConsentResolution = RemoteAiProcessingConsent
  & AiProcessingConsentReconcileResult
  & { discarded: boolean };

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
    || body?.policyVersion !== BACKYARD_AI_PROVIDER_CONSENT_VERSION
    || (active && (!acceptedAt || !Number.isFinite(acceptedTime) || revokedAt !== null))
    || (!active && ((acceptedAt === null) !== (revokedAt === null)))
    || (!active && acceptedAt !== null && (!Number.isFinite(acceptedTime) || !Number.isFinite(revokedTime) || revokedTime < acceptedTime))
  ) {
    throw new RemoteAiProcessingConsentError(502, "La respuesta del registro de autorizaciones no es válida.", "invalid_consent_response");
  }
  return { active, scope, policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, acceptedAt, revokedAt } satisfies RemoteAiProcessingConsent;
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
