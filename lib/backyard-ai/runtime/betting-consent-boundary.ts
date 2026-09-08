import type { RoundSetupAction } from "../schemas/actions";
import type { RoundSetupDraft } from "../schemas/round-setup";

const BETTING_ACTION_TYPES = new Set<RoundSetupAction["type"]>([
  "configure_core_bet",
  "configure_group_nassau",
  "configure_polla_component",
  "configure_individual_nassau",
  "configure_ball_friend",
  "upsert_supplemental_bet",
  "remove_nassau",
]);

/**
 * The AI may interpret betting language under the AI-processing consent. This
 * predicate is used only at the boundary where a real round draft is applied
 * or betting-related personal learning data would be persisted.
 */
export function roundSetupDraftHasActiveBets(draft: RoundSetupDraft) {
  return [
    draft.bets.rabbits,
    draft.bets.skins,
    draft.bets.units,
    draft.bets.foursome,
    draft.bets.ballFriend,
    draft.bets.monkey,
    draft.bets.polla.first9,
    draft.bets.polla.second9,
    draft.bets.polla.total18,
    draft.bets.miniPolla,
    draft.bets.vipers,
    draft.bets.camels,
    draft.bets.fish,
    draft.bets.loba,
  ].some((config) => Boolean(config?.enabled))
    || draft.personalBets.some((bet) => bet.enabled !== false)
    || draft.supplementalBets.some((bet) => bet.enabled !== false)
    || draft.manualBets.some((bet) => bet.enabled !== false);
}

export function roundSetupChangeContainsBettingData(input: {
  previousDraft: RoundSetupDraft;
  nextDraft: RoundSetupDraft;
  actions: RoundSetupAction[];
}) {
  return roundSetupDraftHasActiveBets(input.previousDraft)
    || roundSetupDraftHasActiveBets(input.nextDraft)
    || input.actions.some((action) => BETTING_ACTION_TYPES.has(action.type));
}

export function runRoundSetupActionWithBettingConsent(
  draft: RoundSetupDraft,
  action: () => void,
  requireBettingConsent: (resume: () => void) => void,
) {
  if (roundSetupDraftHasActiveBets(draft)) {
    requireBettingConsent(action);
    return "CONSENT_REQUIRED" as const;
  }
  action();
  return "APPLIED" as const;
}

/**
 * Keeps an already-confirmed action pending while the betting-data consent is
 * resolved. The action stays synchronous so callers can commit related state
 * atomically after consent, without marking any part as durable beforehand.
 */
export async function runBettingDataActionWithConsent<T>(
  hasActiveBettingData: boolean,
  action: () => T,
  requestBettingConsent: () => Promise<boolean>,
) {
  if (hasActiveBettingData) {
    const accepted = await requestBettingConsent();
    if (!accepted) return { status: "CONSENT_CANCELLED" as const };
  }
  return { status: "APPLIED" as const, value: action() };
}
