import type {
  BallFriendHole,
  BetConfig,
  CounterBetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  CounterBetPeriod,
  LobaHole,
  Player,
} from "../../lib/types";
import {
  COUNTER_BET_META,
  counterBetConfiguredSecondNineMultiplier,
  counterBetEffectiveUnitValue,
  counterBetSecondNinePressed,
  counterQuantity,
  latestCounterBetCandidates,
  type CounterBetHalfResult,
} from "../../lib/side-bets";
import { physicalNineForPlayedHalf, playedHalfLabel, roundHalfForHole, roundHalfHoles } from "../../lib/round-half";
import { NumericCaptureInput } from "./numeric-capture-input";
import { ResultAccordion } from "./result-accordion";
import { SetupBetCard } from "./setup-bet-card";
import { BET_PRESENTATION, betDisplayLabel } from "../../lib/bet-catalog";

const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

function PlayerChips({ players, selected, onChange }: { players: Player[]; selected: string[] | undefined; onChange: (ids: string[]) => void }) {
  const selectedIds = Array.isArray(selected) ? selected : [];
  return <div className="chips">{players.map(player => {
    const active = selectedIds.includes(player.id);
    return <button type="button" key={player.id} className={`chipButton ${active ? "selected" : ""}`} onClick={() => onChange(active ? selectedIds.filter(id => id !== player.id) : [...selectedIds, player.id])}>{active ? "✓ " : ""}{player.name || "Sin nombre"}</button>;
  })}</div>;
}

export function CounterBetConfigPanel({ kind, config, players, onChange, requestActivation, locked = false }: {
  kind: CounterBetKind;
  config: CounterBetConfig;
  players: Player[];
  onChange: (next: CounterBetConfig) => void;
  requestActivation?: () => Promise<boolean>;
  locked?: boolean;
}) {
  const meta = COUNTER_BET_META[kind];
  const description = kind === "vipers"
    ? "3 putts · el último jugador que la tenga paga"
    : kind === "camels"
      ? "Bunker · el último jugador paga la bolsa"
      : "Agua · el último jugador paga la bolsa";
  const presentation = BET_PRESENTATION[kind];
  const secondNinePressed = counterBetSecondNinePressed(config);
  const configuredMultiplier = counterBetConfiguredSecondNineMultiplier(config);
  return <SetupBetCard id={kind} icon={presentation.icon} title={presentation.title} description={description} help={kind} enabled={config.enabled} locked={locked} requestActivation={requestActivation} onEnabledChange={(enabled) => onChange({ ...config, enabled })}>
    <>
      <div className="grid2 counterBetConfigGrid">
        <div><label>Valor por evento</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.value} onValueChange={value => onChange({ ...config, value: Math.max(0, value ?? 0) })} /></div></div>
        <div className="betModeControl counterBetPressure"><span className="miniLabel">Presión en segunda vuelta</span><div className="segmented" role="group" aria-label={`Presión en segunda vuelta de ${meta.plural}`}><button type="button" className={!secondNinePressed ? "active" : ""} aria-pressed={!secondNinePressed} onClick={() => onChange({ ...config, settlementMode: "halves", secondNinePressed: false })}>No</button><button type="button" className={secondNinePressed ? "active" : ""} aria-pressed={secondNinePressed} onClick={() => onChange({ ...config, settlementMode: "halves", secondNinePressed: true, secondNineMultiplier: configuredMultiplier })}>Sí</button></div></div>
      </div>
      {secondNinePressed && <div className="betModeControl counterBetMultiplier"><span className="miniLabel">Multiplicador segunda vuelta</span><div className="segmented" role="group" aria-label={`Multiplicador segunda vuelta de ${meta.plural}`}>{([2, 3, 4, 5] as const).map(value => <button type="button" key={value} className={configuredMultiplier === value ? "active" : ""} aria-pressed={configuredMultiplier === value} onClick={() => onChange({ ...config, settlementMode: "halves", secondNinePressed: true, secondNineMultiplier: value })}>{value}x</button>)}</div></div>}
      <p className="hint">La primera y segunda vuelta jugadas se liquidan por separado. {secondNinePressed ? `La segunda vuelta jugada usa ${configuredMultiplier}x por evento.` : "Sin presión, ambas vueltas usan el valor base."}</p>
      <label className="miniLabel">Participan</label><PlayerChips players={players} selected={config.participantIds} onChange={participantIds => onChange({ ...config, participantIds })} />
    </>
  </SetupBetCard>;
}

