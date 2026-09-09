"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { playOrder, segmentDefinitions } from "../../lib/engine";
import { defaultMaxBaseAppearances, generateAutomaticFoursomes, markFoursomeSegmentEdited } from "../../lib/foursome-generator";
import { configureCurrentIndexPersonal, configureSlidingPersonal } from "../../lib/personal-modes";
import { createSupplementalBet, SUPPLEMENTAL_BET_LABELS } from "../../lib/supplemental-bets";
import type { GroupGameTemplate, PersonalBet, Player, SupplementalBet } from "../../lib/types";
import { SupplementalBetsEditor } from "./supplemental-bets-editor";
import { NumericCaptureInput } from "./numeric-capture-input";
import styles from "./group-bet-template-editor.module.css";

type CoreKey = "monkey" | "rabbits" | "skins" | "units" | "foursome" | "ballFriend" | "pollaFirst" | "pollaSecond" | "pollaTotal" | "miniPolla" | "vipers" | "camels" | "fish" | "loba";

const CORE_MODES: Array<{ key: CoreKey; icon: string; label: string; detail: string }> = [
  { key: "monkey", icon: "🐒", label: "Monkey", detail: "Tres jugadores" },
  { key: "rabbits", icon: "🐇", label: "Conejos", detail: "Continuo o bloques" },
  { key: "skins", icon: "⛳", label: "Skins", detail: "Con o sin carry" },
  { key: "units", icon: "🏆", label: "Unidades / Copas", detail: "Eventos por jugador" },
  { key: "foursome", icon: "🤝", label: "Foursome", detail: "Parejas y presión" },
  { key: "ballFriend", icon: "🫶", label: "Bola Amiga", detail: "Equipo rotativo" },
  { key: "pollaFirst", icon: "1️⃣", label: "Polla 1ª vuelta", detail: "Medal por primera vuelta jugada" },
  { key: "pollaSecond", icon: "2️⃣", label: "Polla 2ª vuelta", detail: "Medal por segunda vuelta jugada" },
  { key: "pollaTotal", icon: "🏁", label: "Polla 18 hoyos", detail: "Medal total" },
  { key: "miniPolla", icon: "🎯", label: "Mini Polla", detail: "Medal corto" },
  { key: "vipers", icon: "🐍", label: "Víboras", detail: "Contador por vuelta" },
  { key: "camels", icon: "🐫", label: "Camellos", detail: "Contador por vuelta" },
  { key: "fish", icon: "🐟", label: "Peces", detail: "Contador por vuelta" },
  { key: "loba", icon: "🐺", label: "Loba", detail: "Equipos, loba y unidades" },
];

const SUPPLEMENTAL_MODES: Array<{ type: Exclude<SupplementalBet["type"], "individual_nassau">; icon: string }> = [
  { type: "dollar_stroke", icon: "💵" },
  { type: "individual_pressures", icon: "⚡" },
  { type: "team_pressures", icon: "🔥" },
  { type: "chicago", icon: "🌆" },
  { type: "vegas", icon: "🎰" },
  { type: "minimum_putts", icon: "🕳️" },
];

function makeId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function coreConfig(template: GroupGameTemplate, key: CoreKey) {
  if (key === "pollaFirst") return template.betConfig.polla.first9;
  if (key === "pollaSecond") return template.betConfig.polla.second9;
  if (key === "pollaTotal") return template.betConfig.polla.total18;
  return template.betConfig[key];
}

