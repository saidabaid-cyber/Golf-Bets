"use client";

import { useState } from "react";
import type {
  AdvancedHoleStat,
  BetConfig,
  Course,
  CounterBetKind,
  Hole,
  Player,
  PlayerTeeAssignmentSnapshot,
  ScoreCaptureMode,
  SupplementalBet,
} from "../../lib/types";
import { haversineDistanceKm, isValidGeographicPoint } from "../../lib/course-distance";
import { roundCaptureFieldsForPlayer, scoreToParLabel } from "../../lib/round-capture";
import { ScorecardHoleNetPreview } from "./scorecard-hole-preview";
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
  mode: ScoreCaptureMode;
  bets: Pick<BetConfig, "vipers" | "camels" | "fish" | "loba" | "ballFriend" | "units">;
  supplementalBets: SupplementalBet[];
  scores: Record<string, number | null | undefined>;
  putts: Record<string, number | null | undefined>;
  advancedStats: Record<string, AdvancedHoleStat | undefined>;
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
  onOpenLoba: () => void;
  onOpenBallFriend: () => void;
  onOpenScanner: () => void;
  onToggleFullCard: () => void;
  fullCardVisible: boolean;
  onOpenStandings: () => void;
  onUndo: () => void;
  undoDisabled: boolean;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BY";
}

function CompactStepper({ label, value, fallback = 0, min = 0, max = 99, onChange, large = false }: { label: string; value: number | null | undefined; fallback?: number; min?: number; max?: number; onChange: (value: number) => void; large?: boolean }) {
  const confirmed = typeof value === "number" && Number.isFinite(value);
  const current = confirmed ? value : fallback;
  return <div className={`${styles.stepper} ${large ? styles.stepperLarge : ""}`} role="group" aria-label={label}>
    <button type="button" aria-label={`Restar en ${label}`} disabled={current <= min} onClick={() => onChange(Math.max(min, current - 1))}>−</button>
    <button type="button" className={styles.stepperValue} aria-label={`Confirmar ${label}: ${current}`} aria-pressed={confirmed} data-pending={!confirmed} onClick={() => onChange(current)}>{current}</button>
    <button type="button" aria-label={`Sumar en ${label}`} disabled={current >= max} onClick={() => onChange(Math.min(max, current + 1))}>+</button>
  </div>;
}

function SignedStepper({ label, value, onDelta }: { label: string; value: number; onDelta: (delta: number) => void }) {
  return <div className={styles.signedStepper} role="group" aria-label={label}>
    <button type="button" aria-label={`Restar ${label}`} onClick={() => onDelta(-1)}>−</button>
    <span aria-live="polite">{value > 0 ? "+" : ""}{value}</span>
    <button type="button" aria-label={`Sumar ${label}`} onClick={() => onDelta(1)}>+</button>
  </div>;
}

function TapCounter({ label, icon, value, max = 20, onChange, compact = false }: { label: string; icon: string; value: number | null | undefined; max?: number; onChange: (value: number) => void; compact?: boolean }) {
  const confirmed = typeof value === "number" && Number.isFinite(value);
  const current = confirmed ? Math.max(0, Math.trunc(value)) : 0;
  return <div className={`${styles.tapCounter} ${compact ? styles.tapCounterCompact : ""}`} role="group" aria-label={label}>
    <button type="button" className={styles.counterAdd} aria-label={`Agregar ${label}`} disabled={current >= max} onClick={() => onChange(Math.min(max, current + 1))}><span aria-hidden="true">{icon}</span><span>{label}</span>{current > 0 && <b>{current}</b>}</button>
    {current > 0
      ? <button type="button" className={styles.counterSubtract} aria-label={`Restar ${label}`} onClick={() => onChange(current - 1)}>−</button>
      : !confirmed
        ? <button type="button" className={styles.counterSubtract} aria-label={`Confirmar cero en ${label}`} onClick={() => onChange(0)}>0</button>
        : <span className={styles.counterConfirmed} aria-label={`${label}: cero confirmado`}>✓</span>}
  </div>;
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={styles.toggleChip} data-active={active} aria-pressed={active} onClick={onClick}>{label}</button>;
}

