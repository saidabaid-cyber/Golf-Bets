import { boundedConfidence, cleanMemoryId, isJsonValue, validIsoDate } from "../memory/types";
import type {
  KnowledgeAudit,
  KnowledgeItem,
  KnowledgeProvenance,
  KnowledgeSource,
  KnowledgeValidationIssue,
} from "./knowledge-types";

function issue(
  code: KnowledgeValidationIssue["code"],
  message: string,
  field?: string,
): KnowledgeValidationIssue {
  return { code, message, ...(field ? { field } : {}) };
}

export function sourceTrustRank(sourceType: KnowledgeSource["sourceType"]) {
  switch (sourceType) {
    case "OFFICIAL": return 5;
    case "VERIFIED": return 4;
    case "COMMUNITY": return 3;
    case "USER_PROVIDED": return 2;
    case "INFERRED": return 1;
  }
}

export function knowledgeProvenance(source: KnowledgeSource): KnowledgeProvenance {
  return {
    sourceId: source.id,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    sourceUrlOrIdentifier: source.sourceUrlOrIdentifier,
    retrievedAt: source.retrievedAt,
    ...(source.verifiedAt ? { verifiedAt: source.verifiedAt } : {}),
    confidence: source.confidence,
    jurisdiction: source.jurisdiction,
    version: source.version,
    usageRights: source.usageRights,
    ...(source.contentDigest ? { contentDigest: source.contentDigest } : {}),
  };
}

export function validateKnowledgeSource(source: KnowledgeSource): KnowledgeValidationIssue[] {
  const issues: KnowledgeValidationIssue[] = [];
  if (
    source.schemaVersion !== 1
    || !new Set(["OFFICIAL", "VERIFIED", "COMMUNITY", "USER_PROVIDED", "INFERRED"]).has(source.sourceType)
    || !new Set(["GLOBAL", "PERSONAL", "GROUP"]).has(source.scope)
    || !new Set(["ALLOWED", "RESTRICTED", "UNKNOWN"]).has(source.usageRights)
    || typeof source.active !== "boolean"
  ) issues.push(issue("INVALID_RECORD", "La clasificación, el alcance o los derechos de la fuente no son válidos."));
  if (!cleanMemoryId(source.id) || !cleanMemoryId(source.sourceName) || !cleanMemoryId(source.sourceUrlOrIdentifier)) {
    issues.push(issue("INVALID_ID", "La fuente necesita id, nombre e identificador de procedencia.", "source"));
  }
  if (!cleanMemoryId(source.jurisdiction, 80) || !cleanMemoryId(source.version, 80)) {
    issues.push(issue("MISSING_PROVENANCE", "La fuente necesita jurisdicción y versión.", "jurisdiction"));
  }
  if (!validIsoDate(source.retrievedAt)) issues.push(issue("INVALID_DATE", "retrievedAt no es una fecha válida.", "retrievedAt"));
  if (source.verifiedAt !== undefined && !validIsoDate(source.verifiedAt)) {
    issues.push(issue("INVALID_DATE", "verifiedAt no es una fecha válida.", "verifiedAt"));
  }
  if (boundedConfidence(source.confidence) === null) {
    issues.push(issue("INVALID_CONFIDENCE", "La confianza debe estar entre 0 y 1.", "confidence"));
  }
  if ((source.sourceType === "OFFICIAL" || source.sourceType === "VERIFIED") && !source.verifiedAt) {
    issues.push(issue("MISSING_VERIFICATION", "Una fuente oficial o verificada necesita verifiedAt.", "verifiedAt"));
  }
  if (source.scope === "PERSONAL" && !cleanMemoryId(source.ownerId)) {
    issues.push(issue("SCOPE_MISMATCH", "Una fuente personal necesita ownerId.", "ownerId"));
  }
  if (source.scope === "GROUP" && (!cleanMemoryId(source.ownerId) || !cleanMemoryId(source.groupId))) {
    issues.push(issue("SCOPE_MISMATCH", "Una fuente de grupo necesita ownerId y groupId en Phase 1.", "groupId"));
  }
  if (source.scope === "GLOBAL" && (source.ownerId || source.groupId)) {
    issues.push(issue("SCOPE_MISMATCH", "Una fuente global no puede contener ids personales.", "scope"));
  }
  return issues;
}

