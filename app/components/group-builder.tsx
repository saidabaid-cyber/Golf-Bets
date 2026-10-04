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
import { ModalShell } from "./modal-shell";
import { GroupInviteManager } from "./group-invitations";
import { useBackyardAccount } from "./account-provider";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./group-builder.module.css";

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

function MemberInitial({ name }: { name: string }) {
  return <span className="groupPersonAvatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span>;
}

export function compactGroupBetSummary(group: FrequentGroup) {
  const details = groupTemplatePresentationDetails(group);
  const labels = details.slice(0, 2).map(detail => detail.replace(/^Foursome · .*? · /, "Foursome ").replace(/ · \d+ hoyos$/, ""));
  return labels.length ? `${labels.join(" · ")}${details.length > 2 ? ` · +${details.length - 2}` : ""}` : "Sin apuestas";
}

export function GroupLibraryView({ groups, onCreate, onDraw, onOpen, onPlay }: {
  groups: FrequentGroup[]; onCreate: () => void; onDraw: () => void;
  onOpen: (group: FrequentGroup) => void; onPlay: (group: FrequentGroup) => void;
}) {
  return <section className={styles.library} aria-labelledby="groups-library-title">
    <header className={styles.header}><h1 id="groups-library-title">Mis grupos</h1><p>Crea y administra tus grupos de jugadores para rondas y apuestas.</p><div className={styles.actions}><button type="button" className="primary" onClick={onCreate}>+ Crear grupo</button><button type="button" className="secondary" onClick={onDraw}>Armar grupos</button></div></header>
    {!groups.length && <p className="card">Todavía no tienes grupos guardados. Crea uno con tus jugadores y apuestas habituales.</p>}
    <div className={styles.libraryList}>{groups.map(group => <article className={styles.libraryCard} key={group.id}>
      <button type="button" className={styles.cardOpen} aria-label={`Abrir grupo ${group.name}`} onClick={() => onOpen(group)}>
        <strong className={styles.cardName}>{group.name}</strong><span className={styles.avatarStack} aria-hidden="true">{group.players.slice(0, 3).map((member, index) => <MemberInitial key={member.memberId || index} name={member.name} />)}{group.players.length > 3 && <span>+{group.players.length - 3}</span>}</span>
        <span className={styles.cardCount}>{group.players.length} jugadores</span><span className={styles.cardHcp}>HCP · {group.gameTemplate?.roundDefaults.handicapBasis === "course" ? "Completo" : "Diferencial"}</span><span className={styles.cardBets}>{compactGroupBetSummary(group)}</span>
      </button><button type="button" className={styles.quickPlay} aria-label={`Crear ronda con ${group.name}`} onClick={() => onPlay(group)}>Crear ronda</button>
    </article>)}</div>
  </section>;
}

export function GroupDetailView({ group, onBack, onEdit, onPlay, onDelete, onAcceptedMembers }: {
  group: FrequentGroup; onBack: () => void; onEdit: () => void; onPlay: () => void; onDelete: () => void;
  onAcceptedMembers: (members: FrequentGroupMember[]) => void;
}) {
  const { identity } = useBackyardAccount();
  const [managing, setManaging] = useState(false);
  if (managing) return <section className={styles.detail}><button type="button" className="textButton" onClick={() => setManaging(false)}>← {group.name}</button><header className={styles.header}><h1>Invitar / administrar integrantes</h1><p>{group.name}</p></header><GroupInviteManager group={group} accessToken={identity.accessToken} onAcceptedMembers={onAcceptedMembers} /></section>;
  return <section className={styles.detail} aria-labelledby="group-detail-page-title"><button type="button" className="textButton" onClick={onBack}>← Mis grupos</button>
    <header className={styles.header}><h1 id="group-detail-page-title">{group.name}</h1><p>{group.players.length} jugadores</p></header>
    <section className="card"><h2>Jugadores</h2><div className="groupSelectedList">{group.players.map((member, index) => <div className="groupPersonRow" key={member.memberId || index}><MemberInitial name={member.name} /><span><b>{member.name}</b><small>{member.username ? `@${member.username} · ` : ""}{typeof member.handicap === "number" ? `HCP ${member.handicap}` : "HCP por completar"}{!member.accountUserId && <span className="groupGuestBadge">Sin app</span>}</small></span></div>)}</div></section>
    <section className="card"><h2>Configuración de HCP</h2><p>{HANDICAP_BASIS_LABELS[group.gameTemplate?.roundDefaults.handicapBasis ?? "relative"]}</p></section>
    <section className="card"><h2>Apuestas habituales</h2><GroupPresetBetSummary group={group} /></section>
    <div className={styles.detailActions}><button type="button" className="primary" onClick={onPlay}>Crear ronda con este grupo</button><button type="button" className="secondary" onClick={onEdit}>Editar grupo</button><button type="button" className="secondary" onClick={() => setManaging(true)}>Invitar / administrar integrantes</button><button type="button" className="dangerGhost" onClick={onDelete}>Eliminar grupo</button></div>
  </section>;
}

