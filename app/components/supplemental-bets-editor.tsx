"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createSupplementalBet, SUPPLEMENTAL_BET_LABELS } from "../../lib/supplemental-bets";
import { setSupplementalCategoryEnabled } from "../../lib/bet-activation";
import type { Player, SupplementalBet } from "../../lib/types";
import { NumericCaptureInput } from "./numeric-capture-input";
import { ResultAccordion } from "./result-accordion";
import styles from "./supplemental-bets.module.css";

export type BetKind = SupplementalBet["type"] | "personal" | "manual" | "rabbits" | "skins" | "units" | "foursome" | "ball_friend" | "monkey" | "polla" | "mini_polla" | "vipers" | "camels" | "fish" | "loba";

const HELP: Record<BetKind, { title: string; what: string; how: string; rules: string; example: string }> = {
  personal: { title: "Nassau Individual", what: "Un enfrentamiento privado entre Jugador A y Jugador B.", how: "La app compara Match y/o Medal por primera vuelta, segunda vuelta y total.", rules: "La ventaja directa, presión y carry se conservan de forma independiente.", example: "Jugador A gana Match de la primera vuelta y cobra el valor pactado a Jugador B." },
  individual_nassau: { title: "Nassau individual", what: "Tres enfrentamientos entre Jugador A y Jugador B: primera vuelta, segunda vuelta y total.", how: "Puede jugarse Match, Medal o ambos, aplicando la ventaja pactada antes de comparar.", rules: "Cada componente se liquida por separado y el carry no mezcla Match con Medal.", example: "Jugador A gana la primera, Jugador B la segunda y el total queda empatado." },
  dollar_stroke: { title: "Dollar a Stroke", what: "Juego individual donde cada golpe neto de diferencia tiene un valor.", how: "Se restan las ventajas, se comparan totales netos y la diferencia se multiplica por el valor por golpe.", rules: "Solo participan Jugador A y Jugador B; el mejor total neto cobra.", example: "Neto 70 contra 90, a $10 por golpe: Jugador A cobra $200." },
  individual_pressures: { title: "Presiones individuales", what: "Cada jugador mantiene un challenge contra cada oponente.", how: "Un empate deja la presión abierta; al ganar un hoyo se cierra y comienza la siguiente.", rules: "El carry puede pasar una presión empatada a la siguiente vuelta. Match Play adicional es opcional.", example: "Presión 1 abre en H1, empata H1 y cierra en H2 cuando gana Jugador A." },
  team_pressures: { title: "Presiones por parejas", what: "Challenges por equipos usando Low Ball, High Ball o ambos.", how: "Primero se aplica el handicap individual; luego se comparan el mejor y/o peor neto de cada equipo.", rules: "Mudo siempre tira par. Yo-Yo copia el score de su pareja. Las presiones pueden hacer carry.", example: "Equipo A gana Low Ball en H3, cierra la presión y Equipo B abre la siguiente." },
  chicago: { title: "Chicago", what: "Cada jugador intenta superar una cuota basada en su Course Handicap.", how: "Cuota = base menos Course Handicap. Birdie o mejor 4, Par 2, Bogey 1 y doble o peor 0 por default.", rules: "La base y la tabla de puntos son configurables; todos se comparan entre sí.", example: "Jugador A termina +3 y Jugador B −2: diferencia 5 por el valor configurado." },
  vegas: { title: "Vegas", what: "Juego por parejas que concatena los dos scores netos de cada equipo.", how: "El menor va primero: 4 y 5 forman 45. La diferencia contra el otro equipo son unidades.", rules: "Las parejas pueden ser fijas o rotar. La penalidad birdie contra bogey invierte al equipo penalizado.", example: "Equipo A hace 45 y Equipo B 56: Equipo A gana 11 unidades." },
  minimum_putts: { title: "Mínimo de Putts", what: "Todos ponen un ante y gana quien tenga menos putts brutos.", how: "Se suman 9 o 18 hoyos. Cada perdedor aporta el ante y los ganadores dividen la bolsa.", rules: "No usa handicap. Si todos empatan, nadie paga.", example: "Tres perdedores a $50 forman una bolsa de $150 para el ganador." },
  manual: { title: "Apuestas manuales", what: "Registro directo para una apuesta no contemplada.", how: "Captura un importe positivo, negativo o cero para cada jugador.", rules: "La apuesta solo entra al resultado cuando la suma total es exactamente $0.", example: "Jugador A +300 y Jugador B −300: total $0." },
  rabbits: { title: "Conejos", what: "Apuesta que se agarra, defiende y gana hoyo a hoyo.", how: "El motor compara scores netos y conserva automáticamente el estado del conejo.", rules: "Los empates y acumulaciones siguen la regla configurada de la ronda.", example: "Jugador A agarra y lo defiende en el hoyo siguiente." },
  skins: { title: "Skins", what: "Cada hoyo vale un skin.", how: "El mejor score neto único lo gana; si empatan, se acumula.", rules: "El carry pertenece al siguiente hoyo y no inventa ganador al final.", example: "H1 empata y H2 vale dos skins para el ganador único." },
  units: { title: "Unidades / Copas", what: "Eventos positivos y negativos por jugador.", how: "Se suman las unidades naturales y manuales, y luego se liquidan entre participantes.", rules: "El balance monetario de todos los jugadores debe cerrar en cero.", example: "Jugador A termina +2 y Jugador B −1 antes de liquidar." },
  foursome: { title: "Foursome", what: "Juego por parejas con Low Ball y High Ball.", how: "Cada hoyo puede producir de −2 a +2 puntos después de aplicar HCP.", rules: "Las parejas, tramos, fijo, patada y presión usan la configuración de la ronda.", example: "Equipo A gana Low y empata High: +1." },
  ball_friend: { title: "Bola Amiga", what: "Juego de parejas que compara los resultados netos del hoyo.", how: "La pareja se configura antes del score y la app calcula puntos y pago.", rules: "El equipo que descansa con cinco jugadores no participa ese hoyo.", example: "Equipo A supera a Equipo B por dos puntos." },
  monkey: { title: "Monkey", what: "Juego individual para exactamente tres jugadores.", how: "Cada jugador suma puntos por ganar o empatar frente a los otros dos.", rules: "Usa HCP rebajado entre los tres participantes.", example: "Jugador A gana a B y empata con C." },
  polla: { title: "Polla", what: "Medal neto de una vuelta o de 18 hoyos.", how: "Todos aportan el valor y la bolsa se reparte entre el mejor o los mejores netos.", rules: "Primera, segunda y total se calculan de manera independiente.", example: "Jugador A y B empatan el mejor neto y dividen la bolsa." },
  mini_polla: { title: "Mini Polla", what: "Medal neto de los últimos tres hoyos jugados.", how: "La app usa el orden real de la ronda y reparte la bolsa.", rules: "Un empate divide el premio entre los ganadores.", example: "Jugador A gana por un golpe en los últimos tres hoyos." },
  vipers: { title: "Víboras", what: "Conteo especial por jugador y vuelta.", how: "Se capturan los eventos y al final de la vuelta se indica quién se los quedó.", rules: "La segunda vuelta usa el multiplicador configurado.", example: "Jugador A se queda las Víboras de la primera vuelta." },
  camels: { title: "Camellos", what: "Conteo especial por jugador y vuelta.", how: "Se capturan los eventos y al final de la vuelta se indica quién se los quedó.", rules: "La segunda vuelta usa el multiplicador configurado.", example: "Jugador B se queda los Camellos de la segunda vuelta." },
  fish: { title: "Peces", what: "Conteo especial por jugador y vuelta.", how: "Se capturan los eventos y al final de la vuelta se indica quién se los quedó.", rules: "La segunda vuelta usa el multiplicador configurado.", example: "Jugador C se queda los Peces de la vuelta." },
  loba: { title: "Loba", what: "La Loba juega con pareja o sola contra los demás.", how: "La app compara el mejor neto de cada equipo y aplica modalidad y multiplicador.", rules: "Las unidades son por equipo y el multiplicador 🔥 no las modifica.", example: "Jugador A va con B contra Equipo B y gana el hoyo." },
};

