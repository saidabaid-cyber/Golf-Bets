import { memoryStorageKey } from "../memory/storage";
import { validIsoDate } from "../memory/types";

export const BACKYARD_AI_METRICS_NAMESPACE = "metrics";

export const BACKYARD_AI_METRIC_NAMES = [
  "AI_SETUP_SUCCESS",
  "SETUP_CORRECTIONS",
  "SETUP_QUESTIONS",
  "SCORECARD_CELLS_DETECTED",
  "SCORECARD_CELLS_CORRECTED",
  "AI_CONFIDENCE",
  "ROUND_COMPLETION",
  "AI_FAILURE",
  "TIME_TO_CREATE_ROUND_MS",
  "PHOTO_TO_RESULT_MS",
] as const;

export type BackyardAiMetricName = typeof BACKYARD_AI_METRIC_NAMES[number];

export type MetricAggregate = {
  sampleWeight: number;
  valueSum: number;
  minimum: number;
  maximum: number;
};

export type BackyardAiMetricsSnapshot = {
  version: 1;
  updatedAt: string;
  /** Aggregate-only: no prompt, player, group, round, photo or account ids. */
  aggregates: Partial<Record<BackyardAiMetricName, MetricAggregate>>;
};

export type BackyardAiMetricsSummary = {
  aiSetupSuccessRate: number | null;
  averageSetupCorrections: number | null;
  averageQuestionsBeforeConfirmation: number | null;
  scorecardCellsDetected: number;
  scorecardCorrectionRate: number | null;
  averageConfidence: number | null;
  roundCompletionRate: number | null;
  aiFailureRate: number | null;
  averageTimeToCreateRoundMs: number | null;
  averagePhotoToResultMs: number | null;
};

const METRIC_NAME_SET = new Set<string>(BACKYARD_AI_METRIC_NAMES);

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeAggregate(value: unknown): MetricAggregate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    !finiteNonNegative(source.sampleWeight)
    || source.sampleWeight === 0
    || !finiteNonNegative(source.valueSum)
    || !finiteNonNegative(source.minimum)
    || !finiteNonNegative(source.maximum)
    || source.minimum > source.maximum
  ) return null;
  return {
    sampleWeight: source.sampleWeight,
    valueSum: source.valueSum,
    minimum: source.minimum,
    maximum: source.maximum,
  };
}

export function emptyBackyardAiMetrics(now = new Date().toISOString()): BackyardAiMetricsSnapshot {
  return { version: 1, updatedAt: validIsoDate(now) ? now : new Date(0).toISOString(), aggregates: {} };
}

export function normalizeBackyardAiMetrics(value: unknown, now = new Date().toISOString()): BackyardAiMetricsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyBackyardAiMetrics(now);
  const source = value as { version?: unknown; updatedAt?: unknown; aggregates?: unknown };
  if (source.version !== 1 || !validIsoDate(source.updatedAt) || !source.aggregates || typeof source.aggregates !== "object" || Array.isArray(source.aggregates)) {
    return emptyBackyardAiMetrics(now);
  }
  const aggregates: Partial<Record<BackyardAiMetricName, MetricAggregate>> = {};
  for (const [name, aggregate] of Object.entries(source.aggregates)) {
    const normalized = normalizeAggregate(aggregate);
    if (METRIC_NAME_SET.has(name) && normalized) aggregates[name as BackyardAiMetricName] = normalized;
  }
  return { version: 1, updatedAt: source.updatedAt, aggregates };
}

function metricValue(name: BackyardAiMetricName, value: number) {
  if (!Number.isFinite(value)) return null;
  if (name === "AI_SETUP_SUCCESS" || name === "ROUND_COMPLETION" || name === "AI_FAILURE" || name === "AI_CONFIDENCE") {
    return Math.max(0, Math.min(1, value));
  }
  return Math.max(0, value);
}

