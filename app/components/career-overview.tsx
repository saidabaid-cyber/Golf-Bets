"use client";
import { useMemo } from "react";
import { careerSeason, careerPrecision, careerNumber, careerDate, scoreToPar,careerScoreSamples,type CareerScoreSample } from "../../lib/career-statistics";
import type { CareerHubProps } from "./career-hub";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { CareerPanel, CareerStatCard, CareerEmptyState, CareerErrorState } from "./career-shared";
import styles from "./career-hub.module.css";
import { combineProviderGrossTotals } from "../../lib/ghin/score-reconciliation";

export function PlayerCareerCard({ displayName, avatarUrl, username, club, city, index }: CareerHubProps) {
  return <div className={styles.playerCard}><ProfileAvatarMedia value={avatarUrl} fallback={displayName.trim().slice(0, 1) || "⚑"} className={styles.avatar} /><div className={styles.playerIdentity}><h2>{displayName}</h2>{username && <p>@{username.replace(/^@/, "")}</p>}{club && <p>⌖ {club}</p>}{city && <p>{city}</p>}</div><div className={styles.index}><small>{index.source === "GHIN" ? "Handicap Index" : index.source === "BACKYARD" ? "Backyard Index" : "Índice"}</small><strong>{careerNumber(index.value, 1)}</strong>{index.value === null && <small>Sin índice disponible</small>}</div></div>;
}
export function CareerRoundRow({ row, onOpen }: { row: CareerScoreSample; onOpen: (id: string) => void }) {
  return <button type="button" className={styles.roundRow} onClick={() => onOpen(row.id)} aria-label={`Ver ronda en ${row.courseName}, ${careerDate(row.date)}`}><span className={styles.rowMain}><strong>{row.courseName}</strong><small>{careerDate(row.date)} · {row.holeCount} hoyos</small>{row.teeName && <small>{row.teeName}</small>}</span><span className={styles.rowScore}><strong>{row.gross}</strong><small>{row.relativeToPar === undefined ? "Total declarado" : `${scoreToPar(row.relativeToPar)} vs. par`}</small></span><span aria-hidden="true">›</span></button>;
}
export function CareerOverview(props: CareerHubProps) {
  const { insights, onView, onOpenRound, onCreateRound } = props;
  const year = new Date().getFullYear(), holes = insights.scoreScopeHoles ?? 18;
  const sample=useMemo(()=>careerScoreSamples(props.rounds,insights,props.userId),[props.rounds,insights,props.userId]);
  const comparable=sample.filter(row=>row.holeCount===holes);
  const season = useMemo(() => careerSeason(sample, year, holes), [sample, year, holes]);
  const precision = useMemo(() => careerPrecision(props.rounds, insights, props.userId), [props.rounds, insights, props.userId]);
  const combined=combineProviderGrossTotals(comparable,props.ghin?.imports?.data?.grossTotals[holes]);
  const average=comparable.length?comparable.reduce((sum,row)=>sum+row.gross,0)/comparable.length:undefined;
  const best=[...comparable].sort((a,b)=>a.gross-b.gross)[0];
  return <><p className={styles.periodLabel}>{props.displayName}</p>{props.error ? <CareerErrorState onRetry={props.onRetry} /> : <>
    {insights.rounds === 0 && <CareerEmptyState title="Tu historia empieza con tu primera ronda." action="Crear ronda" onAction={onCreateRound} />}
    <CareerPanel title="Tu trayectoria" action="Estadísticas" onAction={props.onOpenStats}>
      <div className={styles.overviewMetrics}><CareerStatCard label="Rondas" value={careerNumber(insights.rounds)}/><CareerStatCard label="Campos" value={careerNumber(insights.coursesPlayed)}/><CareerStatCard label="Promedio" value={careerNumber(average,1)} hint={holes+" hoyos"}/><CareerStatCard label="Mejor ronda" value={best?.gross} hint={holes+" hoyos"}/></div>
      <div className={styles.careerFacts} aria-label="Resultados de carrera">{insights.scoredRounds>0&&<><span><b>{insights.birdies}</b> Birdies</span><span><b>{insights.eaglesOrBetter}</b> Eagles o mejor</span></>}{precision.fairways!==undefined&&<span><b>{careerNumber(precision.fairways)}%</b> FIR capturado</span>}{precision.gir!==undefined&&<span><b>{careerNumber(precision.gir)}%</b> GIR capturado</span>}</div>
      <small className={styles.periodLabel}>Histórico Backyard · scores comparables de {holes} hoyos. Resultados por hoyo de tarjetas completas.</small>
      <button type="button" className={styles.statsShortcut} onClick={props.onOpenStats}>Scoring · Putting · Driving · Approach <span aria-hidden="true">›</span></button>
    </CareerPanel>
    <CareerPanel title="Rondas recientes" action="Ver todas" onAction={() => onView("rounds")}>{sample.slice(0,3).map(row=><CareerRoundRow key={row.id} row={row} onOpen={onOpenRound}/>)}{!sample.length&&<p className={styles.caption}>Las tarjetas completas aparecerán aquí.</p>}</CareerPanel>
    {best&&<button type="button" className={styles.recordStrip} onClick={()=>onOpenRound(best.id)}><span><small>MEJOR RONDA · {holes} HOYOS</small><b>{best.courseName}</b><small>{careerDate(best.date)}</small></span><strong>{best.gross}</strong><span aria-hidden="true">›</span></button>}
    <div className={styles.overviewLinks}><button type="button" onClick={()=>onView("achievements")}>Ver mis logros <span aria-hidden="true">›</span></button><button type="button" onClick={()=>onView("rivalries")}>Mis rivalidades <span aria-hidden="true">›</span></button></div>
    <details className={styles.summaryDetails}><summary>Temporada {year}</summary><div className={styles.metrics}><CareerStatCard label="Score promedio" value={careerNumber(season.average,1)} hint={season.rounds+" rondas · "+holes+" hoyos"}/><CareerStatCard label="Evolución" value={season.evolution===undefined?undefined:(season.evolution>0?"+":"")+careerNumber(season.evolution,1)} hint={"Golpes vs. "+(year-1)}/></div></details>
    {!!props.ghin?.imports?.data?.total&&<details className={styles.summaryDetails}><summary>Historial combinado · Backyard y GHIN</summary><div className={styles.metrics}><CareerStatCard label="Rondas con score bruto" value={combined.rounds}/><CareerStatCard label="Score promedio" value={careerNumber(combined.average,1)}/><CareerStatCard label="Mejor score" value={careerNumber(combined.best)}/></div><p className={styles.caption}>{holes} hoyos · las vinculadas cuentan una sola vez. Logros por hoyo y Atest usan evidencia Backyard.</p></details>}
    {insights.betBalance!==undefined&&<details className={styles.summaryDetails}><summary>Resultados personales registrados</summary><CareerStatCard label="Balance personal" value={insights.betBalance.toLocaleString("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0})} hint={insights.betRounds+" rondas con resultado verificable"}/></details>}
  </>}</>;
}
