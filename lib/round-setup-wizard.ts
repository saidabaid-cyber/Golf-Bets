import { betDisplayLabel, supplementalBetDisplayLabel, type BetPresentationKey } from "./bet-catalog";
import type { RoundSetupPreflightIssue } from "./round-setup-preflight";
import type { BetConfig, CounterBetConfig, ManualBet, PersonalBet, Player, SupplementalBet } from "./types";

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type WizardBetEntry = { id: string; label: string; enabled: boolean; summary: string };

/** UI state only: no changes to round configuration, calculations or identities. */
export function readWizardStep(value: unknown): WizardStep {
  const parsed = typeof value === "string" && /^[1-5]$/.test(value) ? Number(value) : value;
  return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5 ? parsed : 1;
}

export function wizardEditorId(targetId: string): string {
  return targetId.replace(/^result-section-/, "");
}

const PERSONAL_EDITORS = new Set([
  "setup-personals", "setup-personal-nassau", "setup-manuals",
  "setup-individual_nassau", "setup-dollar_stroke", "setup-individual_pressures",
]);

export function wizardIssueStep(issue: Pick<RoundSetupPreflightIssue, "targetId">): WizardStep {
  const targetId = wizardEditorId(issue.targetId);
  if (targetId === "round-course" || targetId.startsWith("round-course-")) return 1;
  if (targetId === "round-players" || targetId.startsWith("round-hcp-")) return 2;
  return PERSONAL_EDITORS.has(targetId) ? 4 : 3;
}

export function issuesBlockingWizardStep<T extends Pick<RoundSetupPreflightIssue, "targetId">>(issues: readonly T[], step: WizardStep): T[] {
  return issues.filter((issue) => step === 5 || wizardIssueStep(issue) <= step);
}

const money = (value: number | undefined) => typeof value === "number" && Number.isFinite(value)
  ? `$${value.toLocaleString("es-MX", { maximumFractionDigits: 2 })}` : "Precio pendiente";
const details = (...values: Array<string | undefined>) => values.filter(Boolean).join(" · ");
const handicap = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? `HCP ${value}%` : undefined;
const multiplier = (value: number | undefined) => typeof value === "number" && value > 1 ? `Presión ${value}x` : undefined;

function animalDetails(config: CounterBetConfig) {
  const mode = config.determinationMode === "most_events" ? "El que más hizo"
    : config.determinationMode === "last_event" ? "El último en hacerlo" : "Regla heredada";
  const tie = config.determinationMode === "most_events"
    ? config.mostEventsTieRule === "latest_tied_event" ? "Último de los empatados"
      : config.mostEventsTieRule === "tied_players_pay" ? "Empatados pagan" : "Regla de empate pendiente"
    : undefined;
  return details(money(config.value), mode, tie, config.secondNinePressed !== false ? multiplier(config.secondNineMultiplier) : undefined);
}

type WizardCatalogInput = {
  bets: BetConfig;
  personalBets: PersonalBet[];
  manualBets: ManualBet[];
  supplementalBets: SupplementalBet[];
  players: Player[];
  ownerId: string;
};

