import { validateCanonicalRoundCommand, type CanonicalCommandIntegrityIssueCode } from "./canonical-command-guard";
import { parseRoundSetupIntent } from "./intent-parser";

export type RoundSetupAiResponse = {
  canonicalCommand: string;
  confidence: number;
  clarification: string | null;
  mode: "AI_PROVIDER_CANONICAL" | "SAFE_LOCAL_FALLBACK";
  integrityIssueCodes: CanonicalCommandIntegrityIssueCode[];
};

/** Schema errors remain explicit; an untrusted rewrite never reaches setup. */
export function resolveRoundSetupProvider(
  original: string,
  value: unknown,
  local = parseRoundSetupIntent(original),
): { ok: true; response: RoundSetupAiResponse } | { ok: false; code: "invalid_interpretation" } {
  const invalid = { ok: false, code: "invalid_interpretation" } as const;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["canonicalCommand", "confidence", "clarification"].includes(key))) return invalid;
  const command = typeof source.canonicalCommand === "string" ? source.canonicalCommand.trim() : "";
  const { confidence, clarification } = source;
  if (!command || command.length > 2_400 || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return invalid;
  if (clarification !== null && (typeof clarification !== "string" || !clarification.trim() || clarification.trim().length > 300)) return invalid;
  const integrity = validateCanonicalRoundCommand(original, command);
  if (!integrity.ok) {
    return { ok: true, response: {
      canonicalCommand: original,
      confidence: local.confidence,
      // The rejected provider's question may also contain invented facts.
      // The existing deterministic planner owns all fallback clarifications.
      clarification: null,
      mode: "SAFE_LOCAL_FALLBACK",
      integrityIssueCodes: integrity.issues.map((issue) => issue.code),
    } };
  }
  return { ok: true, response: {
    canonicalCommand: integrity.command,
    confidence,
    clarification: typeof clarification === "string" ? clarification.trim() : null,
    mode: "AI_PROVIDER_CANONICAL",
    integrityIssueCodes: [],
  } };
}
