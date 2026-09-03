import type {
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
  config: { enabled: boolean; value: number; unitsEnabled: boolean; unitValue: number; duplicateUnitsByMode: boolean; participantIds: string[] };
  players: Player[];
  onChange: (next: typeof config) => void;
}) {
  return <div className="betCard">
    <div className="betHead"><div><b>🐺 Loba</b><span>Pareja, sola o sola anticipada · 🔥 por hoyo</span></div><button type="button" className={`switch ${config.enabled ? "on" : ""}`} role="switch" aria-checked={config.enabled} aria-label="Activar Loba" onClick={() => onChange({ ...config, enabled: !config.enabled })}><span /></button></div>
    {config.enabled && <>
      <div className="grid3">
        <div><label>Valor Loba</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.value} onValueChange={value => onChange({ ...config, value: Math.max(0, value ?? 0) })} /></div></div>
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
    {asksKeeper && <label className="keeperSelect">¿Quién se quedó las {meta.emoji} {meta.plural} de la {hole === 9 ? "primera" : "segunda"} vuelta?<select value={keepers[kind]?.[nine] || ""} onChange={event => onKeeper(event.target.value)}><option value="">Seleccionar…</option>{participants.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
  </section>;
}

export function LobaHolePanel({ config, players, hole, capture, liveDetail, onChange }: {
  config: { enabled: boolean; value: number; unitsEnabled: boolean; unitValue: number; duplicateUnitsByMode: boolean; participantIds: string[] };
  players: Player[];
  hole: number;
  capture: LobaHole;
  liveDetail?: {
    lobaTeam: string[];
    opponents: string[];
    effectiveValue: number;
    lobaUnits: number;
    opponentUnits: number;
    balances: Record<string, number>;
  };
  onChange: (next: LobaHole) => void;
}) {
  if (!config.enabled) return null;
  const participants = players.filter(player => config.participantIds.includes(player.id));
  const rivals = participants.filter(player => player.id !== capture.lobaPlayerId);
  const setUnit = (playerId: string, value: number) => onChange({ ...capture, unitCounts: { ...capture.unitCounts, [playerId]: Math.max(0, value) } });
  const modeMultiplier = capture.mode === "solo" ? 2 : capture.mode === "solo_anticipated" ? 3 : 1;
  const effective = config.value * Math.max(1, capture.fireMultiplier || 1) * modeMultiplier;
  return <section className="card compact lobaCapture">
    <div className="sectionTitle"><div><h2>🐺 Loba · H{hole}</h2><p>Completa la jugada antes de avanzar.</p></div><b>{money(effective)}</b></div>
    <div className="lobaCaptureGrid">
      <label>Quién es la Loba<select value={capture.lobaPlayerId || ""} onChange={event => onChange({ ...capture, lobaPlayerId: event.target.value || undefined, partnerId: undefined })}><option value="">Seleccionar…</option>{participants.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
      <label>Modalidad<select value={capture.mode || ""} onChange={event => onChange({ ...capture, mode: event.target.value as LobaHole["mode"], partnerId: undefined })}><option value="">Seleccionar…</option><option value="partner">Con pareja · 1x</option><option value="solo">Sola · 2x</option><option value="solo_anticipated">Sola anticipada · 3x</option></select></label>
      {capture.mode === "partner" && <label>Pareja<select value={capture.partnerId || ""} onChange={event => onChange({ ...capture, partnerId: event.target.value || undefined })}><option value="">Seleccionar…</option>{rivals.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
      <label>🔥 Multiplicador<NumericCaptureInput inputMode="numeric" min={1} max={99} step={1} value={capture.fireMultiplier} emptyWhenZero={false} onValueChange={value => onChange({ ...capture, fireMultiplier: Math.max(1, Math.trunc(value ?? 1)) })} /></label>
    </div>
    <fieldset className="lobaOutcome"><legend>Resultado del hoyo</legend><div className="segmented">{([['loba_team', 'Ganó Loba'], ['opponents', 'Ganaron rivales'], ['tie', 'Empate']] as const).map(([value, label]) => <button type="button" key={value} className={capture.winner === value ? "active" : ""} onClick={() => onChange({ ...capture, winner: value })}>{label}</button>)}</div></fieldset>
    {config.unitsEnabled && <><div className="miniLabel">📏 Unidades por jugador · pertenecen a su equipo</div><div className="quickCounterList">{participants.map(player => <div key={player.id}><b>{player.name}</b><Counter label={`Unidades Loba de ${player.name}`} value={capture.unitCounts[player.id] || 0} onChange={value => setUnit(player.id, value)} /></div>)}</div></>}
    {liveDetail && <div className="lobaLive" aria-live="polite"><b>Estado vivo</b><span>{liveDetail.lobaTeam.map(id => players.find(player => player.id === id)?.name || id).join(" + ")} vs {liveDetail.opponents.map(id => players.find(player => player.id === id)?.name || id).join(" + ")}</span><small>Base efectiva {money(liveDetail.effectiveValue)}{config.unitsEnabled ? ` · Unidades ${liveDetail.lobaUnits} vs ${liveDetail.opponentUnits}` : ""}</small><div>{Object.entries(liveDetail.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{players.find(player => player.id === id)?.name || id} <strong className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</strong></span>)}</div></div>}
  </section>;
}

export function CounterBetResults({ title, halves, playerName }: { title: string; halves: CounterBetHalfResult[]; playerName: (id?: string) => string }) {
  return <details className="card sideBetResult"><summary>{title}</summary>{halves.filter(half => half.holes.length).map(half => <div className="sideBetHalf" key={half.nine}><div><b>{half.nine === "holes_1_9" ? "H1–9" : "H10–18"}</b><span>{half.quantity} jugadas · {money(half.value)} c/u{half.multiplier > 1 ? ` · ${half.multiplier}x` : ""}</span></div><strong>{half.keeperId ? `${playerName(half.keeperId)} se quedó` : "Pendiente"}</strong>{half.settled && <div className="sideBetBalances">{Object.entries(half.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</b></span>)}</div>}</div>)}</details>;
}
