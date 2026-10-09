import type { SocialActivityCard, SocialRoundCard } from './social-activity-contract';
import type { AdvancedStatsByHole, Course, Player, PlayerTeeAssignmentSnapshot, PuttsByHole } from './types';
import type { ScoreRows } from './score-capture';
import { recordedNumber } from './premium-scorecard';
import { normalizeAdvancedStats } from './advanced-stats';
import { MAX_ROUND_PLAYERS } from './round-player-limit';

function validHoles(round:SocialRoundCard) {
  const holes=round.scorecard;
  return !round.totalOnly&&holes?.length&&holes.length===round.holesPlayed&&holes.length<=18
    &&new Set(holes.map(h=>h.hole)).size===holes.length
    &&!holes.some(h=>recordedNumber(h.hole,1,18)===null||recordedNumber(h.par,3,6)===null||h.score!==null&&recordedNumber(h.score,1)===null)
    &&holes.some(h=>h.score!==null)?holes:null;
}
/** Consume independently authorized server projections, never the private shared snapshot. */
export function socialPremiumScorecard(activity:SocialActivityCard) {
  const round=activity.round;
  if(!round||activity.roundId!==round.roundId||!activity.author.userId)return null;
  const authorHoles=validHoles(round);if(!authorHoles)return null;
  const candidates=[{author:activity.author,activityId:activity.id,sourceVersion:activity.sourceVersion,round},...(round.playerCards??[])];
  const players:Player[]=[],scores:ScoreRows={},putts:PuttsByHole={},stats:AdvancedStatsByHole={};
  const playerHoleCards:NonNullable<Course['playerHoleCards']>={},assignments:PlayerTeeAssignmentSnapshot[]=[];
  const order=authorHoles.map(h=>h.hole);
  for(const candidate of candidates){
    const id=candidate.author.userId,holes=validHoles(candidate.round);
    if(!id||players.some(p=>p.id===id)||players.length>=MAX_ROUND_PLAYERS||candidate.round.roundId!==round.roundId
      ||candidate.sourceVersion!==activity.sourceVersion||!holes||holes.length!==order.length||holes.some(h=>!order.includes(h.hole)))continue;
    players.push({id,accountUserId:id,name:candidate.author.displayName,handicap:0});
    playerHoleCards[id]=holes.map(h=>({number:h.hole,par:h.par,strokeIndex:recordedNumber(h.strokeIndex,1,18)??0,
      ...(recordedNumber(h.yards,1,1500)===null?{}:{yards:h.yards})}));
    assignments.push({playerId:id,courseId:round.roundId,teeId:`shared:${id}`,teeName:candidate.round.teeName??'',source:'legacy',capturedAt:candidate.round.date});
    for(const hole of holes){
      if(hole.score!==null)(scores[hole.hole]??={})[id]=hole.score;
      if(recordedNumber(hole.putts,0,50)!==null)(putts[hole.hole]??={})[id]=hole.putts!;
      if(hole.stats)(stats[hole.hole]??={})[id]=hole.stats;
    }
  }
  const course:Course={id:round.roundId,name:round.courseName,teeName:round.teeName??'',holes:playerHoleCards[activity.author.userId],playerHoleCards};
  const unsharedCards=(round.leaderboard??[]).filter(p=>!players.some(player=>player.id===p.userId));
  return {roundId:round.roundId,course,players,ownerId:activity.author.userId,date:round.date,lifecycle:'completed' as const,
    order,scores,putts,advancedStats:normalizeAdvancedStats(stats),assignments,unsharedCards};
}
