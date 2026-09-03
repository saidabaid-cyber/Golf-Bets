import { personalRivalKey } from "./engine";
import type { PersonalBet, PersonalHistoryResult, Player, RoundSnapshot } from "./types";

export type PersonalHistoryPeriod = "all" | "year" | "month";
export type PersonalHistorySort = "recent" | "played" | "won" | "lost";
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");

export function snapshotPersonalResult(
  bet: PersonalBet,
  result: { totalMoney: number; componentMoney: Record<string, number> },
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
  wins: number;
  losses: number;
  ties: number;
  matchMoney: number;
  medalMoney: number;
  records: RivalHistoryRound[];
};

export function buildPersonalHistory(
  history: RoundSnapshot[],
  today: string,
  period: PersonalHistoryPeriod = "all",
  sort: PersonalHistorySort = "recent",
): RivalHistory[] {
  const entries = history.flatMap((round) => (round.personalResults || []).map((result, resultIndex) => {
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
    const key = stableId ? `template:${stableId}` : `name:${normalizedName || result.rivalKey}`;
    const rival = rivals.get(key) || { key, name: result.rivalName, total: 0, rounds: 0, wins: 0, losses: 0, ties: 0, matchMoney: 0, medalMoney: 0, records: [] };
    let record = rival.records.find((item) => item.roundId === round.id);
    if (!record) {
      record = { roundId: round.id, date: round.date, courseName: round.courseName, ownerName: round.ownerName, totalMoney: 0, entries: [] };
      rival.records.push(record);
    }
    const componentMoney = result.componentMoney || {};
    const matchMoney = Object.entries(componentMoney).filter(([key]) => key.startsWith("match")).reduce((sum, [, value]) => sum + value, 0);
    const medalMoney = Object.entries(componentMoney).filter(([key]) => key.startsWith("medal")).reduce((sum, [, value]) => sum + value, 0);
    record.entries.push({ ...result, resultIndex, rivalHandicap: handicap, betSnapshot: bet, matchMoney, medalMoney });
    record.totalMoney += result.totalMoney;
    rival.total += result.totalMoney;
    rival.matchMoney += matchMoney;
    rival.medalMoney += medalMoney;
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
