import type { calculatePersonalBets } from "./engine";
import { collectHoleValidationErrors } from "./hole-validation";
import type { SupplementalBetResult } from "./supplemental-bets";
import type {
  BallFriendHole,
  BetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  FoursomeSegment,
  HoleScore,
  LobaHole,
  PersonalBet,
  Player,
  PuttsByHole,
  SupplementalBet,
} from "./types";

type PersonalResult = ReturnType<typeof calculatePersonalBets>["results"][number];

/** A completed history entry must never turn a provisional supplemental
 * calculation into a final ledger balance. */
export function unsettledSupplementalBetResults(
  results: Array<Pick<SupplementalBetResult, "betId" | "complete" | "label" | "type">>,
) {
  return results.filter((result) => result.complete !== true);
}

/** External rivals do not appear in the round-player scorecard, so their
 * selected Personal components need an explicit completion check at archive. */
export function incompleteExternalPersonalBets(bets: PersonalBet[], results: PersonalResult[]) {
  const resultById = new Map(results.map((result) => [result.betId, result]));
  return bets.filter((bet) => {
    if (bet.enabled === false || bet.rivalMode !== "external") return false;
    const result = resultById.get(bet.id);
    return !result || result.liveComponents.length === 0 || result.liveComponents.some((component) => !component.complete);
  });
}

export type RoundCaptureCompletionInput = {
  order: number[];
  players: Player[];
  scores: Record<number, HoleScore>;
  bets: BetConfig;
  segments: FoursomeSegment[];
  supplementalBets: SupplementalBet[];
  putts: PuttsByHole;
  counterBetKeepers: CounterBetKeepers;
  counterBetEvents: CounterBetEvent[];
  lobaHoles: Record<number, LobaHole>;
  ballFriendSetup: Record<number, BallFriendHole>;
};

/** Revalidates every played hole before archiving. This catches capture-driven
 * wagers enabled while correcting a round, after their original hole passed. */
export function firstIncompleteRoundCapture(input: RoundCaptureCompletionInput) {
  for (const [index, holeNumber] of input.order.entries()) {
    const puttPlayerIds = new Set(input.supplementalBets.flatMap((bet) =>
      bet.enabled !== false && bet.type === "minimum_putts" && index < bet.holes
        ? Array.isArray(bet.participantIds) ? bet.participantIds : []
        : []));
    const missingPutts = input.players
      .filter((player) => puttPlayerIds.has(player.id) && !Number.isInteger(input.putts[holeNumber]?.[player.id]))
      .map((player) => player.name.trim() || "Sin nombre");
    const errors = collectHoleValidationErrors({
      scoreCaptureComplete: input.players.length > 0 && input.players.every((player) => Number.isInteger(input.scores[holeNumber]?.[player.id]) && (input.scores[holeNumber]?.[player.id] as number) >= 1),
      holeNumber,
      players: input.players,
      counterBets: [
        { kind: "vipers", config: input.bets.vipers },
        { kind: "camels", config: input.bets.camels },
        { kind: "fish", config: input.bets.fish },
      ],
      counterBetKeepers: input.counterBetKeepers,
      counterBetEvents: input.counterBetEvents,
      lobaConfig: input.bets.loba,
      lobaHole: input.lobaHoles[holeNumber],
      foursomeConfig: input.bets.foursome,
      foursomeSegments: input.segments,
      order: input.order,
      ballFriendConfig: input.bets.ballFriend,
      ballFriendSetup: input.ballFriendSetup[holeNumber],
      extraErrors: missingPutts.length ? [`Captura los putts de ${missingPutts.join(", ")} antes de continuar.`] : [],
    });
    if (errors.length) return { index, holeNumber, errors };
  }
  return null;
}
