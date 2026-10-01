import { createHash } from "node:crypto";
import { legalEvidenceDefinition } from "./legal-evidence";

/** Server-derived individual envelopes; a retry reuses both purpose keys. */
export function optionalBundleLegalEvidence(action: "authorize_all" | "decline_all", requestId: string, at = new Date().toISOString()) {
  const legalAction = action === "authorize_all" ? "accepted" : "rejected";
  return (["financial_data", "marketing"] as const).map((subject) => {
    const definition = legalEvidenceDefinition(subject, legalAction)!;
    const digest = createHash("sha256").update(`optional-bundle-v2:${requestId.toLowerCase()}:${subject}`).digest("hex");
    const idempotencyKey = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return {
      subject, action: legalAction, documentKey: definition.documentKey,
      documentVersion: definition.version, documentHash: definition.documentHash,
      statementKey: `${subject}.${legalAction}.${definition.version}`,
      statementText: definition.statement, statementHash: definition.statementHash,
      locale: "es-MX", origin: "onboarding", clientOccurredAt: at, idempotencyKey,
    };
  });
}
