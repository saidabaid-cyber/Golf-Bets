import type { RoundSnapshot, Player } from "./types";

/** Never merge mutable draft objects into an existing historical object. */
export function upsertRoundSnapshot(history: RoundSnapshot[], next: RoundSnapshot) {
  const previous = history.find(round => round.id === next.id);
  const saved = structuredClone({ ...next, photoId: next.photoId ?? previous?.photoId,
    completedAt: previous?.completedAt ?? next.completedAt });
  return [saved, ...history.filter(round => round.id !== next.id)];
}

export function canEditSnapshot(round: RoundSnapshot) {
  return Boolean(round.players?.length && round.courseSnapshot && round.scores && round.betConfig && round.order?.length &&
    (!round.betConfig.foursome.enabled || round.segments?.length));
}

export function restoreRoundSnapshot(round: RoundSnapshot) {
  if (!canEditSnapshot(round)) return null;
  const copy = structuredClone(round);
  return { ...copy, ownerId: copy.ownerId || copy.players!.find(player => player.name === copy.ownerName)?.id || copy.players![0].id };
}

export function resultSummaryText(course: string, date: string, players: Pick<Player, "id" | "name">[], balances: Record<string, number>, ownerId: string, expenses: number) {
  const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
  const day = new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
  return ["THE BACKYARD", `${course} · ${day}`, "", ...players.map(player => `${player.name} ${money(balances[player.id] || 0)}`),
    ...(expenses ? ["", `${players.find(player => player.id === ownerId)?.name || "Jugador principal"} · Apuestas ${money(balances[ownerId] || 0)} · Gastos ${money(-expenses)} · Neto ${money((balances[ownerId] || 0) - expenses)}`] : [])].join("\n");
}
