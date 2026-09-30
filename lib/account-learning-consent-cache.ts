import {
  BACKYARD_AI_MEMORY_POLICY_VERSION,
  readLearningConsent,
  writeLearningConsent,
} from "./backyard-ai/memory/learning-events";
import type { LearningConsent } from "./backyard-ai/memory/types";
import {
  OPTIONAL_AUTHORIZATION_POLICY_VERSIONS,
  type OptionalAuthorizationState,
} from "./account-optional-authorizations";

export const ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT = "backyard:learning-consent-hydrated";

type LearningStorage = Pick<Storage, "getItem" | "setItem">;
type LearningScope = "PERSONAL_MEMORY" | "GLOBAL_LEARNING";
type ServerDecision = { active: boolean; decidedAt: string };
type ServerDecisionClock = {
  schemaVersion: 1;
  userId: string;
  policyVersion: typeof BACKYARD_AI_MEMORY_POLICY_VERSION;
  scopes: Partial<Record<LearningScope, ServerDecision>>;
};

const LEGACY_SERVER_DECISION_CLOCK_NAMESPACE = "the-backyard:account-learning-server-clock:v1";
const volatileServerClocks = new WeakMap<object, Map<string, ServerDecisionClock>>();

function serverDecisionClockKey(userId: string) {
  return `${LEGACY_SERVER_DECISION_CLOCK_NAMESPACE}:${encodeURIComponent(userId)}`;
}

function latestDecision(first?: ServerDecision, second?: ServerDecision) {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(second.decidedAt) >= Date.parse(first.decidedAt) ? second : first;
}

function readServerDecisionClock(storage: LearningStorage, userId: string): ServerDecisionClock {
  const volatile = volatileServerClocks.get(storage)?.get(userId);
  return {
    schemaVersion: 1,
    userId,
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    scopes: {
      PERSONAL_MEMORY: volatile?.scopes.PERSONAL_MEMORY,
      GLOBAL_LEARNING: volatile?.scopes.GLOBAL_LEARNING,
    },
  };
}

function writeServerDecisionClock(storage: LearningStorage, clock: ServerDecisionClock) {
  let clocks = volatileServerClocks.get(storage);
  if (!clocks) {
    clocks = new Map();
    volatileServerClocks.set(storage, clocks);
  }
  clocks.set(clock.userId, clock);
}

/** Account deletion removes the in-memory authority and any legacy durable
 * clock. Durable browser state is never trusted as consent evidence. */
export function clearAccountLearningConsentServerClock(
  storage: Pick<Storage, "removeItem">,
  userId: string,
) {
  const clocks = volatileServerClocks.get(storage);
  clocks?.delete(userId);
  if (clocks?.size === 0) volatileServerClocks.delete(storage);
  try { storage.removeItem(serverDecisionClockKey(userId)); } catch { /* Best effort during account cleanup. */ }
}

function latestAt(decisions: readonly (ServerDecision | undefined)[]) {
  return decisions.reduce<ServerDecision | undefined>((latest, decision) => latestDecision(latest, decision), undefined)?.decidedAt;
}

/**
 * Projects the canonical account ledger into the local AI runtime cache.
 * A legacy `missing` scope is unknown and therefore cannot enable runtime use.
 * A negative local cache remains privacy-safe, while positive use requires a
 * canonical server decision and never becomes historical acceptance.
 */
