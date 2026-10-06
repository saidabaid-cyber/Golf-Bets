import { normalizeRoundDraft } from "./round-utils";
import { normalizeRoundPresentation } from "./round-presentation";
import { normalizeRoundHandicapBasis } from "./handicap-base";
import { normalizeRoundStartedAt, withDerivedRoundLifecycle } from "./round-lifecycle";
import { normalizeRoundTemplateOrigin } from "./group-game-template";
import { withDefaultLaVistaRules } from "./local-rules";
import { reconcilePlayerTeeAssignments } from "./player-tee-assignments";
import { withPlayerCourseCards } from "./player-course-card";
import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import { restoreBetConfig } from "./new-round-bets";
import { normalizeFoursomeSegments, playOrderForHoles } from "./engine";
import { normalizeSupplementalBets } from "./supplemental-bets";
import { emptyCounterBetKeepers, normalizeCounterBetEvents } from "./side-bets";
import type { Course, ManualBet, Player } from "./types";

export function hydratedRoundExpenses(raw: any) {
  return { caddie: Number(raw?.caddie || 0), food: Number(raw?.food ?? ((raw?.breakfast || 0) + (raw?.lunch || 0))),
    drinks: Number(raw?.drinks || 0), greenFee: Number(raw?.greenFee || 0), cartRental: Number(raw?.cartRental || 0), other: Number(raw?.other || 0) };
}

/** Exactly the editor projection, with deterministic legacy defaults. Keep
 * this distinct from the canonical document: normalizing old data is a read. */
export function roundDraftHydrationView(value: unknown, fallbackCourse: Course, core: { players: Player[]; ownerId: string; startHole: number; roundHoles: 9 | 18 }) {
  const draft = normalizeRoundDraft(value, core.ownerId);
  if (!draft) return null;
  const rawCourse = draft.course ? withDefaultLaVistaRules(draft.course as Course) : fallbackCourse;
  const locked = Boolean(draft.startedAt || draft.reviewPending || draft.lifecycleState === "completed");
  const capturedAt = normalizeRoundStartedAt(draft.startedAt) || new Date(0).toISOString();
  const assignments = reconcilePlayerTeeAssignments(draft.playerTeeAssignments, core.players, rawCourse, capturedAt, { allowCuratedNewAssignment: !locked });
  const course = locked ? rawCourse : withPlayerCourseCards(rawCourse, assignments);
  const players = draft.courseSelected ? applyRoundCourseHandicaps(core.players, assignments, course, capturedAt, locked) : core.players;
  const order = playOrderForHoles(course.holes.map(hole => hole.number), core.startHole).slice(0, core.roundHoles);
  const bets = restoreBetConfig(draft.bets, core.players.map(player => player.id), core);
  const personalBets = draft.personalBets.map((b: any) => ({
    id: b.id, enabled: b.enabled, rivalMode: b.rivalMode, rivalPlayerId: b.rivalPlayerId, externalRivalId: b.externalRivalId,
    rivalHandicap: b.rivalHandicap ?? null, nassauVersion: b.nassauVersion, carryEnabled: b.carryEnabled, rivalName: b.rivalName,
    externalScores: b.externalScores && typeof b.externalScores === "object" && !Array.isArray(b.externalScores) ? b.externalScores : {},
    baseValue: Object.hasOwn(b, "baseValue") ? b.baseValue : undefined,
    advantageReceiver: b.nassauVersion === 2 ? b.advantageReceiver
      : ["owner", "rival", "none"].includes(b.advantageReceiver) ? b.advantageReceiver
        : b.advantageReceiverId ? (b.advantageReceiverId === core.ownerId ? "owner" : "rival") : b.advantageStrokes === 0 ? "none" : undefined,
    advantageStrokes: Object.hasOwn(b, "advantageStrokes") ? b.advantageStrokes : undefined,
    back9Multiplier: b.back9Multiplier, pressureMultiplier: b.pressureMultiplier, pressureNine: b.pressureNine,
    advantageMode: b.advantageMode, ownerIndexSnapshot: b.ownerIndexSnapshot, rivalIndexSnapshot: b.rivalIndexSnapshot,
    slidingAdvantage: b.slidingAdvantage, components: b.components,
  }));
  return withDerivedRoundLifecycle({ version: 11, course, courseSelected: draft.courseSelected,
    courseIdentity: draft.courseSelected ? undefined : draft.courseIdentity,
    playerTeeAssignments: assignments,
    startHole: core.startHole, roundHoles: core.roundHoles, handicapBasis: normalizeRoundHandicapBasis(draft.handicapBasis),
    presentation: normalizeRoundPresentation(draft.presentation), players, ownerId: core.ownerId, bets,
    segments: normalizeFoursomeSegments(draft.segments, order, [3, 6, 9, 18].includes(draft.bets?.foursome?.segmentSize) ? draft.bets!.foursome.segmentSize : 6),
    personalBets, supplementalBets: normalizeSupplementalBets(draft.supplementalBets, core.roundHoles),
    manualBets: draft.manualBets.map((bet: ManualBet) => ({ ...bet, name: typeof bet.name === "string" ? bet.name : "" })),
    scores: draft.scores, scoreEdits: draft.scoreEdits, putts: draft.putts, scoreCaptureMode: draft.scoreCaptureMode,
    advancedStats: draft.advancedStats, shots: draft.shots, unitEvents: draft.unitEvents,
    counterBetEvents: normalizeCounterBetEvents(draft.counterBetEvents), counterBetKeepers: { ...emptyCounterBetKeepers(), ...(draft.counterBetKeepers || {}) },
    lobaHoles: draft.lobaHoles, ballFriendSetup: draft.ballFriendSetup, expenses: hydratedRoundExpenses(draft.expenses),
    roundId: draft.roundId, roundDate: draft.roundDate, startedAt: normalizeRoundStartedAt(draft.startedAt),
    reviewPending: Boolean(draft.reviewPending) || draft.lifecycleState === "completed", templateOrigin: normalizeRoundTemplateOrigin(draft.templateOrigin) ?? undefined,
    scorecardPhotoIds: Array.isArray(draft.scorecardPhotoIds) ? draft.scorecardPhotoIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : [],
  });
}
