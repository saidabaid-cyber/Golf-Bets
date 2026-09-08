export const BACKYARD_AI_PROVIDER_CONSENT_VERSION = "2026-09-08-v1";

export type BackyardAiProviderConsent = {
  granted: true;
  version: typeof BACKYARD_AI_PROVIDER_CONSENT_VERSION;
};

/** The API requires an affirmative, versioned assertion in addition to the UI gate. */
export function parseBackyardAiProviderConsent(value: unknown): BackyardAiProviderConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || source.granted !== true || source.version !== BACKYARD_AI_PROVIDER_CONSENT_VERSION) return null;
  return { granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION };
}

export function backyardAiProviderConsent(): BackyardAiProviderConsent {
  return { granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION };
}
