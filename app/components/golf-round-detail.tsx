"use client";
import { useState } from "react";
import type { GolfObject } from "../../lib/golf-object-navigation";
import { againstPar, scoreResult, scoreResultLabel, scorecardTotals, SCORE_RESULTS } from "../../lib/golf-scorecard-presentation";
import { isValidGeographicPoint } from "../../lib/course-distance";
import type { RoundShotSnapshot } from "../../lib/types";
import { ScoreSummary, SocialRoundActivityCard } from "./cloud-social-activity";
import { useGolfNavigation } from "./golf-object-navigation";
import { useRoundObject, useGolfDistanceUnit } from "./golf-object-data";
import { GolfDetailHeader, GolfDetailSkeleton, GolfEmptyState, golfDate } from "./golf-detail-ui";
import { PremiumScorecard, ScoreSymbol } from "./premium-scorecard";
import { RoundParticipationCard } from "./round-participation-card";
import { BackyardIcon } from "./backyard-icon";
import { displayDistanceFromStoredYards } from "../../lib/account-ui-preferences";
import { teeDirectionLabel, landingLieLabel } from "../../lib/golf-captured-hole-facts";
import type { SocialScoreHole } from "../../lib/social-activity-contract";
import styles from "./golf-object.module.css";
type RoundObject = Extract<GolfObject, { kind: "round"|"hole"|"course" }>;

function RoundStory({holes,onHole}:{holes:SocialScoreHole[];onHole:(hole:number)=>void}) {
  const scored=holes.filter(h=>scoreResult(h.score,h.par)!=="missing"), front=holes.filter(h=>h.hole<=9),back=holes.filter(h=>h.hole>9);
  const highlights=scored.filter(h=>["birdie","eagle"].includes(scoreResult(h.score,h.par)));
  return <section className={styles.roundStory} aria-label="Resumen de la ronda"><h2>La ronda, de un vistazo</h2>
    <div className={styles.scoreMix}>{SCORE_RESULTS.map(result=><div key={result}><strong>{scored.filter(h=>scoreResult(h.score,h.par)===result).length}</strong><small>{result==="eagle"?"Eagles +":result==="double"?"Dobles +":result==="par"?"Pars":result==="birdie"?"Birdies":"Bogeys"}</small></div>)}</div>
    <dl className={styles.roundHalves}>{[["Front 9",front],["Back 9",back],["Total",holes]].filter(([,part])=>(part as SocialScoreHole[]).length).map(([label,part])=>{const total=scorecardTotals(part as SocialScoreHole[]);return <div key={label as string}><dt>{label as string}</dt><dd><b>{total.score??"—"}</b><span>{total.toPar===null?"Sin completar":againstPar(total.toPar)+" vs. par"}</span>{total.putts!==null&&<small>{total.putts} putts</small>}</dd></div>;})}</dl>
    {highlights.length>0&&<><h3>Momentos para recordar</h3><div className={styles.highlightHoles}>{highlights.map(h=><button type="button" key={h.hole} onClick={()=>onHole(h.hole)}><ScoreSymbol score={h.score} par={h.par}/><span>Hoyo {h.hole}<small>{scoreResultLabel[scoreResult(h.score,h.par)]}</small></span><BackyardIcon name="chevron" size={17}/></button>)}</div></>}
    {scored.length<holes.length&&<p className={styles.caption}>{scored.length} de {holes.length} hoyos con score. El resto todavía no está capturado.</p>}
  </section>;
}
export function GolfRoundDetailView({ object, onStats, onManage, onRules }: { object: RoundObject; onStats: () => void; onManage: (id: string) => void; onRules: () => void }) {
  const { detail, activity, loading, failed, retry, context } = useRoundObject(object), navigation = useGolfNavigation();
  const [view,setView]=useState<"summary"|"card">("summary");
  if (object.source === "shared") return <section className={styles.screen}><GolfDetailHeader title="Ronda compartida"/>{context.accessToken ? <RoundParticipationCard premium onHole={hole=>navigation?.open({...object,kind:"hole",hole})} onPlayer={id=>navigation?.open({kind:"player",id})} roundId={object.id} accessToken={context.accessToken}/> : <GolfEmptyState title="Inicia sesión" copy="Tu cuenta permite consultar esta tarjeta."/>}</section>;
  const holes=detail?.card.scorecard||[];
  return <section className={styles.screen}><GolfDetailHeader title="Ronda" subtitle={detail ? golfDate(detail.card.date) : undefined}/>
    {loading ? <GolfDetailSkeleton/> : !detail ? <GolfEmptyState title="No pudimos abrir esta ronda" copy="Puede haber cambiado su disponibilidad. Tu histórico se conserva." retry={failed ? retry : undefined}/> : <>
      <button type="button" className={styles.courseIdentity} onClick={()=>navigation?.open({...object,kind:"course"})}><span className={styles.courseIcon}><BackyardIcon name="flag" size={25}/></span><span><b>{detail.card.courseName}</b><small>{detail.card.teeName || "Tee no registrado"} · {detail.card.holesPlayed} hoyos{detail.card.coursePar!==null?" · Par "+detail.card.coursePar:""}</small></span><BackyardIcon name="chevron" size={18}/></button>
      {activity ? <button type="button" className={styles.playerLink} onClick={()=>navigation?.open({kind:"player",id:activity.author.userId})}>{detail.playerName} <BackyardIcon name="chevron" size={14}/></button>:detail.playerName&&<p className={styles.caption}>{detail.playerName}{detail.handicapApplied!==undefined?" · HCP aplicado "+detail.handicapApplied:""}</p>}
      {holes.length>0&&<nav className={styles.tabs} aria-label="Vistas de la ronda"><button type="button" aria-pressed={view==="summary"} onClick={()=>setView("summary")}>Resumen</button><button type="button" aria-pressed={view==="card"} onClick={()=>setView("card")}>Tarjeta</button></nav>}
      {view==="summary"?<><div className={styles.roundSummary}><ScoreSummary round={detail.card}/></div>{holes.length>0?<RoundStory holes={holes} onHole={hole=>navigation?.open({...object,kind:"hole",hole})}/>:<GolfEmptyState title="Score total registrado" copy="Esta ronda no tiene captura por hoyo. El score total conserva su valor original."/>}
      {holes.length>0&&<button type="button" className={styles.primary} onClick={()=>setView("card")}>Ver tarjeta completa</button>}
      {activity?.round?.leaderboard&&<section className={styles.section}><h2>Resultados</h2><ol className={styles.ranking}>{activity.round.leaderboard.map((player,i)=><li key={player.userId}><button type="button" onClick={()=>navigation?.open({kind:"player",id:player.userId})}><span>{i+1}</span><b>{player.name}</b><strong>{player.score}</strong><small>{player.toPar===undefined?player.holes+" H":againstPar(player.toPar)}</small><BackyardIcon name="chevron" size={15}/></button></li>)}</ol></section>}</>:<PremiumScorecard holes={holes} onHole={hole=>navigation?.open({...object,kind:"hole",hole})}/>}
      <div className={styles.actionPair}>{object.source === "history" && <button type="button" className={styles.secondary} onClick={onStats}>Mis estadísticas</button>}<button type="button" className={styles.secondary} onClick={onRules}>Consultar regla</button></div>
      {object.source === "history" && <button type="button" className={styles.textAction} onClick={()=>onManage(object.id)}>Opciones de esta ronda <BackyardIcon name="chevron" size={15}/></button>}
      {activity && context.accessToken && <SocialRoundActivityCard card={activity} viewerId={context.viewerId} accessToken={context.accessToken} actionsOnly onRefresh={async()=>retry()} />}
    </>}
  </section>;
}

