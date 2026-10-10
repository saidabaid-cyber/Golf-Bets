"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBackyardAccount } from "./account-provider";
import { GolfGpsReader } from "./golf-gps/golf-gps-reader";
import { RoundParticipationCard } from "./round-participation-card";
import type { RoundSnapshot } from "../../lib/types";
import type { SharedScorePatch } from "../../lib/shared-round-live";
import styles from "./shared-round-session.module.css";
import { SharedGroupBetCapture, SharedPlayerBetCapture, sharedBetPending, sharedPuttsRequired } from "./shared-bet-capture";
import type { SharedGroupFacts, SharedPlayerFacts } from "../../lib/shared-round-bet-capture";

type LiveCard = { id: string; version: number; ownerId: string; snapshot: RoundSnapshot; editablePlayerKeys: string[]; joined: boolean };
type Workspace = { drafts: Record<string, SharedScorePatch>; outbox: SharedScorePatch[] };
const EMPTY: Workspace = { drafts: {}, outbox: [] };
const cell = (hole: number, key: string) => `${hole}:${key}`;

export function SharedRoundsEntry({ token, onOpen }: { token?: string | null; onOpen: (id: string) => void }) {
  const [rounds, setRounds] = useState<Array<{ id: string; name: string; date: string; mode: string; players: number }>>([]);
  const [error, setError] = useState("");
  useEffect(() => { if (!token) return; const abort = new AbortController();
    void fetch("/api/shared-rounds", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setRounds(body.rounds || []); })
      .catch(() => { if (!abort.signal.aborted) setError("No pudimos consultar tus rondas compartidas."); });
    return () => abort.abort();
  }, [token]);
  if (!rounds.length && !error) return null;
  return <section className="card" aria-label="Rondas compartidas"><h2>Rondas compartidas</h2>{error && <p role="status">{error}</p>}{rounds.map(row => <article key={row.id}><b>{row.name}</b><p>{row.date} · {row.players} jugadores · {row.mode === "self" ? "Cada jugador lleva su tarjeta" : "Captura del organizador"}</p><button type="button" className="secondary" onClick={() => onOpen(row.id)}>Abrir ronda compartida</button></article>)}</section>;
}