/** Read-only discovery. Adding a player changes the owner's draft, never social membership. */
export function GroupMemberSelection({ group, frequentPlayers, accessToken, onAdd, onRemove, friendsOnly = false }: {
  group: FrequentGroup; frequentPlayers: FrequentPlayer[]; accessToken?: string | null;
  onAdd: (member: FrequentGroupMember) => void; onRemove: (index: number) => void;
  friendsOnly?: boolean;
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
    {!friendsOnly && <section className="groupWizardBlock" aria-label="Buscar jugador en Backyard"><h3>Buscar jugador en Backyard</h3><label>Nombre o @usuario<input type="search" value={query} disabled={!accessToken} onChange={event => setQuery(event.target.value)} placeholder="Nombre o @usuario" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} /></label>{searching && <p role="status">Buscando…</p>}<ul className="groupPeopleList">{results.map(person => renderPerson(person, false))}</ul>{searchMessage && <p role="status">{searchMessage}</p>}<small>Agregar a tu plantilla no envía una invitación ni una solicitud de amistad.</small></section>}
  </>;
}

export function GroupBuilder({ frequentPlayers, frequentGroups, onBack, onPlay, onSaveFrequentGroup, onCreateFrequentGroup, onOpenFrequentGroup, onStartFrequentGroup, onEditFrequentGroup, onDeleteFrequentGroup, onAcceptedMembers, detailGroup, onCloseDetail }: {
  frequentPlayers: FrequentPlayer[];
  frequentGroups: FrequentGroup[];
  detailGroup?: FrequentGroup;
  onCloseDetail: () => void;
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
  const { identity } = useBackyardAccount();
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
  const [view, setView] = useState<"library" | "draw">("library");
  const libraryScroll = useRef(0);
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
    setMessage(next.length === players.length ? "Esos jugadores ya estaban seleccionados." : "Grupo agregado sin duplicados.");
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


  const detailId = detailGroup?.id;
  useEffect(() => { window.scrollTo({ top: detailId || view === "draw" ? 0 : libraryScroll.current }); }, [view, detailId]);
  const selection: FrequentGroup = { id: "draw-selection", name: "Armar grupos", uses: 0, updatedAt: "", players: players.map(player => ({ memberId: player.id, name: player.name, handicap: player.handicap, ...(player.accountUserId ? { accountUserId: player.accountUserId, kind: "account" as const } : { kind: "guest" as const }) })) };
  const knownPlayers = useMemo(() => [...frequentPlayers, ...frequentGroups.flatMap(group => group.players.map((member, index) => ({ id: member.memberId || String(index), name: member.name, handicap: member.handicap, accountUserId: member.accountUserId, uses: 0, updatedAt: group.updatedAt })))], [frequentPlayers, frequentGroups]);
  if (detailGroup) return <GroupDetailView key={detailGroup.id} group={detailGroup} onBack={onCloseDetail} onEdit={() => onEditFrequentGroup(detailGroup)} onPlay={() => onStartFrequentGroup(detailGroup)} onDelete={() => onDeleteFrequentGroup(detailGroup)} onAcceptedMembers={members => onAcceptedMembers(detailGroup, members)} />;
  if (view === "library") return <div className={styles.screen}><GroupLibraryView groups={frequentGroups} onCreate={onCreateFrequentGroup} onDraw={() => { libraryScroll.current = window.scrollY; setView("draw"); }} onOpen={group => { libraryScroll.current = window.scrollY; onOpenFrequentGroup(group); }} onPlay={onStartFrequentGroup} /><BottomBackAction label="← Inicio" onBack={onBack} /></div>;

  return <section className={styles.screen} aria-labelledby="group-draw-title">
    <button type="button" className="textButton" onClick={() => setView("library")}>← Mis grupos</button><header className={styles.header}><h1 id="group-draw-title">Armar grupos</h1><p>Sortea o balancea jugadores por HCP.</p></header>
    <section className="card"><div className="sectionTitle"><h2>Jugadores</h2><strong>{players.length} seleccionados</strong></div>
      <div className={styles.friendSource}><GroupMemberSelection friendsOnly group={selection} frequentPlayers={knownPlayers} accessToken={identity.accessToken} onAdd={member => add({ id: member.memberId || id(), name: member.name, handicap: member.handicap, ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}) })} onRemove={index => { setPlayers(current => current.filter((_, i) => i !== index)); setGroups([]); }} /></div>
      <section className={styles.source}><h3>Grupos guardados</h3><div className={styles.savedSources}>{frequentGroups.map(group => <button type="button" className="secondary" key={group.id} onClick={() => addFrequentGroup(group)}><b>{group.name}</b><span>{group.players.length} jugadores · + Cargar</span></button>)}</div>{!frequentGroups.length && <p className="hint">Todavía no tienes grupos guardados.</p>}</section>
      {frequentPlayers.length > 0 && <section className={styles.source}><h3>Jugadores frecuentes / sin app guardados</h3><div className={styles.frequentSource}>{frequentPlayers.map(player => <div className="groupPersonRow" key={player.id}><MemberInitial name={player.name} /><span><b>{player.name}</b><small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : "HCP por completar"}</small></span><button type="button" className="groupPersonAdd" aria-label={`Agregar frecuente ${player.name}`} onClick={() => add({ id: id(), name: player.name, handicap: player.handicap, ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}) })}>+</button></div>)}</div></section>}
      <section className={styles.source}><h3>Jugador sin app</h3><div className={styles.guestFields}><label>Nombre<input value={manualName} onChange={event => setManualName(event.target.value)} placeholder="Nombre del jugador" /></label><label>HCP opcional<NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={36} value={manualHandicap} emptyWhenZero={false} placeholder="HCP" onValueChange={setManualHandicap} /></label></div><button type="button" className="secondary" disabled={!manualName.trim()} onClick={() => { add({ id: id(), name: manualName.trim(), handicap: manualHandicap }); setManualName(""); setManualHandicap(null); }}>+ Agregar</button></section>
    </section>
    <section className="card" aria-label="Jugadores seleccionados"><h2>Seleccionados · {players.length}</h2>{!players.length && <p className="hint">Agrega amigos, carga un grupo o agrega un jugador sin app.</p>}<div className="groupSelectedList">{players.map(player => <div className="groupPersonRow" key={player.id}><MemberInitial name={player.name} /><span><b>{player.name}</b><small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : "HCP por completar"}{!player.accountUserId && <span className="groupGuestBadge">Sin app</span>}</small></span><button type="button" className="groupPersonRemove" aria-label={`Quitar seleccionado ${player.name}`} onClick={() => { setPlayers(current => current.filter(item => item.id !== player.id)); setGroups([]); }}>×</button></div>)}</div></section>
    <section className="card"><h2>Configuración del sorteo</h2><div className="groupSettings"><div><label>Tamaño preferido</label><div className="segmented">{([3,4,5] as GroupTarget[]).map(size => <button type="button" key={size} aria-pressed={target === size} className={target === size ? "active" : ""} onClick={() => setTarget(size)}>Grupos de {size}</button>)}</div></div><div><label>Modo</label><div className="segmented"><button type="button" aria-pressed={mode === "random"} className={mode === "random" ? "active" : ""} onClick={() => setMode("random")}>Aleatorio</button><button type="button" aria-pressed={mode === "balanced"} className={mode === "balanced" ? "active" : ""} disabled={!allHaveHcp} onClick={() => setMode("balanced")}>Balanceado por HCP</button></div>{!allHaveHcp && <small className="hint">Completa el HCP de todos para balancear.</small>}</div></div><button type="button" className="primary big" onClick={draw}>Armar grupos</button></section>
    {message && <div className="notice" role="status">{message}</div>}
    {groups.length > 0 && <section className="generatedGroups"><div className="sectionTitle"><div><h2>Resultado</h2><p>Todos aparecen una sola vez.</p></div><button type="button" className="secondary" onClick={draw}>Volver a sortear</button></div>
      <div className="generatedGroupGrid">{groups.map((group, groupIndex) => <article className="generatedGroupCard" key={`group-${groupIndex}`}><div className="groupCardHead"><div><span>GRUPO {groupIndex + 1}</span><b>{group.length} jugadores</b></div><button type="button" className="secondary" onClick={() => onPlay(group.map(player => ({ ...player })))}>Jugar con este grupo</button></div><ul>{group.map(player => <li key={player.id}><MemberInitial name={player.name} /><span>{player.name}<small>{typeof player.handicap === "number" ? `HCP ${player.handicap}` : "HCP por completar"}</small></span></li>)}</ul>{saveIndex === groupIndex ? <div className="saveGeneratedGroup"><input aria-label={`Nombre del grupo generado ${groupIndex + 1}`} value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Ej. Miércoles 8am" /><button type="button" className="primary" onClick={() => saveGroup(groupIndex)}>Guardar</button><button type="button" className="textButton" onClick={() => setSaveIndex(null)}>Cancelar</button></div> : <button type="button" className="textButton" onClick={() => { setSaveIndex(groupIndex); setSaveName(""); }}>Guardar como grupo frecuente</button>}</article>)}</div>
      {editing && <div className="swapEditor"><h3>Intercambiar jugadores</h3><select aria-label="Primer jugador a intercambiar" value={swapA} onChange={event => setSwapA(event.target.value)}><option value="">Primer jugador</option>{playerOptions.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select><select aria-label="Segundo jugador a intercambiar" value={swapB} onChange={event => setSwapB(event.target.value)}><option value="">Segundo jugador</option>{playerOptions.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select><button type="button" className="secondary" disabled={!swapA || !swapB} onClick={() => { setGroups(swapGroupPlayers(groups, swapA, swapB)); setSwapA(""); setSwapB(""); }}>Intercambiar</button></div>}
      <div className="groupResultActions"><button type="button" className="secondary" onClick={() => setEditing(value => !value)}>{editing ? "Terminar edición" : "Intercambiar jugadores"}</button><button type="button" className="secondary" onClick={openSaveAll}>Guardar grupos</button><button type="button" className="secondary" onClick={copySummary}>Copiar texto</button><button type="button" className="primary" onClick={share}>Compartir</button></div>
    </section>}
    <BottomBackAction label="← Mis grupos" onBack={() => setView("library")} />
    {saveAllOpen && <ModalShell open onClose={closeSaveAll} className="confirmDialog saveGroupsDialog" labelledBy="save-groups-title"><h2 id="save-groups-title">Guardar grupos frecuentes</h2><p>Asigna un nombre distinto a cada grupo. Esto no inicia ni modifica una ronda.</p><div className="saveAllGroupNames">{groups.map((group, index) => <label key={`save-${index}`}>Grupo {index + 1} · {group.length} jugadores<input value={saveAllNames[index] || ""} onChange={event => setSaveAllNames(current => current.map((name, itemIndex) => itemIndex === index ? event.target.value : name))} placeholder={`Nombre del Grupo ${index + 1}`} /></label>)}</div><div className="dialogActions"><button type="button" className="secondary" onClick={closeSaveAll}>Cancelar</button><button type="button" className="primary" onClick={saveAllGroups}>Guardar todos</button></div></ModalShell>}
  </section>;
}
