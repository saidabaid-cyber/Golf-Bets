"use client";
import { useMemo, type ReactNode } from "react";
import type { GhinImportedScoresController } from "./use-ghin-imported-scores";
import { unifiedGhinHistory, type UnifiedHistoryEntry } from "../../lib/ghin/score-reconciliation";
import { careerDate,careerNumber } from "../../lib/career-statistics";
import styles from "./career-index-panel.module.css";
import importedStyles from "./ghin-import-history.module.css";

export function GhinProviderCard({entry,onOpenRound}:{entry:UnifiedHistoryEntry;onOpenRound?:((id:string)=>void)}) {
  const score=entry.provider;
  return <article className={`${styles.ghinRow} ${importedStyles.providerCard}`} aria-label={`Tarjeta ${entry.origin}`}>
    <div><time>{careerDate(entry.date)}</time><b>{entry.courseName}</b>{entry.teeName&&<small>Tee: {entry.teeName}</small>}</div>
    <strong>{careerNumber(entry.gross??score?.adjustedGrossScore)}{entry.gross===null&&score?.adjustedGrossScore!==null&&<small>Ajustado</small>}</strong><span className={styles.ghinBadge}>{entry.origin}</span>
    {entry.backyardId&&onOpenRound?<button type="button" className={styles.ghinAction} onClick={()=>onOpenRound(entry.backyardId!)}>ABRIR RONDA BACKYARD</button>:<small>SOLO LECTURA</small>}
    <details><summary>Detalle del provider</summary><dl>{([
      ["ID GHIN",score?.id],["Gross",score?.grossScore],["Ajustado",score?.adjustedGrossScore],["Hoyos",score?.holes],
      ["Differential",score?.differential],["Rating",score?.courseRating],["Slope",score?.slopeRating],
    ] as const).filter(([,n])=>n!==null&&n!==undefined).map(([label,n])=><div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}</dl></details>
    {score?.match==="MATCH_REVIEW_REQUIRED"&&<p role="status">Posible coincidencia: requiere revisión. Conservamos ambas tarjetas sin fusionarlas.</p>}
    {score?.outOfSync&&<p role="status">GHIN_OUT_OF_SYNC · La ronda Backyard cambió. No se vuelve a publicar automáticamente.</p>}
  </article>;
}
export function GhinImportHistory({control,backyard,onOpenRound,renderBackyard,year="all",month="all",course="all",holes,title="Historial unificado"}:{
  control?:GhinImportedScoresController;backyard:readonly Omit<UnifiedHistoryEntry,"origin"|"provider"|"backyardId">[];
  onOpenRound?:((id:string)=>void);renderBackyard?:(entry:UnifiedHistoryEntry)=>ReactNode;year?:string;month?:string;course?:string;holes?:9|18;title?:string;
}) {
  const data=control?.data;
  const rows=useMemo(()=>unifiedGhinHistory(backyard,[...new Map([...(data?.links??[]),...(data?.items??[])].map(r=>[r.id,r])).values()]),[backyard,data]);
  const shown=rows.filter(r=>(year==="all"||r.date.startsWith(year))&&(month==="all"||r.date.slice(5,7)===month)&&(course==="all"||r.courseName===course)&&(!holes||r.holes===holes));
  return <section className={styles.ghinRecords} aria-label={title}><header><h3>{title}</h3><span className={styles.ghinBadge}>ORIGEN VERIFICABLE</span></header>
    <p>Backyard conserva scores, jugadores, apuestas y Atest. GHIN conserva su registro oficial de lectura. Las tarjetas vinculadas aparecen una sola vez.</p>
    {data?.summary&&<p>{data.total} tarjetas GHIN guardadas · {data.summary.matched} vinculadas · {data.summary.ambiguous} requieren revisión.</p>}
    {control?.loading&&<p role="status">Consultando tarjetas guardadas…</p>}
    {control?.error&&<p role="status">{control.error}</p>}
    {shown.map(entry=>entry.backyardId&&renderBackyard?<div key={entry.id} className={importedStyles.backyardEntry}><span className={styles.ghinBadge}>{entry.origin}</span>{renderBackyard(entry)}{entry.provider&&<details><summary>Registro GHIN vinculado</summary><p>ID: {entry.provider.id} · Sólo lectura{entry.provider.outOfSync?" · GHIN_OUT_OF_SYNC":""}</p></details>}</div>:entry.provider?<GhinProviderCard key={entry.id} entry={entry} onOpenRound={onOpenRound}/>:<button key={entry.id} type="button" className={styles.row} disabled={!onOpenRound} onClick={()=>onOpenRound?.(entry.id)}><span><small>{careerDate(entry.date)} · {entry.holes??"—"} hoyos · {entry.lifecycle}</small><b>{entry.courseName}</b><small>{entry.teeName}</small></span><strong>{careerNumber(entry.gross)}</strong><span className={styles.ghinBadge}>BACKYARD</span></button>)}
    {!shown.length&&!control?.loading&&<p>No hay tarjetas en estos filtros.</p>}
    {data?.nextCursor&&<button type="button" className={styles.ghinAction} disabled={control?.loading} onClick={()=>void control?.next()}>VER MÁS TARJETAS GHIN</button>}
  </section>;
}
