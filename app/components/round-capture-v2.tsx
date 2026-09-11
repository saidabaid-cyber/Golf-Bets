"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  AdvancedHoleStat,
  BetConfig,
  Course,
  CounterBetKind,
  Hole,
  Player,
  PlayerTeeAssignmentSnapshot,
  RoundShotSnapshot,
  ScoreCaptureMode,
  SupplementalBet,
} from "../../lib/types";
import { haversineDistanceKm, isValidGeographicPoint } from "../../lib/course-distance";
import type { CapturedBagClubChoice } from "../../lib/bag-capture";
import { calculateGreenDistances, gpsFallbackMessage } from "../../features/gps/domain";
import { cancelShot, closeShot, startShot, type ShotLocation } from "../../features/shots/domain";
import type { PlanId } from "../../lib/plans";
import { captureAnimalVisibility, roundCaptureFieldsForPlayer, scoreToParLabel } from "../../lib/round-capture";
import { ScorecardHoleNetPreview } from "./scorecard-hole-preview";
import { CompactStepper, CounterStepper, SignedStepper } from "./bet-fields/capture-controls";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { RoundCaddieCard } from "./round-caddie-card";
import styles from "./round-capture-v2.module.css";

type CounterQuantities = Record<CounterBetKind, Record<string, number | undefined>>;

export type RoundCaptureV2Props = {
  course: Pick<Course, "name" | "teeName" | "latitude" | "longitude">;
  hole: Hole;
  order: number[];
  currentIndex: number;
  completedHoles: ReadonlySet<number>;
  players: Player[];
  playerTeeAssignments?: PlayerTeeAssignmentSnapshot[];
  ownerId: string;
  ownerAvatarUrl?: string;
  ownerClubChoices?: CapturedBagClubChoice[];
  caddiePlanId: PlanId;
  mode: ScoreCaptureMode;
  bets: Pick<BetConfig, "vipers" | "camels" | "fish" | "loba" | "ballFriend" | "units">;
  supplementalBets: SupplementalBet[];
  scores: Record<string, number | null | undefined>;
  putts: Record<string, number | null | undefined>;
  advancedStats: Record<string, AdvancedHoleStat | undefined>;
  roundId: string;
  shots: RoundShotSnapshot[];
  counterQuantities: CounterQuantities;
  unitQuantities: Record<string, number>;
  groupNassauLabel?: string;
  ballFriendLabel?: string;
  lobaLabel?: string;
  playerIndicators: (playerId: string) => string[];
  onNavigateHole: (index: number) => void;
  onModeChange: (mode: ScoreCaptureMode) => void;
  onScoreChange: (playerId: string, value: number | null) => void;
  onPuttsChange: (playerId: string, value: number | null) => void;
  onCounterChange: (kind: CounterBetKind, playerId: string, value: number | null) => void;
  onUnitDelta: (playerId: string, delta: number) => void;
  onAdvancedChange: (playerId: string, patch: Partial<AdvancedHoleStat>) => void;
  onShotsChange: (shots: RoundShotSnapshot[]) => void;
  onOpenLoba: () => void;
  onOpenBallFriend: () => void;
  onOpenScanner: () => void;
  onToggleFullCard: () => void;
  fullCardVisible: boolean;
  fullCardContent?: ReactNode;
  onOpenStandings: () => void;
  onUndo: () => void;
  undoDisabled: boolean;
  onSaveAndAdvance: () => void;
  saveDisabled: boolean;
  saveLabel: string;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BY";
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={styles.toggleChip} data-active={active} aria-pressed={active} onClick={onClick}>{label}</button>;
}

const TEE_DIRECTION_OPTIONS = [
  { value: "far_left", label: "Muy izq.", glyph: "↶" },
  { value: "left", label: "Izquierda", glyph: "↖" },
  { value: "right", label: "Derecha", glyph: "↗" },
  { value: "far_right", label: "Muy der.", glyph: "↷" },
] as const;

function SituationCounter({ label, icon, value, onChange }: {
  label: string;
  icon: string;
  value: number | null | undefined;
  onChange: (value: number) => void;
}) {
  return <article className={styles.situationCard} data-situation={label}>
    <span className={styles.situationIcon} aria-hidden="true">{icon}</span>
    <b>{label}</b>
    <CounterStepper label={label} value={value} onChange={onChange} />
  </article>;
}

