import type { RoundSnapshot } from "./types";
import { validTotalOnly } from "./total-score-round";

export type NewCoursePlayedEvent = {
  type: "NEW_COURSE_PLAYED"; sourceRoundId: string; courseId: string; clubId: string;
};
type Catalog = { courses: readonly { id: string; clubId: string }[]; clubs: readonly { id: string }[] };

/** One deterministic event inside the existing round summary, not another post.
 * Source facts are persisted canonical rounds. Names/tee IDs never imply a club. */
export function newCoursePlayedEvent(round: RoundSnapshot, history: readonly RoundSnapshot[],
  accountUserId: string, homeClubId: string | null, catalog: Catalog): NewCoursePlayedEvent | null {
  const courseId = round.courseSnapshot?.catalogCourseId;
  const course = catalog.courses.find(c => c.id === courseId);
  if (!course || !homeClubId || !catalog.clubs.some(c => c.id === homeClubId)
    || course.clubId === homeClubId || course.clubId !== round.courseSnapshot?.catalogClubId) return null;
  const complete = (r: RoundSnapshot) => {
    const players = r.players?.filter(p => p.accountUserId === accountUserId);
    if (r.lifecycleState !== "completed" || !r.completedAt || !Number.isFinite(Date.parse(r.completedAt))
      || players?.length !== 1 || !r.order || ![9,18].includes(r.order.length)) return false;
    return validTotalOnly(r, accountUserId) || r.order.every(h => Number.isInteger(r.scores?.[h]?.[players[0].id])
      && Number(r.scores?.[h]?.[players[0].id]) > 0);
  };
  if (!complete(round)) return null;
  const first = history.filter(r => r.courseSnapshot?.catalogCourseId === courseId && complete(r))
    .sort((a,b) => a.date.localeCompare(b.date) || a.completedAt!.localeCompare(b.completedAt!) || a.id.localeCompare(b.id))[0];
  return first?.id === round.id ? {type:"NEW_COURSE_PLAYED", sourceRoundId:round.id, courseId:course.id, clubId:course.clubId} : null;
}