export function cacheAccountLearningConsent(
  storage: LearningStorage,
  userId: string,
  saved: OptionalAuthorizationState,
  fallback?: LearningConsent,
) {
  const current = fallback ?? readLearningConsent(
    storage,
    userId,
    BACKYARD_AI_MEMORY_POLICY_VERSION,
  ).consent;
  const personal = saved.scopes.PERSONAL_MEMORY;
  const global = saved.scopes.GLOBAL_LEARNING;
  const clock = readServerDecisionClock(storage, userId);

  function apply(scope: LearningScope, state: typeof personal) {
    const previous = clock.scopes[scope];
    if (state.policyVersion !== OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope]
      || state.status === "missing" || !state.decidedAt
      || !Number.isFinite(Date.parse(state.decidedAt))) return previous?.active ?? false;
    const incoming: ServerDecision = { active: state.active, decidedAt: state.decidedAt };
    if (previous && Date.parse(incoming.decidedAt) < Date.parse(previous.decidedAt)) return previous.active;
    clock.scopes[scope] = incoming;
    return incoming.active;
  }

  const personalMemoryEnabled = apply("PERSONAL_MEMORY", personal);
  const globalLearningEnabled = apply("GLOBAL_LEARNING", global);
  const authoritativeAt = latestAt([
    clock.scopes.PERSONAL_MEMORY,
    clock.scopes.GLOBAL_LEARNING,
  ]);
  if (!authoritativeAt
    && personalMemoryEnabled === current.personalMemoryEnabled
    && globalLearningEnabled === current.globalLearningEnabled) return current;

  const at = authoritativeAt ?? current.updatedAt;
  const next: LearningConsent = {
    ...current,
    ownerId: userId,
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    personalMemoryEnabled,
    globalLearningEnabled,
    retainPrivateInputs: false,
    updatedAt: at,
  };
  delete next.grantedAt;
  delete next.revokedAt;
  if (personalMemoryEnabled || globalLearningEnabled) {
    next.grantedAt = latestAt([
      clock.scopes.PERSONAL_MEMORY?.active ? clock.scopes.PERSONAL_MEMORY : undefined,
      clock.scopes.GLOBAL_LEARNING?.active ? clock.scopes.GLOBAL_LEARNING : undefined,
    ]) ?? current.grantedAt ?? at;
  } else {
    next.revokedAt = latestAt([
      clock.scopes.PERSONAL_MEMORY?.active === false ? clock.scopes.PERSONAL_MEMORY : undefined,
      clock.scopes.GLOBAL_LEARNING?.active === false ? clock.scopes.GLOBAL_LEARNING : undefined,
    ]) ?? current.revokedAt ?? at;
  }
  const result = writeLearningConsent(storage as Storage, next);
  writeServerDecisionClock(storage, clock);
  return result.ok ? result.consent : next;
}

/** During a canonical read outage, retain only choices that have previously
 * been confirmed by the server clock. Legacy positive local values have no
 * legal evidence and therefore cannot enable AI memory at runtime. */
export function failClosedAccountLearningConsent(
  storage: LearningStorage,
  userId: string,
  fallback?: LearningConsent,
) {
  const current = fallback ?? readLearningConsent(
    storage,
    userId,
    BACKYARD_AI_MEMORY_POLICY_VERSION,
  ).consent;
  const clock = readServerDecisionClock(storage, userId);
  const personalMemoryEnabled = clock.scopes.PERSONAL_MEMORY?.active ?? false;
  const globalLearningEnabled = clock.scopes.GLOBAL_LEARNING?.active ?? false;
  if (personalMemoryEnabled === current.personalMemoryEnabled
    && globalLearningEnabled === current.globalLearningEnabled) return current;

  const at = latestAt([clock.scopes.PERSONAL_MEMORY, clock.scopes.GLOBAL_LEARNING]) ?? current.updatedAt;
  const next: LearningConsent = {
    ...current,
    ownerId: userId,
    policyVersion: BACKYARD_AI_MEMORY_POLICY_VERSION,
    personalMemoryEnabled,
    globalLearningEnabled,
    retainPrivateInputs: false,
    updatedAt: at,
  };
  delete next.grantedAt;
  delete next.revokedAt;
  if (personalMemoryEnabled || globalLearningEnabled) next.grantedAt = at;
  else if (clock.scopes.PERSONAL_MEMORY || clock.scopes.GLOBAL_LEARNING) next.revokedAt = at;
  const result = writeLearningConsent(storage as Storage, next);
  return result.ok ? result.consent : next;
}

/** Runtime read for an authenticated account. It overlays the latest
 * server-confirmed volatile clock on local storage, so private mode/quota
 * failures cannot revive an older local ON value. */
export function readAccountLearningConsent(
  storage: LearningStorage,
  userId: string,
) {
  return failClosedAccountLearningConsent(storage, userId);
}
