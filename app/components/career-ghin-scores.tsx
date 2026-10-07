"use client";

import { useEffect, useRef } from "react";
import type { CareerHubProps } from "./career-hub";
import { careerDate, careerNumber } from "../../lib/career-statistics";
import styles from "./career-index-panel.module.css";
import { GhinImportHistory } from "./ghin-import-history";

/** Provider summaries retain their own provenance and never become attest cards. */
export function CareerGhinScores({ control, userId, expanded, onOpen, onReauthorize }: {
  control: CareerHubProps["ghin"]; userId: string; expanded: boolean;
  onOpen: () => void; onReauthorize?: () => void;
}) {
  const attempted = useRef("");
  const linked = control?.enabled && control.ready !== false && control.profile?.associationStatus === "VERIFIED";
  const requestKey = `${userId}:${control?.profile?.lastSyncedAt ?? ""}`;
  const { scores, scoresLoading, reauthorizationRequired, error, loadScores } = control ?? {};
  const persisted=!!control?.imports?.data?.total;
  useEffect(() => {
    if (persisted || !expanded || !linked || !loadScores || scores || scoresLoading
      || reauthorizationRequired || error || attempted.current === requestKey) return;
    attempted.current = requestKey;
    void loadScores();
  }, [persisted, expanded, linked, requestKey, loadScores, scores, scoresLoading, reauthorizationRequired, error]);
  if (!linked && !persisted) return null;
  if(persisted)return expanded?<GhinImportHistory control={control?.imports} backyard={[]} title="Tarjetas GHIN guardadas" compactExplanation/>:<section className={styles.ghinRecords}><h3>Tarjetas GHIN guardadas</h3><p>Registro oficial de sólo lectura. No forma parte del Atest Backyard.</p><button type="button" className={styles.ghinAction} onClick={onOpen}>VER TARJETAS GHIN</button></section>;
  const items = scores?.items.slice(0, 20) ?? [];
  return <section className={styles.ghinRecords} aria-label="Últimas tarjetas GHIN">
    <header><h3>Últimas tarjetas GHIN</h3><span className={styles.ghinBadge}>GHIN · SOLO LECTURA</span></header>
    <p>Estas tarjetas no forman parte del Atest ni de tus estadísticas Backyard.</p>
    {scores && <p><b>{items.length}</b> tarjetas GHIN disponibles · sólo lectura.{scores.truncated && ` Mostrando las últimas ${items.length} de ${scores.count}.`} <small>Consultado: {careerDate(scores.fetchedAt)}</small></p>}
    {control?.reauthorizationRequired ? <><p role="status">Renueva autorización GHIN para consultar tus tarjetas.</p>{onReauthorize && <button type="button" className={styles.ghinAction} onClick={onReauthorize}>RENOVAR AUTORIZACIÓN GHIN</button>}</>
      : control?.scoresLoading ? <p role="status">Consultando tarjetas GHIN…</p>
      : control?.error ? <><p role="status">No se pudieron consultar tus tarjetas GHIN. Tu último índice válido se conserva.</p><button type="button" className={styles.ghinAction} onClick={() => void control.loadScores?.()}>Reintentar consulta GHIN</button></>
      : !expanded ? <button type="button" className={styles.ghinAction} onClick={onOpen}>VER TARJETAS GHIN</button>
      : scores ? items.length === 0 && <p>No hay tarjetas disponibles en el scoring record GHIN.</p>
      : <p role="status">Consultando tarjetas GHIN…</p>}
    {expanded && items.map((score, i) => <article className={styles.ghinRow} key={score.id ?? `${score.playedOn}-${i}`}>
      <div><time>{score.playedOn ? careerDate(score.playedOn) : "Fecha no disponible"}</time><b>{score.courseName ?? "Campo no disponible"}</b>{score.teeName && <small>Tee: {score.teeName}</small>}</div>
      <strong aria-label="Score">{careerNumber(score.grossScore ?? score.adjustedGrossScore)}</strong><span className={styles.ghinBadge}>GHIN</span>
      <dl>{([
        ["Gross", score.grossScore], ["Ajustado", score.adjustedGrossScore], ["Diff", score.differential],
        ["Rating", score.courseRating], ["Slope", score.slopeRating], ["Hoyos", score.holes],
        ["Tipo", score.scoreType], ["Método", score.postingMethod],
      ] as const).filter(([, value]) => value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </article>)}
  </section>;
}
