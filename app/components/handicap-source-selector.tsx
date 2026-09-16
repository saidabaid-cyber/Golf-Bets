"use client";

import { GhinPlaceholder } from "./ghin-placeholder";
import { useBackyardIndexPreference, type BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import styles from "./handicap-source-selector.module.css";

export function HandicapSourceChoices({ control, authenticated }: { control: BackyardIndexPreferenceController; authenticated: boolean }) {
  const activated = control.preference?.enabled === true && control.preference.handicapSource !== "GHIN";
  return <section className={styles.root} aria-label="Handicap / Índice">
    <h3>HANDICAP / ÍNDICE</h3>
    <div className={styles.choice}><strong>VINCULAR GHIN</strong><p>Usa tu Handicap Index oficial.</p><GhinPlaceholder /></div>
    <div className={styles.choice}><strong>USAR BACKYARD INDEX</strong><p>Si no tienes GHIN, The Backyard puede calcular tu índice con tus rondas elegibles.</p>
      {activated && !control.saving && !control.error ? <p role="status"><b>ÍNDICE BACKYARD ACTIVADO</b><br />Empezaremos a calcularlo cuando tengas 3 rondas elegibles.</p>
        : <><p className={styles.note}>Local · no oficial. Al activarlo, declaro PCC 0 cuando no haya PCC publicado, sólo para esta estimación local.</p>
          <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.error ? control.retry() : control.change(true)}>{control.saving ? "GUARDANDO…" : control.error ? "REINTENTAR GUARDADO" : "ACTIVAR BACKYARD INDEX"}</button></>}
      {!authenticated && <p className={styles.note}>Inicia sesión para guardar esta preferencia.</p>}
      {control.error && <p role="alert">{control.error}</p>}
    </div>
  </section>;
}

/** Used before the app's root Index controller mounts; both use one owner-keyed
 * server preference, so onboarding activation survives reload/new devices. */
export function HandicapSourceSelector({ userId, authenticated }: { userId: string; authenticated: boolean }) {
  const control = useBackyardIndexPreference(userId, authenticated);
  return <HandicapSourceChoices control={control} authenticated={authenticated} />;
}
