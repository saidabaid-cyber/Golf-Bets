import type {
  BallFriendHole,
  BetConfig,
  CounterBetConfig,
  CounterBetKeepers,
  CounterBetKind,
  FoursomeSegment,
  LobaHole,
  Player,
} from "./types";
import { foursomeHoleConfigurationError } from "./foursome-config";
import { requiredSideBetCaptures } from "./side-bets";

export type HoleValidationInput = {
  scoreCaptureComplete: boolean;
  holeNumber: number;
  players: Pick<Player, "id">[];
  counterBets: Array<{ kind: CounterBetKind; config: CounterBetConfig }>;
  counterBetKeepers: CounterBetKeepers;
  lobaConfig: BetConfig["loba"];
  lobaHole?: LobaHole;
  foursomeConfig: BetConfig["foursome"];
  foursomeSegments: FoursomeSegment[];
  order: number[];
  ballFriendConfig: BetConfig["ballFriend"];
  ballFriendSetup?: BallFriendHole;
  extraErrors?: string[];
};

export function collectHoleValidationErrors(input: HoleValidationInput) {
  const errors: string[] = [];
  if (!input.scoreCaptureComplete) errors.push("Captura o confirma el score de todos los jugadores.");

  errors.push(...requiredSideBetCaptures(
    input.holeNumber,
    input.counterBets,
    input.counterBetKeepers,
    input.lobaConfig,
    input.lobaHole,
  ));

  const foursomeError = foursomeHoleConfigurationError(
    input.foursomeConfig,
    input.foursomeSegments,
    input.order,
    input.holeNumber,
  );
  if (foursomeError) errors.push(foursomeError);

  if (input.ballFriendConfig.enabled) {
    const playerIds = new Set(input.players.map(player => player.id));
    const participants = input.ballFriendConfig.participantIds.filter(id => playerIds.has(id));
    const setup = input.ballFriendSetup;
    const active = participants.filter(id => id !== setup?.restPlayerId);
    const teamA = setup?.teamA ?? [];
    const teamB = active.filter(id => !teamA.includes(id));
    if ((participants.length === 5 && !setup?.restPlayerId) || teamA.length !== 2 || teamB.length !== 2) {
      errors.push("Selecciona las parejas de Bola Amiga antes de continuar.");
    }
  }

  errors.push(...(input.extraErrors || []).filter(Boolean));
  return [...new Set(errors)];
}
