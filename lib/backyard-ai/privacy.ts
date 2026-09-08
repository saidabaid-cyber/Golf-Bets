export const BACKYARD_AI_PROVIDER_CONSENT_VERSION = "2026-09-08-v2";

export const AI_PROVIDER_PROCESSING_CONSENT = "AI_PROVIDER_PROCESSING_CONSENT" as const;
export const AI_IMAGE_PROCESSING_CONSENT = "AI_IMAGE_PROCESSING_CONSENT" as const;

export type BackyardAiProcessingConsentScope =
  | typeof AI_PROVIDER_PROCESSING_CONSENT
  | typeof AI_IMAGE_PROCESSING_CONSENT;

export type BackyardAiProviderConsent = {
  granted: true;
  version: typeof BACKYARD_AI_PROVIDER_CONSENT_VERSION;
  scope: BackyardAiProcessingConsentScope;
};

/** The API requires an affirmative, versioned assertion in addition to the UI gate. */
export function parseBackyardAiProviderConsent(
  value: unknown,
  expectedScope: BackyardAiProcessingConsentScope,
): BackyardAiProviderConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).length !== 3
    || source.granted !== true
    || source.version !== BACKYARD_AI_PROVIDER_CONSENT_VERSION
    || source.scope !== expectedScope
  ) return null;
  return { granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope: expectedScope };
}

export function backyardAiProviderConsent(
  scope: BackyardAiProcessingConsentScope = AI_PROVIDER_PROCESSING_CONSENT,
): BackyardAiProviderConsent {
  return { granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope };
}