/** A view onto rounds_cloud, never a participant copy or another score graph. */
export function SharedRoundSession({ roundId, onExit }: { roundId: string; onExit: () => void }) {
  const { identity, openAccess } = useBackyardAccount();
  const token = identity.accessToken;
  const storageKey = `backyard-shared-capture-v1:${identity.userId}:${roundId}`;
  const [card, setCard] = useState<LiveCard | null>(null), [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY), [busy, setBusy] = useState(false);
  const [position, setPosition] = useState(1), [panel, setPanel] = useState<"score" | "card" | null>("score");
  const [gpsVisited, setGpsVisited] = useState(false), [gpsVisible, setGpsVisible] = useState(false);
  const [notice, setNotice] = useState(""), [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const flight = useRef(false), latest = useRef(workspace);
  useEffect(() => { latest.current = workspace; }, [workspace]);
  function store(next: Workspace) { localStorage.setItem(storageKey, JSON.stringify(next)); latest.current = next; setWorkspace(next); }
  useEffect(() => {
    try { setWorkspace(JSON.parse(localStorage.getItem(storageKey) || "null") || EMPTY); setPosition(Number(sessionStorage.getItem(`${storageKey}:hole`)) || 1); }
    catch { setError("No pudimos restaurar la captura local; no se sobrescribirá."); }
  }, [storageKey]);
  const read = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    const response = await fetch(`/api/shared-rounds?roundId=${encodeURIComponent(roundId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "No pudimos leer la ronda.");
    setCard(current => current && current.id === body.data.id && current.version > body.data.version ? current : body.data); return body.data as LiveCard;
  }, [token, roundId]);
  useEffect(() => { if (!token) return; const abort = new AbortController(); let reading = false;
    const update = async () => { if (reading || document.hidden || abort.signal.aborted) return; reading = true; try { await read(abort.signal); } catch { if (!abort.signal.aborted) setError("Sin conexión con la tarjeta. Tu captura local se conserva."); } finally { reading = false; } };
    void update(); const timer = setInterval(() => void update(), 5000);
    window.addEventListener("focus", update); window.addEventListener("online", update);
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("online", update); };
  }, [read, token]);
  async function write(body: object) {
    const response = await fetch("/api/shared-rounds", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ roundId, ...body }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.code === "SCORE_CONFLICT" ? "Otro dispositivo cambió este score. Abre la tarjeta y revisa antes de reemplazar tu captura." : result.code === "INCOMPLETE_CARD" ? "Faltan scores en la tarjeta. La ronda sigue abierta." : result.code === "INCOMPLETE_BET_CAPTURE" || result.code === "PROVISIONAL_BETS" ? "Faltan capturas para liquidar las apuestas. La ronda sigue abierta." : result.error || "Sincronización pendiente.");
    setCard(current => current && current.id === result.data.id && current.version > result.data.version ? current : result.data); return result.data as LiveCard;
  }
  async function sync(patches: SharedScorePatch[]) {
    if (flight.current || !patches.length) return false;
    flight.current = true; setBusy(true); setError(""); setNotice("Pendiente de sincronizar…");
    try {
      await write({ patches });
      const ids = new Set(patches.map(p => p.id)); const current = latest.current;
      store({ drafts: Object.fromEntries(Object.entries(current.drafts).filter(([, value]) => !ids.has(value.id))), outbox: current.outbox.filter(p => !ids.has(p.id)) });
      setNotice("Scores guardados en la ronda compartida."); return true;
    } catch (failure) { setError((failure as Error).message); setNotice("Pendiente de sincronizar; conservado en este dispositivo."); return false; }
    finally { flight.current = false; setBusy(false); }
  }
  async function syncAll(patches: SharedScorePatch[]) {
    let batch: SharedScorePatch[] = [];
    for (const patch of patches) {
      if (batch.length && (batch.length === 25 || new TextEncoder().encode(JSON.stringify([...batch, patch])).length > 7000)) {
        if (!await sync(batch)) return false;
        batch = [];
      }
      batch.push(patch);
    }
    return !batch.length || await sync(batch);
  }
  // Only explicitly saved outbox entries are retried; typing never saves.
  useEffect(() => { const reconnect = () => { if (latest.current.outbox.length) void syncAll(latest.current.outbox); }; window.addEventListener("online", reconnect); return () => window.removeEventListener("online", reconnect); });
  if (identity.mode !== "authenticated") return <section className="card"><h1>Ronda compartida</h1><p>Inicia sesión con la cuenta vinculada a esta ronda.</p><button type="button" onClick={openAccess}>Iniciar sesión</button></section>;
  if (!card) return <section className="card" role="status"><p>{error || "Leyendo la ronda compartida…"}</p><button onClick={() => void read().catch(e => setError(e.message))}>Reintentar</button><button onClick={onExit}>Volver a Play</button></section>;
  const round = card.snapshot, order = round.order || [], course = round.courseSnapshot;
  const hole = order.includes(position) ? position : order[0];
  const holeIndex = order.indexOf(hole), holeCard = course?.holes.find(h => h.number === hole);
  const editable = round.players?.filter(p => card.editablePlayerKeys.includes(p.id)) || [];
  const pendingBets = sharedBetPending(round);
  function navigate(next: number) { setPosition(next); sessionStorage.setItem(`${storageKey}:hole`, String(next)); }
  function edit(playerKey: string, field: "score" | "putts", value: number | null) {
    if (flight.current) return;
    const key = cell(hole, playerKey), previous = latest.current.drafts[key];
    const queued = previous && latest.current.outbox.some(p => p.id === previous.id);
    const patch: SharedScorePatch = previous && !queued ? previous : { ...previous, id: crypto.randomUUID(), playerKey, hole, baseVersion: card!.version, score: previous?.score ?? round.scores?.[hole]?.[playerKey] ?? null };
    store({ ...latest.current, outbox: queued ? latest.current.outbox.filter(p => p.id !== previous.id) : latest.current.outbox, drafts: { ...latest.current.drafts, [key]: { ...patch, [field]: value } } });
  }
  function editFacts(playerKey: string, values: { facts?: SharedPlayerFacts; group?: SharedGroupFacts }) {
    if (flight.current) return;
    const key = cell(hole, playerKey), previous = latest.current.drafts[key];
    const queued = previous && latest.current.outbox.some(p => p.id === previous.id);
    const patch: SharedScorePatch = previous && !queued ? previous : { ...previous, id: crypto.randomUUID(), playerKey, hole, baseVersion: card!.version, score: previous?.score ?? round.scores?.[hole]?.[playerKey] ?? null };
    store({ ...latest.current, outbox: queued ? latest.current.outbox.filter(p => p.id !== previous.id) : latest.current.outbox,
      drafts: { ...latest.current.drafts, [key]: { ...patch, ...values } } });
  }
  async function save() {
    const patches = [...editable.map(p => p.id), ...(card!.ownerId === identity.userId ? ["@round"] : [])].flatMap(id => workspace.drafts[cell(hole, id)] ? [workspace.drafts[cell(hole, id)]] : []);
    if (!patches.length) { setNotice("No hay cambios para guardar."); return; }
    const ids = new Set(patches.map(p => p.id)); store({ ...latest.current, outbox: [...latest.current.outbox.filter(p => !ids.has(p.id)), ...patches] });
    if (await sync(patches)) { if (gpsVisible) setPanel(null); }
  }
  async function saveAndExit() {
    if (flight.current) return;
    const current = latest.current;
    const pending = new Map(current.outbox.map(p => [p.id, p]));
    for (const patch of Object.values(current.drafts)) pending.set(patch.id, patch);
    const patches = [...pending.values()];
    if (patches.length) {
      store({ ...current, outbox: patches });
      // The endpoint accepts at most 25 cells. Keep every unsent batch durable
      // and leave the view open on failure rather than claiming a remote save.
      if (!await syncAll(patches)) {
        if (gpsVisible) setPanel("score");
        return;
      }
    }
    onExit();
  }
  const scorePanel = <><div className={styles.sheetTitle}><h2>Hoyo {hole}{holeCard ? ` · Par ${holeCard.par}` : ""}</h2><button onClick={() => { setPanel(null); if (!gpsVisible) setGpsVisible(true); setGpsVisited(true); }}>Volver al mapa</button></div>
    {card.joined ? editable.map(p => { const draft = workspace.drafts[cell(hole, p.id)]; const value = draft ? draft.score : round.scores?.[hole]?.[p.id]; const assignment = round.playerTeeAssignments?.find(t => t.playerId === p.id);
      const requiredPutts = sharedPuttsRequired(round, p.id, hole);
      return <div className={styles.player} key={p.id}><b>{p.name}{!p.accountUserId ? " · Sin app" : ""}</b><small>{assignment?.teeName || round.teeName} · HCP {p.handicap ?? "—"}</small><label>Score<input type="number" inputMode="numeric" min={1} max={20} aria-label={`Score ${p.name} hoyo ${hole}`} value={value ?? ""} onChange={e => edit(p.id, "score", e.target.value === "" ? null : Number(e.target.value))} /></label><details open={requiredPutts}><summary>{requiredPutts ? "Putts necesarios para la apuesta" : "Putts opcionales"}</summary><input type="number" inputMode="numeric" min={0} max={20} aria-label={`Putts ${p.name} hoyo ${hole}`} value={draft && Object.hasOwn(draft, "putts") ? draft.putts ?? "" : round.putts?.[hole]?.[p.id] ?? ""} onChange={e => edit(p.id, "putts", e.target.value === "" ? null : Number(e.target.value))} /></details><SharedPlayerBetCapture round={round} player={p} hole={hole} draft={draft?.facts} onChange={facts => editFacts(p.id, { facts })} /></div>; }) : <button disabled={busy} onClick={() => { setBusy(true); void write({ action: "join" }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Unirme a esta ronda</button>}
    {card.ownerId === identity.userId && round.lifecycleState === "live" && <SharedGroupBetCapture round={round} hole={hole} draft={workspace.drafts[cell(hole, "@round")]?.group} onChange={group => editFacts("@round", { group })} />}
    {card.joined && !editable.length && <p>{round.lifecycleState === "live" ? "El organizador lleva tu tarjeta en este modo." : "Ronda cerrada; tarjeta conservada."}</p>}
    {(editable.length > 0 || (card.ownerId === identity.userId && round.lifecycleState === "live")) && card.joined && <button className="primary" disabled={busy} onClick={() => void save()}>Guardar mi captura</button>}
    <p role="status">{notice || "Sólo los scores guardados aparecen en la tarjeta compartida."}</p>{workspace.outbox.length > 0 && <button disabled={busy} onClick={() => void syncAll(workspace.outbox)}>Reintentar sincronización ({workspace.outbox.length})</button>}
    {error && <p role="alert">{error}</p>}
    <p className={styles.pending}>Pendientes en H{hole}: {round.players?.filter(p => round.scores?.[hole]?.[p.id] == null).map(p => p.name).join(", ") || "ninguno"}. Apuestas y clasificación provisionales mientras falten resultados.</p>{pendingBets && <p role="status">Capturas pendientes para finalizar · H{pendingBets.holeNumber}: {pendingBets.errors.map(message => message.replace("antes de continuar", "antes de finalizar")).join(" ")} Puedes cambiar de hoyo y seguir jugando.</p>}</>;
  const fullCard = <><div className={styles.sheetTitle}><h2>Tarjeta compartida</h2><button onClick={() => { setPanel(null); if (!gpsVisible) { setGpsVisited(true); setGpsVisible(true); } }}>Volver al GPS</button></div><div className={styles.table}><table><thead><tr><th>Hoyo</th>{round.players?.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{order.map(h => <tr key={h}><th>{h}</th>{round.players?.map(p => <td key={p.id}>{round.scores?.[h]?.[p.id] ?? "—"}</td>)}</tr>)}</tbody></table></div><p>Una misma ronda · {card.id} · revisión {card.version}</p><button onClick={() => { const drafts = { ...workspace.drafts }; for (const key of Object.keys(drafts)) { if (drafts[key].hole === hole) delete drafts[key]; } store({ drafts, outbox: workspace.outbox.filter(p => p.hole !== hole) }); setError(""); setPanel("score"); }}>Usar scores de nube en este hoyo</button></>;
  return <section className={styles.root} aria-label="Ronda compartida" data-round-id={card.id}>
    <header><button disabled={busy} onClick={() => void saveAndExit()}>Guardar y salir a Play</button><h1>{round.courseName}</h1><p>{round.scorekeeping?.mode === "self" ? "Cada jugador lleva su tarjeta" : "El organizador captura a todos"}</p></header>
    <nav><button disabled={holeIndex === 0} onClick={() => navigate(order[holeIndex - 1])}>Anterior</button><label>Hoyo<select aria-label="Hoyo de mi tarjeta" value={hole} onChange={e => navigate(Number(e.target.value))}>{order.map(h => <option key={h}>{h}</option>)}</select></label><button disabled={holeIndex === order.length - 1} onClick={() => navigate(order[holeIndex + 1])}>Siguiente</button><button onClick={() => { setGpsVisited(true); setGpsVisible(true); setPanel(null); }}>GPS</button><button onClick={() => setPanel("score")}>Anotar</button><button onClick={() => setPanel("card")}>Tarjeta</button></nav>
    {!gpsVisible && (panel === "card" ? fullCard : scorePanel)}
    {gpsVisited && <div hidden={!gpsVisible}><GolfGpsReader sessionKey={identity.userId} token={token ?? null} active={gpsVisible} initialCourseId={course?.catalogCourseId || course?.id} initialPosition={hole} mappingUnavailable={course?.isProvisional === true || Boolean(course?.operationsSnapshot?.configurationIds.length)} onBack={() => { setGpsVisible(false); setPanel("score"); }} roundContext={{ roundId: card.id, name: round.courseName, teeName: round.teeName, holes: order.flatMap(h => course?.holes.filter(row => row.number === h) || []), onScore: next => { navigate(next); setPanel("score"); }, onCard: () => setPanel("card"), onNavigate: navigate, onExit: () => void saveAndExit(), onFinish: card.ownerId === identity.userId ? () => { setGpsVisible(false); setPanel("card"); setConfirmFinish(true); } : undefined }} /></div>}
    {gpsVisible && panel !== null && <div className={styles.backdrop}><section className={styles.sheet} role="dialog" aria-modal="true" aria-label={panel === "score" ? "Anotar score" : "Tarjeta compartida"}>{panel === "score" ? scorePanel : fullCard}</section></div>}
    <footer>
      <button onClick={() => { void navigator.clipboard.writeText(`${location.origin}/?sharedRound=${card.id}`).then(() => setNotice("Enlace copiado; sólo podrán entrar las cuentas vinculadas.")).catch(() => setNotice(`Enlace: ${location.origin}/?sharedRound=${card.id}`)); }}>Copiar enlace para jugadores</button>
      {card.ownerId === identity.userId && round.lifecycleState === "live" && <><button onClick={() => { setPanel("card"); setConfirmFinish(true); }}>Revisar y finalizar</button><button onClick={() => setConfirmCancel(true)}>Cancelar ronda</button></>}
      {confirmFinish && <div role="dialog" aria-label="Finalizar ronda"><p>Se guardará esta tarjeta canónica. Los participantes pendientes deben confirmar su participación antes de entrar a sus estadísticas.</p><button onClick={() => setConfirmFinish(false)}>Seguir jugando</button><button disabled={busy || workspace.outbox.length > 0 || Object.keys(workspace.drafts).length > 0} onClick={() => { setBusy(true); void write({ action: "finish", expectedVersion: card.version }).then(() => { setConfirmFinish(false); setNotice("Ronda guardada. Participantes pendientes de confirmación conservan su tarjeta."); }).catch(e => { setError(e.message); void read().catch(() => undefined); }).finally(() => setBusy(false)); }}>Finalizar tarjeta</button></div>}
      {confirmCancel && <div role="dialog" aria-label="Cancelar ronda"><p>¿Cancelar esta ronda? Conservaremos la tarjeta y sus scores.</p><button onClick={() => setConfirmCancel(false)}>Volver</button><button disabled={busy} onClick={() => { setBusy(true); void write({ action: "cancel", expectedVersion: card.version }).then(() => { setConfirmCancel(false); setNotice("Ronda cancelada; tarjeta conservada."); }).catch(e => { setError(e.message); void read().catch(() => undefined); }).finally(() => setBusy(false)); }}>Confirmar cancelación</button></div>}
      {round.lifecycleState === "completed" && <p>Tarjeta guardada. Consulta el Histórico para revisar o confirmar tu participación.</p>}
      {round.lifecycleState === "completed" && token && <RoundParticipationCard accessToken={token} roundId={card.id} />}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </footer>
  </section>;
}
