/**
 * Phase 2-ready entitlement vocabulary. Nothing in Phase 1 reads this module
 * to hide or block a feature: every Beta tester remains unrestricted.
 */
export const MEMBERSHIP_PLAN_IDS = ["FREE", "PRO", "BETA_PRO"] as const;
export type MembershipPlanId = (typeof MEMBERSHIP_PLAN_IDS)[number];

export const MEMBERSHIP_CAPABILITIES = [
  "SCORING",
  "BASIC_STATS",
  "FRIENDS_SCORES",
  "ADVANCED_STATS",
  "INSIGHTS",
  "BASIC_GAMES",
  "ALL_GAMES",
  "MULTIPLE_GAMES",
  "PRESSES",
  "ADVANCED_GAME_CONFIG",
  "AI_ROUND_SETUP",
  "CARD_AI",
  "PERSONAL_AI",
  "MY_BAG",
  "BALL_FIT",
  "LAUNCH_MONITOR_AI",
  "BASIC_COURSE_INFO",
  "ADVANCED_GPS",
  "MANUAL_INDEX",
  "COURSE_HANDICAP",
  "AUTHORIZED_HANDICAP_INTEGRATIONS",
] as const;
export type MembershipCapability = (typeof MEMBERSHIP_CAPABILITIES)[number];

export type EntitlementValue = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "FUTURE";

export type MembershipDefinition = {
  id: MembershipPlanId;
  label: string;
  betaOnly: boolean;
  capabilities: Readonly<Partial<Record<MembershipCapability, EntitlementValue>>>;
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
      MY_BAG: "AVAILABLE", BASIC_COURSE_INFO: "AVAILABLE", MANUAL_INDEX: "AVAILABLE",
      COURSE_HANDICAP: "AVAILABLE",
    },
  },
  { id: "PRO", label: "Pro", betaOnly: false, capabilities: allAvailable },
  { id: "BETA_PRO", label: "Beta Pro", betaOnly: true, capabilities: allAvailable },
] as const;

export function normalizeMembershipPlanId(value: unknown): MembershipPlanId {
  return typeof value === "string" && MEMBERSHIP_PLAN_IDS.includes(value as MembershipPlanId)
    ? value as MembershipPlanId
    : "BETA_PRO";
}

export function membershipEntitlement(plan: unknown, capability: MembershipCapability): EntitlementValue {
  const selected = MEMBERSHIP_DEFINITIONS.find((definition) => definition.id === normalizeMembershipPlanId(plan));
  return selected?.capabilities[capability] ?? "UNAVAILABLE";
}
