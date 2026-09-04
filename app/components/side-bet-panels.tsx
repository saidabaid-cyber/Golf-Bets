import type {
  BallFriendHole,
  BetConfig,
  CounterBetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  LobaHole,
  Player,
} from "../../lib/types";
import {
  COUNTER_BET_META,
  counterQuantity,
  physicalNineForHole,
  type CounterBetHalfResult,
} from "../../lib/side-bets";
import { NumericCaptureInput } from "./numeric-capture-input";
import { ResultAccordion } from "./result-accordion";

const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

function PlayerChips({ players, selected, onChange }: { players: Player[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="chips">{players.map(player => {
    const active = selected.includes(player.id);
    return <button type="button" key={player.id} className={`chipButton ${active ? "selected" : ""}`} onClick={() => onChange(active ? selected.filter(id => id !== player.id) : [...selected, player.id])}>{active ? "✓ " : ""}{player.name || "Sin nombre"}</button>;
  })}</div>;
}

export function CounterBetConfigPanel({ kind, config, players, onChange }: {
  kind: CounterBetKind;
  config: CounterBetConfig;
  players: Player[];
  onChange: (next: CounterBetConfig) => void;
}) {
  const meta = COUNTER_BET_META[kind];
  return <div className="betCard">
    <div className="betHead"><div><b>{meta.emoji} {meta.plural}</b><span>Múltiples por jugador y hoyo · liquidación por vuelta</span></div><button type="button" className={`switch ${config.enabled ? "on" : ""}`} role="switch" aria-checked={config.enabled} aria-label={`Activar ${meta.plural}`} onClick={() => onChange({ ...config, enabled: !config.enabled })}><span /></button></div>
    {config.enabled && <>
      <div className="grid2">
        <div><label>Valor {meta.singular}</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.value} onValueChange={value => onChange({ ...config, value: Math.max(0, value ?? 0) })} /></div></div>
        <div><label>H10–18</label><select value={config.secondNineMultiplier} onChange={event => onChange({ ...config, secondNineMultiplier: Math.max(1, Number(event.target.value) || 1) })}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value === 1 ? "Normal" : `${value}x`}</option>)}</select></div>
      </div>
      <label className="miniLabel">Participan</label><PlayerChips players={players} selected={config.participantIds} onChange={participantIds => onChange({ ...config, participantIds })} />
    </>}
  </div>;
}

