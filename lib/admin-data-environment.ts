export const ADMIN_DATA_ENVIRONMENTS = ["PRODUCTION", "QA", "TEST", "SYNTHETIC"] as const;

export type AdminDataEnvironment = (typeof ADMIN_DATA_ENVIRONMENTS)[number];
export type AdminDataClassification = {
  environment: AdminDataEnvironment;
  source: "EXPLICIT" | "LEGACY" | "DEFAULT";
};

type UnknownRecord = Record<string, unknown>;

const EXPLICIT_KEYS = ["dataEnvironment", "data_environment"] as const;
const NESTED_METADATA_KEYS = ["payload", "metadata", "summary", "settings", "normalized_payload"] as const;
const LEGACY_ID_MARKER = /(?:^|[-_:])(synthetic|qa|qa-fixture|test-fixture|fixture)(?:[-_:]|$)/i;
const SYNTHETIC_MARKER = /(?:^|\b)(?:synthetic|sintetic[oa]s?)(?:\b|$)/i;
const QA_MARKER = /(?:^|\b)(?:qa reconciliation|qa fixture|fixture qa|prueba qa|qa controlad[oa]|internal qa)(?:\b|$)/i;
const TEST_MARKER = /(?:^|\b)(?:test fixture|fixture test|automated test|prueba automatizada)(?:\b|$)/i;

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function normalizeEnvironment(value: unknown): AdminDataEnvironment | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (ADMIN_DATA_ENVIRONMENTS as readonly string[]).includes(normalized) ? normalized as AdminDataEnvironment : null;
}

function explicitEnvironment(value: unknown, depth = 0): AdminDataEnvironment | null {
  const row = object(value);
  if (!row || depth > 2) return null;
  for (const key of EXPLICIT_KEYS) {
    const environment = normalizeEnvironment(row[key]);
    if (environment) return environment;
  }
  for (const key of NESTED_METADATA_KEYS) {
    const environment = explicitEnvironment(row[key], depth + 1);
    if (environment) return environment;
  }
  return null;
}

function collectLegacySignals(value: unknown, depth = 0): { identifiers: string[]; descriptions: string[] } {
  const row = object(value);
  if (!row || depth > 3) return { identifiers: [], descriptions: [] };
  const identifiers: string[] = [];
  const descriptions: string[] = [];
  for (const key of ["id", "entity_id", "entityId", "course_id", "courseId", "clubId"]) {
    if (typeof row[key] === "string" && row[key].trim()) identifiers.push(row[key].trim());
  }
  for (const key of [
    "title", "name",
    "brand", "model", "source_name", "sourceName", "source_description", "sourceDescription",
    "organizer", "description", "reason", "source_screen", "sourceScreen",
  ]) {
    if (typeof row[key] === "string" && row[key].trim()) descriptions.push(row[key].trim());
  }
  for (const key of [...NESTED_METADATA_KEYS, "club", "course"] as const) {
    const nested = collectLegacySignals(row[key], depth + 1);
    identifiers.push(...nested.identifiers);
    descriptions.push(...nested.descriptions);
  }
  if (Array.isArray(row.admin_import_rows)) {
    for (const item of row.admin_import_rows.slice(0, 500)) {
      const nested = collectLegacySignals(item, depth + 1);
      identifiers.push(...nested.identifiers);
      descriptions.push(...nested.descriptions);
    }
  }
  if (typeof row.source_type === "string") descriptions.push(row.source_type);
  if (typeof row.sourceType === "string") descriptions.push(row.sourceType);
  return { identifiers, descriptions };
}

/**
 * Explicit metadata always wins. Legacy inference is intentionally conservative:
 * stable IDs and well-known fixture phrases are recognized, while ordinary uses
 * of words such as "test" in free-form user copy are not enough on their own.
 */
export function classifyAdminData(value: unknown): AdminDataClassification {
  const explicit = explicitEnvironment(value);
  if (explicit) return { environment: explicit, source: "EXPLICIT" };

  const signals = collectLegacySignals(value);
  const allSignals = [...signals.identifiers, ...signals.descriptions];
  if (allSignals.some((signal) => SYNTHETIC_MARKER.test(signal))) return { environment: "SYNTHETIC", source: "LEGACY" };
  if (allSignals.some((signal) => QA_MARKER.test(signal))) return { environment: "QA", source: "LEGACY" };
  if (allSignals.some((signal) => TEST_MARKER.test(signal))) return { environment: "TEST", source: "LEGACY" };
  if (signals.identifiers.some((signal) => LEGACY_ID_MARKER.test(signal))) return { environment: "QA", source: "LEGACY" };
  return { environment: "PRODUCTION", source: "DEFAULT" };
}

export function isOperationalAdminData(value: unknown) {
  return classifyAdminData(value).environment === "PRODUCTION";
}

export function withAdminDataEnvironment<T extends UnknownRecord>(value: T): T & { data_environment: AdminDataEnvironment } {
  return { ...value, data_environment: classifyAdminData(value).environment };
}

export function canViewQaAdminData(memberships: readonly unknown[]) {
  return memberships.some((membership) => {
    const row = object(membership);
    return row?.role === "SUPER_ADMIN" && row?.scope_type === "GLOBAL" && row?.active === true;
  });
}

export function visibleAdminData<T>(values: readonly T[], includeQa: boolean) {
  return values.filter((value) => includeQa || isOperationalAdminData(value));
}

export function adminEnvironmentCounts(values: readonly unknown[]) {
  return values.reduce<Record<AdminDataEnvironment, number>>((counts, value) => {
    counts[classifyAdminData(value).environment] += 1;
    return counts;
  }, { PRODUCTION: 0, QA: 0, TEST: 0, SYNTHETIC: 0 });
}
