"use client";

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createSupplementalBet, SUPPLEMENTAL_BET_LABELS } from "../../lib/supplemental-bets";
import { SUPPLEMENTAL_BET_PRESENTATION, supplementalBetDisplayLabel } from "../../lib/bet-catalog";
import { setSupplementalCategoryEnabled } from "../../lib/bet-activation";
import { BET_HELP, type BetHelpKind, type BetHelpSection } from "../../lib/bet-help";
import type { Player, SupplementalBet } from "../../lib/types";
import { NumericCaptureInput } from "./numeric-capture-input";
import { ResultAccordion } from "./result-accordion";
import styles from "./supplemental-bets.module.css";

export type BetKind = BetHelpKind;

function HelpSection({ content }: { content: BetHelpSection }) {
  return Array.isArray(content)
    ? <ul>{content.map((line) => <li key={line}>{line}</li>)}</ul>
    : <p>{content}</p>;
}

function createSupplementalBetId(type: SupplementalBet["type"]) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${type}-${Date.now()}`;
}

export function BetHelpButton({ kind, title }: { kind: BetKind; title?: string }) {
  const [open, setOpen] = useState(false);
  const help = BET_HELP[kind];
  const displayTitle = title || help.title;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const close = () => { setOpen(false); window.setTimeout(() => triggerRef.current?.focus(), 0); };
  return <>
    <button ref={triggerRef} type="button" className={styles.helpButton} aria-label={`Ayuda sobre ${displayTitle}`} aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>?</button>
    {open && <div className={styles.helpBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className={`${styles.helpDialog} betHelpDialog`} role="dialog" aria-modal="true" aria-label={displayTitle} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href]") || [])];
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={styles.helpClose} aria-label="Cerrar ayuda" onClick={close}>×</button>
        <h2>{displayTitle}</h2>
        <dl><div><dt>QUÉ ES</dt><dd><HelpSection content={help.what} /></dd></div><div><dt>CÓMO FUNCIONA</dt><dd><HelpSection content={help.how} /></dd></div><div><dt>REGLAS IMPORTANTES</dt><dd><HelpSection content={help.rules} /></dd></div><div><dt>EJEMPLO SIMPLE</dt><dd><HelpSection content={help.example} /></dd></div></dl>
      </section>
    </div>}
  </>;
}

function Switch({ on, label, onChange, disabled = false, buttonRef }: { on: boolean; label: string; onChange: () => void; disabled?: boolean; buttonRef?: (node: HTMLButtonElement | null) => void }) {
  return <button ref={buttonRef} type="button" className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`${on ? "Desactivar" : "Activar"} ${label}`} title={disabled ? "Completa el consentimiento específico desde Mi Cuenta" : undefined} disabled={disabled} onClick={(event) => { event.stopPropagation(); onChange(); }}><span /></button>;
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
  const meta = SUPPLEMENTAL_BET_PRESENTATION[bet.type];
  return <article data-supplemental-editor={bet.id} className={`${styles.betItem} ${!bet.enabled ? styles.disabled : ""}`}>
    <div className={styles.itemHeader}>
      <div><b>{meta.icon} {label}</b><small>{meta.description}</small>{!bet.enabled && <small>Desactivada · conserva sus datos y no participa</small>}</div>
      <span className={styles.itemActions}><Switch on={bet.enabled} label={label} disabled={locked} onChange={onToggle} /></span>
      <button type="button" className="remove" aria-label={`Eliminar ${label}`} onClick={onRemove}>×</button>
    </div>
    {bet.enabled && <fieldset disabled={locked} className={`${styles.fields} bettingEditorFieldset`}>{children}</fieldset>}
  </article>;
}

const ORDER: SupplementalBet["type"][] = ["team_pressures", "chicago", "vegas", "minimum_putts"];

export function SupplementalBetsEditor({ bets, players, onChange, requestActivation, locked = false, types = ORDER, roundHoles = 18 }: { bets: SupplementalBet[]; players: Player[]; onChange: Dispatch<SetStateAction<SupplementalBet[]>>; requestActivation?: () => Promise<boolean>; locked?: boolean; types?: SupplementalBet["type"][]; roundHoles?: 9 | 18 }) {
  const [openTypes, setOpenTypes] = useState<Partial<Record<SupplementalBet["type"], boolean>>>({});
  const pendingScroll = useRef<string | null>(null);
  const pendingConsentAction = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const switchRefs = useRef<Partial<Record<SupplementalBet["type"], HTMLButtonElement | null>>>({});
  const update = (id: string, next: Partial<SupplementalBet>) => onChange((current) => current.map((bet) => bet.id === id ? { ...bet, ...next } as SupplementalBet : bet));
  const remove = (id: string) => onChange((current) => current.filter((bet) => bet.id !== id));
  const runAfterConsent = (action: () => void) => {
    if (!requestActivation) { action(); return; }
    if (pendingConsentAction.current) return;
    pendingConsentAction.current = true;
    void requestActivation().then((accepted) => { if (accepted) action(); }).finally(() => { pendingConsentAction.current = false; });
  };
  const addNow = (type: SupplementalBet["type"]) => {
    const id = createSupplementalBetId(type);
    setOpenTypes((current) => ({ ...current, [type]: true }));
    pendingScroll.current = id;
    onChange((current) => current.some((bet) => bet.id === id) ? current : [...current, createSupplementalBet(type, players, id, roundHoles)]);
    switchRefs.current[type]?.focus({ preventScroll: true });
  };
  const add = (type: SupplementalBet["type"]) => runAfterConsent(() => addNow(type));
  const setTypeEnabled = (type: SupplementalBet["type"], enabled: boolean) => {
    if (enabled) { runAfterConsent(() => setTypeEnabledNow(type, true)); return; }
    setTypeEnabledNow(type, false);
  };
  const setTypeEnabledNow = (type: SupplementalBet["type"], enabled: boolean) => {
    setOpenTypes((open) => ({ ...open, [type]: enabled }));
    if (enabled && !bets.some((bet) => bet.type === type)) {
      const id = createSupplementalBetId(type);
      pendingScroll.current = id;
      onChange((current) => current.some((bet) => bet.type === type)
        ? setSupplementalCategoryEnabled(current, type, true)
        : [...current, createSupplementalBet(type, players, id, roundHoles)]);
      switchRefs.current[type]?.focus({ preventScroll: true });
    } else {
      onChange((current) => setSupplementalCategoryEnabled(current, type, enabled));
      switchRefs.current[type]?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    const targetId = pendingScroll.current;
    if (!targetId) return;
    const section = editorRef.current?.querySelector<HTMLElement>(`[data-supplemental-editor="${CSS.escape(targetId)}"]`);
    if (!section) return;
    pendingScroll.current = null;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [bets, openTypes]);

  const groupLayout = types.length === ORDER.length && types.every((type, index) => type === ORDER[index]);
  return <div ref={editorRef} className={`${styles.editor} ${groupLayout ? styles.groupEditor : ""}`.trim()}>{types.map((type) => {
    const typeBets = bets.filter((bet) => bet.type === type).map((bet, index) => ({ bet, index })).sort((first, second) => Number(second.bet.enabled) - Number(first.bet.enabled));
    const modeEnabled = typeBets.some(({ bet }) => bet.enabled);
    const label = SUPPLEMENTAL_BET_LABELS[type];
    const title = <span className={styles.modeTitle}><b>{SUPPLEMENTAL_BET_PRESENTATION[type].icon} {label}</b><small>{SUPPLEMENTAL_BET_PRESENTATION[type].description}</small></span>;
    return <ResultAccordion key={type} id={`setup-${type}`} title={title} open={modeEnabled && Boolean(openTypes[type])} disclosureDisabled={!modeEnabled || locked} onOpenChange={(open) => { if (modeEnabled && !locked) setOpenTypes((current) => ({ ...current, [type]: open })); }} className={`setupBetsAccordion ${groupLayout ? styles.groupModeCard : ""}`.trim()} headerAction={<span className={styles.headerActions}><BetHelpButton kind={type} /><Switch buttonRef={(node) => { switchRefs.current[type] = node; }} on={modeEnabled} label={label} disabled={locked} onChange={() => setTypeEnabled(type, !modeEnabled)} /></span>}>
      {modeEnabled && <>
      <div className={styles.modeTools}><button type="button" className="textButton" onClick={() => add(type)}>+ Agregar</button></div>
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
          <div className="grid3"><NumberField label="Base de cuota" value={bet.quotaBase} onChange={(quotaBase) => update(bet.id, { quotaBase })} /><NumberField label="HCP %" value={bet.hcpPct ?? 100} min={0} max={100} onChange={(hcpPct) => update(bet.id, { hcpPct })} /><MoneyField label="Valor por punto" value={bet.valuePerPoint} onChange={(valuePerPoint) => update(bet.id, { valuePerPoint })} /></div>
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
          <div className="grid2"><MoneyField label="Ante" value={bet.ante} onChange={(ante) => update(bet.id, { ante })} /><label>Duración de la apuesta<select value={bet.holes} onChange={(event) => update(bet.id, { holes: Number(event.target.value) as 9 | 18 })}><option value={9}>9 hoyos</option>{roundHoles === 18 && <option value={18}>18 hoyos</option>}</select><small>Ronda configurada: {roundHoles} hoyos.</small></label></div>
          <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bet.participantIds} onChange={(participantIds) => update(bet.id, { participantIds })} />
        </>}
      </ItemShell>)}
      </>}
    </ResultAccordion>;
  })}</div>;
}

export function SupplementalBetResults({ results, players, throughHole }: { results: Array<{ betId: string; type: SupplementalBet["type"]; label: string; complete: boolean; balances: Record<string, number>; lines: string[] }>; players: Player[]; throughHole?: number }) {
  const playerName = (id: string) => players.find((player) => player.id === id)?.name || id;
  return <div className={styles.results}>{results.map((result) => <details key={result.betId} className={`${styles.resultItem} ${styles.liveDisclosure}`}>
    <summary><span><b>{supplementalBetDisplayLabel(result.type, result.label)}</b><small>{throughHole ? `Acumulado hasta H${throughHole}` : result.complete ? "Resultado final" : "Provisional"}</small></span><span className={styles.resultBalances}>{Object.entries(result.balances).filter(([, amount]) => amount !== 0 || !Object.values(result.balances).some(Boolean)).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{amount > 0 ? "+" : ""}${amount.toLocaleString("es-MX")}</b></span>)}</span><i aria-hidden="true">⌄</i></summary>
    <div className={styles.liveDetails}>{result.lines.length ? result.lines.map((line, index) => <p key={`${result.betId}-${index}`}>{line}</p>) : <p>Pendiente de resolverse con los hoyos guardados.</p>}</div>
  </details>)}</div>;
}