const SUPPLEMENTAL_META: Record<SupplementalBet["type"], { icon: string; description: string }> = {
  individual_nassau: { icon: "🏌️", description: "Jugador vs jugador · ida, vuelta y total" },
  dollar_stroke: { icon: "💵", description: "Diferencia de golpes netos · pago por golpe" },
  individual_pressures: { icon: "⚡", description: "Duelo hoyo por hoyo · al perder se abre nueva presión" },
  team_pressures: { icon: "🤝", description: "Low Ball / High Ball por equipos · con presiones" },
  chicago: { icon: "🌆", description: "Puntos contra cuota según handicap" },
  vegas: { icon: "🎲", description: "Scores de pareja concatenados · diferencia por unidad" },
  minimum_putts: { icon: "⛳", description: "Menos putts de la ronda gana el ante" },
};

function createSupplementalBetId(type: SupplementalBet["type"]) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${type}-${Date.now()}`;
}

export function BetHelpButton({ kind }: { kind: BetKind }) {
  const [open, setOpen] = useState(false);
  const help = HELP[kind];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const close = () => { setOpen(false); window.setTimeout(() => triggerRef.current?.focus(), 0); };
  return <>
    <button ref={triggerRef} type="button" className={styles.helpButton} aria-label={`Ayuda sobre ${help.title}`} aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>?</button>
    {open && <div className={styles.helpBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className={styles.helpDialog} role="dialog" aria-modal="true" aria-label={help.title} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href]") || [])];
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={styles.helpClose} aria-label="Cerrar ayuda" onClick={close}>×</button>
        <h2>{help.title}</h2>
        <dl><div><dt>Qué es</dt><dd>{help.what}</dd></div><div><dt>Cómo funciona</dt><dd>{help.how}</dd></div><div><dt>Reglas importantes</dt><dd>{help.rules}</dd></div><div><dt>Ejemplo simple</dt><dd>{help.example}</dd></div></dl>
      </section>
    </div>}
  </>;
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return <button type="button" className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`${on ? "Desactivar" : "Activar"} ${label}`} onClick={(event) => { event.stopPropagation(); onChange(); }}><span /></button>;
}

function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label>{label}<span className="moneyField"><span>$</span><NumericCaptureInput value={value} onValueChange={(next) => onChange(next ?? 0)} /></span></label>;
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label>{label}<NumericCaptureInput value={value} min={min} max={max} step={step} emptyWhenZero={false} onValueChange={(next) => onChange(next ?? 0)} /></label>;
}

function PlayerSelect({ label, value, players, exclude, onChange }: { label: string; value: string; players: Player[]; exclude?: string; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Seleccionar…</option>{players.filter((player) => player.id !== exclude).map((player) => <option key={player.id} value={player.id}>{player.name || "Sin nombre"}</option>)}</select></label>;
}

function ParticipantChips({ players, selected, onChange }: { players: Player[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="chips">{players.map((player) => {
    const active = selected.includes(player.id);
    return <button type="button" key={player.id} className={`chipButton ${active ? "selected" : ""}`} onClick={() => onChange(active ? selected.filter((id) => id !== player.id) : [...selected, player.id])}>{active ? "✓ " : ""}{player.name || "Sin nombre"}</button>;
  })}</div>;
}

function ItemShell({ bet, label, onToggle, onRemove, children, locked }: { bet: SupplementalBet; label: string; onToggle: () => void; onRemove: () => void; children: ReactNode; locked: boolean }) {
  const meta = SUPPLEMENTAL_META[bet.type];
  return <article data-supplemental-editor={bet.id} className={`${styles.betItem} ${!bet.enabled ? styles.disabled : ""}`}>
    <div className={styles.itemHeader}>
      <div><b>{meta.icon} {label}</b><small>{meta.description}</small>{!bet.enabled && <small>Desactivada · conserva sus datos y no participa</small>}</div>
      <span className={styles.itemActions}><Switch on={bet.enabled} label={label} onChange={onToggle} /></span>
      <button type="button" className="remove" aria-label={`Eliminar ${label}`} onClick={onRemove}>×</button>
    </div>
    {bet.enabled && <fieldset disabled={locked} className={`${styles.fields} bettingEditorFieldset`}>{children}</fieldset>}
  </article>;
}

const ORDER: SupplementalBet["type"][] = ["team_pressures", "chicago", "vegas", "minimum_putts"];

export function SupplementalBetsEditor({ bets, players, onChange, requestActivation, locked = false, types = ORDER }: { bets: SupplementalBet[]; players: Player[]; onChange: (bets: SupplementalBet[]) => void; requestActivation?: () => Promise<boolean>; locked?: boolean; types?: SupplementalBet["type"][] }) {
  const [openTypes, setOpenTypes] = useState<Partial<Record<SupplementalBet["type"], boolean>>>({});
  const pendingFocus = useRef<string | null>(null);
  const pendingConsentAction = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const update = (id: string, next: Partial<SupplementalBet>) => onChange(bets.map((bet) => bet.id === id ? { ...bet, ...next } as SupplementalBet : bet));
  const remove = (id: string) => onChange(bets.filter((bet) => bet.id !== id));
  const runAfterConsent = (action: () => void) => {
    if (!requestActivation) { action(); return; }
    if (pendingConsentAction.current) return;
    pendingConsentAction.current = true;
    void requestActivation().then((accepted) => { if (accepted) action(); }).finally(() => { pendingConsentAction.current = false; });
  };
  const addNow = (type: SupplementalBet["type"]) => {
    const id = createSupplementalBetId(type);
    setOpenTypes((current) => ({ ...current, [type]: true }));
    pendingFocus.current = id;
    onChange([...bets, createSupplementalBet(type, players, id)]);
  };
  const add = (type: SupplementalBet["type"]) => runAfterConsent(() => addNow(type));
  const setTypeEnabled = (type: SupplementalBet["type"], enabled: boolean) => {
    if (enabled) { runAfterConsent(() => setTypeEnabledNow(type, true)); return; }
    setTypeEnabledNow(type, false);
  };
  const setTypeEnabledNow = (type: SupplementalBet["type"], enabled: boolean) => {
    const current = bets.filter((bet) => bet.type === type);
    setOpenTypes((open) => ({ ...open, [type]: true }));
    if (enabled && current.length === 0) {
      addNow(type);
      return;
    }
    onChange(setSupplementalCategoryEnabled(bets, type, enabled));
  };

  useEffect(() => {
    const targetId = pendingFocus.current;
    if (!targetId) return;
    const section = editorRef.current?.querySelector<HTMLElement>(`[data-supplemental-editor="${CSS.escape(targetId)}"]`);
    const field = section?.querySelector<HTMLElement>("fieldset input, fieldset select, fieldset textarea, fieldset button");
    if (!section || !field) return;
    pendingFocus.current = null;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
  }, [bets, openTypes]);

  return <div ref={editorRef} className={styles.editor}>{types.map((type) => {
    const typeBets = bets.filter((bet) => bet.type === type).map((bet, index) => ({ bet, index })).sort((first, second) => Number(second.bet.enabled) - Number(first.bet.enabled));
    const modeEnabled = typeBets.some(({ bet }) => bet.enabled);
    const label = SUPPLEMENTAL_BET_LABELS[type];
    const title = <span className={styles.modeTitle}><b>{SUPPLEMENTAL_META[type].icon} {label}</b><small>{SUPPLEMENTAL_META[type].description}</small></span>;
    return <ResultAccordion key={type} id={`setup-${type}`} title={title} open={Boolean(openTypes[type])} onOpenChange={(open) => setOpenTypes((current) => ({ ...current, [type]: open }))} className="setupBetsAccordion" headerAction={<span className={styles.headerActions}><BetHelpButton kind={type} /><Switch on={modeEnabled} label={label} onChange={() => setTypeEnabled(type, !modeEnabled)} /></span>}>
      <div className={styles.modeTools}><button type="button" className="textButton" onClick={() => add(type)}>+ Agregar</button></div>
      {!typeBets.length && <div className="empty">Todavía no hay apuestas de este tipo.</div>}
      {typeBets.map(({ bet, index }) => <ItemShell key={bet.id} bet={bet} locked={locked} label={`${SUPPLEMENTAL_BET_LABELS[type]} ${index + 1}`} onToggle={() => bet.enabled ? update(bet.id, { enabled: false, enabledBeforeCategoryOff: undefined }) : runAfterConsent(() => update(bet.id, { enabled: true, enabledBeforeCategoryOff: undefined }))} onRemove={() => remove(bet.id)}>
        {bet.type === "dollar_stroke" && <>
          <div className="grid2"><PlayerSelect label="Jugador A" value={bet.playerAId} players={players} exclude={bet.playerBId} onChange={(playerAId) => update(bet.id, { playerAId })} /><PlayerSelect label="Jugador B" value={bet.playerBId} players={players} exclude={bet.playerAId} onChange={(playerBId) => update(bet.id, { playerBId })} /></div>
          <div className="grid3"><MoneyField label="Valor por golpe" value={bet.valuePerStroke} onChange={(valuePerStroke) => update(bet.id, { valuePerStroke })} /><PlayerSelect label="Quién recibe ventaja" value={bet.advantageReceiverId || ""} players={players.filter((player) => player.id === bet.playerAId || player.id === bet.playerBId)} onChange={(advantageReceiverId) => update(bet.id, { advantageReceiverId: advantageReceiverId || undefined })} /><NumberField label="Golpes" value={bet.advantageStrokes} min={0} onChange={(advantageStrokes) => update(bet.id, { advantageStrokes })} /></div>
        </>}
        {bet.type === "individual_pressures" && <>
          <div className="grid3"><MoneyField label="Valor por presión" value={bet.value} onChange={(value) => update(bet.id, { value })} /><NumberField label="HCP %" value={bet.hcpPct} min={0} max={100} onChange={(hcpPct) => update(bet.id, { hcpPct })} /><label>Redondeo<select value={bet.decimals} onChange={(event) => update(bet.id, { decimals: event.target.value as typeof bet.decimals })}><option value="half_up">Redondear</option><option value="decimal">Decimales</option></select></label></div>
          <div className={styles.checks}><label className="checkRow"><input type="checkbox" checked={bet.carryEnabled} onChange={(event) => update(bet.id, { carryEnabled: event.target.checked })} />Carry</label><label className="checkRow"><input type="checkbox" checked={bet.matchPlayEnabled} onChange={(event) => update(bet.id, { matchPlayEnabled: event.target.checked })} />Match Play adicional</label></div>
          <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds })} />
        </>}
        {bet.type === "team_pressures" && <>
          <div className="grid3"><MoneyField label="Valor por presión" value={bet.value} onChange={(value) => update(bet.id, { value })} /><NumberField label="HCP %" value={bet.hcpPct} min={0} max={100} onChange={(hcpPct) => update(bet.id, { hcpPct })} /><label>Comparación<select value={bet.metric} onChange={(event) => update(bet.id, { metric: event.target.value as typeof bet.metric })}><option value="low">Low Ball</option><option value="high">High Ball</option><option value="low_high">Low + High</option></select></label></div>
          <div className="grid3"><label>Modalidad<select value={bet.virtualMode} onChange={(event) => update(bet.id, { virtualMode: event.target.value as typeof bet.virtualMode })}><option value="standard">2 vs 2</option><option value="mudo">Mudo · siempre Par</option><option value="yoyo">Yo-Yo · copia pareja</option></select></label><label className="checkRow"><input type="checkbox" checked={bet.carryEnabled} onChange={(event) => update(bet.id, { carryEnabled: event.target.checked })} />Carry</label><NumberField label="Score máximo abandono" value={bet.abandonedMaxScore} min={1} onChange={(abandonedMaxScore) => update(bet.id, { abandonedMaxScore })} /></div>
          <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds })} />
          <label className="miniLabel">Abandonaron · hoyos sin score usan el máximo</label><ParticipantChips players={players.filter((player) => bet.participantIds.includes(player.id))} selected={bet.abandonedPlayerIds || []} onChange={(abandonedPlayerIds) => update(bet.id, { abandonedPlayerIds })} />
          {bet.virtualMode === "standard" && <><label className="miniLabel">Equipo A · el resto forma Equipo B</label><ParticipantChips players={players.filter((player) => bet.participantIds.includes(player.id))} selected={bet.teamA} onChange={(teamA) => update(bet.id, { teamA: teamA.slice(-2) })} /></>}
        </>}
        {bet.type === "chicago" && <>
          <div className="grid2"><NumberField label="Base de cuota" value={bet.quotaBase} onChange={(quotaBase) => update(bet.id, { quotaBase })} /><MoneyField label="Valor por punto" value={bet.valuePerPoint} onChange={(valuePerPoint) => update(bet.id, { valuePerPoint })} /></div>
          <div className="grid4"><NumberField label="Birdie o mejor" value={bet.points.birdieOrBetter} onChange={(value) => update(bet.id, { points: { ...bet.points, birdieOrBetter: value } })} /><NumberField label="Par" value={bet.points.par} onChange={(value) => update(bet.id, { points: { ...bet.points, par: value } })} /><NumberField label="Bogey" value={bet.points.bogey} onChange={(value) => update(bet.id, { points: { ...bet.points, bogey: value } })} /><NumberField label="Doble o peor" value={bet.points.doubleBogeyOrWorse} onChange={(value) => update(bet.id, { points: { ...bet.points, doubleBogeyOrWorse: value } })} /></div>
          <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds })} />
        </>}
        {bet.type === "vegas" && <>
          <div className="grid3"><MoneyField label="Valor por unidad" value={bet.valuePerUnit} onChange={(valuePerUnit) => update(bet.id, { valuePerUnit })} /><NumberField label="HCP %" value={bet.hcpPct} min={0} max={100} onChange={(hcpPct) => update(bet.id, { hcpPct })} /><label>Rotación<select value={bet.rotation} onChange={(event) => update(bet.id, { rotation: event.target.value as typeof bet.rotation })}><option value="fixed">Parejas fijas</option><option value="each_hole">Cada hoyo</option><option value="blocks">Por bloques</option></select></label></div>
          {bet.rotation === "blocks" && <label>Tamaño del bloque<select value={bet.blockSize} onChange={(event) => update(bet.id, { blockSize: Number(event.target.value) as 3 | 6 | 9 })}><option value={3}>3 hoyos</option><option value={6}>6 hoyos</option><option value={9}>9 hoyos</option></select></label>}
          <label className="checkRow"><input type="checkbox" checked={bet.birdiePenalty} onChange={(event) => update(bet.id, { birdiePenalty: event.target.checked })} />Penalty birdie vs bogey</label>
          <label className="miniLabel">Participan · exactamente 4</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds: participantIds.slice(-4) })} />
          <label className="miniLabel">Equipo A · el resto forma Equipo B</label><ParticipantChips players={players.filter((player) => bet.participantIds.includes(player.id))} selected={bet.teamA} onChange={(teamA) => update(bet.id, { teamA: teamA.slice(-2) })} />
        </>}
        {bet.type === "minimum_putts" && <>
          <div className="grid2"><MoneyField label="Ante" value={bet.ante} onChange={(ante) => update(bet.id, { ante })} /><label>Hoyos<select value={bet.holes} onChange={(event) => update(bet.id, { holes: Number(event.target.value) as 9 | 18 })}><option value={9}>9 hoyos</option><option value={18}>18 hoyos</option></select></label></div>
          <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds })} />
        </>}
      </ItemShell>)}
    </ResultAccordion>;
  })}</div>;
}

export function SupplementalBetResults({ results, players, throughHole }: { results: Array<{ betId: string; label: string; complete: boolean; balances: Record<string, number>; lines: string[] }>; players: Player[]; throughHole?: number }) {
  const playerName = (id: string) => players.find((player) => player.id === id)?.name || id;
  return <div className={styles.results}>{results.map((result) => <details key={result.betId} className={`${styles.resultItem} ${styles.liveDisclosure}`}>
    <summary><span><b>{result.label}</b><small>{throughHole ? `Acumulado hasta H${throughHole}` : result.complete ? "Resultado final" : "Provisional"}</small></span><span className={styles.resultBalances}>{Object.entries(result.balances).filter(([, amount]) => amount !== 0 || !Object.values(result.balances).some(Boolean)).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{amount > 0 ? "+" : ""}${amount.toLocaleString("es-MX")}</b></span>)}</span><i aria-hidden="true">⌄</i></summary>
    <div className={styles.liveDetails}>{result.lines.length ? result.lines.map((line, index) => <p key={`${result.betId}-${index}`}>{line}</p>) : <p>Pendiente de resolverse con los hoyos guardados.</p>}</div>
  </details>)}</div>;
}
