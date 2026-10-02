export type HoleEditorValues={par:string;hcp:string;yards:string[]};
export function scorecardYards(values:Record<string,unknown>,teeIndex:number,holeIndex:number){
 const tees=(values.tees||[]) as Record<string,unknown>[],holes=(values.holes||[]) as Record<string,unknown>[];
 const changed=((values.yardages||[]) as Record<string,unknown>[]).find(row=>row.teeIndex===teeIndex&&row.holeIndex===holeIndex);
 return changed?.yards??((values.teeHoleYardages||[]) as Record<string,unknown>[]).find(row=>row.teeId===tees[teeIndex]?.id&&row.holeId===holes[holeIndex]?.id)?.yards??"";
}
/** Only the selected hole changes; existing IDs, tee values and other edits survive. */
export function scorecardHolePatch(values:Record<string,unknown>,index:number,draft:HoleEditorValues){
 const holes=values.holes as Record<string,unknown>[];
 if(!holes[index])throw new Error("El hoyo ya no está disponible.");
 const yardages=((values.yardages||[]) as Record<string,unknown>[]).filter(row=>row.holeIndex!==index);
 return {holes:holes.map((hole,i)=>i===index?{...hole,par:draft.par,strokeIndex:draft.hcp}:hole),yardages:[...yardages,...draft.yards.map((yards,teeIndex)=>({teeIndex,holeIndex:index,yards}))]};
}
