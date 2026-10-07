"use client";
import { useState } from "react";
import type { SocialScoreHole } from "../../lib/social-activity-contract";
import { againstPar, scoreResult, scoreResultLabel, scorecardTotals, SCORE_RESULTS } from "../../lib/golf-scorecard-presentation";
import styles from "./golf-object.module.css";
export function ScoreSymbol({ score, par }: { score: number | null; par: number }) {
  const result = scoreResult(score, par);
  return <span className={`${styles.scoreSymbol} ${styles[result]}`} data-score-result={result} aria-label={`${score ?? "Sin score"} · ${scoreResultLabel[result]}`}>{score ?? "—"}</span>;
}
function Totals({ title, holes }: { title: string; holes: readonly SocialScoreHole[] }) {
  const total = scorecardTotals(holes);
  return <div className={styles.scoreTotals} aria-label={title}><b>{title}</b><span>{total.par}</span><strong>{total.score ?? "—"}</strong><span>{total.toPar === null ? "—" : againstPar(total.toPar)}</span><span>{total.putts ?? "—"}</span></div>;
}
export function PremiumScorecard({ holes, onHole }: { holes: readonly SocialScoreHole[]; onHole: (hole: number) => void }) {
  const front = holes.filter(h => h.hole <= 9), back = holes.filter(h => h.hole > 9);
  const [half, setHalf] = useState<"front" | "back">(front.length ? "front" : "back");
  const shown = half === "front" ? front : back;
  return <section className={styles.scorecard} aria-label="Scorecard de la ronda">
    <div className={styles.sectionHeading}><h2>Tarjeta</h2><small>{holes.length} hoyos</small></div>
    <nav className={styles.tabs} aria-label="Mitades de la tarjeta">{([['front','Front 9',front],['back','Back 9',back]] as const).filter(([, , part])=>part.length).map(([id,label])=><button type="button" key={id} aria-pressed={half===id} onClick={()=>setHalf(id)}>{label}</button>)}</nav>
    <div className={styles.scoreColumns} aria-hidden="true"><span>Hoyo</span><span>Par</span><span>Score</span><span>+/−</span><span>Putts</span></div>
    <ol className={styles.scoreRows}>{shown.map(h => <li key={h.hole}><button type="button" aria-label={`Abrir hoyo ${h.hole} · ${scoreResultLabel[scoreResult(h.score,h.par)]}`} onClick={()=>onHole(h.hole)}><b>{h.hole}</b><span>{h.par}</span><ScoreSymbol score={h.score} par={h.par}/><span>{h.score === null ? "—" : againstPar(h.score-h.par)}</span><span>{h.putts ?? "—"}</span>{(typeof h.fairwayHit==="boolean"||typeof h.greenInRegulation==="boolean"||h.penaltyStrokes!==undefined)&&<small className={styles.rowFacts}>{typeof h.fairwayHit==="boolean"&&<span>FIR {h.fairwayHit?"● Sí":"× No"}</span>}{typeof h.greenInRegulation==="boolean"&&<span>GIR {h.greenInRegulation?"● Sí":"× No"}</span>}{h.penaltyStrokes!==undefined&&<span>Penalidades {h.penaltyStrokes}</span>}</small>}</button></li>)}</ol>
    {front.length > 0 && <Totals title="Front 9" holes={front}/>}
    {back.length > 0 && <Totals title="Back 9" holes={back}/>}
    {front.length > 0 && back.length > 0 && <Totals title="Total" holes={holes}/>}
    <div className={styles.legend} aria-label="Leyenda del score">{SCORE_RESULTS.map((result,i) => <span key={result}><ScoreSymbol score={[2,3,4,5,6][i]} par={4}/><small>{scoreResultLabel[result]}</small></span>)}</div>
  </section>;
}
