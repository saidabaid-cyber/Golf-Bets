import {
  AI_IMAGE_PROCESSING_CONSENT,
  AI_PROVIDER_PROCESSING_CONSENT,
  type BackyardAiProcessingConsentScope,
} from "./privacy";

const CONSENT_SCOPES = new Set<BackyardAiProcessingConsentScope>([
  AI_PROVIDER_PROCESSING_CONSENT,
  AI_IMAGE_PROCESSING_CONSENT,
]);

export const AI_PROCESSING_CONSENT_TABLE = "ai_processing_consents" as const;

export function parseAiProcessingConsentScope(value: unknown): BackyardAiProcessingConsentScope | null {
  return CONSENT_SCOPES.has(value as BackyardAiProcessingConsentScope)
    ? value as BackyardAiProcessingConsentScope
    : null;
}
