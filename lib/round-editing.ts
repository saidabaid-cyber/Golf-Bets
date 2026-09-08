import type { PersonalBet, RoundSnapshot, Player } from "./types";
import { migrateSupplementalNassau } from "./nassau-migration";
import { migratePersonalNassau } from "./personal-nassau";
import { restoreBetConfig } from "./new-round-bets";
import { normalizeAdvancedStats, normalizeScoreCaptureMode } from "./advanced-stats";
import { normalizeRoundPresentation } from "./round-presentation";

/** Never merge mutable draft objects into an existing historical object. */
export function upsertRoundSnapshot(history: RoundSnapshot[], next: RoundSnapshot) {
  const previous = history.find(round => round.id === next.id);
  const saved = structuredClone({ ...next, photoId: next.photoId ?? previous?.photoId,
    scorecardPhotoIds: next.scorecardPhotoIds ?? previous?.scorecardPhotoIds,
    presentation: next.presentation ?? previous?.presentation,
    startedAt: previous?.startedAt ?? next.startedAt,
    completedAt: previous?.completedAt ?? next.completedAt });
  return [saved, ...history.filter(round => round.id !== next.id)];
}

export function canEditSnapshot(round: RoundSnapshot) {
  return Boolean(round.players?.length && round.courseSnapshot && round.scores && round.betConfig && round.order?.length
    && (!round.betConfig.foursome?.enabled || round.segments?.length));
}

export function restoreRoundSnapshot(round: RoundSnapshot) {
  if (!canEditSnapshot(round)) return null;
  const copy = structuredClone(round);
  const startHole: 1 | 10 = copy.order![0] === 10 ? 10 : copy.order![0] === 1 ? 1 : copy.startHole === 10 ? 10 : 1;
  const roundHoles: 9 | 18 = copy.order!.length === 9 ? 9 : copy.order!.length === 18 ? 18 : copy.roundHoles === 9 ? 9 : 18;
  const restored = {
    ...copy,
    ...(copy.presentation === undefined ? {} : { presentation: normalizeRoundPresentation(copy.presentation) }),
    ownerId: copy.ownerId || copy.players!.find(player => player.name === copy.ownerName)?.id || copy.players![0].id,
    betConfig: restoreBetConfig(copy.betConfig, copy.players!.map((player) => player.id), { startHole, roundHoles }),
  };
  const migrated = migrateSupplementalNassau(restored);
  return {
    ...migrated,
    ...(migrated.scoreCaptureMode === undefined ? {} : { scoreCaptureMode: normalizeScoreCaptureMode(migrated.scoreCaptureMode) }),
    ...(migrated.advancedStats === undefined ? {} : { advancedStats: normalizeAdvancedStats(migrated.advancedStats) }),
    personalBets: migrated.personalBets?.map((bet) => {
      const legacy = bet as PersonalBet & { advantageReceiverId?: string };
      if (legacy.nassauVersion === 2) return migratePersonalNassau(legacy, startHole, roundHoles);
      const advantageReceiver = legacy.advantageReceiver === "owner" || legacy.advantageReceiver === "rival" || legacy.advantageReceiver === "none"
        ? legacy.advantageReceiver
        : legacy.advantageReceiverId ? (legacy.advantageReceiverId === migrated.ownerId ? "owner" : "rival") : "rival";
      return migratePersonalNassau({
        ...legacy,
        advantageReceiver,
        advantageStrokes: advantageReceiver === "none" ? 0 : legacy.advantageStrokes ?? 0,
      }, startHole, roundHoles);
    }),
  };
}

export function resultSummaryText(course: string, date: string, players: Pick<Player, "id" | "name">[], balances: Record<string, number>, ownerId: string, expenses: number) {
  const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
  const day = new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
  return ["THE BACKYARD", `${course} · ${day}`, "", ...players.map(player => `${player.name} ${money(balances[player.id] || 0)}`),
    ...(expenses ? ["", `${players.find(player => player.id === ownerId)?.name || "Jugador principal"} · Apuestas ${money(balances[ownerId] || 0)} · Gastos ${money(-expenses)} · Neto ${money((balances[ownerId] || 0) - expenses)}`] : [])].join("\n");
}
