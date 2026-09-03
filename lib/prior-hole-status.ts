import type { RabbitEvent } from "./engine";

export function priorRabbitStatus(events: RabbitEvent[], pending: number, value: number, playerName: (id: string) => string) {
  const last = events.at(-1);
  const holder = last && (last.type === "grab" || last.type === "hold") && last.playerId ? playerName(last.playerId) : "";
  const amount = Math.max(1, pending) * value;
  return holder
    ? [`${holder} trae el Conejo`, `En juego $${amount.toLocaleString("es-MX")}`]
    : ["Conejo libre", `${pending > 1 ? "Acumula" : "En juego"} $${amount.toLocaleString("es-MX")}`];
}

export function priorSkinsStatus(carry: number, value: number) {
  const active = Math.max(1, carry);
  const carriedHoles = Math.max(0, active - 1);
  return [
    `Skin actual: $${(active * value).toLocaleString("es-MX")}`,
    carriedHoles ? `Carry de ${carriedHoles} hoyo${carriedHoles === 1 ? "" : "s"}` : "Sin carry pendiente",
  ];
}
