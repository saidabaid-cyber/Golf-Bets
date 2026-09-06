"use client";

import { profileHandicapLabel } from "../../lib/account-state";
import type { PrivateLeaderboardRow } from "../../lib/round-utils";

export type GolfLeaderboardMode = "gross" | "net";

type RankedGolfRow = {
  row: PrivateLeaderboardRow;
  position: string;
};

function selectedRelativeToPar(row: PrivateLeaderboardRow, mode: GolfLeaderboardMode) {
  if (row.thru === 0) return null;
  if (mode === "gross") return row.relativeToPar;
  if (row.net === null) return null;
  const playedPar = row.gross - row.relativeToPar;
  return row.net - playedPar;
}

export function rankGolfLeaderboard(rows: readonly PrivateLeaderboardRow[], mode: GolfLeaderboardMode): RankedGolfRow[] {
  const sorted = [...rows].sort((left, right) => {
    const leftScore = selectedRelativeToPar(left, mode);
    const rightScore = selectedRelativeToPar(right, mode);
    if (leftScore === null && rightScore !== null) return 1;
    if (leftScore !== null && rightScore === null) return -1;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return leftScore - rightScore;
    if (left.thru !== right.thru) return right.thru - left.thru;
    if (left.gross !== right.gross) return left.gross - right.gross;
    return left.name.localeCompare(right.name, "es-MX");
  });
  const rankKey = (row: PrivateLeaderboardRow) => {
    const score = selectedRelativeToPar(row, mode);
    return score === null ? null : String(score);
  };
  const occurrences = new Map<string, number>();
  for (const row of sorted) {
    const key = rankKey(row);
    if (key !== null) occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }
  const firstPosition = new Map<string, number>();
  return sorted.map((row, index) => {
    const key = rankKey(row);
    if (key === null) return { row, position: "—" };
    if (!firstPosition.has(key)) firstPosition.set(key, index + 1);
    const position = firstPosition.get(key) || index + 1;
    return { row, position: (occurrences.get(key) || 0) > 1 ? `T${position}` : String(position) };
  });
}

function relativeToPar(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "E";
  return `${value > 0 ? "+" : ""}${value}`;
}

export function GolfLeaderboard({ rows, mode, onModeChange, context }: {
  rows: readonly PrivateLeaderboardRow[];
  mode: GolfLeaderboardMode;
  onModeChange: (mode: GolfLeaderboardMode) => void;
  context: "live" | "results";
}) {
  const hasScores = rows.some((row) => row.thru > 0);
  const final = hasScores && rows.every((row) => row.finished);
  const ranked = rankGolfLeaderboard(rows, mode);

  return <div className="golfLeaderboard">
    <div className="sectionTitle">
      <div>
        {context === "live"
          ? <h2>Leaderboard de la ronda</h2>
          : <h3>{final ? "Clasificación final" : "Clasificación provisional"}</h3>}
        <p>{final ? "Tarjetas completas con el HCP usado en esta ronda." : "Se actualiza sólo con scores confirmados; los hoyos pendientes no se inventan."}</p>
      </div>
      <div className="segmented" aria-label="Ordenar clasificación de golf">
        <button type="button" className={mode === "gross" ? "active" : ""} aria-pressed={mode === "gross"} onClick={() => onModeChange("gross")}>Gross</button>
        <button type="button" className={mode === "net" ? "active" : ""} aria-pressed={mode === "net"} onClick={() => onModeChange("net")}>Neto</button>
      </div>
    </div>
    {!hasScores ? <div className="empty">Aún no hay scores confirmados para clasificar.</div> : <div className="tableWrap" tabIndex={0} aria-label="Clasificación de golf, desliza horizontalmente">
      <table><thead><tr><th>Pos</th><th>Jugador</th><th>HCP</th><th>Gross</th><th>Neto</th><th>{mode === "gross" ? "Gross" : "Neto"} +/− Par</th><th>Thru</th></tr></thead><tbody>{ranked.map(({ row, position }) => <tr key={row.playerId}>
        <td><b>{position}</b></td>
        <td><b>{row.name || "Sin nombre"}</b></td>
        <td>{row.handicap === null ? "—" : profileHandicapLabel(row.handicap)}</td>
        <td>{row.thru ? row.gross : "—"}</td>
        <td>{row.thru ? row.net ?? "—" : "—"}</td>
        <td>{relativeToPar(selectedRelativeToPar(row, mode))}</td>
        <td>{row.finished ? "F" : row.thru || "—"}</td>
      </tr>)}</tbody></table>
    </div>}
  </div>;
}
