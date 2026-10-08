import { normalizeAdvancedStats } from "./advanced-stats";
import { ownCareerHistory } from "./career-statistics";
import { deduplicateRoundSnapshots } from "./balance-ledger";
import { personalRoundPerspective } from "./participant-history";
import type { ScoredRoundInsight } from "./golf-insights";
import type { RoundSnapshot } from "./types";

/** Read projection only: eligible scored IDs come from the existing recap engine.
 * No persistence, inferred penalties, or fabricated hole/shot data. */
export function golfCaptureStatistics(rounds: readonly RoundSnapshot[], scored: readonly ScoredRoundInsight[], userId?: string) {
  const eligible = new Set(scored.map(row => row.id));
  const owned = userId ? ownCareerHistory(rounds, userId) : deduplicateRoundSnapshots(rounds).flatMap(round => {
    const perspective = personalRoundPerspective(round);
    return perspective ? [perspective] : [];
  });
  const puttDistribution = [0, 0, 0, 0, 0];
  let holes = 0, puttHoles = 0, putts = 0, penaltyHoles = 0, penalties = 0, firstPuttHoles = 0, firstPuttFeet = 0;
  let firEligible = 0, firAttempts = 0, firHits = 0, girAttempts = 0, girHits = 0;
  const girByPar = new Map<number, { attempts: number; hits: number }>();
  const clubs = new Map<string, { count: number; totalYards: number }>();
  const series: { id: string; date: string; putts: number | null; firAttempts: number; firHits: number; girAttempts: number; girHits: number; penaltyHoles: number; penalties: number }[] = [];
  for (const round of owned) {
    if (!eligible.has(round.id) || !round.ownerId) continue;
    const owner = round.ownerId;
    const definitions = round.courseSnapshot?.playerHoleCards?.[owner] ?? round.courseSnapshot?.holes ?? [];
    const facts = normalizeAdvancedStats(round.advancedStats);
    let capturedPutts = 0, roundPutts = 0, fa = 0, fh = 0, ga = 0, gh = 0, ph = 0, ps = 0;
    for (const number of round.order ?? []) {
      const definition = definitions.find(hole => hole.number === number);
      if (!definition) continue;
      holes++;
      const value = round.putts?.[number]?.[owner], score = round.scores?.[number]?.[owner];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 20 && typeof score === "number" && value <= score) {
        putts += value; puttHoles++; capturedPutts++; roundPutts += value;
        puttDistribution[Math.min(4, value)]++;
      }
      const fact = facts[number]?.[owner];
      if (definition.par === 4 || definition.par === 5) {
        firEligible++;
        if (typeof fact?.fairwayHit === "boolean") { firAttempts++; fa++; if (fact.fairwayHit) { firHits++; fh++; } }
      }
      if (typeof fact?.greenInRegulation === "boolean") {
        girAttempts++; ga++; if (fact.greenInRegulation) { girHits++; gh++; }
        const row = girByPar.get(definition.par) ?? { attempts: 0, hits: 0 };
        row.attempts++; if (fact.greenInRegulation) row.hits++; girByPar.set(definition.par, row);
      }
      if (typeof fact?.penaltyStrokes === "number") { penaltyHoles++; penalties += fact.penaltyStrokes; ph++; ps += fact.penaltyStrokes; }
      if (typeof fact?.firstPuttDistanceFeet === "number") { firstPuttHoles++; firstPuttFeet += fact.firstPuttDistanceFeet; }
      if (fact?.teeClub && typeof fact.teeDistance === "number") {
        const row = clubs.get(fact.teeClub) ?? { count: 0, totalYards: 0 };
        row.count++; row.totalYards += fact.teeDistance; clubs.set(fact.teeClub, row);
      }
    }
    series.push({ id: round.id, date: round.date, putts: capturedPutts === round.order?.length ? roundPutts : null, firAttempts: fa, firHits: fh, girAttempts: ga, girHits: gh, penaltyHoles: ph, penalties: ps });
  }
  return { holes, puttHoles, putts, puttDistribution, penaltyHoles, penalties, firEligible, firAttempts, firHits, girAttempts, girHits, girByPar, firstPuttHoles, firstPuttFeet, clubs, series };
}
