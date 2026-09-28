"use client";

import Image from "next/image";

import { BackyardIcon } from "./backyard-icon";
import { BackyardMark } from "./backyard-mark";
import { GhinPlaceholder } from "./ghin-placeholder";
import { GhinReadOnlyPanel } from "./ghin-read-only-panel";
import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import { useBackyardIndexPreference, type BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import { verifiedGhinHandicapIndex } from "../../lib/handicap-source";
import styles from "./handicap-source-selector.module.css";

export function HandicapSourceChoices({ control, authenticated, ghinControl, onContinueWithoutIndex }: { control: BackyardIndexPreferenceController; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController; onContinueWithoutIndex?: () => Promise<void> | void }) {
  const verifiedGhinActive = verifiedGhinHandicapIndex(ghinControl?.profile) !== null;
  const activated = !verifiedGhinActive && control.preference?.enabled === true && control.preference.handicapSource !== "GHIN";
  return <section className={styles.root} aria-label="Handicap / Índice">
    <div className={styles.sourceIntro}><span>FUENTE DE JUEGO</span><h3>Elige tu fuente de índice</h3><p>Vincula GHIN, activa Backyard Index o continúa sin índice. Siempre podrás cambiarlo desde Perfil.</p></div>
    <div className={`${styles.choice} ${styles.ghinChoice} ${verifiedGhinActive ? styles.activeChoice : ""}`} data-handicap-source="GHIN">
      <div className={styles.choiceHeading}><span className={styles.ghinMark}><Image src="/brand/ghin-logotype.png" width={1036} height={297} sizes="(max-width: 560px) 104px, 142px" alt="GHIN" /><small>A USGA SERVICE</small></span><div><span className={styles.recommended}>OFICIAL</span><strong>Vincular GHIN</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Consulta tu Handicap Index verificado y la información disponible de tu perfil GHIN.</p>
      <ul className={styles.benefits}><li>Sincroniza tu Handicap Index</li><li>Mantén tu información actualizada</li><li>Consulta tu scoring record</li></ul>
      <div className={styles.choiceBody}>{ghinControl && !ghinControl.ready
      ? <p role="status">Verificando disponibilidad de GHIN…</p>
      : ghinControl?.enabled
        ? <GhinReadOnlyPanel control={ghinControl} sourceActive={verifiedGhinActive || control.preference?.handicapSource === "GHIN"} onUseGhin={control.selectGhin} />
        : <GhinPlaceholder authenticated={authenticated} />}</div>
    </div>
    <div className={`${styles.choice} ${styles.backyardChoice} ${activated ? styles.activeChoice : ""}`} data-handicap-source="BACKYARD">
      <div className={styles.choiceHeading}><span className={styles.backyardMark} aria-hidden="true"><BackyardMark /></span><div><span className={styles.localBadge}>LOCAL</span><strong>Usar Backyard Index</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Construye una referencia propia con tus rondas elegibles en The Backyard.</p>
      <ul className={styles.benefits}><li>Estimación basada en tus rondas</li><li>Ideal para seguir tu progreso</li><li>Local · no oficial</li></ul>
      {verifiedGhinActive ? <p role="status"><b>GHIN ES TU FUENTE ACTIVA</b><br />Tu Handicap Index verificado tiene prioridad. Si desvinculas GHIN, podrás usar Backyard Index.</p>
        : activated && !control.saving && !control.error ? <p role="status"><b>ÍNDICE BACKYARD ACTIVADO</b><br />Empezaremos a calcularlo cuando tengas 3 rondas elegibles.</p>
        : <><p className={styles.note}>Local · no oficial. Al activarlo, declaro PCC 0 cuando no haya PCC publicado, sólo para esta estimación local.</p>
          <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.error ? control.retry() : control.change(true)}>{control.saving ? "GUARDANDO…" : control.error ? "REINTENTAR GUARDADO" : "ACTIVAR BACKYARD INDEX"}</button></>}
      {!authenticated && <p className={styles.note}>Inicia sesión para guardar esta preferencia.</p>}
      {control.error && <p role="alert">{control.error}</p>}
    </div>
    <div className={`${styles.choice} ${styles.noIndexChoice}`} data-handicap-source="NONE">
      <div className={styles.choiceHeading}><span className={styles.noIndexMark} aria-hidden="true"><BackyardIcon name="players" size={32} /></span><div><span className={styles.flexibleBadge}>FLEXIBLE</span><strong>Continuar sin índice</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Empieza a jugar sin inventar un valor. Esta decisión resuelve el paso y podrás cambiarla después.</p>
      <button type="button" className={styles.noIndexButton} disabled={!authenticated || !control.ready || control.saving} onClick={() => void (onContinueWithoutIndex ? onContinueWithoutIndex() : control.change(false))}>CONTINUAR SIN ÍNDICE <span aria-hidden="true">→</span></button>
    </div>
  </section>;
}

/** Used before the app's root Index controller mounts; both use one owner-keyed
 * server preference, so onboarding activation survives reload/new devices. */
export function HandicapSourceSelector({ userId, authenticated, ghinControl }: { userId: string; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController }) {
  const control = useBackyardIndexPreference(userId, authenticated);
  return <HandicapSourceChoices control={control} authenticated={authenticated} ghinControl={ghinControl} />;
}
