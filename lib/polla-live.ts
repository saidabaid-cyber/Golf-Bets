import type { HandicapMode } from "./types";
import { groupSizes, type GroupTarget } from "./group-generator";
import { playingHandicap, strokeAllowanceForHole } from "./engine";

export type PollaFormat = "gross" | "net" | "both";
export type PollaStatus = "upcoming" | "live" | "finished";
export type PollaAccessRole = "owner" | "admin" | "scorer" | "viewer";

export type PollaPlayerInput = {
  id: string;
  name: string;
  handicap: number;
  group?: string;
  startHole?: 1 | 10;
  teeTime?: string;
};

export type PollaTournamentDraft = {
  name: string;
  date: string;
  courseName: string;
  holes: 9 | 18;
  startHole: 1 | 10;
  format: PollaFormat;
  hcpPct: number;
  handicapMode: HandicapMode;
  localRules: string;
  players: PollaPlayerInput[];
};

export type PollaLeaderboardRow = {
  playerId: string;
  name: string;
  handicap: number;
  gross: number;
  net: number;
  relativeToPar: number;
  grossRelativeToPar?: number;
  netRelativeToPar?: number;
  thru: number;
  finished: boolean;
  groupId?: string;
  groupName?: string;
};

export type PollaLeaderboardScope = "all" | "front9" | "back9";
export type PollaLeaderboardPlayer = { id: string; name: string; handicap: number; groupId?: string; groupName?: string };
export type PollaLeaderboardScore = { playerId: string; hole: number; score: number };

export type CsvIssue = { row: number; message: string };

export function parsePollaPlayersCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const issues: CsvIssue[] = [];
  if (!lines.length) return { players: [] as PollaPlayerInput[], issues: [{ row: 1, message: "El CSV está vacío." }] };
  const headers = lines[0].split(",").map((header) => header.trim());
  const required = ["name", "handicap"];
  for (const key of required) if (!headers.includes(key)) issues.push({ row: 1, message: `Falta la columna ${key}.` });
  if (issues.length) return { players: [] as PollaPlayerInput[], issues };

  const players = lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const value = (key: string) => cells[headers.indexOf(key)] || "";
    const handicap = Number(value("handicap"));
    const startHoleRaw = Number(value("startHole") || 1);
    if (!value("name")) issues.push({ row: index + 2, message: "Nombre vacío." });
    if (!Number.isFinite(handicap) || handicap < -15 || handicap > 54) issues.push({ row: index + 2, message: "HCP inválido." });
    if (startHoleRaw !== 1 && startHoleRaw !== 10) issues.push({ row: index + 2, message: "startHole debe ser 1 o 10." });
    return {
      id: `csv-${index + 1}`,
      name: value("name"),
      handicap: Number.isFinite(handicap) ? handicap : 0,
      group: value("group") || undefined,
      startHole: startHoleRaw === 10 ? 10 as const : 1 as const,
      teeTime: value("teeTime") || undefined,
    };
  });
  return { players: issues.length ? [] : players, issues };
}

export function autoGroupPollaPlayers(players: PollaPlayerInput[], preferredSize = 4) {
  const size = Math.min(5, Math.max(3, Math.round(preferredSize))) as GroupTarget;
  const sizes = groupSizes(players.length, size);
  if (!sizes.length) return [];
  const groups: PollaPlayerInput[][] = [];
  let offset = 0;
  for (const groupSize of sizes) {
    groups.push(players.slice(offset, offset + groupSize));
    offset += groupSize;
  }
  return groups;
}

export type PollaCourseHole = { number: number; par: number };

export function pollaHoleOrder(startHole: 1 | 10, holes: 9 | 18) {
  const fullOrder = startHole === 10
    ? [...Array.from({ length: 9 }, (_, index) => index + 10), ...Array.from({ length: 9 }, (_, index) => index + 1)]
    : Array.from({ length: 18 }, (_, index) => index + 1);
  return fullOrder.slice(0, holes);
}

export function pollaParForHole(courseSnapshot: PollaCourseHole[] | null | undefined, hole: number, fallback = 4) {
  const par = courseSnapshot?.find((candidate) => candidate.number === hole)?.par;
  return typeof par === "number" && Number.isFinite(par) && par > 0 ? par : fallback;
}

