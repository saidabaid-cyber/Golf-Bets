import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectCareerTournament, type TournamentSource, type TournamentPlayerSource, type TournamentScoreSource } from "./career-tournaments";
const PAGE=10;
export async function readCareerTournaments(admin:SupabaseClient,userId:string,offset=0) {
  const links=await admin.from("tournament_players").select("id,tournament_id,profile_id").eq("profile_id",userId).order("created_at",{ascending:false}).order("id").range(offset,offset+PAGE);
  if(links.error) throw new Error("CAREER_TOURNAMENTS_UNAVAILABLE");
  const page=(links.data??[]).slice(0,PAGE),ids=[...new Set(page.map(p=>p.tournament_id))];
  if(!ids.length) return {events:[],nextOffset:null,ranking:null};
  const [tournaments,access]=await Promise.all([
    admin.from("tournaments").select("id,public_id,short_code,name,tournament_date,course_name,holes,start_hole,format,status,course_snapshot,hcp_pct,handicap_mode,public_leaderboard,created_by").in("id",ids),
    admin.from("tournament_access").select("tournament_id,expires_at").eq("user_id",userId).in("tournament_id",ids).is("revoked_at",null),
  ]);
  if(tournaments.error||access.error) throw new Error("CAREER_TOURNAMENTS_UNAVAILABLE");
  const authorized=new Set((access.data??[]).filter(a=>!a.expires_at||Date.parse(a.expires_at)>Date.now()).map(a=>a.tournament_id));
  const allowed=(tournaments.data??[]).filter(t=>t.created_by===userId||t.public_leaderboard||authorized.has(t.id)) as TournamentSource[];
  const allowedIds=allowed.map(t=>t.id);
  if(!allowedIds.length) return {events:[],nextOffset:links.data!.length>PAGE?offset+PAGE:null,ranking:null};
  // Bounded batched reads, not one query per tournament. Detect limits rather than rank partial data.
  const players=await admin.from("tournament_players").select("id,tournament_id,profile_id,name,handicap").in("tournament_id",allowedIds).order("id").range(0,1000);
  if(players.error) throw new Error("CAREER_TOURNAMENTS_UNAVAILABLE");
  const scores:TournamentScoreSource[]=[];
  for(let start=0;start<20000;start+=1000) {
    const batch=await admin.from("tournament_scores").select("tournament_id,player_id,hole,score").in("tournament_id",allowedIds).order("tournament_id").order("player_id").order("hole").range(start,start+999);
    if(batch.error) throw new Error("CAREER_TOURNAMENTS_UNAVAILABLE");
    scores.push(...(batch.data??[])); if((batch.data??[]).length<1000) break;
    if(start===19000) throw new Error("CAREER_TOURNAMENTS_LIMIT");
  }
  if((players.data??[]).length>1000) throw new Error("CAREER_TOURNAMENTS_LIMIT");
  const events=allowed.flatMap(t=>{
    // A confirmed exact link is rechecked in the projection; no name-based ownership.
    const event=projectCareerTournament(t,players.data as TournamentPlayerSource[],scores,userId);
    return event?[event]:[];
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {events,nextOffset:links.data!.length>PAGE?offset+PAGE:null,ranking:null};
}
