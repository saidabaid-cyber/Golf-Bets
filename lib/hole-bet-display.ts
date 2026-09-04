import type { BallFriendHole, LobaHole, Player } from "./types";

export type SkinHoleEvent = {
  winnerId?: string;
  count: number;
  carry: number;
};

const pesos = (value: number) => `$${value.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;

export function skinHoleNotice(
  event: SkinHoleEvent | undefined,
  value: number,
  finalHole: boolean,
  playerName: (id: string) => string,
) {
  if (!event) return [];
  if (event.winnerId) {
    return [`⛳ ${playerName(event.winnerId)} gana ${event.count} skin${event.count === 1 ? "" : "s"}`];
  }

  const accumulated = Math.max(1, event.carry);
  if (finalHole) {
    return [`⛳ Skin sin ganador · ${accumulated} skin${accumulated === 1 ? "" : "s"} acumulado${accumulated === 1 ? "" : "s"}`];
  }

  return [
    "⛳ Skin se acumula",
    `Próximo hoyo: ${accumulated} skin${accumulated === 1 ? "" : "s"} · ${pesos(accumulated * value)} en juego`,
  ];
}

export function playerHoleBetLabels(
  playerId: string,
  loba: LobaHole | undefined,
  ballFriend: BallFriendHole | undefined,
  ballFriendParticipantIds: string[],
) {
  const labels: string[] = [];
  if (loba?.lobaPlayerId === playerId) labels.push("🐺 Loba");
  if (loba?.mode === "partner" && loba.partnerId === playerId) labels.push("Pareja Loba");

  if (ballFriend?.restPlayerId === playerId) {
    labels.push("Descansa");
  } else if (ballFriend?.teamA.includes(playerId)) {
    labels.push("Bola Amiga · Equipo 1");
  } else {
    const activeIds = ballFriendParticipantIds.filter(id => id !== ballFriend?.restPlayerId);
    if (ballFriend?.teamA.length === 2 && activeIds.length === 4 && activeIds.includes(playerId)) {
      labels.push("Bola Amiga · Equipo 2");
    }
  }

  return labels;
}

export function lobaSetupChipLabel(loba: LobaHole | undefined, players: Player[]) {
  const lobaPlayer = players.find(player => player.id === loba?.lobaPlayerId);
  if (!lobaPlayer || !loba?.mode) return "🐺 Elegir Loba";
  if (loba.mode === "partner") {
    const partner = players.find(player => player.id === loba.partnerId);
    return partner ? `🐺 ${lobaPlayer.name} + ${partner.name}` : "🐺 Elegir Loba";
  }
  return `🐺 ${lobaPlayer.name} · ${loba.mode === "solo_anticipated" ? "Sola anticipada" : "Va sola"}`;
}

export function ballFriendSetupChipLabel(ballFriend: BallFriendHole | undefined, players: Player[], participantIds: string[]) {
  if (!ballFriend || ballFriend.teamA.length !== 2) return "⚪🤝 Elegir Bola Amiga";
  const activeIds = participantIds.filter(id => id !== ballFriend.restPlayerId);
  const teamB = activeIds.filter(id => !ballFriend.teamA.includes(id));
  if (activeIds.length !== 4 || teamB.length !== 2) return "⚪🤝 Elegir Bola Amiga";
  const name = (id: string) => players.find(player => player.id === id)?.name || "Sin nombre";
  return `⚪🤝 ${ballFriend.teamA.map(name).join("/")} vs ${teamB.map(name).join("/")}`;
}

export function ballFriendScoreResult(
  detail: { pointDiff: number },
  value: number,
) {
  if (detail.pointDiff === 0) return "🤝 Bola Amiga · Empate · $0";
  const team = detail.pointDiff > 0 ? "Equipo 1" : "Equipo 2";
  return `🤝 Bola Amiga · Ganó ${team} · ${pesos(Math.abs(detail.pointDiff) * value)} por jugador`;
}