export function recordBackyardAiMetric(
  snapshotValue: BackyardAiMetricsSnapshot,
  name: BackyardAiMetricName,
  value: number,
  options: { sampleWeight?: number; now?: string } = {},
): BackyardAiMetricsSnapshot {
  const snapshot = normalizeBackyardAiMetrics(snapshotValue, options.now);
  const normalizedValue = metricValue(name, value);
  const weight = typeof options.sampleWeight === "number" && Number.isFinite(options.sampleWeight)
    ? Math.max(0, options.sampleWeight)
    : 1;
  if (normalizedValue === null || weight === 0) return snapshot;
  const current = snapshot.aggregates[name];
  const aggregate: MetricAggregate = current
    ? {
        sampleWeight: current.sampleWeight + weight,
        valueSum: current.valueSum + normalizedValue * weight,
        minimum: Math.min(current.minimum, normalizedValue),
        maximum: Math.max(current.maximum, normalizedValue),
      }
    : { sampleWeight: weight, valueSum: normalizedValue * weight, minimum: normalizedValue, maximum: normalizedValue };
  return {
    version: 1,
    updatedAt: options.now && validIsoDate(options.now) ? options.now : new Date().toISOString(),
    aggregates: { ...snapshot.aggregates, [name]: aggregate },
  };
}

export function recordRoundSetupMetrics(
  snapshot: BackyardAiMetricsSnapshot,
  input: { success: boolean; corrections: number; questionCount: number; durationMs: number; confidence?: number; now?: string },
) {
  const options = { now: input.now };
  let next = recordBackyardAiMetric(snapshot, "AI_SETUP_SUCCESS", input.success ? 1 : 0, options);
  next = recordBackyardAiMetric(next, "SETUP_CORRECTIONS", input.corrections, options);
  next = recordBackyardAiMetric(next, "SETUP_QUESTIONS", input.questionCount, options);
  next = recordBackyardAiMetric(next, "TIME_TO_CREATE_ROUND_MS", input.durationMs, options);
  // A plan that asks a focused question is behaving as designed. Count a
  // terminal success/failure sample only when no clarification remains.
  if (input.success || input.questionCount === 0) next = recordBackyardAiMetric(next, "AI_FAILURE", input.success ? 0 : 1, options);
  if (input.confidence !== undefined) next = recordBackyardAiMetric(next, "AI_CONFIDENCE", input.confidence, options);
  return next;
}

export function recordScorecardMetrics(
  snapshot: BackyardAiMetricsSnapshot,
  input: {
    detectedCells: number;
    correctedCells: number;
    averageConfidence: number;
    now?: string;
  },
) {
  const options = { now: input.now };
  const detectedCells = Math.max(0, Math.floor(input.detectedCells));
  const correctedCells = Math.max(0, Math.min(detectedCells, Math.floor(input.correctedCells)));
  let next = recordBackyardAiMetric(snapshot, "SCORECARD_CELLS_DETECTED", detectedCells, options);
  next = recordBackyardAiMetric(next, "SCORECARD_CELLS_CORRECTED", correctedCells, options);
  next = recordBackyardAiMetric(next, "AI_CONFIDENCE", input.averageConfidence, { ...options, sampleWeight: Math.max(1, detectedCells) });
  return next;
}

export function recordScorecardOutcomeMetrics(
  snapshot: BackyardAiMetricsSnapshot,
  input: { outcome: "result"; photoToResultMs: number; now?: string } | { outcome: "failure"; now?: string },
) {
  const options = { now: input.now };
  if (input.outcome === "failure") return recordBackyardAiMetric(snapshot, "AI_FAILURE", 1, options);
  const withDuration = recordBackyardAiMetric(snapshot, "PHOTO_TO_RESULT_MS", input.photoToResultMs, options);
  return recordBackyardAiMetric(withDuration, "AI_FAILURE", 0, options);
}

export function recordRoundCompletionMetric(snapshot: BackyardAiMetricsSnapshot, completed: boolean, now?: string) {
  return recordBackyardAiMetric(snapshot, "ROUND_COMPLETION", completed ? 1 : 0, { now });
}

function average(snapshot: BackyardAiMetricsSnapshot, name: BackyardAiMetricName) {
  const aggregate = snapshot.aggregates[name];
  return aggregate && aggregate.sampleWeight > 0 ? aggregate.valueSum / aggregate.sampleWeight : null;
}

