"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { autoGroupPollaPlayers, parsePollaPlayersCsv, rankPollaLeaderboard, type PollaLeaderboardRow, type PollaPlayerInput } from "../../lib/polla-live";
import { enqueuePollaScore, flushPollaScoreQueue, readPendingPollaScores } from "../../lib/polla-offline";
import { getSupabaseBrowser, pollaCloudConfigured } from "../../lib/supabase/client";
import type { Course } from "../../lib/types";

type Screen = "home" | "create" | "join" | "leaderboard" | "scorecard" | "mine";
type CreatedTournament = { public_id: string; short_code: string; name: string };
type GuestSession = { access_token: string; tournament_id: string; group_id: string; role: string; player_name: string };

const todayMexico = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const makePlayer = (index: number): PollaPlayerInput => ({ id: `local-${Date.now()}-${index}`, name: "", handicap: 0, group: "", startHole: 1 });

export function PollaLivePanel({ courses = [] }: { courses?: Course[] }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [created, setCreated] = useState<CreatedTournament | null>(null);
  const [accessList, setAccessList] = useState<Array<{ playerId: string; name: string; group: string; pin: string }>>([]);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", date: todayMexico(), courseName: "", holes: 18 as 9 | 18, startHole: 1 as 1 | 10, format: "both", hcpPct: 100, handicapMode: "half_up", localRules: "" });
  const [players, setPlayers] = useState<PollaPlayerInput[]>([]);
  const [csv, setCsv] = useState("");
  const [csvIssues, setCsvIssues] = useState<string[]>([]);
  const [publicId, setPublicId] = useState("");
  const [invite, setInvite] = useState<any>(null);
  const [joinPlayerId, setJoinPlayerId] = useState("");
  const [pin, setPin] = useState("");
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [groupData, setGroupData] = useState<any>(null);
  const [groupScores, setGroupScores] = useState<Record<string, number>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [syncLabel, setSyncLabel] = useState("✓ Sincronizado");
  const [pendingCount, setPendingCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<{ tournament?: any; rows: PollaLeaderboardRow[] }>({ rows: [] });
  const [leaderboardMode, setLeaderboardMode] = useState<"gross" | "net">("net");
  const [myTournaments, setMyTournaments] = useState<any[]>([]);
  const [oyesHoles, setOyesHoles] = useState<number[]>([]);
  const [prizes, setPrizes] = useState<Array<{ position: number; category: "gross" | "net" | "other"; money: number; percentage: number; description: string }>>([]);

  useEffect(() => {
    if (!pollaCloudConfigured) return;
    const supabase = getSupabaseBrowser();
    supabase?.auth.getSession().then(({ data }) => setAccessToken(data.session?.access_token || ""));
    const { data } = supabase?.auth.onAuthStateChange((_event, session) => setAccessToken(session?.access_token || "")) || { data: null };
    try {
      const saved = JSON.parse(localStorage.getItem("golfbets-polla-session-v1") || "null");
      if (saved?.access_token) setGuest(saved);
    } catch { /* corrupt guest session */ }
    setPendingCount(readPendingPollaScores().length);
    const invitedId = new URLSearchParams(window.location.search).get("polla");
    if (invitedId) { setPublicId(invitedId); setScreen("join"); }
    return () => data?.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!guest || screen !== "scorecard") return;
    loadGroup(guest);
    const online = async () => {
      setSyncLabel("Sincronizando…");
      const result = await flushPollaScoreQueue(guest.access_token);
      setPendingCount(result.conflicts.length + result.remaining.length);
      setSyncLabel(result.conflicts.length ? `${result.conflicts.length} conflicto(s)` : result.remaining.length ? "Pendiente de conexión" : "✓ Sincronizado");
      await loadGroup(guest);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [guest, screen]);

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    setAuthMessage(authError ? authError.message : "Revisa tu correo para entrar y crear Pollas.");
  }

  function importCsv() {
    const parsed = parsePollaPlayersCsv(csv);
    setCsvIssues(parsed.issues.map((issue) => `Fila ${issue.row}: ${issue.message}`));
    if (!parsed.issues.length) setPlayers(parsed.players);
  }

  function autoGroup() {
    const grouped = autoGroupPollaPlayers(players, 4);
    setPlayers(grouped.flatMap((group, groupIndex) => group.map((player) => ({ ...player, group: `Grupo ${groupIndex + 1}` }))));
  }

  async function createTournament(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return setError("Inicia sesión por correo antes de crear una Polla.");
    if (!draft.name.trim() || !draft.courseName.trim()) return setError("Nombre y campo son obligatorios.");
    if (players.some((player) => !player.name.trim())) return setError("Todos los jugadores necesitan nombre.");
    setBusy(true); setError("");
    try {
      const selectedCourse = courses.find((course) => course.name === draft.courseName);
      const response = await fetch("/api/polla/tournaments", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ ...draft, courseSnapshot: selectedCourse?.holes || [], players, oyesHoles, prizes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible crear la Polla.");
      setCreated(payload.tournament);
      setAccessList(payload.access || []);
      const link = `${window.location.origin}/?polla=${payload.tournament.public_id}`;
      setQr(await QRCode.toDataURL(link, { width: 240, margin: 1, color: { dark: "#112d25", light: "#ffffff" } }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear la Polla.");
    } finally { setBusy(false); }
  }

  async function loadInvite() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/polla/invite/${encodeURIComponent(publicId.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Polla no encontrada.");
      setInvite(payload); setJoinPlayerId(payload.players?.[0]?.id || "");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible abrir la Polla."); }
    finally { setBusy(false); }
  }

  async function joinTournament(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/polla/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicId, playerId: joinPlayerId, pin }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Acceso inválido.");
      setGuest(payload.session); localStorage.setItem("golfbets-polla-session-v1", JSON.stringify(payload.session)); setScreen("scorecard");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible entrar."); }
    finally { setBusy(false); }
  }

  async function loadGroup(session: GuestSession) {
    const response = await fetch("/api/polla/group", { headers: { authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) return;
    const payload = await response.json(); setGroupData(payload);
    const next = Object.fromEntries((payload.scores || []).map((score: any) => [`${score.player_id}:${score.hole}`, score.score]));
    setGroupScores(next);
  }

  async function saveHole() {
    if (!guest || !groupData) return;
    const members = (groupData.members || []).map((member: any) => member.tournament_players).filter(Boolean);
    setSyncLabel("Guardando…");
    for (const player of members) {
      const score = groupScores[`${player.id}:${currentHole}`];
      if (!score) continue;
      const item = { id: crypto.randomUUID(), tournamentId: guest.tournament_id, groupId: guest.group_id, playerId: player.id, hole: currentHole, score, queuedAt: new Date().toISOString() };
      if (!navigator.onLine) { enqueuePollaScore(item); continue; }
      try {
        const response = await fetch("/api/polla/scores", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest.access_token}` }, body: JSON.stringify(item) });
        if (!response.ok) {
          if (response.status === 409) setSyncLabel("Conflicto: revisa antes de sobrescribir");
          else enqueuePollaScore(item);
        }
      } catch { enqueuePollaScore(item); }
    }
    const pending = readPendingPollaScores().length; setPendingCount(pending);
    setSyncLabel(pending ? `Sin conexión · ${pending} cambio${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}` : "✓ Sincronizado");
    const totalHoles = groupData.group?.tournaments?.holes || 18;
    if (currentHole < totalHoles) setCurrentHole((hole) => hole + 1);
  }

  async function closeCard() {
    if (!guest || !window.confirm("¿Confirmas que esta tarjeta está correcta?")) return;
    const response = await fetch("/api/polla/group", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest.access_token}` }, body: JSON.stringify({ action: "confirm" }) });
    if (response.ok) await loadGroup(guest); else setError((await response.json()).error || "No fue posible cerrar la tarjeta.");
  }

  const loadLeaderboard = useCallback(async () => {
    if (!publicId.trim()) return;
    const response = await fetch(`/api/polla/leaderboard/${encodeURIComponent(publicId.trim())}`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setLeaderboard(payload); else setError(payload.error || "Leaderboard no disponible.");
  }, [publicId]);

  async function loadMyTournaments() {
    if (!accessToken) return;
    setBusy(true); setError("");
    const response = await fetch("/api/polla/tournaments", { headers: { authorization: `Bearer ${accessToken}` } });
    const payload = await response.json();
    if (response.ok) { setMyTournaments(payload.tournaments || []); setScreen("mine"); }
    else setError(payload.error || "No fue posible cargar Mis Pollas.");
    setBusy(false);
  }

  useEffect(() => {
    if (screen !== "leaderboard" || !publicId) return;
    loadLeaderboard();
    const timer = window.setInterval(loadLeaderboard, 15_000);
    const supabase = getSupabaseBrowser();
    const channel = supabase?.channel(`polla-leaderboard-${publicId}`).on("postgres_changes", { event: "*", schema: "public", table: "tournament_scores" }, loadLeaderboard).subscribe();
    return () => { window.clearInterval(timer); if (channel) supabase?.removeChannel(channel); };
  }, [screen, publicId, loadLeaderboard]);

  const ranked = useMemo(() => rankPollaLeaderboard(leaderboard.rows, leaderboardMode), [leaderboard.rows, leaderboardMode]);

  if (!pollaCloudConfigured) return <>
    <section className="hero pollaHero"><div><div className="eyebrow">🏆 POLLA LIVE</div><h1>Torneo grande, score simple.</h1><p>La modalidad cloud es independiente de Conejos, Skins y tus apuestas privadas.</p></div><span className="livePill">LIVE</span></section>
    <section className="card cloudRequired"><h2>Configura la nube para activar Polla Live</h2><p>La ronda privada sigue funcionando completa sin internet. Para torneos, agrega las variables de Supabase indicadas en <code>.env.example</code> y ejecuta la migración incluida.</p></section>
  </>;

  return <>
    <section className="hero pollaHero"><div><div className="eyebrow">🏆 POLLA LIVE</div><h1>{screen === "home" ? "Torneo en vivo." : screen === "scorecard" ? (groupData?.group?.name || "Mi grupo") : "Polla Live"}</h1><p>Scores públicos del torneo; tus apuestas privadas nunca se comparten.</p></div><span className="livePill">● LIVE</span></section>

    {screen !== "home" && <button className="textButton" onClick={() => setScreen("home")}>← Polla Live</button>}
    {error && <div className="notice bad">{error}</div>}

    {screen === "home" && <section className="pollaActions">
      <button className="primary big" onClick={() => setScreen("create")}>Crear Polla</button>
      <button className="secondary big" onClick={() => setScreen("join")}>Unirme a Polla</button>
      <button className="secondary big" onClick={() => setScreen("leaderboard")}>Ver Leaderboard</button>
      {accessToken && <button className="secondary big" onClick={loadMyTournaments}>Mis Pollas</button>}
      {guest && <button className="secondary big" onClick={() => setScreen("scorecard")}>Continuar tarjeta · {guest.player_name}</button>}
    </section>}

    {screen === "create" && <>
      {!accessToken && <section className="card"><h2>Cuenta del administrador</h2><form onSubmit={sendMagicLink}><label>Correo</label><div className="inlineForm"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /><button className="secondary">Enviar magic link</button></div></form>{authMessage && <div className="hint">{authMessage}</div>}</section>}
      <form onSubmit={createTournament}>
        <section className="card"><h2>Crear Polla</h2><div className="grid2">
          <div><label>Nombre</label><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div><label>Fecha</label><input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div>
          <div><label>Campo</label>{courses.length ? <select required value={draft.courseName} onChange={(event) => setDraft({ ...draft, courseName: event.target.value })}><option value="">Selecciona</option>{Array.from(new Set(courses.map((course) => course.name))).map((name) => <option key={name}>{name}</option>)}</select> : <input required value={draft.courseName} onChange={(event) => setDraft({ ...draft, courseName: event.target.value })} />}</div>
          <div><label>Formato</label><select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value })}><option value="both">Gross + Neto</option><option value="gross">Medal Gross</option><option value="net">Medal Neto</option></select></div>
          <div><label>Hoyos</label><select value={draft.holes} onChange={(event) => setDraft({ ...draft, holes: Number(event.target.value) as 9 | 18 })}><option value={18}>18</option><option value={9}>9</option></select></div>
          <div><label>Salida</label><select value={draft.startHole} onChange={(event) => setDraft({ ...draft, startHole: Number(event.target.value) as 1 | 10 })}><option value={1}>H1</option><option value={10}>H10</option></select></div>
          <div><label>% HCP</label><input type="number" min={0} max={100} step={5} value={draft.hcpPct} onChange={(event) => setDraft({ ...draft, hcpPct: Number(event.target.value) })} /></div>
          <div><label>Modo HCP</label><select value={draft.handicapMode} onChange={(event) => setDraft({ ...draft, handicapMode: event.target.value })}><option value="decimal">Décimas</option><option value="half_up">.5 sube</option><option value="half_down">.5 baja</option><option value="six_up">.6 sube</option><option value="four_down">.4 baja</option></select></div>
        </div><label>Comentarios / reglas locales</label><textarea rows={3} value={draft.localRules} onChange={(event) => setDraft({ ...draft, localRules: event.target.value })} /></section>
        <section className="card"><div className="sectionTitle"><div><h2>Jugadores y grupos</h2><p>Manual, CSV o autoagrupar de 4; se permiten grupos de 3–5.</p></div><button type="button" className="textButton" onClick={() => setPlayers([...players, makePlayer(players.length)])}>+ Jugador</button></div>
          {players.map((player, index) => <div className="pollaPlayer" key={player.id}><input placeholder="Nombre" value={player.name} onChange={(event) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input type="number" placeholder="HCP" value={player.handicap === 0 ? "" : player.handicap} onChange={(event) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, handicap: Number(event.target.value) || 0 } : item))} /><input placeholder="Grupo" value={player.group || ""} onChange={(event) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, group: event.target.value } : item))} /><button type="button" className="remove" onClick={() => setPlayers(players.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}
          <button type="button" className="secondary" onClick={autoGroup} disabled={players.length < 3}>Autoagrupar de 4</button>
          <div className="csvImport"><label>Importar CSV · name,handicap,group,startHole,teeTime</label><textarea rows={4} value={csv} onChange={(event) => setCsv(event.target.value)} /><button type="button" className="secondary" onClick={importCsv}>Validar e importar</button>{csvIssues.map((issue) => <div className="bad" key={issue}>{issue}</div>)}</div>
        </section>
        <section className="card"><div className="sectionTitle"><div><h2>Premios y Oyes</h2><p>Solo registra/calcula; no mueve dinero.</p></div><button type="button" className="textButton" onClick={() => setPrizes([...prizes, { position: prizes.length + 1, category: "net", money: 0, percentage: 0, description: "" }])}>+ Premio</button></div>{prizes.map((prize, index) => <div className="prizeRow" key={index}><select value={prize.category} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as "gross" | "net" | "other" } : item))}><option value="net">Neto</option><option value="gross">Gross</option><option value="other">Otro</option></select><input aria-label="Posición" type="number" min={1} value={prize.position} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, position: Number(event.target.value) } : item))} /><div className="moneyField"><span>$</span><input aria-label="Dinero" type="number" placeholder="0" value={prize.money || ""} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, money: Number(event.target.value) || 0 } : item))} /></div><input aria-label="Porcentaje" type="number" min={0} max={100} placeholder="%" value={prize.percentage || ""} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, percentage: Number(event.target.value) || 0 } : item))} /><input placeholder="Texto / premio físico" value={prize.description} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><button type="button" className="remove" onClick={() => setPrizes(prizes.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}<label className="miniLabel">Oyes en Par 3</label><div className="chips">{(courses.find((course) => course.name === draft.courseName)?.holes || []).filter((hole) => hole.par === 3).map((hole) => <button type="button" key={hole.number} className={`chipButton ${oyesHoles.includes(hole.number) ? "selected" : ""}`} onClick={() => setOyesHoles(oyesHoles.includes(hole.number) ? oyesHoles.filter((number) => number !== hole.number) : [...oyesHoles, hole.number])}>H{hole.number}</button>)}</div></section>
        <button className="primary big" disabled={busy}>{busy ? "Creando…" : "Crear Polla"}</button>
      </form>
      {created && <section className="card createdPolla"><h2>✓ {created.name} creada</h2><b>Código: {created.short_code}</b>{qr && <img src={qr} alt="Código QR para unirse a la Polla" />}<button className="secondary" onClick={() => navigator.share?.({ title: created.name, url: `${location.origin}/?polla=${created.public_id}` })}>Compartir por WhatsApp</button><div className="accessPins">{accessList.map((item) => <span key={item.playerId}>{item.name} · {item.group} · PIN <b>{item.pin}</b></span>)}</div><div className="hint">Entrega cada PIN en privado. El backend solo conserva su hash.</div></section>}
    </>}

    {screen === "join" && <section className="card"><h2>Unirme a Polla</h2><label>ID público</label><div className="inlineForm"><input value={publicId} onChange={(event) => setPublicId(event.target.value)} /><button className="secondary" onClick={loadInvite} disabled={busy}>Buscar</button></div>{invite && <form onSubmit={joinTournament}><h3>{invite.tournament.name}</h3><label>Mi nombre / grupo</label><select value={joinPlayerId} onChange={(event) => setJoinPlayerId(event.target.value)}>{invite.players.map((player: any) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><label>PIN de 4–6 dígitos</label><input type="password" inputMode="numeric" pattern="[0-9]{4,6}" value={pin} onChange={(event) => setPin(event.target.value)} /><button className="primary" disabled={busy}>Entrar</button></form>}</section>}

    {screen === "scorecard" && guest && <section className="card liveScorecard"><div className="row between"><div><h2>{groupData?.group?.name || "Tarjeta"}</h2><span className="syncState">{syncLabel}{pendingCount ? ` · ${pendingCount}` : ""}</span></div><b>Hoyo {currentHole}</b></div>{groupData?.group?.status === "confirmed" ? <div className="successBox">✓ Tarjeta confirmada · solo el admin puede corregirla.</div> : guest.role === "viewer" ? <div className="notice">Modo jugador: puedes revisar la tarjeta. Solo el scorer/capitán del grupo captura scores.</div> : <>{(groupData?.members || []).map((member: any) => { const player = member.tournament_players; const key = `${player.id}:${currentHole}`; const value = groupScores[key] || 4; return <div className="scoreRow" key={player.id}><div><b>{player.name}</b><span>HCP {player.handicap}</span></div><div className="stepper"><button onClick={() => setGroupScores({ ...groupScores, [key]: Math.max(1, value - 1) })}>−</button><input type="number" min={1} max={20} value={value} onChange={(event) => setGroupScores({ ...groupScores, [key]: Number(event.target.value) || 4 })} /><button onClick={() => setGroupScores({ ...groupScores, [key]: Math.min(20, value + 1) })}>+</button></div></div>; })}<button className="primary big" onClick={saveHole}>Guardar hoyo</button><button className="secondary" onClick={closeCard}>Cerrar tarjeta</button></>}</section>}

    {screen === "leaderboard" && <section className="card"><h2>Leaderboard en vivo</h2><div className="inlineForm"><input placeholder="ID público" value={publicId} onChange={(event) => setPublicId(event.target.value)} /><button className="secondary" onClick={loadLeaderboard}>Abrir</button></div><div className="segmented"><button className={leaderboardMode === "gross" ? "active" : ""} onClick={() => setLeaderboardMode("gross")}>Gross</button><button className={leaderboardMode === "net" ? "active" : ""} onClick={() => setLeaderboardMode("net")}>Neto</button></div><div className="tableWrap"><table><thead><tr><th>Pos</th><th>Jugador</th><th>HCP</th><th>Thru</th><th>Gross</th><th>Neto</th><th>+/- Par</th></tr></thead><tbody>{ranked.map((row, index) => <tr key={row.playerId}><td>{index + 1}</td><td><b>{row.name}</b></td><td>{row.handicap}</td><td>{row.finished ? "F" : row.thru}</td><td>{row.gross}</td><td>{row.net}</td><td>{row.relativeToPar > 0 ? "+" : ""}{row.relativeToPar}</td></tr>)}</tbody></table></div></section>}

    {screen === "mine" && <section className="card"><div className="sectionTitle"><div><h2>Mis Pollas</h2><p>Próximas, en vivo y terminadas.</p></div><button className="textButton" onClick={() => setScreen("create")}>+ Crear</button></div>{busy && <div className="empty">Cargando…</div>}{!busy && !myTournaments.length && <div className="empty">Todavía no has creado Pollas.</div>}{myTournaments.map((tournament) => <button className="recentRound" key={tournament.id} onClick={() => { setPublicId(tournament.public_id); setScreen("leaderboard"); }}><span>{tournament.status === "upcoming" ? "Próxima" : tournament.status === "live" ? "● En vivo" : "Terminada"}</span><b>{tournament.name} · {tournament.course_name}</b><strong>{tournament.short_code}</strong></button>)}</section>}
  </>;
}