export function initializePollaHoleScores(
  scores: Record<string, number>,
  playerIds: string[],
  hole: number,
  courseSnapshot: PollaCourseHole[] | null | undefined,
) {
  const next = { ...scores };
  const par = pollaParForHole(courseSnapshot, hole);
  for (const playerId of playerIds) {
    const key = `${playerId}:${hole}`;
    if (typeof next[key] !== "number" || !Number.isFinite(next[key]) || next[key] < 1) next[key] = par;
  }
  return next;
}

export function nextPollaHole(currentHole: number, startHole: 1 | 10, holes: 9 | 18) {
  const order = pollaHoleOrder(startHole, holes);
  const index = order.indexOf(currentHole);
  if (index < 0) return order[0] ?? null;
  return order[index + 1] ?? null;
}

export function normalizeOyesDistance(value: number, unit: "m" | "cm" | "ft_in", inches = 0) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(inches) || inches < 0) throw new Error("Distancia inválida");
  if (unit === "cm") return value / 100;
  if (unit === "ft_in") return value * 0.3048 + inches * 0.0254;
  return value;
}

export function normalizePollaHcpPercentage(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 100;
}

export function canEditPollaScore(input: {
  role: PollaAccessRole;
  sessionGroupId?: string | null;
  targetGroupId: string;
  cardStatus: "open" | "confirmed";
}) {
  if (input.role === "viewer") return false;
  if (input.role === "scorer") return input.cardStatus === "open" && input.sessionGroupId === input.targetGroupId;
  return input.role === "owner" || input.role === "admin";
}

export function hasPollaScoreConflict(baseUpdatedAt: string | undefined, cloudUpdatedAt: string | undefined) {
  if (!cloudUpdatedAt) return false;
  return !baseUpdatedAt || baseUpdatedAt !== cloudUpdatedAt;
}

export function buildPollaLeaderboard(input: {
  players: PollaLeaderboardPlayer[];
  scores: PollaLeaderboardScore[];
  courseSnapshot: Array<{ number: number; par: number; strokeIndex?: number }>;
  tournamentHoles: 9 | 18;
  startHole: 1 | 10;
  hcpPct: number;
  handicapMode: HandicapMode;
  scope?: PollaLeaderboardScope;
  groupId?: string;
}) {
  const scope = input.scope || "all";
  const tournamentOrder = pollaHoleOrder(input.startHole, input.tournamentHoles);
  const scopedOrder = tournamentOrder.filter((hole) => scope === "all" || (scope === "front9" ? hole <= 9 : hole >= 10));
  const allowedHoles = new Set(scopedOrder);
  const parByHole = new Map(input.courseSnapshot.map((hole) => [hole.number, hole.par]));
  const strokeIndexByHole = new Map(input.courseSnapshot.map((hole) => [hole.number, hole.strokeIndex || hole.number]));
  const scoresByPlayer = new Map<string, PollaLeaderboardScore[]>();
  for (const score of input.scores) {
    if (!allowedHoles.has(score.hole)) continue;
    const current = scoresByPlayer.get(score.playerId) || [];
    current.push(score);
    scoresByPlayer.set(score.playerId, current);
  }
  return input.players.filter((player) => !input.groupId || player.groupId === input.groupId).map((player): PollaLeaderboardRow => {
    const own = scoresByPlayer.get(player.id) || [];
    const gross = own.reduce((sum, score) => sum + score.score, 0);
    const par = own.reduce((sum, score) => sum + (parByHole.get(score.hole) || 4), 0);
    const playingHcp = playingHandicap(Math.max(0, Number(player.handicap)), input.hcpPct, input.handicapMode);
    const allowance = own.reduce((sum, score) => sum + strokeAllowanceForHole(playingHcp, strokeIndexByHole.get(score.hole) || score.hole, input.handicapMode), 0);
    const net = gross - allowance;
    const grossRelativeToPar = gross - par;
    const netRelativeToPar = net - par;
    return {
      playerId: player.id,
      name: player.name,
      handicap: Number(player.handicap),
      gross,
      net,
      relativeToPar: netRelativeToPar,
      grossRelativeToPar,
      netRelativeToPar,
      thru: own.length,
      finished: scopedOrder.length > 0 && own.length === scopedOrder.length,
      groupId: player.groupId,
      groupName: player.groupName,
    };
  });
}

export function rankPollaLeaderboard(rows: PollaLeaderboardRow[], mode: "gross" | "net" = "net") {
  const key = mode === "gross" ? "gross" : "net";
  return [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.thru !== b.thru && !a.finished) return b.thru - a.thru;
    return a[key] - b[key] || a.name.localeCompare(b.name, "es-MX");
  });
}
