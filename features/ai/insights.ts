import type { GolfInsights } from "../../lib/golf-insights";
import type { MetricTrend } from "../stats/domain";

export type GolfInsightInput = {
  sampleRounds: number;
  scoreScopeHoles?: 9 | 18;
  averageScore?: number;
  averagePutts?: number;
  fairways?: { hit: number; attempts: number };
  penalties?: number;
  trends: MetricTrend[];
};

export type GolfInsightExplanation = { summary: string; observations: string[]; caveat: string };

export function parseGolfInsightInput(value: unknown): GolfInsightInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["sampleRounds", "scoreScopeHoles", "averageScore", "averagePutts", "fairways", "penalties", "trends"].includes(key))) return null;
  const finite = (item: unknown) => typeof item === "number" && Number.isFinite(item);
  if (!finite(source.sampleRounds) || (source.sampleRounds as number) < 0 || (source.sampleRounds as number) > 1000) return null;
  if (source.scoreScopeHoles !== undefined && source.scoreScopeHoles !== 9 && source.scoreScopeHoles !== 18) return null;
  for (const key of ["averageScore", "averagePutts", "penalties"] as const) if (source[key] !== undefined && !finite(source[key])) return null;
  let fairways: GolfInsightInput["fairways"];
  if (source.fairways !== undefined) {
    if (!source.fairways || typeof source.fairways !== "object" || Array.isArray(source.fairways)) return null;
    const raw = source.fairways as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["hit", "attempts"].includes(key)) || !finite(raw.hit) || !finite(raw.attempts) || (raw.hit as number) < 0 || (raw.attempts as number) < (raw.hit as number)) return null;
    fairways = { hit: raw.hit as number, attempts: raw.attempts as number };
  }
  if (!Array.isArray(source.trends) || source.trends.length > 3) return null;
  const trends: MetricTrend[] = [];
  for (const item of source.trends) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["metric", "previous", "current", "sampleSize", "direction"].includes(key))) return null;
    if (!["score", "putts", "fairways"].includes(String(raw.metric)) || !finite(raw.previous) || !finite(raw.current) || !finite(raw.sampleSize) || !["UP", "DOWN", "FLAT"].includes(String(raw.direction))) return null;
    trends.push({ metric: raw.metric as MetricTrend["metric"], previous: raw.previous as number, current: raw.current as number, sampleSize: raw.sampleSize as number, direction: raw.direction as MetricTrend["direction"] });
  }
  return {
    sampleRounds: Math.trunc(source.sampleRounds as number),
    ...(source.scoreScopeHoles ? { scoreScopeHoles: source.scoreScopeHoles as 9 | 18 } : {}),
    ...(source.averageScore !== undefined ? { averageScore: source.averageScore as number } : {}),
    ...(source.averagePutts !== undefined ? { averagePutts: source.averagePutts as number } : {}),
    ...(fairways ? { fairways } : {}),
    ...(source.penalties !== undefined ? { penalties: source.penalties as number } : {}),
    trends,
  };
}

export function structuredGolfInsightInput(insights: GolfInsights, trends: MetricTrend[]): GolfInsightInput {
  return {
    sampleRounds: insights.scoreSampleRounds,
    ...(insights.scoreScopeHoles ? { scoreScopeHoles: insights.scoreScopeHoles } : {}),
    ...(insights.averageScore !== undefined ? { averageScore: insights.averageScore } : {}),
    ...(insights.averagePutts !== undefined ? { averagePutts: insights.averagePutts } : {}),
    ...(insights.fairwayAttempts ? { fairways: { hit: insights.fairwaysHit, attempts: insights.fairwayAttempts } } : {}),
    ...(insights.advancedRounds ? { penalties: insights.penaltyStrokes } : {}),
    trends: trends.map((trend) => ({ ...trend })),
  };
}

export function validateGolfInsightExplanation(value: unknown): GolfInsightExplanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["summary", "observations", "caveat"].includes(key))) return null;
  if (typeof source.summary !== "string" || !source.summary.trim() || source.summary.length > 400) return null;
  if (!Array.isArray(source.observations) || source.observations.length > 4 || source.observations.some((item) => typeof item !== "string" || !item.trim() || item.length > 240)) return null;
  if (typeof source.caveat !== "string" || !source.caveat.trim() || source.caveat.length > 240) return null;
  return { summary: source.summary.trim(), observations: source.observations.map((item) => String(item).trim()), caveat: source.caveat.trim() };
}
