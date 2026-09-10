export const MEMBERSHIP_PLAN_IDS = ["FREE", "PRO", "BETA_PRO"] as const;
export type MembershipPlanId = (typeof MEMBERSHIP_PLAN_IDS)[number];

export const MEMBERSHIP_CAPABILITIES = [
  "SCORING", "BASIC_STATS", "FRIENDS_SCORES", "ADVANCED_STATS", "INSIGHTS",
  "BASIC_GAMES", "ALL_GAMES", "MULTIPLE_GAMES", "PRESSES", "ADVANCED_GAME_CONFIG",
  "AI_ROUND_SETUP", "CARD_AI", "PERSONAL_AI", "MY_BAG", "BALL_FIT", "LAUNCH_MONITOR_AI",
  "BASIC_COURSE_INFO", "ADVANCED_GPS", "SHOT_TRACKING", "GROUPS", "ADVANCED_GROUPS",
  "MANUAL_INDEX", "COURSE_HANDICAP", "AUTHORIZED_HANDICAP_INTEGRATIONS",
] as const;
export type MembershipCapability = (typeof MEMBERSHIP_CAPABILITIES)[number];
export type EntitlementValue = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "FUTURE";
export type AllowanceWindow = "daily" | "monthly" | "lifetime";

export type FeatureAllowance = {
  limit: number | null;
  window: AllowanceWindow;
};

export type MembershipDefinition = {
  id: MembershipPlanId;
  label: string;
  betaOnly: boolean;
  capabilities: Readonly<Partial<Record<MembershipCapability, EntitlementValue>>>;
  allowances: Readonly<Partial<Record<MembershipCapability, FeatureAllowance>>>;
};

const allAvailable = Object.fromEntries(MEMBERSHIP_CAPABILITIES.map((capability) => [capability, "AVAILABLE"])) as Record<MembershipCapability, "AVAILABLE">;

export const MEMBERSHIP_DEFINITIONS: readonly MembershipDefinition[] = [
  {
    id: "FREE",
    label: "Free",
    betaOnly: false,
    capabilities: {
      SCORING: "AVAILABLE", BASIC_STATS: "AVAILABLE", FRIENDS_SCORES: "AVAILABLE",
      BASIC_GAMES: "AVAILABLE", AI_ROUND_SETUP: "LIMITED", CARD_AI: "LIMITED",
      MY_BAG: "AVAILABLE", BASIC_COURSE_INFO: "AVAILABLE", GROUPS: "AVAILABLE",
      MANUAL_INDEX: "AVAILABLE", COURSE_HANDICAP: "AVAILABLE",
    },
    allowances: {
      AI_ROUND_SETUP: { limit: 10, window: "monthly" },
      CARD_AI: { limit: 2, window: "monthly" },
    },
  },
  { id: "PRO", label: "Pro", betaOnly: false, capabilities: allAvailable, allowances: {} },
  { id: "BETA_PRO", label: "Beta Pro", betaOnly: true, capabilities: allAvailable, allowances: {} },
] as const;

export type UsageCounter = { used: number; window: AllowanceWindow; windowKey: string };

export function normalizeMembershipPlanId(value: unknown): MembershipPlanId {
  return typeof value === "string" && MEMBERSHIP_PLAN_IDS.includes(value as MembershipPlanId)
    ? value as MembershipPlanId
    : "BETA_PRO";
}

export function membershipDefinition(value: unknown) {
  const id = normalizeMembershipPlanId(value);
  return MEMBERSHIP_DEFINITIONS.find((definition) => definition.id === id) ?? MEMBERSHIP_DEFINITIONS[2];
}

export function membershipEntitlement(plan: unknown, capability: MembershipCapability): EntitlementValue {
  return membershipDefinition(plan).capabilities[capability] ?? "UNAVAILABLE";
}

export function featureAllowance(plan: unknown, capability: MembershipCapability): FeatureAllowance | null {
  const definition = membershipDefinition(plan);
  if (definition.id === "BETA_PRO") return { limit: null, window: "monthly" };
  return definition.allowances[capability] ?? (membershipEntitlement(plan, capability) === "AVAILABLE" ? { limit: null, window: "monthly" } : null);
}

export function canUseFeature(plan: unknown, capability: MembershipCapability, counter?: UsageCounter) {
  const entitlement = membershipEntitlement(plan, capability);
  if (entitlement === "UNAVAILABLE" || entitlement === "FUTURE") return false;
  const allowance = featureAllowance(plan, capability);
  if (!allowance || allowance.limit === null) return true;
  return (counter?.used ?? 0) < allowance.limit;
}

export function consumeAllowance(plan: unknown, capability: MembershipCapability, counter: UsageCounter): UsageCounter {
  if (!canUseFeature(plan, capability, counter)) return counter;
  const allowance = featureAllowance(plan, capability);
  if (!allowance || allowance.limit === null) return counter;
  return { ...counter, used: counter.used + 1 };
}