export function LobaConfigPanel({ config, players, onChange, requestActivation, locked = false }: {
  config: BetConfig["loba"];
  players: Player[];
  onChange: (next: typeof config) => void;
  requestActivation?: () => Promise<boolean>;
  locked?: boolean;
}) {
  return <SetupBetCard id="loba" icon={BET_PRESENTATION.loba.icon} title={BET_PRESENTATION.loba.title} description="El Lobo elige pareja o juega solo" help="loba" enabled={config.enabled} locked={locked} requestActivation={requestActivation} onEnabledChange={(enabled) => onChange({ ...config, enabled })}>
    <>
      <div className="grid3">
        <div><label>Valor Loba</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.value} onValueChange={value => onChange({ ...config, value: Math.max(0, value ?? 0) })} /></div></div>
        <div><label htmlFor="loba-hcp-pct">HCP Loba %</label><NumericCaptureInput id="loba-hcp-pct" aria-label="HCP Loba %" inputMode="numeric" min={0} max={100} step={5} value={config.hcpPct ?? 100} emptyWhenZero={false} onValueChange={value => onChange({ ...config, hcpPct: Math.min(100, Math.max(0, value ?? 100)) })} /></div>
        <div><label>Unidades</label><select value={config.unitsEnabled ? "yes" : "no"} onChange={event => onChange({ ...config, unitsEnabled: event.target.value === "yes" })}><option value="no">No</option><option value="yes">Sí</option></select></div>
        {config.unitsEnabled && <div><label>Valor Unidad</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={config.unitValue} onValueChange={value => onChange({ ...config, unitValue: Math.max(0, value ?? 0) })} /></div></div>}
      </div>
      {config.unitsEnabled && <div className="lobaUnitToggle"><label><input type="checkbox" checked={config.duplicateUnitsByMode} onChange={event => onChange({ ...config, duplicateUnitsByMode: event.target.checked })} /> Unidades también se duplican</label><details><summary aria-label="Ayuda sobre unidades de Loba">?</summary><p>El multiplicador especial 🔥 del hoyo no modifica las unidades. Si “Unidades también se duplican” está activado, las unidades valen 1x con pareja, 2x cuando la Loba va sola y 3x cuando se declara sola anticipadamente.</p></details></div>}
      <label className="miniLabel">Participan</label><PlayerChips players={players} selected={config.participantIds} onChange={participantIds => onChange({ ...config, participantIds })} />
    </>
  </SetupBetCard>;
}

