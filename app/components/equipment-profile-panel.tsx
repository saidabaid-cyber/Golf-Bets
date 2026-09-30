"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { restoreEquipmentBallFitSummary, toEquipmentBallFitSummary, type BallFitInput, type BallFitProfileDefaults, type BallFitResult } from "../../lib/ball-fitting";
import { removeBallFitDraft } from "../../lib/ball-fitting-storage";
import { BALL_FIT_HANDICAP_LABELS, type BallFitHandicapSource } from "../../lib/ball-fit-handicap";
import {
  clearLastBallFit,
  removePlayerBall,
  removePlayerClub,
  removePlayerClubDistance,
  replaceCurrentPlayerBall,
  replaceCurrentPlayerClub,
  setBallOnboardingStatus,
  setBallPreference,
  setCatalogBallAsCurrent,
  setCurrentPlayerBall,
  setEquipmentOnboardingStatus,
  setLastBallFit,
  setPlayerClubCurrent,
  upsertPlayerBall,
  upsertPlayerClub,
  upsertPlayerClubDistance,
  type EquipmentBallFitSummary,
  type GolfBallCatalog,
  type GolfClubCatalog,
  type GolfShaftCatalog,
  type PlayerBall,
  type PlayerClub,
  type PlayerClubDistance,
} from "../../lib/golf-equipment";
import { BallFitResults, BallFitWizard, type BallFitCompletionChoice } from "./ball-fit-wizard";
import { CatalogProductMedia } from "./catalog-product-media";
import { BallEditor, CLUB_CATEGORY_ICONS, CLUB_CATEGORY_LABELS, ClubDistanceEditor, ClubEditor } from "./equipment-editors";
import { equipmentStatusLabel, useEquipmentProfile } from "./use-equipment-profile";
import { useEquipmentCatalogSearch } from "./use-equipment-catalog-search";
import type { ProfileHandedness } from "../../lib/equipment-editor-selection";
import styles from "./equipment.module.css";
import { GolfBallVisual } from "./equipment-visuals";
import { EQUIPMENT_CATEGORY_ASSETS } from "./equipment-category-assets";
import { BAG_CATEGORY_SECTIONS } from "../../lib/equipment-bag-management";
import { bagCategoryManagement, sortCurrentWedges, wedgeLoftSummary } from "../../lib/equipment-bag-management";
import { WedgeCollectionEditor } from "./wedge-collection-editor";

type EquipmentProfilePanelProps = {
  userId: string;
  accessToken: string | null;
  defaultHandicap: number | null;
  defaultHandicapSource?: BallFitHandicapSource | null;
  defaultHandedness?: ProfileHandedness | null;
  ballFitDefaults?: BallFitProfileDefaults;
  onBackToProfile?: () => void;
  onOpenPrivacy?: () => void;
  initialSection?: "equipment" | "ball" | "fitting";
};

type EquipmentFlowSuccess = {
  kind: "club" | "ball" | "distance" | "delete";
  name: string;
  verb: "agregado" | "agregada" | "actualizado" | "actualizada" | "eliminado" | "eliminada";
};

type EquipmentDeleteIntent =
  | { kind: "club"; club: PlayerClub; name: string }
  | { kind: "ball"; ball: PlayerBall; name: string }
  | { kind: "distance"; distance: PlayerClubDistance; name: string };

function catalogClub(playerClub: PlayerClub, catalog: readonly GolfClubCatalog[]) {
  return playerClub.catalogClubId ? catalog.find((club) => club.id === playerClub.catalogClubId) || null : null;
}

function clubName(playerClub: PlayerClub, catalog: readonly GolfClubCatalog[]) {
  const club = catalogClub(playerClub, catalog);
  return club
    ? `${club.brand} ${club.model}`
    : [playerClub.customBrand, playerClub.customModel].filter(Boolean).join(" ") || "Bastón guardado";
}

function shaftName(playerClub: PlayerClub, shafts: readonly GolfShaftCatalog[]) {
  const shaft = playerClub.shaftId ? shafts.find((item) => item.id === playerClub.shaftId) || null : null;
  return shaft
    ? `${shaft.brand} ${shaft.model}`
    : [playerClub.customShaftBrand, playerClub.customShaftModel].filter(Boolean).join(" ") || playerClub.customShaft;
}

function clubFacts(playerClub: PlayerClub, shafts: readonly GolfShaftCatalog[]) {
  return [
    CLUB_CATEGORY_LABELS[playerClub.category],
    playerClub.loft === null ? null : `${playerClub.loft}°`,
    playerClub.handedness,
    shaftName(playerClub, shafts),
    playerClub.shaftFlexLabel || playerClub.flex?.replace("_", "-"),
    playerClub.shaftWeightGrams === null ? null : `${playerClub.shaftWeightGrams} g`,
    playerClub.setComposition.length ? playerClub.setComposition.join("–") : null,
  ].filter((value): value is string => Boolean(value));
}

