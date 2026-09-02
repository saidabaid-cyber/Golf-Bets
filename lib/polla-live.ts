import type { HandicapMode } from "./types";
import { groupSizes, type GroupTarget } from "./group-generator";

export type PollaFormat = "gross" | "net" | "both";
export type PollaStatus = "upcoming" | "live" | "finished";

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
  thru: number;
  finished: boolean;
};

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

export function rankPollaLeaderboard(rows: PollaLeaderboardRow[], mode: "gross" | "net" = "net") {
  const key = mode === "gross" ? "gross" : "net";
  return [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.thru !== b.thru && !a.finished) return b.thru - a.thru;
    return a[key] - b[key] || a.name.localeCompare(b.name, "es-MX");
  });
}
