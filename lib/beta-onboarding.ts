export const BETA_ONBOARDING_VERSION = 1 as const;

export const BETA_ONBOARDING_STEPS = [
  "ghin",
  "equipment",
  "improvements",
  "objective",
  "plan",
  "group",
  "players",
  "handicaps",
  "bets",
  "bet_details",
  "ready",
  "complete",
] as const;

export type BetaOnboardingStep = (typeof BETA_ONBOARDING_STEPS)[number];
export type BetaOnboardingStatus = "in_progress" | "complete";

export type BetaOnboardingProgress = {
  version: typeof BETA_ONBOARDING_VERSION;
  userId: string;
  status: BetaOnboardingStatus;
  step: BetaOnboardingStep;
  completedSteps: BetaOnboardingStep[];
  skippedSteps: BetaOnboardingStep[];
  groupId?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function timestamp(value: unknown, fallback: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function knownSteps(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<BetaOnboardingStep>();
  for (const item of value) {
    if (typeof item === "string" && (BETA_ONBOARDING_STEPS as readonly string[]).includes(item)) {
      unique.add(item as BetaOnboardingStep);
    }
  }
  return [...unique];
}

export function betaOnboardingStorageKey(userId: string) {
  return `the-backyard:beta-onboarding:v${BETA_ONBOARDING_VERSION}:${encodeURIComponent(userId)}`;
}

export function betaOnboardingDraftStorageKey(userId: string) {
  return `the-backyard:beta-onboarding-draft:v${BETA_ONBOARDING_VERSION}:${encodeURIComponent(userId)}`;
}

export function createBetaOnboardingProgress(userId: string, now = new Date().toISOString()): BetaOnboardingProgress {
  return {
    version: BETA_ONBOARDING_VERSION,
    userId,
    status: "in_progress",
    step: "ghin",
    completedSteps: [],
    skippedSteps: [],
    startedAt: now,
    updatedAt: now,
  };
}

export function normalizeBetaOnboardingProgress(
  value: unknown,
  userId: string,
  now = new Date().toISOString(),
): BetaOnboardingProgress | null {
  if (!value || typeof value !== "object" || !userId) return null;
  const candidate = value as Partial<BetaOnboardingProgress>;
  if (candidate.version !== BETA_ONBOARDING_VERSION || candidate.userId !== userId) return null;
  const step = typeof candidate.step === "string" && (BETA_ONBOARDING_STEPS as readonly string[]).includes(candidate.step)
    ? candidate.step as BetaOnboardingStep
    : "ghin";
  const status = candidate.status === "complete" || step === "complete" ? "complete" : "in_progress";
  const completedAt = status === "complete" ? timestamp(candidate.completedAt, timestamp(candidate.updatedAt, now)) : undefined;
  return {
    version: BETA_ONBOARDING_VERSION,
    userId,
    status,
    step: status === "complete" ? "complete" : step,
    completedSteps: knownSteps(candidate.completedSteps),
    skippedSteps: knownSteps(candidate.skippedSteps),
    ...(typeof candidate.groupId === "string" && candidate.groupId.trim() ? { groupId: candidate.groupId.trim().slice(0, 200) } : {}),
    startedAt: timestamp(candidate.startedAt, now),
    updatedAt: timestamp(candidate.updatedAt, now),
    ...(completedAt ? { completedAt } : {}),
  };
}

export function readBetaOnboardingProgress(storage: ReadableStorage, userId: string) {
  try {
    return normalizeBetaOnboardingProgress(JSON.parse(storage.getItem(betaOnboardingStorageKey(userId)) || "null"), userId);
  } catch {
    return null;
  }
}

export function persistBetaOnboardingProgress(storage: WritableStorage, progress: BetaOnboardingProgress) {
  storage.setItem(betaOnboardingStorageKey(progress.userId), JSON.stringify(progress));
  return progress;
}

export function advanceBetaOnboarding(
  progress: BetaOnboardingProgress,
  nextStep: BetaOnboardingStep,
  options: { skipped?: boolean; groupId?: string; now?: string } = {},
): BetaOnboardingProgress {
  if (progress.status === "complete") return progress;
  const currentIndex = BETA_ONBOARDING_STEPS.indexOf(progress.step);
  const nextIndex = BETA_ONBOARDING_STEPS.indexOf(nextStep);
  if (nextIndex < currentIndex || nextStep === "complete") return progress;
  const updatedAt = options.now ?? new Date().toISOString();
  const completedSteps = [...new Set([...progress.completedSteps, progress.step])];
  const skippedSteps = options.skipped
    ? [...new Set([...progress.skippedSteps, progress.step])]
    : progress.skippedSteps;
  return {
    ...progress,
    step: nextStep,
    completedSteps,
    skippedSteps,
    ...(options.groupId ? { groupId: options.groupId } : {}),
    updatedAt,
  };
}

export function completeBetaOnboarding(
  progress: BetaOnboardingProgress,
  options: { groupId?: string; now?: string } = {},
): BetaOnboardingProgress {
  const completedAt = options.now ?? new Date().toISOString();
  return {
    ...progress,
    status: "complete",
    step: "complete",
    completedSteps: [...new Set([...progress.completedSteps, progress.step, "complete"] as BetaOnboardingStep[])],
    ...(options.groupId ? { groupId: options.groupId } : {}),
    updatedAt: completedAt,
    completedAt,
  };
}

export function betaOnboardingIsActive(progress: BetaOnboardingProgress | null | undefined) {
  return Boolean(progress && progress.status === "in_progress" && progress.step !== "complete");
}
