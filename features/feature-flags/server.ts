import "server-only";
import { featureFlagEnvironment, parseFeatureFlagOverrides, resolvePhase2FeatureFlags } from "./registry";

export function serverPhase2FeatureFlags() {
  const environment = featureFlagEnvironment(process.env.VERCEL_ENV || process.env.NODE_ENV);
  return resolvePhase2FeatureFlags(environment, parseFeatureFlagOverrides(process.env));
}

