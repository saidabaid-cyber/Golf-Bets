"use client";

import Image from "next/image";
import { useState } from "react";

import { BackyardIcon } from "./backyard-icon";
import { BackyardMark } from "./backyard-mark";
import { GhinPlaceholder } from "./ghin-placeholder";
import { GhinReadOnlyPanel } from "./ghin-read-only-panel";
import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import { useBackyardIndexPreference, type BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import styles from "./handicap-source-selector.module.css";

export function HandicapSourceChoices({ control, authenticated, ghinControl, onContinueWithoutIndex }: { control: BackyardIndexPreferenceController; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController; onContinueWithoutIndex?: () => Promise<void> | void }) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const ghinLinked = ghinControl?.profile?.associationStatus === "VERIFIED";
  const ghinActive = ghinLinked && (control.preference === null || control.preference.handicapSource === "GHIN");
  const backyardActive = control.preference?.enabled === true && control.preference.handicapSource !== "GHIN";
  const noIndexActive = control.preference !== null && control.preference.enabled === false && control.preference.handicapSource !== "GHIN";
  const showSourceOptions = !ghinActive || showAlternatives;
  return <section className={styles.root} aria-label="Handicap / Índice">
    <div className={styles.sourceIntro}><span>FUENTE DE JUEGO</span><h3>{ghinActive ? "Tu fuente de índice" : "Elige tu fuente de índice"}</h3><p>{ghinActive ? "GHIN está vinculado y activo." : "Vincula GHIN, activa Backyard Index o continúa sin índice. Siempre podrás cambiarlo desde Perfil."}</p></div>
    <div className={`${styles.choice} ${styles.ghinChoice} ${ghinActive ? styles.activeChoice : ""}`} data-handicap-source="GHIN">
      <div className={styles.choiceHeading}><span className={styles.ghinMark}><Image src="/brand/ghin-logotype.png" width={1036} height={297} sizes="(max-width: 560px) 104px, 142px" alt="GHIN" /><small>A USGA SERVICE</small></span><div><span className={styles.recommended}>{ghinActive ? "FUENTE ACTIVA" : "OFICIAL"}</span><strong>{ghinActive ? "GHIN" : ghinLinked ? "Usar GHIN" : "Vincular GHIN"}</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      {!ghinActive && <><p>Consulta tu Handicap Index verificado y la información disponible de tu perfil GHIN.</p>
      <ul className={styles.benefits}><li>Sincroniza tu Handicap Index</li><li>Mantén tu información actualizada</li><li>Consulta tu scoring record</li></ul></>}
      <div className={styles.choiceBody}>{ghinControl && !ghinControl.ready
      ? <p role="status">Verificando disponibilidad de GHIN…</p>
      : ghinControl?.enabled
        ? <GhinReadOnlyPanel control={ghinControl} sourceActive={ghinActive} onUseGhin={control.selectGhin} />
        : <GhinPlaceholder authenticated={authenticated} />}</div>
    </div>
    {ghinActive && <button type="button" className={styles.changeSourceButton} aria-expanded={showAlternatives} aria-controls="handicap-source-alternatives" onClick={() => setShowAlternatives((current) => !current)}>{showAlternatives ? "Ocultar alternativas" : "Cambiar fuente de índice"}</button>}
    {showSourceOptions && <div id="handicap-source-alternatives" className={styles.alternatives}>
    {!ghinActive && <div className={`${styles.choice} ${styles.backyardChoice} ${backyardActive ? styles.activeChoice : ""}`} data-handicap-source="BACKYARD">
      <div className={styles.choiceHeading}><span className={styles.backyardMark} aria-hidden="true"><BackyardMark /></span><div><span className={styles.localBadge}>LOCAL</span><strong>Usar Backyard Index</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Construye una referencia propia con tus rondas elegibles en The Backyard.</p>
      <ul className={styles.benefits}><li>Estimación basada en tus rondas</li><li>Ideal para seguir tu progreso</li><li>Local · no oficial</li></ul>
      {backyardActive && !control.saving && !control.error ? <p role="status"><b>ÍNDICE BACKYARD ACTIVADO</b><br />Es tu fuente activa. Empezaremos a calcularlo cuando tengas 3 rondas elegibles.</p>
        : <><p className={styles.note}>Local · no oficial. Al activarlo, declaro PCC 0 cuando no haya PCC publicado, sólo para esta estimación local.</p>
          <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.error ? control.retry() : control.change(true)}>{control.saving ? "GUARDANDO…" : control.error ? "REINTENTAR GUARDADO" : "ACTIVAR BACKYARD INDEX"}</button></>}
      {!authenticated && <p className={styles.note}>Inicia sesión para guardar esta preferencia.</p>}
      {control.error && <p role="alert">{control.error}</p>}
    </div>}
    {ghinActive && <div className={`${styles.choice} ${styles.backyardChoice}`} data-handicap-source="BACKYARD">
      <div className={styles.choiceHeading}><span className={styles.backyardMark} aria-hidden="true"><BackyardMark /></span><div><span className={styles.localBadge}>LOCAL</span><strong>Usar Backyard Index</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Construye una referencia propia con tus rondas elegibles en The Backyard.</p>
      <ul className={styles.benefits}><li>Estimación basada en tus rondas</li><li>Ideal para seguir tu progreso</li><li>Local · no oficial</li></ul>
      <p className={styles.note}>Cambiar la fuente no borra tu vínculo GHIN ni el historial de tus rondas.</p>
      <button type="button" className="secondary" disabled={!authenticated || !control.ready || control.saving} onClick={() => control.error ? control.retry() : control.change(true)}>{control.saving ? "GUARDANDO…" : control.error ? "REINTENTAR GUARDADO" : "USAR BACKYARD INDEX"}</button>
      {control.error && <p role="alert">{control.error}</p>}
    </div>}
    <div className={`${styles.choice} ${styles.noIndexChoice} ${noIndexActive ? styles.activeChoice : ""}`} data-handicap-source="NONE">
      <div className={styles.choiceHeading}><span className={styles.noIndexMark} aria-hidden="true"><BackyardIcon name="players" size={32} /></span><div><span className={styles.flexibleBadge}>{noIndexActive ? "FUENTE ACTIVA" : "FLEXIBLE"}</span><strong>{noIndexActive ? "Sin índice por ahora" : "Continuar sin índice"}</strong></div><span className={styles.sourceChevron} aria-hidden="true">›</span></div>
      <p>Empieza a jugar sin inventar un valor. Esta decisión resuelve el paso y podrás cambiarla después.</p>
      {!noIndexActive && <button type="button" className={styles.noIndexButton} disabled={!authenticated || !control.ready || control.saving} onClick={() => void (onContinueWithoutIndex ? onContinueWithoutIndex() : control.change(false))}>CONTINUAR SIN ÍNDICE <span aria-hidden="true">→</span></button>}
    </div>
    </div>}
  </section>;
}

/** Used before the app's root Index controller mounts; both use one owner-keyed
 * server preference, so onboarding activation survives reload/new devices. */
export function HandicapSourceSelector({ userId, authenticated, ghinControl }: { userId: string; authenticated: boolean; ghinControl?: GhinReadOnlyProfileController }) {
  const control = useBackyardIndexPreference(userId, authenticated);
  return <HandicapSourceChoices control={control} authenticated={authenticated} ghinControl={ghinControl} />;
}
