"use client";

import { useState } from "react";
import type {
  AdvancedHoleStat,
  BetConfig,
  Course,
  CounterBetKind,
  Hole,
  Player,
  ScoreCaptureMode,
  SupplementalBet,
} from "../../lib/types";
import { haversineDistanceKm, isValidGeographicPoint } from "../../lib/course-distance";
import { roundCaptureFieldsForPlayer, scoreToParLabel } from "../../lib/round-capture";
import { NumericCaptureInput } from "./numeric-capture-input";
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
  ownerId: string;
  ownerAvatarUrl?: string;
  mode: ScoreCaptureMode;
  bets: Pick<BetConfig, "vipers" | "camels" | "fish" | "loba" | "ballFriend">;
  supplementalBets: SupplementalBet[];
  scores: Record<string, number | null | undefined>;
  putts: Record<string, number | null | undefined>;
  advancedStats: Record<string, AdvancedHoleStat | undefined>;
  counterQuantities: CounterQuantities;
  groupNassauLabel?: string;
  ballFriendLabel?: string;
  lobaLabel?: string;
  playerIndicators: (playerId: string) => string[];
  onNavigateHole: (index: number) => void;
  onModeChange: (mode: ScoreCaptureMode) => void;
  onScoreChange: (playerId: string, value: number | null) => void;
  onScoreDelta: (playerId: string, delta: number) => void;
  onPuttsChange: (playerId: string, value: number | null) => void;
  onCounterChange: (kind: CounterBetKind, playerId: string, value: number | null) => void;
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

function DynamicInputs({ player, fields, putts, counters, onPutts, onCounter }: {
  player: Player;
  fields: ReturnType<typeof roundCaptureFieldsForPlayer>;
  putts: number | null | undefined;
  counters: Record<CounterBetKind, number | undefined>;
  onPutts: (value: number | null) => void;
  onCounter: (kind: CounterBetKind, value: number | null) => void;
}) {
  if (!fields.length) return null;
  return <div className={styles.dynamicFields}>
    {fields.includes("putts") && <label>Putts<NumericCaptureInput aria-label={`Putts ${player.name}`} min={0} max={20} step={1} value={putts} emptyWhenZero={false} placeholder="—" onValueChange={onPutts} /></label>}
    {fields.includes("bunker") && <label>Bnk<NumericCaptureInput aria-label={`Bunker ${player.name}`} min={0} max={20} step={1} value={counters.camels} emptyWhenZero={false} placeholder="—" onValueChange={(value) => onCounter("camels", value)} /></label>}
    {fields.includes("fish") && <label>Pez · agua<NumericCaptureInput aria-label={`Peces por agua de ${player.name}`} min={0} max={20} step={1} value={counters.fish} emptyWhenZero={false} placeholder="—" onValueChange={(value) => onCounter("fish", value)} /></label>}
  </div>;
}

function BinaryChoice({ label, value, onChange }: { label: string; value?: boolean; onChange: (value: boolean | undefined) => void }) {
  return <div><label>{label}</label><div className={styles.binary}>
    <button type="button" data-active={value === true} aria-pressed={value === true} onClick={() => onChange(value === true ? undefined : true)}>Sí</button>
    <button type="button" data-active={value === false} aria-pressed={value === false} onClick={() => onChange(value === false ? undefined : false)}>No</button>
  </div></div>;
}