function sum(snapshot: BackyardAiMetricsSnapshot, name: BackyardAiMetricName) {
  return snapshot.aggregates[name]?.valueSum ?? 0;
}

export function summarizeBackyardAiMetrics(snapshotValue: BackyardAiMetricsSnapshot): BackyardAiMetricsSummary {
  const snapshot = normalizeBackyardAiMetrics(snapshotValue);
  const detected = sum(snapshot, "SCORECARD_CELLS_DETECTED");
  const corrected = sum(snapshot, "SCORECARD_CELLS_CORRECTED");
  return {
    aiSetupSuccessRate: average(snapshot, "AI_SETUP_SUCCESS"),
    averageSetupCorrections: average(snapshot, "SETUP_CORRECTIONS"),
    averageQuestionsBeforeConfirmation: average(snapshot, "SETUP_QUESTIONS"),
    scorecardCellsDetected: detected,
    scorecardCorrectionRate: detected > 0 ? corrected / detected : null,
    averageConfidence: average(snapshot, "AI_CONFIDENCE"),
    roundCompletionRate: average(snapshot, "ROUND_COMPLETION"),
    aiFailureRate: average(snapshot, "AI_FAILURE"),
    averageTimeToCreateRoundMs: average(snapshot, "TIME_TO_CREATE_ROUND_MS"),
    averagePhotoToResultMs: average(snapshot, "PHOTO_TO_RESULT_MS"),
  };
}

export function backyardAiMetricsStorageKey(ownerId: string) {
  return memoryStorageKey(BACKYARD_AI_METRICS_NAMESPACE, ownerId);
}

export function readBackyardAiMetrics(
  storage: Pick<Storage, "getItem">,
  ownerId: string,
  now = new Date().toISOString(),
): { ok: true; snapshot: BackyardAiMetricsSnapshot; recoveredMalformed: boolean } | {
  ok: false;
  snapshot: BackyardAiMetricsSnapshot;
  error: "identity_missing" | "storage_read_failed";
} {
  const fallback = emptyBackyardAiMetrics(now);
  const key = backyardAiMetricsStorageKey(ownerId);
  if (!key) return { ok: false, snapshot: fallback, error: "identity_missing" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, snapshot: fallback, recoveredMalformed: false };
    try {
      const parsed = JSON.parse(raw) as unknown;
      const snapshot = normalizeBackyardAiMetrics(parsed, now);
      return { ok: true, snapshot, recoveredMalformed: JSON.stringify(snapshot) !== JSON.stringify(parsed) };
    } catch {
      return { ok: true, snapshot: fallback, recoveredMalformed: true };
    }
  } catch {
    return { ok: false, snapshot: fallback, error: "storage_read_failed" };
  }
}

export function writeBackyardAiMetrics(
  storage: Pick<Storage, "setItem">,
  ownerId: string,
  snapshotValue: BackyardAiMetricsSnapshot,
): { ok: true; persisted: true; snapshot: BackyardAiMetricsSnapshot } | {
  ok: false;
  persisted: false;
  snapshot: BackyardAiMetricsSnapshot;
  error: "identity_missing" | "storage_write_failed";
} {
  const snapshot = normalizeBackyardAiMetrics(snapshotValue);
  const key = backyardAiMetricsStorageKey(ownerId);
  if (!key) return { ok: false, persisted: false, snapshot, error: "identity_missing" };
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return { ok: true, persisted: true, snapshot };
  } catch {
    return { ok: false, persisted: false, snapshot, error: "storage_write_failed" };
  }
}

/** Read-modify-write helper that never throws or overwrites after a read error. */
export function updateBackyardAiMetrics(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerId: string,
  update: (current: BackyardAiMetricsSnapshot) => BackyardAiMetricsSnapshot,
  now = new Date().toISOString(),
) {
  const current = readBackyardAiMetrics(storage, ownerId, now);
  if (!current.ok) return { ok: false as const, persisted: false as const, snapshot: current.snapshot, error: current.error };
  return writeBackyardAiMetrics(storage, ownerId, update(current.snapshot));
}
