export const PHASE2_FEATURE_FLAG_IDS = [
  "social_v2",
  "groups_v2",
  "course_search",
  "gps_v1",
  "shot_tracking_v1",
  "live_rounds",
  "live_leaderboard",
  "notifications_v1",
  "membership_ui",
  "advanced_stats_v2",
  "ai_insights",
  "equipment_v2",
  "score_export",
  "push_notifications",
  "wearable_v1",
  "rangefinder_v1",
  "admin_v1",
] as const;

export type Phase2FeatureFlagId = (typeof PHASE2_FEATURE_FLAG_IDS)[number];
export type FeatureFlagEnvironment = "development" | "preview" | "production" | "test";

export type FeatureFlagDefinition = {
  id: Phase2FeatureFlagId;
  description: string;
  previewDefault: boolean;
  productionDefault: boolean;
  externalDependency?: string;
};

const internal = (id: Phase2FeatureFlagId, description: string): FeatureFlagDefinition => ({
  id,
  description,
  previewDefault: true,
  productionDefault: false,
});

const external = (id: Phase2FeatureFlagId, description: string, externalDependency: string): FeatureFlagDefinition => ({
  id,
  description,
  previewDefault: false,
  productionDefault: false,
  externalDependency,
});

export const PHASE2_FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  internal("social_v2", "Amistades, búsqueda privada y jugadores recientes."),
  internal("groups_v2", "Grupos con roles, invitaciones, memoria y plantillas."),
  internal("course_search", "Búsqueda paginada mediante CourseCatalogProvider."),
  internal("gps_v1", "Distancias y contexto de hoyo con fallback no bloqueante."),
  internal("shot_tracking_v1", "Registro opcional de golpes del jugador principal."),
  internal("live_rounds", "Sincronización versionada de rondas autorizadas."),
  internal("live_leaderboard", "Scoreboard provisional y leaderboard privado."),
  internal("notifications_v1", "Eventos y preferencias de notificaciones internas."),
  internal("membership_ui", "Beneficios Free/Pro sin cobro ni paywall Beta."),
  internal("advanced_stats_v2", "Estadísticas avanzadas, filtros y tendencias."),
  internal("ai_insights", "Explicación AI sobre agregados estructurados."),
  internal("equipment_v2", "Catálogo y bolsa provider-based."),
  external("score_export", "Exportación a un proveedor autorizado.", "Proveedor de handicap/export autorizado"),
  external("push_notifications", "Entrega push PWA.", "VAPID y proveedor push"),
  external("wearable_v1", "Integración con smartwatch.", "SDK de wearable"),
  external("rangefinder_v1", "Integración con rangefinder.", "SDK/API de rangefinder"),
  internal("admin_v1", "Métricas agregadas con autorización explícita."),
] as const;

export type FeatureFlagOverrides = Partial<Record<Phase2FeatureFlagId, boolean>>;

export function featureFlagEnvironment(value: string | undefined): FeatureFlagEnvironment {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "production") return "production";
  if (normalized === "test") return "test";
  if (normalized === "development") return "development";
  return "preview";
}

export function resolvePhase2FeatureFlags(
  environment: FeatureFlagEnvironment,
  overrides: FeatureFlagOverrides = {},
): Readonly<Record<Phase2FeatureFlagId, boolean>> {
  return Object.fromEntries(PHASE2_FEATURE_FLAGS.map((definition) => {
    const fallback = environment === "production" ? definition.productionDefault : definition.previewDefault;
    return [definition.id, overrides[definition.id] ?? fallback];
  })) as Record<Phase2FeatureFlagId, boolean>;
}

export function phase2FeatureEnabled(
  id: Phase2FeatureFlagId,
  flags: Readonly<Record<Phase2FeatureFlagId, boolean>>,
) {
  return flags[id] === true;
}

export function parseFeatureFlagOverrides(source: Record<string, string | undefined>): FeatureFlagOverrides {
  const overrides: FeatureFlagOverrides = {};
  for (const id of PHASE2_FEATURE_FLAG_IDS) {
    const value = source[`NEXT_PUBLIC_BACKYARD_${id.toUpperCase()}`];
    if (value === undefined || value.trim() === "") continue;
    overrides[id] = ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
  }
  return overrides;
}