function AdvancedPlayer({ player, stat, onChange }: { player: Player; stat: AdvancedHoleStat; onChange: (patch: Partial<AdvancedHoleStat>) => void }) {
  return <details className={styles.advancedPlayer}>
    <summary>{player.name} · estadísticas opcionales</summary>
    <div className={styles.advancedGrid}>
      <label>Dirección de salida<select value={stat.teeDirection || ""} onChange={(event) => onChange({ teeDirection: (event.target.value || undefined) as AdvancedHoleStat["teeDirection"] })}><option value="">Sin capturar</option><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
      <label>Lie de llegada<select value={stat.landingLie || ""} onChange={(event) => onChange({ landingLie: (event.target.value || undefined) as AdvancedHoleStat["landingLie"] })}><option value="">Sin capturar</option><option value="fairway">Fairway</option><option value="rough">Rough</option><option value="bunker">Bunker</option><option value="water_ob">Agua / OB</option></select></label>
      <label>Palo de salida<input value={stat.teeClub || ""} maxLength={40} placeholder="Driver" onChange={(event) => onChange({ teeClub: event.target.value.trimStart() || undefined })} /></label>
      <label>Distancia<NumericCaptureInput aria-label={`Distancia de salida ${player.name}`} min={0} max={600} step={1} value={stat.teeDistance} emptyWhenZero={false} placeholder="yd" onValueChange={(value) => onChange({ teeDistance: value === null ? undefined : value })} /></label>
      <BinaryChoice label="Fairway" value={stat.fairwayHit} onChange={(fairwayHit) => onChange({ fairwayHit })} />
      <BinaryChoice label="Green en regulación" value={stat.greenInRegulation} onChange={(greenInRegulation) => onChange({ greenInRegulation })} />
      <label>Penalidades<NumericCaptureInput aria-label={`Golpes de penalidad ${player.name}`} min={0} max={50} step={1} value={stat.penaltyStrokes} emptyWhenZero={false} placeholder="—" onValueChange={(value) => onChange({ penaltyStrokes: value === null ? undefined : Math.max(0, Math.trunc(value)) })} /></label>
      <BinaryChoice label="Fuera de límites" value={stat.outOfBounds} onChange={(outOfBounds) => onChange({ outOfBounds })} />
    </div>
  </details>;
}

