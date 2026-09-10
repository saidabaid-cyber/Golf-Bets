import type { SupplementalBet } from "../types";

export type GolfCaptureFact = "score" | "putts" | "green_side_bunker" | "fairway_bunker" | "penalty_area" | "out_of_bounds" | "units";
export type BetConfigCapability = "money" | "participants" | "handicap_percentage" | "handicap_basis" | "carry" | "pressure" | "segments" | "teams" | "mode";
export type BetRegistryCategory = "group" | "counter" | "team" | "personal" | "supplemental" | "manual";

export type BetDefinition = {
  id: string;
  version: 1;
  label: string;
  description: string;
  icon: string;
  category: BetRegistryCategory;
  configPath: string;
  configCapabilities: readonly BetConfigCapability[];
  validation: "canonical" | "manual-zero-sum";
  captureRequirements: {
    requiresScore: true;
    requiresPutts: "never" | "active_participants";
    optionalFacts: readonly GolfCaptureFact[];
  };
  engineAdapter: string;
  resultPresenter: string;
  aiAliases: readonly string[];
  historyVersion: 1;
};

const definition = (value: BetDefinition) => value;

/**
 * Canonical semantic registry. Calculations remain in the existing deterministic
 * engines; this registry lets setup, AI, capture and history share one contract.
 */
