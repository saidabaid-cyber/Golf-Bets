import { personalRivalKey } from "./engine";
import type { PersonalBet, PersonalHistoryResult, Player, RoundSnapshot } from "./types";

export type PersonalHistoryPeriod = "all" | "year" | "month";
export type PersonalHistorySort = "recent" | "played" | "won" | "lost";
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");

export function snapshotPersonalResult(
  bet: PersonalBet,
  result: { totalMoney: number; componentMoney: Record<string, number>; grossOwner?: number; grossRival?: number },
  players: Player[],
): PersonalHistoryResult {
  const rival = bet.rivalMode === "group" ? players.find((player) => player.id === bet.rivalPlayerId) : undefined;
  return {
    rivalKey: personalRivalKey(bet),
    rivalName: rival?.name || bet.rivalName,
    rivalHandicap: rival ? rival.handicap : bet.rivalHandicap ?? null,
    rivalTemplateId: bet.rivalMode === "external" ? bet.externalRivalId : undefined,
    betId: bet.id,
    totalMoney: result.totalMoney,
    grossOwner: result.grossOwner,
    grossRival: result.grossRival,
    componentMoney: { ...result.componentMoney },
    betSnapshot: structuredClone(bet),
  };
}

function recordedBet(round: RoundSnapshot, result: PersonalHistoryResult) {
  if (result.betSnapshot) return result.betSnapshot;
  // Never correlate by array position: deleting a result changes that position.
  if (result.betId) return round.personalBets?.find((bet) => bet.id === result.betId);
  const candidates = round.personalBets?.filter((bet) => personalRivalKey(bet) === result.rivalKey) || [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

export type RivalHistoryEntry = PersonalHistoryResult & {
  resultIndex: number;
  matchMoney: number;
  medalMoney: number;
};
export type RivalHistoryRound = {
  roundId: string;
  date: string;
  courseName: string;
  ownerName: string;
  totalMoney: number;
  entries: RivalHistoryEntry[];
};
export type RivalHistory = {
  key: string;
  name: string;
  total: number;
  rounds: number;
  bets: number;
  wins: number;
  losses: number;
  ties: number;
  wonMoney: number;
  lostMoney: number;
  matchMoney: number;
  medalMoney: number;
  pressureMoney: number;
  firstMoney: number;
  secondMoney: number;
  total18Money: number;
  records: RivalHistoryRound[];
};

/** A rival must be chosen explicitly before presenting personal results. The
 * stable key, rather than the display name, prevents two homonyms from being
 * selected together. */
export function selectPersonalRivalHistory(rivals: RivalHistory[], rivalKey: string) {
  if (!rivalKey) return null;
  return rivals.find((rival) => rival.key === rivalKey) || null;
}

export function buildPersonalHistory(
  history: RoundSnapshot[],
  today: string,
  period: PersonalHistoryPeriod = "all",
  sort: PersonalHistorySort = "recent",
): RivalHistory[] {
  const uniqueRounds = [...new Map([...history].sort((a,b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date)).map(round => [round.id, round])).values()];
  const entries = uniqueRounds.flatMap((round) => (round.personalResults || []).map((result, resultIndex) => {
    const bet = recordedBet(round, result);
    const templateId = result.rivalTemplateId || (bet?.rivalMode === "external" ? bet.externalRivalId : undefined);
    const player = round.players?.find((candidate) => candidate.id === result.rivalKey);
    return { round, result, resultIndex, bet, templateId, handicap: result.rivalHandicap ?? player?.handicap ?? bet?.rivalHandicap ?? null };
  }));
  // Names bridge legacy/group round-local IDs to a saved rival only when unambiguous.
  // Use historical names, never the current editable rival list.
  const aliases = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.templateId) continue;
    const name = nameKey(entry.result.rivalName);
    const ids = aliases.get(name) || new Set<string>();
    ids.add(entry.templateId);
    aliases.set(name, ids);
  }
  const rivals = new Map<string, RivalHistory>();
  for (const { round, result, resultIndex, bet, templateId, handicap } of entries.sort((a, b) => b.round.date.localeCompare(a.round.date))) {
    if (period === "year" && !round.date.startsWith(today.slice(0, 4))) continue;
    if (period === "month" && !round.date.startsWith(today.slice(0, 7))) continue;
    const normalizedName = nameKey(result.rivalName);
    const alias = aliases.get(normalizedName);
    const stableId = templateId || (alias?.size === 1 ? [...alias][0] : undefined);
    // A rival can be shared by different principal players on this device.
    // Round-local player IDs are not stable across rounds; snapshot names are.
    const key = `${nameKey(round.ownerName)}::${stableId ? `template:${stableId}` : `name:${normalizedName || result.rivalKey}`}`;
    const rival = rivals.get(key) || { key, name: result.rivalName, total: 0, rounds: 0, bets: 0, wins: 0, losses: 0, ties: 0, wonMoney: 0, lostMoney: 0, matchMoney: 0, medalMoney: 0, pressureMoney: 0, firstMoney: 0, secondMoney: 0, total18Money: 0, records: [] };
    let record = rival.records.find((item) => item.roundId === round.id);
    if (!record) {
      record = { roundId: round.id, date: round.date, courseName: round.courseName, ownerName: round.ownerName, totalMoney: 0, entries: [] };
      rival.records.push(record);
    }
    const componentMoney = result.componentMoney || {};
    const matchMoney = Object.entries(componentMoney).filter(([key]) => key.startsWith("match")).reduce((sum, [, value]) => sum + value, 0);
    const medalMoney = Object.entries(componentMoney).filter(([key]) => key.startsWith("medal")).reduce((sum, [, value]) => sum + value, 0);
    const firstMoney = (componentMoney.match1 || 0) + (componentMoney.medal1 || 0);
    const secondMoney = (componentMoney.match2 || 0) + (componentMoney.medal2 || 0);
    const total18Money = (componentMoney.match18 || 0) + (componentMoney.medal18 || 0);
    const pressureMultiplier = Math.max(1, bet?.pressureMultiplier ?? bet?.back9Multiplier ?? 1);
    const pressurePerWonComponent = (bet?.baseValue || 0) * (pressureMultiplier - 1);
    const pressureMoney = [componentMoney.match2 || 0, componentMoney.medal2 || 0]
      .reduce((sum, amount) => sum + (amount > 0 ? pressurePerWonComponent : amount < 0 ? -pressurePerWonComponent : 0), 0);
    record.entries.push({ ...result, resultIndex, rivalHandicap: handicap, betSnapshot: bet, matchMoney, medalMoney });
    record.totalMoney += result.totalMoney;
    rival.total += result.totalMoney;
    rival.bets += 1;
    rival.wonMoney += Math.max(0, result.totalMoney);
    rival.lostMoney += Math.max(0, -result.totalMoney);
    rival.matchMoney += matchMoney;
    rival.medalMoney += medalMoney;
    rival.pressureMoney += pressureMoney;
    rival.firstMoney += firstMoney;
    rival.secondMoney += secondMoney;
    rival.total18Money += total18Money;
    rivals.set(key, rival);
  }
  for (const rival of rivals.values()) {
    rival.rounds = rival.records.length;
    rival.wins = rival.records.filter((record) => record.totalMoney > 0).length;
    rival.losses = rival.records.filter((record) => record.totalMoney < 0).length;
    rival.ties = rival.rounds - rival.wins - rival.losses;
  }
  return [...rivals.values()].sort((a, b) => {
    const metric = sort === "played" ? b.rounds - a.rounds : sort === "won" ? b.total - a.total : sort === "lost" ? a.total - b.total : 0;
    return metric || b.records[0].date.localeCompare(a.records[0].date) || a.name.localeCompare(b.name, "es-MX");
  });
}
