import type { Course, Player, PlayerCourseHandicapSnapshot, PlayerTeeAssignmentSnapshot } from "../../lib/types";
import { createCourseHandicapSnapshot, normalizeBackyardHandicap } from "./course-handicap";

function sameSnapshot(left: PlayerCourseHandicapSnapshot | undefined, right: Omit<PlayerCourseHandicapSnapshot, "calculatedAt">) {
  return Boolean(left
    && left.index === right.index
    && left.indexSource === right.indexSource
    && left.teeId === right.teeId
    && left.teeName === right.teeName
    && left.slope === right.slope
    && left.courseRating === right.courseRating
    && left.par === right.par
    && left.courseHandicap === right.courseHandicap
    && left.appliedHandicap === right.appliedHandicap
    && left.formulaVersion === right.formulaVersion
    && left.effectiveAt === right.effectiveAt);
}

/**
 * Applies a round Playing Handicap only to players whose value represents an
 * Index. Guests/manual round entries stay editable and untouched. The raw WHS
 * result remains auditable while Backyard's round cap is applied explicitly.
 */
export function applyRoundCourseHandicaps(
  players: readonly Player[],
  assignments: readonly PlayerTeeAssignmentSnapshot[],
  course: Course,
  calculatedAt: string,
) {
  const par = course.holes.reduce((total, hole) => total + hole.par, 0);
  let changed = false;
  const next = players.map((player) => {
    const usesIndex = player.handicapSource === "profile_index" || player.handicapIndex !== undefined;
    const index = player.handicapIndex ?? (usesIndex ? player.handicap : null);
    const tee = assignments.find((assignment) => assignment.playerId === player.id);
    if (!usesIndex || typeof index !== "number" || !Number.isFinite(index)) return player;
    if (!tee || typeof tee.rating !== "number" || typeof tee.slope !== "number") {
      if (!player.courseHandicapSnapshot && player.handicap === index) return player;
      changed = true;
      return { ...player, handicap: normalizeBackyardHandicap(index), courseHandicapSnapshot: undefined };
    }
    const snapshot = createCourseHandicapSnapshot({
      playerId: player.id,
      index,
      indexSource: player.handicapIndexSource || "BACKYARD_MANUAL",
      teeId: tee.teeId,
      teeName: tee.teeName,
      slope: tee.slope,
      courseRating: tee.rating,
      par,
      effectiveAt: tee.capturedAt,
    }, calculatedAt);
    const appliedHandicap = normalizeBackyardHandicap(snapshot.courseHandicap);
    const candidate: Omit<PlayerCourseHandicapSnapshot, "calculatedAt"> = {
      index: snapshot.index,
      indexSource: snapshot.indexSource,
      teeId: snapshot.teeId,
      teeName: snapshot.teeName,
      slope: snapshot.slope,
      courseRating: snapshot.courseRating,
      par: snapshot.par,
      courseHandicap: snapshot.courseHandicap,
      appliedHandicap,
      formulaVersion: snapshot.formulaVersion,
      effectiveAt: snapshot.effectiveAt,
    };
    if (player.handicap === appliedHandicap && sameSnapshot(player.courseHandicapSnapshot, candidate)) return player;
    changed = true;
    return {
      ...player,
      handicap: appliedHandicap,
      handicapIndex: snapshot.index,
      handicapSource: "profile_index" as const,
      handicapIndexSource: snapshot.indexSource,
      courseHandicapSnapshot: { ...candidate, calculatedAt: player.courseHandicapSnapshot?.calculatedAt || calculatedAt },
    };
  });
  return changed ? next : players;
}
