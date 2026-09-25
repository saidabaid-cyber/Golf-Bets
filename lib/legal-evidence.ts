import { LEGAL_DOCUMENTS } from "./legal-documents";

export type LegalEvidenceSubject =
  | "privacy_notice"
  | "terms"
  | "age_declaration"
  | "financial_data"
  | "marketing";

export type LegalEvidenceAction = "presented" | "accepted" | "rejected" | "revoked";

type LegalEvidenceDefinition = {
  documentKey: keyof typeof LEGAL_DOCUMENTS;
  version: string;
  documentHash: string;
  allowedActions: readonly LegalEvidenceAction[];
  statements: Partial<Record<LegalEvidenceAction, string>>;
  statementHashes: Partial<Record<LegalEvidenceAction, string>>;
};

/**
 * Immutable, versioned ceremony text. The client echoes this complete canonical
 * envelope and the server re-derives it before insert; any version, wording or
 * hash mismatch is rejected instead of upgrading historical evidence.
 */
export const LEGAL_EVIDENCE_DEFINITIONS: Record<LegalEvidenceSubject, LegalEvidenceDefinition> = {
  privacy_notice: {
    documentKey: "privacy_simplified",
    version: LEGAL_DOCUMENTS.privacy_simplified.version,
    documentHash: LEGAL_DOCUMENTS.privacy_simplified.contentHash,
    allowedActions: ["presented"],
    statements: {
      presented: "Se me presentó el Aviso de Privacidad Simplificado y tuve acceso al Aviso de Privacidad Integral, versión 2026-09-08-v6.",
    },
    statementHashes: {
      presented: "6ed32114df4a74b4dea1da41dd2b38fb7c0dd08bb0cd393bb3015c0851839ca5",
    },
  },
  terms: {
    documentKey: "terms",
    version: LEGAL_DOCUMENTS.terms.version,
    documentHash: LEGAL_DOCUMENTS.terms.contentHash,
    allowedActions: ["accepted", "rejected", "revoked"],
    statements: {
      accepted: "He leído y acepto los Términos y Condiciones de Uso, versión 2026-09-08-v2.",
      rejected: "No acepto los Términos y Condiciones de Uso, versión 2026-09-08-v2.",
      revoked: "Revoco mi aceptación de los Términos y Condiciones de Uso, versión 2026-09-08-v2, sin efectos retroactivos.",
    },
    statementHashes: {
      accepted: "7cc5eaf33c2d2e774233c3ed3affbd7d98a52c876d85428191fadfb2ea87cb00",
      rejected: "828be73e0ed7690ba7ca9458fe6e395ab59729f67e6d7fb9f115e184266ce0ba",
      revoked: "c603283665c6475ac58d88a93cadb75e242942167681884d1bfd6ffb30d8791b",
    },
  },
  age_declaration: {
    documentKey: "terms",
    version: LEGAL_DOCUMENTS.terms.version,
    documentHash: LEGAL_DOCUMENTS.terms.contentHash,
    allowedActions: ["accepted", "rejected", "revoked"],
    statements: {
      accepted: "Declaro expresamente que tengo 18 años o más. Entiendo que esta declaración no constituye verificación documental de edad.",
      rejected: "No declaro tener 18 años o más.",
      revoked: "Retiro mi declaración de mayoría de edad, sin efectos retroactivos.",
    },
    statementHashes: {
      accepted: "27aadb7dee198eed11aa3ca04d4abfab1e7294761becff07b486c4f4032e173f",
      rejected: "4042964b932f449771317a533dcf4f01e072dd608f7d07d5d6b9d8fca362fcd5",
      revoked: "3f40a845590f1f7f4fe183ab3cf0b73ee6bb1ded8e416ddb22143cfd22e43136",
    },
  },
  financial_data: {
    documentKey: "privacy_integral",
    version: LEGAL_DOCUMENTS.privacy_integral.version,
    documentHash: LEGAL_DOCUMENTS.privacy_integral.contentHash,
    allowedActions: ["accepted", "rejected", "revoked"],
    statements: {
      accepted: "Consiento expresamente el tratamiento de datos financieros o patrimoniales necesario para registrar apuestas privadas, saldos, gastos y resultados económicos.",
      rejected: "No consiento el tratamiento de datos financieros o patrimoniales para apuestas privadas, saldos, gastos y resultados económicos.",
      revoked: "Revoco mi consentimiento para el tratamiento de datos financieros o patrimoniales, sin efectos retroactivos.",
    },
    statementHashes: {
      accepted: "41ddb7fa9e2c2332eb320f32dcede6158493a18ad0f61a6d8fb0ed787a25a620",
      rejected: "02c6e0ce2b40157048f3cf57502eaaca8cd04a2b288cafc6b87da30709e2329d",
      revoked: "a3fe0588b5cc0b5ba7fb1ba5b809844787e770b1f7bf6866292fb5079a33f1ce",
    },
  },
  marketing: {
    documentKey: "privacy_integral",
    version: LEGAL_DOCUMENTS.privacy_integral.version,
    documentHash: LEGAL_DOCUMENTS.privacy_integral.contentHash,
    allowedActions: ["accepted", "rejected", "revoked"],
    statements: {
      accepted: "Consiento recibir comunicaciones promocionales de The Backyard. Esta elección es opcional.",
      rejected: "No consiento recibir comunicaciones promocionales de The Backyard.",
      revoked: "Revoco mi consentimiento para recibir comunicaciones promocionales, sin efectos retroactivos.",
    },
    statementHashes: {
      accepted: "3270203a4cd4b19b720d6876c637115d1eb7fd5f0febef64a19988a7c9b2cce0",
      rejected: "b69273f6e3ae17383a0beba18b8dbdedc0078e8a572456dac7a244b19a89f22c",
      revoked: "d2976d844ed1a7c75b8dd126e2da0be28654c95e9d27d5809f392e02e3a09823",
    },
  },
};

export function legalEvidenceDefinition(subject: LegalEvidenceSubject, action: LegalEvidenceAction) {
  const definition = LEGAL_EVIDENCE_DEFINITIONS[subject];
  if (!definition.allowedActions.includes(action)) return null;
  const statement = definition.statements[action];
  const statementHash = definition.statementHashes[action];
  if (!statement || !statementHash) return null;
  return { ...definition, statement, statementHash };
}

export function isLegalEvidenceSubject(value: unknown): value is LegalEvidenceSubject {
  return typeof value === "string" && Object.hasOwn(LEGAL_EVIDENCE_DEFINITIONS, value);
}

export function isLegalEvidenceAction(value: unknown): value is LegalEvidenceAction {
  return value === "presented" || value === "accepted" || value === "rejected" || value === "revoked";
}
