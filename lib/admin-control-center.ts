export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "COURSE_ADMIN",
  "CATALOG_ADMIN",
  "COMPETITION_ADMIN",
  "SUPPORT_ADMIN",
  "CONTENT_ADMIN",
] as const;

export const ADMIN_SCOPE_TYPES = ["GLOBAL", "COURSE", "COMPETITION", "CATALOG"] as const;
export const ADMIN_PUBLICATION_STATES = ["DRAFT", "REVIEWED", "VERIFIED", "PUBLISHED", "SUPERSEDED", "ARCHIVED"] as const;
export const PROVENANCE_STATES = ["REPORTED", "REVIEWED", "VERIFIED"] as const;
export const ADMIN_ENTITY_TYPES = [
  "COURSE",
  "COURSE_CONFIGURATION",
  "LOCAL_RULE_SET",
  "CLUB_EQUIPMENT",
  "BALL",
  "SHAFT",
  "EQUIPMENT_IMAGE",
  "COMPETITION",
  "COMPETITION_RULE_SET",
  "REQUEST",
  "IMPORT",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminScopeType = (typeof ADMIN_SCOPE_TYPES)[number];
export type AdminPublicationState = (typeof ADMIN_PUBLICATION_STATES)[number];
export type ProvenanceState = (typeof PROVENANCE_STATES)[number];
export type AdminEntityType = (typeof ADMIN_ENTITY_TYPES)[number];

export type AdminMembership = {
  userId: string;
  role: AdminRole;
  scopeType: AdminScopeType;
  scopeId: string | null;
  active: boolean;
};

export type AdminTarget = {
  entityType: AdminEntityType;
  scopeType: AdminScopeType;
  scopeId: string | null;
};

export type AdminAction = "READ" | "CREATE_DRAFT" | "REVIEW" | "VERIFY" | "PUBLISH" | "ARCHIVE" | "AUDIT";

const ROLE_ENTITIES: Record<Exclude<AdminRole, "SUPER_ADMIN">, readonly AdminEntityType[]> = {
  COURSE_ADMIN: ["COURSE", "COURSE_CONFIGURATION", "LOCAL_RULE_SET", "IMPORT"],
  CATALOG_ADMIN: ["CLUB_EQUIPMENT", "BALL", "SHAFT", "EQUIPMENT_IMAGE", "IMPORT"],
  COMPETITION_ADMIN: ["COMPETITION", "COMPETITION_RULE_SET", "COURSE_CONFIGURATION"],
  SUPPORT_ADMIN: ["REQUEST"],
  CONTENT_ADMIN: ["LOCAL_RULE_SET", "COMPETITION_RULE_SET", "EQUIPMENT_IMAGE"],
};

function scopeMatches(membership: AdminMembership, target: AdminTarget) {
  if (membership.scopeType === "GLOBAL") return true;
  if (membership.scopeType !== target.scopeType) return false;
  return Boolean(membership.scopeId && target.scopeId && membership.scopeId === target.scopeId);
}

/** Server and tests share this rule, but the database remains the final authority. */
export function membershipAllows(membership: AdminMembership, target: AdminTarget, action: AdminAction) {
  if (!membership.active) return false;
  if (membership.role === "SUPER_ADMIN") return membership.scopeType === "GLOBAL";
  if (!ROLE_ENTITIES[membership.role].includes(target.entityType)) return false;
  if (!scopeMatches(membership, target)) return false;
  if (membership.role === "SUPPORT_ADMIN") return action === "READ" || action === "CREATE_DRAFT";
  if (action === "PUBLISH") {
    return membership.role === "COURSE_ADMIN"
      || membership.role === "CATALOG_ADMIN"
      || membership.role === "COMPETITION_ADMIN"
      || membership.role === "CONTENT_ADMIN";
  }
  return true;
}

const NEXT_STATES: Record<AdminPublicationState, readonly AdminPublicationState[]> = {
  DRAFT: ["REVIEWED", "ARCHIVED"],
  REVIEWED: ["DRAFT", "VERIFIED", "ARCHIVED"],
  VERIFIED: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["SUPERSEDED", "ARCHIVED"],
  SUPERSEDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionPublication(from: AdminPublicationState, to: AdminPublicationState) {
  return NEXT_STATES[from].includes(to);
}

export type PublicationEvidence = {
  sourceType: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  provenanceState: ProvenanceState;
};

export function validatePublicationEvidence(evidence: PublicationEvidence) {
  const errors: string[] = [];
  if (evidence.provenanceState !== "VERIFIED") errors.push("La procedencia debe estar verificada.");
  if (!evidence.sourceType?.trim()) errors.push("Falta el tipo de fuente.");
  if (!evidence.sourceName?.trim()) errors.push("Falta el nombre de la fuente.");
  if (!evidence.verifiedAt || Number.isNaN(Date.parse(evidence.verifiedAt))) errors.push("Falta una fecha de verificación válida.");
  if (evidence.sourceUrl) {
    try {
      if (new URL(evidence.sourceUrl).protocol !== "https:") errors.push("La URL de fuente debe usar HTTPS.");
    } catch {
      errors.push("La URL de fuente no es válida.");
    }
  }
  return errors;
}

export function normalizeCatalogIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLocaleLowerCase("es-MX");
}

export type EquipmentIdentity = {
  brand: string;
  model: string;
  generation?: string | null;
  year?: number | null;
  categoryOrUsage?: string | null;
};

export function equipmentIdentityKey(value: EquipmentIdentity) {
  return [value.brand, value.model, value.generation, value.year ?? "", value.categoryOrUsage]
    .map(normalizeCatalogIdentity)
    .join("|");
}

export function possibleEquipmentDuplicates<T extends EquipmentIdentity>(candidate: EquipmentIdentity, existing: readonly T[]) {
  const key = equipmentIdentityKey(candidate);
  return existing.filter((item) => equipmentIdentityKey(item) === key);
}

export type ScheduledPublication = {
  effectiveFrom: string | null;
  effectiveUntil: string | null;
};

export function publicationIsEffective(schedule: ScheduledPublication, at: string | Date) {
  const instant = typeof at === "string" ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(instant)) return false;
  const from = schedule.effectiveFrom ? Date.parse(schedule.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const until = schedule.effectiveUntil ? Date.parse(schedule.effectiveUntil) : Number.POSITIVE_INFINITY;
  return Number.isFinite(from) || from === Number.NEGATIVE_INFINITY
    ? (Number.isFinite(until) || until === Number.POSITIVE_INFINITY) && from <= instant && instant < until
    : false;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