export function LobaConfigPanel({ config, players, onChange }: {
  config: BetConfig["loba"];
  players: Player[];
  onChange: (next: typeof config) => void;
}) {
  return <div className="betCard">
    <div className="betHead"><div><b>🐺 Loba</b><span>Pareja, sola o sola anticipada · 🔥 por hoyo</span></div><button type="button" className={`switch ${config.enabled ? "on" : ""}`} role="switch" aria-checked={config.enabled} aria-label="Activar Loba" onClick={() => onChange({ ...config, enabled: !config.enabled })}><span /></button></div>
    {config.enabled && <>
      <div className="grid3">
        <div><label>Valor Loba</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.value} onValueChange={value => onChange({ ...config, value: Math.max(0, value ?? 0) })} /></div></div>
        <div><label htmlFor="loba-hcp-pct">HCP Loba %</label><NumericCaptureInput id="loba-hcp-pct" aria-label="HCP Loba %" inputMode="numeric" min={0} max={100} step={5} value={config.hcpPct ?? 100} emptyWhenZero={false} onValueChange={value => onChange({ ...config, hcpPct: Math.min(100, Math.max(0, value ?? 100)) })} /></div>
        <div><label>Unidades</label><select value={config.unitsEnabled ? "yes" : "no"} onChange={event => onChange({ ...config, unitsEnabled: event.target.value === "yes" })}><option value="no">No</option><option value="yes">Sí</option></select></div>
        {config.unitsEnabled && <div><label>Valor Unidad</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.unitValue} onValueChange={value => onChange({ ...config, unitValue: Math.max(0, value ?? 0) })} /></div></div>}
      </div>
      {config.unitsEnabled && <div className="lobaUnitToggle"><label><input type="checkbox" checked={config.duplicateUnitsByMode} onChange={event => onChange({ ...config, duplicateUnitsByMode: event.target.checked })} /> Unidades también se duplican</label><details><summary aria-label="Ayuda sobre unidades de Loba">?</summary><p>El multiplicador especial 🔥 del hoyo no modifica las unidades. Si “Unidades también se duplican” está activado, las unidades valen 1x con pareja, 2x cuando la Loba va sola y 3x cuando se declara sola anticipadamente.</p></details></div>}
      <label className="miniLabel">Participan</label><PlayerChips players={players} selected={config.participantIds} onChange={participantIds => onChange({ ...config, participantIds })} />
    </>}
  </div>;
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div className="quickCounter" aria-label={label}><button type="button" aria-label={`Restar ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button><strong aria-live="polite">{value}</strong><button type="button" aria-label={`Sumar ${label}`} onClick={() => onChange(value + 1)}>+</button></div>;
}

export function CounterBetHolePanel({ kind, config, players, events, hole, keepers, onQuantity, onKeeper }: {
  kind: CounterBetKind;
  config: CounterBetConfig;
  players: Player[];
  events: CounterBetEvent[];
  hole: number;
  keepers: CounterBetKeepers;
  onQuantity: (playerId: string, value: number) => void;
  onKeeper: (playerId: string) => void;
}) {
  if (!config.enabled) return null;
  const meta = COUNTER_BET_META[kind];
  const participants = players.filter(player => config.participantIds.includes(player.id));
  const asksKeeper = hole === 9 || hole === 18;
  const nine = physicalNineForHole(hole);
  return <section className="card compact sideEventCard">
    <div className="sectionTitle"><div><h2>{meta.emoji} {meta.plural}</h2><p>Registra todas las del hoyo.</p></div><span className="eventValue">{money(config.value * (nine === "holes_10_18" ? config.secondNineMultiplier : 1))} c/u</span></div>
    <div className="quickCounterList">{participants.map(player => {
      const quantity = counterQuantity(events, kind, hole, player.id);
      return <div key={player.id}><b>{player.name}</b><Counter label={`${meta.plural} de ${player.name}`} value={quantity} onChange={value => onQuantity(player.id, value)} /></div>;
    })}</div>
    {asksKeeper && <label className="keeperSelect">¿Quién se quedó {meta.article} {meta.emoji} {meta.plural} de la {hole === 9 ? "primera" : "segunda"} vuelta?<select value={keepers[kind]?.[nine] || ""} onChange={event => onKeeper(event.target.value)}><option value="">Seleccionar…</option>{participants.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
  </section>;
}

export function LobaHolePanel({ config, players, hole, capture, liveDetail, onChange, showValidation = false }: {
  config: BetConfig["loba"];
  players: Player[];
  hole: number;
  capture: LobaHole;
  liveDetail?: {
    lobaTeam: string[];
    opponents: string[];
    effectiveValue: number;
    effectiveUnitValue: number;
    fireMultiplier: number;
    multiplier: number;
    winner: "loba_team" | "opponents" | "tie";
    lobaBestNet: number;
    opponentBestNet: number;
    playerUnits: Record<string, { automatic: number; manual: number; total: number }>;
    lobaAutomaticUnits: number;
    lobaManualUnits: number;
    opponentAutomaticUnits: number;
    opponentManualUnits: number;
    lobaUnits: number;
    opponentUnits: number;
    balances: Record<string, number>;
  };
  onChange: (next: LobaHole) => void;
  showValidation?: boolean;
}) {
  if (!config.enabled) return null;
  const participants = players.filter(player => config.participantIds.includes(player.id));
  const rivals = participants.filter(player => player.id !== capture.lobaPlayerId);
  const setUnit = (playerId: string, value: number) => onChange({ ...capture, unitCounts: { ...capture.unitCounts, [playerId]: Math.max(0, value) } });
  const modeMultiplier = capture.mode === "solo" ? 2 : capture.mode === "solo_anticipated" ? 3 : 1;
  const effective = config.value * Math.max(1, capture.fireMultiplier || 1) * modeMultiplier;
  const configurationComplete = Boolean(
    capture.lobaPlayerId &&
    capture.mode &&
    Number.isFinite(capture.fireMultiplier) &&
    capture.fireMultiplier >= 1 &&
    (capture.mode !== "partner" || (capture.partnerId && capture.partnerId !== capture.lobaPlayerId)),
  );
  const lobaPlayer = participants.find(player => player.id === capture.lobaPlayerId);
  const partner = participants.find(player => player.id === capture.partnerId);
  const lobaTeam = capture.mode === "partner" ? [capture.lobaPlayerId, capture.partnerId].filter(Boolean) : [capture.lobaPlayerId].filter(Boolean);
  const opponents = participants.filter(player => !lobaTeam.includes(player.id));
  return <section className="card compact lobaCapture">
    <div className="sectionTitle"><div><h2>🐺 Loba · H{hole}</h2><p>Completa la jugada antes de avanzar.</p></div><b>{money(effective)}</b></div>
    <div className="lobaCaptureGrid">
      <label>Quién es la Loba<select value={capture.lobaPlayerId || ""} onChange={event => onChange({ ...capture, lobaPlayerId: event.target.value || undefined, partnerId: undefined })}><option value="">Seleccionar…</option>{participants.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
      <label>Modalidad<select value={capture.mode || ""} onChange={event => onChange({ ...capture, mode: event.target.value as LobaHole["mode"], partnerId: undefined })}><option value="">Seleccionar…</option><option value="partner">Con pareja · 1x</option><option value="solo">Sola · 2x</option><option value="solo_anticipated">Sola anticipada · 3x</option></select></label>
      {capture.mode === "partner" && <label>Pareja<select value={capture.partnerId || ""} onChange={event => onChange({ ...capture, partnerId: event.target.value || undefined })}><option value="">Seleccionar…</option>{rivals.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
      <div className="lobaFireField"><label>🔥 Multiplicador del hoyo<NumericCaptureInput inputMode="numeric" min={1} max={99} step={1} value={capture.fireMultiplier} emptyWhenZero={false} onValueChange={value => onChange({ ...capture, fireMultiplier: Math.max(1, Math.trunc(value ?? 1)) })} /></label><details><summary aria-label="Ayuda sobre multiplicador del hoyo de Loba">?</summary><p>El 🔥 multiplica únicamente el valor base de Loba. Con base $100 y 🔥5x: pareja $500, sola $1,000 y sola anticipada $1,500. No multiplica las Unidades.</p></details></div>
    </div>
    {lobaPlayer && <div className="holeBetSetupSummary" aria-live="polite">
      <strong>🐺 Loba: {lobaPlayer.name}{capture.mode === "solo" ? " · Va sola 2x" : capture.mode === "solo_anticipated" ? " · Sola anticipada 3x" : ""}</strong>
      {capture.mode === "partner" && partner && <span>Pareja: {partner.name}</span>}
      {opponents.length > 0 && <span>Contrarios: {opponents.map(player => player.name).join(" + ")}</span>}
      {capture.mode === "partner" && partner && <span>Modalidad: Con pareja · 🔥{Math.max(1, capture.fireMultiplier || 1)}x</span>}
    </div>}
    {config.unitsEnabled && <><div className="miniLabel">📏 Unidades naturales + manuales · pertenecen a su equipo</div><div className="quickCounterList lobaUnitPlayers">{participants.map(player => {
      const unitDetail = liveDetail?.playerUnits[player.id];
      const manual = capture.unitCounts[player.id] || 0;
      return <div key={player.id}><span><b>{player.name}</b><small>{unitDetail ? `Auto +${unitDetail.automatic} · Manual +${unitDetail.manual} · Total +${unitDetail.total}` : `Auto — · Manual +${manual} · Total pendiente`}</small></span><Counter label={`Unidades manuales o especiales de Loba de ${player.name}`} value={manual} onChange={value => setUnit(player.id, value)} /></div>;
    })}</div></>}
    {liveDetail ? <div className="lobaLive" aria-live="polite">
      <b>Estado vivo · HCP {config.hcpPct ?? 100}%</b>
      <div className="lobaLiveTeams"><span><strong>🐺 {liveDetail.lobaTeam.map(id => players.find(player => player.id === id)?.name || id).join(" + ")}</strong><small>Mejor neto: {liveDetail.lobaBestNet}</small></span><i>vs</i><span><strong>{liveDetail.opponents.map(id => players.find(player => player.id === id)?.name || id).join(" + ")}</strong><small>Mejor neto: {liveDetail.opponentBestNet}</small></span></div>
      <small>🔥 {liveDetail.fireMultiplier}x · {capture.mode === "partner" ? "Pareja 1x" : capture.mode === "solo" ? "Solo 2x" : "Solo anticipado 3x"} · Valor hoyo {money(liveDetail.effectiveValue)}</small>
      <strong>{liveDetail.winner === "tie" ? "Resultado: Empate" : liveDetail.winner === "loba_team" ? "Resultado: Equipo 🐺 gana" : "Resultado: Contrarios ganan"}</strong>
      {config.unitsEnabled && <small>📏 Equipos: {liveDetail.lobaUnits} vs {liveDetail.opponentUnits} · 🐺 Auto {liveDetail.lobaAutomaticUnits} + Manual {liveDetail.lobaManualUnits} · Contrarios Auto {liveDetail.opponentAutomaticUnits} + Manual {liveDetail.opponentManualUnits} · valor efectivo {money(liveDetail.effectiveUnitValue)}</small>}
      <div>{Object.entries(liveDetail.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{players.find(player => player.id === id)?.name || id} <strong className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</strong></span>)}</div>
    </div> : <div className="scoreGate" role="status">{configurationComplete ? "Esperando scores." : "Completa quién es la Loba, su modalidad y pareja cuando aplique."} El resultado se calculará automáticamente.</div>}
    {showValidation && !configurationComplete && <p className="holeBetInlineError" role="alert">Completa la configuración de Loba antes de guardar.</p>}
  </section>;
}

export function BallFriendHolePanel({ config, players, hole, capture, liveDetail, onChange, showValidation = false }: {
  config: BetConfig["ballFriend"];
  players: Player[];
  hole: number;
  capture: BallFriendHole;
  liveDetail?: {
    teamA: [string, string];
    teamB: [string, string];
    restPlayerId?: string;
    numberA: number;
    numberB: number;
    pointDiff: number;
    birdieOrBetterA: boolean;
    birdieOrBetterB: boolean;
  };
  onChange: (next: BallFriendHole) => void;
  showValidation?: boolean;
}) {
  if (!config.enabled) return null;
  const participants = players.filter(player => config.participantIds.includes(player.id));
  const activeIds = participants.map(player => player.id).filter(id => id !== capture.restPlayerId);
  const teamA = capture.teamA.filter(id => activeIds.includes(id));
  const teamB = activeIds.filter(id => !teamA.includes(id));
  const complete = (participants.length !== 5 || Boolean(capture.restPlayerId)) && teamA.length === 2 && teamB.length === 2;
  const name = (id?: string) => players.find(player => player.id === id)?.name || "Sin nombre";

  const selectRest = (playerId: string) => {
    onChange({ restPlayerId: playerId, teamA: capture.teamA.filter(id => id !== playerId) });
  };
  const toggleTeamA = (playerId: string) => {
    const selected = capture.teamA.includes(playerId);
    const team = selected
      ? capture.teamA.filter(id => id !== playerId)
      : capture.teamA.length < 2 ? [...capture.teamA, playerId] : [capture.teamA[1], playerId];
    onChange({ ...capture, teamA: team });
  };

  return <section className="card compact ballFriendCapture">
    <div className="sectionTitle"><div><h2>⚪🤝 Bola Amiga · H{hole}</h2><p>Elige descanso (si son 5) y la primera pareja; la segunda sale sola.</p></div></div>
    {participants.length === 5 && <><label className="miniLabel">Descansa</label><div className="chips">{participants.map(player => <button type="button" key={player.id} className={`chipButton ${capture.restPlayerId === player.id ? "resting" : ""}`} onClick={() => selectRest(player.id)}>{player.name}</button>)}</div></>}
    <label className="miniLabel">Primera pareja</label>
    <div className="chips">{participants.filter(player => player.id !== capture.restPlayerId).map(player => <button type="button" key={player.id} className={`chipButton ${capture.teamA.includes(player.id) ? "selected" : ""}`} onClick={() => toggleTeamA(player.id)}>{player.name}</button>)}</div>
    {complete && <div className="holeBetSetupSummary" aria-live="polite">
      <strong>{name(teamA[0])} + {name(teamA[1])} <span>VS</span> {name(teamB[0])} + {name(teamB[1])}</strong>
      {capture.restPlayerId && <span>Descansa: {name(capture.restPlayerId)}</span>}
    </div>}
    {liveDetail ? <div className="ballResult" aria-live="polite"><span>{liveDetail.numberA.toFixed(1).replace(".0", "")} vs {liveDetail.numberB.toFixed(1).replace(".0", "")}</span><b className={liveDetail.pointDiff >= 0 ? "good" : "bad"}>{liveDetail.pointDiff >= 0 ? "+" : ""}{liveDetail.pointDiff.toFixed(1).replace(".0", "")} puntos equipo 1</b>{(liveDetail.birdieOrBetterA || liveDetail.birdieOrBetterB) && <small>🐦 Birdie o mejor: se volteó el score contrario.</small>}</div> : <div className="scoreGate" role="status">{complete ? "Esperando scores. El resultado aparecerá aquí." : "Completa descanso y parejas antes de guardar."}</div>}
    {showValidation && !complete && <p className="holeBetInlineError" role="alert">Completa la configuración de Bola Amiga antes de guardar.</p>}
  </section>;
}

export function CounterBetResults({ title, halves, playerName }: { title: string; halves: CounterBetHalfResult[]; playerName: (id?: string) => string }) {
  const id = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return <ResultAccordion id={id} title={title} className="sideBetResult">{halves.filter(half => half.holes.length).map(half => <div className="sideBetHalf" key={half.nine}><div><b>{half.nine === "holes_1_9" ? "H1–9" : "H10–18"}</b><span>{half.quantity} jugadas · {money(half.value)} c/u{half.multiplier > 1 ? ` · ${half.multiplier}x` : ""}</span></div><strong>{half.keeperId ? `${playerName(half.keeperId)} se quedó` : "Pendiente"}</strong>{half.settled && <div className="sideBetBalances">{Object.entries(half.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</b></span>)}</div>}</div>)}</ResultAccordion>;
}
