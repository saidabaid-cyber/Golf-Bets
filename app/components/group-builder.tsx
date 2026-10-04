"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FrequentGroup, FrequentGroupMember, FrequentPlayer, Player } from "../../lib/types";
import { frequentGroupTemplateSummary } from "../../lib/group-game-template";
import { HANDICAP_BASIS_LABELS, groupTemplatePresentationDetails } from "../../lib/group-template-editor";
import type { ConnectionPage, SocialPerson } from "../../lib/social-connections";
import { socialRequest } from "../../lib/social-activity-client";
import {
  appendUniquePlayer,
  generateBalancedGroups,
  generateRandomGroups,
  groupPlayerDuplicateReason,
  groupsShareText,
  hasDuplicateGroupPlayers,
  swapGroupPlayers,
  type GroupPlayer,
  type GroupTarget,
} from "../../lib/group-generator";
import { BottomBackAction } from "./bottom-back-action";
import { NumericCaptureInput } from "./numeric-capture-input";
import { ModalCloseButton, ModalShell } from "./modal-shell";
import { GroupInvitationInbox, GroupInviteManager } from "./group-invitations";
import { useBackyardAccount } from "./account-provider";
import { ProfileAvatarMedia } from "./profile-avatar-media";

const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);

function GroupPresetBetSummary({ group }: { group: FrequentGroup }) {
  const details = groupTemplatePresentationDetails(group);
  return <div className="groupPresetBetSummary"><b>Apuestas del grupo</b>{details.length
    ? <ul>{details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>
    : <span>{frequentGroupTemplateSummary(group)}</span>}</div>;
}

export function GroupSummary({ group }: { group: FrequentGroup }) {
  return <section className="groupWizardSummary" aria-label="Resumen del grupo"><h3>Resumen del grupo</h3><p>{group.players.length} jugadores</p><p><b>HCP:</b> {HANDICAP_BASIS_LABELS[group.gameTemplate?.roundDefaults.handicapBasis ?? "relative"]}</p><GroupPresetBetSummary group={group} /></section>;
}

export function GroupDetailDialog({ group, created, onClose, onEdit, onPlay }: {
  group: FrequentGroup; created: boolean; onClose: () => void; onEdit: () => void; onPlay: () => void;
}) {
  return <ModalShell open onClose={onClose} className="groupEditorDialog groupWizard" labelledBy="group-detail-title">
    {created && <div className="groupCreatedHeading"><span aria-hidden="true">✓</span><h2 id="group-detail-title">¡Grupo creado!</h2></div>}
    <h2 id={created ? undefined : "group-detail-title"}>{group.name}</h2><p>{group.players.length} jugadores</p>
    <div className="groupSelectedList">{group.players.map((member, index) => <div className="groupPersonRow" key={member.memberId || index}><span className="groupPersonAvatar" aria-hidden="true">{member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><span><b>{member.name}</b><small>{member.username ? `@${member.username} · ` : ""}{typeof member.handicap === "number" ? `HCP ${member.handicap}` : "HCP por completar"}{!member.accountUserId && <span className="groupGuestBadge">Sin app</span>}</small></span></div>)}</div>
    <GroupSummary group={group} />
    <div className="groupWizardActions">{created ? <button type="button" className="primary" onClick={onEdit}>Ver grupo</button> : <button type="button" className="secondary" onClick={onEdit}>Editar grupo</button>}<button type="button" className={created ? "secondary" : "primary"} onClick={onPlay}>Crear ronda con este grupo</button></div>
  </ModalShell>;
}

/** Read-only discovery. Adding a player changes the owner's draft, never social membership. */
export function GroupMemberSelection({ group, frequentPlayers, accessToken, onAdd, onRemove }: {
  group: FrequentGroup; frequentPlayers: FrequentPlayer[]; accessToken?: string | null;
  onAdd: (member: FrequentGroupMember) => void; onRemove: (index: number) => void;
}) {
  const [friends, setFriends] = useState<SocialPerson[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SocialPerson[]>([]);
  const [friendMessage, setFriendMessage] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [loadingFriends, setLoadingFriends] = useState(Boolean(accessToken));
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFriends([]); setFriendMessage(""); setLoadingFriends(Boolean(accessToken));
    if (accessToken) void socialRequest<ConnectionPage>("/api/social/connections", accessToken, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setFriends(data.people.filter(person => data.friends.includes(person.user_id) && !data.blocked.includes(person.user_id)));
    }).catch(() => { if (!controller.signal.aborted) setFriendMessage("No pudimos cargar tus amigos. Puedes buscar en Backyard y reabrir el grupo para reintentar."); }).finally(() => { if (!controller.signal.aborted) setLoadingFriends(false); });
    return () => controller.abort();
  }, [accessToken]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]); setSearchMessage(""); setSearching(false);
    if (!accessToken || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      setSearching(true);
      void socialRequest<{ users: SocialPerson[] }>(`/api/groups/users?q=${encodeURIComponent(query.trim())}`, accessToken, { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted) { setResults(data.users); setSearchMessage(data.users.length ? "" : "Sin coincidencias visibles."); }
      }).catch(() => { if (!controller.signal.aborted) setSearchMessage("No pudimos buscar. Reintenta con nombre o @usuario."); }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accessToken, query]);
  const knownHandicap = (person: SocialPerson) => group.players.find(member => member.accountUserId === person.user_id)?.handicap
    ?? frequentPlayers.find(member => member.accountUserId === person.user_id)?.handicap ?? null;
  const renderPerson = (person: SocialPerson, friend: boolean) => {
    const selectedIndex = group.players.findIndex(member => member.accountUserId === person.user_id);
    const selected = selectedIndex >= 0;
    const handicap = knownHandicap(person);
    return <li key={person.user_id} className="groupPersonRow"><span className="groupPersonAvatar"><ProfileAvatarMedia value={person.avatar_url} fallback={person.display_name[0] || "J"} /></span><span><b>{person.display_name}</b><small>@{person.username} · {typeof handicap === "number" ? `HCP ${handicap}` : "HCP por completar"}</small></span><button type="button" className="groupPersonAdd" aria-label={`${selected ? "Quitar" : "Agregar"} ${person.display_name}`} aria-pressed={selected} onClick={() => selected ? onRemove(selectedIndex) : onAdd({ memberId: `member-${id()}`, kind: "account", accountUserId: person.user_id, name: person.display_name, username: person.username, handicap })}>{selected ? "✓" : friend ? "+" : "+ Agregar"}</button></li>;
  };
  const filteredFriends = friends.filter(person => `${person.display_name} @${person.username}`.toLocaleLowerCase("es-MX").includes(friendQuery.trim().toLocaleLowerCase("es-MX")));
  return <>
    <section className="groupWizardBlock" aria-label="Mis amigos"><h3>Mis amigos</h3>{accessToken ? <><label>Buscar entre mis amigos<input type="search" value={friendQuery} onChange={event => setFriendQuery(event.target.value)} placeholder="Buscar entre mis amigos" /></label>{loadingFriends ? <p role="status">Cargando amigos…</p> : <><ul className="groupPeopleList">{filteredFriends.map(person => renderPerson(person, true))}</ul>{!friends.length && !friendMessage && <p className="hint">Todavía no tienes amigos guardados. Puedes buscar a un jugador en Backyard.</p>}{friends.length > 0 && !filteredFriends.length && <p className="hint">No hay amigos que coincidan.</p>}</>}{friendMessage && <p role="status">{friendMessage}</p>}</> : <p>Inicia sesión para ver tus amigos.</p>}</section>
    <section className="groupWizardBlock" aria-label="Buscar jugador en Backyard"><h3>Buscar jugador en Backyard</h3><label>Nombre o @usuario<input type="search" value={query} disabled={!accessToken} onChange={event => setQuery(event.target.value)} placeholder="Nombre o @usuario" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} /></label>{searching && <p role="status">Buscando…</p>}<ul className="groupPeopleList">{results.map(person => renderPerson(person, false))}</ul>{searchMessage && <p role="status">{searchMessage}</p>}<small>Agregar a tu plantilla no envía una invitación ni una solicitud de amistad.</small></section>
  </>;
}

