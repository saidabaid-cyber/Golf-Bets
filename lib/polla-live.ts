import type { HandicapMode } from "./types";

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
  const size = Math.min(5, Math.max(3, Math.round(preferredSize)));
  const groups: PollaPlayerInput[][] = [];
  for (let index = 0; index < players.length; index += size) groups.push(players.slice(index, index + size));
  if (groups.length > 1 && groups.at(-1)!.length < 3) {
    const tail = groups.pop()!;
    tail.forEach((player, index) => groups[index % groups.length].push(player));
  }
  return groups;
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