function GroupRequiredInputs({ player, fields, putts, counters, unitsActive, units, onPutts, onCounter, onUnitDelta }: {
  player: Player;
  fields: ReturnType<typeof roundCaptureFieldsForPlayer>;
  putts: number | null | undefined;
  counters: Record<CounterBetKind, number | undefined>;
  unitsActive: boolean;
  units: number;
  onPutts: (value: number | null) => void;
  onCounter: (kind: CounterBetKind, value: number | null) => void;
  onUnitDelta: (delta: number) => void;
}) {
  if (!fields.length && !unitsActive) return null;
  return <div className={styles.groupRequired}>
    {fields.includes("putts") && <div className={styles.compactField}><span>Putts</span><CompactStepper label={`Putts ${player.name}`} value={putts} fallback={2} min={0} max={20} onChange={onPutts} /></div>}
    {fields.includes("bunker") && <TapCounter compact label="Bunker" icon="⛱" value={counters.camels} onChange={(value) => onCounter("camels", value)} />}
    {fields.includes("fish") && <TapCounter compact label="Agua" icon="💧" value={counters.fish} onChange={(value) => onCounter("fish", value)} />}
    {unitsActive && <div className={styles.compactField}><span>Unidades</span><SignedStepper label={`Unidades ${player.name}`} value={units} onDelta={onUnitDelta} /></div>}
  </div>;
}

const TEE_CLUBS = ["Driver", "Madera", "Híbrido", "Hierro"] as const;

function OwnerStatistics({ player, stat, onChange }: { player: Player; stat: AdvancedHoleStat; onChange: (patch: Partial<AdvancedHoleStat>) => void }) {
  return <section className={styles.ownerStatistics} aria-label={`Estadísticas opcionales de ${player.name}`}>
    <div className={styles.statsHeading}><div><span className="eyebrow">SÓLO TÚ</span><h3>Estadísticas del hoyo</h3></div><small>Todo es opcional</small></div>

    <div className={styles.statBlock}>
      <span className={styles.statLabel}>Salida</span>
      <div className={styles.choiceRow} role="group" aria-label="Dirección de salida">
        {([["left", "← Izq"], ["center", "Centro"], ["right", "Der →"]] as const).map(([value, label]) => <ToggleChip key={value} label={label} active={stat.teeDirection === value} onClick={() => onChange({ teeDirection: stat.teeDirection === value ? undefined : value, fairwayHit: stat.teeDirection === value ? undefined : value === "center" })} />)}
      </div>
    </div>

    <div className={styles.statBlock}>
      <span className={styles.statLabel}>Palo de salida</span>
      <div className={styles.choiceRow}>{TEE_CLUBS.map((club) => <ToggleChip key={club} label={club} active={stat.teeClub === club} onClick={() => onChange({ teeClub: stat.teeClub === club ? undefined : club })} />)}</div>
    </div>

    <div className={styles.statsGrid}>
      <div className={styles.compactField}><span>Distancia 1er putt · ft</span><CompactStepper label={`Distancia del primer putt ${player.name}`} value={stat.firstPuttDistanceFeet} fallback={0} min={0} max={300} onChange={(value) => onChange({ firstPuttDistanceFeet: value })} /></div>
      <div className={styles.compactField}><span>Green en regulación</span><div className={styles.choiceRow}><ToggleChip label="GIR" active={stat.greenInRegulation === true} onClick={() => onChange({ greenInRegulation: stat.greenInRegulation === true ? undefined : true })} /><ToggleChip label="No GIR" active={stat.greenInRegulation === false} onClick={() => onChange({ greenInRegulation: stat.greenInRegulation === false ? undefined : false })} /></div></div>
      <TapCounter label="Penalidad" icon="⚠" max={50} value={stat.penaltyStrokes} onChange={(value) => onChange({ penaltyStrokes: value })} />
      <ToggleChip label="OB" active={stat.outOfBounds === true} onClick={() => onChange({ outOfBounds: stat.outOfBounds === true ? undefined : true })} />
    </div>
  </section>;
}

