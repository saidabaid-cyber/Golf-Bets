import type { RabbitEvent } from "./engine";
import type { RabbitMode } from "./types";

export function priorRabbitStatus(events: RabbitEvent[], pending: number, value: number, playerName: (id: string) => string, mode: RabbitMode = "continuous", currentHole?: number) {
  const rabbitNumber = currentHole ? Math.floor((currentHole - 1) / 3) + 1 : undefined;
  const relevantEvents = mode === "three_hole_blocks" && rabbitNumber
    ? events.filter((event) => event.rabbitNumber === rabbitNumber)
    : events;
  const wonInBlock = relevantEvents.find((event) => event.type === "win" && event.playerId);
  if (mode === "three_hole_blocks" && rabbitNumber && wonInBlock?.playerId) {
    return [`Conejo ${rabbitNumber} ya ganado por ${playerName(wonInBlock.playerId)}`, rabbitNumber < 6 ? `Nuevo conejo al iniciar H${rabbitNumber * 3 + 1}` : "Último bloque cerrado"];
  }
  const last = relevantEvents.at(-1);
  const holder = last && (last.type === "grab" || last.type === "hold") && last.playerId ? playerName(last.playerId) : "";
  const activePending = mode === "three_hole_blocks" ? 1 : pending;
  const amount = Math.max(1, activePending) * value;
  return holder
    ? [`${holder} trae el Conejo`, `En juego $${amount.toLocaleString("es-MX")}`]
    : [mode === "three_hole_blocks" && rabbitNumber ? `Conejo ${rabbitNumber} libre` : "Conejo libre", `${activePending > 1 ? "Acumula" : "En juego"} $${amount.toLocaleString("es-MX")}`];
}

export function priorSkinsStatus(carry: number, value: number) {
  const active = Math.max(1, carry);
  if (active > 1) return [
    "Skin se acumula",
    `Próximo hoyo: ${active} skins · $${(active * value).toLocaleString("es-MX")} en juego`,
  ];
  return [`Skin actual: $${value.toLocaleString("es-MX")}`, "Sin carry pendiente"];
}
