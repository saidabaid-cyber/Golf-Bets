"use client";

import { useId, useState } from "react";
import { calculateBackyardIndex } from "../../lib/backyard-index";
import { BACKYARD_INDEX_REASON_LABELS } from "../../lib/backyard-index-labels";
import type { RoundSnapshot } from "../../lib/types";
import { ModalShell } from "./modal-shell";
import styles from "./backyard-index-card.module.css";

export function BackyardIndexCard({
  history,
  userId,
  enabled,
  onEnabledChange,
  saving = false,
  error,
  localPccZeroDeclared,
  onDeclareLocalPccZero,
}: {
  history: readonly RoundSnapshot[];
  userId: string;
  /** Separate, private opt-in. This component never changes the profile's manual HCP. */
  enabled: boolean;
  onEnabledChange?: (enabled: boolean) => void | Promise<void>;
  saving?: boolean;
  error?: string;
  /** An existing opt-in does not imply the user declared a local PCC zero. */
  localPccZeroDeclared?: boolean;
  onDeclareLocalPccZero?: () => void | Promise<void>;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTitleId = useId();
  const summary = enabled ? calculateBackyardIndex(history, userId) : null;
  const ineligible = summary?.records.filter((record) => !record.eligible) ?? [];
  const localPccZero = summary?.records.some((record) => record.pccKind === "DECLARED_LOCAL_ZERO");

  return <section className={styles.card} aria-labelledby="backyard-index-title">
    <div className={styles.heading}>
      <div>
        <span className={styles.eyebrow}>TU JUEGO · ÍNDICE</span>
        <h2 id="backyard-index-title">Índice Backyard</h2>
      </div>
      <div className={styles.headingActions}>
        <span className={styles.badge}>LOCAL · NO OFICIAL</span>
        <button className={styles.helpButton} type="button" aria-label="Cómo funciona el Índice Backyard" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}>?</button>
      </div>
    </div>
    {!enabled ? <>
      <p className={styles.intro}>
        Una referencia privada basada sólo en rondas completas y evidencia verificable.
        No es Handicap Index WHS ni GHIN.
      </p>
      <p className={styles.declaration}>Al activar el Índice, declaro PCC 0 para las rondas sin PCC publicado, sólo para esta estimación local, no oficial.</p>
      {onEnabledChange
        ? <button className={styles.activate} type="button" disabled={saving} onClick={() => onEnabledChange(true)}>
          {saving ? "GUARDANDO…" : "ACTIVAR ÍNDICE BACKYARD"}
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
      {localPccZeroDeclared === false && onDeclareLocalPccZero && <div className={styles.declarePanel}>
        <p>Si no hay PCC publicado, usaré PCC 0 declarado para esta estimación local, no oficial.</p>
        <button type="button" disabled={saving} onClick={onDeclareLocalPccZero}>{saving ? "GUARDANDO…" : "USAR PCC 0 LOCAL"}</button>
      </div>}
      {ineligible.length > 0 && <details className={styles.details}>
        <summary>NO ELEGIBLE · {ineligible.length} ronda{ineligible.length === 1 ? "" : "s"}</summary>
        <ul>
          {ineligible.map((record) => <li key={record.roundId}>
            <b>{record.courseName || "Campo"} · {record.date}</b>
            <span>{record.reasons.map((reason) => BACKYARD_INDEX_REASON_LABELS[reason] || "Evidencia no validada.").join(" ")}</span>
          </li>)}
        </ul>
      </details>}
      {onEnabledChange && <button className={styles.disable} type="button" disabled={saving} onClick={() => onEnabledChange(false)}>
        Desactivar Índice
      </button>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.separation}>
      HCP de juego y ventajas de apuestas se calculan por ronda y tee. Tu HCP manual y una futura vinculación
      GHIN permanecen separados; este Índice no los modifica.
    </p>
    <ModalShell open={helpOpen} onClose={() => setHelpOpen(false)} labelledBy={helpTitleId} className={styles.helpDialog}>
      <span className={styles.eyebrow}>TU JUEGO · ÍNDICE</span>
      <h2 id={helpTitleId}>Cómo funciona el Índice Backyard</h2>
      <p>Backyard Index utiliza tus diferenciales de score. Conforme registras más rondas, utiliza una selección de tus mejores diferenciales. Con 20 rondas utiliza los mejores 8.</p>
      <p>Se necesitan 3 rondas elegibles para empezar. Sólo usa rondas completas con la evidencia necesaria; los números X / 20 y N muestran las rondas recientes y los diferenciales seleccionados.</p>
      <p>Es una estimación local, no un Handicap Index oficial, GHIN ni tu HCP manual. Si no hay PCC publicado, PCC 0 se declara sólo para esta estimación local.</p>
    </ModalShell>
  </section>;
}