export function RoundCaptureV2(props: RoundCaptureV2Props) {
  const {
    course, hole, order, currentIndex, completedHoles, players, playerTeeAssignments = [], ownerId, ownerAvatarUrl, mode, bets,
    supplementalBets, scores, putts, advancedStats, counterQuantities, unitQuantities, groupNassauLabel, ballFriendLabel, lobaLabel,
  } = props;
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const owner = players.find((player) => player.id === ownerId) || players[0];
  const group = players.filter((player) => player.id !== owner?.id);
  const quickFields = (playerId: string) => roundCaptureFieldsForPlayer({ mode: "quick", playerId, playedHoleIndex: currentIndex, bets, supplementalBets });
  const teeLabel = (playerId: string) => playerTeeAssignments.find((assignment) => assignment.playerId === playerId)?.teeName || course.teeName;
  const unitParticipates = (playerId: string) => bets.units.enabled && bets.units.participantIds.includes(playerId);

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
        const userPoint = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const coursePoint = { latitude: course.latitude, longitude: course.longitude };
        const distanceKm = isValidGeographicPoint(coursePoint) ? haversineDistanceKm(userPoint, coursePoint) : null;
        if (distanceKm === null) {
          setGpsMessage(`Ubicación obtenida. ${course.name} aún no tiene coordenadas GPS; puedes seguir capturando.`);
          return;
        }
        const distance = distanceKm < 1 ? `${Math.round(distanceKm * 1_000)} m` : `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
        setGpsMessage(`Ubicación obtenida · a ${distance} del punto registrado de ${course.name}.`);
      },
      () => { setGpsState("error"); setGpsMessage("No se pudo activar GPS. Puedes seguir capturando."); },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 20_000 },
    );
  }

  const countersFor = (playerId: string): Record<CounterBetKind, number | undefined> => ({
    vipers: counterQuantities.vipers[playerId] || 0,
    camels: counterQuantities.camels[playerId],
    fish: counterQuantities.fish[playerId],
  });

  function setOwnerBunker(value: number) {
    if (!owner) return;
    props.onAdvancedChange(owner.id, { bunkerCount: value });
    if (quickFields(owner.id).includes("bunker")) props.onCounterChange("camels", owner.id, value);
  }

  function setOwnerPenaltyArea(value: number) {
    if (!owner) return;
    props.onAdvancedChange(owner.id, { penaltyAreaCount: value });
    if (quickFields(owner.id).includes("fish")) props.onCounterChange("fish", owner.id, value);
  }

  return <div className={styles.screen}>
    <section className={styles.hero}>
      <div>
        <div className="eyebrow">{course.name}</div>
        <div className={styles.heroTitle}><h1>Hoyo {hole.number}</h1></div>
        <div className={styles.holeFacts}>
          <span>Par {hole.par}</span><span>{hole.yards ? `${hole.yards} yd` : "Yardas —"}</span><span>SI {hole.strokeIndex}</span>
          <button type="button" className={styles.gpsButton} data-state={gpsState} disabled={gpsState === "loading"} onClick={requestGps}>{gpsState === "loading" ? "GPS…" : gpsState === "ready" ? "GPS ✓" : "GPS"}</button>
        </div>
        {gpsMessage && <p className={styles.gpsStatus} role="status">{gpsMessage}</p>}
      </div>
      <div className={styles.progress}>{currentIndex + 1}<span>/{order.length}</span></div>
    </section>

    <nav className={styles.holeNav} aria-label="Hoyos de la ronda">{order.map((number, index) => <button type="button" key={number} data-active={index === currentIndex} data-done={completedHoles.has(number)} onClick={() => props.onNavigateHole(index)}>{number}</button>)}</nav>

    <div className={styles.toolbar}>
      <button type="button" className={styles.camera} aria-label="Escanear tarjeta" title="Escanear tarjeta" onClick={props.onOpenScanner}>📷</button>
      <button type="button" onClick={props.onToggleFullCard}>{props.fullCardVisible ? "Ocultar tarjeta" : "Tarjeta"}</button>
      <button type="button" onClick={props.onOpenStandings}>Cómo vamos</button>
      <button type="button" disabled={props.undoDisabled} onClick={props.onUndo}>↶ Deshacer</button>
    </div>

    <section className={`card ${styles.captureCard}`}>
      <header className={styles.modeHeader}>
        <div><h2>Captura del hoyo</h2><p>Primero score y putts. Lo demás aparece sólo cuando aporta.</p></div>
        <div className={styles.modeSwitch} role="group" aria-label="Modo de captura">
          <button type="button" data-active={mode === "quick"} aria-pressed={mode === "quick"} onClick={() => props.onModeChange("quick")}>SIN ESTADÍSTICA</button>
          <button type="button" data-active={mode === "advanced"} aria-pressed={mode === "advanced"} onClick={() => props.onModeChange("advanced")}>CON ESTADÍSTICA</button>
        </div>
      </header>

      {groupNassauLabel && <div className={styles.betContext}><b>APUESTA ACTIVA</b><span>{groupNassauLabel}</span></div>}
      {bets.ballFriend.enabled && ballFriendLabel && <div className={styles.teamContext}><b>BOLA AMIGA</b><span>{ballFriendLabel.replace(/^⚪🤝\s*/, "")}</span></div>}
      {(bets.loba.enabled || bets.ballFriend.enabled) && <div className="scoreBetQuickSetup" aria-label="Apuestas de este hoyo">
        {bets.loba.enabled && <button type="button" onClick={props.onOpenLoba}>{lobaLabel || "🐺 Elegir Loba"}</button>}
        {bets.ballFriend.enabled && <button type="button" onClick={props.onOpenBallFriend}>{ballFriendLabel || "⚪🤝 Elegir Bola Amiga"}</button>}
      </div>}

      {owner && <>
        <article className={styles.primaryPlayer}>
          <header className={styles.primaryHeader}>
            {ownerAvatarUrl ? <img className={styles.avatar} alt="" src={ownerAvatarUrl} /> : <span className={styles.avatar} aria-hidden="true">{initials(owner.name)}</span>}
            <div className={styles.playerHeading}>
              <div><b>{owner.name || "Jugador principal"}</b><small>HCP de juego {owner.handicap ?? "—"} · {teeLabel(owner.id)}</small></div>
              <span className={styles.toPar}>{scoreToParLabel(scores[owner.id], hole.par)}</span>
            </div>
          </header>
          <ScorecardHoleNetPreview player={owner} hole={hole} gross={scores[owner.id]} />

          <div className={styles.primaryControls}>
            <div className={styles.primaryControl}><span>SCORE</span><CompactStepper large label={`Score ${owner.name} hoyo ${hole.number}`} value={scores[owner.id]} fallback={hole.par} min={1} onChange={(value) => props.onScoreChange(owner.id, value)} /><button type="button" className={styles.parButton} onClick={() => props.onScoreChange(owner.id, hole.par)}>PAR</button></div>
            <div className={styles.primaryControl}><span>PUTTS</span><CompactStepper large label={`Putts ${owner.name} hoyo ${hole.number}`} value={putts[owner.id]} fallback={2} min={0} max={20} onChange={(value) => props.onPuttsChange(owner.id, value)} /></div>
          </div>

          <div className={styles.quickFacts} aria-label="Eventos rápidos del jugador principal">
            {(mode === "advanced" || quickFields(owner.id).includes("bunker")) && <TapCounter label="Bunker" icon="⛱" value={quickFields(owner.id).includes("bunker") ? countersFor(owner.id).camels : advancedStats[owner.id]?.bunkerCount} onChange={setOwnerBunker} />}
            {(mode === "advanced" || quickFields(owner.id).includes("fish")) && <TapCounter label="Agua / drop" icon="💧" value={quickFields(owner.id).includes("fish") ? countersFor(owner.id).fish : advancedStats[owner.id]?.penaltyAreaCount} onChange={setOwnerPenaltyArea} />}
            {unitParticipates(owner.id) && <div className={styles.compactField}><span>Unidades</span><SignedStepper label={`Unidades ${owner.name}`} value={unitQuantities[owner.id] || 0} onDelta={(delta) => props.onUnitDelta(owner.id, delta)} /></div>}
          </div>
          {props.playerIndicators(owner.id).length > 0 && <span className="playerHoleBetBadges">{props.playerIndicators(owner.id).map((indicator) => <i key={indicator}>{indicator}</i>)}</span>}
        </article>

        {mode === "advanced" && <OwnerStatistics player={owner} stat={advancedStats[owner.id] || {}} onChange={(patch) => props.onAdvancedChange(owner.id, patch)} />}
      </>}

      {group.length > 0 && <>
        <div className={styles.groupTitle}><div><span>JUGADORES DEL GRUPO</span><small>Sólo score y datos necesarios para las apuestas</small></div></div>
        <div className={styles.groupList}>{group.map((player) => {
          const playerFields = quickFields(player.id);
          const counters = countersFor(player.id);
          return <article className={styles.groupPlayer} key={player.id}>
            <div className={styles.groupIdentity}><div><b>{player.name || "Sin nombre"}</b><small>HCP {player.handicap ?? "—"} · {teeLabel(player.id)}</small></div><span>{scoreToParLabel(scores[player.id], hole.par)}</span></div>
            <div className={styles.groupScore}><span>SCORE</span><CompactStepper label={`Score ${player.name} hoyo ${hole.number}`} value={scores[player.id]} fallback={hole.par} min={1} onChange={(value) => props.onScoreChange(player.id, value)} /></div>
            <GroupRequiredInputs player={player} fields={playerFields} putts={putts[player.id]} counters={counters} unitsActive={unitParticipates(player.id)} units={unitQuantities[player.id] || 0} onPutts={(value) => props.onPuttsChange(player.id, value)} onCounter={(kind, value) => props.onCounterChange(kind, player.id, value)} onUnitDelta={(delta) => props.onUnitDelta(player.id, delta)} />
          </article>;
        })}</div>
      </>}
    </section>
  </div>;
}
