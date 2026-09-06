"use client";

import { useMemo, useState } from "react";
import { restoreEquipmentBallFitSummary, toEquipmentBallFitSummary, type BallFitInput, type BallFitResult } from "../../lib/ball-fitting";
import { removeBallFitDraft } from "../../lib/ball-fitting-storage";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../../lib/golf-equipment-catalog";
import {
  clearLastBallFit,
  removePlayerBall,
  removePlayerClub,
  setBallOnboardingStatus,
  setBallPreference,
  setCurrentPlayerBall,
  setEquipmentOnboardingStatus,
  setLastBallFit,
  setPlayerClubCurrent,
  upsertPlayerBall,
  upsertPlayerClub,
  type GolfClubCatalog,
  type GolfShaftCatalog,
  type PlayerBall,
  type PlayerClub,
} from "../../lib/golf-equipment";
import { BallFitResults, BallFitWizard } from "./ball-fit-wizard";
import { BallEditor, CLUB_CATEGORY_ICONS, CLUB_CATEGORY_LABELS, ClubEditor } from "./equipment-editors";
import { equipmentStatusLabel, useEquipmentProfile } from "./use-equipment-profile";
import { useModalDialog } from "./use-modal-dialog";
import styles from "./equipment.module.css";

type EquipmentProfilePanelProps = {
  userId: string;
  accessToken: string | null;
  defaultHandicap: number | null;
};

function catalogClub(playerClub: PlayerClub) {
  return playerClub.catalogClubId ? golfClubCatalog.find((club) => club.id === playerClub.catalogClubId) || null : null;
}

function clubName(playerClub: PlayerClub) {
  const club = catalogClub(playerClub);
  return club ? `${club.brand} ${club.model}` : `${playerClub.customBrand || "Marca manual"} ${playerClub.customModel || "Modelo manual"}`;
}

function shaftName(playerClub: PlayerClub) {
  const shaft = playerClub.shaftId ? golfShaftCatalog.find((item) => item.id === playerClub.shaftId) || null : null;
  return shaft ? `${shaft.brand} ${shaft.model}` : playerClub.customShaft;
}

function clubFacts(playerClub: PlayerClub) {
  return [
    CLUB_CATEGORY_LABELS[playerClub.category],
    playerClub.loft === null ? null : `${playerClub.loft}°`,
    playerClub.handedness,
    shaftName(playerClub),
    playerClub.flex?.replace("_", "-"),
    playerClub.setComposition.length ? playerClub.setComposition.join("–") : null,
  ].filter((value): value is string => Boolean(value));
}

