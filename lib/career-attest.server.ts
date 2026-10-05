import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeSocialRoundCard } from "./social-round-card";
import { roundMaterialFingerprint } from "./round-achievements";
import { careerAttestSummary, type AttestEvidence, type CareerAttestCard } from "./career-index-presentation";
import type { RoundSnapshot } from "./types";
type Row={id:string;owner_id:string;local_round_id:string;version:number;snapshot:RoundSnapshot};
/** Private own-history projection. No social-sharing opt-in is required to read one's own attest status. */
export async function readCareerAttest(admin:SupabaseClient,account:string,viewer:SupabaseClient) {
  const [owned,links]=await Promise.all([
    admin.from("rounds_cloud").select("id,owner_id,local_round_id,version,snapshot").eq("owner_id",account).order("created_at",{ascending:false}).limit(1000),
    admin.from("social_round_account_links_v3").select("round_id,player_key,verified_by").eq("user_id",account).eq("verified_by","SELF_CONFIRMED").limit(1000),
  ]);
  if(owned.error||links.error)throw Error("CAREER_ATTEST_UNAVAILABLE");
  if((owned.data?.length??0)>=1000||(links.data?.length??0)>=1000)throw Error("CAREER_ATTEST_HISTORY_LIMIT");
  const extraIds=(links.data||[]).map(l=>l.round_id).filter(id=>!owned.data?.some(r=>r.id===id));
  const extra=extraIds.length?await admin.from("rounds_cloud").select("id,owner_id,local_round_id,version,snapshot").in("id",extraIds):{data:[],error:null};
  if(extra.error)throw Error("CAREER_ATTEST_UNAVAILABLE");
  const candidates:Array<{row:Row;card:NonNullable<ReturnType<typeof safeSocialRoundCard>>}>=[];
  for(const row of [...(owned.data||[]),...(extra.data||[])] as Row[]){
    const player=row.snapshot.players?.filter(p=>p.accountUserId===account);
    if(player?.length!==1||row.snapshot.lifecycleState!=="completed"||!row.snapshot.completedAt)continue;
    if(row.owner_id!==account&&!links.data?.some(l=>l.round_id===row.id&&l.player_key===player[0].id))continue;
    const card=safeSocialRoundCard(row,account,false);
    if(card&&card.ownerScore!==null&&[9,18].includes(card.holesPlayed)&&(!row.snapshot.roundHoles||row.snapshot.roundHoles===card.holesPlayed))candidates.push({row,card});
  }
  candidates.sort((a,b)=>b.row.snapshot.date.localeCompare(a.row.snapshot.date)||b.row.snapshot.completedAt!.localeCompare(a.row.snapshot.completedAt!)||b.row.id.localeCompare(a.row.id));
  const recent=candidates.slice(0,20),ids=recent.map(c=>c.row.id);
  // The existing authenticated SELECT policy already protects own received
  // attestations. Service-role source reads do not expand these permissions.
  const attestations=ids.length?await viewer.from("social_round_attestations_v3").select("round_id,target_user_id,attester_id,expected_hash,expected_version").eq("target_user_id",account).in("round_id",ids).limit(1000):{data:[],error:null};
  if(attestations.error||(attestations.data?.length??0)>=1000)throw Error("CAREER_ATTEST_UNAVAILABLE");
  const cards:Omit<CareerAttestCard,"attested">[]=[];
  for(const {row,card} of recent){const hash=await roundMaterialFingerprint(row.snapshot,account);if(!hash)continue;cards.push({roundId:row.id,date:card.date,completedAt:row.snapshot.completedAt,courseName:card.courseName,score:card.ownerScore!,currentHash:hash,version:Number(row.version)});}
  const summary=careerAttestSummary(cards,attestations.data as AttestEvidence[]||[],account);
  return {...summary,cards:summary.cards.map(card=>{const row=recent.find(c=>c.row.id===card.roundId)!.row;return {...card,roundId:row.owner_id===account?row.local_round_id:`shared:${row.id}`};})};
}
