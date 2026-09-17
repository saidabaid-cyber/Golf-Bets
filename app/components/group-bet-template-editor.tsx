"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { playOrder, segmentDefinitions } from "../../lib/engine";
import { defaultFoursomeMatchPress } from "../../lib/foursome-config";
import { defaultMaxBaseAppearances, generateAutomaticFoursomes, markFoursomeSegmentEdited } from "../../lib/foursome-generator";
import { configureCurrentIndexPersonal, configureSlidingPersonal } from "../../lib/personal-modes";
import {
  groupTemplateCoreDefinitions,
  groupTemplateEmbeddedSupplementalTypes,
  groupTemplateSelectableSupplementalTypes,
  groupTemplateSelectionDefinitions,
  type GroupTemplateCoreKey,
} from "../../lib/bets/registry";
import { createSupplementalBet } from "../../lib/supplemental-bets";
import { activeGroupTemplateDefinitions, groupTemplateConfigurationIssues, patchGroupTemplateCore } from "../../lib/group-template-editor";
import type { FoursomeMatchPress, GroupGameTemplate, PersonalBet, Player, SupplementalBet } from "../../lib/types";
import { SupplementalBetsEditor } from "./supplemental-bets-editor";
import { NumericCaptureInput } from "./numeric-capture-input";
import { HandicapBaseControl } from "./handicap-base-control";
import styles from "./group-bet-template-editor.module.css";

