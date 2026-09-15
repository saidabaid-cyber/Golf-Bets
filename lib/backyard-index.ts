import { strokeAllowanceForHole } from "./engine";
import { deduplicateRoundSnapshots } from "./balance-ledger";
import type {
  BackyardIndexHoleAdjustment,
  BackyardIndexIneligibilityReason,
  BackyardIndexPccEvidence,
  BackyardIndexRatedTeeEvidence,
  BackyardIndexRoundSnapshot,
  Player,
  PlayerTeeAssignmentSnapshot,
  RoundSnapshot,
} from "./types";

// Arithmetic follows USGA/R&A Rule 5.1a and 5.2, but this local index is NOT
// a WHS/GHIN Handicap Index: no authorized-format review, certification,
// exceptional-score reductions, low-index caps, or committee adjustments.
// https://www.usga.org/handicapping/roh/Content/rules/5%201a%20Calculation%20of%20a%20Score%20Differential18Hole.htm
// https://www.usga.org/handicapping/roh/Content/rules/5%202a%20For%20Fewer%20Than%2020%20Scores.htm
// https://www.randa.org/ko-KR/roh/the-rules-of-handicapping/rule-5
export const BACKYARD_INDEX_VERSION = 1 as const;
const PCC_VALUES = [-1, 0, 1, 2, 3] as const;

export type BackyardIndexSnapshotOptions = {
  ratedTeeEvidence?: BackyardIndexRatedTeeEvidence;
  pccEvidence?: BackyardIndexPccEvidence;
};

export type BackyardIndexRecord = {
  roundId: string;
  date: string;
  courseName: string;
  eligible: boolean;
  reasons: BackyardIndexIneligibilityReason[];
  scoreDifferential: number | null;
  adjustedGrossScore: number | null;
  pccKind: BackyardIndexPccEvidence["kind"] | null;
};

export type BackyardIndexSummary = {
  value: number | null;
  eligibleRoundCount: number;
  recentRoundCount: number;
  usedCount: number;
  adjustment: number;
  provisional: boolean;
  usedRoundIds: string[];
  records: BackyardIndexRecord[];
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validPlayedDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
}

function safeUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function roundedTenth(value: number): number {
  // USGA Rule 5.1a: .5 rounds upward, including negative differentials.
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function backyardScoreDifferential(adjustedGrossScore: number, courseRating: number, slopeRating: number, pcc: number): number {
  if (!finite(adjustedGrossScore) || !finite(courseRating) || !finite(slopeRating) || !finite(pcc)
    || slopeRating < 55 || slopeRating > 155 || courseRating < 40 || courseRating > 100
    || !PCC_VALUES.includes(pcc as (typeof PCC_VALUES)[number])) {
    throw new Error("Faltan score ajustado, Rating, Slope o PCC válidos.");
  }
  return roundedTenth((113 / slopeRating) * (adjustedGrossScore - courseRating - pcc));
}

function validRatedTee(evidence: BackyardIndexRatedTeeEvidence | undefined, assignment: PlayerTeeAssignmentSnapshot | undefined, round: RoundSnapshot) {
  if (!evidence || !assignment || !["OFFICIAL_RATED_TEE", "CURATED_RATED_TEE"].includes(evidence.kind)) return false;
  const courseId = round.courseSnapshot?.catalogCourseId || round.courseSnapshot?.id;
  return assignment.source === "catalog"
    && Boolean(text(evidence.authority).trim())
    && safeUrl(evidence.sourceUrl)
    && validInstant(evidence.verifiedAt)
    && evidence.courseId === courseId
    && evidence.courseId === assignment.courseId
    && evidence.teeId === assignment.teeId
    && finite(evidence.courseRating) && evidence.courseRating >= 40 && evidence.courseRating <= 100
    && finite(evidence.slopeRating) && evidence.slopeRating >= 55 && evidence.slopeRating <= 155;
}

function validPcc(evidence: BackyardIndexPccEvidence | undefined, round: RoundSnapshot, accountUserId: string) {
  if (!evidence || !PCC_VALUES.includes(evidence.value as (typeof PCC_VALUES)[number])) return false;
  if (evidence.kind === "PUBLISHED_PCC") {
    return evidence.appliesToDate === round.date && Boolean(text(evidence.authority).trim())
      && validInstant(evidence.verifiedAt);
  }
  return evidence.kind === "DECLARED_LOCAL_ZERO"
    && evidence.value === 0
    && evidence.declaredByAccountUserId === accountUserId
    && validInstant(evidence.declaredAt);
}

function completeHoleAdjustments(round: RoundSnapshot, player: Player, assignment: PlayerTeeAssignmentSnapshot | undefined) {
  const reasons: BackyardIndexIneligibilityReason[] = [];
  const course = round.courseSnapshot;
  if (!course) return { reasons: ["MISSING_COURSE_SNAPSHOT"] as BackyardIndexIneligibilityReason[] };
  if (!Array.isArray(course.holes) || course.holes.some((hole) => !hole || typeof hole !== "object")) {
    return { reasons: ["MISSING_HOLE_DEFINITIONS"] as BackyardIndexIneligibilityReason[] };
  }
  const holes = [...course.holes].sort((a, b) => a.number - b.number);
  if (holes.length !== 18 || holes.some((hole, index) =>
    hole.number !== index + 1 || !Number.isInteger(hole.par) || hole.par < 3 || hole.par > 6
    || !Number.isInteger(hole.strokeIndex) || hole.strokeIndex < 1 || hole.strokeIndex > 18)
    || new Set(holes.map((hole) => hole.strokeIndex)).size !== 18) {
    return { reasons: ["MISSING_HOLE_DEFINITIONS"] as BackyardIndexIneligibilityReason[] };
  }
  const courseHandicap = player.courseHandicapSnapshot;
  let method: BackyardIndexRoundSnapshot["adjustmentMethod"];
  let unrestrictedCourseHandicap: number | undefined;
  if (courseHandicap) {
    if (!assignment || courseHandicap.teeId !== assignment.teeId
      || courseHandicap.courseRating !== assignment.rating || courseHandicap.slope !== assignment.slope
      || !Number.isInteger(courseHandicap.courseHandicap)) {
      reasons.push("COURSE_HANDICAP_TEE_MISMATCH");
    } else {
      method = "NET_DOUBLE_BOGEY";
      unrestrictedCourseHandicap = courseHandicap.courseHandicap;
    }
  } else if (finite(player.handicapIndex)) {
    // A supplied Index requires its frozen, unrestricted Course Handicap for
    // net-double-bogey. Never substitute the betting Playing Handicap.
    reasons.push("MISSING_COURSE_HANDICAP_FOR_ADJUSTMENT");
  } else {
    // Rule 3.1a for initial scores before an Index: par + 5 per hole.
    method = "INITIAL_PAR_PLUS_FIVE";
  }
  if (!method) return { reasons };
  const adjustments: BackyardIndexHoleAdjustment[] = [];
  for (const hole of holes) {
    const score = round.scores?.[hole.number]?.[player.id];
    if (score === null || score === undefined) {
      reasons.push("MISSING_HOLE_SCORES");
      continue;
    }
    if (!Number.isInteger(score) || score < 1 || score > 100) {
      reasons.push("INVALID_HOLE_SCORES");
      continue;
    }
    const handicapStroke = method === "NET_DOUBLE_BOGEY"
      ? strokeAllowanceForHole(unrestrictedCourseHandicap!, hole.strokeIndex, "round")
      : 0;
    const maximum = method === "NET_DOUBLE_BOGEY"
      ? hole.par + 2 + handicapStroke
      : hole.par + 5;
    adjustments.push({ hole: hole.number, par: hole.par, strokeIndex: hole.strokeIndex,
      gross: score, maximum, adjusted: Math.min(score, maximum) });
  }
  if (adjustments.length !== 18) return { reasons: [...new Set(reasons)] };
  return {
    reasons,
    method,
    unrestrictedCourseHandicap,
    adjustments,
    grossScore: adjustments.reduce((total, hole) => total + hole.gross, 0),
    adjustedGrossScore: adjustments.reduce((total, hole) => total + hole.adjusted, 0),
  };
}

/** Called once at explicit round close/save, not on everyday profile render. */
export function createBackyardIndexRoundSnapshot(
  round: RoundSnapshot,
  playerId: string,
  options: BackyardIndexSnapshotOptions = {},
): BackyardIndexRoundSnapshot {
  const player = Array.isArray(round.players)
    ? round.players.find((candidate) => candidate && candidate.id === playerId)
    : undefined;
  const accountUserId = text(player?.accountUserId);
  const reasons: BackyardIndexIneligibilityReason[] = [];
  if (round.lifecycleState !== "completed") reasons.push("ROUND_NOT_COMPLETED");
  if (!validPlayedDate(round.date)) reasons.push("INVALID_PLAYED_DATE");
  if (!accountUserId) reasons.push("PLAYER_NOT_LINKED");
  if (round.roundHoles !== 18 || !Array.isArray(round.order) || round.order.length !== 18
    || new Set(round.order).size !== 18 || round.order.some((hole) => !Number.isInteger(hole) || hole < 1 || hole > 18)) {
    reasons.push("NOT_COMPLETE_18_HOLES");
  }
  const assignment = Array.isArray(round.playerTeeAssignments)
    ? round.playerTeeAssignments.find((candidate) => candidate && candidate.playerId === playerId)
    : undefined;
  if (!assignment) reasons.push("MISSING_TEE_ASSIGNMENT");
  const ratedTee = options.ratedTeeEvidence;
  if (!ratedTee) reasons.push("MISSING_OFFICIAL_TEE_RATING");
  else if (!validRatedTee(ratedTee, assignment, round)) reasons.push("INVALID_OFFICIAL_TEE_RATING");
  else if (ratedTee.courseRating !== assignment?.rating || ratedTee.slopeRating !== assignment?.slope) reasons.push("TEE_RATING_MISMATCH");
  const pcc = options.pccEvidence;
  if (!pcc) reasons.push("MISSING_PCC_EVIDENCE");
  else if (!validPcc(pcc, round, accountUserId)) reasons.push("INVALID_PCC_EVIDENCE");
  const adjusted = player ? completeHoleAdjustments(round, player, assignment)
    : { reasons: ["PLAYER_NOT_LINKED"] as BackyardIndexIneligibilityReason[] };
  reasons.push(...adjusted.reasons);
  if (!("adjustedGrossScore" in adjusted) || !finite(adjusted.adjustedGrossScore)) {
    reasons.push("MISSING_ADJUSTED_GROSS_SCORE");
  }
  const eligible = reasons.length === 0;
  const snapshot: BackyardIndexRoundSnapshot = {
    version: BACKYARD_INDEX_VERSION,
    roundId: round.id,
    accountUserId,
    playerId,
    playedAt: round.date,
    capturedAt: round.completedAt || round.updatedAt || new Date().toISOString(),
    eligible,
    reasons: [...new Set(reasons)],
    ...("grossScore" in adjusted && finite(adjusted.grossScore) ? { grossScore: adjusted.grossScore } : {}),
    ...("adjustedGrossScore" in adjusted && finite(adjusted.adjustedGrossScore)
      ? { adjustedGrossScore: adjusted.adjustedGrossScore } : {}),
    ...("method" in adjusted && adjusted.method ? { adjustmentMethod: adjusted.method } : {}),
    ...("unrestrictedCourseHandicap" in adjusted && finite(adjusted.unrestrictedCourseHandicap)
      ? { unrestrictedCourseHandicap: adjusted.unrestrictedCourseHandicap } : {}),
    ...("adjustments" in adjusted && adjusted.adjustments
      ? { holeAdjustments: structuredClone(adjusted.adjustments) } : {}),
    ...(ratedTee ? { ratedTeeEvidence: structuredClone(ratedTee) } : {}),
    ...(pcc ? { pccEvidence: structuredClone(pcc) } : {}),
    ...(eligible ? { scoreDifferential: backyardScoreDifferential(
      adjusted.adjustedGrossScore!, ratedTee!.courseRating, ratedTee!.slopeRating, pcc!.value,
    ) } : {}),
  };
  return snapshot;
}

/** Reuses prior frozen evidence only during an explicit historical correction. */
export function snapshotBackyardIndexRound(
  round: RoundSnapshot,
  accountUserId: string,
  options: BackyardIndexSnapshotOptions & { priorRound?: RoundSnapshot } = {},
): RoundSnapshot {
  const player = Array.isArray(round.players)
    ? round.players.find((candidate) => candidate && candidate.accountUserId === accountUserId)
    : undefined;
  if (!player) return round;
  const current = Array.isArray(round.backyardIndexSnapshots)
    ? round.backyardIndexSnapshots.find((candidate) => candidate && candidate.accountUserId === accountUserId)
    : undefined;
  const prior = Array.isArray(options.priorRound?.backyardIndexSnapshots)
    ? options.priorRound.backyardIndexSnapshots.find((candidate) => candidate && candidate.accountUserId === accountUserId)
    : undefined;
  const inheritedPcc = current?.pccEvidence ?? prior?.pccEvidence;
  const inheritedPccDate = current?.pccEvidence ? current.playedAt : prior?.playedAt ?? options.priorRound?.date;
  // A local PCC 0 declaration is round-date-specific. An edited date needs a
  // new explicit declaration; never silently transplant yesterday's zero.
  const evidence = {
    ratedTeeEvidence: options.ratedTeeEvidence ?? current?.ratedTeeEvidence ?? prior?.ratedTeeEvidence,
    pccEvidence: options.pccEvidence ?? (inheritedPcc?.kind === "DECLARED_LOCAL_ZERO"
      && (inheritedPccDate !== round.date || (!current?.pccEvidence && options.priorRound?.date !== round.date))
      ? undefined : inheritedPcc),
  };
  const indexSnapshot = createBackyardIndexRoundSnapshot(round, player.id, evidence);
  return {
    ...round,
    backyardIndexSnapshots: [
      ...(Array.isArray(round.backyardIndexSnapshots) ? round.backyardIndexSnapshots : [])
        .filter((candidate) => candidate && candidate.accountUserId !== accountUserId),
      indexSnapshot,
    ],
  };
}

// USGA Rule 5.2a exact progressive selection/adjustment for 3–19 scores.
export function backyardIndexSelection(scoreCount: number): { use: number; adjustment: number } {
  if (!Number.isInteger(scoreCount) || scoreCount < 3) return { use: 0, adjustment: 0 };
  if (scoreCount === 3) return { use: 1, adjustment: -2 };
  if (scoreCount === 4) return { use: 1, adjustment: -1 };
  if (scoreCount === 5) return { use: 1, adjustment: 0 };
  if (scoreCount === 6) return { use: 2, adjustment: -1 };
  if (scoreCount <= 8) return { use: 2, adjustment: 0 };
  if (scoreCount <= 11) return { use: 3, adjustment: 0 };
  if (scoreCount <= 14) return { use: 4, adjustment: 0 };
  if (scoreCount <= 16) return { use: 5, adjustment: 0 };
  if (scoreCount <= 18) return { use: 6, adjustment: 0 };
  if (scoreCount === 19) return { use: 7, adjustment: 0 };
  return { use: 8, adjustment: 0 };
}

function validStoredScore(round: RoundSnapshot, snapshot: BackyardIndexRoundSnapshot | undefined, accountUserId: string): snapshot is BackyardIndexRoundSnapshot & { scoreDifferential: number } {
  if (!snapshot || snapshot.version !== 1 || !snapshot.eligible || !Array.isArray(snapshot.reasons) || snapshot.reasons.length
    || round.lifecycleState !== "completed" || round.roundHoles !== 18
    || !Array.isArray(round.order) || round.order.length !== 18 || new Set(round.order).size !== 18
    || snapshot.playedAt !== round.date || !validPlayedDate(round.date)
    || snapshot.roundId !== round.id || snapshot.accountUserId !== accountUserId
    || !finite(snapshot.adjustedGrossScore) || !finite(snapshot.scoreDifferential)
    || !snapshot.ratedTeeEvidence || !snapshot.pccEvidence
    || !validPcc(snapshot.pccEvidence, round, accountUserId)) return false;
  const player = Array.isArray(round.players)
    ? round.players.find((candidate) => candidate && candidate.id === snapshot.playerId
      && candidate.accountUserId === accountUserId)
    : undefined;
  const courseHoles = round.courseSnapshot?.holes;
  if (!player || !Array.isArray(courseHoles) || courseHoles.length !== 18
    || !snapshot.adjustmentMethod || !finite(snapshot.grossScore)) return false;
  const assignment = Array.isArray(round.playerTeeAssignments)
    ? round.playerTeeAssignments.find((candidate) => candidate && candidate.playerId === snapshot.playerId)
    : undefined;
  if (!validRatedTee(snapshot.ratedTeeEvidence, assignment, round)
    || snapshot.ratedTeeEvidence.courseRating !== assignment?.rating
    || snapshot.ratedTeeEvidence.slopeRating !== assignment?.slope) return false;
  if (snapshot.adjustmentMethod === "NET_DOUBLE_BOGEY") {
    const handicap = player.courseHandicapSnapshot;
    if (!handicap || !Number.isInteger(handicap.courseHandicap)
      || snapshot.unrestrictedCourseHandicap !== handicap.courseHandicap
      || handicap.teeId !== assignment?.teeId || handicap.courseRating !== assignment?.rating
      || handicap.slope !== assignment?.slope) return false;
  } else if (snapshot.adjustmentMethod !== "INITIAL_PAR_PLUS_FIVE"
    || player.courseHandicapSnapshot || finite(player.handicapIndex)) return false;
  const holes = snapshot.holeAdjustments;
  if (!Array.isArray(holes) || holes.length !== 18
    || holes.some((hole) => !hole || typeof hole !== "object"
      || !Number.isInteger(hole.hole) || hole.hole < 1 || hole.hole > 18
      || !Number.isInteger(hole.gross) || hole.gross < 1
      || !Number.isInteger(hole.maximum) || !Number.isInteger(hole.adjusted)
      || !courseHoles.some((courseHole) => courseHole && courseHole.number === hole.hole
        && courseHole.par === hole.par && courseHole.strokeIndex === hole.strokeIndex)
      || hole.maximum !== (snapshot.adjustmentMethod === "INITIAL_PAR_PLUS_FIVE"
        ? hole.par + 5
        : player.courseHandicapSnapshot && Number.isInteger(player.courseHandicapSnapshot.courseHandicap)
          ? hole.par + 2 + strokeAllowanceForHole(player.courseHandicapSnapshot.courseHandicap,
            hole.strokeIndex, "round") : Number.NaN)
      || hole.adjusted !== Math.min(hole.gross, hole.maximum)
      || round.scores?.[hole.hole]?.[snapshot.playerId] !== hole.gross)
    || new Set(holes.map((hole) => hole.hole)).size !== 18
    || holes.reduce((total, hole) => total + hole.gross, 0) !== snapshot.grossScore
    || holes.reduce((total, hole) => total + hole.adjusted, 0) !== snapshot.adjustedGrossScore) return false;
  try {
    return backyardScoreDifferential(snapshot.adjustedGrossScore,
      snapshot.ratedTeeEvidence.courseRating, snapshot.ratedTeeEvidence.slopeRating,
      snapshot.pccEvidence.value) === snapshot.scoreDifferential;
  } catch { return false; }
}

function playedTime(round: RoundSnapshot): number {
  const date = Date.parse(round.date);
  return Number.isFinite(date) ? date : Number.NEGATIVE_INFINITY;
}

function roundStartTime(round: RoundSnapshot): number {
  const timestamp = Date.parse(text(round.startedAt) || text(round.completedAt));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/** Reads only stored frozen evidence; never changes profile manual HCP, Playing HCP, GHIN, or historical rounds. */
export function calculateBackyardIndex(history: readonly RoundSnapshot[], accountUserId: string): BackyardIndexSummary {
  const rounds = deduplicateRoundSnapshots(history.filter(
    (round): round is RoundSnapshot => Boolean(round && typeof round.id === "string" && round.id.trim()),
  )).filter((round) => Array.isArray(round.players)
    && round.players.some((player) => player && player.accountUserId === accountUserId))
    .sort((a, b) => playedTime(b) - playedTime(a)
      || roundStartTime(b) - roundStartTime(a));
  const records: BackyardIndexRecord[] = rounds.map((round) => {
    const snapshot = Array.isArray(round.backyardIndexSnapshots)
      ? round.backyardIndexSnapshots.find((candidate) => candidate && candidate.accountUserId === accountUserId)
      : undefined;
    const valid = validStoredScore(round, snapshot, accountUserId);
    return {
      roundId: round.id, date: text(round.date), courseName: text(round.courseName), eligible: valid,
      reasons: valid ? [] : !snapshot ? ["MISSING_INDEX_SNAPSHOT"]
        : Array.isArray(snapshot.reasons) && snapshot.reasons.length ? [...snapshot.reasons] : ["INVALID_INDEX_SNAPSHOT"],
      scoreDifferential: valid ? snapshot.scoreDifferential : null,
      adjustedGrossScore: valid ? snapshot.adjustedGrossScore ?? null : null,
      pccKind: valid ? snapshot.pccEvidence?.kind ?? null : null,
    };
  });
  const eligible = records.filter((record) => record.eligible && finite(record.scoreDifferential));
  const recent = eligible.slice(0, 20);
  const { use, adjustment } = backyardIndexSelection(recent.length);
  const selected = use ? [...recent].sort((a, b) => a.scoreDifferential! - b.scoreDifferential!).slice(0, use) : [];
  const value = selected.length
    ? Math.min(54, roundedTenth(selected.reduce((total, record) => total + record.scoreDifferential!, 0) / selected.length + adjustment))
    : null;
  return {
    value, eligibleRoundCount: eligible.length, recentRoundCount: recent.length,
    usedCount: use, adjustment, provisional: eligible.length < 20,
    usedRoundIds: selected.map((record) => record.roundId), records,
  };
}
