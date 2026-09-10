import { buildGolfInsights, type GolfInsights } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";

export type StatsWindow = 5 | 10 | 20 | "SEASON" | "ALL";
export type StatsFilters = { window: StatsWindow; courseName?: string; teeName?: string; seasonYear?: number };

function playedTime(round: RoundSnapshot) {
  return Date.parse(round.completedAt || `${round.date}T12:00:00-06:00`) || 0;
}

export function filterStatsRounds(rounds: readonly RoundSnapshot[], filters: StatsFilters) {
  const selected = [...rounds].filter((round) => {
    if (filters.courseName && round.courseName !== filters.courseName) return false;
    if (filters.teeName && round.teeName !== filters.teeName && !round.playerTeeAssignments?.some((tee) => tee.teeName === filters.teeName)) return false;
    if (filters.window === "SEASON") return Number(round.date.slice(0, 4)) === (filters.seasonYear ?? new Date().getFullYear());
    return true;
  }).sort((a, b) => playedTime(b) - playedTime(a));
  return typeof filters.window === "number" ? selected.slice(0, filters.window) : selected;
}

export function buildFilteredGolfInsights(rounds: readonly RoundSnapshot[], filters: StatsFilters): GolfInsights {
  return buildGolfInsights(filterStatsRounds(rounds, filters));
}

export type MetricTrend = { metric: "score" | "putts" | "fairways"; previous: number; current: number; sampleSize: number; direction: "UP" | "DOWN" | "FLAT" };

export function buildGolfTrends(rounds: readonly RoundSnapshot[], sampleSize = 5): MetricTrend[] {
  const valid = Math.max(3, Math.min(10, Math.trunc(sampleSize)));
  const insights = buildGolfInsights(rounds).recentRounds;
  if (insights.length < valid * 2) return [];
  const current = insights.slice(0, valid);
  const previous = insights.slice(valid, valid * 2);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const trend = (metric: MetricTrend["metric"], before: number, now: number): MetricTrend => ({ metric, previous: before, current: now, sampleSize: valid, direction: Math.abs(now - before) < 0.05 ? "FLAT" : now > before ? "UP" : "DOWN" });
  const result = [trend("score", average(previous.map((round) => round.gross)), average(current.map((round) => round.gross)))];
  if (current.every((round) => round.putts !== null) && previous.every((round) => round.putts !== null)) result.push(trend("putts", average(previous.map((round) => round.putts as number)), average(current.map((round) => round.putts as number))));
  const fairwayCurrentAttempts = current.reduce((sum, round) => sum + round.fairwayAttempts, 0);
  const fairwayPreviousAttempts = previous.reduce((sum, round) => sum + round.fairwayAttempts, 0);
  if (fairwayCurrentAttempts && fairwayPreviousAttempts) result.push(trend("fairways", previous.reduce((sum, round) => sum + round.fairwaysHit, 0) / fairwayPreviousAttempts, current.reduce((sum, round) => sum + round.fairwaysHit, 0) / fairwayCurrentAttempts));
  return result;
}
