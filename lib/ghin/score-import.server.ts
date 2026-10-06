import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoundSnapshot } from "../types";
import type { NormalizedGhinScore } from "./core";
import { reconcileGhinScores, type ProviderScoreRecord, type ReconciliationRound, type GhinImportPage, type GhinImportSummary } from "./score-reconciliation";
import { resolveGhinCatalogAlias, type AliasCourse, type AliasTee, type AliasCourseLink, type AliasTeeLink } from "./catalog-alias";

type RoundRow = { id: string; local_id: string; snapshot: RoundSnapshot };
type CourseLink = { course_id: string; external_course_id: string; sync_status: string };
type TeeLink = { course_id: string; tee_id: string; external_tee_set_id: string; sync_status: string };
export function reconciliationRound(row: RoundRow, golferId: string, courses: readonly CourseLink[], tees: readonly TeeLink[],
  aliases?: { courses: AliasCourse[]; tees: AliasTee[] }): ReconciliationRound | null {
  const s = row.snapshot, playerId = s.ownerId;
  if (!playerId || s.cloudReadOnly || s.lifecycleState !== "completed") return null;
  const assignment = s.playerTeeAssignments?.find(t => t.playerId === playerId);
  const courseId = assignment?.courseId ?? s.courseSnapshot?.catalogCourseId;
  const teeId = assignment?.teeId ?? s.courseSnapshot?.catalogTeeId;
  const course = courses.find(c => c.course_id === courseId && c.sync_status === "CONFIRMED");
  const tee = tees.find(t => t.course_id === courseId && t.tee_id === teeId && t.sync_status === "CONFIRMED");
  const holes = s.roundHoles ?? s.order?.length;
  if (holes !== 9 && holes !== 18) return null;
  const alias = assignment && aliases ? resolveGhinCatalogAlias({assignment,holes,
    frozenHoles:assignment.holes ?? s.courseSnapshot?.playerHoleCards?.[playerId] ?? s.courseSnapshot?.holes ?? [],courses:aliases.courses,tees:aliases.tees,
    courseLinks:courses as AliasCourseLink[],teeLinks:tees as AliasTeeLink[]}) : null;
  const values = s.order?.map(h => s.scores?.[h]?.[playerId]);
  const complete = values?.length === holes && values.every(n => typeof n === "number" && Number.isInteger(n) && n > 0);
  const gross = complete ? values!.reduce<number>((sum, n) => sum + n!, 0) : s.totalScoreCapture?.grossTotal;
  if (typeof gross !== "number" || !Number.isInteger(gross) || gross <= 0) return null;
  const index = s.backyardIndexSnapshots?.find(r => r.playerId === playerId);
  return { id: row.id, localId: row.local_id, golferId, playedOn: s.date,
    courseId: course?.external_course_id ?? alias?.providerCourseId ?? null, courseName: s.courseSnapshot?.clubName ?? s.courseName,
    teeId: tee?.external_tee_set_id ?? alias?.providerTeeSetId ?? null, teeName: assignment?.teeName ?? s.teeName,
    holes, gross, adjustedGross: index?.adjustedGrossScore ?? null,
    materialScoreHash: createHash("sha256").update(JSON.stringify([s.order,values,s.totalScoreCapture])).digest("hex") };
}
export function reconciliationEvidenceHash(round: ReconciliationRound) {
  return createHash("sha256").update(JSON.stringify([round.playedOn,round.courseId,round.teeId,round.holes,round.gross,round.adjustedGross,round.materialScoreHash])).digest("hex");
}
type ProviderRow = {
  external_score_id: string; played_on: string; provider_course_id: string | null; provider_course_name: string | null;
  provider_tee_set_id: string | null; provider_tee_name: string | null; number_of_holes: number;
  gross_score: number | null; adjusted_gross_score: number | null; score_differential: number | null;
  course_rating: number | null; slope_rating: number | null; score_type: string | null; posting_method: string | null;
  linked_round_id: string | null; linked_score_hash: string | null; posting_fingerprint: string | null;
  match_status: ProviderScoreRecord["match"]; candidate_round_ids: string[]; imported_at: string; updated_at: string;
};
const PROVIDER_COLUMNS = "external_score_id,played_on,provider_course_id,provider_course_name,provider_tee_set_id,provider_tee_name,number_of_holes,gross_score,adjusted_gross_score,score_differential,course_rating,slope_rating,score_type,posting_method,linked_round_id,linked_score_hash,posting_fingerprint,match_status,candidate_round_ids,imported_at,updated_at";
export async function readImportState(client: SupabaseClient, ownerId: string, golferId: string) {
  const [provider, rounds, courses, tees, posts] = await Promise.all([
    client.from("handicap_provider_scores").select(PROVIDER_COLUMNS).eq("owner_id",ownerId).eq("provider","GHIN").eq("external_player_id",golferId).order("played_on",{ascending:false}).order("external_score_id").limit(1000),
    client.from("rounds_cloud").select("id,local_id,snapshot").eq("owner_id",ownerId).eq("snapshot->>lifecycleState","completed"),
    client.from("golf_course_provider_links").select("id,course_id,external_course_id,external_facility_id,sync_status").eq("provider","GHIN").eq("sync_status","CONFIRMED"),
    client.from("golf_tee_provider_links").select("id,course_id,tee_id,external_tee_set_id,course_provider_link_id,sync_status").eq("provider","GHIN").eq("sync_status","CONFIRMED"),
    client.from("ghin_score_post_receipts").select("round_id,provider_score_id,fingerprint,status").eq("owner_id",ownerId).eq("golfer_id",golferId).eq("status","SUCCEEDED"),
  ]);
  if ([provider,rounds,courses,tees,posts].some(r => r.error)) throw new Error("GHIN_IMPORT_READ_FAILED");
  // Two bounded catalog reads for the owner's frozen assignments, not an N+1
  // lookup per card. Public catalog evidence contains no player/private data.
  const sourceCourseIds = [...new Set((rounds.data as RoundRow[]).flatMap(r=>r.snapshot.playerTeeAssignments?.filter(a=>a.playerId===r.snapshot.ownerId).map(a=>a.courseId) ?? []))];
  let aliases: {courses:AliasCourse[];tees:AliasTee[]} | undefined;
  if (sourceCourseIds.length) {
    const [aliasCourses,aliasTees] = await Promise.all([
      client.from("golf_courses").select("id,club_id,origin,is_provisional,holes,total_par,catalog_metadata").in("id",sourceCourseIds),
      client.from("golf_course_tees").select("id,course_id,catalog_metadata").in("course_id",sourceCourseIds),
    ]);
    if (aliasCourses.error || aliasTees.error) throw new Error("GHIN_ALIAS_READ_FAILED");
    aliases={courses:aliasCourses.data as AliasCourse[],tees:aliasTees.data as AliasTee[]};
  }
  const candidates = (rounds.data as RoundRow[]).flatMap(r => {
    const normalized = reconciliationRound(r,golferId,courses.data as CourseLink[],tees.data as TeeLink[],aliases);
    return normalized ? [normalized] : [];
  });
  const records: ProviderScoreRecord[] = (provider.data as ProviderRow[]).map(p => {
    const round = candidates.find(r => r.id === p.linked_round_id);
    return { id:p.external_score_id,playedOn:p.played_on,courseId:p.provider_course_id,courseName:p.provider_course_name,
      teeId:p.provider_tee_set_id,teeName:p.provider_tee_name,holes:p.number_of_holes,grossScore:p.gross_score,
      adjustedGrossScore:p.adjusted_gross_score,differential:p.score_differential,courseRating:p.course_rating,slopeRating:p.slope_rating,
      scoreType:p.score_type,postingMethod:p.posting_method,linkedRoundId:p.linked_round_id,linkedLocalId:round?.localId ?? null,
      match:p.match_status,candidateRoundIds:p.candidate_round_ids,importedAt:p.imported_at,postingFingerprint:p.posting_fingerprint,
      outOfSync:!!p.linked_round_id && (!round || (!!p.linked_score_hash && reconciliationEvidenceHash(round) !== p.linked_score_hash)) };
  });
  return { records, candidates, posts: (posts.data ?? []).map(p => ({roundId:p.round_id as string,providerScoreId:p.provider_score_id as string | null,fingerprint:p.fingerprint as string})),
    syncedAt: (provider.data as ProviderRow[]).map(r => r.updated_at).sort().at(-1) ?? null };
}
export async function importGhinScores(client: SupabaseClient, ownerId: string, golferId: string, scores: readonly NormalizedGhinScore[]): Promise<GhinImportSummary> {
  const state = await readImportState(client,ownerId,golferId);
  const plan = reconcileGhinScores({golferId,scores,rounds:state.candidates,existing:state.records,posts:state.posts});
  const rows = plan.decisions.map(d => ({ external_score_id:d.score.id,played_on:d.score.playedOn?.slice(0,10),provider_course_id:d.score.courseId,
    provider_course_name:d.score.courseName,provider_tee_set_id:d.score.teeId,provider_tee_name:d.score.teeName,
    number_of_holes:d.score.holes,gross_score:d.score.grossScore,adjusted_gross_score:d.score.adjustedGrossScore,
    score_differential:d.score.differential,course_rating:d.score.courseRating,slope_rating:d.score.slopeRating,
    score_type:d.score.scoreType,posting_method:d.score.postingMethod,linked_round_id:d.linkedRoundId,
    linked_score_hash:d.linkedRoundId ? reconciliationEvidenceHash(state.candidates.find(r=>r.id===d.linkedRoundId)!) : null,
    posting_fingerprint:d.postingFingerprint,match_status:d.match,candidate_round_ids:d.candidateRoundIds }));
  const result = await client.rpc("import_ghin_scores_v1",{p_owner_id:ownerId,p_external_player_id:golferId,p_records:rows});
  if (result.error || !result.data || typeof result.data.importedNew !== "number") throw new Error("GHIN_IMPORT_WRITE_FAILED");
  return {...result.data,fetched:scores.length,ignoredInvalid:plan.ignoredInvalid} as GhinImportSummary;
}
export function importPage(state: Awaited<ReturnType<typeof readImportState>>, cursor: number): GhinImportPage {
  const items = state.records.slice(cursor,cursor+20);
  const grossTotal = (holes:9|18) => {
    const valid = state.records.filter(r=>r.match==="GHIN_ONLY" && r.holes===holes && r.grossScore!==null);
    return {rounds:valid.length,sum:valid.reduce((s,r)=>s+r.grossScore!,0),best:valid.length?Math.min(...valid.map(r=>r.grossScore!)):null};
  };
  return {items,links:state.records.filter(r=>!!r.linkedRoundId),grossTotals:{9:grossTotal(9),18:grossTotal(18)},filters:{years:[...new Set(state.records.map(r=>r.playedOn!.slice(0,4)))].sort().reverse(),courses:[...new Set(state.records.flatMap(r=>r.courseName?[r.courseName]:[]))].sort()},total:state.records.length,nextCursor:cursor+20<state.records.length ? String(cursor+20) : null,
    summary:state.syncedAt ? {fetched:state.records.length,importedNew:0,matched:state.records.filter(r=>r.linkedRoundId).length,
      ambiguous:state.records.filter(r=>r.match==="MATCH_REVIEW_REQUIRED").length,ignoredInvalid:0,total:state.records.length,
      ghinOnly:state.records.filter(r=>!r.linkedRoundId).length,syncedAt:state.syncedAt} : null};
}
