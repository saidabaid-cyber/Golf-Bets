import { NextRequest } from "next/server";
import { hasOnlyKeys, readJsonBodyWithLimit } from "../../../../../lib/backyard-ai/server/http-security";
import { GhinClientError } from "../../../../../lib/ghin/client";
import { SlidingWindowRateLimiter } from "../../../../../lib/ghin/core";
import { privateGhinJson } from "../../../../../lib/ghin/qa-access.server";
import { ghinUserContext } from "../../../../../lib/ghin/user-access.server";
import { GHIN_SESSION_COOKIE_NAME, getGhinUserSession } from "../../../../../lib/ghin/user-session.server";
import { ghinOwnedPostingEnvironment } from "../../../../../lib/ghin/posting-policy";
import { buildOwnedPostingCandidate } from "../../../../../lib/ghin/posting-round";
import { buildGhinScorePostingDryRun } from "../../../../../lib/ghin/score-posting";
import { postGhinHoleByHole, GhinPostingError } from "../../../../../lib/ghin/post-transport.server";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";
import type { RoundSnapshot } from "../../../../../lib/types";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const limiter=new SlidingWindowRateLimiter<string>({limit:8,windowMs:10*60_000});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function contextFor(request:NextRequest) {
  if (!ghinOwnedPostingEnvironment(process.env)) return {ok:false as const,response:privateGhinJson({code:"POSTING_DISABLED"},404)};
  const context=await ghinUserContext(request);
  if (!context.ok) return context;
  const read=await context.client.from("player_handicap_provider_profiles").select("external_player_id,association_status")
    .eq("owner_id",context.userId).eq("provider","GHIN").maybeSingle();
  if (read.error || read.data?.association_status!=="VERIFIED") return {ok:false as const,response:privateGhinJson({code:"GHIN_NOT_VERIFIED"},409)};
  return {...context,golferId:read.data.external_player_id as string};
}

/** Owner RLS reads only. No upstream requests on rendering or listing. */
export async function GET(request:NextRequest) {
  const c=await contextFor(request);if(!c.ok)return c.response;
  const [rounds,receipts]=await Promise.all([
    c.client.from("rounds_cloud").select("id,snapshot").eq("owner_id",c.userId).eq("snapshot->>lifecycleState","completed").order("created_at",{ascending:false}).limit(100),
    c.client.from("ghin_score_post_receipts").select("round_id,status,provider_score_id").eq("owner_id",c.userId).eq("golfer_id",c.golferId),
  ]);
  if(rounds.error||receipts.error)return privateGhinJson({code:"CANDIDATE_READ_FAILED"},503);
  const items=rounds.data.flatMap(r=>{
    const s=r.snapshot as RoundSnapshot,p=s.players?.find(p=>p.id===s.ownerId && p.accountUserId===c.userId);
    const a=s.playerTeeAssignments?.find(a=>a.playerId===p?.id);
    if(!p || !a || !s.courseSnapshot?.ghinPostEligible || s.courseSnapshot.isProvisional)return [];
    const values=(s.order??[]).map(h=>s.scores?.[h]?.[p.id]),complete=values.length===18&&values.every(v=>typeof v==="number"&&Number.isInteger(v)&&v>0);
    return complete?[{id:r.id,date:s.date,course:s.courseName,tee:a.teeName,gross:values.reduce<number>((sum,v)=>sum+v!,0),receipt:receipts.data.find(p=>p.round_id===r.id)?.status??null}]:[];
  });
  return privateGhinJson({items});
}

