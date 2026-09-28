"use client";

import { GhinPlaceholder } from "./ghin-placeholder";
import { GhinReadOnlyPanel } from "./ghin-read-only-panel";
import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import { useBackyardIndexPreference, type BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import { verifiedGhinHandicapIndex } from "../../lib/handicap-source";
import styles from "./handicap-source-selector.module.css";

export function HandicapSourceChoices({ control, authenticated, ghinControl }: { control: BackyardIndexPreferenceController; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController }) {
  const verifiedGhinActive = verifiedGhinHandicapIndex(ghinControl?.profile) !== null;
  const activated = !verifiedGhinActive && control.preference?.enabled === true && control.preference.handicapSource !== "GHIN";
  return <section className={styles.root} aria-label="Handicap / Índice">
    <h3>HANDICAP / ÍNDICE</h3>
    <div className={styles.choice}><strong>VINCULAR GHIN</strong><p>Conecta tu cuenta GHIN para consultar tu Handicap Index y la información disponible de tu perfil.</p>{ghinControl && !ghinControl.ready
      ? <p role="status">Verificando disponibilidad de GHIN…</p>
      : ghinControl?.enabled
        ? <GhinReadOnlyPanel control={ghinControl} sourceActive={verifiedGhinActive || control.preference?.handicapSource === "GHIN"} onUseGhin={control.selectGhin} />
        : <GhinPlaceholder authenticated={authenticated} />}</div>
    <div className={styles.choice}><strong>USAR BACKYARD INDEX</strong><p>Si no tienes GHIN, The Backyard puede calcular tu índice con tus rondas elegibles.</p>
      {verifiedGhinActive ? <p role="status"><b>GHIN ES TU FUENTE ACTIVA</b><br />Tu Handicap Index verificado tiene prioridad. Si desvinculas GHIN, podrás usar Backyard Index.</p>
        : activated && !control.saving && !control.error ? <p role="status"><b>ÍNDICE BACKYARD ACTIVADO</b><br />Empezaremos a calcularlo cuando tengas 3 rondas elegibles.</p>
        : <><p className={styles.note}>Local · no oficial. Al activarlo, declaro PCC 0 cuando no haya PCC publicado, sólo para esta estimación local.</p>
          <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.error ? control.retry() : control.change(true)}>{control.saving ? "GUARDANDO…" : control.error ? "REINTENTAR GUARDADO" : "ACTIVAR BACKYARD INDEX"}</button></>}
      {!authenticated && <p className={styles.note}>Inicia sesión para guardar esta preferencia.</p>}
      {control.error && <p role="alert">{control.error}</p>}
    </div>
    <div className={styles.choice}><strong>CONTINUAR SIN ÍNDICE</strong><p>Puedes jugar y usar The Backyard sin vincular GHIN ni activar Backyard Index.</p>
      <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.change(false)}>CONTINUAR SIN ÍNDICE</button>
    </div>
  </section>;
}

/** Used before the app's root Index controller mounts; both use one owner-keyed
 * server preference, so onboarding activation survives reload/new devices. */
export function HandicapSourceSelector({ userId, authenticated, ghinControl }: { userId: string; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController }) {
  const control = useBackyardIndexPreference(userId, authenticated);
  return <HandicapSourceChoices control={control} authenticated={authenticated} ghinControl={ghinControl} />;
}