const FALLBACK_TEE_CLUBS: readonly CapturedBagClubChoice[] = ["Driver", "Madera", "Híbrido", "Hierro", "Otro", "No sé"].map((label) => ({
  id: `fallback-${label.toLocaleLowerCase("es-MX")}`,
  label,
  category: null,
  model: null,
  shaft: null,
}));

function shotId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const values = crypto.getRandomValues(new Uint8Array(16));
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  const hex = Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentLocation(): Promise<ShotLocation> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("GPS_UNAVAILABLE")); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 5_000 },
    );
  });
}

function PlayerAroundStatistics({ player, stat, onChange }: { player: Player; stat: AdvancedHoleStat; onChange: (patch: Partial<AdvancedHoleStat>) => void }) {
  return <section className={styles.aroundStatistics} aria-label={`Estadísticas opcionales de ${player.name}`}>
    <div className={styles.sectionLabel}><span>ALREDEDOR</span><small>Opcional</small></div>
    <div className={styles.compactField}><span>Distancia del primer putt · ft</span><CompactStepper label={`Distancia del primer putt ${player.name}`} value={stat.firstPuttDistanceFeet} fallback={0} min={0} max={300} onChange={(value) => onChange({ firstPuttDistanceFeet: value })} /></div>
  </section>;
}

