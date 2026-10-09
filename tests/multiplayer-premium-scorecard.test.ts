import assert from 'node:assert/strict';
import test from 'node:test';
import {socialPremiumScorecard} from '../lib/social-premium-scorecard';
import type {SocialActivityCard,SocialRoundCard} from '../lib/social-activity-contract';
import {socialUI,uiFind,uiNodes,uiText} from './helpers/social-ui';
import * as domain from '../lib/premium-scorecard';
import {MAX_ROUND_PLAYERS} from '../lib/round-player-limit';
function fixture(count:number){
  const playerCards=Array.from({length:count},(_,i)=>({author:{userId:`p${i}`,displayName:`Jugador QA ${i+1}`,username:null,avatarUrl:null},activityId:`activity${i}`,sourceVersion:4,round:{roundId:'canonical',localRoundId:'local',date:'2026-10-08',courseName:'QA aislado',teeName:i?'Dorado':'Blanco',holesPlayed:18,ownerScore:72+i*18,coursePar:72,scorecard:Array.from({length:18},(_,h)=>({hole:h+1,par:4,score:4+i,yards:350-i*25,strokeIndex:18-h,...(!i?{putts:h?2:0,stats:{fairwayHit:false,teeDirection:'right' as const,greenInRegulation:true,penaltyStrokes:0}}:{})}))} satisfies SocialRoundCard}));
  return {id:'activity0',type:'ROUND_COMPLETED',audience:'FRIENDS',author:playerCards[0].author,createdAt:'2026-10-08',sourceVersion:4,currentHash:'current',roundId:'canonical',round:{...playerCards[0].round,playerCards},achievements:[],likesCount:0,likedByMe:false,commentsCount:0,attestCount:0,isAttestedByMe:false,canAttest:false,requiresParticipantConfirmation:false,participantPlayerKey:null,targetUserId:'p0'} satisfies SocialActivityCard;
}
for(const count of [1,2,3,4,MAX_ROUND_PLAYERS])test(`${count} independently authorized cards align gross holes and keep player tees/statistics separate`,()=>{
  const data=socialPremiumScorecard(fixture(count))!;assert.equal(data.players.length,count);
  for(let i=0;i<count;i++){
    const cells=domain.scorecardCells({...data,playerId:`p${i}`});assert.equal(domain.summarizeScorecard(cells).gross,72+i*18);assert.equal(cells[0].hole.yards,350-i*25);
    assert.equal(cells[0].putts,i?null:0);assert.equal(cells[0].gir,i?null:true);assert.equal(cells[0].stat.penaltyStrokes,i?undefined:0);
  }
  const h=socialUI('app/components/premium-scorecard.tsx',{'premium-scorecard':domain}),props={...data,view:{kind:'card'},onBack(){},onHole(){}};
  let tree=h.render('PremiumScorecard',props);
  if(count===1)return;
  assert.equal(uiNodes(tree).filter(n=>n.type==='tbody'&&n.props['data-scorecard-player']).length,count);
  assert.equal(uiNodes(tree).filter(n=>n.type==='th'&&uiText(n)==='Putts').length,0,'statistics collapsed by default');
  uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Estadísticas de Jugador QA 1').props.onClick();tree=h.render('PremiumScorecard',props);
  assert.equal(uiNodes(tree).filter(n=>n.type==='tbody'&&n.props['data-scorecard-player']).length,count);assert.match(uiText(tree),/Putts|FIR|GIR/);
  uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Estadísticas de Jugador QA 2').props.onClick();tree=h.render('PremiumScorecard',props);
  assert.equal(uiNodes(tree).filter(n=>n.type==='th'&&uiText(n)==='Putts').length,0,'player without stats does not borrow them');
  uiFind(tree,n=>n.type==='button'&&uiText(n)==='Ampliar tarjeta').props.onClick();tree=h.render('PremiumScorecard',props);
  assert.equal(uiFind(tree,n=>n.props['data-enlarged']===true).props['data-multiplayer'],true);
  for(const label of ['Vuelta / IN','18 HOYOS','TOTAL']){uiFind(tree,n=>n.type==='button'&&uiText(n).startsWith(label)).props.onClick();tree=h.render('PremiumScorecard',props);assert.equal(uiNodes(tree).filter(n=>n.type==='tbody'&&n.props['data-scorecard-player']).length,count);}
  assert.doesNotMatch(uiText(tree),/Editar score|Captura rápida/);
});
test('wrong round/revision, duplicate and unavailable cards cannot introduce hole data',()=>{
  const c=fixture(4);c.round.playerCards[1].round.roundId='different';c.round.playerCards[2].sourceVersion=3;c.round.playerCards[3].author.userId='p0';
  assert.equal(socialPremiumScorecard(c)!.players.length,1);
  const totalOnly=fixture(2);totalOnly.round.playerCards[1].round={...totalOnly.round.playerCards[1].round,totalOnly:true,scorecard:undefined} as any;
  (totalOnly.round as SocialRoundCard).leaderboard=[{userId:'p1',name:'Summary-only',avatarUrl:null,score:90,holes:18}];
  const data=socialPremiumScorecard(totalOnly)!;assert.equal(data.players.length,1);assert.equal(data.unsharedCards[0].name,'Summary-only');assert.equal(data.scores[1].p1,undefined);
});
