import type {AdvancedStatsByHole,Course,Player,PuttsByHole} from './types';
import type {ScoreRows} from './score-capture';
import type {QuickEditAccess} from './premium-scorecard';

// No real account/round IDs. Never imported by cloud sync, social or statistics.
const player:Player={id:'qa-owner',name:'Jugador DEMO QA',handicap:0,accountUserId:'qa-memory-only'};
const pars=[4,5,3,4,4,4,3,5,4,4,4,5,3,4,4,3,5,4];
const gross=[5,5,3,4,5,3,4,7,2,5,5,5,3,4,5,3,6,4];
const puttValues=[2,2,1,2,2,1,2,3,0,2,2,2,1,2,3,1,2,2];
const course:Course={id:'qa-memory-course',name:'Campo DEMO QA aislado',teeName:'Tees de prueba',holes:pars.map((par,i)=>({number:i+1,par,yards:par===3?158:par===5?512:374,strokeIndex:(i*5)%18+1}))};
const scores:ScoreRows=Object.fromEntries(gross.map((value,i)=>[i+1,{[player.id]:value}]));
const putts:PuttsByHole=Object.fromEntries(puttValues.map((value,i)=>[i+1,{[player.id]:value}]));
const advancedStats:AdvancedStatsByHole=Object.fromEntries(pars.map((par,i)=>{
  const hole=i+1,direction=hole===5?'right':hole===8||hole===15?'left':'center';
  return [hole,{[player.id]:{
    ...(par!==3?{fairwayHit:direction==='center'}:{}),teeDirection:direction,
    greenInRegulation:[2,3,4,6,9,11,12,13,14,16,18].includes(hole),
    bunkerCount:hole===8?1:0,greenSideBunkerCount:hole===8?1:0,fairwayBunkerCount:0,
    penaltyStrokes:hole===8?1:0,outOfBoundsCount:hole===8?1:0,penaltyAreaCount:0,
    teeClub:par===3?'8i':'Driver',firstPuttDistanceFeet:hole===9?0:hole===5?18:puttValues[i]===1?7:22,
  }}];
}));
const access:QuickEditAccess={currentDraft:true,roundId:'qa-memory-round',lifecycle:'live',readOnly:false,closed:false,ownerId:player.id,accountUserId:player.accountUserId,organizerAccountUserId:player.accountUserId};
export const completeScorecardQa={player,course,order:course.holes.map(h=>h.number),scores,putts,advancedStats,access};
export type ScorecardQaFixture=typeof completeScorecardQa;
