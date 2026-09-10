import type { BetConfig, SupplementalBet } from "../types";
import { BET_DEFINITION_BY_ID, type GolfCaptureFact } from "./registry";

function participant(enabled: boolean, ids: readonly string[], playerId: string) {
  return enabled && ids.includes(playerId);
}

export function captureRequirementsForPlayer(input: {
  playerId: string;
  playedHoleIndex: number;
  bets: Pick<BetConfig, "vipers" | "camels" | "fish" | "units">;
  supplementalBets: readonly SupplementalBet[];
}) {
  const required = new Set<GolfCaptureFact>(["score"]);
  const optional = new Set<GolfCaptureFact>();
  const addDefinition = (id: string, puttsRequired: boolean) => {
    const definition = BET_DEFINITION_BY_ID.get(id);
    if (!definition) return;
    if (puttsRequired && definition.captureRequirements.requiresPutts === "active_participants") required.add("putts");
    for (const fact of definition.captureRequirements.optionalFacts) optional.add(fact);
  };

  if (participant(input.bets.vipers.enabled, input.bets.vipers.participantIds, input.playerId)) addDefinition("vipers", true);
  if (participant(input.bets.camels.enabled, input.bets.camels.participantIds, input.playerId)) addDefinition("camels", false);
  if (participant(input.bets.fish.enabled, input.bets.fish.participantIds, input.playerId)) addDefinition("fish", false);
  if (participant(input.bets.units.enabled, input.bets.units.participantIds, input.playerId)) addDefinition("units", false);

  const puttsBet = input.supplementalBets.some((bet) => bet.enabled !== false
    && bet.type === "minimum_putts"
    && input.playedHoleIndex < bet.holes
    && bet.participantIds.includes(input.playerId));
  if (puttsBet) addDefinition("minimum_putts", true);

  return { required: [...required], optional: [...optional] };
}