export async function POST(request:NextRequest) {
  const c=await contextFor(request);if(!c.ok)return c.response;
  const body=await readJsonBodyWithLimit(request,1024);
  if(!body.ok || !body.value || typeof body.value!=="object" || Array.isArray(body.value))return privateGhinJson({code:"INVALID_REQUEST"},400);
  const b=body.value as Record<string,unknown>;
  if(!hasOnlyKeys(b,["operation","roundId","fingerprint","confirm"]) || !["dry-run","post","verify"].includes(String(b.operation)) || typeof b.roundId!=="string" || !uuid.test(b.roundId))return privateGhinJson({code:"INVALID_REQUEST"},400);
  if(b.operation==="post" && (b.confirm!==true || typeof b.fingerprint!=="string" || !/^[a-f0-9]{64}$/.test(b.fingerprint)))return privateGhinJson({code:"EXPLICIT_CONFIRMATION_REQUIRED"},400);
  if(!limiter.consume(c.userId).allowed)return privateGhinJson({code:"RATE_LIMITED"},429);
  const [round,receipt]=await Promise.all([
    c.client.from("rounds_cloud").select("id,version,snapshot").eq("id",b.roundId).eq("owner_id",c.userId).maybeSingle(),
    c.client.from("ghin_score_post_receipts").select("id,status,provider_score_id,fingerprint,played_at,course_id,tee_set_id,gross_score").eq("round_id",b.roundId).eq("owner_id",c.userId).eq("golfer_id",c.golferId).maybeSingle(),
  ]);
  if(round.error||receipt.error)return privateGhinJson({code:"CANDIDATE_READ_FAILED"},503);
  if(!round.data)return privateGhinJson({code:"ROUND_NOT_FOUND"},404);
  // Includes uncertain/failed claims. Never repost just because an ACK was lost.
  if(receipt.data && b.operation!=="verify")return privateGhinJson({code:receipt.data.status==="SUCCEEDED"?"ALREADY_POSTED":"POST_ALREADY_CLAIMED",providerScoreId:receipt.data.provider_score_id,status:receipt.data.status,fingerprint:receipt.data.fingerprint});
  const session=getGhinUserSession(c.userId,c.golferId,request.cookies.get(GHIN_SESSION_COOKIE_NAME)?.value);
  if(!session)return privateGhinJson({code:"REAUTH_REQUIRED"},409);
  const admin=getSupabaseAdmin();if(!admin)return privateGhinJson({code:"CLOUD_UNAVAILABLE"},503);
  try {
    if(b.operation==="verify"){
      if(!receipt.data?.provider_score_id)return privateGhinJson({code:"POST_NOT_CONFIRMED"},409);
      session.client.invalidateScores(c.golferId);
      const record=await session.client.getScores(c.golferId,1000);
      const matches=record.data.filter(s=>s.id===receipt.data!.provider_score_id);
      const s=matches[0],p=receipt.data;
      const confirmed=matches.length===1 && s.playedOn?.slice(0,10)===p.played_at && s.courseId===p.course_id && s.teeId===p.tee_set_id && s.holes===18
        && (s.grossScore===p.gross_score || s.adjustedGrossScore===p.gross_score);
      return privateGhinJson({code:confirmed?"PROVIDER_CONFIRMED":"POST_NOT_CONFIRMED",count:record.data.length,matches:matches.length,score:s??null},confirmed?200:409);
    }
    const s=round.data.snapshot as RoundSnapshot,a=s.playerTeeAssignments?.find(a=>a.playerId===s.ownerId);
    if(!a || s.lifecycleState!=="completed" || s.cloudReadOnly)return privateGhinJson({code:"ROUND_NOT_POSTABLE"},409);
    const [cl,tl]=await Promise.all([
      c.client.from("golf_course_provider_links").select("course_id,external_course_id,sync_status").eq("provider","GHIN").eq("course_id",a.courseId).eq("sync_status","CONFIRMED").maybeSingle(),
      c.client.from("golf_tee_provider_links").select("course_id,tee_id,external_tee_set_id,sync_status").eq("provider","GHIN").eq("tee_id",a.teeId).eq("course_id",a.courseId).eq("sync_status","CONFIRMED").maybeSingle(),
    ]);
    if(cl.error||tl.error||!cl.data||!tl.data)return privateGhinJson({code:"MAPPING_NOT_CONFIRMED"},409);
    const [golfer,tee,postingTees]=await Promise.all([session.client.lookupGolfer(c.golferId),session.client.getTee(tl.data.external_tee_set_id),session.client.getScorePostingTees(cl.data.external_course_id)]);
    if(golfer.data.ghinNumber!==c.golferId)return privateGhinJson({code:"GOLFER_IDENTITY_MISMATCH"},409);
    const candidate=buildOwnedPostingCandidate({accountId:c.userId,roundId:round.data.id,snapshot:s,golferId:c.golferId,gender:golfer.data.gender??null,
      courseLink:cl.data,teeLink:tl.data,tee:tee.data,postingTeeIds:new Set(postingTees.data.flatMap(t=>t.id?[t.id]:[])),today:new Date().toLocaleDateString("en-CA",{timeZone:"America/Mexico_City"})});
    session.client.invalidateScores(c.golferId);
    const record=await session.client.getScores(c.golferId,1000);
    if(record.data.length>=1000)return privateGhinJson({code:"DUPLICATE_CHECK_INCOMPLETE"},409);
    const dryRun=buildGhinScorePostingDryRun(candidate,record.data);
    const report={status:dryRun.status,errors:dryRun.errors,fingerprint:dryRun.fingerprint,roundId:b.roundId,date:candidate.playedAt,course:candidate.courseName,tee:candidate.teeName,
      providerCourseId:candidate.providerCourseId,providerTeeId:candidate.providerTeeSetId,gross:dryRun.grossScore,holes:18,side:"All18",gender:candidate.gender,scoreType:candidate.scoreType,duplicateScoreId:dryRun.duplicateScoreId,providerCount:record.data.length};
    if(b.operation==="dry-run" || dryRun.status!=="READY")return privateGhinJson(report);
    if(b.fingerprint!==dryRun.fingerprint)return privateGhinJson({code:"CANDIDATE_CHANGED"},409);
    const current=await c.client.from("rounds_cloud").select("version").eq("id",b.roundId).eq("owner_id",c.userId).maybeSingle();
    if(current.error || current.data?.version!==round.data.version)return privateGhinJson({code:"CANDIDATE_CHANGED"},409);
    const portable=session.client.exportPortableSession();if(!portable)return privateGhinJson({code:"REAUTH_REQUIRED"},409);
    const claim=await admin.rpc("claim_ghin_score_post_v1",{p_owner_id:c.userId,p_round_id:b.roundId,p_golfer_id:c.golferId,p_course_id:candidate.providerCourseId,
      p_tee_set_id:candidate.providerTeeSetId,p_played_at:candidate.playedAt,p_gross_score:dryRun.grossScore,p_fingerprint:dryRun.fingerprint});
    if(claim.error || !claim.data)return privateGhinJson({code:"CLAIM_FAILED"},409);
    if(!claim.data.acquired)return privateGhinJson({code:"POST_ALREADY_CLAIMED",status:claim.data.status});
    let result;
    try { result=await postGhinHoleByHole({session:portable,payload:dryRun.payload!}); }
    catch(error){
      const code=error instanceof GhinPostingError?error.code:"POST_OUTCOME_UNKNOWN",httpStatus=error instanceof GhinPostingError?error.httpStatus:null;
      const failed=await admin.rpc("finish_ghin_score_post_v1",{p_receipt_id:claim.data.id,p_succeeded:false,p_http_status:httpStatus,p_error_code:code});
      return privateGhinJson({code,receiptRecorded:!failed.error,automaticRetry:false},502);
    }
    // A secondary receipt-write failure does not classify the acknowledged
    // provider POST as rejected, release its claim, or cause another POST.
    const saved=await admin.rpc("finish_ghin_score_post_v1",{p_receipt_id:claim.data.id,p_succeeded:true,p_http_status:result.httpStatus,p_provider_score_id:result.providerScoreId});
    session.client.invalidateScores(c.golferId);
    return privateGhinJson({code:saved.error?"PROVIDER_ACK_RECEIPT_PENDING":"POSTED",...result,fingerprint:dryRun.fingerprint,roundId:b.roundId,automaticRetry:false},saved.error?202:200);
  } catch(error){
    const code=error instanceof GhinClientError?((error.code==="unauthorized"||error.code==="forbidden")?"REAUTH_REQUIRED":error.code.toUpperCase())
      :error instanceof Error && /^[A-Z_]+$/.test(error.message)?error.message:"POSTING_VALIDATION_FAILED";
    return privateGhinJson({code,automaticRetry:false},409);
  }
}
