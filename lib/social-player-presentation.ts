import type {SocialActivityCard} from './social-activity-contract';
/** These lists describe visible shared activity, never private career totals. */
export function sharedPlayerRounds(cards:readonly SocialActivityCard[],userId:string){
  return [...new Map(cards.filter(c=>c.author.userId===userId&&c.round).map(c=>[c.roundId,c])).values()].sort((a,b)=>(b.round?.date??'').localeCompare(a.round?.date??''));
}
export function sharedPlayerCourses(cards:readonly SocialActivityCard[],userId:string){
  const groups=new Map<string,{name:string;rounds:number;best:number|null}>();
  for(const c of sharedPlayerRounds(cards,userId)) {const r=c.round!;if(!r.courseName||r.courseName==='Campo privado')continue;
    const key=`${r.courseName}:${r.holesPlayed}`,prior=groups.get(key)??{name:r.courseName,rounds:0,best:null};
    groups.set(key,{...prior,rounds:prior.rounds+1,best:r.ownerScore===null?prior.best:prior.best===null?r.ownerScore:Math.min(prior.best,r.ownerScore)});
  }
  return [...groups.entries()].map(([key,value])=>({key,...value,holes:Number(key.slice(key.lastIndexOf(':')+1))}));
}
export function sharedPlayerAchievements(cards:readonly SocialActivityCard[],userId:string){
  return sharedPlayerRounds(cards,userId).flatMap(c=>[...new Set(c.achievements)].map(label=>({key:`${c.roundId}:${label}`,label,card:c})));
}
