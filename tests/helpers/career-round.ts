import type { RoundSnapshot } from "../../lib/types";
export function careerRound(id: string, day: number, ownerScore = 4, rivalScore = 5, holes: 9 | 18 = 18): RoundSnapshot {
  const definitions = Array.from({length:18},(_,i) => ({number:i+1,par:4,strokeIndex:i+1}));
  const order = definitions.slice(0,holes).map(h => h.number);
  return { id,date:`2026-09-${String(day).padStart(2,"0")}`,lifecycleState:"completed",roundHoles:holes,courseName:"Campo QA sintético",teeName:"Blancas",ownerId:"owner-player",ownerName:"QA Owner",
    players:[{id:"owner-player",name:"QA Owner",handicap:0,accountUserId:"owner"},{id:"rival-player",name:"QA Rival",handicap:0,accountUserId:"rival"}],
    courseSnapshot:{id:"qa-course",name:"Campo QA sintético",teeName:"Blancas",holes:definitions},order,scores:Object.fromEntries(order.map(h => [h,{"owner-player":ownerScore,"rival-player":rivalScore}])),
    betResult:0,expenseTotal:0,netResult:0,categoryResults:{},expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0} };
}