function Counter({ label, value, onChange, max }: { label: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <div className="quickCounter" aria-label={label}><button type="button" aria-label={`Restar ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button><strong aria-live="polite">{value}</strong><button type="button" aria-label={`Sumar ${label}`} onClick={() => onChange(Math.min(max ?? Number.POSITIVE_INFINITY, value + 1))}>+</button></div>;
}

export function CounterBetHolePanel({ kind, config, players, events, hole, order, keepers, onQuantity, onDistance, onKeeper }: {
  kind: CounterBetKind;
  config: CounterBetConfig;
  players: Player[];
  events: CounterBetEvent[];
  hole: number;
  order: number[];
  keepers: CounterBetKeepers;
  onQuantity: (playerId: string, value: number) => void;
  onDistance: (eventHole: number, playerId: string, value: number | null) => void;
  onKeeper: (playerId: string, period: CounterBetPeriod) => void;
}) {
  if (config.enabled !== true) return null;
  const meta = COUNTER_BET_META[kind];
  const participantIds = Array.isArray(config.participantIds) ? config.participantIds : [];
  const participants = players.filter(player => participantIds.includes(player.id));
  const roundHalf = roundHalfForHole(hole, order);
  if (!roundHalf) return null;
  const periodOrder = roundHalfHoles(order, roundHalf);
  const legacyNine = physicalNineForPlayedHalf(order, roundHalf);
  const latest = latestCounterBetCandidates(kind, participantIds, events, periodOrder);
  const atPeriodEnd = periodOrder.length > 0 && hole === periodOrder.at(-1);
  const tieCandidates = atPeriodEnd && latest.candidates.length > 1 ? latest.candidates : [];
  const asksKeeper = kind !== "vipers" && tieCandidates.length > 1;
  return <section className="card compact sideEventCard">
    <div className="sectionTitle"><div><h2>{meta.emoji} {meta.plural}</h2><p>{kind === "vipers" ? "Marca una si hizo 3 putts o más." : "Registra todas las del hoyo."}</p></div><span className="eventValue">{money(counterBetEffectiveUnitValue(config, hole, order))} c/u</span></div>
    <div className="quickCounterList">{participants.map(player => {
      const quantity = counterQuantity(events, kind, hole, player.id);
      return <div key={player.id}><b>{player.name}</b><Counter label={`${meta.plural} de ${player.name}`} value={quantity} max={kind === "vipers" ? 1 : undefined} onChange={value => onQuantity(player.id, value)} /></div>;
    })}</div>
    {kind === "vipers" && tieCandidates.length > 1 && <fieldset className="counterTieBreak"><legend>Distancia de la última Víbora · H{latest.hole}</legend><p>Captura centímetros; la bola más cercana al hoyo se queda con la bolsa de esta vuelta.</p>{tieCandidates.map(candidate => <label key={candidate.playerId}>{players.find(player => player.id === candidate.playerId)?.name || "Sin nombre"}<NumericCaptureInput inputMode="decimal" min={0} step={1} placeholder="cm" value={candidate.distanceToHole} onValueChange={value => onDistance(latest.hole as number, candidate.playerId, value)} /></label>)}</fieldset>}
    {asksKeeper && <label className="keeperSelect">Varios jugadores generaron el último {meta.singular} en H{latest.hole}. Selecciona quién lo generó al final:<select value={keepers[kind]?.[roundHalf] || (legacyNine ? keepers[kind]?.[legacyNine] : "") || ""} onChange={event => onKeeper(event.target.value, roundHalf)}><option value="">Seleccionar…</option>{tieCandidates.map(candidate => <option key={candidate.playerId} value={candidate.playerId}>{players.find(player => player.id === candidate.playerId)?.name || "Sin nombre"}</option>)}</select></label>}
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
  const participantIds = Array.isArray(config.participantIds) ? config.participantIds : [];
  const participants = players.filter(player => participantIds.includes(player.id));
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
      const manual = capture.unitCounts?.[player.id] || 0;
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

export function CounterBetResults({ title, halves, playerName, id: explicitId, open, onOpenChange }: { title: string; halves: CounterBetHalfResult[]; playerName: (id?: string) => string; id?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const presentationKey = explicitId === "vipers" || explicitId === "camels" || explicitId === "fish" ? explicitId : null;
  const displayTitle = presentationKey ? betDisplayLabel(presentationKey) : title;
  const meta = presentationKey ? COUNTER_BET_META[presentationKey] : undefined;
  const id = explicitId || displayTitle.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const visibleHalves = halves.filter(half => half.holes.length && half.nine !== "round");
  const totalBalances = visibleHalves.reduce<Record<string, number>>((totals, half) => {
    for (const [playerId, amount] of Object.entries(half.balances)) totals[playerId] = (totals[playerId] || 0) + amount;
    return totals;
  }, {});
  return <ResultAccordion id={id} title={displayTitle} open={open} onOpenChange={onOpenChange} className="sideBetResult">
    {visibleHalves.map((half, index) => {
      const playedHalf = half.roundHalf ?? (index === 0 ? "first_half" : "second_half");
      return <section className="sideBetHalf" key={`${half.nine}-${index}`}>
      <div className="sideBetHalfHeader"><div><b>{playedHalfLabel(playedHalf)}</b><span>H{half.holes[0]}–H{half.holes.at(-1)}</span></div>{half.pressed && <strong>Presión {half.multiplier}x</strong>}</div>
      <div className="sideBetHalfMetrics"><div><span>Eventos</span><b>{half.quantity}</b></div><div><span>Valor por evento</span><b>{money(half.value)}</b></div><div><span>Bolsa</span><b>{money(half.bagValue)}</b></div></div>
      <p className="sideBetKeeper">{half.keeperId ? half.settled ? <><b>Se {meta?.article === "las" ? "las" : "los"} queda: {playerName(half.keeperId)}</b><span>{playerName(half.keeperId)} paga {money(half.bagValue)} a cada rival.</span></> : <><b>Último evento: {playerName(half.keeperId)}</b><span>Liquidación pendiente de completar la vuelta.</span></> : half.quantity === 0 ? <span>Sin eventos en esta vuelta.</span> : half.needsTieBreak ? <span>Desempate pendiente.</span> : <span>Pendiente de completar la vuelta.</span>}</p>
      {half.events.length > 0 && <div className="sideBetEventBreakdown">{half.events.map(event => <article key={event.id}><b>H{event.hole} · {playerName(event.playerId)}</b><span>{event.quantity} {event.quantity === 1 ? meta?.singular || "evento" : meta?.plural || "eventos"} × {money(event.effectiveUnitValue)} = <strong>{money(event.effectiveTotalValue)}</strong></span></article>)}</div>}
      {half.settled && <div className="sideBetBalances">{Object.entries(half.balances).map(([playerId, amount]) => <span key={playerId}>{playerName(playerId)} <b className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</b></span>)}</div>}
    </section>})}
    {visibleHalves.length > 0 && <section className="counterBetTotal"><h3>TOTAL {meta?.plural.toUpperCase() || displayTitle.toUpperCase()}</h3><div className="sideBetBalances">{Object.entries(totalBalances).map(([playerId, amount]) => <span key={playerId}>{playerName(playerId)} <b className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</b></span>)}</div></section>}
  </ResultAccordion>;
}
