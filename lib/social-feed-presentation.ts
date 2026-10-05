import type { SocialActivityCard, SocialRoundCard } from "./social-activity-contract";
import type { RoundSnapshot } from "./types";
import type { EquipmentProfile, GolfClubCatalog, GolfBallCatalog } from "./golf-equipment";
const categories:Record<string,string>={DRIVER:"Driver",MINI_DRIVER:"Mini driver",FAIRWAY_WOOD:"Maderas",HYBRID:"Híbrido",UTILITY_IRON:"Utility iron",IRON_SET:"Hierros",WEDGE:"Wedges",PUTTER:"Putter"};
/** Missing captures stay missing; precision is never inferred from strokes. */
export function capturedSocialStats(round:RoundSnapshot,account:string):Pick<SocialRoundCard,"putts"|"girPct"|"firPct"> {
  const player=round.players?.filter(p=>p.accountUserId===account); const order=round.order;
  if(player?.length!==1||!order?.length)return {};
  const id=player[0].id, definitions=round.courseSnapshot?.playerHoleCards?.[id]??round.courseSnapshot?.holes??[];
  const putts=order.map(h=>round.putts?.[h]?.[id]), greens=order.map(h=>round.advancedStats?.[h]?.[id]?.greenInRegulation);
  const fairwayHoles=order.filter(h=>(definitions.find(d=>d.number===h)?.par??0)>3),fairways=fairwayHoles.map(h=>round.advancedStats?.[h]?.[id]?.fairwayHit);
  return {...(putts.every(p=>typeof p==="number"&&Number.isInteger(p)&&p>=0&&p<=20)?{putts:putts.reduce<number>((n,p)=>n+p!,0)}:{}),
    ...(greens.every(g=>typeof g==="boolean")?{girPct:Math.round(greens.filter(Boolean).length/greens.length*100)}:{}),
    ...(fairways.length&&fairways.every(f=>typeof f==="boolean")?{firPct:Math.round(fairways.filter(Boolean).length/fairways.length*100)}:{})};
}
export function safeEquipmentSummary(profile:EquipmentProfile,clubs:readonly GolfClubCatalog[],balls:readonly GolfBallCatalog[]) {
  const image=(url:string|null|undefined)=>typeof url==="string"&&/^\/equipment\/[A-Za-z0-9/_.,-]+$/.test(url)?{imageUrl:url}:{};
  const items=[...(profile.clubs??[]).filter(c=>c.isCurrent).flatMap(c=>{const item=clubs.find(i=>i.id===c.catalogClubId); const brand=item?.brand||c.customBrand,model=item?.model||c.customModel;return brand&&model?[{id:c.id,category:categories[c.category]||"Bastón",brand,model,...image(item?.imageUrl)}]:[];}),
    ...(profile.balls??[]).filter(b=>b.isCurrent).flatMap(b=>{const item=balls.find(i=>i.id===b.catalogBallId);return b.ballBrand&&b.ballModel?[{id:b.id,category:"Bola",brand:item?.brand||b.ballBrand,model:item?.model||b.ballModel,...image(item?.imageUrl)}]:[];})];
  return {items:items.slice(0,12),total:items.length};
}
export function mergeSocialCards(current:readonly SocialActivityCard[],next:readonly SocialActivityCard[]) {
  const cards=new Map<string,SocialActivityCard>();
  for(const card of [...current,...next])cards.set(card.roundId?`${card.author.userId}:${card.roundId}`:card.id,card);
  return [...cards.values()];
}
export function socialRelativeTime(value:string,now=Date.now()) {
  const at=Date.parse(value); if(!Number.isFinite(at))return "Fecha no disponible";
  const minutes=Math.max(0,Math.floor((now-at)/60000));
  if(minutes<1)return "Ahora";if(minutes<60)return `Hace ${minutes} min`;
  if(minutes<1440)return `Hace ${Math.floor(minutes/60)} h`;
  if(minutes<2880)return "Hace 1 día";
  return new Date(at).toLocaleDateString("es-MX",{day:"numeric",month:"short"});
}
export function pullRefreshDistance(start:number,current:number,scrollTop:number) {return scrollTop>0?0:Math.min(96,Math.max(0,(current-start)*.5));}
