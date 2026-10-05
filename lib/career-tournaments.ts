import { buildPollaLeaderboard, pollaHoleOrder } from "./polla-live";
import type { HandicapMode } from "./types";
export type CareerTournament = {
  id:string;publicId:string;code:string;name:string;date:string;courseName:string;holes:9|18;
  format:"gross"|"net"|"both";status:"upcoming"|"live"|"finished";
  gross:number|null;net:number|null;relativeToPar:number|null;position:number|null;players:number;
  resultStatus:"final"|"partial"|"pending";publicLeaderboard:boolean;points?:number;
};
export type TournamentSource = {id:string;public_id:string;short_code:string;name:string;tournament_date:string;course_name:string;holes:9|18;start_hole:number;format:"gross"|"net"|"both";status:CareerTournament["status"];course_snapshot:Array<{number:number;par:number;strokeIndex?:number}>;hcp_pct:number;handicap_mode:HandicapMode;public_leaderboard:boolean;created_by:string};
export type TournamentPlayerSource={id:string;tournament_id:string;profile_id:string|null;name:string;handicap:number|string};
export type TournamentScoreSource={tournament_id:string;player_id:string;hole:number;score:number};
/** Only returns this account's own sports result. Duplicate identity or incomplete ranking is unavailable. */
export function projectCareerTournament(t:TournamentSource,players:readonly TournamentPlayerSource[],scores:readonly TournamentScoreSource[],userId:string):CareerTournament|null {
  const own=players.filter(p=>p.tournament_id===t.id&&p.profile_id===userId);
  if(own.length!==1||![9,18].includes(t.holes)||!/^\d{4}-\d{2}-\d{2}$/.test(t.tournament_date)||!Number.isFinite(Date.parse(t.tournament_date))) return null;
  const participants=players.filter(p=>p.tournament_id===t.id),order=pollaHoleOrder(t.start_hole,t.holes);
  const played=scores.filter(s=>s.tournament_id===t.id&&order.includes(s.hole));
  const ownScores=played.filter(s=>s.player_id===own[0].id);
  const valid=(rows:readonly TournamentScoreSource[])=>rows.length===order.length&&new Set(rows.map(s=>s.hole)).size===order.length&&rows.every(s=>Number.isInteger(s.score)&&s.score>0&&s.score<=20);
  const complete=valid(ownScores),gross=complete?ownScores.reduce((sum,s)=>sum+s.score,0):null;
  const courseValid=Array.isArray(t.course_snapshot)&&order.every(h=>t.course_snapshot.filter(d=>d.number===h).length===1&&t.course_snapshot.some(d=>d.number===h&&Number.isInteger(d.par)&&d.par>=3&&d.par<=6&&Number.isInteger(d.strokeIndex)&&d.strokeIndex!>=1&&d.strokeIndex!<=18));
  const hcpValid=participants.every(p=>p.handicap!==null&&p.handicap!==""&&Number.isFinite(Number(p.handicap))&&Number(p.handicap)>=-15&&Number(p.handicap)<=54)&&Number.isFinite(t.hcp_pct)&&t.hcp_pct>=0&&t.hcp_pct<=100&&["ceil","floor","round","decimal","half_up","half_down","six_up","four_down"].includes(t.handicap_mode);
  let net:number|null=null,relativeToPar:number|null=null,position:number|null=null;
  if(courseValid&&hcpValid) {
    const board=buildPollaLeaderboard({players:participants.map(p=>({id:p.id,name:p.name,handicap:Number(p.handicap)})),scores:played.map(s=>({playerId:s.player_id,hole:s.hole,score:s.score})),courseSnapshot:t.course_snapshot,tournamentHoles:t.holes,startHole:t.start_hole,hcpPct:t.hcp_pct,handicapMode:t.handicap_mode});
    const self=board.find(p=>p.playerId===own[0].id)!;
    if(complete){net=self.net;relativeToPar=t.format==="gross"?self.grossRelativeToPar??null:self.netRelativeToPar??null;}
    if(t.status==="finished"&&complete&&participants.length>0&&new Set(participants.map(p=>p.id)).size===participants.length&&participants.every(p=>valid(played.filter(s=>s.player_id===p.id)))) {
      const value=t.format==="gross"?self.gross:self.net;
      position=1+board.filter(p=>(t.format==="gross"?p.gross:p.net)<value).length;
    }
  }
  return {id:t.id,publicId:t.public_id,code:t.short_code,name:t.name,date:t.tournament_date,courseName:t.course_name,holes:t.holes,format:t.format,status:t.status,gross,net,relativeToPar,position,players:participants.length,resultStatus:complete&&t.status==="finished"?"final":ownScores.length?"partial":"pending",publicLeaderboard:t.public_leaderboard};
}
export function careerTournamentSummary(events:readonly CareerTournament[]) {
  const finished=events.filter(e=>e.status==="finished"&&e.resultStatus==="final"),ranked=finished.filter(e=>e.position!==null);
  return {played:finished.length,victories:ranked.filter(e=>e.position===1).length,podiums:ranked.filter(e=>e.position!<=3).length,top10:ranked.filter(e=>e.position!<=10).length,bestPosition:ranked.length?Math.min(...ranked.map(e=>e.position!)):undefined,ranked:ranked.length,points:finished.length&&finished.every(e=>e.points!==undefined)?finished.reduce((sum,e)=>sum+e.points!,0):undefined};
}
export function nextCareerTournament(events:readonly CareerTournament[],today:string) {
  const next=[...events].filter(e=>e.status==="upcoming"&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))[0];
  return next?{event:next,days:Math.ceil((Date.parse(`${next.date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000)}:null;
}
