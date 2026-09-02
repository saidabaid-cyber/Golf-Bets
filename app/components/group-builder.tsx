"use client";

import { useMemo, useRef, useState } from "react";
import type { FrequentGroup, FrequentPlayer, Player } from "../../lib/types";
import {
  appendUniquePlayer,
  generateBalancedGroups,
  generateRandomGroups,
  groupsShareText,
  hasDuplicatePlayerNames,
  moveGroupPlayer,
  swapGroupPlayers,
  type GroupPlayer,
  type GroupTarget,
} from "../../lib/group-generator";
import { NumericCaptureInput } from "./numeric-capture-input";

const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);

export function GroupBuilder({ frequentPlayers, frequentGroups, onBack, onPlay, onSaveFrequentGroup, onEditFrequentGroup, onDeleteFrequentGroup }: {
  frequentPlayers: FrequentPlayer[];
  frequentGroups: FrequentGroup[];
  onBack: () => void;
  onPlay: (players: Player[]) => void;
  onSaveFrequentGroup: (name: string, players: Array<Pick<Player, "name" | "handicap">>) => boolean;
  onEditFrequentGroup: (group: FrequentGroup) => void;
  onDeleteFrequentGroup: (group: FrequentGroup) => void;
}) {
  const [players, setPlayers] = useState<GroupPlayer[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualHandicap, setManualHandicap] = useState<number | null>(null);
  const [target, setTarget] = useState<GroupTarget>(4);
  const [mode, setMode] = useState<"random" | "balanced">("random");
  const [groups, setGroups] = useState<GroupPlayer[][]>([]);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [swapA, setSwapA] = useState("");
  const [swapB, setSwapB] = useState("");
  const [saveIndex, setSaveIndex] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveAllOpen, setSaveAllOpen] = useState(false);
  const [saveAllNames, setSaveAllNames] = useState<string[]>([]);
  const [openSavedGroupMenu, setOpenSavedGroupMenu] = useState<string | null>(null);
  const drawSequence = useRef(0);
  const allHaveHcp = players.length > 0 && players.every((player) => typeof player.handicap === "number" && Number.isFinite(player.handicap));
  const playerOptions = useMemo(() => groups.flat(), [groups]);

  function add(player: GroupPlayer) {
    const next = appendUniquePlayer(players, player);
    if (next.length === players.length) setMessage("Este jugador ya está en la lista.");
    else {
      setPlayers(next);
      if (next.some((item) => typeof item.handicap !== "number" || !Number.isFinite(item.handicap))) setMode("random");
      setGroups([]);
      setMessage("");
    }
  }

  function addFrequentGroup(group: FrequentGroup) {
    let next = players;
    for (const member of group.players) next = appendUniquePlayer(next, { id: id(), name: member.name, handicap: member.handicap });
    setPlayers(next);
    if (next.some((item) => typeof item.handicap !== "number" || !Number.isFinite(item.handicap))) setMode("random");
    setGroups([]);
    setOpenSavedGroupMenu(null);
    setMessage(next.length === players.length ? "Todos los integrantes de ese grupo ya estaban incluidos." : "Grupo agregado sin duplicados.");
  }

  function draw() {
    if (players.length < 3) { setMessage("Agrega al menos 3 jugadores."); return; }
    if (hasDuplicatePlayerNames(players)) { setMessage("Este jugador ya está en la lista."); return; }
    drawSequence.current += 1;
    const seed = (Date.now() + drawSequence.current * 2654435761) >>> 0;
    const useBalancedMode = mode === "balanced" && allHaveHcp;
    const next = useBalancedMode ? generateBalancedGroups(players, target, seed) : generateRandomGroups(players, target, seed);
    if (!useBalancedMode && mode === "balanced") setMode("random");
    if (!next.length) { setMessage("No existe una distribución válida en grupos de 3 a 5 con este total."); return; }
    setGroups(next); setEditing(false); setMessage("");
  }

  async function share() {
    const text = groupsShareText(groups);
    try {
      if (navigator.share) {
        await navigator.share({ title: "The Backyard · Grupos", text });
        setMessage("Resumen compartido.");
        return;
      }
      await copySummary();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setMessage("Compartir cancelado.");
      else await copySummary();
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(groupsShareText(groups));
      setMessage("Resumen copiado.");
    } catch {
      setMessage("No se pudo compartir ni copiar el resumen.");
    }
  }

  function saveGroup(index: number) {
    if (!saveName.trim()) { setMessage("Escribe un nombre para el grupo frecuente."); return; }
    const saved = onSaveFrequentGroup(saveName.trim(), groups[index].map(({ name, handicap }) => ({ name, handicap })));
    if (!saved) { setMessage("Ya existe un grupo frecuente con ese nombre."); return; }
    setMessage("Grupo frecuente guardado."); setSaveIndex(null); setSaveName("");
  }

  function openSaveAll() {
    setSaveAllNames(groups.map((_, index) => `Grupo ${index + 1}`));
    setSaveAllOpen(true);
    setMessage("");
  }

  function saveAllGroups() {
    const cleaned = saveAllNames.map((name) => name.trim());
    if (cleaned.length !== groups.length || cleaned.some((name) => !name)) {
      setMessage("Escribe un nombre para cada grupo."); return;
    }
    const normalized = cleaned.map((name) => name.toLocaleLowerCase("es-MX"));
    const existing = new Set(frequentGroups.map((group) => group.name.trim().toLocaleLowerCase("es-MX")));
    if (new Set(normalized).size !== normalized.length || normalized.some((name) => existing.has(name))) {
      setMessage("Cada grupo necesita un nombre distinto que no exista todavía."); return;
    }
    const saved = groups.every((group, index) => onSaveFrequentGroup(cleaned[index], group.map(({ name, handicap }) => ({ name, handicap }))));
    if (!saved) { setMessage("No se pudieron guardar todos los grupos. Revisa sus nombres."); return; }
    setSaveAllOpen(false); setSaveAllNames([]); setMessage("Todos los grupos se guardaron como grupos frecuentes.");
  }

  return <>
    <section className="hero groupsHero"><div><div className="eyebrow">THE BACKYARD · GOLF</div><h1>Armar grupos</h1><p>Sortea foursomes sin iniciar una ronda. Nadie queda fuera.</p></div><button className="secondary" onClick={onBack}>← Volver a Inicio</button></section>
    <section className="card groupCapture"><div className="sectionTitle"><div><h2>Jugadores</h2><p>Frecuentes, grupos guardados o captura manual.</p></div><strong className="playerCounter">{players.length} jugadores</strong></div>
      {frequentPlayers.length > 0 && <><label className="miniLabel">Jugadores frecuentes</label><div className="chips">{frequentPlayers.map((player) => <button className="chipButton" key={player.id} onClick={() => add({ id: id(), name: player.name, handicap: player.handicap })}>+ {player.name}{typeof player.handicap === "number" ? ` · HCP ${player.handicap}` : ""}</button>)}</div></>}
      {frequentGroups.length > 0 && <><label className="miniLabel">Grupos guardados</label><div className="savedGroupManager">{frequentGroups.map((group) => <div className="savedGroupItem" key={group.id}>
        <button className="savedGroupLoad" onClick={() => addFrequentGroup(group)}><b>{group.name}</b><span>{group.players.length} jugadores · Toca para cargar</span></button>
        <button className="savedGroupMenuButton" aria-label={`Administrar ${group.name}`} aria-expanded={openSavedGroupMenu === group.id} onClick={() => setOpenSavedGroupMenu((current) => current === group.id ? null : group.id)}>⋮</button>
        {openSavedGroupMenu === group.id && <div className="savedGroupMenu" role="menu" aria-label={`Opciones de ${group.name}`}>
          <button role="menuitem" onClick={() => { setOpenSavedGroupMenu(null); onEditFrequentGroup(group); }}>Editar grupo</button>
          <button className="dangerGhost" role="menuitem" onClick={() => { setOpenSavedGroupMenu(null); onDeleteFrequentGroup(group); }}>Eliminar grupo</button>
        </div>}
      </div>)}</div></>}
      <div className="manualGroupPlayer"><label>Nombre<input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Nombre del jugador" /></label><label>HCP opcional<NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={54} value={manualHandicap} emptyWhenZero={false} placeholder="HCP" onValueChange={setManualHandicap} /></label><button className="secondary" disabled={!manualName.trim()} onClick={() => { add({ id: id(), name: manualName, handicap: manualHandicap }); setManualName(""); setManualHandicap(null); }}>Agregar</button></div>
      <div className="selectedGroupPlayers">{players.map((player) => <span key={player.id}>{player.name}<small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : "Sin HCP"}</small><button aria-label={`Quitar ${player.name}`} onClick={() => { setPlayers((current) => current.filter((item) => item.id !== player.id)); setGroups([]); }}>×</button></span>)}</div>
    </section>

    <section className="card"><h2>Configuración del sorteo</h2><div className="groupSettings"><div><label>Tamaño preferido</label><div className="segmented">{([3,4,5] as GroupTarget[]).map((size) => <button key={size} className={target === size ? "active" : ""} onClick={() => setTarget(size)}>Grupos de {size}</button>)}</div></div><div><label>Modo</label><div className="segmented"><button className={mode === "random" ? "active" : ""} onClick={() => setMode("random")}>Aleatorio</button><button className={mode === "balanced" ? "active" : ""} disabled={!allHaveHcp} onClick={() => setMode("balanced")}>Balanceado por HCP</button></div>{!allHaveHcp && <small className="hint">Captura HCP de todos para habilitar balanceado.</small>}</div></div><button className="primary big" onClick={draw}>Armar grupos</button></section>

    {message && <div className="notice" role="status">{message}</div>}
    {groups.length > 0 && <section className="generatedGroups"><div className="sectionTitle"><div><h2>Resultado</h2><p>Todos aparecen una sola vez.</p></div><button className="secondary" onClick={draw}>Volver a sortear</button></div>
      <div className="generatedGroupGrid">{groups.map((group, groupIndex) => <article className="generatedGroupCard" key={`group-${groupIndex}`}><div className="groupCardHead"><div><span>GRUPO {groupIndex + 1}</span><b>{group.length} jugadores</b></div><button className="secondary" onClick={() => onPlay(group.map((player) => ({ ...player })))}>Jugar con este grupo</button></div><ul>{group.map((player) => <li key={player.id}><span>{player.name}<small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : ""}</small></span>{editing && <select aria-label={`Mover ${player.name}`} value="" onChange={(event) => { setGroups(moveGroupPlayer(groups, player.id, Number(event.target.value))); }}><option value="">Mover a…</option>{groups.map((_, destination) => destination !== groupIndex && <option key={destination} value={destination}>Grupo {destination + 1}</option>)}</select>}</li>)}</ul>{saveIndex === groupIndex ? <div className="saveGeneratedGroup"><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Ej. Miércoles 8am" /><button className="primary" onClick={() => saveGroup(groupIndex)}>Guardar</button><button className="textButton" onClick={() => setSaveIndex(null)}>Cancelar</button></div> : <button className="textButton" onClick={() => { setSaveIndex(groupIndex); setSaveName(""); }}>Guardar como grupo frecuente</button>}</article>)}</div>
      {editing && <div className="swapEditor"><h3>Intercambiar jugadores</h3><select aria-label="Primer jugador a intercambiar" value={swapA} onChange={(event) => setSwapA(event.target.value)}><option value="">Primer jugador</option>{playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><select aria-label="Segundo jugador a intercambiar" value={swapB} onChange={(event) => setSwapB(event.target.value)}><option value="">Segundo jugador</option>{playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><button className="secondary" disabled={!swapA || !swapB} onClick={() => { setGroups(swapGroupPlayers(groups, swapA, swapB)); setSwapA(""); setSwapB(""); }}>Intercambiar</button></div>}
      <div className="groupResultActions"><button className="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Terminar edición" : "Editar manualmente"}</button><button className="secondary" onClick={openSaveAll}>Guardar grupos</button><button className="secondary" onClick={copySummary}>Copiar texto</button><button className="primary" onClick={share}>Compartir</button></div>
    </section>}

    {saveAllOpen && <div className="modalBackdrop"><section className="confirmDialog saveGroupsDialog" role="dialog" aria-modal="true" aria-labelledby="save-groups-title">
      <h2 id="save-groups-title">Guardar grupos frecuentes</h2>
      <p>Asigna un nombre distinto a cada grupo. Esto no inicia ni modifica una ronda.</p>
      <div className="saveAllGroupNames">{groups.map((group, index) => <label key={`save-${index}`}>Grupo {index + 1} · {group.length} jugadores<input value={saveAllNames[index] || ""} onChange={(event) => setSaveAllNames((current) => current.map((name, itemIndex) => itemIndex === index ? event.target.value : name))} placeholder={`Nombre del Grupo ${index + 1}`} /></label>)}</div>
      <div className="dialogActions"><button className="secondary" onClick={() => { setSaveAllOpen(false); setSaveAllNames([]); }}>Cancelar</button><button className="primary" onClick={saveAllGroups}>Guardar todos</button></div>
    </section></div>}
  </>;
}
