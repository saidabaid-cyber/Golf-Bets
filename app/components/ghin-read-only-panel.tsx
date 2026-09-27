"use client";

import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import { linkGhinReadOnly } from "../../lib/ghin/profile-link";
import styles from "./ghin-read-only-panel.module.css";

function value(value: string | number | null) {
  return value === null || value === "" ? "No disponible" : String(value);
}

export function GhinReadOnlyPanel({
  control,
  sourceActive,
  onUseGhin,
}: {
  control: GhinReadOnlyProfileController;
  sourceActive: boolean;
  onUseGhin: () => Promise<void>;
}) {
  const profile = control.profile;

  async function link() {
    await linkGhinReadOnly(control, onUseGhin);
  }

  if (!control.ready && !profile) return <p role="status">Consultando vínculo GHIN…</p>;
  return <div className={styles.root}>
    {!profile ? <>
      <p className={styles.note}>La consulta disponible es de sólo lectura y está limitada a la cuenta QA autorizada.</p>
      <button type="button" className="secondary" disabled={control.refreshing} onClick={() => void link()}>
        {control.refreshing ? "VINCULANDO…" : "VINCULAR GHIN"}
      </button>
    </> : <>
      <p className={styles.badge}>{sourceActive && profile.associationStatus !== "DISCONNECTED" ? "✓ GHIN VINCULADO" : "DATOS CONSULTADOS DESDE GHIN"}</p>
      <dl className={styles.details}>
        <div><dt>GHIN</dt><dd>{profile.ghinNumber}</dd></div>
        <div><dt>Nombre</dt><dd>{profile.playerName}</dd></div>
        <div><dt>Home Club</dt><dd>{value(profile.homeClubName ?? profile.clubName)}</dd></div>
        <div><dt>Handicap Index</dt><dd>{value(profile.handicapIndex)}</dd></div>
        <div><dt>Estado</dt><dd>{value(profile.status)}</dd></div>
        <div><dt>Revisión GHIN</dt><dd>{profile.revisionDate ? new Date(profile.revisionDate).toLocaleDateString("es-MX") : "No disponible"}</dd></div>
        <div><dt>Última actualización</dt><dd>{new Date(profile.lastSyncedAt).toLocaleString("es-MX")}</dd></div>
      </dl>
      {profile.syncStatus !== "SUCCESS" && <p role="status" className={styles.warning}>La última actualización falló. Se conserva el último Handicap Index válido.</p>}
      <div className={styles.actions}>
        {!sourceActive && <button type="button" className="primary" disabled={control.refreshing} onClick={() => void onUseGhin()}>USAR GHIN</button>}
        <button type="button" className="secondary" disabled={control.refreshing} onClick={() => void control.refresh()}>{control.refreshing ? "ACTUALIZANDO…" : "ACTUALIZAR GHIN"}</button>
        <button type="button" className="textButton" disabled={control.scoresLoading} onClick={() => void control.loadScores()}>{control.scoresLoading ? "CONSULTANDO SCORES…" : "VER SCORING RECORD"}</button>
      </div>
      {control.scores && <section className={styles.scores} aria-label="Scoring record GHIN read-only">
        <p><b>{control.scores.count}</b> scores recuperados · sólo lectura</p>
        <div className={styles.scoreList}>{control.scores.items.map((score, index) => <article key={score.id ?? `${score.playedOn ?? "score"}-${index}`}>
          <b>{value(score.playedOn)}</b><span>{value(score.courseName)}</span>
          <small>{[
            score.teeName,
            score.grossScore !== null ? `Score ${score.grossScore}` : null,
            score.adjustedGrossScore !== null ? `Ajustado ${score.adjustedGrossScore}` : null,
            score.differential !== null ? `Diff ${score.differential}` : null,
            score.courseRating !== null ? `CR ${score.courseRating}` : null,
            score.slopeRating !== null ? `Slope ${score.slopeRating}` : null,
            score.holes !== null ? `${score.holes} hoyos` : null,
          ].filter((item) => item !== null).join(" · ")}</small>
        </article>)}</div>
      </section>}
    </>}
    {control.error && <p role="alert" className={styles.warning}>{control.error}</p>}
  </div>;
}
