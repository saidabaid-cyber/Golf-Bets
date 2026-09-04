import type { BallFriendHole, LobaHole } from "./types";

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
