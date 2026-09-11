export const PLAN_IDS = ["free", "silver", "gold", "black"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const FEATURE_IDS = [
  "score",
  "basic_bets",
  "basic_groups",
  "basic_stats",
  "extended_history",
  "advanced_stats",
  "multiple_groups",
  "game_tools",
  "coach_ai",
  "game_diagnosis",
  "recommendations",
  "personalized_training",
  "advanced_analysis",
  "expanded_coach_ai",
  "future_video_analysis",
  "premium_insights",
  "caddie_ai",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];
export type PlanAvailability = "available" | "coming_soon";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  eyebrow: string;
  description: string;
  availability: PlanAvailability;
  features: readonly FeatureId[];
};

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "GRATIS",
    eyebrow: "PARA EMPEZAR",
    description: "Score, apuestas básicas, un grupo habitual y estadísticas esenciales.",
    availability: "available",
    features: ["score", "basic_bets", "basic_groups", "basic_stats"],
  },
  {
    id: "silver",
    name: "PLATA",
    eyebrow: "MÁS HISTORIA",
    description: "Histórico más completo, estadísticas avanzadas y más herramientas de juego.",
    availability: "coming_soon",
    features: [
      "score", "basic_bets", "basic_groups", "basic_stats", "extended_history",
      "advanced_stats", "multiple_groups", "game_tools",
    ],
  },
  {
    id: "gold",
    name: "ORO",
    eyebrow: "MEJORA TU JUEGO",
    description: "Coach AI, diagnóstico, objetivos, recomendaciones y entrenamiento personalizado.",
    availability: "coming_soon",
    features: [
      "score", "basic_bets", "basic_groups", "basic_stats", "extended_history",
      "advanced_stats", "multiple_groups", "game_tools", "coach_ai", "game_diagnosis",
      "recommendations", "personalized_training",
    ],
  },
  {
    id: "black",
    name: "BLACK",
    eyebrow: "MÁXIMO NIVEL",
    description: "Análisis avanzado, mayor acceso al Coach AI e insights premium.",
    availability: "coming_soon",
    features: [...FEATURE_IDS],
  },
] as const;

export function normalizePlanId(value: unknown): PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
    ? value as PlanId
    : "free";
}

export function planDefinition(value: unknown) {
  const id = normalizePlanId(value);
  return PLAN_CATALOG.find((plan) => plan.id === id) ?? PLAN_CATALOG[0];
}

export function planHasFeature(plan: unknown, feature: FeatureId) {
  return planDefinition(plan).features.includes(feature);
}

/** Beta never starts a paid entitlement or invents a checkout. */
export function selectablePlanId(requested: unknown): PlanId {
  const plan = planDefinition(requested);
  return plan.availability === "available" ? plan.id : "free";
}