function Field({ label, value, onChange, min = 0, max, step = 1 }: { label: string; value: number | undefined; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label className={styles.field}>{label}<NumericCaptureInput inputMode="decimal" min={min} max={max} step={step} value={Number.isFinite(value) ? value : null} emptyWhenZero onValueChange={(next) => onChange(next ?? 0)} /></label>;
}

function Participants({ players, selected, onChange }: { players: Player[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className={styles.chips}>{players.map((player) => {
    const active = selected.includes(player.id);
    return <button type="button" key={player.id} className={active ? styles.chipActive : styles.chip} onClick={() => onChange(active ? selected.filter((id) => id !== player.id) : [...selected, player.id])}>{active ? "✓ " : ""}{player.name}</button>;
  })}</div>;
}

function Switch({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: () => void; disabled?: boolean }) {
  return <button type="button" className={`switch ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={`${checked ? "Desactivar" : "Activar"} ${label}`} disabled={disabled} onClick={onChange}><span /></button>;
}

function personalDefault(players: Player[], ownerId: string, template: GroupGameTemplate): PersonalBet {
  const owner = players.find((player) => player.id === ownerId);
  const rival = players.find((player) => player.id !== ownerId) || players[0];
  const base: PersonalBet = {
    id: makeId("personal"),
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: rival?.id,
    rivalName: rival?.name || "Rival",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: template.roundDefaults.startHole === 10 ? "holes_1_9" : "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  };
  return configureCurrentIndexPersonal(base, owner, rival, new Date().toISOString());
}

export function GroupBetTemplateEditor({ value, players, ownerId, mode, onChange, locked = false, requestActivation }: {
  value: GroupGameTemplate;
  players: Player[];
  ownerId: string;
  mode: "selection" | "details";
  onChange: Dispatch<SetStateAction<GroupGameTemplate>>;
  locked?: boolean;
  requestActivation?: () => Promise<boolean>;
}) {
  const [foursomeMaxBaseAppearances, setFoursomeMaxBaseAppearances] = useState(() => defaultMaxBaseAppearances(value.betConfig.foursome.segmentSize));
  const [foursomeMessage, setFoursomeMessage] = useState("");
  const runActivation = (action: () => void) => {
    if (!requestActivation) { action(); return; }
    void requestActivation().then((accepted) => { if (accepted) action(); });
  };
  const updateCore = (key: CoreKey, patch: Record<string, unknown>) => onChange((current) => {
    if (key === "pollaFirst" || key === "pollaSecond" || key === "pollaTotal") {
      const component = key === "pollaFirst" ? "first9" : key === "pollaSecond" ? "second9" : "total18";
      return { ...current, betConfig: { ...current.betConfig, polla: { ...current.betConfig.polla, [component]: { ...current.betConfig.polla[component], ...patch } } } };
    }
    return { ...current, betConfig: { ...current.betConfig, [key]: { ...current.betConfig[key], ...patch } } };
  });
  const toggleCore = (key: CoreKey) => {
    const enabled = Boolean(coreConfig(value, key)?.enabled);
    const apply = () => updateCore(key, { enabled: !enabled });
    if (!enabled) runActivation(apply); else apply();
  };
  const setSupplementalBets: Dispatch<SetStateAction<SupplementalBet[]>> = (action) => onChange((current) => ({
    ...current,
    supplementalBets: typeof action === "function" ? action(current.supplementalBets) : action,
  }));
  const toggleSupplemental = (type: Exclude<SupplementalBet["type"], "individual_nassau">) => {
    const enabled = value.supplementalBets.some((bet) => bet.type === type && bet.enabled);
    const apply = () => setSupplementalBets((current) => {
      const matching = current.some((bet) => bet.type === type);
      return matching
        ? current.map((bet) => bet.type === type ? { ...bet, enabled: !enabled } : bet)
        : [...current, createSupplementalBet(type, players, makeId(type), value.roundDefaults.roundHoles)];
    });
    if (!enabled) runActivation(apply); else apply();
  };
  const personalEnabled = value.personalBets.some((bet) => bet.enabled !== false);
  const togglePersonal = () => {
    const apply = () => onChange((current) => ({
      ...current,
      personalBets: current.personalBets.length
        ? current.personalBets.map((bet) => ({ ...bet, enabled: !personalEnabled }))
        : [personalDefault(players, ownerId, current)],
    }));
    if (!personalEnabled) runActivation(apply); else apply();
  };
  const manualEnabled = value.manualBets.some((bet) => bet.enabled !== false);
  const toggleManual = () => {
    const apply = () => onChange((current) => ({
      ...current,
      manualBets: current.manualBets.length
        ? current.manualBets.map((bet) => ({ ...bet, enabled: !manualEnabled }))
        : [{ id: makeId("manual"), enabled: true, name: "Apuesta manual 1", amounts: Object.fromEntries(players.map((player) => [player.id, 0])) }],
    }));
    if (!manualEnabled) runActivation(apply); else apply();
  };
  const roundOrder = playOrder(value.roundDefaults.startHole).slice(0, value.roundDefaults.roundHoles);
  const setFoursomeSegmentSize = (segmentSize: 3 | 6 | 9 | 18) => {
    setFoursomeMaxBaseAppearances(defaultMaxBaseAppearances(segmentSize));
    setFoursomeMessage("");
    onChange((current) => ({
      ...current,
      betConfig: { ...current.betConfig, foursome: { ...current.betConfig.foursome, segmentSize } },
      foursomeSegments: segmentDefinitions(playOrder(current.roundDefaults.startHole).slice(0, current.roundDefaults.roundHoles), segmentSize),
    }));
  };
  const generateFoursomes = () => {
    const generated = generateAutomaticFoursomes({
      participantIds: value.betConfig.foursome.participantIds,
      order: roundOrder,
      segmentSize: value.betConfig.foursome.segmentSize,
      maxBaseAppearances: foursomeMaxBaseAppearances,
      idFactory: () => makeId("foursome"),
    });
    if (!generated.ok) { setFoursomeMessage(generated.message); return; }
    onChange((current) => ({ ...current, foursomeSegments: generated.segments }));
    setFoursomeMessage("Parejas generadas por Backyard. Puedes editar cualquier tramo.");
  };
  const updatePersonal = (id: string, patcher: (bet: PersonalBet) => PersonalBet) => onChange((current) => ({
    ...current,
    personalBets: current.personalBets.map((bet) => bet.id === id ? patcher(bet) : bet),
  }));

  if (mode === "selection") return <div className={styles.selection}>
    <p className={styles.intro}>Activa solo lo que este grupo juega habitualmente. Todo se podrá cambiar para una ronda sin modificar la plantilla.</p>
    <div className={styles.modeGrid}>
      {CORE_MODES.map((item) => <article className={styles.modeCard} key={item.key}><span className={styles.modeIcon}>{item.icon}</span><span><b>{item.label}</b><small>{item.detail}</small></span><Switch checked={Boolean(coreConfig(value, item.key)?.enabled)} label={item.label} disabled={locked} onChange={() => toggleCore(item.key)} /></article>)}
      <article className={styles.modeCard}><span className={styles.modeIcon}>🏌️</span><span><b>Personales</b><small>Índice actual o Sliding contra un rival</small></span><Switch checked={personalEnabled} label="Personales" disabled={locked} onChange={togglePersonal} /></article>
      {SUPPLEMENTAL_MODES.map((item) => <article className={styles.modeCard} key={item.type}><span className={styles.modeIcon}>{item.icon}</span><span><b>{SUPPLEMENTAL_BET_LABELS[item.type]}</b><small>Modalidad existente</small></span><Switch checked={value.supplementalBets.some((bet) => bet.type === item.type && bet.enabled)} label={SUPPLEMENTAL_BET_LABELS[item.type]} disabled={locked} onChange={() => toggleSupplemental(item.type)} /></article>)}
      <article className={styles.modeCard}><span className={styles.modeIcon}>✍️</span><span><b>Manuales</b><small>Nombre habitual; importes por ronda</small></span><Switch checked={manualEnabled} label="Manuales" disabled={locked} onChange={toggleManual} /></article>
    </div>
  </div>;

  return <div className={styles.details}>
    <p className={styles.intro}>Toca una apuesta para editarla. Los resultados nunca se guardan aquí.</p>
    <section className={styles.basisCard}><div><b>Base de ventajas</b><small>Aplica a las modalidades que usan HCP.</small></div><div className={styles.chips}><button type="button" className={value.roundDefaults.handicapBasis === "relative" ? styles.chipActive : styles.chip} onClick={() => onChange((current) => ({ ...current, roundDefaults: { ...current.roundDefaults, handicapBasis: "relative" } }))}>Entre jugadores</button><button type="button" className={value.roundDefaults.handicapBasis === "course" ? styles.chipActive : styles.chip} onClick={() => onChange((current) => ({ ...current, roundDefaults: { ...current.roundDefaults, handicapBasis: "course" } }))}>Sobre campo</button></div></section>
    {CORE_MODES.filter((item) => Boolean(coreConfig(value, item.key)?.enabled)).map((item) => {
      const config = coreConfig(value, item.key)!;
      return <details className={styles.detailCard} key={item.key}><summary><span>{item.icon} {item.label}</span><small>{item.detail} · Editar</small></summary><fieldset disabled={locked}>
        <button type="button" className={styles.removeBet} onClick={() => updateCore(item.key, { enabled: false })}>Quitar esta apuesta</button>
        {"value" in config && <Field label="Valor" value={config.value} onChange={(next) => updateCore(item.key, { value: next })} />}
        {"hcpPct" in config && <Field label="HCP %" value={config.hcpPct} min={0} max={100} onChange={(next) => updateCore(item.key, { hcpPct: next })} />}
        {item.key === "rabbits" && <><label className={styles.field}>Formato<select value={value.betConfig.rabbits.mode || "continuous"} onChange={(event) => updateCore(item.key, { mode: event.target.value })}><option value="continuous">Sube / baja continuo</option><option value="three_hole_blocks">Bloques de 3 hoyos</option></select></label><label className={styles.check}><input type="checkbox" checked={value.betConfig.rabbits.accumulate} onChange={(event) => updateCore(item.key, { accumulate: event.target.checked })} />Acumular cuando queda libre</label></>}
        {item.key === "skins" && <label className={styles.check}><input type="checkbox" checked={(value.betConfig.skins.mode || "carry") === "carry"} onChange={(event) => updateCore(item.key, { mode: event.target.checked ? "carry" : "no_carry", accumulate: event.target.checked })} />Carry al siguiente hoyo</label>}
        {item.key === "units" && <Field label="Valor de Copa" value={value.betConfig.units.copaValue ?? value.betConfig.units.value} onChange={(copaValue) => updateCore(item.key, { copaValue })} />}
        {item.key === "foursome" && <><div className={styles.fieldsRow}><Field label="Valor fijo" value={value.betConfig.foursome.fixedValue} onChange={(fixedValue) => updateCore(item.key, { fixedValue })} /><Field label="Valor por punto" value={value.betConfig.foursome.pointValue} onChange={(pointValue) => updateCore(item.key, { pointValue })} /><label className={styles.field}>Tramos<select value={value.betConfig.foursome.segmentSize} onChange={(event) => setFoursomeSegmentSize(Number(event.target.value) as 3 | 6 | 9 | 18)}><option value="3">3 hoyos</option><option value="6">6 hoyos</option><option value="9">9 hoyos</option><option value="18">18 hoyos</option></select></label><Field label="Máximo en pareja base" value={foursomeMaxBaseAppearances} min={1} max={18} onChange={(next) => setFoursomeMaxBaseAppearances(Math.max(1, Math.trunc(next)))} /></div><button type="button" className="secondary" onClick={generateFoursomes}>Generar foursomes automáticamente</button>{foursomeMessage && <small className={styles.editorMessage} role="status">{foursomeMessage}</small>}<div className={styles.segmentList}>{value.foursomeSegments.map((segment) => <article key={segment.id}><div><b>H{roundOrder[segment.startIndex]}–{roundOrder[segment.endIndex]}</b><small>{segment.generatedByBackyard ? "Generada por Backyard" : "Editada manualmente"}</small></div><Participants players={players.filter((player) => value.betConfig.foursome.participantIds.includes(player.id))} selected={segment.basePair} onChange={(basePair) => onChange((current) => ({ ...current, foursomeSegments: current.foursomeSegments.map((item) => item.id === segment.id ? markFoursomeSegmentEdited({ ...item, basePair: basePair.slice(-2) }) : item) }))} /></article>)}</div></>}
        {item.key === "ballFriend" && <Field label="Score máximo" value={value.betConfig.ballFriend.maxScore} min={1} max={20} onChange={(maxScore) => updateCore(item.key, { maxScore })} />}
        {(item.key === "vipers" || item.key === "camels" || item.key === "fish") && <label className={styles.check}><input type="checkbox" checked={Boolean(value.betConfig[item.key].secondNinePressed)} onChange={(event) => updateCore(item.key, { secondNinePressed: event.target.checked })} />Presión en segunda vuelta</label>}
        {item.key === "loba" && <><Field label="Valor de unidad" value={value.betConfig.loba.unitValue} onChange={(unitValue) => updateCore(item.key, { unitValue })} /><label className={styles.check}><input type="checkbox" checked={value.betConfig.loba.unitsEnabled} onChange={(event) => updateCore(item.key, { unitsEnabled: event.target.checked })} />Unidades activas</label></>}
        <span className={styles.fieldLabel}>Participantes</span><Participants players={players} selected={config.participantIds || []} onChange={(participantIds) => updateCore(item.key, { participantIds })} />
      </fieldset></details>;
    })}

    {value.personalBets.some((bet) => bet.enabled !== false) && <section className={styles.collection}><h3>Personales</h3>{value.personalBets.map((bet, index) => {
      const owner = players.find((player) => player.id === ownerId);
      const rival = players.find((player) => player.id === bet.rivalPlayerId);
      const signedAdvantage = bet.slidingAdvantage ?? (bet.advantageReceiver === "owner" ? -bet.advantageStrokes : bet.advantageReceiver === "rival" ? bet.advantageStrokes : 0);
      return <article className={styles.instance} key={bet.id}>
        <div className={styles.instanceHead}><b>Personal {index + 1}</b><button type="button" className="textButton" onClick={() => onChange((current) => ({ ...current, personalBets: current.personalBets.filter((item) => item.id !== bet.id) }))}>Quitar</button></div>
        <label className={styles.field}>Rival<select value={bet.rivalPlayerId || ""} onChange={(event) => { const nextRival = players.find((player) => player.id === event.target.value); updatePersonal(bet.id, (currentBet) => { const selected = { ...currentBet, rivalMode: "group" as const, rivalPlayerId: nextRival?.id, rivalName: nextRival?.name || "Rival" }; return (currentBet.advantageMode || "current_index") === "sliding" ? configureSlidingPersonal(selected, signedAdvantage) : configureCurrentIndexPersonal(selected, owner, nextRival, new Date().toISOString()); }); }}><option value="">Seleccionar…</option>{players.filter((player) => player.id !== ownerId).map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select></label>
        <label className={styles.field}>Modo<select value={(bet.advantageMode || "current_index") === "sliding" ? "sliding" : "current_index"} onChange={(event) => updatePersonal(bet.id, (currentBet) => event.target.value === "sliding" ? configureSlidingPersonal(currentBet, signedAdvantage) : configureCurrentIndexPersonal(currentBet, owner, rival, new Date().toISOString()))}><option value="current_index">Índice actual</option><option value="sliding">Sliding</option></select></label>
        <div className={styles.fieldsRow}><Field label="Valor por componente" value={bet.baseValue} onChange={(baseValue) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, baseValue }))} />{(bet.advantageMode || "current_index") === "sliding" ? <Field label="Ventaja firmada" value={signedAdvantage} min={-54} max={54} onChange={(next) => updatePersonal(bet.id, (currentBet) => configureSlidingPersonal(currentBet, next))} /> : <label className={styles.field}>Ventaja desde índices<input value={bet.ownerIndexSnapshot && bet.rivalIndexSnapshot ? `${bet.advantageReceiver === "owner" ? "Dueño" : bet.advantageReceiver === "rival" ? "Rival" : "Nadie"} recibe ${bet.advantageStrokes}` : "Falta HCP/index"} readOnly /></label>}<Field label="Presión" value={bet.pressureMultiplier ?? 1} min={1} max={5} onChange={(pressureMultiplier) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, pressureMultiplier: pressureMultiplier as 1 | 2 | 3 | 4 | 5 }))} /></div>
        <label className={styles.check}><input type="checkbox" checked={Boolean(bet.carryEnabled)} onChange={(event) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, carryEnabled: event.target.checked }))} />Carry</label>
      </article>;
    })}<button type="button" className="secondary" onClick={() => runActivation(() => onChange((current) => ({ ...current, personalBets: [...current.personalBets, personalDefault(players, ownerId, current)] })))}>+ Otra Personal</button></section>}

    <SupplementalBetsEditor bets={value.supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestActivation} locked={locked} types={["team_pressures", "chicago", "vegas", "minimum_putts"]} roundHoles={value.roundDefaults.roundHoles} />
    <SupplementalBetsEditor bets={value.supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestActivation} locked={locked} types={["dollar_stroke", "individual_pressures"]} roundHoles={value.roundDefaults.roundHoles} />
    {value.supplementalBets.some((bet) => bet.type === "individual_nassau") && <SupplementalBetsEditor bets={value.supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestActivation} locked={locked} types={["individual_nassau"]} roundHoles={value.roundDefaults.roundHoles} allowAdd={false} />}

    {value.manualBets.some((bet) => bet.enabled !== false) && <section className={styles.collection}><h3>Manuales</h3>{value.manualBets.map((bet, index) => <article className={styles.instance} key={bet.id}><div className={styles.instanceHead}><b>Manual {index + 1}</b><button type="button" className="textButton" onClick={() => onChange((current) => ({ ...current, manualBets: current.manualBets.filter((item) => item.id !== bet.id) }))}>Quitar</button></div><label className={styles.field}>Nombre<input value={bet.name} maxLength={80} onChange={(event) => onChange((current) => ({ ...current, manualBets: current.manualBets.map((item) => item.id === bet.id ? { ...item, name: event.target.value } : item) }))} /></label><small>Los importes se capturan en cada ronda y empiezan en cero.</small></article>)}<button type="button" className="secondary" onClick={() => onChange((current) => ({ ...current, manualBets: [...current.manualBets, { id: makeId("manual"), enabled: true, name: `Apuesta manual ${current.manualBets.length + 1}`, amounts: Object.fromEntries(players.map((player) => [player.id, 0])) }] }))}>+ Otra manual</button></section>}
  </div>;
}
