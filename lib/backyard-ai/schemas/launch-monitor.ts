import {
  LAUNCH_MONITOR_CLUBS,
  LAUNCH_MONITOR_METRICS,
  type LaunchMonitorClub,
  type LaunchMonitorMetric,
  type LaunchMonitorShot,
} from "../../golf-equipment";

export const LAUNCH_MONITOR_VISION_CONFIDENCE = 0.86;

export type LaunchMonitorMetricObservation = {
  value: number | null;
  confidence: number;
};

export type LaunchMonitorVisionShot = {
  id: string;
  sourcePhotoId: string;
  club: LaunchMonitorClub | null;
  clubConfidence: number;
  metrics: Record<LaunchMonitorMetric, LaunchMonitorMetricObservation>;
};

export type LaunchMonitorVisionExtraction = {
  version: 1;
  source: string | null;
  shots: LaunchMonitorVisionShot[];
};

const RANGES: Record<LaunchMonitorMetric, readonly [number, number]> = {
  clubSpeedMph: [0, 250],
  ballSpeedMph: [0, 300],
  launchAngleDegrees: [-30, 90],
  spinRpm: [0, 25_000],
  carryYards: [0, 700],
  totalYards: [0, 800],
  peakHeightYards: [0, 250],
  landingAngleDegrees: [-30, 90],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function confidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function observation(value: unknown, metric: LaunchMonitorMetric): LaunchMonitorMetricObservation | null {
  const source = record(value);
  if (!source || Object.keys(source).some((key) => !["value", "confidence"].includes(key))) return null;
  const certainty = confidence(source.confidence);
  if (certainty === null) return null;
  if (source.value === null) return { value: null, confidence: certainty };
  const [minimum, maximum] = RANGES[metric];
  return typeof source.value === "number" && Number.isFinite(source.value) && source.value >= minimum && source.value <= maximum
    ? { value: source.value, confidence: certainty }
    : null;
}

/** Vision extracts evidence; this validator rejects unknown fields/ranges before
 * the user can review or save anything in a fitting session. */
export function normalizeLaunchMonitorVisionExtraction(value: unknown, allowedPhotoIds?: readonly string[]) {
  const source = record(value);
  if (!source || source.version !== 1 || !Array.isArray(source.shots) || source.shots.length > 60) return null;
  const allowed = allowedPhotoIds ? new Set(allowedPhotoIds) : null;
  const shots: LaunchMonitorVisionShot[] = [];
  for (let index = 0; index < source.shots.length; index += 1) {
    const raw = record(source.shots[index]);
    const rawMetrics = record(raw?.metrics);
    const sourcePhotoId = typeof raw?.sourcePhotoId === "string" ? raw.sourcePhotoId.trim() : "";
    const mappedClub = raw?.club === null
      ? null
      : (LAUNCH_MONITOR_CLUBS as readonly unknown[]).includes(raw?.club) ? raw?.club as LaunchMonitorClub : undefined;
    const clubConfidence = confidence(raw?.clubConfidence);
    if (!raw || !rawMetrics || !sourcePhotoId || (allowed && !allowed.has(sourcePhotoId)) || mappedClub === undefined || clubConfidence === null) return null;
    const metrics = {} as Record<LaunchMonitorMetric, LaunchMonitorMetricObservation>;
    for (const metric of LAUNCH_MONITOR_METRICS) {
      const parsed = observation(rawMetrics[metric], metric);
      if (!parsed) return null;
      metrics[metric] = parsed;
    }
    if (!Object.values(metrics).some((metric) => metric.value !== null)) continue;
    shots.push({ id: `vision-${sourcePhotoId}-${index + 1}`, sourcePhotoId, club: mappedClub, clubConfidence, metrics });
  }
  const provider = typeof source.source === "string" && source.source.trim() ? source.source.trim().slice(0, 120) : null;
  return { version: 1, source: provider, shots } satisfies LaunchMonitorVisionExtraction;
}

export function launchMonitorVisionShotToDraft(shot: LaunchMonitorVisionShot, capturedAt = new Date().toISOString()): LaunchMonitorShot | null {
  if (!shot.club) return null;
  const values = Object.fromEntries(LAUNCH_MONITOR_METRICS.map((metric) => [metric, shot.metrics[metric].value])) as Record<LaunchMonitorMetric, number | null>;
  return {
    id: shot.id,
    club: shot.club,
    excluded: false,
    capturedAt,
    note: null,
    ...values,
  };
}
