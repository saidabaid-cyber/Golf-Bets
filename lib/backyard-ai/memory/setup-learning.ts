import type { RoundSetupPlan } from "../runtime/round-setup";
import type { RoundSetupAction } from "../schemas/actions";
import type { RoundSetupDraft } from "../schemas/round-setup";
import {
  createAIAction,
  createAICorrection,
  createAIInteraction,
  createPersonalLearningEvent,
} from "./learning-events";
import type { JsonValue, PersonalLearningRecord } from "./types";

export type RoundSetupLearningInput = {
  ownerId: string;
  previousDraft: RoundSetupDraft;
  plan: RoundSetupPlan;
  confidence: number;
  durationMs: number;
  usedModel: boolean;
  occurredAt?: string;
  idFactory: () => string;
};

export type RoundSetupCorrectionChange = {
  fieldPath: string;
  proposedValue: JsonValue;
  correctedValue: JsonValue;
};

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function pointerSegment(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function actionTargetPath(action: RoundSetupAction) {
  switch (action.type) {
    case "replace_players": return "/players";
    case "set_player_handicap": return `/players/${pointerSegment(action.playerId)}/handicap`;
    case "identify_course": return "/courseIdentity";
    case "select_course": return "/course";
    case "set_start_hole": return "/startHole";
    case "set_round_holes": return "/roundHoles";
    case "set_handicap_basis": return "/handicapBasis";
    case "configure_core_bet": return `/bets/${action.bet}`;
    case "configure_group_nassau": return "/bets/polla";
    case "configure_polla_component": return `/bets/polla/${action.component}`;
    case "configure_individual_nassau": return `/personalBets/${pointerSegment(action.id)}`;
    case "configure_ball_friend": return "/bets/ballFriend";
    case "upsert_supplemental_bet": return `/supplementalBets/${pointerSegment(action.bet.id)}`;
    case "remove_nassau": return "/bets/nassau";
  }
}

function draftValueForAction(draft: RoundSetupDraft, action: RoundSetupAction): JsonValue {
  switch (action.type) {
    case "replace_players":
      return jsonValue(draft.players);
    case "set_player_handicap": {
      return jsonValue(draft.players.find((player) => player.id === action.playerId)?.handicap);
    }
    case "identify_course":
      return jsonValue(draft.courseIdentity ?? null);
    case "select_course":
      return jsonValue(draft.course ? { id: draft.course.id, name: draft.course.name, teeName: draft.course.teeName } : null);
    case "set_start_hole":
      return jsonValue(draft.startHole);
    case "set_round_holes":
      return jsonValue(draft.roundHoles);
    case "set_handicap_basis":
      return jsonValue(draft.handicapBasis);
    case "configure_core_bet":
      return jsonValue(draft.bets[action.bet]);
    case "configure_group_nassau":
      return jsonValue(draft.bets.polla);
    case "configure_polla_component":
      return jsonValue(draft.bets.polla[action.component]);
    case "configure_individual_nassau":
      return jsonValue(draft.personalBets.find((bet) => bet.id === action.id));
    case "configure_ball_friend":
      return jsonValue({ config: draft.bets.ballFriend, setup: draft.ballFriendSetup });
    case "upsert_supplemental_bet":
      return jsonValue(draft.supplementalBets.find((bet) => bet.id === action.bet.id));
    case "remove_nassau":
      return jsonValue({ polla: draft.bets.polla, personalBets: draft.personalBets });
  }
}

function sameJson(left: JsonValue, right: JsonValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Builds private, training-excluded evidence for a conversational setup edit.
 * It records structured before/after values, never the raw instruction.
 */
export function buildRoundSetupCorrectionRecords(input: RoundSetupLearningInput): {
  records: PersonalLearningRecord[];
  changes: RoundSetupCorrectionChange[];
} {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const interactionId = input.idFactory();
  const records: PersonalLearningRecord[] = [];
  const changes: RoundSetupCorrectionChange[] = [];
  const interaction = createAIInteraction({
    id: interactionId,
    ownerId: input.ownerId,
    kind: "ROUND_SETUP",
    channel: "TEXT",
    locale: input.plan.draft.locale,
    status: input.plan.canConfirm ? "VALIDATED" : input.plan.questions.length ? "NEEDS_INPUT" : "FAILED",
    provider: input.usedModel ? "OpenAI" : undefined,
    actionSchemaVersion: "round-setup-v1",
    questionCount: input.plan.questions.length,
    latencyMs: input.durationMs,
    confidence: input.confidence,
    startedAt: occurredAt,
    completedAt: occurredAt,
  });
  if (interaction) records.push(interaction);

  for (const action of input.plan.actions) {
    const fieldPath = actionTargetPath(action);
    const proposedValue = draftValueForAction(input.previousDraft, action);
    const correctedValue = draftValueForAction(input.plan.draft, action);
    if (sameJson(proposedValue, correctedValue)) continue;
    const actionId = input.idFactory();
    const aiAction = createAIAction({
      id: actionId,
      ownerId: input.ownerId,
      interactionId,
      actionType: action.type,
      targetPath: fieldPath,
      proposedPayload: proposedValue,
      validatedPayload: correctedValue,
      confidence: input.confidence,
      evidence: [{ source: input.usedModel ? "LLM" : "DETERMINISTIC", confidence: input.confidence }],
      validationStatus: "EXECUTED",
      createdAt: occurredAt,
      executedAt: occurredAt,
    });
    if (aiAction) records.push(aiAction);
    const correction = createAICorrection({
      id: input.idFactory(),
      ownerId: input.ownerId,
      interactionId,
      actionId,
      correctionType: "SETUP",
      fieldPath,
      proposedValue,
      correctedValue,
      source: "USER",
      verified: input.plan.canConfirm,
      createdAt: occurredAt,
      ...(input.plan.canConfirm ? { verifiedAt: occurredAt } : {}),
    });
    if (correction) records.push(correction);
    changes.push({ fieldPath, proposedValue, correctedValue });
  }

  const event = createPersonalLearningEvent({
    id: input.idFactory(),
    ownerId: input.ownerId,
    eventType: "SETUP_CORRECTED",
    verified: input.plan.canConfirm,
    occurredAt,
    locale: input.plan.draft.locale,
    region: "MX",
    interactionId,
    payload: {
      success: input.plan.canConfirm,
      questionCount: input.plan.questions.length,
      actionTypes: input.plan.actions.map((action) => action.type),
      changes,
    },
  });
  if (event) records.push(event);
  return { records, changes };
}
