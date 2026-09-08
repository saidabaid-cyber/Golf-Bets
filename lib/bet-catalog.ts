import type { RoundPresentation, SupplementalBet } from "./types";
import { groupNassauHistoricalLabel } from "./round-presentation";

export const BET_PRESENTATION = {
  rabbits: { icon: "🐇", title: "Conejos" },
  skins: { icon: "⛳", title: "Skins" },
  units: { icon: "📏", title: "Unidades / Copas" },
  foursome: { icon: "🤝", title: "Foursome" },
  ball_friend: { icon: "⚪🤝", title: "Bola Amiga" },
  monkey: { icon: "🐒", title: "Monkey" },
  polla_first: { icon: "🥈", title: "Polla 1ª vuelta" },
  polla_second: { icon: "🥈", title: "Polla 2ª vuelta" },
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

type HistoricalBetPresentation = {
  icon: string;
  title: string;
  aliases: readonly string[];
};

const HISTORICAL_BET_PRESENTATIONS: readonly HistoricalBetPresentation[] = [
  { ...BET_PRESENTATION.rabbits, aliases: ["Conejos"] },
  { ...BET_PRESENTATION.skins, aliases: ["Skins"] },
  { ...BET_PRESENTATION.units, aliases: ["Unidades", "Unidades / Copas"] },
  { ...BET_PRESENTATION.monkey, aliases: ["Monkey"] },
  { ...BET_PRESENTATION.foursome, aliases: ["Foursome"] },
  { ...BET_PRESENTATION.ball_friend, aliases: ["Bola Amiga"] },
  { ...BET_PRESENTATION.polla_first, aliases: ["Polla 1ª vuelta", "Polla H1–9"] },
  { ...BET_PRESENTATION.polla_second, aliases: ["Polla 2ª vuelta", "Polla H10–18"] },
  { ...BET_PRESENTATION.polla_total, aliases: ["Polla Nassau", "Polla 18 hoyos"] },
  { ...BET_PRESENTATION.mini_polla, aliases: ["Mini Polla"] },
  { ...BET_PRESENTATION.vipers, aliases: ["Víboras"] },
  { ...BET_PRESENTATION.camels, aliases: ["Camellos"] },
  { ...BET_PRESENTATION.fish, aliases: ["Peces"] },
  { ...BET_PRESENTATION.loba, aliases: ["Loba"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.team_pressures, aliases: ["Presiones por parejas"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.chicago, aliases: ["Chicago"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.vegas, aliases: ["Vegas"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.minimum_putts, aliases: ["Mínimo de Putts"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.individual_nassau, aliases: ["Nassau individual"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.dollar_stroke, aliases: ["Dollar a Stroke", "Dollar a stroke"] },
  { ...SUPPLEMENTAL_BET_PRESENTATION.individual_pressures, aliases: ["Presiones individuales"] },
  { ...BET_PRESENTATION.manuals, aliases: ["Manuales", "Apuestas Manuales"] },
  { ...BET_PRESENTATION.personals, aliases: ["Personales"] },
];

const HISTORICAL_BET_ICONS = [...new Set(HISTORICAL_BET_PRESENTATIONS.map((entry) => entry.icon))]
  .sort((left, right) => right.length - left.length);

/** Present persisted category keys without rewriting historical snapshots.
 * Legacy labels and numbered supplemental instances resolve through the same
 * metadata used by Configuración and Resultados. Unknown custom labels are
 * kept verbatim so old or manual data is never hidden. */
export function historicalBetDisplayLabel(label: string, roundPresentation?: RoundPresentation) {
  const original = groupNassauHistoricalLabel(label.trim(), roundPresentation);
  const leadingIcon = HISTORICAL_BET_ICONS.find((icon) => original.startsWith(icon));
  const undecorated = leadingIcon ? original.slice(leadingIcon.length).trimStart() : original;
  const comparable = undecorated.toLocaleLowerCase("es-MX");

  for (const presentation of HISTORICAL_BET_PRESENTATIONS) {
    for (const alias of presentation.aliases) {
      const comparableAlias = alias.toLocaleLowerCase("es-MX");
      if (comparable === comparableAlias) return `${presentation.icon} ${presentation.title}`;
      if (comparable.startsWith(`${comparableAlias} `) || comparable.startsWith(`${comparableAlias} ·`)) {
        return `${presentation.icon} ${presentation.title}${undecorated.slice(alias.length)}`;
      }
    }
  }

  return original;
}