function savedFitId() {
  return globalThis.crypto?.randomUUID?.() || `fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function playerBallId() {
  return globalThis.crypto?.randomUUID?.() || `ball-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function savedClubLabel(club: PlayerClub) {
  return [club.customBrand, club.customModel].filter(Boolean).join(" ") || "Modelo guardado";
}

function savedClubConfiguration(clubs: readonly PlayerClub[], sectionId: string) {
  if (sectionId === "wedges") return wedgeLoftSummary(clubs);
  const compositions = clubs.flatMap((club) => club.setComposition);
  if (compositions.length) return compositions.join("–");
  const lofts = clubs.flatMap((club) => club.loft === null ? [] : [club.loft]);
  return lofts.length ? lofts.map((loft) => `${loft}°`).join(", ") : "";
}

function clubIdentity(playerClub: PlayerClub, catalog: readonly GolfClubCatalog[]) {
  const item = catalogClub(playerClub, catalog);
  return {
    brand: item?.brand || playerClub.customBrand || "Bastón",
    model: item?.model || playerClub.customModel || "Configuración guardada",
  };
}

function SavedBallFitComparison({ summary, catalog, currentBall }: { summary: EquipmentBallFitSummary; catalog: readonly GolfBallCatalog[]; currentBall: PlayerBall | null }) {
  const currentBallFacts = currentBall ? [...new Set([currentBall.generation, currentBall.year, currentBall.color].filter(Boolean).map(String))].join(" · ") : "";
  return <div className={styles.fitIntro} data-ball-fit-comparison="saved-facts">
    {currentBall && <div><span className={styles.flowEyebrow}>TU BOLA ACTUAL</span><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3>{currentBallFacts && <p>{currentBallFacts}</p>}</div>}
    <div className={styles.equipmentList} aria-label="Comparación de bolas guardadas">
      {summary.recommendations.map((recommendation, index) => {
        const catalogBall = catalog.find((ball) => ball.id === recommendation.catalogBallId) || null;
        const name = catalogBall ? `${catalogBall.brand} ${catalogBall.model}` : [recommendation.brand, recommendation.model].filter(Boolean).join(" ") || "Recomendación guardada";
        const generation = catalogBall?.generation || recommendation.generation;
        return <article className={styles.equipmentItem} key={`${recommendation.catalogBallId}:${index}`}>
          <div className={styles.itemHeader}><div><span className={styles.flowEyebrow}>#{index + 1}</span><h3>{name}</h3><p>{[generation, `${recommendation.matchScore}% coincidencia`].filter(Boolean).join(" · ")}</p></div></div>
          {recommendation.comparisonToCurrent.length > 0 && <div><b>Comparación guardada</b><ul>{recommendation.comparisonToCurrent.map((fact, factIndex) => <li key={`${fact}:${factIndex}`}>{fact}</li>)}</ul></div>}
          {recommendation.why.length > 0 && <details><summary className="textButton">Por qué fue recomendada</summary><ul>{recommendation.why.map((fact, factIndex) => <li key={`${fact}:${factIndex}`}>{fact}</li>)}</ul></details>}
        </article>;
      })}
    </div>
  </div>;
}

export function EquipmentProfileSummary({ userId, accessToken, onOpen }: { userId: string; accessToken: string | null; onOpen: () => void }) {
  const { profile, status } = useEquipmentProfile(userId, accessToken);
  if (status === "loading" || !profile) return null;
  const current = profile.clubs.filter((club) => club.isCurrent);
  const ball = profile.balls.find((item) => item.isCurrent) || null;
  const populated = BAG_CATEGORY_SECTIONS.flatMap((section) => {
    const clubs = current.filter((club) => section.categories.some((category) => category === club.category));
    return clubs.length ? [{ ...section, clubs }] : [];
  });
  if (!populated.length && !ball) return <section className={`card ${styles.profileBagSummary}`}><div><span>MI BOLSA</span><h2>Tu equipo, en un solo lugar</h2><p>Agrega Driver, maderas, hierros, wedges, putter y bola.</p></div><button type="button" className="secondary" onClick={onOpen}>Agregar</button></section>;
  return <section className={`card ${styles.profileBagSummary}`} aria-label="Resumen de Mi Bolsa">
    <header><div><span>MI BOLSA</span><h2>Equipo actual</h2></div><button type="button" className="textButton" onClick={onOpen}>Editar</button></header>
    <div className={styles.profileBagRows}>
      {populated.map((section) => {
        const configuration = savedClubConfiguration(section.clubs, section.id);
        const description = section.id === "wedges"
          ? `${section.clubs.length} ${section.clubs.length === 1 ? "wedge" : "wedges"}`
          : section.clubs.map(savedClubLabel).join(" · ");
        return <button type="button" key={section.id} onClick={onOpen}><span><small>{section.label}{configuration ? `: ${configuration}` : ""}</small><b>{description}</b></span><strong aria-hidden="true">›</strong></button>;
      })}
      {ball && <button type="button" onClick={onOpen}><span><small>Bola</small><b>{ball.ballBrand} {ball.ballModel}</b></span><strong aria-hidden="true">›</strong></button>}
    </div>
  </section>;
}

export function EquipmentProfilePanel({ userId, accessToken, defaultHandicap, defaultHandicapSource, defaultHandedness, ballFitDefaults, onBackToProfile, onOpenPrivacy, initialSection }: EquipmentProfilePanelProps) {
  const { profile, status, message, update, retry, resolveConflict, recoverLocalProfile } = useEquipmentProfile(userId, accessToken);
  const [clubEditor, setClubEditor] = useState<PlayerClub | "new" | null>(null);
  const [newClubCategory, setNewClubCategory] = useState<PlayerClub["category"] | null>(null);
  const [wedgeCollectionOpen, setWedgeCollectionOpen] = useState(false);
  const [clubDetailId, setClubDetailId] = useState<string | null>(null);
  const [ballEditor, setBallEditor] = useState<PlayerBall | "new" | null>(initialSection === "ball" ? "new" : null);
  const [distanceEditor, setDistanceEditor] = useState<{ club: PlayerClub; distance: PlayerClubDistance | null } | null>(null);
  const [flowSuccess, setFlowSuccess] = useState<EquipmentFlowSuccess | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<EquipmentDeleteIntent | null>(null);
  const [fitOpen, setFitOpen] = useState(initialSection === "fitting");
  const [fitSessionId, setFitSessionId] = useState<string | null>(() => initialSection === "fitting" ? savedFitId() : null);
  const [savedFitOpen, setSavedFitOpen] = useState(false);
  useViewScrollReset(`${Boolean(clubEditor)}:${wedgeCollectionOpen}:${Boolean(ballEditor)}:${Boolean(distanceEditor)}:${Boolean(flowSuccess)}:${fitOpen}:${savedFitOpen}`);
  const currentClubs = useMemo(() => profile?.clubs.filter((club) => club.isCurrent) || [], [profile]);
  const historicalClubs = useMemo(() => profile?.clubs.filter((club) => !club.isCurrent) || [], [profile]);
  const selectedClub = clubDetailId ? profile?.clubs.find((club) => club.id === clubDetailId) || null : null;
  const currentBall = profile?.balls.find((ball) => ball.isCurrent) || null;
  const ballHistory = profile?.balls.filter((ball) => !ball.isCurrent) || [];
  const restoredFit = useMemo(() => restoreEquipmentBallFitSummary(profile?.lastBallFit || null), [profile?.lastBallFit]);
  const pinnedClubIds = useMemo(() => profile?.clubs.flatMap((club) => club.catalogClubId ? [club.catalogClubId] : []) || [], [profile]);
  const pinnedShaftIds = useMemo(() => profile?.clubs.flatMap((club) => club.shaftId ? [club.shaftId] : []) || [], [profile]);
  const pinnedBallIds = useMemo(() => {
    if (!profile) return [];
    return [...profile.balls.flatMap((ball) => ball.catalogBallId ? [ball.catalogBallId] : []),
      ...profile.lastBallFit?.recommendations.map((item) => item.catalogBallId) || []];
  }, [profile]);
  const clubCatalog = useEquipmentCatalogSearch({ kind: "CLUB", query: "", pinnedIds: pinnedClubIds });
  const shaftCatalog = useEquipmentCatalogSearch({ kind: "SHAFT", query: "", pinnedIds: pinnedShaftIds });
  const ballCatalog = useEquipmentCatalogSearch({ kind: "BALL", query: "", pinnedIds: pinnedBallIds });
  const bagManagement = bagCategoryManagement(currentClubs);
  const currentWedges = useMemo(() => sortCurrentWedges(currentClubs), [currentClubs]);
  const currentBallCatalog = currentBall?.catalogBallId ? ballCatalog.items.find((ball) => ball.id === currentBall.catalogBallId) || null : null;

  if (status === "loading" || !profile) return <section className={`card ${styles.section}`} aria-busy={status === "loading"}>
    <div className={status === "loading" ? styles.loadingState : styles.errorState} role={status === "loading" ? "status" : "alert"}>{status === "loading" ? "Cargando tu bolsa…" : message || "No pudimos abrir el perfil opcional de equipo."}</div>
    {status === "error" && <button type="button" className="secondary" onClick={() => { if (window.confirm("Se conservará una copia técnica local del dato ilegible antes de crear un perfil de equipo vacío. ¿Continuar?")) recoverLocalProfile(); }}>Recrear perfil opcional</button>}
  </section>;

  function saveClub(club: PlayerClub) {
    const previous = clubEditor && clubEditor !== "new" ? clubEditor : null;
    const saved = update((current) => {
      const withClub = previous?.isCurrent && previous.id !== club.id
        ? replaceCurrentPlayerClub(current, previous.id, club, club.createdAt)
        : upsertPlayerClub(current, club);
      return withClub ? setEquipmentOnboardingStatus(withClub, "COMPLETED") : null;
    });
    if (saved) {
      setClubEditor(null);
      setNewClubCategory(null);
      setClubDetailId(club.id);
      setFlowSuccess({ kind: "club", name: clubName(club, clubCatalog.items), verb: previous ? "actualizado" : "agregado" });
    }
    return saved;
  }

  function deleteClub(club: PlayerClub) {
    setDeleteIntent({ kind: "club", club, name: clubName(club, clubCatalog.items) });
  }

  function saveDistance(distance: PlayerClubDistance) {
    const saved = update((current) => upsertPlayerClubDistance(current, distance));
    if (saved) {
      const previous = distanceEditor?.distance;
      setDistanceEditor(null);
      setFlowSuccess({ kind: "distance", name: distanceEditor ? `Distancia de ${clubName(distanceEditor.club, clubCatalog.items)}` : "Distancia", verb: previous ? "actualizada" : "agregada" });
    }
    return saved;
  }

  function deleteDistance(distance: PlayerClubDistance, club: PlayerClub) {
    setDeleteIntent({ kind: "distance", distance, name: `distancia de ${clubName(club, clubCatalog.items)}` });
  }

  function saveBall(ball: PlayerBall) {
    const previous = ballEditor && ballEditor !== "new" ? ballEditor : null;
    const saved = update((current) => {
      const withBall = previous?.isCurrent && previous.id !== ball.id
        ? replaceCurrentPlayerBall(current, previous.id, ball, ball.createdAt)
        : upsertPlayerBall(current, ball);
      return withBall ? setBallOnboardingStatus(withBall, "COMPLETED") : null;
    });
    if (saved) {
      setBallEditor(null);
      setFlowSuccess({ kind: "ball", name: `${ball.ballBrand} ${ball.ballModel}`, verb: previous ? "actualizada" : "agregada" });
    }
    return saved;
  }

  function saveWedge(club: PlayerClub) {
    return update((current) => {
      const withWedge = upsertPlayerClub(current, club);
      return withWedge ? setEquipmentOnboardingStatus(withWedge, "COMPLETED") : null;
    });
  }

  function deleteWedge(club: PlayerClub) {
    return update((current) => removePlayerClub(current, club.id));
  }

  function selectFitCurrentBall(ball: GolfBallCatalog) {
    const now = new Date().toISOString();
    return update((current) => setCatalogBallAsCurrent(current, ball, playerBallId(), now));
  }

  function deleteBall(ball: PlayerBall) {
    setDeleteIntent({ kind: "ball", ball, name: `${ball.ballBrand} ${ball.ballModel}` });
  }

  function confirmDelete() {
    if (!deleteIntent) return;
    const saved = update((current) => {
      if (deleteIntent.kind === "club") return removePlayerClub(current, deleteIntent.club.id);
      if (deleteIntent.kind === "ball") return removePlayerBall(current, deleteIntent.ball.id);
      return removePlayerClubDistance(current, deleteIntent.distance.id);
    });
    if (saved) {
      setFlowSuccess({ kind: "delete", name: deleteIntent.name, verb: deleteIntent.kind === "club" ? "eliminado" : "eliminada" });
      if (deleteIntent.kind === "club") setClubDetailId(null);
      setDeleteIntent(null);
    }
  }

  function completeFit(result: BallFitResult, input: BallFitInput, choice: BallFitCompletionChoice) {
    const now = new Date().toISOString();
    const saved = update((current) => {
      const currentAtFit = current.balls.find((ball) => ball.isCurrent) || null;
      const selection = choice ? {
        selectionAction: choice.action,
        selectedCatalogBallId: choice.action === "RECOMMENDATION" ? choice.ball.id : currentAtFit?.catalogBallId || null,
        currentBallAtFitId: currentAtFit?.id || null,
      } as const : null;
      const summary = toEquipmentBallFitSummary(result, savedFitId(), now, input, selection);
      if (!summary) return null;
      const withChoice = choice?.action === "RECOMMENDATION"
        ? setCatalogBallAsCurrent(current, choice.ball, playerBallId(), now)
        : current;
      return withChoice ? setLastBallFit(withChoice, summary, now) : null;
    });
    if (saved) {
      setFitSessionId(null);
      setFitOpen(false);
    }
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

  if (fitOpen) return <div className={styles.fullPageFlow} data-equipment-screen="ball-fit"><section className={styles.editorPage}><BallFitWizard userId={userId} accessToken={accessToken} defaultHandicap={defaultHandicap} defaultHandicapSource={defaultHandicapSource} profileDefaults={ballFitDefaults} savedInput={restoredFit?.input} currentBall={currentBall} catalog={ballCatalog.items} sessionId={fitSessionId} onCancel={() => setFitOpen(false)} onCurrentBallSelect={selectFitCurrentBall} onComplete={completeFit} onOpenPrivacy={onOpenPrivacy} /></section></div>;
  if (savedFitOpen && profile.lastBallFit) return <div className={styles.fullPageFlow} data-equipment-screen="saved-ball-fit"><section className={styles.editorPage}><button type="button" className={styles.pageBack} onClick={() => setSavedFitOpen(false)}>← Volver a Mi Bolsa</button><div className={styles.wizardHeader}><div><div className="eyebrow">RESULTADO GUARDADO</div><h2>Tu mejor grupo de bolas</h2>{restoredFit && <p>{BALL_FIT_HANDICAP_LABELS[restoredFit.input.handicapSource || "UNKNOWN"]}{restoredFit.input.handicap === null ? "" : `: ${restoredFit.input.handicap}`}</p>}</div></div>{restoredFit ? <BallFitResults result={restoredFit.result} catalog={ballCatalog.items} current={restoredFit.input.currentBallId ? ballCatalog.items.find((ball) => ball.id === restoredFit.input.currentBallId) || null : null} /> : <SavedBallFitComparison summary={profile.lastBallFit} catalog={ballCatalog.items} currentBall={currentBall} />}</section></div>;
  if (wedgeCollectionOpen) return <div className={styles.fullPageFlow} data-equipment-screen="wedge-collection">
    <WedgeCollectionEditor userId={userId} catalog={clubCatalog.items} shafts={shaftCatalog.items} wedges={currentWedges} defaultHandedness={defaultHandedness} onBack={() => setWedgeCollectionOpen(false)} onSave={saveWedge} onDelete={deleteWedge} onManageDistance={(club) => { setWedgeCollectionOpen(false); setClubDetailId(club.id); }} />
  </div>;
  if (clubEditor) return <div className={styles.fullPageFlow} data-equipment-screen="club-editor">
    <ClubEditor userId={userId} catalog={clubCatalog.items} shafts={shaftCatalog.items} existing={clubEditor === "new" ? null : clubEditor} initialCategory={clubEditor === "new" ? newClubCategory || undefined : undefined} defaultHandedness={defaultHandedness} presentation="page" onSelectBall={() => { setClubEditor(null); setNewClubCategory(null); setBallEditor("new"); }} onSelectWedges={() => { setClubEditor(null); setNewClubCategory(null); setWedgeCollectionOpen(true); }} onCancel={() => { setClubEditor(null); setNewClubCategory(null); }} onSave={saveClub} />
  </div>;
  if (ballEditor) return <div className={styles.fullPageFlow} data-equipment-screen="ball-editor">
    <BallEditor userId={userId} catalog={ballCatalog.items} existing={ballEditor === "new" ? null : ballEditor} presentation="page" onCancel={() => setBallEditor(null)} onSave={saveBall} />
  </div>;
  if (distanceEditor) return <div className={styles.fullPageFlow} data-equipment-screen="distance-editor">
    <ClubDistanceEditor userId={userId} clubId={distanceEditor.club.id} clubLabel={clubName(distanceEditor.club, clubCatalog.items)} existing={distanceEditor.distance} presentation="page" onCancel={() => setDistanceEditor(null)} onSave={saveDistance} />
  </div>;
  if (deleteIntent) return <section className={styles.flowDecision} data-equipment-screen="delete-confirm" aria-labelledby="equipment-delete-title">
    <button type="button" className={styles.pageBack} onClick={() => setDeleteIntent(null)}>← Volver</button>
    <span className={styles.flowEyebrow}>MI BOLSA · CONFIRMAR</span>
    <h2 id="equipment-delete-title">¿Eliminar {deleteIntent.name}?</h2>
    <p>Se quitará de tu perfil de equipo. {deleteIntent.kind === "club" && "Sus distancias manuales en Mi Bolsa también se quitarán. "}Las rondas históricas conservan sus propios snapshots y no cambian.</p>
    <div className={styles.flowDecisionActions}><button type="button" className="secondary" onClick={() => setDeleteIntent(null)}>Cancelar</button><button type="button" className={styles.dangerButton} onClick={confirmDelete}>Eliminar de Mi Bolsa</button></div>
    {status === "error" && <p role="alert" className={styles.errorState}>{message || "No se confirmó el borrado."}</p>}
  </section>;
  if (flowSuccess) return <section className={styles.flowDecision} data-equipment-screen="success" aria-labelledby="equipment-success-title">
    <span className={styles.successMark} aria-hidden="true">✓</span>
    <span className={styles.flowEyebrow}>MI BOLSA · GUARDADO</span>
    <h2 id="equipment-success-title">{flowSuccess.name} {flowSuccess.verb}</h2>
    <p>El cambio quedó guardado en este dispositivo. {equipmentStatusLabel(status)}.</p>
    <div className={styles.flowDecisionActions}>
      <button type="button" className="primary" onClick={() => { setFlowSuccess(null); setClubDetailId(null); setNewClubCategory(null); setClubEditor("new"); }}>Agregar otro</button>
      <button type="button" className="secondary" onClick={() => { setFlowSuccess(null); setClubDetailId(null); }}>Volver a Mi Bolsa</button>
      {onBackToProfile && <button type="button" className="secondary" onClick={onBackToProfile}>Volver a Perfil</button>}
    </div>
  </section>;

  if (selectedClub) {
    const distance = profile.distances.find((item) => item.playerClubId === selectedClub.id && item.source === "MANUAL") || null;
    const supportsDistance = selectedClub.category !== "PUTTER";
    return <section className={styles.clubDetail} data-equipment-screen="club-detail" aria-labelledby="club-detail-title">
      <button type="button" className={styles.pageBack} onClick={() => setClubDetailId(null)}>← Volver a Mi Bolsa</button>
      <div className={styles.clubDetailHero}>
        <span className={styles.categoryIcon} aria-hidden="true">{CLUB_CATEGORY_ICONS[selectedClub.category]}</span>
        <div><span className={styles.flowEyebrow}>{CLUB_CATEGORY_LABELS[selectedClub.category]}</span><h2 id="club-detail-title">{clubName(selectedClub, clubCatalog.items)}</h2><p>{catalogClub(selectedClub, clubCatalog.items)?.generation || selectedClub.generation || "Sin generación indicada"}</p></div>
        {selectedClub.isCurrent && <span className={styles.currentBadge}>Actual</span>}
      </div>
      <div className={styles.badgeRow}>{clubFacts(selectedClub, shaftCatalog.items).map((value) => <span className={styles.badge} key={value}>{value}</span>)}</div>
      {selectedClub.notes && <p className={styles.subtle}>{selectedClub.notes}</p>}
      <button type="button" className="secondary" onClick={() => setClubEditor(selectedClub)}>Editar atributos</button>

      <div className={styles.clubDetailSection}>
        <div><span className={styles.flowEyebrow}>DISTANCIA</span><h3>{supportsDistance ? "Tu referencia de juego" : "Putter"}</h3></div>
        {supportsDistance ? <>
          <p>{distance ? [distance.carryDistance === null ? null : `Carry ${distance.carryDistance} ${distance.unit.toLowerCase()}`, distance.totalDistance === null ? null : `Total ${distance.totalDistance} ${distance.unit.toLowerCase()}`].filter(Boolean).join(" · ") : "Todavía no hay una distancia guardada."}</p>
          <p className={styles.subtle}>El cálculo automático sólo estará disponible cuando Shot Tracking esté autorizado y tenga historial suficiente. Mientras tanto puedes guardar una referencia manual y editarla después.</p>
          <div className={styles.inlineActions}><button type="button" className={distance ? "secondary" : "primary"} onClick={() => setDistanceEditor({ club: selectedClub, distance })}>{distance ? "Editar distancia manual" : "Agregar distancia manual"}</button>{distance && <button type="button" className="secondary" onClick={() => deleteDistance(distance, selectedClub)}>Quitar distancia manual</button>}</div>
        </> : <p>El putter no usa carry, distancia total ni mediciones GPS en Mi Bolsa.</p>}
      </div>

      {!selectedClub.isCurrent && <button type="button" className="secondary" onClick={() => update((current) => setPlayerClubCurrent(current, selectedClub.id, true))}>Volver a usar este bastón</button>}
      <div className={styles.clubDangerZone}><p>Esta acción sólo quita el bastón de Mi Bolsa. Las rondas históricas conservan su snapshot.</p><button type="button" className={styles.dangerButton} onClick={() => deleteClub(selectedClub)}>ELIMINAR BASTÓN</button></div>
    </section>;
  }

  return <div className={styles.stack}>
    <section className={styles.profileEquipmentSection} aria-labelledby="current-equipment-title">
      <div className={styles.profileEquipmentHeader}><div className="eyebrow">MI BOLSA</div><h2 id="current-equipment-title">Equipo actual</h2><p>Sólo los bastones que juegas actualmente.</p></div>
      {currentClubs.length ? <div className={styles.currentClubList}>
        {bagManagement.populated.map((section) => section.id === "wedges"
          ? <WedgeGroupItem key={section.id} wedges={section.clubs} onOpen={() => setWedgeCollectionOpen(true)} />
          : section.clubs.map((club) => <ClubItem key={club.id} club={club} catalog={clubCatalog.items} onOpen={() => setClubDetailId(club.id)} />))}
      </div> : <div className={styles.emptyState}><b>Tu bolsa está vacía</b><p>Todavía no tienes bastones configurados.</p></div>}
      {historicalClubs.length > 0 && <details className={styles.previousEquipment}><summary className="textButton">Equipo anterior ({historicalClubs.length})</summary><div className={styles.currentClubList}>{historicalClubs.map((club) => <ClubItem key={club.id} club={club} catalog={clubCatalog.items} onOpen={() => setClubDetailId(club.id)} />)}</div></details>}
    </section>

    {bagManagement.missing.length > 0 && <section className={`${styles.profileEquipmentSection} ${styles.missingEquipmentSection}`} aria-labelledby="missing-equipment-title">
      <div className={styles.profileEquipmentHeader}><div className="eyebrow">CATEGORÍAS FALTANTES</div><h2 id="missing-equipment-title">Agrega el resto de tu bolsa</h2><p>Elige una categoría para completar sus datos.</p></div>
      <div className={styles.missingCategoryList} aria-label="Categorías disponibles para agregar">
        {bagManagement.missing.map((section) => {
          const category = section.categories[0];
          return <button type="button" className={styles.missingCategoryCard} key={section.id} aria-label={`Agregar ${section.label}`} onClick={() => { setClubDetailId(null); if (category === "WEDGE") { setWedgeCollectionOpen(true); return; } setNewClubCategory(category); setClubEditor("new"); }}>
            <span className={styles.missingCategoryMedia} aria-hidden="true"><CanonicalCategoryImage category={category} sizes="(max-width: 430px) 104px, 132px" /></span>
            <span className={styles.missingCategoryCopy}><b>{section.label}</b><small>{section.description}</small></span>
            <strong className={styles.addBagButton} aria-hidden="true">＋</strong>
          </button>;
        })}
      </div>
    </section>}

    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}><div><div className="eyebrow">MI BOLA</div><h2>{currentBall ? `${currentBall.ballBrand} ${currentBall.ballModel}` : "Tu bola de juego"}</h2><p>Opcional. Puedes elegirla o indicar que no juegas una bola fija.</p></div></div>
      {currentBall ? <div className={styles.ballHero}><span className={styles.ballGlyph}><CatalogProductMedia item={currentBallCatalog} fallback={<GolfBallVisual />} /></span><div><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3><p>{[currentBall.generation, currentBall.year, currentBall.color].filter(Boolean).join(" · ") || "Modelo actual"}</p>{currentBall.notes && <p>{currentBall.notes}</p>}</div></div> : <div className={styles.emptyState}><span className={styles.emptyBallVisual}><GolfBallVisual /></span><b>{profile.ballPreference === "NO_FIXED_BALL" ? "No tienes una bola fija" : "No has elegido una bola"}</b><p>Puedes registrarla ahora o continuar sin una bola fija.</p></div>}
      <div className={styles.inlineActions}>
        {!currentBall && <button type="button" className="primary" onClick={() => setBallEditor("new")}>Elegir bola</button>}
        {currentBall && <button type="button" className="secondary" onClick={() => setBallEditor(currentBall)}>Editar</button>}
        {!currentBall && <button type="button" className="secondary" onClick={() => update((current) => {
          const changed = setBallPreference(current, "NO_FIXED_BALL");
          return changed ? setBallOnboardingStatus(changed, "COMPLETED") : null;
        })}>No tengo una bola fija</button>}
        {currentBall && <button type="button" className={styles.dangerButton} onClick={() => deleteBall(currentBall)}>Eliminar</button>}
      </div>
      {ballHistory.length > 0 && <details><summary className="textButton">Bolas anteriores ({ballHistory.length})</summary><div className={styles.equipmentList}>{ballHistory.map((ball) => <div key={ball.id} className={`${styles.equipmentItem} ${styles.archived}`}><div className={styles.itemHeader}><div><h3>{ball.ballBrand} {ball.ballModel}</h3><p>{[ball.generation, ball.year, ball.color].filter(Boolean).join(" · ") || "Sin detalles adicionales"}</p></div></div><div className={styles.itemActions}><button type="button" className="secondary" onClick={() => update((current) => setCurrentPlayerBall(current, ball.id))}>Usar de nuevo</button><button type="button" className={styles.dangerButton} onClick={() => deleteBall(ball)}>Eliminar</button></div></div>)}</div></details>}
    </section>

    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}><div><div className="eyebrow">BALL FIT</div><h2>{profile.lastBallFit ? "Último Ball Fit" : "The Backyard Ball Fit"}</h2><p>Top 3 basado en tus preferencias y los datos disponibles.</p></div><button type="button" className="primary" onClick={() => { setFitSessionId(savedFitId()); setFitOpen(true); }}>{profile.lastBallFit ? "Actualizar fit" : "Hacer Ball Fit"}</button></div>
      {profile.lastBallFit ? <div className={styles.fitIntro}><h3>{new Date(profile.lastBallFit.completedAt).toLocaleDateString("es-MX")}</h3><p>Tu grupo recomendado y tus respuestas quedaron guardados en este perfil.</p><div className={styles.badgeRow}>{profile.lastBallFit.recommendations.map((recommendation, index) => { const ball = ballCatalog.items.find((item) => item.id === recommendation.catalogBallId); return <span className={styles.currentBadge} key={recommendation.catalogBallId}>#{index + 1} {ball ? `${ball.brand} ${ball.model}` : recommendation.brand && recommendation.model ? `${recommendation.brand} ${recommendation.model}` : "Modelo archivado"} · {recommendation.matchScore}%</span>; })}</div><div className={styles.inlineActions}><button type="button" className="secondary" onClick={() => setSavedFitOpen(true)}>Comparar</button><button type="button" className={styles.dangerButton} onClick={deleteBallFit}>Borrar resultado</button></div></div> : <div className={styles.emptyState}><b>Descubre tu mejor grupo de bolas</b><p>Un cuestionario opcional de 2–4 minutos. No es un fitting oficial de ninguna marca.</p><button type="button" className="textButton" onClick={() => { if (window.confirm("¿Borrar cualquier borrador de Ball Fit guardado en este dispositivo?")) removeBallFitDraft(localStorage, userId); }}>Borrar borrador guardado</button></div>}
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

  </div>;
}

function CanonicalCategoryImage({ category, sizes, eager = false }: { category: PlayerClub["category"]; sizes: string; eager?: boolean }) {
  const asset = EQUIPMENT_CATEGORY_ASSETS[category];
  return <Image data-equipment-category-image={category} src={asset.src} alt="" width={asset.width} height={asset.height} sizes={sizes} loading={eager ? "eager" : "lazy"} unoptimized />;
}

function ClubItem({ club, catalog: catalogItems, onOpen }: { club: PlayerClub; catalog: readonly GolfClubCatalog[]; onOpen: () => void }) {
  const identity = clubIdentity(club, catalogItems);
  return <article className={`${styles.profileClubCard} ${club.isCurrent ? "" : styles.archived}`} data-equipment-current-card={club.category}>
    <button type="button" className={styles.profileClubButton} onClick={onOpen} aria-label={`Editar ${clubName(club, catalogItems)}`}>
      <span className={styles.profileClubMedia} aria-hidden="true"><CanonicalCategoryImage category={club.category} sizes="(max-width: 430px) 112px, 132px" eager={club.isCurrent} /></span>
      <span className={styles.profileClubCopy}><small>{CLUB_CATEGORY_LABELS[club.category]}</small><b>{identity.brand}</b><span>{identity.model}</span><em>{CLUB_CATEGORY_LABELS[club.category]} · {club.handedness}</em></span>
      <span className={styles.profileClubAction}><span>Editar</span><strong aria-hidden="true">›</strong></span>
    </button>
  </article>;
}

function WedgeGroupItem({ wedges, onOpen }: { wedges: readonly PlayerClub[]; onOpen: () => void }) {
  const summary = wedgeLoftSummary(wedges);
  const count = wedges.length;
  return <article className={styles.profileClubCard} data-equipment-current-card="WEDGE">
    <button type="button" className={styles.profileClubButton} onClick={onOpen} aria-label={`Editar Wedges. ${count} ${count === 1 ? "wedge" : "wedges"}${summary ? `: ${summary}` : ""}`}>
      <span className={styles.profileClubMedia} aria-hidden="true"><CanonicalCategoryImage category="WEDGE" sizes="(max-width: 430px) 112px, 132px" eager /></span>
      <span className={styles.profileClubCopy}><small>WEDGES</small><b>{summary || "Loft pendiente"}</b><span>{count} {count === 1 ? "wedge" : "wedges"}</span><em>Cada wedge conserva su propia configuración.</em></span>
      <span className={styles.profileClubAction}><span>Editar</span><strong aria-hidden="true">›</strong></span>
    </button>
  </article>;
}

export type EquipmentCatalogRefs = {
  clubs: readonly GolfClubCatalog[];
  shafts: readonly GolfShaftCatalog[];
};
