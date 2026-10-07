import type { NormalizedGhinScore } from "./core";

/** The saved response ID is the primary match. GHIN's scoring record may omit
 * course/tee IDs; missing optional echoes do not undo an exact receipt match.
 * Conflicting IDs, dates, hole counts or totals still fail closed. */
export function verifyGhinPostedScore(scores:readonly NormalizedGhinScore[],receipt:{provider_score_id:string;played_at:string;course_id:string;tee_set_id:string;gross_score:number}) {
  const matches=scores.filter(s=>s.id===receipt.provider_score_id),score=matches[0];
  const confirmed=matches.length===1 && score.playedOn?.slice(0,10)===receipt.played_at && score.holes===18
    && (score.courseId===null || score.courseId===receipt.course_id)
    && (score.teeId===null || score.teeId===receipt.tee_set_id)
    && (score.grossScore===receipt.gross_score || score.adjustedGrossScore===receipt.gross_score);
  return {confirmed,matches:matches.length,score:score??null};
}
