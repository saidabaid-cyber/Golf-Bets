/** Geometry only: dated index observations are never interpolated into new facts. */
export function careerIndexChart(points: readonly {date:string;value:number}[]) {
  const observed=points.filter(p=>Number.isFinite(p.value)&&Number.isFinite(Date.parse(p.date))).sort((a,b)=>a.date.localeCompare(b.date));
  if(observed.length<2)return null;
  const values=observed.map(p=>p.value);
  const min=Math.floor(Math.min(0,...values)/5)*5;
  const max=Math.max(min+5,Math.ceil(Math.max(...values)/5)*5);
  const first=Date.parse(observed[0].date),last=Date.parse(observed.at(-1)!.date);
  const plotted=observed.map(p=>({...p,x:36+(Date.parse(p.date)-first)/Math.max(1,last-first)*294,y:166-(p.value-min)/(max-min)*138}));
  return {min,max,points:plotted,ticks:Array.from({length:5},(_,i)=>min+(max-min)*i/4),path:plotted.map((p,i)=>`${i?"L":"M"}${p.x},${p.y}`).join(" ")};
}
