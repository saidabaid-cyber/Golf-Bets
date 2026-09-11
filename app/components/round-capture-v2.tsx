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
import { CompactStepper, CounterStepper, SignedStepper, TapCounter } from "./bet-fields/capture-controls";
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
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BY";
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={styles.toggleChip} data-active={active} aria-pressed={active} onClick={onClick}>{label}</button>;
}

function GroupRequiredInputs({ player, fields, putts, stat, unitsActive, units, animals, onPutts, onGolfFact, onUnitDelta }: {
  player: Player;
  fields: ReturnType<typeof roundCaptureFieldsForPlayer>;
  putts: number | null | undefined;
  stat: AdvancedHoleStat;
  unitsActive: boolean;
  units: number;
  animals: ReturnType<typeof captureAnimalVisibility>;
  onPutts: (value: number | null) => void;
  onGolfFact: (kind: "bunkerCount" | "penaltyAreaCount", value: number) => void;
  onUnitDelta: (delta: number) => void;
}) {
  if (!fields.length && !unitsActive) return null;
  return <div className={styles.groupRequired}>
    {fields.includes("putts") && <div className={styles.compactField}><span>Putts</span><CompactStepper label={`Putts ${player.name}`} value={putts} fallback={2} min={0} max={20} onChange={onPutts} />{animals.viper ? <i className={styles.animalMarker} data-triggered={typeof putts === "number" && putts >= 3} aria-label="Víboras activa">🐍</i> : null}</div>}
    {fields.includes("bunker") && <TapCounter compact label="Bunker" icon={animals.camel ? "🐫" : undefined} value={stat.bunkerCount} onChange={(value) => onGolfFact("bunkerCount", value)} />}
    {fields.includes("fish") && <TapCounter compact label="Penalty / Hazard" icon={animals.fish ? "🐟" : undefined} value={stat.penaltyAreaCount} onChange={(value) => onGolfFact("penaltyAreaCount", value)} />}
    {unitsActive && <div className={styles.compactField}><span>🪙 Unidades</span><SignedStepper label={`Unidades ${player.name}`} value={units} onDelta={onUnitDelta} /></div>}
  </div>;
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

function OwnerStatistics({ player, stat, camelActive, onChange }: { player: Player; stat: AdvancedHoleStat; camelActive: boolean; onChange: (patch: Partial<AdvancedHoleStat>) => void }) {
  return <section className={styles.ownerStatistics} aria-label={`Estadísticas opcionales de ${player.name}`}>
    <div className={styles.statsHeading}><div><span className="eyebrow">ALREDEDOR</span><h3>Juego corto</h3></div><small>Sólo tú · opcional</small></div>
    <div className={styles.statsGrid}>
      <div className={styles.compactField}><span>Distancia 1er putt · ft</span><CompactStepper label={`Distancia del primer putt ${player.name}`} value={stat.firstPuttDistanceFeet} fallback={0} min={0} max={300} onChange={(value) => onChange({ firstPuttDistanceFeet: value })} /></div>
      <TapCounter label="Green Side Bunker" icon={camelActive ? "🐫" : undefined} value={stat.greenSideBunkerCount} onChange={(value) => onChange({ greenSideBunkerCount: value })} />
    </div>
  </section>;
}

export function RoundCaptureV2(props: RoundCaptureV2Props) {
  const {
    course, hole, order, currentIndex, completedHoles, players, playerTeeAssignments = [], ownerId, ownerAvatarUrl, mode, bets,
    supplementalBets, scores, putts, advancedStats, unitQuantities, groupNassauLabel, ballFriendLabel, lobaLabel,
  } = props;
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const [shotBusy, setShotBusy] = useState(false);
  const [shotMessage, setShotMessage] = useState("");
  const [shotClub, setShotClub] = useState("");
  const [captureStage, setCaptureStage] = useState<"score" | "tee" | "approach" | "around" | "summary">("score");
  const owner = players.find((player) => player.id === ownerId) || players[0];
  const group = players.filter((player) => player.id !== owner?.id);
  const quickFields = (playerId: string) => roundCaptureFieldsForPlayer({ mode: "quick", playerId, playedHoleIndex: currentIndex, bets, supplementalBets });
  const teeLabel = (playerId: string) => playerTeeAssignments.find((assignment) => assignment.playerId === playerId)?.teeName || course.teeName;
  const unitParticipates = (playerId: string) => bets.units.enabled && bets.units.participantIds.includes(playerId);
  const currentHoleShots = useMemo(() => props.shots.filter((shot) => shot.playerId === owner?.id && shot.hole === hole.number), [hole.number, owner?.id, props.shots]);
  const openShot = currentHoleShots.find((shot) => !shot.endedAt);
  const ownerAnimals = owner ? captureAnimalVisibility(bets, owner.id) : { viper: false, camel: false, fish: false };
  const ownerStat = owner ? advancedStats[owner.id] || {} : {};
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
    if (!owner || !shotClub || shotBusy) return;
    setShotBusy(true);
    let location: ShotLocation | undefined;
    try { location = await currentLocation(); }
    catch { setShotMessage("GPS no disponible: el golpe se guardará manualmente, sin inventar distancia."); }
    const availableClubs = props.ownerClubChoices?.length ? props.ownerClubChoices : FALLBACK_TEE_CLUBS;
    const selectedClub = availableClubs.find((club) => club.label === shotClub);
    const next = startShot({
      id: shotId(),
      roundId: props.roundId,
      playerId: owner.id,
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

  const ownerTeeClubChoices = props.ownerClubChoices?.length ? props.ownerClubChoices : FALLBACK_TEE_CLUBS;
  const ownerTeeClubs = ownerTeeClubChoices.map((club) => club.label);

  return <div className={styles.screen} data-game-screen="approved-compact-v1">
    <section className={styles.hero}>
      <div>
        <div className="eyebrow">{course.name}</div>
        <div className={styles.heroTitle}><h1>Hoyo {hole.number}</h1></div>
        <div className={styles.holeFacts}>
          <span>Par {hole.par}</span><span>{hole.yards ? `${hole.yards} yd` : "Yardas —"}</span><span>SI {hole.strokeIndex}</span>
          <button type="button" className={styles.gpsButton} data-state={gpsState} disabled={gpsState === "loading"} onClick={requestGps}>{gpsState === "loading" ? "GPS…" : gpsState === "ready" ? "GPS ✓" : "GPS"}</button>
        </div>
      </div>
      <div className={styles.progress}>{currentIndex + 1}<span>/{order.length}</span></div>
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

      {owner && <article className={styles.primaryPlayer}>
        <header className={styles.primaryHeader}>
          <ProfileAvatarMedia className={styles.avatar} value={ownerAvatarUrl} fallback={initials(owner.name)} />
          <div className={styles.playerHeading}>
            <div><small>JUGADOR</small><b>{owner.name || "Jugador principal"}</b><small>HCP de juego {owner.handicap ?? "—"} · {teeLabel(owner.id)}</small></div>
            <span className={styles.toPar}>{scoreToParLabel(scores[owner.id], hole.par)}</span>
          </div>
        </header>
        <ScorecardHoleNetPreview player={owner} hole={hole} gross={scores[owner.id]} />

        <nav className={styles.captureTabs} aria-label="Secciones de captura">
          {([["score", "Score"], ["tee", "Tee Shot"], ["approach", "Approach"], ["around", "Alrededor"], ["summary", "Resumen"]] as const).map(([stage, label]) => <button type="button" key={stage} data-active={captureStage === stage} aria-current={captureStage === stage ? "page" : undefined} onClick={() => focusStage(stage)}>{label}</button>)}
        </nav>

        <section className={styles.captureSection} id="capture-score">
          <div className={styles.primaryControls}>
            <div className={styles.primaryControl}><span>SCORE</span><CompactStepper large label={`Score ${owner.name} hoyo ${hole.number}`} value={scores[owner.id]} fallback={hole.par} min={1} onChange={(value) => props.onScoreChange(owner.id, value)} /></div>
            <div className={styles.primaryControl}><span>PUTTS</span><CompactStepper large label={`Putts ${owner.name} hoyo ${hole.number}`} value={putts[owner.id]} fallback={2} min={0} max={20} onChange={(value) => props.onPuttsChange(owner.id, value)} />{ownerAnimals.viper ? <i className={styles.animalMarker} data-triggered={typeof putts[owner.id] === "number" && (putts[owner.id] as number) >= 3} aria-label="Víboras activa">🐍</i> : null}</div>
          </div>
        </section>

        <section className={styles.captureSection} id="capture-tee">
          <div className={styles.sectionLabel}><span>TEE SHOT</span><small>Un tap · todo opcional</small></div>
          <div className={`${styles.choiceRow} ${styles.teeDirection}`} role="group" aria-label="Dirección de salida">
            {([["far_left", "↞", "Muy izq."], ["left", "←", "Izquierda"], ["center", "●", "Fairway"], ["right", "→", "Derecha"], ["far_right", "↠", "Muy der."]] as const).map(([value, glyph, label]) => <button type="button" className={styles.directionButton} key={value} data-active={ownerStat.teeDirection === value} aria-pressed={ownerStat.teeDirection === value} onClick={() => props.onAdvancedChange(owner.id, { teeDirection: ownerStat.teeDirection === value ? undefined : value, fairwayHit: ownerStat.teeDirection === value ? undefined : value === "center" })}><b>{glyph}</b><small>{label}</small></button>)}
          </div>

          <div className={styles.ballResult} role="group" aria-label="Resultado de la bola">
            <ToggleChip label="Fairway" active={ownerStat.landingLie === "fairway"} onClick={() => props.onAdvancedChange(owner.id, { landingLie: ownerStat.landingLie === "fairway" ? undefined : "fairway", fairwayHit: ownerStat.landingLie === "fairway" ? undefined : true })} />
            <ToggleChip label="Rough" active={ownerStat.landingLie === "rough"} onClick={() => props.onAdvancedChange(owner.id, { landingLie: ownerStat.landingLie === "rough" ? undefined : "rough", fairwayHit: ownerStat.landingLie === "rough" ? undefined : false })} />
            <TapCounter label="Bunker" icon={ownerAnimals.camel ? "🐫" : undefined} value={ownerStat.fairwayBunkerCount} onChange={(value) => { setGolfFact(owner.id, "fairwayBunkerCount", value); if (value > 0) props.onAdvancedChange(owner.id, { landingLie: "bunker" }); }} />
            <TapCounter label="Penalty / Hazard" icon={ownerAnimals.fish ? "🐟" : undefined} value={ownerStat.penaltyAreaCount} onChange={(value) => setGolfFact(owner.id, "penaltyAreaCount", value)} />
          </div>

          <div className={styles.clubDistanceGrid}>
            <div className={styles.statBlock}><span className={styles.statLabel}>Palo</span><div className={styles.choiceRow}>{ownerTeeClubs.map((club) => <ToggleChip key={club} label={club} active={ownerStat.teeClub === club} onClick={() => props.onAdvancedChange(owner.id, { teeClub: ownerStat.teeClub === club ? undefined : club })} />)}</div></div>
            <div className={styles.compactField}><span>DISTANCIA · YD</span><CompactStepper label={`Distancia de salida ${owner.name}`} value={ownerStat.teeDistance} fallback={0} min={0} max={600} onChange={(value) => props.onAdvancedChange(owner.id, { teeDistance: value })} /></div>
            <div className={styles.compactField}><span>OB</span><CounterStepper label={`OB ${owner.name}`} value={ownerStat.outOfBoundsCount ?? (ownerStat.outOfBounds ? 1 : undefined)} onChange={(value) => props.onAdvancedChange(owner.id, { outOfBoundsCount: value, outOfBounds: value > 0 })} /></div>
          </div>

          {mode === "advanced" && <section className={styles.shotTracker} aria-label="Shot Tracking opcional">
            <div className={styles.statsHeading}><div><span className="eyebrow">OPCIONAL</span><h3>Registrar golpe</h3></div><small>GPS sólo si es confiable</small></div>
            <div className={styles.choiceRow}>{ownerTeeClubs.map((club) => <ToggleChip key={club} label={club} active={shotClub === club} onClick={() => setShotClub(shotClub === club ? "" : club)} />)}</div>
            <div className={styles.shotActions}>{openShot ? <><button type="button" className="primary" disabled={shotBusy} onClick={finishShot}>{shotBusy ? "Midiendo…" : "Terminar golpe"}</button><button type="button" className="secondary" disabled={shotBusy} onClick={() => { props.onShotsChange(cancelShot(props.shots, openShot.id)); setShotMessage("Golpe cancelado."); }}>Cancelar</button></> : <button type="button" className="primary" disabled={!shotClub || shotBusy} onClick={beginShot}>{shotBusy ? "Ubicando…" : "Iniciar golpe"}</button>}</div>
            {currentHoleShots.some((shot) => Boolean(shot.endedAt)) && <div className={styles.shotList}>{currentHoleShots.filter((shot) => shot.endedAt).map((shot) => <span key={shot.id}>{shot.sequence}. {shot.clubLabel}{shot.distanceYards !== undefined ? ` · ${shot.distanceYards} yd` : " · sin distancia"}</span>)}</div>}
            {shotMessage && <p className={styles.shotStatus} role="status">{shotMessage}</p>}
          </section>}
        </section>

        <div id="capture-around"><OwnerStatistics player={owner} stat={ownerStat} camelActive={ownerAnimals.camel} onChange={(patch) => {
          if (typeof patch.greenSideBunkerCount === "number") setGolfFact(owner.id, "greenSideBunkerCount", patch.greenSideBunkerCount);
          else props.onAdvancedChange(owner.id, patch);
        }} /></div>

        {unitParticipates(owner.id) && <div className={styles.ownerUnits}><span>🪙 UNIDADES</span><SignedStepper label={`Unidades ${owner.name}`} value={unitQuantities[owner.id] || 0} onDelta={(delta) => props.onUnitDelta(owner.id, delta)} /></div>}
        {props.playerIndicators(owner.id).length > 0 && <span className="playerHoleBetBadges">{props.playerIndicators(owner.id).map((indicator) => <i key={indicator}>{indicator}</i>)}</span>}
      </article>}

      {group.length > 0 && <section id="capture-summary">
        <div className={styles.groupTitle}><div><span>JUGADORES DEL GRUPO</span><small>Sólo score y datos necesarios para las apuestas</small></div></div>
        <div className={styles.groupList}>{group.map((player) => {
          const playerFields = quickFields(player.id);
          return <article className={styles.groupPlayer} key={player.id}>
            <div className={styles.groupIdentity}><div><b>{player.name || "Sin nombre"}</b><small>HCP {player.handicap ?? "—"} · {teeLabel(player.id)}</small></div><span>{scoreToParLabel(scores[player.id], hole.par)}</span></div>
            <div className={styles.groupScore}><span>SCORE</span><CompactStepper label={`Score ${player.name} hoyo ${hole.number}`} value={scores[player.id]} fallback={hole.par} min={1} onChange={(value) => props.onScoreChange(player.id, value)} /></div>
            <GroupRequiredInputs player={player} fields={playerFields} putts={putts[player.id]} stat={advancedStats[player.id] || {}} unitsActive={unitParticipates(player.id)} units={unitQuantities[player.id] || 0} animals={captureAnimalVisibility(bets, player.id)} onPutts={(value) => props.onPuttsChange(player.id, value)} onGolfFact={(kind, value) => setGolfFact(player.id, kind, value)} onUnitDelta={(delta) => props.onUnitDelta(player.id, delta)} />
          </article>;
        })}</div>
      </section>}
    </section>

    <section className={styles.holeMap} id="capture-approach" aria-label="Vista GPS del hoyo">
      <header><div><span>VISTA GPS</span><h2>Hole Map</h2></div>{hasVerifiedGreenGeometry && <button type="button" className={styles.gpsButtonLight} disabled={gpsState === "loading"} onClick={requestGps}>{gpsState === "ready" ? "Actualizar GPS" : "Usar mi ubicación"}</button>}</header>
      {hasVerifiedGreenGeometry ? <p>{gpsMessage || "Activa GPS para calcular distancias sólo con coordenadas verificadas."}</p> : <p>Este hoyo todavía no tiene geometría verificada. La captura de score sigue disponible.</p>}
    </section>

    <RoundCaddieCard planId={props.caddiePlanId} hole={hole} phase={captureStage === "around" ? "AROUND_GREEN" : captureStage === "tee" || captureStage === "score" ? "TEE_SHOT" : "APPROACH"} gpsAvailable={gpsState === "ready" && hasVerifiedGreenGeometry} bagClubCount={props.ownerClubChoices?.length ?? 0} />

    {owner && <label className={styles.notes}><span>NOTAS</span><textarea aria-label={`Notas del hoyo ${hole.number}`} placeholder="Una nota breve del hoyo…" maxLength={500} value={ownerStat.notes ?? ""} onChange={(event) => props.onAdvancedChange(owner.id, { notes: event.target.value })} /></label>}
  </div>;
}