export function RoundCaptureV2(props: RoundCaptureV2Props) {
  const {
    course, hole, order, currentIndex, completedHoles, players, ownerId, ownerAvatarUrl, mode, bets,
    supplementalBets, scores, putts, advancedStats, counterQuantities, groupNassauLabel, ballFriendLabel, lobaLabel,
  } = props;
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const owner = players.find((player) => player.id === ownerId) || players[0];
  const group = players.filter((player) => player.id !== owner?.id);
  const fields = (playerId: string) => roundCaptureFieldsForPlayer({ mode, playerId, playedHoleIndex: currentIndex, bets, supplementalBets });
  const allGroupFields = new Set(group.flatMap((player) => fields(player.id)));

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

  return <div className={styles.screen}>
    <section className={styles.hero}>
      <div>
        <div className="eyebrow">{course.name} · {course.teeName}</div>
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
      <button type="button" onClick={props.onToggleFullCard}>{props.fullCardVisible ? "Ocultar tarjeta" : "Tarjeta completa"}</button>
      <button type="button" onClick={props.onOpenStandings}>Cómo vamos</button>
      <button type="button" disabled={props.undoDisabled} onClick={props.onUndo}>↶ Deshacer</button>
    </div>

    <section className={`card ${styles.captureCard}`}>
      <header className={styles.modeHeader}>
        <div><h2>Captura del hoyo</h2><p>En Rápida sólo aparecen datos que necesita una apuesta activa.</p></div>
        <div className={styles.modeSwitch} role="group" aria-label="Modo de captura">
          <button type="button" data-active={mode === "quick"} aria-pressed={mode === "quick"} onClick={() => props.onModeChange("quick")}>RÁPIDA</button>
          <button type="button" data-active={mode === "advanced"} aria-pressed={mode === "advanced"} onClick={() => props.onModeChange("advanced")}>ESTADÍSTICAS</button>
        </div>
      </header>

      {groupNassauLabel && <div className={styles.betContext}><b>APUESTA ACTIVA</b><span>{groupNassauLabel}</span></div>}
      {bets.ballFriend.enabled && ballFriendLabel && <div className={styles.teamContext}><b>BOLA AMIGA</b><span>{ballFriendLabel.replace(/^⚪🤝\s*/, "")}</span></div>}
      {(bets.loba.enabled || bets.ballFriend.enabled) && <div className="scoreBetQuickSetup" aria-label="Apuestas de este hoyo">
        {bets.loba.enabled && <button type="button" onClick={props.onOpenLoba}>{lobaLabel || "🐺 Elegir Loba"}</button>}
        {bets.ballFriend.enabled && <button type="button" onClick={props.onOpenBallFriend}>{ballFriendLabel || "⚪🤝 Elegir Bola Amiga"}</button>}
      </div>}

      {owner && <article className={styles.primaryPlayer}>
        {ownerAvatarUrl ? <img className={styles.avatar} alt="" src={ownerAvatarUrl} /> : <span className={styles.avatar} aria-hidden="true">{initials(owner.name)}</span>}
        <div>
          <div className={styles.playerHeading}>
            <div><b>{owner.name || "Jugador principal"}</b><small>HCP {owner.handicap ?? "—"} · Jugador principal</small></div>
            <span className={styles.toPar}>{scoreToParLabel(scores[owner.id], hole.par)}</span>
          </div>
          <ScorecardHoleNetPreview player={owner} hole={hole} gross={scores[owner.id]} />
          <div className={styles.mainScore}>
            <button type="button" aria-label={`Restar golpe a ${owner.name}`} onClick={() => props.onScoreDelta(owner.id, -1)}>−</button>
            <NumericCaptureInput aria-label={`Score ${owner.name} hoyo ${hole.number}`} min={1} step={1} value={scores[owner.id]} emptyWhenZero={false} commitUnchanged placeholder={String(hole.par)} onValueChange={(value) => props.onScoreChange(owner.id, value)} />
            <button type="button" aria-label={`Sumar golpe a ${owner.name}`} onClick={() => props.onScoreDelta(owner.id, 1)}>+</button>
            <button type="button" className={styles.par} onClick={() => props.onScoreChange(owner.id, hole.par)}>PAR</button>
          </div>
          {props.playerIndicators(owner.id).length > 0 && <span className="playerHoleBetBadges">{props.playerIndicators(owner.id).map((indicator) => <i key={indicator}>{indicator}</i>)}</span>}
        </div>
        <DynamicInputs player={owner} fields={fields(owner.id)} putts={putts[owner.id]} counters={countersFor(owner.id)} onPutts={(value) => props.onPuttsChange(owner.id, value)} onCounter={(kind, value) => props.onCounterChange(kind, owner.id, value)} />
      </article>}

      {group.length > 0 && <>
        <h3 className={styles.groupTitle}>JUGADORES DEL GRUPO</h3>
        <div className={styles.groupTableWrap}><table className={styles.groupTable}>
          <thead><tr><th>Jugador</th><th>Score</th>{allGroupFields.has("putts") && <th>Putts</th>}{allGroupFields.has("bunker") && <th>Bnk</th>}{allGroupFields.has("fish") && <th>Pez</th>}</tr></thead>
          <tbody>{group.map((player) => {
            const playerFields = fields(player.id);
            const counters = countersFor(player.id);
            return <tr key={player.id}>
              <td className={styles.groupName}><b>{player.name || "Sin nombre"}</b><small>HCP {player.handicap ?? "—"} · {scoreToParLabel(scores[player.id], hole.par)}</small></td>
              <td><NumericCaptureInput aria-label={`Score ${player.name} hoyo ${hole.number}`} min={1} step={1} value={scores[player.id]} emptyWhenZero={false} commitUnchanged placeholder={String(hole.par)} onValueChange={(value) => props.onScoreChange(player.id, value)} /></td>
              {allGroupFields.has("putts") && <td>{playerFields.includes("putts") ? <NumericCaptureInput aria-label={`Putts ${player.name} hoyo ${hole.number}`} min={0} max={20} step={1} value={putts[player.id]} emptyWhenZero={false} placeholder="—" onValueChange={(value) => props.onPuttsChange(player.id, value)} /> : "—"}</td>}
              {allGroupFields.has("bunker") && <td>{playerFields.includes("bunker") ? <NumericCaptureInput aria-label={`Bunker ${player.name} hoyo ${hole.number}`} min={0} max={20} step={1} value={counters.camels} emptyWhenZero={false} placeholder="—" onValueChange={(value) => props.onCounterChange("camels", player.id, value)} /> : "—"}</td>}
              {allGroupFields.has("fish") && <td>{playerFields.includes("fish") ? <NumericCaptureInput aria-label={`Peces por agua de ${player.name} hoyo ${hole.number}`} min={0} max={20} step={1} value={counters.fish} emptyWhenZero={false} placeholder="—" onValueChange={(value) => props.onCounterChange("fish", player.id, value)} /> : "—"}</td>}
            </tr>;
          })}</tbody>
        </table></div>
      </>}

      {mode === "advanced" && <div className={styles.advancedList}>{players.map((player) => <AdvancedPlayer key={player.id} player={player} stat={advancedStats[player.id] || {}} onChange={(patch) => props.onAdvancedChange(player.id, patch)} />)}</div>}
    </section>
  </div>;
}