export function RoundCaptureV2(props: RoundCaptureV2Props) {
  const {
    course, hole, order, currentIndex, completedHoles, players, playerTeeAssignments = [], ownerId, ownerAvatarUrl, mode, bets,
    supplementalBets, scores, putts, advancedStats, unitQuantities, groupNassauLabel, ballFriendLabel, lobaLabel,
  } = props;
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const [gpsOpen, setGpsOpen] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [shotMessage, setShotMessage] = useState("");
  const [shotClub, setShotClub] = useState("");
  const [captureStage, setCaptureStage] = useState<"score" | "tee" | "approach" | "around" | "summary">("score");
  const owner = players.find((player) => player.id === ownerId) || players[0];
  const [activePlayerId, setActivePlayerId] = useState(owner?.id ?? "");
  const activePlayer = players.find((player) => player.id === activePlayerId) || owner;
  const quickFields = (playerId: string) => roundCaptureFieldsForPlayer({ mode: "quick", playerId, playedHoleIndex: currentIndex, bets, supplementalBets });
  const teeLabel = (playerId: string) => playerTeeAssignments.find((assignment) => assignment.playerId === playerId)?.teeName || course.teeName;
  const unitParticipates = (playerId: string) => bets.units.enabled && bets.units.participantIds.includes(playerId);
  const currentHoleShots = useMemo(() => props.shots.filter((shot) => shot.playerId === activePlayer?.id && shot.hole === hole.number), [activePlayer?.id, hole.number, props.shots]);
  const openShot = currentHoleShots.find((shot) => !shot.endedAt);
  const activeAnimals = activePlayer ? captureAnimalVisibility(bets, activePlayer.id) : { viper: false, camel: false, fish: false };
  const activeStat = activePlayer ? advancedStats[activePlayer.id] || {} : {};
  const hasVerifiedGreenGeometry = isValidGeographicPoint({ latitude: hole.greenCenterLatitude, longitude: hole.greenCenterLongitude })
    || isValidGeographicPoint({ latitude: hole.greenFrontLatitude, longitude: hole.greenFrontLongitude })
    || isValidGeographicPoint({ latitude: hole.greenBackLatitude, longitude: hole.greenBackLongitude });

  function focusStage(stage: typeof captureStage) {
    setCaptureStage(stage);
    document.getElementById(`capture-${stage}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function requestGps() {
    if (!("geolocation" in navigator)) {
      setGpsState("error");
      setGpsMessage("GPS no disponible en este navegador.");
      return;
    }
    setGpsState("loading");
    setGpsMessage("Solicitando ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsState("ready");
        const userPoint = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
        const green = calculateGreenDistances(userPoint, hole);
        const greenParts = [green.frontYards !== undefined ? `Frente ${green.frontYards}` : "", green.centerYards !== undefined ? `Centro ${green.centerYards}` : "", green.backYards !== undefined ? `Fondo ${green.backYards}` : ""].filter(Boolean);
        if (greenParts.length) {
          setGpsMessage(`${greenParts.join(" · ")} yd${green.accuracyMeters !== undefined ? ` · precisión ±${Math.round(green.accuracyMeters)} m` : ""}`);
          return;
        }
        const coursePoint = { latitude: course.latitude, longitude: course.longitude };
        const distanceKm = isValidGeographicPoint(coursePoint) ? haversineDistanceKm(userPoint, coursePoint) : null;
        if (distanceKm === null) {
          setGpsMessage(`Ubicación obtenida. ${course.name} aún no tiene coordenadas GPS; puedes seguir capturando.`);
          return;
        }
        const distance = distanceKm < 1 ? `${Math.round(distanceKm * 1_000)} m` : `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
        setGpsMessage(`Ubicación obtenida · a ${distance} del punto registrado de ${course.name}.`);
      },
      (error) => {
        setGpsState("error");
        setGpsMessage(gpsFallbackMessage(error.code === error.PERMISSION_DENIED ? "DENIED" : error.code === error.TIMEOUT ? "TIMEOUT" : "UNAVAILABLE"));
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 20_000 },
    );
  }

  async function beginShot() {
    if (!activePlayer || !shotClub || shotBusy) return;
    setShotBusy(true);
    let location: ShotLocation | undefined;
    try { location = await currentLocation(); }
    catch { setShotMessage("GPS no disponible: el golpe se guardará manualmente, sin inventar distancia."); }
    const availableClubs = props.ownerClubChoices?.length ? props.ownerClubChoices : FALLBACK_TEE_CLUBS;
    const selectedClub = availableClubs.find((club) => club.label === shotClub);
    const next = startShot({
      id: shotId(),
      roundId: props.roundId,
      playerId: activePlayer.id,
      hole: hole.number,
      clubId: selectedClub?.id,
      clubLabel: shotClub,
      category: selectedClub?.category || undefined,
      model: selectedClub?.model || undefined,
      shaft: selectedClub?.shaft ? {
        ...(selectedClub.shaft.id ? { id: selectedClub.shaft.id } : {}),
        ...(selectedClub.shaft.brand ? { brand: selectedClub.shaft.brand } : {}),
        ...(selectedClub.shaft.model ? { model: selectedClub.shaft.model } : {}),
        ...(selectedClub.shaft.flex ? { flex: selectedClub.shaft.flex } : {}),
        ...(selectedClub.shaft.weightGrams !== null ? { weightGrams: selectedClub.shaft.weightGrams } : {}),
        ...(selectedClub.shaft.source ? { source: selectedClub.shaft.source } : {}),
      } : null,
      location,
      startedAt: new Date().toISOString(),
      existing: props.shots,
    });
    props.onShotsChange([...props.shots, next]);
    setShotMessage(location ? `Golpe ${next.sequence} iniciado con ${shotClub}.` : `Golpe ${next.sequence} guardado; falta cerrar su distancia.`);
    setShotBusy(false);
  }

  async function finishShot() {
    if (!openShot || shotBusy) return;
    setShotBusy(true);
    let location: ShotLocation | undefined;
    try { location = await currentLocation(); } catch { /* Manual close deliberately has no distance. */ }
    const closed = closeShot(openShot, location, new Date().toISOString());
    props.onShotsChange(props.shots.map((shot) => shot.id === openShot.id ? closed : shot));
    setShotMessage(closed.distanceYards !== undefined ? `Golpe cerrado: ${closed.distanceYards} yd.` : "Golpe cerrado sin distancia confiable.");
    setShotBusy(false);
  }

  function setGolfFact(playerId: string, kind: "greenSideBunkerCount" | "fairwayBunkerCount" | "bunkerCount" | "penaltyAreaCount", value: number) {
    const stat = advancedStats[playerId] || {};
    if (kind === "penaltyAreaCount") {
      props.onAdvancedChange(playerId, { penaltyAreaCount: value });
      if (quickFields(playerId).includes("fish")) props.onCounterChange("fish", playerId, value);
      return;
    }
    if (kind === "bunkerCount") {
      props.onAdvancedChange(playerId, { bunkerCount: value });
      if (quickFields(playerId).includes("bunker")) props.onCounterChange("camels", playerId, value);
      return;
    }
    const greenSide = kind === "greenSideBunkerCount" ? value : stat.greenSideBunkerCount || 0;
    const fairway = kind === "fairwayBunkerCount" ? value : stat.fairwayBunkerCount || 0;
    props.onAdvancedChange(playerId, { [kind]: value, bunkerCount: greenSide + fairway });
    if (quickFields(playerId).includes("bunker")) props.onCounterChange("camels", playerId, greenSide + fairway);
  }

  const activeTeeClubChoices = activePlayer?.id === owner?.id && props.ownerClubChoices?.length ? props.ownerClubChoices : FALLBACK_TEE_CLUBS;
  const activeTeeClubs = activeTeeClubChoices.map((club) => club.label);

  function selectTeeDirection(value: AdvancedHoleStat["teeDirection"]) {
    if (!activePlayer) return;
    const clearing = activeStat.teeDirection === value;
    props.onAdvancedChange(activePlayer.id, {
      teeDirection: clearing ? undefined : value,
      fairwayHit: clearing ? undefined : value === "center",
      landingLie: clearing ? undefined : value === "center" ? "fairway" : "rough",
    });
  }

  function changePlayer() {
    if (!activePlayer || players.length < 2) return;
    const index = players.findIndex((player) => player.id === activePlayer.id);
    setActivePlayerId(players[(index + 1) % players.length]?.id ?? owner?.id ?? "");
    setShotClub("");
  }

  function clearActiveCapture() {
    if (!activePlayer) return;
    props.onScoreChange(activePlayer.id, null);
    props.onPuttsChange(activePlayer.id, null);
    props.onAdvancedChange(activePlayer.id, {
      fairwayHit: undefined,
      landingLie: undefined,
      teeDirection: undefined,
      teeClub: undefined,
      teeDistance: undefined,
      firstPuttDistanceFeet: undefined,
      bunkerCount: undefined,
      greenSideBunkerCount: undefined,
      fairwayBunkerCount: undefined,
      penaltyAreaCount: undefined,
      outOfBounds: undefined,
      outOfBoundsCount: undefined,
      notes: undefined,
    });
    props.onCounterChange("camels", activePlayer.id, 0);
    props.onCounterChange("fish", activePlayer.id, 0);
    props.onShotsChange(props.shots.filter((shot) => !(shot.playerId === activePlayer.id && shot.hole === hole.number)));
    const units = unitQuantities[activePlayer.id] || 0;
    if (units) props.onUnitDelta(activePlayer.id, -units);
  }

  return <div className={styles.screen} data-game-screen="approved-compact-v1">
    <section className={styles.hero}>
      <div className={styles.gameBrand}><b>The<br />Backyard</b><span>⛳</span><small>GOLF · FRIENDS · MORE</small></div>
      <div className={styles.holeHeading}><b>Hoyo {hole.number}</b><span>Par {hole.par}{hole.yards ? ` · ${hole.yards} yd` : ""} · SI {hole.strokeIndex}</span></div>
    </section>

    <nav className={styles.holeNav} aria-label="Hoyos de la ronda">{order.map((number, index) => <button type="button" key={number} data-active={index === currentIndex} data-done={completedHoles.has(number)} onClick={() => props.onNavigateHole(index)}>{number}</button>)}</nav>

    <div className={styles.toolbar}>
      <button type="button" className={styles.camera} aria-label="Escanear tarjeta" title="Escanear tarjeta" onClick={props.onOpenScanner}>📷</button>
      <button type="button" onClick={props.onToggleFullCard}>{props.fullCardVisible ? "Ocultar tarjeta" : "Tarjeta"}</button>
      <button type="button" onClick={props.onOpenStandings}>Cómo vamos</button>
      <button type="button" onClick={() => props.onModeChange(mode === "quick" ? "advanced" : "quick")}>{mode === "quick" ? "RÁPIDA" : "ESTADÍSTICAS"}</button>
      <button type="button" disabled={props.undoDisabled} onClick={props.onUndo}>↶ Deshacer</button>
    </div>

    {props.fullCardVisible && props.fullCardContent}

    <section className={`card ${styles.captureCard}`}>
      {groupNassauLabel && <div className={styles.betContext}><b>APUESTA ACTIVA</b><span>{groupNassauLabel}</span></div>}
      {bets.ballFriend.enabled && ballFriendLabel && <div className={styles.teamContext}><b>BOLA AMIGA</b><span>{ballFriendLabel.replace(/^⚪🤝\s*/, "")}</span></div>}
      {(bets.loba.enabled || bets.ballFriend.enabled) && <div className="scoreBetQuickSetup" aria-label="Apuestas de este hoyo">
        {bets.loba.enabled && <button type="button" onClick={props.onOpenLoba}>{lobaLabel || "🐺 Elegir Loba"}</button>}
        {bets.ballFriend.enabled && <button type="button" onClick={props.onOpenBallFriend}>{ballFriendLabel || "⚪🤝 Elegir Bola Amiga"}</button>}
      </div>}

      {activePlayer && <article className={styles.primaryPlayer}>
        <header className={styles.primaryHeader}>
          <ProfileAvatarMedia className={styles.avatar} value={activePlayer.id === owner?.id ? ownerAvatarUrl : undefined} fallback={initials(activePlayer.name)} />
          <div className={styles.playerHeading}>
            <div><b>{activePlayer.name || "Jugador"}</b><small>HCP de juego {activePlayer.handicap ?? "—"} · {teeLabel(activePlayer.id)}</small></div>
            {activePlayer.id === owner?.id ? <span className={styles.principalBadge}>PRINCIPAL</span> : null}
            <span className={styles.toPar}>{scoreToParLabel(scores[activePlayer.id], hole.par)}</span>
          </div>
          {players.length > 1 ? <button type="button" className={styles.changePlayer} aria-label="Cambiar jugador" onClick={changePlayer}>Cambiar jugador</button> : null}
        </header>
        <ScorecardHoleNetPreview player={activePlayer} hole={hole} gross={scores[activePlayer.id]} />

        <nav className={styles.captureTabs} aria-label="Secciones de captura">
          {([["score", "Score"], ["tee", "Tee Shot"], ["approach", "Approach"], ["around", "Alrededor"], ["summary", "Resumen"]] as const).map(([stage, label]) => <button type="button" key={stage} data-active={captureStage === stage} aria-current={captureStage === stage ? "page" : undefined} onClick={() => focusStage(stage)}>{label}</button>)}
        </nav>

        <section className={styles.captureSection} id="capture-score">
          <div className={styles.primaryControls}>
            <div className={styles.primaryControl}><span>SCORE</span><CompactStepper large label={`Score ${activePlayer.name} hoyo ${hole.number}`} value={scores[activePlayer.id]} fallback={hole.par} min={1} onChange={(value) => props.onScoreChange(activePlayer.id, value)} /></div>
            <div className={styles.primaryControl}><span>PUTTS</span><div className={styles.puttsCapture}><CompactStepper large label={`Putts ${activePlayer.name} hoyo ${hole.number}`} value={putts[activePlayer.id]} fallback={2} min={0} max={20} onChange={(value) => props.onPuttsChange(activePlayer.id, value)} />{activeAnimals.viper ? <i className={styles.animalMarker} data-triggered={typeof putts[activePlayer.id] === "number" && (putts[activePlayer.id] as number) >= 3} aria-label="Víboras activa">🐍<small>Víbora activa</small></i> : null}</div></div>
          </div>
        </section>

        <section className={styles.captureSection} id="capture-tee">
          <div className={styles.sectionLabel}><span>DIRECCIÓN DE SALIDA</span><small>Opcional</small></div>
          <div className={styles.teeDirection} role="group" aria-label="Dirección de salida">
            <div className={styles.directionColumn}>{TEE_DIRECTION_OPTIONS.slice(0, 2).map((option) => <button type="button" className={styles.directionButton} key={option.value} data-active={activeStat.teeDirection === option.value} aria-pressed={activeStat.teeDirection === option.value} onClick={() => selectTeeDirection(option.value)}><b>{option.glyph}</b><small>{option.label}</small></button>)}</div>
            <div className={styles.directionDial} data-active={activeStat.teeDirection === "center"}>
              <span className={styles.dialArrowTop} aria-hidden="true">⌃</span><span className={styles.dialArrowLeft} aria-hidden="true">‹</span><span className={styles.dialArrowRight} aria-hidden="true">›</span><span className={styles.dialArrowBottom} aria-hidden="true">⌄</span>
              <button type="button" aria-label="Salida al centro: HIT" aria-pressed={activeStat.teeDirection === "center"} onClick={() => selectTeeDirection("center")}>HIT</button>
            </div>
            <div className={styles.directionColumn}>{TEE_DIRECTION_OPTIONS.slice(2).map((option) => <button type="button" className={styles.directionButton} key={option.value} data-active={activeStat.teeDirection === option.value} aria-pressed={activeStat.teeDirection === option.value} onClick={() => selectTeeDirection(option.value)}><b>{option.glyph}</b><small>{option.label}</small></button>)}</div>
          </div>

          <div className={styles.clubDistanceGrid}>
            <label className={styles.clubSelect}><span>PALO DE SALIDA</span><select aria-label={`Palo de salida ${activePlayer.name}`} value={activeStat.teeClub ?? ""} onChange={(event) => props.onAdvancedChange(activePlayer.id, { teeClub: event.target.value || undefined })}><option value="">Seleccionar palo</option>{activeTeeClubs.map((club) => <option value={club} key={club}>{club}</option>)}</select></label>
            <div className={styles.compactField}><span>DISTANCIA DE SALIDA · YD</span><CompactStepper label={`Distancia de salida ${activePlayer.name}`} value={activeStat.teeDistance} fallback={0} min={0} max={600} onChange={(value) => props.onAdvancedChange(activePlayer.id, { teeDistance: value })} /></div>
          </div>

          <section className={styles.situations} aria-labelledby="hole-situations-title">
            <div className={styles.situationsHeading}><b id="hole-situations-title">SITUACIONES DEL HOYO</b><small>Cuenta cuántas tuviste</small></div>
            <div className={styles.situationsGrid}>
              <SituationCounter label="Green Side Bunker" icon={activeAnimals.camel ? "🐫" : "◯"} value={activeStat.greenSideBunkerCount} onChange={(value) => setGolfFact(activePlayer.id, "greenSideBunkerCount", value)} />
              <SituationCounter label="Fairway Bunker" icon={activeAnimals.camel ? "🐫" : "◯"} value={activeStat.fairwayBunkerCount} onChange={(value) => setGolfFact(activePlayer.id, "fairwayBunkerCount", value)} />
              <SituationCounter label="Penalty / Hazard" icon={activeAnimals.fish ? "🐟" : "≋"} value={activeStat.penaltyAreaCount} onChange={(value) => setGolfFact(activePlayer.id, "penaltyAreaCount", value)} />
              <SituationCounter label="OB" icon="‖" value={activeStat.outOfBoundsCount ?? (activeStat.outOfBounds ? 1 : undefined)} onChange={(value) => props.onAdvancedChange(activePlayer.id, { outOfBoundsCount: value, outOfBounds: value > 0 })} />
            </div>
          </section>

          {mode === "advanced" && <section className={styles.shotTracker} aria-label="Shot Tracking opcional">
            <div className={styles.statsHeading}><div><span className="eyebrow">OPCIONAL</span><h3>Registrar golpe</h3></div><small>GPS sólo si es confiable</small></div>
            <div className={styles.choiceRow}>{activeTeeClubs.map((club) => <ToggleChip key={club} label={club} active={shotClub === club} onClick={() => setShotClub(shotClub === club ? "" : club)} />)}</div>
            <div className={styles.shotActions}>{openShot ? <><button type="button" className="primary" disabled={shotBusy} onClick={finishShot}>{shotBusy ? "Midiendo…" : "Terminar golpe"}</button><button type="button" className="secondary" disabled={shotBusy} onClick={() => { props.onShotsChange(cancelShot(props.shots, openShot.id)); setShotMessage("Golpe cancelado."); }}>Cancelar</button></> : <button type="button" className="primary" disabled={!shotClub || shotBusy} onClick={beginShot}>{shotBusy ? "Ubicando…" : "Iniciar golpe"}</button>}</div>
            {currentHoleShots.some((shot) => Boolean(shot.endedAt)) && <div className={styles.shotList}>{currentHoleShots.filter((shot) => shot.endedAt).map((shot) => <span key={shot.id}>{shot.sequence}. {shot.clubLabel}{shot.distanceYards !== undefined ? ` · ${shot.distanceYards} yd` : " · sin distancia"}</span>)}</div>}
            {shotMessage && <p className={styles.shotStatus} role="status">{shotMessage}</p>}
          </section>}
        </section>

        <div id="capture-around"><PlayerAroundStatistics player={activePlayer} stat={activeStat} onChange={(patch) => props.onAdvancedChange(activePlayer.id, patch)} /></div>

        {unitParticipates(activePlayer.id) && <div className={styles.ownerUnits}><span>🪙 UNIDADES</span><SignedStepper label={`Unidades ${activePlayer.name}`} value={unitQuantities[activePlayer.id] || 0} onDelta={(delta) => props.onUnitDelta(activePlayer.id, delta)} /></div>}
        {props.playerIndicators(activePlayer.id).length > 0 && <span className="playerHoleBetBadges">{props.playerIndicators(activePlayer.id).map((indicator) => <i key={indicator}>{indicator}</i>)}</span>}
      </article>}
    </section>

    <section className={styles.gpsShell} id="capture-approach">
      <button type="button" className={styles.gpsToggle} aria-expanded={gpsOpen} aria-controls="round-hole-map" onClick={() => setGpsOpen((open) => !open)}><span aria-hidden="true">⌖</span><b>{gpsOpen ? "OCULTAR VISTA GPS" : "VER VISTA GPS"}</b><small>{gpsOpen ? "Cerrar mapa del hoyo" : "Explora el hoyo cuando haya datos reales"}</small><i aria-hidden="true">{gpsOpen ? "⌃" : "⌄"}</i></button>
      {gpsOpen ? <div className={styles.holeMap} id="round-hole-map" aria-label="Vista GPS del hoyo">
        <header><div><span>VISTA GPS</span><h2>Hole Map</h2></div>{hasVerifiedGreenGeometry && <button type="button" className={styles.gpsButtonLight} data-state={gpsState} disabled={gpsState === "loading"} onClick={requestGps}>{gpsState === "loading" ? "Ubicando…" : gpsState === "ready" ? "Actualizar GPS" : "Usar mi ubicación"}</button>}</header>
        {hasVerifiedGreenGeometry ? <p>{gpsMessage || "Activa GPS para calcular distancias sólo con coordenadas verificadas."}</p> : <p>Este hoyo todavía no tiene geometría verificada. No mostramos mapa ni distancias inventadas.</p>}
      </div> : null}
    </section>

    <RoundCaddieCard planId={props.caddiePlanId} hole={hole} phase={captureStage === "around" ? "AROUND_GREEN" : captureStage === "tee" || captureStage === "score" ? "TEE_SHOT" : "APPROACH"} gpsAvailable={gpsState === "ready" && hasVerifiedGreenGeometry} bagClubCount={props.ownerClubChoices?.length ?? 0} />

    {activePlayer && <label className={styles.notes}><span>NOTAS <small>(opcional)</small></span><textarea aria-label={`Notas del hoyo ${hole.number}`} placeholder="Añadir nota del hoyo…" maxLength={500} value={activeStat.notes ?? ""} onChange={(event) => props.onAdvancedChange(activePlayer.id, { notes: event.target.value })} /></label>}

    <div className={styles.captureActions}>
      <button type="button" className={styles.deleteAction} onClick={clearActiveCapture}>⌫ <span>Borrar</span></button>
      <button type="button" className={styles.previousAction} disabled={currentIndex === 0 || props.saveDisabled} onClick={() => props.onNavigateHole(currentIndex - 1)}>‹ <span>Anterior</span></button>
      <button type="button" className={styles.saveAction} disabled={props.saveDisabled} onClick={props.onSaveAndAdvance}>{props.saveLabel}<span aria-hidden="true">›</span></button>
    </div>
  </div>;
}
