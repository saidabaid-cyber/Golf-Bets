import {
  AI_IMAGE_PROCESSING_CONSENT,
  AI_LAUNCH_MONITOR_PROCESSING_CONSENT,
  AI_PROVIDER_PROCESSING_CONSENT,
  type BackyardAiProcessingConsentScope,
} from "./privacy";

export const AI_PROCESSING_CONSENT_SCOPES: readonly BackyardAiProcessingConsentScope[] = [
  AI_PROVIDER_PROCESSING_CONSENT,
  AI_IMAGE_PROCESSING_CONSENT,
  AI_LAUNCH_MONITOR_PROCESSING_CONSENT,
];
const CONSENT_SCOPES = new Set(AI_PROCESSING_CONSENT_SCOPES);

export const AI_PROCESSING_CONSENT_TABLE = "ai_processing_consents" as const;
export const AI_PROCESSING_CONSENT_DECISIONS_RPC = "record_ai_processing_consent_decisions" as const;

export type AiConsentDecisionStatus = "accepted" | "declined" | "revoked" | "missing";
export type AiConsentDecisionSource = "onboarding" | "account_update" | "settings" | "legacy";
export type AiConsentDecisionInput = { scope: BackyardAiProcessingConsentScope; accepted: boolean };
export type AiConsentCheckpointSource = "onboarding" | "account_update";

export type AiProcessingConsentRow = {
  id: number;
  scope: BackyardAiProcessingConsentScope;
  policy_version: string;
  accepted_at: string | null;
  revoked_at: string | null;
  decision_status: Exclude<AiConsentDecisionStatus, "missing">;
  source: AiConsentDecisionSource;
  decided_at: string;
};

export function parseAiProcessingConsentScope(value: unknown): BackyardAiProcessingConsentScope | null {
  return CONSENT_SCOPES.has(value as BackyardAiProcessingConsentScope)
    ? value as BackyardAiProcessingConsentScope
    : null;
}