/** A plot of recorded GPS points, never satellite imagery or an invented course. */
function RecordedShotPath({ shots }: { shots: RoundShotSnapshot[] }) {
  const points = shots.flatMap(shot=>[shot.startLocation,shot.endLocation].filter(isValidGeographicPoint));
  if (points.length < 2) return null;
  const west=Math.min(...points.map(p=>p.longitude)), east=Math.max(...points.map(p=>p.longitude)), south=Math.min(...points.map(p=>p.latitude)), north=Math.max(...points.map(p=>p.latitude));
  const positions=points.map(p=>({x:28+(p.longitude-west)/Math.max(.000001,east-west)*264,y:230-(p.latitude-south)/Math.max(.000001,north-south)*198}));
  return <figure className={styles.shotMap}><svg viewBox="0 0 320 260" role="img" aria-label="Recorrido de los golpes con coordenadas GPS registradas"><path d="M28 32V230H292" className={styles.mapGuide}/><polyline points={positions.map(p=>`${p.x},${p.y}`).join(" ")} className={styles.shotLine}/>{positions.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="9"/><text x={p.x} y={p.y+4} textAnchor="middle">{i+1}</text></g>)}</svg><figcaption>Recorrido registrado · GPS</figcaption></figure>;
}
export function GolfHoleDetailView({ object, onRules }: { object: RoundObject; onRules: () => void }) {
  const { detail, loading, failed, retry } = useRoundObject(object), navigation = useGolfNavigation();
  const unit=useGolfDistanceUnit();
  const [view,setView]=useState<"data"|"shots">("data"), number=object.hole!, hole=detail?.card.scorecard?.find(h=>h.hole===number), shots=detail?.shots.filter(s=>s.hole===number).sort((a,b)=>a.sequence-b.sequence)||[];
  return <section className={styles.screen}><GolfDetailHeader title={`Hoyo ${number}`} subtitle={hole?`Par ${hole.par}${hole.yards?` · ${displayDistanceFromStoredYards(hole.yards,unit)}`:""}`:undefined}/>
    {loading ? <GolfDetailSkeleton/> : !hole ? <GolfEmptyState title="Hoyo no disponible" copy="No hay una tarjeta accesible para este hoyo." retry={failed?retry:undefined}/> : <>
      <nav className={styles.tabs} aria-label="Información del hoyo"><button type="button" aria-pressed={view==="data"} onClick={()=>setView("data")}>Datos</button><button type="button" aria-pressed={view==="shots"} onClick={()=>setView("shots")}>Golpes</button></nav>
      {view==="data" ? <><div className={styles.holeResult}><ScoreSymbol score={hole.score} par={hole.par}/><div><h2>{scoreResultLabel[scoreResult(hole.score,hole.par)]}</h2><p>{hole.score===null?"Sin score registrado":`${hole.score} golpes · ${againstPar(hole.score-hole.par)} contra par`}</p></div></div><dl className={styles.holeFacts}><div><dt>Par</dt><dd>{hole.par}</dd></div><div><dt>Putts</dt><dd>{hole.putts??"—"}</dd></div>{typeof hole.fairwayHit==="boolean"&&<div><dt>Fairway</dt><dd>{hole.fairwayHit?"Acertado":"Fallado"}</dd></div>}{typeof hole.greenInRegulation==="boolean"&&<div><dt>Green en regulación</dt><dd>{hole.greenInRegulation?"Sí":"No"}</dd></div>}{hole.penaltyStrokes!==undefined&&<div><dt>Penalidades</dt><dd>{hole.penaltyStrokes}</dd></div>}{hole.teeDirection&&<div><dt>Dirección de salida</dt><dd className={styles.factText}>{teeDirectionLabel[hole.teeDirection]}</dd></div>}{hole.teeClub&&<div><dt>Palo de salida</dt><dd className={styles.factText}>{hole.teeClub}</dd></div>}{hole.teeDistance!==undefined&&<div><dt>Distancia de salida</dt><dd>{displayDistanceFromStoredYards(hole.teeDistance,unit)}</dd></div>}{hole.firstPuttDistanceFeet!==undefined&&<div><dt>Primer putt</dt><dd>{unit==="meters"?(hole.firstPuttDistanceFeet*0.3048).toLocaleString("es-MX",{maximumFractionDigits:1})+" m":hole.firstPuttDistanceFeet+" ft"}</dd></div>}{hole.landingLie&&<div><dt>Zona de llegada</dt><dd className={styles.factText}>{landingLieLabel[hole.landingLie]}</dd></div>}{([ ["Búnkers",hole.bunkerCount],["Búnker junto al green",hole.greenSideBunkerCount],["Búnker de fairway",hole.fairwayBunkerCount],["Área de penalidad",hole.penaltyAreaCount],["OB",hole.outOfBoundsCount??(typeof hole.outOfBounds==="boolean"?Number(hole.outOfBounds):undefined)] ] as const).filter(([,value])=>value!==undefined).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className={styles.caption}>{detail?.card.courseName}</p></> : shots.length ? <><RecordedShotPath shots={shots}/><ol className={styles.shots}>{shots.map(shot=><li key={shot.id}><span>{shot.sequence}</span><div><b>Golpe {shot.sequence}</b><p>{shot.clubSnapshot?.label || shot.clubLabel}</p></div><strong>{Number.isFinite(shot.distanceYards)?displayDistanceFromStoredYards(shot.distanceYards!,unit):"—"}</strong></li>)}</ol></> : <GolfEmptyState title="Sin golpes registrados" copy="Esta tarjeta conserva el score y los datos capturados. No hay un recorrido GPS compartido para este hoyo."/>}
      <div className={styles.holeNavigation}>{[-1,1].map(offset=>{const adjacent=detail?.card.scorecard?.find(h=>h.hole===number+offset);return <button type="button" className={styles.secondary} key={offset} disabled={!adjacent} onClick={()=>navigation?.open({...object,hole:number+offset})}>{offset<0?"‹ Anterior":"Siguiente ›"}</button>;})}</div>
      <button type="button" className={styles.textAction} onClick={onRules}>Consultar una regla <BackyardIcon name="info" size={18}/></button>
    </>}
  </section>;
}
export function GolfCourseDetailView({ object }: { object: RoundObject }) {
  const { detail,loading,failed,retry }=useRoundObject(object), navigation=useGolfNavigation();
  return <section className={styles.screen}><GolfDetailHeader title="Campo"/>{loading?<GolfDetailSkeleton/>:detail?<><div className={styles.courseHero}><BackyardIcon name="flag" size={35}/><h2>{detail.card.courseName}</h2><p>{detail.card.teeName || "Tee no registrado"}</p></div><dl className={styles.holeFacts}><div><dt>Hoyos jugados</dt><dd>{detail.card.holesPlayed}</dd></div>{detail.card.coursePar!==null&&<div><dt>Par de la tarjeta</dt><dd>{detail.card.coursePar}</dd></div>}</dl><button type="button" className={styles.primary} onClick={()=>navigation?.open({...object,kind:"round"})}>Ver ronda del {golfDate(detail.card.date)}</button></>:<GolfEmptyState title="Campo no disponible" copy="No hay información compartida para mostrar." retry={failed?retry:undefined}/>}</section>;
}