function makeId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function coreConfig(template: GroupGameTemplate, key: GroupTemplateCoreKey) {
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

export function GroupBetTemplateEditor({ value, players, ownerId, mode, onChange, locked = false, requestActivation, onlyBetId }: {
  value: GroupGameTemplate;
  players: Player[];
  ownerId: string;
  mode: "selection" | "details" | "complete";
  onChange: Dispatch<SetStateAction<GroupGameTemplate>>;
  locked?: boolean;
  requestActivation?: () => Promise<boolean>;
  /** Internal detail focus: use the same controls inline instead of a second editor. */
  onlyBetId?: string;
}) {
  const [expandedBetId, setExpandedBetId] = useState<string | null>(null);
  const [foursomeMaxBaseAppearances, setFoursomeMaxBaseAppearances] = useState(() => defaultMaxBaseAppearances(value.betConfig.foursome.segmentSize));
  const [foursomeMessage, setFoursomeMessage] = useState("");
  const runActivation = (action: () => void) => {
    if (!requestActivation) { action(); return; }
    void requestActivation().then((accepted) => { if (accepted) action(); });
  };
  const updateCore = (key: GroupTemplateCoreKey, patch: Record<string, unknown>) => onChange((current) => patchGroupTemplateCore(current, key, patch));
  const toggleCore = (key: GroupTemplateCoreKey) => {
    const enabled = Boolean(coreConfig(value, key)?.enabled);
    const counterDefaults = !enabled && (key === "vipers" || key === "camels" || key === "fish")
      ? { settlementMode: value.betConfig[key].settlementMode ?? "round", determinationMode: value.betConfig[key].determinationMode ?? "last_event", mostEventsTieRule: value.betConfig[key].mostEventsTieRule ?? "tied_players_pay" }
      : {};
    const apply = () => updateCore(key, { enabled: !enabled, ...counterDefaults });
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
  const personalEnabled = value.personalBets.some((bet) => bet.enabled !== false) || value.supplementalBets.some((bet) => bet.type === "individual_nassau" && bet.enabled);
  const togglePersonal = () => {
    const apply = () => onChange((current) => ({
      ...current,
      personalBets: current.personalBets.length
        ? current.personalBets.map((bet) => ({ ...bet, enabled: !personalEnabled }))
        : personalEnabled ? [] : [personalDefault(players, ownerId, current)],
      supplementalBets: current.supplementalBets.map((bet) => bet.type === "individual_nassau" ? { ...bet, enabled: !personalEnabled } : bet),
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
  const addFoursomeMatchPress = () => onChange((current) => {
    const existing = current.betConfig.foursome.matchPresses ?? [];
    if (current.betConfig.foursome.mode !== "match" || existing.length >= 18) return current;
    const press = defaultFoursomeMatchPress(makeId("match-press"), current.roundDefaults.startHole, current.roundDefaults.roundHoles);
    if (!press) return current;
    return { ...current, betConfig: { ...current.betConfig, foursome: { ...current.betConfig.foursome, pressureMultiplier: 1, pressSecond9: false, matchPresses: [...existing, press] } } };
  });
  const updateFoursomeMatchPress = (id: string, patch: Partial<FoursomeMatchPress>) => onChange((current) => ({
    ...current,
    betConfig: { ...current.betConfig, foursome: { ...current.betConfig.foursome, matchPresses: (current.betConfig.foursome.matchPresses ?? []).map((press) => press.id === id ? { ...press, ...patch } : press) } },
  }));
  const removeFoursomeMatchPress = (id: string) => onChange((current) => ({
    ...current,
    betConfig: { ...current.betConfig, foursome: { ...current.betConfig.foursome, matchPresses: (current.betConfig.foursome.matchPresses ?? []).filter((press) => press.id !== id) } },
  }));
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

  const selectionState = (item: ReturnType<typeof groupTemplateSelectionDefinitions>[number]) => {
    const editor = item.templateEditor;
    if (editor.kind === "core") return Boolean(coreConfig(value, editor.key)?.enabled);
    if (editor.kind === "personal") return personalEnabled;
    if (editor.kind === "manual") return manualEnabled;
    return value.supplementalBets.some((bet) => bet.type === editor.type && bet.enabled);
  };
  const toggleSelection = (item: ReturnType<typeof groupTemplateSelectionDefinitions>[number]) => {
    const editor = item.templateEditor;
    if (editor.kind === "core") toggleCore(editor.key);
    else if (editor.kind === "personal") togglePersonal();
    else if (editor.kind === "manual") toggleManual();
    else if (editor.type !== "individual_nassau") toggleSupplemental(editor.type);
  };

  const issues = groupTemplateConfigurationIssues(value, players);
  const preferences = <section className={styles.basisCard} aria-label="Preferencias de la plantilla">
    <div><b>Preferencias de ronda</b><small>Se pueden ajustar al iniciar. Campo, tee y parejas pendientes se completan para cada salida.</small></div>
    <div className={styles.fieldsRow}>
      <label className={styles.field}>Hoyos habituales<select disabled={locked} value={value.roundDefaults.roundHoles} onChange={(event) => onChange((current) => ({ ...current, roundDefaults: { ...current.roundDefaults, roundHoles: Number(event.target.value) as 9 | 18 } }))}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></label>
      <label className={styles.field}>Salida habitual<select disabled={locked} value={value.roundDefaults.startHole} onChange={(event) => onChange((current) => ({ ...current, roundDefaults: { ...current.roundDefaults, startHole: Number(event.target.value) as 1 | 10 } }))}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></label>
      <label className={styles.field}>Jugador principal de personales<select disabled={locked} value={value.ownerMemberId} onChange={(event) => onChange((current) => ({ ...current, ownerMemberId: event.target.value }))}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
      <label className={styles.field}>Base de ventajas<select disabled={locked} value={value.roundDefaults.handicapBasis} onChange={(event) => onChange((current) => ({ ...current, roundDefaults: { ...current.roundDefaults, handicapBasis: event.target.value as "relative" | "course" } }))}><option value="relative">Entre jugadores</option><option value="course">Sobre campo</option></select></label>
    </div>
    {value.roundDefaults.roundHoles === 18 && <small>Presiones de segunda vuelta: H{roundOrder[9]}–H{roundOrder.at(-1)}, según el orden de juego.</small>}
    {issues.pending.length > 0 && <div className={styles.pending} role="status"><b>Completar al crear la ronda</b><ul>{issues.pending.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul><small>La preferencia se conserva. No se inventarán participantes, HCP ni parejas.</small></div>}
    {issues.blocking.length > 0 && <div className={styles.pending} role="status"><b>Revisar configuración</b><ul>{issues.blocking.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div>}
  </section>;

  if (mode === "selection" || mode === "complete") return <div className={styles.selection}>
    <p className={styles.intro}>{mode === "selection" ? "Selecciona las modalidades; sus valores y reglas se ajustan en el siguiente paso." : "Activa una apuesta para configurar sus reglas aquí mismo. Todo se podrá cambiar para una ronda sin modificar la plantilla."}</p>
    {mode === "complete" && preferences}
    <div className={styles.modeGrid}>
      {groupTemplateSelectionDefinitions().map((item) => {
        const active = selectionState(item);
        const expanded = active && expandedBetId === item.id;
        return <section className={styles.modeSection} key={item.id}>
          <div className={styles.modeCard}><span className={styles.modeIcon}>{item.icon}</span><span><b>{item.id === "personals" ? "Nassau / Personales" : item.label}</b><small>{item.description}</small>{active && mode === "complete" && <button type="button" className={styles.configureButton} disabled={locked} aria-expanded={expanded} aria-controls={`group-template-${item.id}`} onClick={() => setExpandedBetId(expanded ? null : item.id)}>{expanded ? "Cerrar configuración" : "Configurar / editar"}</button>}</span><Switch checked={active} label={item.label} disabled={locked} onChange={() => { if (!active) setExpandedBetId(item.id); toggleSelection(item); }} /></div>
          {mode === "complete" && expanded && <div id={`group-template-${item.id}`} className={styles.inlineEditor}><GroupBetTemplateEditor value={value} players={players} ownerId={ownerId} mode="details" onlyBetId={item.id} onChange={onChange} locked={locked} requestActivation={requestActivation} /></div>}
        </section>;
      })}
    </div>
  </div>;

  if (!onlyBetId) return <div className={styles.details}>
    {preferences}
    {activeGroupTemplateDefinitions(value).map(item => <details key={item.id} className={styles.detailCard}>
      <summary><span>{item.icon} {item.label}</span><small>{item.id === "personals" ? "Editar personales" : "Editar"}</small></summary>
      <fieldset disabled={locked} className={styles.inlineEditor}><GroupBetTemplateEditor value={value} players={players} ownerId={value.ownerMemberId} mode="details" onlyBetId={item.id} onChange={onChange} locked={locked} requestActivation={requestActivation} /></fieldset>
    </details>)}
  </div>;

  return <div className={styles.details}>
    {!onlyBetId && <><p className={styles.intro}>Toca una apuesta para editarla. Los resultados nunca se guardan aquí.</p>{preferences}</>}
    {groupTemplateCoreDefinitions().filter((item) => (!onlyBetId || item.id === onlyBetId) && Boolean(coreConfig(value, item.templateEditor.key)?.enabled)).map((item) => {
      const key = item.templateEditor.key;
      const config = coreConfig(value, key)!;
      return <details className={styles.detailCard} key={item.id} open={onlyBetId ? true : undefined}><summary><span>{item.icon} {item.label}</span><small>{item.description} · Editar</small></summary><fieldset disabled={locked}>
        <button type="button" className={styles.removeBet} onClick={() => updateCore(key, { enabled: false })}>Quitar esta apuesta</button>
        {"value" in config && <Field label={key === "vipers" || key === "camels" || key === "fish" ? "Importe por evento" : key === "monkey" || key === "ballFriend" ? "Importe por punto" : key === "skins" ? "Importe por skin" : key === "rabbits" ? "Importe por conejo" : key === "units" ? "Importe por unidad" : "Importe por participante"} value={config.value} step={0.01} onChange={(next) => updateCore(key, { value: next })} />}
        {"hcpPct" in config && <Field label="HCP %" value={config.hcpPct} min={0} max={100} onChange={(next) => updateCore(key, { hcpPct: next })} />}
        {"decimals" in config && <label className={styles.field}>Redondeo HCP<select value={String(config.decimals)} onChange={(event) => updateCore(key, { decimals: event.target.value })}>{key === "rabbits" || key === "skins" ? <><option value="decimal">Mantener decimales</option><option value="half_up">.5 hacia arriba</option><option value="half_down">.5 hacia abajo</option><option value="six_up">.6 hacia arriba</option><option value="four_down">.4 hacia abajo</option></> : <option value="partial">Ventaja parcial</option>}<option value="round">Redondeo normal</option></select></label>}
        {(key === "foursome" || key === "ballFriend") && value.roundDefaults.handicapBasis === "relative" && <HandicapBaseControl name={item.label} config={value.betConfig[key]} fallback={key === "foursome" ? "moving" : "fixed"} onChange={(baseMode) => updateCore(key, { baseMode, fixedBaseHandicap: undefined })} />}
        {key === "rabbits" && <><label className={styles.field}>Formato<select value={value.betConfig.rabbits.mode || "continuous"} onChange={(event) => updateCore(key, { mode: event.target.value, ...(event.target.value === "continuous" ? { accumulate: true } : {}) })}><option value="continuous">Conejos infinitos / continuos</option><option value="three_hole_blocks">6 conejos fijos · bloques de 3 hoyos</option></select></label><label className={styles.check}><input type="checkbox" checked={value.betConfig.rabbits.accumulate} onChange={(event) => updateCore(key, { accumulate: event.target.checked })} />Acumular cuando queda libre</label></>}
        {key === "skins" && <label className={styles.field}>Acumulación<select value={value.betConfig.skins.mode || "carry"} onChange={(event) => updateCore(key, { mode: event.target.value, accumulate: event.target.value === "carry" })}><option value="carry">Acumulados · Carry al siguiente hoyo</option><option value="no_carry">No acumulados</option></select></label>}
        {key === "units" && <Field label="Valor de Copa" value={value.betConfig.units.copaValue ?? value.betConfig.units.value} step={0.01} onChange={(copaValue) => updateCore(key, { copaValue })} />}
        {key === "foursome" && <>
          <div className={styles.fieldsRow}>
            <label className={styles.field}>Modalidad<select value={value.betConfig.foursome.mode} onChange={(event) => {
              const mode = event.target.value as GroupGameTemplate["betConfig"]["foursome"]["mode"];
              updateCore(key, { mode, ...(mode === "match" ? { segmentSize: 18, pressureMultiplier: 1, pressSecond9: false, matchPresses: value.betConfig.foursome.matchPresses ?? [] } : { matchPresses: undefined }) });
              if (mode === "match") setFoursomeSegmentSize(18);
            }}><option value="fixed">Fijo</option><option value="fixed_points">Fijo + Patada</option><option value="points">Solo puntos / patada</option><option value="match" disabled={value.roundDefaults.roundHoles !== 18}>Match · Primera / Segunda / Total</option></select></label>
            {(value.betConfig.foursome.mode === "fixed" || value.betConfig.foursome.mode === "fixed_points" || value.betConfig.foursome.mode === "match") && <Field label={value.betConfig.foursome.mode === "match" ? "Valor por Match" : "Valor fijo"} value={value.betConfig.foursome.fixedValue} step={0.01} onChange={(fixedValue) => updateCore(key, { fixedValue })} />}
            {(value.betConfig.foursome.mode === "points" || value.betConfig.foursome.mode === "fixed_points") && <Field label="Valor por punto / patada" value={value.betConfig.foursome.pointValue} step={0.01} onChange={(pointValue) => updateCore(key, { pointValue })} />}
            <label className={styles.field}>Tramos<select disabled={value.betConfig.foursome.mode === "match"} value={value.betConfig.foursome.mode === "match" ? 18 : value.betConfig.foursome.segmentSize} onChange={(event) => setFoursomeSegmentSize(Number(event.target.value) as 3 | 6 | 9 | 18)}><option value="3">3 hoyos</option><option value="6">6 hoyos</option><option value="9">9 hoyos</option><option value="18">18 hoyos</option></select></label>
            {value.betConfig.foursome.mode !== "match" && <Field label="Máximo en pareja base" value={foursomeMaxBaseAppearances} min={1} max={18} onChange={(next) => setFoursomeMaxBaseAppearances(Math.max(1, Math.trunc(next)))} />}
            {value.roundDefaults.roundHoles === 18 && value.betConfig.foursome.mode !== "match" && <label className={styles.field}>Presión · segunda vuelta<select value={value.betConfig.foursome.pressureMultiplier ?? (value.betConfig.foursome.pressSecond9 ? 2 : 1)} onChange={(event) => updateCore(key, { pressureMultiplier: Number(event.target.value), pressSecond9: Number(event.target.value) > 1 })}><option value="1">Sin presión</option><option value="2">2x</option><option value="3">3x</option><option value="4">4x</option><option value="5">5x</option></select></label>}
          </div>
          {value.betConfig.foursome.mode === "match" ? <p className={styles.editorMessage}>Parejas fijas · Primera, Segunda y Total se liquidan por separado.</p> : <button type="button" className="secondary" onClick={generateFoursomes}>Generar foursomes automáticamente</button>}
          {value.roundDefaults.roundHoles !== 18 && <p className={styles.matchPressureEmpty} role="status">Foursome Match y sus presionadas requieren 18 hoyos; esta salida es de 9. Las otras modalidades pueden guardarse.</p>}
          {value.betConfig.foursome.mode === "match" && value.roundDefaults.roundHoles === 18 && <section className={styles.matchPressureEditor} aria-label="Presionadas Match habituales">
            <div className={styles.matchPressureHeader}><div><b>Presionadas Match</b><small>Cada presión abre un partido independiente desde el hoyo elegido hasta el cierre de Primera, Segunda o Total.</small></div><button type="button" className="secondary" disabled={(value.betConfig.foursome.matchPresses ?? []).length >= 18} onClick={addFoursomeMatchPress}>+ Agregar presión</button></div>
            {(value.betConfig.foursome.matchPresses ?? []).length === 0 && <p className={styles.matchPressureEmpty}>Sin presionadas. Primera, Segunda y Total conservan el valor base.</p>}
            {(value.betConfig.foursome.matchPresses ?? []).map((press, index) => {
              const scopeHoles = press.scope === "first" ? roundOrder.slice(0, 9) : press.scope === "second" ? roundOrder.slice(9) : roundOrder;
              return <div className={styles.matchPressureRow} key={press.id}>
                <strong>Presión {index + 1}</strong>
                <label className={styles.field}>Partido<select value={press.scope} onChange={(event) => { const scope = event.target.value as FoursomeMatchPress["scope"]; const holes = scope === "first" ? roundOrder.slice(0, 9) : scope === "second" ? roundOrder.slice(9) : roundOrder; updateFoursomeMatchPress(press.id, { scope, startHole: holes[0] }); }}><option value="first">Primera</option><option value="second">Segunda</option><option value="total">Total</option></select></label>
                <label className={styles.field}>Empieza<select value={press.startHole} onChange={(event) => updateFoursomeMatchPress(press.id, { startHole: Number(event.target.value) })}>{scopeHoles.map((hole) => <option value={hole} key={hole}>Hoyo {hole}</option>)}</select></label>
                <label className={styles.field}>Valor<select value={press.multiplier} onChange={(event) => updateFoursomeMatchPress(press.id, { multiplier: Number(event.target.value) as FoursomeMatchPress["multiplier"] })}>{([2, 3, 4, 5] as const).map((multiplier) => <option value={multiplier} key={multiplier}>{multiplier}x</option>)}</select></label>
                <button type="button" className={styles.matchPressureRemove} aria-label={`Eliminar presión ${index + 1}`} onClick={() => removeFoursomeMatchPress(press.id)}>×</button>
              </div>;
            })}
          </section>}
          {foursomeMessage && <small className={styles.editorMessage} role="status">{foursomeMessage}</small>}
          <div className={styles.segmentList}>{value.foursomeSegments.map((segment) => <article key={segment.id}><div><b>H{roundOrder[segment.startIndex]}–{roundOrder[segment.endIndex]}</b><small>{segment.generatedByBackyard ? "Generada por Backyard" : "Editada manualmente"}</small></div><Participants players={players.filter((player) => value.betConfig.foursome.participantIds.includes(player.id))} selected={segment.basePair} onChange={(basePair) => onChange((current) => ({ ...current, foursomeSegments: current.foursomeSegments.map((segmentItem) => segmentItem.id === segment.id ? markFoursomeSegmentEdited({ ...segmentItem, basePair: basePair.slice(-2) }) : segmentItem) }))} /></article>)}</div>
        </>}
        {key === "ballFriend" && <><Field label="Score máximo" value={value.betConfig.ballFriend.maxScore} min={1} max={20} onChange={(maxScore) => updateCore(key, { maxScore })} /><p className={styles.intro}>Las parejas y el descanso se eligen por hoyo durante la ronda; esta plantilla conserva participantes, precio y reglas.</p></>}
        {(key === "vipers" || key === "camels" || key === "fish") && <label className={styles.check}><input type="checkbox" checked={Boolean(value.betConfig[key].secondNinePressed)} onChange={(event) => updateCore(key, { secondNinePressed: event.target.checked })} />Presión en segunda vuelta</label>}
        {(key === "vipers" || key === "camels" || key === "fish") && <>
          {value.betConfig[key].secondNinePressed && <label className={styles.field}>Multiplicador segunda vuelta<select value={value.betConfig[key].secondNineMultiplier ?? 2} onChange={(event) => updateCore(key, { secondNineMultiplier: Number(event.target.value) })}>{[2, 3, 4, 5].map((multiplier) => <option key={multiplier} value={multiplier}>{multiplier}x</option>)}</select><small>Aplica a la segunda vuelta realmente jugada; con salida H10, H1–9.</small></label>}
          <label className={styles.field}>¿Cómo se define quién se queda el animal?<select value={value.betConfig[key].determinationMode ?? "last_event"} onChange={(event) => updateCore(key, { settlementMode: "round", determinationMode: event.target.value })}><option value="last_event">El último en hacerlo</option><option value="most_events">El que más hizo</option></select></label>
          {(value.betConfig[key].determinationMode ?? "last_event") === "most_events" && <label className={styles.field}>Si hay empate, ¿qué pasa?<select value={value.betConfig[key].mostEventsTieRule ?? "tied_players_pay"} onChange={(event) => updateCore(key, { settlementMode: "round", mostEventsTieRule: event.target.value })}><option value="tied_players_pay">Los empatados lo pagan</option><option value="latest_tied_event">El último de los empatados en hacerlo</option></select></label>}
        </>}
        {key === "loba" && <><Field label="Valor de unidad" value={value.betConfig.loba.unitValue} onChange={(unitValue) => updateCore(key, { unitValue })} /><label className={styles.check}><input type="checkbox" checked={value.betConfig.loba.unitsEnabled} onChange={(event) => updateCore(key, { unitsEnabled: event.target.checked })} />Unidades activas</label>{value.betConfig.loba.unitsEnabled && <label className={styles.check}><input type="checkbox" checked={value.betConfig.loba.duplicateUnitsByMode} onChange={(event) => updateCore(key, { duplicateUnitsByMode: event.target.checked })} />Unidades también se duplican por modo · sola 2x / anticipada 3x</label>}</>}
        <span className={styles.fieldLabel}>Participantes</span><Participants players={players} selected={config.participantIds || []} onChange={(participantIds) => updateCore(key, { participantIds })} />
      </fieldset></details>;
    })}

    {(!onlyBetId || onlyBetId === "personals") && value.personalBets.some((bet) => bet.enabled !== false) && <section className={styles.collection}><h3>Nassau Individual / Personales</h3><p>Jugador principal: {players.find(player => player.id === ownerId)?.name || "Pendiente"}</p>{value.personalBets.filter(bet => bet.enabled !== false).map((bet, index) => {
      const owner = players.find((player) => player.id === ownerId);
      const rival = players.find((player) => player.id === bet.rivalPlayerId);
      const signedAdvantage = bet.slidingAdvantage ?? (bet.advantageReceiver === "owner" ? -bet.advantageStrokes : bet.advantageReceiver === "rival" ? bet.advantageStrokes : 0);
      return <article className={styles.instance} key={bet.id}>
        <div className={styles.instanceHead}><b>Personal {index + 1}</b><button type="button" className="textButton" onClick={() => onChange((current) => ({ ...current, personalBets: current.personalBets.filter((item) => item.id !== bet.id) }))}>Quitar</button></div>
        <label className={styles.field}>Rival<select value={bet.rivalPlayerId || ""} onChange={(event) => { const nextRival = players.find((player) => player.id === event.target.value); updatePersonal(bet.id, (currentBet) => { const selected = { ...currentBet, rivalMode: "group" as const, rivalPlayerId: nextRival?.id, rivalName: nextRival?.name || "Rival" }; return (currentBet.advantageMode || "current_index") === "sliding" ? configureSlidingPersonal(selected, signedAdvantage) : configureCurrentIndexPersonal(selected, owner, nextRival, new Date().toISOString()); }); }}><option value="">Seleccionar…</option>{players.filter((player) => player.id !== ownerId).map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select></label>
        <label className={styles.field}>Modo de ventaja<select value={bet.advantageMode || "current_index"} onChange={(event) => updatePersonal(bet.id, (currentBet) => event.target.value === "sliding" ? configureSlidingPersonal(currentBet, signedAdvantage) : event.target.value === "manual" ? { ...currentBet, advantageMode: "manual" } : configureCurrentIndexPersonal(currentBet, owner, rival, new Date().toISOString()))}><option value="current_index">Índice actual</option><option value="sliding">Sliding</option><option value="manual">Manual avanzada · sólo esta apuesta</option></select></label>
        <div className={styles.fieldsRow}><Field label="Valor por componente" value={bet.baseValue} step={0.01} onChange={(baseValue) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, baseValue }))} />{bet.advantageMode === "sliding" ? <Field label="Ventaja firmada" value={signedAdvantage} min={-54} max={54} onChange={(next) => updatePersonal(bet.id, (currentBet) => configureSlidingPersonal(currentBet, next))} /> : bet.advantageMode === "manual" ? <><label className={styles.field}>Quién recibe ventaja<select value={bet.advantageReceiver === "owner" ? "owner" : "rival"} onChange={(event) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, advantageReceiver: event.target.value as "owner" | "rival" }))}><option value="owner">{owner?.name || "Principal"}</option><option value="rival">{rival?.name || "Rival"}</option></select></label><Field label="Golpes de ventaja" value={bet.advantageStrokes} min={0} max={54} onChange={(advantageStrokes) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, advantageStrokes }))} /></> : <label className={styles.field}>Ventaja desde índices<input value={bet.ownerIndexSnapshot && bet.rivalIndexSnapshot ? `${bet.advantageReceiver === "owner" ? "Dueño" : bet.advantageReceiver === "rival" ? "Rival" : "Nadie"} recibe ${bet.advantageStrokes}` : "Completar HCP/index al crear ronda"} readOnly /></label>}
          {value.roundDefaults.roundHoles === 18 && <label className={styles.field}>Presión · segunda vuelta jugada<select value={bet.pressureMultiplier ?? bet.back9Multiplier ?? 1} onChange={(event) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5, back9Multiplier: 1, nassauVersion: 2 }))}><option value={1}>Sin presión</option>{[2, 3, 4, 5].map((multiplier) => <option value={multiplier} key={multiplier}>{multiplier}x</option>)}</select><small>H{roundOrder[9]}–H{roundOrder.at(-1)}; Total conserva el valor base.</small></label>}
        </div>
        <div className={styles.componentGrid} aria-label="Componentes Nassau Match y Medal">{(value.roundDefaults.roundHoles === 9 ? [["match1", "Match 9"], ["medal1", "Medal 9"]] : [["match1", "Match Primera"], ["medal1", "Medal Primera"], ["match2", "Match Segunda"], ["medal2", "Medal Segunda"], ["match18", "Match Total"], ["medal18", "Medal Total"]]).map(([component, label]) => <label key={component}><input type="checkbox" checked={Boolean(bet.components[component as keyof PersonalBet["components"]])} onChange={(event) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, components: { ...currentBet.components, [component]: event.target.checked } }))} />{label}</label>)}</div>
        <label className={styles.check}><input type="checkbox" checked={Boolean(bet.carryEnabled)} onChange={(event) => updatePersonal(bet.id, (currentBet) => ({ ...currentBet, carryEnabled: event.target.checked }))} />Carry</label>
      </article>;
    })}<button type="button" className="secondary" onClick={() => runActivation(() => onChange((current) => ({ ...current, personalBets: [...current.personalBets, personalDefault(players, ownerId, current)] })))}>+ Otra Personal</button></section>}

    <SupplementalBetsEditor bets={value.supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestActivation} locked={locked} types={groupTemplateSelectableSupplementalTypes().filter((type) => (!onlyBetId || type === onlyBetId) && value.supplementalBets.some(bet => bet.type === type && bet.enabled))} roundHoles={value.roundDefaults.roundHoles} detailsOnly initiallyExpandActive={Boolean(onlyBetId)} />
    {(!onlyBetId || onlyBetId === "personals") && value.supplementalBets.some((bet) => groupTemplateEmbeddedSupplementalTypes().includes(bet.type) && bet.enabled) && <SupplementalBetsEditor bets={value.supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestActivation} locked={locked} types={groupTemplateEmbeddedSupplementalTypes()} roundHoles={value.roundDefaults.roundHoles} detailsOnly allowAdd={false} initiallyExpandActive={Boolean(onlyBetId)} />}

    {(!onlyBetId || onlyBetId === "manuals") && manualEnabled && <section className={styles.collection}>
      <h3>Manuales</h3>
      <p>Importes iniciales por jugador: positivo recibe, negativo paga. Deben sumar $0. Puedes dejarlos en cero y completarlos en la ronda. No se copian resultados históricos.</p>
      {value.manualBets.filter(bet => bet.enabled !== false).map((bet, index) => <article className={styles.instance} key={bet.id}>
        <div className={styles.instanceHead}><b>Manual {index + 1}</b><button type="button" className="textButton" onClick={() => onChange((current) => ({ ...current, manualBets: current.manualBets.map(item => item.id === bet.id ? { ...item, enabled: false } : item) }))}>Quitar esta apuesta</button></div>
        <label className={styles.field}>Nombre<input value={bet.name} maxLength={80} onChange={(event) => onChange((current) => ({ ...current, manualBets: current.manualBets.map((item) => item.id === bet.id ? { ...item, name: event.target.value } : item) }))} /></label>
        <div className={styles.fieldsRow}>{players.map(player => <Field key={player.id} label={`Importe inicial · ${player.name}`} value={bet.initialAmounts?.[player.id] ?? 0} min={-Number.MAX_SAFE_INTEGER} step={0.01} onChange={amount => onChange(current => ({ ...current, manualBets: current.manualBets.map(item => item.id === bet.id ? { ...item, initialAmounts: { ...item.initialAmounts, [player.id]: amount } } : item) }))} />)}</div>
      </article>)}
      <button type="button" className="secondary" onClick={() => onChange((current) => ({ ...current, manualBets: [...current.manualBets, { id: makeId("manual"), enabled: true, name: `Apuesta manual ${current.manualBets.length + 1}`, amounts: Object.fromEntries(players.map((player) => [player.id, 0])) }] }))}>+ Otra manual</button>
    </section>}
  </div>;
}
