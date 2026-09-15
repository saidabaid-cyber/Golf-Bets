"use client";

import { calculateBackyardIndex } from "../../lib/backyard-index";
import type { BackyardIndexIneligibilityReason, RoundSnapshot } from "../../lib/types";
import styles from "./backyard-index-card.module.css";

const REASON_LABELS: Record<BackyardIndexIneligibilityReason, string> = {
  MISSING_INDEX_SNAPSHOT: "Ronda anterior sin snapshot de Índice Backyard.",
  INVALID_INDEX_SNAPSHOT: "La evidencia guardada ya no valida esta ronda.",
  ROUND_NOT_COMPLETED: "La ronda no está cerrada.",
  INVALID_PLAYED_DATE: "La fecha jugada no es una fecha de calendario válida.",
  PLAYER_NOT_LINKED: "El jugador no está vinculado a tu cuenta.",
  NOT_COMPLETE_18_HOLES: "Sólo se admiten 18 hoyos completos en esta versión.",
  MISSING_COURSE_SNAPSHOT: "Falta el campo congelado de la ronda.",
  MISSING_HOLE_DEFINITIONS: "Faltan par o stroke index válidos para los 18 hoyos.",
  MISSING_HOLE_SCORES: "Faltan scores del jugador.",
  INVALID_HOLE_SCORES: "Hay scores inválidos.",
  MISSING_TEE_ASSIGNMENT: "Falta el tee congelado del jugador.",
  MISSING_OFFICIAL_TEE_RATING: "Falta Rating/Slope acreditado del tee.",
  INVALID_OFFICIAL_TEE_RATING: "La evidencia oficial del tee es incompleta.",
  TEE_RATING_MISMATCH: "El Rating/Slope no coincide con el tee jugado.",
  MISSING_COURSE_HANDICAP_FOR_ADJUSTMENT: "Falta Course Handicap congelado para ajustar el score.",
  COURSE_HANDICAP_TEE_MISMATCH: "El Course Handicap no corresponde al tee jugado.",
  MISSING_ADJUSTED_GROSS_SCORE: "No puede calcularse adjusted gross score.",
  MISSING_PCC_EVIDENCE: "PCC desconocido; no se asumió cero.",
  INVALID_PCC_EVIDENCE: "La evidencia o declaración PCC es inválida.",
};

export function BackyardIndexCard({
  history,
  userId,
  enabled,
  onEnabledChange,
}: {
  history: readonly RoundSnapshot[];
  userId: string;
  /** Separate, private opt-in. This component never changes the profile's manual HCP. */
  enabled: boolean;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const summary = enabled ? calculateBackyardIndex(history, userId) : null;
  const ineligible = summary?.records.filter((record) => !record.eligible) ?? [];
  const localPccZero = summary?.records.some((record) => record.pccKind === "DECLARED_LOCAL_ZERO");

  return <section className={styles.card} aria-labelledby="backyard-index-title">
    <div className={styles.heading}>
      <div>
        <span className={styles.eyebrow}>TU JUEGO · ÍNDICE</span>
        <h2 id="backyard-index-title">Índice Backyard</h2>
      </div>
      <span className={styles.badge}>LOCAL · NO OFICIAL</span>
    </div>
    {!enabled ? <>
      <p className={styles.intro}>
        Una referencia privada basada sólo en rondas completas y evidencia verificable.
        No es Handicap Index WHS ni GHIN.
      </p>
      {onEnabledChange
        ? <button className={styles.activate} type="button" onClick={() => onEnabledChange(true)}>
          ACTIVAR ÍNDICE BACKYARD
        </button>
        : <p className={styles.note}>Actívalo desde tus preferencias para verlo.</p>}
    </> : <>
      <div className={styles.hero}>
        <div>
          <span className={styles.heroLabel}>ESTIMACIÓN LOCAL</span>
          <strong>{summary?.value === null ? "—" : summary?.value.toFixed(1)}</strong>
          <small>{summary?.value === null
            ? "Se necesitan 3 rondas elegibles para empezar."
            : summary?.provisional ? "Provisional · menos de 20 rondas elegibles" : "Últimas 20 elegibles"}
          </small>
        </div>
        <div className={styles.progress}>
          <b>{summary?.eligibleRoundCount ?? 0}</b>
          <span>rondas elegibles</span>
        </div>
      </div>
      <div className={styles.metrics}>
        <span><b>{summary?.recentRoundCount ?? 0} / 20</b><small>registro reciente</small></span>
        <span><b>{summary?.usedCount ?? 0}</b><small>mejores diferenciales</small></span>
      </div>
      {summary?.value !== null && <p className={styles.method}>
        {summary?.recentRoundCount === 20
          ? "Promedio de los 8 mejores diferenciales de las últimas 20 rondas elegibles."
          : `Selección progresiva de ${summary?.usedCount} diferencial(es) con ajuste ${summary?.adjustment}.`}
      </p>}
      {localPccZero && <p className={styles.caution}>
        Algunas rondas usan PCC 0 declarado sólo para esta estimación local, no un PCC publicado.
      </p>}
      {ineligible.length > 0 && <details className={styles.details}>
        <summary>NO ELEGIBLE · {ineligible.length} ronda{ineligible.length === 1 ? "" : "s"}</summary>
        <ul>
          {ineligible.map((record) => <li key={record.roundId}>
            <b>{record.courseName || "Campo"} · {record.date}</b>
            <span>{record.reasons.map((reason) => REASON_LABELS[reason] || "Evidencia no validada.").join(" ")}</span>
          </li>)}
        </ul>
      </details>}
      {onEnabledChange && <button className={styles.disable} type="button" onClick={() => onEnabledChange(false)}>
        Desactivar vista local
      </button>}
    </>}
    <p className={styles.separation}>
      HCP de juego y ventajas de apuestas se calculan por ronda y tee. Tu HCP manual y una futura vinculación
      GHIN permanecen separados; este Índice no los modifica.
    </p>
  </section>;
}