function savedFitId() {
  return globalThis.crypto?.randomUUID?.() || `fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EquipmentProfilePanel({ userId, accessToken, defaultHandicap }: EquipmentProfilePanelProps) {
  const { profile, status, message, update, retry, resolveConflict, recoverLocalProfile } = useEquipmentProfile(userId, accessToken);
  const [clubEditor, setClubEditor] = useState<PlayerClub | "new" | null>(null);
  const [ballEditor, setBallEditor] = useState<PlayerBall | "new" | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  const [savedFitOpen, setSavedFitOpen] = useState(false);
  const fitDialogRef = useModalDialog(fitOpen, () => setFitOpen(false));
  const savedFitDialogRef = useModalDialog(savedFitOpen, () => setSavedFitOpen(false));
  const currentClubs = useMemo(() => profile?.clubs.filter((club) => club.isCurrent) || [], [profile]);
  const historicalClubs = useMemo(() => profile?.clubs.filter((club) => !club.isCurrent) || [], [profile]);
  const currentBall = profile?.balls.find((ball) => ball.isCurrent) || null;
  const ballHistory = profile?.balls.filter((ball) => !ball.isCurrent) || [];
  const restoredFit = useMemo(() => restoreEquipmentBallFitSummary(profile?.lastBallFit || null), [profile?.lastBallFit]);

  if (status === "loading" || !profile) return <section className={`card ${styles.section}`} aria-busy={status === "loading"}>
    <div className={status === "loading" ? styles.loadingState : styles.errorState} role={status === "loading" ? "status" : "alert"}>{status === "loading" ? "Cargando tu bolsa…" : message || "No pudimos abrir el perfil opcional de equipo."}</div>
    {status === "error" && <button type="button" className="secondary" onClick={() => { if (window.confirm("Se conservará una copia técnica local del dato ilegible antes de crear un perfil de equipo vacío. ¿Continuar?")) recoverLocalProfile(); }}>Recrear perfil opcional</button>}
  </section>;

  function saveClub(club: PlayerClub) {
    const saved = update((current) => {
      const withClub = upsertPlayerClub(current, club);
      return withClub ? setEquipmentOnboardingStatus(withClub, "COMPLETED") : null;
    });
    if (saved) setClubEditor(null);
  }

  function deleteClub(club: PlayerClub) {
    if (!window.confirm(`¿Eliminar ${clubName(club)} de tu perfil?`)) return;
    update((current) => removePlayerClub(current, club.id));
  }

  function saveBall(ball: PlayerBall) {
    const saved = update((current) => {
      const withBall = upsertPlayerBall(current, ball);
      return withBall ? setBallOnboardingStatus(withBall, "COMPLETED") : null;
    });
    if (saved) setBallEditor(null);
  }

  function deleteBall(ball: PlayerBall) {
    if (!window.confirm(`¿Eliminar ${ball.ballBrand} ${ball.ballModel} de tu perfil?`)) return;
    update((current) => removePlayerBall(current, ball.id));
  }

  function completeFit(result: BallFitResult, input: BallFitInput) {
    const now = new Date().toISOString();
    const summary = toEquipmentBallFitSummary(result, savedFitId(), now, input);
    if (!summary) return false;
    const saved = update((current) => setLastBallFit(current, summary, now));
    if (saved) setFitOpen(false);
    return saved;
  }

  function deleteBallFit() {
    if (!window.confirm("¿Borrar el último Ball Fit y cualquier borrador guardado? Esta acción no cambia tu bola ni tu bolsa.")) return;
    const saved = update((current) => clearLastBallFit(current));
    if (saved) {
      removeBallFitDraft(localStorage, userId);
      setSavedFitOpen(false);
    }
  }

  return <div className={styles.stack}>
    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}><div><div className="eyebrow">EQUIPO</div><h2>Mi bolsa</h2><p>Tus bastones actuales y anteriores. Basta con marca + modelo.</p></div><button type="button" className="primary" onClick={() => setClubEditor("new")}>+ Agregar</button></div>
      <div className={styles.bagSummary}>
        <span><b>{currentClubs.length}</b><small>actuales</small></span>
        <span><b>{currentClubs.filter((club) => club.category === "WEDGE").length}</b><small>wedges</small></span>
        <span><b>{currentClubs.filter((club) => club.category === "FAIRWAY_WOOD" || club.category === "HYBRID").length}</b><small>maderas / híbridos</small></span>
        <span><b>{historicalClubs.length}</b><small>anteriores</small></span>
      </div>
      {!currentClubs.length ? <div className={styles.emptyState}><b>Tu bolsa todavía está vacía</b><p>Agrega uno o varios bastones. Shaft, loft y medidas siempre son opcionales.</p><button type="button" className="secondary" onClick={() => setClubEditor("new")}>Agregar mi primer bastón</button></div> : <div className={styles.equipmentList}>{currentClubs.map((club) => <ClubItem key={club.id} club={club} onEdit={() => setClubEditor(club)} onToggle={() => update((current) => setPlayerClubCurrent(current, club.id, false))} onDelete={() => deleteClub(club)} />)}</div>}
      {historicalClubs.length > 0 && <details><summary className="textButton">Equipo anterior ({historicalClubs.length})</summary><div className={styles.equipmentList}>{historicalClubs.map((club) => <ClubItem key={club.id} club={club} onEdit={() => setClubEditor(club)} onToggle={() => update((current) => setPlayerClubCurrent(current, club.id, true))} onDelete={() => deleteClub(club)} />)}</div></details>}
    </section>

    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}><div><div className="eyebrow">TU BOLA</div><h2>Mi bola</h2><p>Opcional. Puedes cambiarla o indicar que no juegas una bola fija.</p></div>{currentBall && <button type="button" className="secondary" onClick={() => setBallEditor("new")}>Cambiar bola</button>}</div>
      {currentBall ? <div className={styles.ballHero}><span className={styles.ballGlyph}>●</span><div><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3><p>{[currentBall.generation, currentBall.year, currentBall.color].filter(Boolean).join(" · ") || "Modelo actual"}</p></div></div> : <div className={styles.emptyState}><b>{profile.ballPreference === "NO_FIXED_BALL" ? "No tienes una bola fija" : "No has elegido una bola"}</b><p>Puedes registrarla ahora o seguir usando The Backyard sin hacerlo.</p></div>}
      <div className={styles.inlineActions}>
        {!currentBall && <button type="button" className="primary" onClick={() => setBallEditor("new")}>Elegir bola</button>}
        {currentBall && <button type="button" className="secondary" onClick={() => setBallEditor(currentBall)}>Editar detalles</button>}
        <button type="button" className="secondary" onClick={() => update((current) => {
          const changed = setBallPreference(current, "NO_FIXED_BALL");
          return changed ? setBallOnboardingStatus(changed, "COMPLETED") : null;
        })}>No tengo una bola fija</button>
        {currentBall && <button type="button" className={styles.dangerButton} onClick={() => deleteBall(currentBall)}>Eliminar</button>}
      </div>
      {ballHistory.length > 0 && <details><summary className="textButton">Bolas anteriores ({ballHistory.length})</summary><div className={styles.equipmentList}>{ballHistory.map((ball) => <div key={ball.id} className={`${styles.equipmentItem} ${styles.archived}`}><div className={styles.itemHeader}><div><h3>{ball.ballBrand} {ball.ballModel}</h3><p>{[ball.generation, ball.year, ball.color].filter(Boolean).join(" · ") || "Sin detalles adicionales"}</p></div></div><div className={styles.itemActions}><button type="button" className="secondary" onClick={() => update((current) => setCurrentPlayerBall(current, ball.id))}>Usar de nuevo</button><button type="button" className={styles.dangerButton} onClick={() => deleteBall(ball)}>Eliminar</button></div></div>)}</div></details>}
    </section>

    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}><div><div className="eyebrow">RECOMENDADOR ORIENTATIVO</div><h2>The Backyard Ball Fit</h2><p>Top 3 basado sólo en tus preferencias y atributos públicos verificados.</p></div><button type="button" className="primary" onClick={() => setFitOpen(true)}>{profile.lastBallFit ? "Actualizar fit" : "Hacer Ball Fit"}</button></div>
      {profile.lastBallFit ? <div className={styles.fitIntro}><h3>Último Ball Fit · {new Date(profile.lastBallFit.completedAt).toLocaleDateString("es-MX")}</h3><p>Señales comparables: {profile.lastBallFit.inputCompleteness}%. Tu grupo recomendado, respuestas y datos opcionales quedaron guardados en este perfil.</p><div className={styles.badgeRow}>{profile.lastBallFit.recommendations.map((recommendation, index) => { const ball = golfBallCatalog.find((item) => item.id === recommendation.catalogBallId); return <span className={styles.currentBadge} key={recommendation.catalogBallId}>#{index + 1} {ball ? `${ball.brand} ${ball.model}` : recommendation.brand && recommendation.model ? `${recommendation.brand} ${recommendation.model}` : "Modelo archivado"} · {recommendation.matchScore}%</span>; })}</div><div className={styles.inlineActions}>{restoredFit && <button type="button" className="secondary" onClick={() => setSavedFitOpen(true)}>Comparar estas bolas</button>}<button type="button" className={styles.dangerButton} onClick={deleteBallFit}>Borrar resultado</button></div></div> : <div className={styles.emptyState}><b>Descubre tu mejor grupo de bolas</b><p>Un cuestionario opcional de 2–4 minutos. No es un fitting oficial de ninguna marca.</p><button type="button" className="textButton" onClick={() => { if (window.confirm("¿Borrar cualquier borrador de Ball Fit guardado en este dispositivo?")) removeBallFitDraft(localStorage, userId); }}>Borrar borrador guardado</button></div>}
      <p className={styles.disclaimer}>La información de equipo y bola es opcional y no se usa para publicidad. Puedes editarla o borrarla cuando quieras.</p>
    </section>

    <div className={styles.syncStatus} data-state={status} role="status">
      <span>{equipmentStatusLabel(status)}{message ? ` · ${message}` : ""}</span>
      {(status === "pending" || status === "offline") && <button type="button" className="textButton" onClick={retry}>Reintentar</button>}
      {status === "conflict" && <div className={styles.inlineActions}>
        <button type="button" className="secondary" onClick={() => resolveConflict("remote")}>Usar versión de nube</button>
        <button type="button" className="secondary" onClick={() => resolveConflict("local")}>Conservar este dispositivo</button>
      </div>}
    </div>

    {clubEditor && <ClubEditor userId={userId} catalog={golfClubCatalog} shafts={golfShaftCatalog} existing={clubEditor === "new" ? null : clubEditor} onCancel={() => setClubEditor(null)} onSave={saveClub} />}
    {ballEditor && <BallEditor userId={userId} catalog={golfBallCatalog} existing={ballEditor === "new" ? null : ballEditor} onCancel={() => setBallEditor(null)} onSave={saveBall} />}
    {fitOpen && <div className={styles.editorBackdrop} role="presentation"><section ref={fitDialogRef} tabIndex={-1} className={styles.editorSheet} role="dialog" aria-modal="true" aria-label="The Backyard Ball Fit"><div className={styles.sheetHandle} /><BallFitWizard userId={userId} defaultHandicap={defaultHandicap} currentBall={currentBall} catalog={golfBallCatalog} onCancel={() => setFitOpen(false)} onComplete={completeFit} /></section></div>}
    {savedFitOpen && restoredFit && <div className={styles.editorBackdrop} role="presentation"><section ref={savedFitDialogRef} tabIndex={-1} className={styles.editorSheet} role="dialog" aria-modal="true" aria-label="Resultado guardado de The Backyard Ball Fit"><div className={styles.sheetHandle} /><div className={styles.wizardHeader}><div><div className="eyebrow">RESULTADO GUARDADO</div><h2>Tu mejor grupo de bolas</h2></div><button type="button" className="textButton" onClick={() => setSavedFitOpen(false)}>Cerrar</button></div><BallFitResults result={restoredFit.result} catalog={golfBallCatalog} current={restoredFit.input.currentBallId ? golfBallCatalog.find((ball) => ball.id === restoredFit.input.currentBallId) || null : null} /></section></div>}
  </div>;
}

function ClubItem({ club, onEdit, onToggle, onDelete }: { club: PlayerClub; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const catalog = catalogClub(club);
  const facts = clubFacts(club);
  return <article className={`${styles.equipmentItem} ${club.isCurrent ? "" : styles.archived}`}>
    <div className={styles.itemHeader}><div className={styles.itemIdentity}><span className={styles.categoryIcon}>{CLUB_CATEGORY_ICONS[club.category]}</span><div><h3>{clubName(club)}</h3><p>{catalog?.generation || club.generation || CLUB_CATEGORY_LABELS[club.category]}</p></div></div>{club.isCurrent && <span className={styles.currentBadge}>Actual</span>}</div>
    <div className={styles.badgeRow}>{facts.map((value) => <span className={styles.badge} key={value}>{value}</span>)}</div>
    {club.notes && <p className={styles.subtle}>{club.notes}</p>}
    <div className={styles.itemActions}><button type="button" className="secondary" onClick={onEdit}>Editar</button><button type="button" className="secondary" onClick={onToggle}>{club.isCurrent ? "Mover a anterior" : "Marcar actual"}</button><button type="button" className={styles.dangerButton} onClick={onDelete}>Eliminar</button></div>
  </article>;
}

export type EquipmentCatalogRefs = {
  clubs: readonly GolfClubCatalog[];
  shafts: readonly GolfShaftCatalog[];
};
