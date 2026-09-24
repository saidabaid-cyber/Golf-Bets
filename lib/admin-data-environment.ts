export const ADMIN_DATA_ENVIRONMENTS = ["PRODUCTION", "QA", "TEST", "SYNTHETIC"] as const;

export type AdminDataEnvironment = (typeof ADMIN_DATA_ENVIRONMENTS)[number];
export type AdminDataClassification = {
  environment: AdminDataEnvironment;
  source: "EXPLICIT" | "LEGACY" | "DEFAULT";
};
export type AdminDataVerification = {
  value: number | null;
  status: "VERIFIED" | "NOT_VERIFIED";
  reason: string;
};

type UnknownRecord = Record<string, unknown>;

const EXPLICIT_KEYS = ["dataEnvironment", "data_environment"] as const;
const NESTED_METADATA_KEYS = ["payload", "metadata", "summary", "settings", "normalized_payload"] as const;
const LEGACY_ID_MARKER = /(?:^|[-_:])(synthetic|qa|qa-fixture|test-fixture|fixture)(?:[-_:]|$)/i;
const SYNTHETIC_MARKER = /(?:^|\b)(?:synthetic|sintetic[oa]s?)(?:\b|$)/i;
const QA_MARKER = /(?:^|\b)(?:qa reconciliation|qa fixture|fixture qa|prueba qa|qa controlad[oa]|internal qa)(?:\b|$)/i;
const TEST_MARKER = /(?:^|\b)(?:test fixture|fixture test|automated test|prueba automatizada)(?:\b|$)/i;
const QA_METADATA_MARKER = /(?:@example\.invalid$|(?:^|[-_/])qa(?:[-_/]|$))/i;
// These three pre-v2 fixtures have empty safe queue fields. Their QA evidence is
// stored only in private payload/reply-email columns, so the pre-migration RPC
// cannot expose it. Exact immutable IDs avoid treating any real blank request as QA.
const LEGACY_QA_RECORD_IDS = new Set([
  "5589dffb-416d-44cd-9d06-90b173bd1271",
  "5e3ebfef-cdcd-4953-a802-bf9f369f4d96",
  "cfdd2187-8783-4efc-9105-7c151a251904",
]);

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
    "organizer", "description", "reason", "source_screen", "sourceScreen", "reply_email", "replyEmail",
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
  if (signals.identifiers.some((signal) => LEGACY_QA_RECORD_IDS.has(signal))) {
    return { environment: "QA", source: "LEGACY" };
  }
  const allSignals = [...signals.identifiers, ...signals.descriptions].map((signal) =>
    signal.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
  if (allSignals.some((signal) => SYNTHETIC_MARKER.test(signal))) return { environment: "SYNTHETIC", source: "LEGACY" };
  if (allSignals.some((signal) => QA_MARKER.test(signal))) return { environment: "QA", source: "LEGACY" };
  if (allSignals.some((signal) => TEST_MARKER.test(signal))) return { environment: "TEST", source: "LEGACY" };
  if (allSignals.some((signal) => QA_METADATA_MARKER.test(signal))) return { environment: "QA", source: "LEGACY" };
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

/** Filters before pagination so a QA row can never consume an operational slot. */
export function adminDataPage<T extends UnknownRecord>(values: readonly T[], includeQa: boolean, limit: number) {
  const visible = visibleAdminData(values, includeQa).map(withAdminDataEnvironment);
  return {
    items: visible.slice(0, Math.max(1, Math.trunc(limit))),
    total: visible.length,
  };
}

export function adminPublicationDecision(value: unknown) {
  const classification = classifyAdminData(value);
  return classification.environment === "PRODUCTION"
    ? { allowed: true as const, environment: classification.environment, code: null }
    : { allowed: false as const, environment: classification.environment, code: "QA_PUBLICATION_BLOCKED" as const };
}

export function adminEnvironmentCounts(values: readonly unknown[]) {
  return values.reduce<Record<AdminDataEnvironment, number>>((counts, value) => {
    counts[classifyAdminData(value).environment] += 1;
    return counts;
  }, { PRODUCTION: 0, QA: 0, TEST: 0, SYNTHETIC: 0 });
}

const ENTITY_ID_KEYS = new Set(["id", "entity_id", "entityId"]);
const REFERENCE_ID_KEYS = new Set([
  "club_id", "clubId", "course_id", "courseId", "tee_id", "teeId", "hole_id", "holeId",
  "competition_id", "competitionId", "equipment_id", "equipmentId", "revision_id", "revisionId",
  "configuration_id", "configurationId", "source_base_hole_id", "sourceBaseHoleId",
]);

function collectValues(value: unknown, keys: ReadonlySet<string>, output: Set<string>, depth = 0) {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, keys, output, depth + 1);
    return;
  }
  const row = object(value);
  if (!row) return;
  for (const [key, nested] of Object.entries(row)) {
    if (keys.has(key) && typeof nested === "string" && nested.trim()) output.add(nested.trim());
    if (nested && typeof nested === "object") collectValues(nested, keys, output, depth + 1);
  }
}