export function validateKnowledgeItem(item: KnowledgeItem, source?: KnowledgeSource): KnowledgeValidationIssue[] {
  const issues: KnowledgeValidationIssue[] = [];
  if (
    item.schemaVersion !== 1
    || !new Set(["RULE", "GAME", "GAME_VARIANT", "COURSE", "TEE", "EQUIPMENT", "DEFINITION", "LOCAL_RULE", "OTHER"]).has(item.kind)
    || !new Set(["GLOBAL", "PERSONAL", "GROUP"]).has(item.scope)
    || !new Set(["DRAFT", "VERIFIED", "RETIRED"]).has(item.status)
    || !Array.isArray(item.aliases)
    || item.aliases.some((alias) => typeof alias !== "string" || alias.length > 240)
    || !isJsonValue(item.content)
  ) issues.push(issue("INVALID_RECORD", "El tipo, alcance, estado o contenido del elemento no es válido."));
  if (!cleanMemoryId(item.id) || !cleanMemoryId(item.sourceId) || !cleanMemoryId(item.title)) {
    issues.push(issue("INVALID_ID", "El conocimiento necesita id, sourceId y título.", "id"));
  }
  if (!cleanMemoryId(item.locale, 32) || !cleanMemoryId(item.jurisdiction, 80) || !cleanMemoryId(item.version, 80)) {
    issues.push(issue("MISSING_PROVENANCE", "El elemento necesita locale, jurisdicción y versión.", "locale"));
  }
  if (boundedConfidence(item.confidence) === null) {
    issues.push(issue("INVALID_CONFIDENCE", "La confianza debe estar entre 0 y 1.", "confidence"));
  }
  if (!validIsoDate(item.createdAt) || !validIsoDate(item.updatedAt)) {
    issues.push(issue("INVALID_DATE", "Las fechas del elemento no son válidas.", "createdAt"));
  }
  if (item.validFrom && !validIsoDate(item.validFrom)) issues.push(issue("INVALID_DATE", "validFrom no es válida.", "validFrom"));
  if (item.validUntil && !validIsoDate(item.validUntil)) issues.push(issue("INVALID_DATE", "validUntil no es válida.", "validUntil"));
  if (item.validFrom && item.validUntil && item.validFrom > item.validUntil) {
    issues.push(issue("INVALID_VALIDITY_WINDOW", "validFrom debe ser anterior a validUntil.", "validUntil"));
  }
  if (item.scope === "PERSONAL" && !cleanMemoryId(item.ownerId)) {
    issues.push(issue("SCOPE_MISMATCH", "Un elemento personal necesita ownerId.", "ownerId"));
  }
  if (item.scope === "GROUP" && (!cleanMemoryId(item.ownerId) || !cleanMemoryId(item.groupId))) {
    issues.push(issue("SCOPE_MISMATCH", "Un elemento de grupo necesita ownerId y groupId en Phase 1.", "groupId"));
  }
  if (item.scope === "GLOBAL" && (item.ownerId || item.groupId)) {
    issues.push(issue("SCOPE_MISMATCH", "Un elemento global no puede contener ids personales.", "scope"));
  }
  if (!source) {
    issues.push(issue("MISSING_PROVENANCE", "No se encontró la fuente del elemento.", "sourceId"));
  } else {
    if (item.sourceId !== source.id || item.scope !== source.scope) {
      issues.push(issue("SOURCE_MISMATCH", "El elemento y su fuente no comparten id y alcance.", "sourceId"));
    }
    if (item.ownerId !== source.ownerId || item.groupId !== source.groupId) {
      issues.push(issue("SCOPE_MISMATCH", "Los ids de alcance no coinciden con la fuente.", "scope"));
    }
  }
  return issues;
}

export function auditKnowledgeItem(item: KnowledgeItem, source?: KnowledgeSource): KnowledgeAudit {
  const issues = [
    ...(source ? validateKnowledgeSource(source) : []),
    ...validateKnowledgeItem(item, source),
  ];
  return {
    valid: issues.length === 0,
    issues,
    ...(source ? { provenance: knowledgeProvenance(source) } : {}),
  };
}