export const BET_REGISTRY = [
  definition({ id: "rabbits", version: 1, label: "Conejos", description: "Conejo continuo o por bloques", icon: "🐇", category: "group", configPath: "bets.rabbits", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis", "carry", "mode"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateRabbits", resultPresenter: "rabbits", aiAliases: ["conejos", "conejo"], historyVersion: 1 }),
  definition({ id: "skins", version: 1, label: "Skins", description: "Valor por hoyo con carry opcional", icon: "⛳", category: "group", configPath: "bets.skins", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis", "carry"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateSkins", resultPresenter: "skins", aiAliases: ["skins", "skin"], historyVersion: 1 }),
  definition({ id: "units", version: 1, label: "Unidades / Copas", description: "Unidades firmadas por jugador", icon: "🪙", category: "group", configPath: "bets.units", configCapabilities: ["money", "participants"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: ["units"] }, engineAdapter: "calculateUnits", resultPresenter: "units", aiAliases: ["unidades", "copas", "copa"], historyVersion: 1 }),
  definition({ id: "foursome", version: 1, label: "Foursome", description: "Parejas por segmentos editables", icon: "🤝", category: "team", configPath: "bets.foursome", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis", "pressure", "segments", "teams", "mode"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateFoursome", resultPresenter: "foursome", aiAliases: ["foursome", "foursomes"], historyVersion: 1 }),
  definition({ id: "ball_friend", version: 1, label: "Bola Amiga", description: "Mejor bola por equipos", icon: "⚪🤝", category: "team", configPath: "bets.ballFriend", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis", "teams"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateBallFriend", resultPresenter: "ball_friend", aiAliases: ["bola amiga", "best ball"], historyVersion: 1 }),
  definition({ id: "monkey", version: 1, label: "Monkey", description: "Juego original de tres participantes", icon: "🐒", category: "group", configPath: "bets.monkey", configCapabilities: ["money", "participants", "handicap_percentage"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateMonkey", resultPresenter: "monkey", aiAliases: ["monkey", "changuitos"], historyVersion: 1 }),
  definition({ id: "polla_first", version: 1, label: "Polla 1ª vuelta", description: "Medal neto de la primera vuelta", icon: "🥈", category: "group", configPath: "bets.polla.first9", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculatePolla:first9", resultPresenter: "polla", aiAliases: ["polla primera vuelta", "polla front"], historyVersion: 1 }),
  definition({ id: "polla_second", version: 1, label: "Polla 2ª vuelta", description: "Medal neto de la segunda vuelta", icon: "🥈", category: "group", configPath: "bets.polla.second9", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculatePolla:second9", resultPresenter: "polla", aiAliases: ["polla segunda vuelta", "polla back"], historyVersion: 1 }),
  definition({ id: "polla_total", version: 1, label: "Polla 18 hoyos", description: "Medal neto total; puede presentarse como Nassau", icon: "🏆", category: "group", configPath: "bets.polla.total18", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculatePolla:total18", resultPresenter: "polla", aiAliases: ["polla", "nassau", "polla nassau"], historyVersion: 1 }),
  definition({ id: "mini_polla", version: 1, label: "Mini Polla", description: "Polla para una vuelta corta", icon: "⚡", category: "group", configPath: "bets.miniPolla", configCapabilities: ["money", "participants", "handicap_percentage", "handicap_basis"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateMiniPolla", resultPresenter: "polla", aiAliases: ["mini polla"], historyVersion: 1 }),
  definition({ id: "vipers", version: 1, label: "Víboras", description: "Derivada automáticamente de tres o más putts", icon: "🐍", category: "counter", configPath: "bets.vipers", configCapabilities: ["money", "participants", "pressure"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "active_participants", optionalFacts: ["putts"] }, engineAdapter: "calculateCounterBet:vipers", resultPresenter: "counter", aiAliases: ["víboras", "víbora", "viboritas", "viborita", "viboras", "vibora"], historyVersion: 1 }),
  definition({ id: "camels", version: 1, label: "Camellos", description: "Derivada de bunkers de green y fairway", icon: "🐫", category: "counter", configPath: "bets.camels", configCapabilities: ["money", "participants", "pressure"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: ["green_side_bunker", "fairway_bunker"] }, engineAdapter: "calculateCounterBet:camels", resultPresenter: "counter", aiAliases: ["camellos", "camello", "bunkers"], historyVersion: 1 }),
  definition({ id: "fish", version: 1, label: "Peces", description: "Derivada de entradas a área de penalidad", icon: "🐟", category: "counter", configPath: "bets.fish", configCapabilities: ["money", "participants", "pressure"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: ["penalty_area"] }, engineAdapter: "calculateCounterBet:fish", resultPresenter: "counter", aiAliases: ["peces/agua", "peces", "pez", "agua", "penalty area"], historyVersion: 1 }),
  definition({ id: "loba", version: 1, label: "Loba", description: "Lobo solo o con pareja", icon: "🐺", category: "team", configPath: "bets.loba", configCapabilities: ["money", "participants", "handicap_percentage", "teams", "mode"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: ["units"] }, engineAdapter: "calculateLoba", resultPresenter: "loba", aiAliases: ["loba", "lobo"], historyVersion: 1 }),
  definition({ id: "personals", version: 1, label: "Personales", description: "Duelo frecuente por índice actual o sliding", icon: "↔", category: "personal", configPath: "personalBets", configCapabilities: ["money", "participants", "handicap_basis", "carry", "pressure", "mode"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculatePersonalBets", resultPresenter: "personals", aiAliases: ["personal", "personales", "sliding"], historyVersion: 1 }),
  definition({ id: "individual_nassau", version: 1, label: "Nassau individual", description: "Jugador vs jugador · ida, vuelta y total", icon: "🏌️", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "handicap_percentage", "carry", "pressure"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateIndividualNassau", resultPresenter: "supplemental", aiAliases: ["nassau individual"], historyVersion: 1 }),
  definition({ id: "dollar_stroke", version: 1, label: "Dollar a Stroke", description: "Diferencia de golpes netos · pago por golpe", icon: "💵", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "handicap_percentage"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateDollarStroke", resultPresenter: "supplemental", aiAliases: ["dollar a stroke", "dólar por golpe"], historyVersion: 1 }),
  definition({ id: "individual_pressures", version: 1, label: "Presiones individuales", description: "Duelo hoyo por hoyo con presión", icon: "⚡", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "handicap_percentage", "pressure"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateIndividualPressures", resultPresenter: "supplemental", aiAliases: ["presiones individuales"], historyVersion: 1 }),
  definition({ id: "team_pressures", version: 1, label: "Presiones por parejas", description: "Low Ball / High Ball por equipos", icon: "🤝", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "handicap_percentage", "pressure", "teams"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateTeamPressures", resultPresenter: "supplemental", aiAliases: ["presiones por parejas", "team pressures"], historyVersion: 1 }),
  definition({ id: "chicago", version: 1, label: "Chicago", description: "Puntos contra cuota según handicap", icon: "🌆", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "handicap_percentage"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateChicago", resultPresenter: "supplemental", aiAliases: ["chicago"], historyVersion: 1 }),
  definition({ id: "vegas", version: 1, label: "Vegas", description: "Scores de pareja concatenados", icon: "🎲", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants", "teams"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "calculateVegas", resultPresenter: "supplemental", aiAliases: ["vegas"], historyVersion: 1 }),
  definition({ id: "minimum_putts", version: 1, label: "Mínimo de Putts", description: "Menos putts gana el ante", icon: "⛳", category: "supplemental", configPath: "supplementalBets", configCapabilities: ["money", "participants"], validation: "canonical", captureRequirements: { requiresScore: true, requiresPutts: "active_participants", optionalFacts: ["putts"] }, engineAdapter: "calculateMinimumPutts", resultPresenter: "supplemental", aiAliases: ["mínimo de putts", "menos putts"], historyVersion: 1 }),
  definition({ id: "manuals", version: 1, label: "Apuestas Manuales", description: "Importes directos de suma cero", icon: "✍️", category: "manual", configPath: "manualBets", configCapabilities: ["money", "participants"], validation: "manual-zero-sum", captureRequirements: { requiresScore: true, requiresPutts: "never", optionalFacts: [] }, engineAdapter: "manualZeroSum", resultPresenter: "manual", aiAliases: ["manual", "ajuste manual"], historyVersion: 1 }),
] as const satisfies readonly BetDefinition[];

export type BetRegistryId = (typeof BET_REGISTRY)[number]["id"];

export const BET_DEFINITION_BY_ID = new Map(BET_REGISTRY.map((item) => [item.id, item]));

export function supplementalBetDefinition(type: SupplementalBet["type"]) {
  return BET_DEFINITION_BY_ID.get(type);
}

export function betAiAliasCatalog() {
  return BET_REGISTRY.flatMap((bet) => bet.aiAliases.map((alias) => ({ alias, betId: bet.id })));
}