/**
 * Verifies the in-process operational projections. Historical/user reference
 * integrity is intentionally a separate nullable metric because it requires a
 * privileged, controlled database read and must never be inferred as zero.
 */
export function analyzeAdminDataSeparation(input: {
  operationalProjectionRows: readonly unknown[];
  internalRows: readonly unknown[];
  historicalReferencesChecked?: boolean;
  historicalProductionRows?: readonly unknown[];
}) {
  const fixtureRows = input.internalRows.filter((row) => !isOperationalAdminData(row));
  const fixtureIds = new Set<string>();
  for (const row of fixtureRows) collectValues(row, ENTITY_ID_KEYS, fixtureIds);

  const operationalIds = new Set<string>();
  let syntheticVisible = 0;
  for (const row of input.operationalProjectionRows) {
    const ids = new Set<string>();
    collectValues(row, ENTITY_ID_KEYS, ids);
    for (const id of ids) operationalIds.add(id);
    const hasKnownFixtureId = [...ids].some((id) => fixtureIds.has(id));
    if (!isOperationalAdminData(row) || hasKnownFixtureId) {
      syntheticVisible += 1;
    }
  }
  const exposedFixtureRows = fixtureRows.filter((row) => {
    const ids = new Set<string>();
    collectValues(row, ENTITY_ID_KEYS, ids);
    return [...ids].some((id) => operationalIds.has(id));
  }).length;

  let productionReferenceMetric: AdminDataVerification;
  if (!input.historicalReferencesChecked) {
    productionReferenceMetric = {
      value: null,
      status: "NOT_VERIFIED",
      reason: "Requiere lectura referencial controlada después de persistir data_environment; no se infiere un cero.",
    };
  } else {
    let references = 0;
    for (const row of input.historicalProductionRows || []) {
      if (!isOperationalAdminData(row)) continue;
      const ids = new Set<string>();
      collectValues(row, REFERENCE_ID_KEYS, ids);
      if ([...ids].some((id) => fixtureIds.has(id))) references += 1;
    }
    productionReferenceMetric = {
      value: references,
      status: "VERIFIED",
      reason: "Comprobado contra las referencias históricas/operativas suministradas.",
    };
  }

  return {
    isolatedInternalFixtures: {
      value: fixtureRows.length - exposedFixtureRows,
      status: "VERIFIED",
      reason: "Fixtures internos conservados fuera de las proyecciones operativas cargadas.",
    } satisfies AdminDataVerification,
    syntheticVisibleInOperational: {
      value: syntheticVisible,
      status: "VERIFIED",
      reason: "Comprobado contra las proyecciones Course y Equipment que consume el jugador.",
    } satisfies AdminDataVerification,
    productionIdsPointingToFixtures: productionReferenceMetric,
  };
}
