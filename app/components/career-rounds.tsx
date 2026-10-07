"use client";
import { useMemo, useState } from "react";
import { buildGolfInsights } from "../../lib/golf-insights";
import { buildHistoricalRoundRecap } from "../../lib/historical-round-recap";
import { careerNumber, careerDate, careerTrend, careerDistribution, careerPrecision, careerScoreSamples, ownCareerHistory, careerNewestFirst, scoreToPar, type CareerScoreSample } from "../../lib/career-statistics";
import type { RoundSnapshot } from "../../lib/types";
import type { CareerHubProps } from "./career-hub";
import { CareerPanel, CareerStatCard, CareerEmptyState, CareerCta } from "./career-shared";
import styles from "./career-hub.module.css";
import { PendingRoundRecoveryPanel } from "./pending-round-recovery";
import { GhinImportHistory } from "./ghin-import-history";

export function RoundTrendChart({ rows }: {rows:readonly CareerScoreSample[]}) {
  const ordered=[...rows].sort((a,b)=>careerNewestFirst(b,a));
  if(!ordered.length) return <p className={styles.caption}>Sin datos suficientes para mostrar la evolución.</p>;
  const points=ordered.length>40 ? [...new Set(ordered.map(r=>r.date.slice(0,7)))].map(month=>{const sample=ordered.filter(r=>r.date.startsWith(month));return {date:`${month}-15`,gross:sample.reduce((s,r)=>s+r.gross,0)/sample.length};}) : ordered;
  const min=Math.floor(Math.min(...points.map(r=>r.gross))-4),max=Math.ceil(Math.max(...points.map(r=>r.gross))+4);
  const first=Date.parse(points[0].date),last=Date.parse(points[points.length-1].date);
  const x=(date:string)=>last===first?195:45+(Date.parse(date)-first)/(last-first)*295;
  const y=(score:number)=>160-(score-min)/(max-min)*135;
  const average=ordered.reduce((s,r)=>s+r.gross,0)/ordered.length;
  const mx=points.reduce((s,r)=>s+x(r.date),0)/points.length,my=points.reduce((s,r)=>s+r.gross,0)/points.length;
  const denominator=points.reduce((s,r)=>s+(x(r.date)-mx)**2,0);
  const slope=denominator?points.reduce((s,r)=>s+(x(r.date)-mx)*(r.gross-my),0)/denominator:0;
  return <figure className={styles.trendFigure}><svg viewBox="0 0 360 206" role="img" aria-label={`Evolución de score: ${points.map(r=>`${careerDate(r.date)}, ${careerNumber(r.gross,1)} golpes`).join("; ")}. Promedio ${careerNumber(average,1)}.`}>{[0,1,2,3].map(i=>{const value=min+(max-min)*i/3;return <g key={i}><line x1="45" x2="340" y1={y(value)} y2={y(value)} stroke="#d6dfcd"/><text x="34" y={y(value)+4} textAnchor="end" fill="#56704e" fontSize="12">{Math.round(value)}</text></g>;})}<line x1="45" x2="340" y1={y(average)} y2={y(average)} stroke="#9b8350" strokeDasharray="3 5"/>{points.length>1&&<polyline points={points.map(r=>`${x(r.date)},${y(r.gross)}`).join(" ")} stroke="#2f6545" strokeWidth="2" fill="none"/>}{points.length>=4&&<line x1="45" x2="340" y1={y(my+slope*(45-mx))} y2={y(my+slope*(340-mx))} stroke="#8b9f7a" strokeDasharray="5 4"/>}{points.map((r,i)=><circle key={i} cx={x(r.date)} cy={y(r.gross)} r="4" fill="#cfab61" stroke="#fbfaf4"><title>{`${careerDate(r.date)} · ${careerNumber(r.gross,1)}`}</title></circle>)}<text x="45" y="190" fill="#56704e" fontSize="12">{careerDate(points[0].date).replace(/ de /g," ")}</text>{points.length>1&&<text x="340" y="190" textAnchor="end" fill="#56704e" fontSize="12">{careerDate(points[points.length-1].date).replace(/ de /g," ")}</text>}</svg><figcaption>Score {ordered.length>40?"promedio por mes":"por ronda"} · promedio {careerNumber(average,1)} · tendencia en línea discontinua{ordered.length<4?" (sin datos suficientes)":""}</figcaption></figure>;
}
export function RoundDistribution({ rows,holes }: {rows:readonly CareerScoreSample[];holes:9|18}) {
  const buckets=careerDistribution(rows,holes),max=Math.max(1,...buckets.map(b=>b.count));
  return <div className={styles.distribution} role="img" aria-label={`Distribución: ${buckets.map(b=>`${b.label}: ${b.count} rondas`).join(", ")}`}>{buckets.map(b=><div key={b.label}><strong>{b.count}</strong><i style={{height:`${Math.max(3,b.count/max*80)}px`}}/><span>{b.label}</span></div>)}</div>;
}
const statusLabel=(round:RoundSnapshot)=>round.lifecycleState==="cancelled"?"Cancelada":round.pausedAt&&round.lifecycleState==="live"?"Pausada":round.lifecycleState==="live"?"En juego":round.lifecycleState==="draft"?"En preparación":"Completada";
export function RoundHistoryRow({ round,row,onOpen }: {round:RoundSnapshot;row?:CareerScoreSample;onOpen:(id:string)=>void}) {
  return <button type="button" className={styles.roundRow} onClick={()=>onOpen(round.id)} aria-label={`Ver scorecard de ${round.courseName}`}><span className={styles.rowMain}><strong>{round.courseName}</strong><small>{careerDate(round.date)} · {round.roundHoles??round.order?.length??"—"} hoyos · {statusLabel(round)}</small><small>{round.teeName}{row?.source==="declared"?" · Total declarado":" · Stroke Play"}</small></span><span className={styles.rowScore}><strong>{row?.gross??"—"}</strong>{row?.relativeToPar!==undefined&&<small>{scoreToPar(row.relativeToPar)} vs. par</small>}</span><span aria-hidden="true">›</span></button>;
}
export function RoundScorecardPreview({ round,row,onOpen }: {round:RoundSnapshot;row?:CareerScoreSample;onOpen:(id:string)=>void}) {
  const recap=useMemo(()=>buildHistoricalRoundRecap(round),[round]);
  const holes=recap.golf?.scorecard.slice(0,9)??[];
  return <CareerPanel title="Última ronda"><div className={styles.latestRound}><small>{careerDate(round.date)} · {statusLabel(round)}</small><h3>{round.courseName}</h3><strong>{row?.gross??"—"}</strong>{row?.relativeToPar!==undefined&&<span>{scoreToPar(row.relativeToPar)} vs. par</span>}</div>{row?.source!=="declared"&&holes.length>0?<div className={styles.scorecardScroll} tabIndex={0} aria-label="Vista previa del scorecard"><table className={styles.scorecard}><caption>Primeros {holes.length} hoyos de la tarjeta</caption><thead><tr><th scope="col">Hoyo</th>{holes.map(h=><th key={h.number} scope="col">{h.number}</th>)}</tr></thead><tbody><tr><th scope="row">Par</th>{holes.map(h=><td key={h.number}>{h.par}</td>)}</tr><tr><th scope="row">Score</th>{holes.map(h=><td key={h.number}>{h.players.find(p=>p.playerId===round.ownerId)?.score??"—"}</td>)}</tr></tbody></table></div>:<p className={styles.caption}>{row?.source==="declared"?"Total declarado; todavía no hay captura por hoyo.":"Sin datos suficientes para mostrar el scorecard."}</p>}<button type="button" className={styles.goldButton} onClick={()=>onOpen(round.id)}>Ver scorecard completo ›</button></CareerPanel>;
}
export function CareerRounds(props:CareerHubProps) {
  const [view,setView]=useState<"history"|"analysis">("history");
  const [year,setYear]=useState("all"),[course,setCourse]=useState("all"),[holes,setHoles]=useState<9|18>(props.insights.scoreScopeHoles??18),[limit,setLimit]=useState(10);
  const history=useMemo(()=>ownCareerHistory(props.history??props.rounds,props.userId).sort(careerNewestFirst),[props.history,props.rounds,props.userId]);
  const matches=(r:RoundSnapshot)=> (year==="all"||r.date.startsWith(year))&&(course==="all"||r.courseName===course)&&(r.roundHoles??r.order?.length)===holes;
  const filtered=history.filter(matches);
  const sports=useMemo(()=>props.rounds.filter(r=>(year==="all"||r.date.startsWith(year))&&(course==="all"||r.courseName===course)&&(r.roundHoles??r.order?.length)===holes),[props.rounds,year,course,holes]);
  const insights=useMemo(()=>buildGolfInsights(sports),[sports]);
  const sample=useMemo(()=>careerScoreSamples(sports,insights,props.userId),[sports,insights,props.userId]);
  const fullScores=useMemo(()=>new Map(careerScoreSamples(history,buildGolfInsights(history),props.userId).map(r=>[r.id,r])),[history,props.userId]);
  const precision=useMemo(()=>careerPrecision(sports,insights,props.userId),[sports,insights,props.userId]);
  const trend=careerTrend(sample),average=sample.length?sample.reduce((sum,r)=>sum+r.gross,0)/sample.length:undefined,best=sample.length?Math.min(...sample.map(r=>r.gross)):undefined;
  const unifiedRows=history.map(r=>({id:r.id,date:r.date,courseName:r.courseName,teeName:r.teeName,holes:r.roundHoles??r.order?.length??null,gross:fullScores.get(r.id)?.gross??null,lifecycle:statusLabel(r)}));
  return <><div className={styles.filters}><label>Periodo<select value={year} onChange={e=>{setYear(e.target.value);setLimit(10);}}><option value="all">Todo el historial</option>{[...new Set([...history.map(r=>r.date.slice(0,4)),...(props.ghin?.imports?.data?.filters.years??[])])].sort().reverse().map(y=><option key={y} value={y}>{y}</option>)}</select></label><label>Campo<select value={course} onChange={e=>{setCourse(e.target.value);setLimit(10);}}><option value="all">Todos los campos</option>{[...new Set([...history.map(r=>r.courseName),...(props.ghin?.imports?.data?.filters.courses??[])])].sort().map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Modalidad<select value={holes} onChange={e=>{setHoles(Number(e.target.value) as 9|18);setLimit(10);}}><option value="18">Stroke Play · 18 hoyos</option><option value="9">Stroke Play · 9 hoyos</option></select></label></div>
    {!filtered.length&&!props.ghin?.imports?.data?.total&&<CareerEmptyState title={history.length?"No hay rondas en estos filtros.":"Tu historia empieza con tu primera ronda."} action="Registrar nueva ronda" onAction={props.onCreateRound}/>}
    <nav className={styles.roundViews} aria-label="Vistas del historial"><button type="button" aria-pressed={view==="history"} onClick={()=>setView("history")}>Historial</button><button type="button" aria-pressed={view==="analysis"} onClick={()=>setView("analysis")}>Evolución</button></nav>
    {view==="analysis"&&<><div className={styles.metrics}><CareerStatCard label="Rondas completadas" value={insights.rounds}/><CareerStatCard label="Score promedio" value={careerNumber(average,1)} hint={`${sample.length} resultados · ${holes} hoyos`}/><CareerStatCard label="Mejor ronda" value={best}/><CareerStatCard label="Tendencia" value={trend===undefined?undefined:`${trend>0?"+":""}${careerNumber(trend,1)}`} hint="Últimas 5 vs. 5 anteriores; mínimo 4 rondas"/></div>
    <CareerPanel title="Evolución de score"><RoundTrendChart rows={sample}/></CareerPanel>
    <CareerPanel title="Precisión registrada"><div className={styles.metrics}>{precision.fairways!==undefined&&<CareerStatCard label="Fairways" value={`${careerNumber(precision.fairways)}%`} hint={`${precision.fairwayAttempts} capturas`}/>} {precision.gir!==undefined&&<CareerStatCard label="Greens en regulación" value={`${careerNumber(precision.gir)}%`} hint={`${precision.greenAttempts} capturas`}/>} {precision.putts!==undefined&&<CareerStatCard label="Putts por hoyo" value={careerNumber(precision.putts,1)} hint={`${precision.puttHoles} hoyos`}/>} {precision.distance!==undefined&&<CareerStatCard label="Distancia de salida" value={careerNumber(precision.distance)} hint={`${precision.distanceHoles} capturas · yardas`}/>}</div>{precision.gir===undefined&&precision.putts===undefined&&precision.fairways===undefined&&precision.distance===undefined&&<p className={styles.caption}>Sin datos suficientes. Captura precisión y putts durante tus rondas para conocer esta parte de tu juego.</p>}</CareerPanel>
    <CareerPanel title="Distribución de scores"><RoundDistribution rows={sample} holes={holes}/></CareerPanel>
    </>}
    {view==="history"&&(props.ghin?.imports?.data?.total?<GhinImportHistory compactExplanation control={props.ghin.imports} backyard={unifiedRows} onOpenRound={props.onOpenRound} year={year} course={course} holes={holes}/>:<CareerPanel title="Histórico de rondas">{filtered.slice(0,limit).map(r=><RoundHistoryRow key={r.id} round={r} row={fullScores.get(r.id)} onOpen={props.onOpenRound}/>)}{filtered.length>limit&&<button type="button" className={styles.goldButton} onClick={()=>setLimit(v=>v+10)}>Cargar más rondas</button>}<p className={styles.caption}>El histórico conserva todas tus tarjetas.</p></CareerPanel>)}
    {props.onResumeRound&&<PendingRoundRecoveryPanel key={props.userId} userId={props.userId} accessToken={props.accessToken} activeRoundId={props.activeRoundId} onResume={props.onResumeRound}/>}
    {view==="analysis"&&filtered[0]&&<RoundScorecardPreview round={filtered[0]} row={fullScores.get(filtered[0].id)} onOpen={props.onOpenRound}/>}
    <CareerCta title="Cada ronda cuenta." label="Registrar nueva ronda" onAction={props.onCreateRound}/></>;
}
