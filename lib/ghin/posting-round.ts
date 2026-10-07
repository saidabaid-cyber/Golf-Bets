import type { RoundSnapshot } from "../types";
import type { NormalizedGhinTee } from "./core";
import type { GhinScorePostingCandidate } from "./score-posting";

export function buildOwnedPostingCandidate(input: {
  accountId:string; roundId:string; snapshot:RoundSnapshot; golferId:string; gender:"M"|"F"|null;
  courseLink:{course_id:string;external_course_id:string;sync_status:string}|null;
  teeLink:{course_id:string;tee_id:string;external_tee_set_id:string;sync_status:string}|null;
  tee:NormalizedGhinTee; postingTeeIds:ReadonlySet<string>; today:string;
}): GhinScorePostingCandidate {
  const {snapshot:s,courseLink:c,teeLink:t,tee}=input;
  const block=(code:string):never=>{throw new Error(code);};
  if (s.lifecycleState!=="completed" || s.cloudReadOnly || s.roundHoles!==18) block("ROUND_NOT_COMPLETED_18");
  const owner=s.players?.find(p=>p.id===s.ownerId && p.accountUserId===input.accountId);
  if (!owner) block("ROUND_PLAYER_IDENTITY_MISMATCH");
  const a=s.playerTeeAssignments?.find(a=>a.playerId===owner!.id),cs=s.courseSnapshot;
  if (!a || !cs || !c || !t || c.sync_status!=="CONFIRMED" || t.sync_status!=="CONFIRMED"
    || a.courseId!==c.course_id || t.course_id!==c.course_id || a.teeId!==t.tee_id
    || cs.catalogCourseId!==a.courseId || cs.catalogTeeId!==a.teeId
    || cs.providerCourseId!==c.external_course_id || cs.providerTeeSetRatingId!==t.external_tee_set_id
    || cs.isProvisional || cs.provider!=="GHIN" || cs.ghinPostEligible!==true) block("MAPPING_NOT_CONFIRMED");
  const gender=tee.gender?.toLowerCase(),expected=input.gender==="F"?"female":input.gender==="M"?"male":null;
  if (!expected || gender!==expected || a!.indexRatingEvidence?.ratingGender!==(input.gender==="F"?"WOMEN":"MEN")) block("GENDER_MISMATCH");
  if (tee.id!==t!.external_tee_set_id || !input.postingTeeIds.has(tee.id!) || tee.status!=="active") block("TEE_NOT_POSTABLE");
  if (tee.holes!==18 || tee.par!==a!.par || tee.courseRating!==a!.rating || tee.slopeRating!==a!.slope || tee.totalYards!==a!.yards) block("TEE_ATTRIBUTES_MISMATCH");
  if (tee.holeData.length!==18 || cs!.holes.length!==18 || cs!.holes.some(h=>{
    const p=tee.holeData.find(p=>p.number===h.number);
    return !p || p.par!==h.par || p.yardage!==h.yards || p.strokeIndex!==h.strokeIndex;
  })) block("TEE_GEOMETRY_MISMATCH");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || s.date>input.today) block("INVALID_PLAYED_DATE");
  const details=(s.order??[]).map(h=>({holeNumber:h,rawScore:s.scores?.[h]?.[owner!.id]}));
  if (new Set(s.order).size!==18 || details.length!==18 || details.some(h=>h.holeNumber<1 || h.holeNumber>18 || !Number.isInteger(h.rawScore) || h.rawScore!<1)) block("INCOMPLETE_SCORE");
  return {ownerId:input.accountId,roundId:input.roundId,golferId:input.golferId,
    providerCourseId:c!.external_course_id,providerTeeSetId:t!.external_tee_set_id,providerMappingConfirmed:true,
    sourceIsProvisional:false,teeSetSide:"All18",playedAt:s.date,scoreType:"H",gender:input.gender,
    numberOfHoles:18,holeDetails:details as GhinScorePostingCandidate["holeDetails"],courseName:s.courseName,teeName:a!.teeName};
}