/** Presentation of existing draft values only. Never calculates a payout or repairs a bet. */
export function buildWizardBetCatalog(input: WizardCatalogInput): { group: WizardBetEntry[]; personal: WizardBetEntry[] } {
  const { bets, players, personalBets, manualBets, supplementalBets, ownerId } = input;
  const playerName = (id: string | undefined) => players.find((player) => player.id === id)?.name.trim() || "Jugador pendiente";
  const participants = (ids: readonly string[] | undefined) => ids?.length
    ? ids.map(playerName).join(" / ") : "Participantes pendientes";
  const entry = (id: string, key: BetPresentationKey, config: { enabled?: boolean; participantIds?: string[] } | undefined, summary: string): WizardBetEntry => ({
    id: `setup-${id}`, label: betDisplayLabel(key), enabled: config?.enabled === true,
    summary: details(summary, participants(config?.participantIds)),
  });
  const foursomeMode = { fixed: "Fijo", fixed_points: "Fijo + Patada", points: "Solo puntos", match: "Match · Primera / Segunda / Total" }[bets.foursome.mode];
  const foursomePrice = bets.foursome.mode === "points" ? `${money(bets.foursome.pointValue)} / punto`
    : bets.foursome.mode === "fixed_points" ? `${money(bets.foursome.fixedValue)} + ${money(bets.foursome.pointValue)} / punto`
      : money(bets.foursome.fixedValue);
  const group: WizardBetEntry[] = [
    entry("rabbits", "rabbits", bets.rabbits, details(money(bets.rabbits.value), bets.rabbits.mode === "three_hole_blocks" ? "Bloques de 3" : "Continuo", handicap(bets.rabbits.hcpPct))),
    entry("skins", "skins", bets.skins, details(money(bets.skins.value), bets.skins.mode === "no_carry" ? "Sin acumulado" : "Con acumulado", handicap(bets.skins.hcpPct))),
    entry("units", "units", bets.units, `${money(bets.units.value)} / positiva · ${money(bets.units.copaValue ?? bets.units.value)} / negativa`),
    entry("foursome", "foursome", bets.foursome, details(foursomeMode, foursomePrice, handicap(bets.foursome.hcpPct), multiplier(bets.foursome.pressureMultiplier ?? (bets.foursome.pressSecond9 ? 2 : 1)), bets.foursome.matchPresses?.length ? `${bets.foursome.matchPresses.length} presiones Match` : undefined)),
    entry("ball-friend", "ball_friend", bets.ballFriend, details(`${money(bets.ballFriend.value)} / punto`, handicap(bets.ballFriend.hcpPct))),
    entry("monkey", "monkey", bets.monkey, details(`${money(bets.monkey?.value)} / punto`, handicap(bets.monkey?.hcpPct))),
    entry("polla-h1-9", "polla_first", bets.polla.first9, details(money(bets.polla.first9.value), "Primera vuelta jugada", handicap(bets.polla.first9.hcpPct))),
    entry("polla-h10-18", "polla_second", bets.polla.second9, details(money(bets.polla.second9.value), "Segunda vuelta jugada", handicap(bets.polla.second9.hcpPct))),
    entry("polla-18-hoyos", "polla_total", bets.polla.total18, details(money(bets.polla.total18.value), handicap(bets.polla.total18.hcpPct))),
    entry("mini-polla", "mini_polla", bets.miniPolla, details(money(bets.miniPolla.value), handicap(bets.miniPolla.hcpPct))),
    entry("vipers", "vipers", bets.vipers, animalDetails(bets.vipers)),
    entry("camels", "camels", bets.camels, animalDetails(bets.camels)),
    entry("fish", "fish", bets.fish, animalDetails(bets.fish)),
    entry("loba", "loba", bets.loba, details(money(bets.loba.value), handicap(bets.loba.hcpPct), bets.loba.unitsEnabled ? `${money(bets.loba.unitValue)} / unidad` : undefined)),
  ];

  const supplementalSummary = (bet: SupplementalBet): string => {
    switch (bet.type) {
      case "individual_nassau":
        return details(`${playerName(bet.playerAId)} vs ${playerName(bet.playerBId)}`, money(bet.value), "Nassau heredado");
      case "dollar_stroke":
        return details(`${playerName(bet.playerAId)} vs ${playerName(bet.playerBId)}`, `${money(bet.valuePerStroke)} / golpe`);
      case "individual_pressures":
        return details(money(bet.value), handicap(bet.hcpPct), participants(bet.participantIds));
      case "team_pressures":
        return details(money(bet.value), handicap(bet.hcpPct), `${participants(bet.teamA)} vs ${participants(bet.participantIds.filter((id) => !bet.teamA.includes(id)))}`);
      case "chicago":
        return details(`${money(bet.valuePerPoint)} / punto`, handicap(bet.hcpPct), participants(bet.participantIds));
      case "vegas":
        return details(`${money(bet.valuePerUnit)} / unidad`, handicap(bet.hcpPct), `${participants(bet.teamA)} vs ${participants(bet.participantIds.filter((id) => !bet.teamA.includes(id)))}`);
      case "minimum_putts":
        return details(money(bet.ante), `${bet.holes} hoyos`, participants(bet.participantIds));
    }
  };
  const supplementalEntry = (type: SupplementalBet["type"]): WizardBetEntry => {
    const active = supplementalBets.filter((bet) => bet.type === type && bet.enabled !== false);
    return { id: `setup-${type}`, label: supplementalBetDisplayLabel(type), enabled: active.length > 0, summary: active.length ? active.map(supplementalSummary).join("; ") : "Sin activar" };
  };
  for (const type of ["team_pressures", "chicago", "vegas", "minimum_putts"] as const) group.push(supplementalEntry(type));

  const activeManuals = manualBets.filter((bet) => bet.enabled !== false);
  const activePersonal = personalBets.filter((bet) => bet.enabled !== false);
  const personal: WizardBetEntry[] = [
    {
      id: "setup-manuals", label: betDisplayLabel("manuals"), enabled: activeManuals.length > 0,
      summary: activeManuals.length ? activeManuals.map((bet) => `${bet.name.trim() || "Apuesta manual"}: ${Object.entries(bet.amounts).map(([id, amount]) => `${playerName(id)} ${money(amount)}`).join(" / ")}`).join("; ") : "Sin activar",
    },
    {
      id: "setup-personal-nassau", label: supplementalBetDisplayLabel("individual_nassau"), enabled: activePersonal.length > 0,
      summary: activePersonal.length ? activePersonal.map((bet) => details(
        `${playerName(ownerId)} vs ${bet.rivalMode === "group" ? playerName(bet.rivalPlayerId) : bet.rivalName.trim() || "Rival pendiente"}`,
        money(bet.baseValue), multiplier(bet.pressureMultiplier ?? bet.back9Multiplier),
      )).join("; ") : "Sin activar",
    },
  ];
  if (supplementalBets.some((bet) => bet.type === "individual_nassau")) personal.push(supplementalEntry("individual_nassau"));
  personal.push(supplementalEntry("dollar_stroke"), supplementalEntry("individual_pressures"));
  return { group, personal };
}
