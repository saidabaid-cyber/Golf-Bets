import type { SupplementalBet } from "./types";

export const BET_PRESENTATION = {
  rabbits: { icon: "🐇", title: "Conejos" },
  skins: { icon: "⛳", title: "Skins" },
  units: { icon: "📏", title: "Unidades / Copas" },
  foursome: { icon: "🤝", title: "Foursome" },
  ball_friend: { icon: "⚪🤝", title: "Bola Amiga" },
  monkey: { icon: "🐒", title: "Monkey" },
  polla_first: { icon: "🥈", title: "Polla H1–9" },
  polla_second: { icon: "🥈", title: "Polla H10–18" },
  polla_total: { icon: "🏆", title: "Polla 18 hoyos" },
  mini_polla: { icon: "⚡", title: "Mini Polla" },
  vipers: { icon: "🐍", title: "Víboras" },
  camels: { icon: "🐫", title: "Camellos" },
  fish: { icon: "🐟", title: "Peces" },
  loba: { icon: "🐺", title: "Loba" },
  manuals: { icon: "✍️", title: "Apuestas Manuales" },
  personals: { icon: "↔", title: "Personales" },
} as const;

export type BetPresentationKey = keyof typeof BET_PRESENTATION;

export function betDisplayLabel(kind: BetPresentationKey, title: string = BET_PRESENTATION[kind].title) {
  const icon = BET_PRESENTATION[kind].icon;
  return title.startsWith(icon) ? title : `${icon} ${title}`;
}

export const SUPPLEMENTAL_BET_PRESENTATION: Record<SupplementalBet["type"], { icon: string; title: string; description: string }> = {
  individual_nassau: { icon: "🏌️", title: "Nassau individual", description: "Jugador vs jugador · ida, vuelta y total" },
  dollar_stroke: { icon: "💵", title: "Dollar a Stroke", description: "Diferencia de golpes netos · pago por golpe" },
  individual_pressures: { icon: "⚡", title: "Presiones individuales", description: "Duelo hoyo por hoyo · al perder se abre nueva presión" },
  team_pressures: { icon: "🤝", title: "Presiones por parejas", description: "Low Ball / High Ball por equipos · con presiones" },
  chicago: { icon: "🌆", title: "Chicago", description: "Puntos contra cuota según handicap" },
  vegas: { icon: "🎲", title: "Vegas", description: "Scores de pareja concatenados · diferencia por unidad" },
  minimum_putts: { icon: "⛳", title: "Mínimo de Putts", description: "Menos putts de la ronda gana el ante" },
};

export function supplementalBetDisplayLabel(type: SupplementalBet["type"], title = SUPPLEMENTAL_BET_PRESENTATION[type].title) {
  const icon = SUPPLEMENTAL_BET_PRESENTATION[type].icon;
  return title.startsWith(icon) ? title : `${icon} ${title}`;
}