export function GroupBuilder({ frequentPlayers, frequentGroups, onBack, onPlay, onSaveFrequentGroup, onCreateFrequentGroup, onOpenFrequentGroup, onStartFrequentGroup, onEditFrequentGroup, onDeleteFrequentGroup, onAcceptedMembers }: {
  frequentPlayers: FrequentPlayer[];
  frequentGroups: FrequentGroup[];
  onBack: () => void;
  onPlay: (players: Player[]) => void;
  onSaveFrequentGroup: (name: string, players: Array<Pick<Player, "name" | "handicap" | "accountUserId">>) => boolean;
  onCreateFrequentGroup: () => void;
  onOpenFrequentGroup: (group: FrequentGroup) => void;
  onStartFrequentGroup: (group: FrequentGroup) => void;
  onEditFrequentGroup: (group: FrequentGroup) => void;
  onDeleteFrequentGroup: (group: FrequentGroup) => void;
  onAcceptedMembers: (group: FrequentGroup, members: FrequentGroupMember[]) => void;
}) {
  const { identity, retryCloudSync } = useBackyardAccount();
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
  const [activeSection, setActiveSection] = useState<"groups" | "invitations">("groups");
  const [inviteGroupId, setInviteGroupId] = useState("");
  const drawSequence = useRef(0);
  const allHaveHcp = players.length > 0 && players.every((player) => typeof player.handicap === "number" && Number.isFinite(player.handicap));
  const playerOptions = useMemo(() => groups.flat(), [groups]);

  function add(player: GroupPlayer) {
    const duplicateReason = groupPlayerDuplicateReason(players, player);
    const next = appendUniquePlayer(players, player);
    if (next.length === players.length) setMessage(duplicateReason === "account" ? "Esta cuenta ya está incluida en la lista, aunque tenga otro nombre." : "Este jugador ya está en la lista.");
    else {
      setPlayers(next);
      if (next.some((item) => typeof item.handicap !== "number" || !Number.isFinite(item.handicap))) setMode("random");
      setGroups([]);
      setMessage("");
    }
  }

  function addFrequentGroup(group: FrequentGroup) {
    let next = players;
    for (const member of group.players) next = appendUniquePlayer(next, { id: id(), name: member.name, handicap: member.handicap, ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}) });
    setPlayers(next);
    if (next.some((item) => typeof item.handicap !== "number" || !Number.isFinite(item.handicap))) setMode("random");
    setGroups([]);
    setOpenSavedGroupMenu(null);
    setMessage(next.length === players.length ? "Todos los integrantes de ese grupo ya estaban incluidos." : "Grupo agregado sin duplicados.");
  }

  function draw() {
    if (players.length < 3) { setMessage("Agrega al menos 3 jugadores."); return; }
    if (hasDuplicateGroupPlayers(players)) { setMessage("Hay una cuenta o jugador repetido. Quítalo antes de armar los grupos."); return; }
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
    const saved = onSaveFrequentGroup(saveName.trim(), groups[index].map(({ name, handicap, accountUserId }) => ({ name, handicap, ...(accountUserId ? { accountUserId } : {}) })));
    if (!saved) { setMessage("Ya existe un grupo frecuente con ese nombre."); return; }
    setMessage("Grupo frecuente guardado."); setSaveIndex(null); setSaveName("");
  }

  function openSaveAll() {
    setSaveAllNames(groups.map((_, index) => `Grupo ${index + 1}`));
    setSaveAllOpen(true);
    setMessage("");
  }

  function closeSaveAll() {
    setSaveAllOpen(false);
    setSaveAllNames([]);
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
    const saved = groups.every((group, index) => onSaveFrequentGroup(cleaned[index], group.map(({ name, handicap, accountUserId }) => ({ name, handicap, ...(accountUserId ? { accountUserId } : {}) }))));
    if (!saved) { setMessage("No se pudieron guardar todos los grupos. Revisa sus nombres."); return; }
    setSaveAllOpen(false); setSaveAllNames([]); setMessage("Todos los grupos se guardaron como grupos frecuentes.");
  }

  return <>
    <section className="hero groupsHero"><div><h1>Mis grupos</h1><p>Crea y administra tus grupos de jugadores para rondas y apuestas.</p></div><div className="groupsHeroActions"><button className="secondary" onClick={onBack}>← Inicio</button><button className="primary" onClick={onCreateFrequentGroup}>+ Crear grupo</button></div></section>
    <div className="groupsLibraryTabs" role="tablist" aria-label="Secciones de Grupos">
      <button type="button" role="tab" aria-selected={activeSection === "groups"} className={activeSection === "groups" ? "active" : ""} onClick={() => setActiveSection("groups")}>Mis grupos</button>
      <button type="button" role="tab" aria-selected={activeSection === "invitations"} className={activeSection === "invitations" ? "active" : ""} onClick={() => setActiveSection("invitations")}>Invitaciones</button>
    </div>
    {activeSection === "invitations" && <div role="tabpanel"><GroupInvitationInbox accessToken={identity.accessToken} onAccepted={retryCloudSync} />{frequentGroups.length > 0 && <section className="card"><label>Administrar invitaciones de un grupo<select value={inviteGroupId} onChange={event => setInviteGroupId(event.target.value)}><option value="">Seleccionar grupo</option>{frequentGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{frequentGroups.filter(group => group.id === inviteGroupId).map(group => <GroupInviteManager key={group.id} group={group} accessToken={identity.accessToken} onAcceptedMembers={members => onAcceptedMembers(group, members)} />)}</section>}</div>}
    <div hidden={activeSection !== "groups"} role="tabpanel">
    {frequentGroups.length === 0 && <section className="card groupPresetEmpty"><h2>Mis grupos</h2><p>Todavía no tienes grupos guardados. Crea uno con tus jugadores y apuestas habituales.</p><button type="button" className="primary" onClick={onCreateFrequentGroup}>Crear grupo</button></section>}
    {frequentGroups.length > 0 && <section className="card groupPresetLibrary"><div className="groupPresetGrid">{frequentGroups.map((group) => <article className="groupPresetCard" key={`preset-${group.id}`}>
      <div><span className="templateSectionLabel">GRUPO</span><h3>{group.name}</h3><p>{group.players.length} miembros</p></div>
      <div className="groupPresetMembers" aria-label={`Jugadores de ${group.name}`}>{group.players.slice(0, 6).map((member, index) => <span key={member.memberId || `${member.name}-${index}`}>{member.name}</span>)}{group.players.length > 6 && <span>+{group.players.length - 6}</span>}</div>
      <p className="hint">HCP: {HANDICAP_BASIS_LABELS[group.gameTemplate?.roundDefaults.handicapBasis ?? "relative"]}</p><GroupPresetBetSummary group={group} />
      <div className="groupPresetActions"><button type="button" className="secondary" onClick={() => onOpenFrequentGroup(group)}>Ver grupo →</button><button type="button" className="primary" onClick={() => onStartFrequentGroup(group)}>Crear ronda</button></div>
    </article>)}</div></section>}
    <details className="groupDrawTools"><summary>Armar grupos · Sorteo y balanceado por HCP</summary><section className="card groupCapture"><div className="sectionTitle"><div><h2>Jugadores</h2><p>Frecuentes, grupos guardados o captura manual.</p></div><strong className="playerCounter">{players.length} jugadores</strong></div>
      {frequentPlayers.length > 0 && <details className="frequentDisclosure groupBuilderDisclosure"><summary><span>Jugadores frecuentes ({frequentPlayers.length})<small>Toca aquí para agregar un jugador</small></span></summary><div className="chips">{frequentPlayers.map((player) => <button className="chipButton" key={player.id} onClick={() => add({ id: id(), name: player.name, handicap: player.handicap, ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}) })}>+ {player.name}{typeof player.handicap === "number" ? ` · HCP ${player.handicap}` : ""}</button>)}</div></details>}
      {frequentGroups.length > 0 && <details className="frequentDisclosure groupBuilderDisclosure"><summary><span>Grupos guardados ({frequentGroups.length})<small>Toca aquí para agregar un grupo</small></span></summary><div className="savedGroupManager">{frequentGroups.map((group) => <div className="savedGroupItem" key={group.id}>
        <button className="savedGroupLoad" onClick={() => addFrequentGroup(group)}><b>{group.name}</b><span>{group.players.length} jugadores · Toca para cargar</span></button>
        <button className="savedGroupMenuButton" aria-label={`Administrar ${group.name}`} aria-expanded={openSavedGroupMenu === group.id} onClick={() => setOpenSavedGroupMenu((current) => current === group.id ? null : group.id)}>⋮</button>
        {openSavedGroupMenu === group.id && <div className="savedGroupMenu" role="menu" aria-label={`Opciones de ${group.name}`}>
          <button role="menuitem" onClick={() => { setOpenSavedGroupMenu(null); onEditFrequentGroup(group); }}>Editar grupo</button>
          <button className="dangerGhost" role="menuitem" onClick={() => { setOpenSavedGroupMenu(null); onDeleteFrequentGroup(group); }}>Eliminar grupo</button>
        </div>}
      </div>)}</div></details>}
      <div className="manualGroupPlayer"><label>Nombre<input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Nombre del jugador" /></label><label>HCP opcional<NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={36} value={manualHandicap} emptyWhenZero={false} placeholder="HCP" onValueChange={setManualHandicap} /></label><button className="secondary" disabled={!manualName.trim()} onClick={() => { add({ id: id(), name: manualName, handicap: manualHandicap }); setManualName(""); setManualHandicap(null); }}>Agregar</button></div>
      <div className="selectedGroupPlayers">{players.map((player) => <span key={player.id}>{player.name}<small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : "Sin HCP"}</small><button aria-label={`Quitar ${player.name}`} onClick={() => { setPlayers((current) => current.filter((item) => item.id !== player.id)); setGroups([]); }}>×</button></span>)}</div>
    </section>

    <section className="card"><h2>Configuración del sorteo</h2><div className="groupSettings"><div><label>Tamaño preferido</label><div className="segmented">{([3,4,5] as GroupTarget[]).map((size) => <button key={size} className={target === size ? "active" : ""} onClick={() => setTarget(size)}>Grupos de {size}</button>)}</div></div><div><label>Modo</label><div className="segmented"><button className={mode === "random" ? "active" : ""} onClick={() => setMode("random")}>Aleatorio</button><button className={mode === "balanced" ? "active" : ""} disabled={!allHaveHcp} onClick={() => setMode("balanced")}>Balanceado por HCP</button></div>{!allHaveHcp && <small className="hint">Captura HCP de todos para habilitar balanceado.</small>}</div></div><button className="primary big" onClick={draw}>Armar grupos</button></section>

    {message && <div className="notice" role="status">{message}</div>}
    {groups.length > 0 && <section className="generatedGroups"><div className="sectionTitle"><div><h2>Resultado</h2><p>Todos aparecen una sola vez.</p></div><button className="secondary" onClick={draw}>Volver a sortear</button></div>
      <div className="generatedGroupGrid">{groups.map((group, groupIndex) => <article className="generatedGroupCard" key={`group-${groupIndex}`}><div className="groupCardHead"><div><span>GRUPO {groupIndex + 1}</span><b>{group.length} jugadores</b></div><button className="secondary" onClick={() => onPlay(group.map((player) => ({ ...player })))}>Jugar con este grupo</button></div><ul>{group.map((player) => <li key={player.id}><span>{player.name}<small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : ""}</small></span></li>)}</ul>{saveIndex === groupIndex ? <div className="saveGeneratedGroup"><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Ej. Miércoles 8am" /><button className="primary" onClick={() => saveGroup(groupIndex)}>Guardar</button><button className="textButton" onClick={() => setSaveIndex(null)}>Cancelar</button></div> : <button className="textButton" onClick={() => { setSaveIndex(groupIndex); setSaveName(""); }}>Guardar como grupo frecuente</button>}</article>)}</div>
      {editing && <div className="swapEditor"><h3>Intercambiar jugadores</h3><select aria-label="Primer jugador a intercambiar" value={swapA} onChange={(event) => setSwapA(event.target.value)}><option value="">Primer jugador</option>{playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><select aria-label="Segundo jugador a intercambiar" value={swapB} onChange={(event) => setSwapB(event.target.value)}><option value="">Segundo jugador</option>{playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><button className="secondary" disabled={!swapA || !swapB} onClick={() => { setGroups(swapGroupPlayers(groups, swapA, swapB)); setSwapA(""); setSwapB(""); }}>Intercambiar</button></div>}
      <div className="groupResultActions"><button className="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Terminar edición" : "Editar manualmente"}</button><button className="secondary" onClick={openSaveAll}>Guardar grupos</button><button className="secondary" onClick={copySummary}>Copiar texto</button><button className="primary" onClick={share}>Compartir</button></div>
    </section>}

    </details><BottomBackAction label="← Inicio" onBack={onBack} />

    {saveAllOpen && <div className="modalBackdrop"><section className="confirmDialog saveGroupsDialog" role="dialog" aria-modal="true" aria-labelledby="save-groups-title">
      <ModalCloseButton onClose={closeSaveAll} />
      <h2 id="save-groups-title">Guardar grupos frecuentes</h2>
      <p>Asigna un nombre distinto a cada grupo. Esto no inicia ni modifica una ronda.</p>
      <div className="saveAllGroupNames">{groups.map((group, index) => <label key={`save-${index}`}>Grupo {index + 1} · {group.length} jugadores<input value={saveAllNames[index] || ""} onChange={(event) => setSaveAllNames((current) => current.map((name, itemIndex) => itemIndex === index ? event.target.value : name))} placeholder={`Nombre del Grupo ${index + 1}`} /></label>)}</div>
      <div className="dialogActions"><button className="secondary" onClick={closeSaveAll}>Cancelar</button><button className="primary" onClick={saveAllGroups}>Guardar todos</button></div>
    </section></div>}
    </div>
  </>;
}
