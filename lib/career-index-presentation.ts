import { calculateBackyardIndex } from "./backyard-index";
import type { RoundSnapshot } from "./types";
export type CareerAttestCard={roundId:string;date:string;completedAt?:string;courseName:string;score:number;currentHash:string;version:number;attested:boolean};
export type CareerAttestSummary={cards:CareerAttestCard[];count:number;percent:number;slots:boolean[]};
export type AttestEvidence={round_id:string;target_user_id:string;attester_id:string;expected_hash:string;expected_version:number};
/** Fixed 20-slot denominator. Participation links are deliberately not an input. */
export function careerAttestSummary(cards:Omit<CareerAttestCard,"attested">[],attests:AttestEvidence[],owner:string):CareerAttestSummary {
  const selected=[...new Map(cards.map(c=>[c.roundId,c])).values()].sort((a,b)=>b.date.localeCompare(a.date)||String(b.completedAt??"").localeCompare(String(a.completedAt??""))||b.roundId.localeCompare(a.roundId)).slice(0,20);
  const result=selected.map(card=>({...card,attested:attests.some(a=>a.round_id===card.roundId&&a.target_user_id===owner&&a.attester_id!==owner&&a.expected_hash===card.currentHash&&Number(a.expected_version)>0&&Number(a.expected_version)<=card.version)}));
  const count=result.filter(c=>c.attested).length;
  return {cards:result,count,percent:count*5,slots:Array.from({length:20},(_,i)=>result[i]?.attested===true)};
}
/** Historical recalculation reads frozen rated-tee/PCC evidence with the canonical engine. No differential is presented as an index. */
export function backyardIndexTimeline(rounds:readonly RoundSnapshot[],user:string) {
  const eligible=new Set(calculateBackyardIndex(rounds,user).records.filter(r=>r.eligible).map(r=>r.roundId));
  const ordered=[...new Map(rounds.filter(r=>eligible.has(r.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.date.localeCompare(b.date)||String(a.startedAt??a.completedAt).localeCompare(String(b.startedAt??b.completedAt))||a.id.localeCompare(b.id));
  const points:Array<{date:string;value:number}>=[];
  for(let i=0;i<ordered.length;i++){
    const summary=calculateBackyardIndex(ordered.slice(Math.max(0,i-19),i+1),user);
    if(!summary.records.some(r=>r.roundId===ordered[i].id&&r.eligible)||summary.value===null)continue;
    const date=ordered[i].date;
    if(points.at(-1)?.date===date)points[points.length-1]={date,value:summary.value};else points.push({date,value:summary.value});
  }
  const values=points.map(p=>p.value);
  return {points,low:values.length?Math.min(...values):null,average:values.length?values.reduce((s,v)=>s+v,0)/values.length:null,high:values.length?Math.max(...values):null};
}
