"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoGroupPollaPlayers, initializePollaHoleScores, nextPollaHole, parsePollaPlayersCsv, pollaHoleOrder, rankPollaLeaderboard, type PollaCourseHole, type PollaLeaderboardRow, type PollaLeaderboardScope, type PollaPlayerInput } from "../../lib/polla-live";
import { acknowledgePollaScore, discardPollaScoreConflicts, enqueuePollaScore, flushPollaScoreQueue, readPendingPollaScores } from "../../lib/polla-offline";
import { getSupabaseBrowser, pollaCloudConfigured } from "../../lib/supabase/client";
import { createPrivatePollaLink, PRIVATE_POLLA_LINK_KEY } from "../../lib/polla-private-link";
import type { Course, Player } from "../../lib/types";
import { NumericCaptureInput } from "./numeric-capture-input";
import { useBackyardAccount } from "./account-provider";

type Screen = "home" | "create" | "join" | "leaderboard" | "scorecard" | "mine" | "manage";
type CreatedTournament = { public_id: string; short_code: string; name: string };
type GuestSession = { access_token: string; tournament_id: string; group_id: string; role: string; player_name: string };

const todayMexico = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const makePlayer = (index: number): PollaPlayerInput => ({ id: `local-${Date.now()}-${index}`, name: "", handicap: 0, group: "", startHole: 1 });

async function requestPollaInvite(identifier: string) {
  const response = await fetch(`/api/polla/invite/${encodeURIComponent(identifier.trim())}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Polla no encontrada.");
  return payload;
}

export function PollaLivePanel({ courses = [], privateRound }: { courses?: Course[]; privateRound?: { active: boolean; players: Player[] } }) {
  const { identity, openAccess } = useBackyardAccount();
  const [screen, setScreen] = useState<Screen>("home");
  const [shareMessage, setShareMessage] = useState("");
  const accessToken = identity.mode === "authenticated" ? identity.accessToken || "" : "";
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
  const [scoreVersions, setScoreVersions] = useState<Record<string, string>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [syncLabel, setSyncLabel] = useState("✓ Sincronizado");
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [scoreSaving, setScoreSaving] = useState(false);
  const scoreSaveInFlight = useRef(false);
  const [leaderboard, setLeaderboard] = useState<{ tournament?: any; rows: PollaLeaderboardRow[]; oyes?: Array<{ hole: number; playerName: string; distanceMeters: number }> }>({ rows: [] });
  const [leaderboardMode, setLeaderboardMode] = useState<"general" | "gross" | "net">("general");
  const [leaderboardScope, setLeaderboardScope] = useState<PollaLeaderboardScope>("all");
  const [leaderboardGroupId, setLeaderboardGroupId] = useState("");
  const [myTournaments, setMyTournaments] = useState<any[]>([]);
  const [adminData, setAdminData] = useState<any>(null);
  const [adminHole, setAdminHole] = useState(1);
  const [adminScores, setAdminScores] = useState<Record<string, number>>({});
  const [adminReason, setAdminReason] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [oyesHoles, setOyesHoles] = useState<number[]>([]);
  const [prizes, setPrizes] = useState<Array<{ position: number; category: "gross" | "net" | "other"; money: number; percentage: number; description: string }>>([]);
  const [oyesPlayerId, setOyesPlayerId] = useState("");
  const [oyesValue, setOyesValue] = useState("");
  const [oyesUnit, setOyesUnit] = useState<"m" | "cm" | "ft_in">("m");
  const [oyesInches, setOyesInches] = useState("");
  const [pollaEnabled, setPollaEnabled] = useState(true);

  useEffect(() => {
    if (!pollaCloudConfigured) return;
    fetch("/api/features", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((features) => { if (features?.pollaLiveEnabled === false) setPollaEnabled(false); })
      .catch(() => undefined);
    try {
      const saved = JSON.parse(localStorage.getItem("golfbets-polla-session-v1") || "null");
      if (saved?.access_token) setGuest(saved);
    } catch { /* corrupt guest session */ }
    setPendingCount(readPendingPollaScores().length);
    setConflictCount(readPendingPollaScores().filter((item) => item.status === "conflict").length);
    const invitedId = new URLSearchParams(window.location.search).get("polla");
    if (invitedId) {
      setPublicId(invitedId); setScreen("join"); setBusy(true);
      void requestPollaInvite(invitedId)
        .then((payload) => { setInvite(payload); setJoinPlayerId(payload.players?.[0]?.id || ""); })
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "No fue posible abrir la Polla."))
        .finally(() => setBusy(false));
    }
  }, []);

  useEffect(() => {
    if (!guest || screen !== "scorecard") return;
    loadGroup(guest);
    const online = async () => {
      setSyncLabel("Sincronizando…");
      const result = await flushPollaScoreQueue(guest.access_token, { tournamentId: guest.tournament_id, groupId: guest.group_id });
      setPendingCount(result.conflicts.length + result.remaining.length);
      setConflictCount(result.conflicts.length);
      setSyncLabel(result.conflicts.length ? `${result.conflicts.length} conflicto(s)` : result.remaining.length ? "Pendiente de conexión" : "✓ Sincronizado");
      await loadGroup(guest);
    };
    window.addEventListener("online", online);
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) loadGroup(guest); };
    const timer = window.setInterval(refresh, 20_000);
    const supabase = getSupabaseBrowser();
    const channel = supabase?.channel(`polla-scorecard-${guest.tournament_id}-${guest.group_id}`).on("postgres_changes", { event: "*", schema: "public", table: "tournament_leaderboard_events", filter: `tournament_id=eq.${guest.tournament_id}` }, refresh).subscribe();
    return () => { window.removeEventListener("online", online); window.clearInterval(timer); if (channel) supabase?.removeChannel(channel); };
  }, [guest, screen]);

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
      const link = `${window.location.origin}/polla/${payload.tournament.short_code}`;
      const { default: QRCode } = await import("qrcode");
      setQr(await QRCode.toDataURL(link, { width: 240, margin: 1, color: { dark: "#112d25", light: "#ffffff" } }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear la Polla.");
    } finally { setBusy(false); }
  }

  async function loadInvite(identifier = publicId.trim()) {
    setBusy(true); setError("");
    try {
      const payload = await requestPollaInvite(identifier);
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
    try {
      const response = await fetch("/api/polla/group", { headers: { authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar la tarjeta.");
      setGroupData(payload);
      const stored = Object.fromEntries((payload.scores || []).map((score: any) => [`${score.player_id}:${score.hole}`, score.score]));
      const pending = readPendingPollaScores().filter((item) => item.tournamentId === session.tournament_id && item.groupId === session.group_id);
      for (const item of pending) stored[`${item.playerId}:${item.hole}`] = item.score;
      setPendingCount(pending.length);
      setConflictCount(pending.filter((item) => item.status === "conflict").length);
      if (pending.length) setSyncLabel(`${pending.length} cambio${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"}`);
      setScoreVersions(Object.fromEntries((payload.scores || []).filter((score: any) => score.updated_at).map((score: any) => [`${score.player_id}:${score.hole}`, score.updated_at])));
      const members = (payload.members || []).map((member: any) => member.tournament_players).filter(Boolean);
      setOyesPlayerId((current) => current || members[0]?.id || "");
      const tournament = Array.isArray(payload.group?.tournaments) ? payload.group.tournaments[0] : payload.group?.tournaments;
      const start = payload.group?.start_hole === 10 ? 10 : 1;
      const holes = tournament?.holes === 9 ? 9 : 18;
      const order = pollaHoleOrder(start, holes);
      const firstIncomplete = order.find((hole) => members.some((player: any) => typeof stored[`${player.id}:${hole}`] !== "number")) ?? order.at(-1) ?? start;
      setCurrentHole(firstIncomplete);
      setGroupScores(initializePollaHoleScores(stored, members.map((player: any) => player.id), firstIncomplete, tournament?.course_snapshot as PollaCourseHole[] | undefined));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar la tarjeta.");
    }
  }

  async function saveOyes() {
    if (!guest || !oyesPlayerId || oyesValue === "") return;
    const response = await fetch("/api/polla/oyes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${guest.access_token}` },
      body: JSON.stringify({ playerId: oyesPlayerId, hole: currentHole, value: Number(oyesValue), unit: oyesUnit, inches: Number(oyesInches || 0) }),
    });
    const payload = await response.json();
    if (!response.ok) setError(payload.error || "No fue posible guardar Oyes.");
    else { setSyncLabel(payload.retained ? "Oyes anterior más cercano conservado" : "✓ Oyes sincronizado"); setOyesValue(""); setOyesInches(""); setError(""); }
  }

  async function saveHole() {
    if (!guest || !groupData || scoreSaveInFlight.current) return;
    scoreSaveInFlight.current = true;
    setScoreSaving(true);
    const members = (groupData.members || []).map((member: any) => member.tournament_players).filter(Boolean);
    const tournament = Array.isArray(groupData.group?.tournaments) ? groupData.group.tournaments[0] : groupData.group?.tournaments;
    const courseSnapshot = tournament?.course_snapshot as PollaCourseHole[] | undefined;
    setSyncLabel("Guardando…");
    let conflictDetected = false;
    try {
      for (const player of members) {
        const initialized = initializePollaHoleScores(groupScores, [player.id], currentHole, courseSnapshot);
        const score = initialized[`${player.id}:${currentHole}`];
        const key = `${player.id}:${currentHole}`;
        const item = { id: crypto.randomUUID(), tournamentId: guest.tournament_id, groupId: guest.group_id, playerId: player.id, hole: currentHole, score, baseUpdatedAt: scoreVersions[key], queuedAt: new Date().toISOString() };
        enqueuePollaScore(item);
        if (!navigator.onLine) continue;
        try {
          const response = await fetch("/api/polla/scores", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest.access_token}` }, body: JSON.stringify(item) });
          if (response.status === 409) {
            enqueuePollaScore({ ...item, status: "conflict" });
            conflictDetected = true;
          } else if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            setError(payload.error || "El score quedó guardado localmente y pendiente de sincronización.");
          } else {
            const payload = await response.json();
            acknowledgePollaScore(item.id);
            if (payload.score?.updated_at) setScoreVersions((current) => ({ ...current, [key]: payload.score.updated_at }));
          }
        } catch { /* el score ya está seguro en la cola local */ }
      }
      const pendingItems = readPendingPollaScores().filter((item) => item.tournamentId === guest.tournament_id && item.groupId === guest.group_id);
      const pending = pendingItems.length;
      const conflicts = pendingItems.filter((item) => item.status === "conflict").length;
      setPendingCount(pending);
      setConflictCount(conflicts);
      setSyncLabel(conflictDetected || conflicts ? "Conflicto: el admin debe revisar el score" : pending ? `${navigator.onLine ? "" : "Sin conexión · "}${pending} cambio${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}` : "✓ Sincronizado");
      const start = groupData.group?.start_hole === 10 ? 10 : 1;
      const holes = tournament?.holes === 9 ? 9 : 18;
      const nextHole = nextPollaHole(currentHole, start, holes);
      if (nextHole !== null) {
        setCurrentHole(nextHole);
        setGroupScores((current) => initializePollaHoleScores(current, members.map((player: any) => player.id), nextHole, courseSnapshot));
      } else if (!pending) {
        setSyncLabel("✓ Último hoyo guardado");
      }
    } finally {
      scoreSaveInFlight.current = false;
      setScoreSaving(false);
    }
  }

  async function discardResolvedConflicts() {
    if (!guest || !window.confirm("¿El administrador ya resolvió estos conflictos? Se conservará la versión de nube.")) return;
    discardPollaScoreConflicts(guest.tournament_id, guest.group_id);
    setConflictCount(0);
    setPendingCount(readPendingPollaScores().length);
    setSyncLabel("Actualizando desde nube…");
    await loadGroup(guest);
  }

  async function shareCreatedPolla() {
    if (!created) return;
    const url = `${window.location.origin}/polla/${created.short_code}`;
    const text = `THE BACKYARD\n${created.name}\n${url}`;
    setShareMessage("");
    try {
      if (navigator.share) {
        await navigator.share({ title: created.name, text, url });
        setShareMessage("Invitación compartida.");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShareMessage("Enlace copiado.");
      } else {
        setShareMessage(`Copia este enlace: ${url}`);
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") setShareMessage("Compartir cancelado.");
      else setShareMessage(`No se pudo compartir. Copia este enlace: ${url}`);
    }
  }

  async function closeCard() {
    if (!guest || !window.confirm("¿Confirmas que esta tarjeta está correcta?")) return;
    if (!navigator.onLine) { setError("Conecta el dispositivo y sincroniza los cambios antes de confirmar la tarjeta."); return; }
    const queued = await flushPollaScoreQueue(guest.access_token, { tournamentId: guest.tournament_id, groupId: guest.group_id });
    setPendingCount(queued.conflicts.length + queued.remaining.length);
    setConflictCount(queued.conflicts.length);
    if (queued.conflicts.length || queued.remaining.length) { setError("Hay cambios pendientes o en conflicto. Resuélvelos antes de confirmar la tarjeta."); return; }
    const response = await fetch("/api/polla/group", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest.access_token}` }, body: JSON.stringify({ action: "confirm" }) });
    if (response.ok) await loadGroup(guest); else setError((await response.json()).error || "No fue posible cerrar la tarjeta.");
  }

  const loadLeaderboard = useCallback(async () => {
    if (!publicId.trim()) return;
    const query = new URLSearchParams({ scope: leaderboardScope });
    if (leaderboardGroupId) query.set("groupId", leaderboardGroupId);
    const response = await fetch(`/api/polla/leaderboard/${encodeURIComponent(publicId.trim())}?${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setLeaderboard(payload); else setError(payload.error || "Leaderboard no disponible.");
  }, [publicId, leaderboardScope, leaderboardGroupId]);

  function linkPrivateRound() {
    if (!guest || !privateRound?.active || !groupData) return;
    const members = (groupData.members || []).map((member: any) => member.tournament_players).filter(Boolean);
    const result = createPrivatePollaLink(privateRound.players, members, guest);
    if (!result.link) {
      const details = [...result.unmatched.map((name) => `${name} no coincide`), ...result.ambiguous.map((name) => `${name} está duplicado`)].join(" · ");
      setError(`No se pudo vincular: ${details || "no hay jugadores coincidentes"}.`);
      return;
    }
    localStorage.setItem(PRIVATE_POLLA_LINK_KEY, JSON.stringify(result.link));
    setSyncLabel("✓ Ronda privada vinculada");
    setError("");
  }

  async function loadMyTournaments() {
    if (!accessToken) return;
    setBusy(true); setError("");
    const response = await fetch("/api/polla/tournaments", { headers: { authorization: `Bearer ${accessToken}` } });
    const payload = await response.json();
    if (response.ok) { setMyTournaments(payload.tournaments || []); setScreen("mine"); }
    else setError(payload.error || "No fue posible cargar Mis Pollas.");
    setBusy(false);
  }

  async function loadAdminTournament(tournamentId: string) {
    if (!accessToken) return;
    setBusy(true); setError(""); setAdminMessage("");
    try {
      const response = await fetch(`/api/polla/admin/${encodeURIComponent(tournamentId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible abrir la administración.");
      setAdminData(payload);
      setAdminScores(Object.fromEntries((payload.scores || []).map((score: any) => [`${score.player_id}:${score.hole}`, score.score])));
      setAdminHole(payload.tournament?.start_hole === 10 ? 10 : 1);
      setScreen("manage");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible abrir la administración."); }
    finally { setBusy(false); }
  }

  async function adminAction(payload: Record<string, unknown>) {
    if (!accessToken || !adminData?.tournament?.id) return;
    setBusy(true); setError(""); setAdminMessage("");
    try {
      const response = await fetch(`/api/polla/admin/${encodeURIComponent(adminData.tournament.id)}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No fue posible guardar el cambio.");
      const successMessage = result.pin ? `PIN nuevo: ${result.pin} · compártelo en privado; solo se muestra ahora.` : "✓ Cambio guardado y auditado.";
      await loadAdminTournament(adminData.tournament.id);
      setAdminMessage(successMessage);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible guardar el cambio."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (screen !== "leaderboard" || !publicId) return;
    loadLeaderboard();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") loadLeaderboard(); };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    const supabase = getSupabaseBrowser();
    const realtimePublicId = leaderboard.tournament?.publicId || (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(publicId) ? publicId : "");
    const channel = realtimePublicId
      ? supabase?.channel(`polla-leaderboard-${realtimePublicId}`).on("postgres_changes", { event: "*", schema: "public", table: "tournament_leaderboard_events", filter: `public_id=eq.${realtimePublicId}` }, loadLeaderboard).subscribe()
      : undefined;
    return () => { window.clearInterval(timer); if (channel) supabase?.removeChannel(channel); };
  }, [screen, publicId, leaderboard.tournament?.publicId, loadLeaderboard]);

  const effectiveLeaderboardMode = leaderboardMode === "general" ? (leaderboard.tournament?.format === "gross" ? "gross" : "net") : leaderboardMode;
  const ranked = useMemo(() => rankPollaLeaderboard(leaderboard.rows, effectiveLeaderboardMode), [leaderboard.rows, effectiveLeaderboardMode]);

  if (!pollaCloudConfigured || !pollaEnabled) return <>
    <section className="hero pollaHero"><div><div className="eyebrow">🏆 POLLA LIVE</div><h1>Torneo grande, score simple.</h1><p>La modalidad cloud es independiente de Conejos, Skins y tus apuestas privadas.</p></div><span className="livePill">LIVE</span></section>
    <section className="card cloudRequired"><h2>{pollaCloudConfigured ? "Polla Live está pendiente de activación" : "Configura la nube para activar Polla Live"}</h2><p>La ronda privada sigue funcionando completa sin internet. Para torneos, agrega las variables de Supabase indicadas en <code>.env.example</code>, aplica la migración y habilita el flag del servidor.</p></section>
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
      {!accessToken && <section className="card"><h2>Cuenta del administrador</h2><p className="muted">Inicia sesión con correo OTP, Google o Apple para crear y administrar la Polla.</p><button type="button" className="secondary big" onClick={openAccess}>Iniciar sesión</button></section>}
      <form onSubmit={createTournament}>
        <section className="card"><h2>Crear Polla</h2><div className="grid2">
          <div><label>Nombre</label><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div><label>Fecha</label><input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div>
          <div><label>Campo</label>{courses.length ? <select required value={draft.courseName} onChange={(event) => setDraft({ ...draft, courseName: event.target.value })}><option value="">Selecciona</option>{Array.from(new Set(courses.map((course) => course.name))).map((name) => <option key={name}>{name}</option>)}</select> : <input required value={draft.courseName} onChange={(event) => setDraft({ ...draft, courseName: event.target.value })} />}</div>
          <div><label>Formato</label><select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value })}><option value="both">Gross + Neto</option><option value="gross">Medal Gross</option><option value="net">Medal Neto</option></select></div>
          <div><label>Hoyos</label><select value={draft.holes} onChange={(event) => setDraft({ ...draft, holes: Number(event.target.value) as 9 | 18 })}><option value={18}>18</option><option value={9}>9</option></select></div>
          <div><label>Salida</label><select value={draft.startHole} onChange={(event) => setDraft({ ...draft, startHole: Number(event.target.value) as 1 | 10 })}><option value={1}>H1</option><option value={10}>H10</option></select></div>
          <div><label>% HCP</label><NumericCaptureInput min={0} max={100} step={5} inputMode="numeric" value={draft.hcpPct} emptyWhenZero={false} onValueChange={(hcpPct) => setDraft({ ...draft, hcpPct: hcpPct ?? 0 })} /></div>
          <div><label>Modo HCP</label><select value={draft.handicapMode} onChange={(event) => setDraft({ ...draft, handicapMode: event.target.value })}><option value="decimal">Décimas</option><option value="half_up">.5 sube</option><option value="half_down">.5 baja</option><option value="six_up">.6 sube</option><option value="four_down">.4 baja</option></select></div>
        </div><label>Comentarios / reglas locales</label><textarea rows={3} value={draft.localRules} onChange={(event) => setDraft({ ...draft, localRules: event.target.value })} /></section>
        <section className="card"><div className="sectionTitle"><div><h2>Jugadores y grupos</h2><p>Manual, CSV o autoagrupar de 4; se permiten grupos de 3–5.</p></div><button type="button" className="textButton" onClick={() => setPlayers([...players, makePlayer(players.length)])}>+ Jugador</button></div>
          {players.map((player, index) => <div className="pollaPlayer" key={player.id}><input placeholder="Nombre" value={player.name} onChange={(event) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><NumericCaptureInput placeholder="HCP" inputMode="decimal" value={player.handicap} onValueChange={(handicap) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, handicap: handicap ?? 0 } : item))} /><input placeholder="Grupo" value={player.group || ""} onChange={(event) => setPlayers(players.map((item, itemIndex) => itemIndex === index ? { ...item, group: event.target.value } : item))} /><button type="button" className="remove" onClick={() => setPlayers(players.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}
          <button type="button" className="secondary" onClick={autoGroup} disabled={players.length < 3}>Autoagrupar de 4</button>
          <div className="csvImport"><label>Importar CSV · name,handicap,group,startHole,teeTime</label><textarea rows={4} value={csv} onChange={(event) => setCsv(event.target.value)} /><button type="button" className="secondary" onClick={importCsv}>Validar e importar</button>{csvIssues.map((issue) => <div className="bad" key={issue}>{issue}</div>)}</div>
        </section>
        <section className="card"><div className="sectionTitle"><div><h2>Premios y Oyes</h2><p>Solo registra/calcula; no mueve dinero.</p></div><button type="button" className="textButton" onClick={() => setPrizes([...prizes, { position: prizes.length + 1, category: "net", money: 0, percentage: 0, description: "" }])}>+ Premio</button></div>{prizes.map((prize, index) => <div className="prizeRow" key={index}><select value={prize.category} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as "gross" | "net" | "other" } : item))}><option value="net">Neto</option><option value="gross">Gross</option><option value="other">Otro</option></select><input aria-label="Posición" type="number" min={1} value={prize.position} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, position: Number(event.target.value) } : item))} /><div className="moneyField"><span>$</span><NumericCaptureInput aria-label="Dinero" inputMode="decimal" value={prize.money} onValueChange={(money) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, money: money ?? 0 } : item))} /></div><NumericCaptureInput aria-label="Porcentaje" min={0} max={100} inputMode="numeric" placeholder="%" value={prize.percentage} onValueChange={(percentage) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, percentage: percentage ?? 0 } : item))} /><input placeholder="Texto / premio físico" value={prize.description} onChange={(event) => setPrizes(prizes.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><button type="button" className="remove" onClick={() => setPrizes(prizes.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}<label className="miniLabel">Oyes en Par 3</label><div className="chips">{(courses.find((course) => course.name === draft.courseName)?.holes || []).filter((hole) => hole.par === 3).map((hole) => <button type="button" key={hole.number} className={`chipButton ${oyesHoles.includes(hole.number) ? "selected" : ""}`} onClick={() => setOyesHoles(oyesHoles.includes(hole.number) ? oyesHoles.filter((number) => number !== hole.number) : [...oyesHoles, hole.number])}>H{hole.number}</button>)}</div></section>
        <button className="primary big" disabled={busy}>{busy ? "Creando…" : "Crear Polla"}</button>
      </form>
      {created && <section className="card createdPolla"><h2>✓ {created.name} creada</h2><b>Código: {created.short_code}</b>{qr && <img src={qr} alt="Código QR para unirse a la Polla" />}<button className="secondary" onClick={shareCreatedPolla}>Compartir invitación</button>{shareMessage && <div className="hint" role="status">{shareMessage}</div>}<div className="accessPins">{accessList.map((item) => <span key={item.playerId}>{item.name} · {item.group} · PIN <b>{item.pin}</b></span>)}</div><div className="hint">Entrega cada PIN en privado. El backend solo conserva su hash.</div></section>}
    </>}

    {screen === "join" && <section className="card"><h2>Unirme a Polla</h2><label>Código o ID público</label><div className="inlineForm"><input value={publicId} onChange={(event) => setPublicId(event.target.value)} /><button className="secondary" onClick={() => loadInvite()} disabled={busy}>Buscar</button></div>{invite && <form onSubmit={joinTournament}><h3>{invite.tournament.name}</h3><label>Mi nombre / grupo</label><select value={joinPlayerId} onChange={(event) => setJoinPlayerId(event.target.value)}>{invite.players.map((player: any) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><label>PIN de 4–6 dígitos</label><input type="password" inputMode="numeric" pattern="[0-9]{4,6}" value={pin} onChange={(event) => setPin(event.target.value)} /><button className="primary" disabled={busy}>Entrar</button></form>}</section>}

    {screen === "scorecard" && scoreSaving && <div className="notice" role="status">Guardado local · sincronizando…</div>}
    {screen === "scorecard" && conflictCount > 0 && <div className="notice bad" role="alert">Hay {conflictCount} score{conflictCount === 1 ? "" : "s"} en conflicto. El admin debe revisar; después conserva la versión de nube.<button className="textButton" type="button" onClick={discardResolvedConflicts}>El admin ya resolvió · recargar nube</button></div>}

    {screen === "scorecard" && guest && <section className="card liveScorecard"><div className="row between"><div><h2>{groupData?.group?.name || "Tarjeta"}</h2><span className="syncState">{syncLabel}{pendingCount ? ` · ${pendingCount}` : ""}</span></div><b>Hoyo {currentHole}</b></div>{privateRound?.active && guest.role === "scorer" && <button className="secondary" onClick={linkPrivateRound}>Vincular ronda a Polla Live</button>}{groupData?.group?.status === "confirmed" ? <div className="successBox">✓ Tarjeta confirmada · solo el admin puede corregirla.</div> : guest.role === "viewer" ? <div className="notice">Modo jugador: puedes revisar la tarjeta. Solo el scorer/capitán del grupo captura scores.</div> : <>{(groupData?.members || []).map((member: any) => { const player = member.tournament_players; const key = `${player.id}:${currentHole}`; const tournament = Array.isArray(groupData.group?.tournaments) ? groupData.group.tournaments[0] : groupData.group?.tournaments; const initialized = initializePollaHoleScores(groupScores, [player.id], currentHole, tournament?.course_snapshot); const value = initialized[key]; return <div className="scoreRow" key={player.id}><div><b>{player.name}</b><span>HCP {player.handicap}</span></div><div className="stepper"><button aria-label={`Restar golpe a ${player.name}`} onClick={() => setGroupScores({ ...groupScores, [key]: Math.max(1, value - 1) })}>−</button><input aria-label={`Score de ${player.name} en hoyo ${currentHole}`} type="number" min={1} max={20} value={value} onChange={(event) => setGroupScores({ ...groupScores, [key]: Math.min(20, Math.max(1, Number(event.target.value) || value)) })} /><button aria-label={`Sumar golpe a ${player.name}`} onClick={() => setGroupScores({ ...groupScores, [key]: Math.min(20, value + 1) })}>+</button></div></div>; })}{(() => { const tournament = Array.isArray(groupData.group?.tournaments) ? groupData.group.tournaments[0] : groupData.group?.tournaments; const members = (groupData.members || []).map((member: any) => member.tournament_players).filter(Boolean); return tournament?.oyes_holes?.includes(currentHole) ? <div className="oyesCapture"><h3>Oyes · Hoyo {currentHole}</h3><select aria-label="Jugador Oyes" value={oyesPlayerId} onChange={(event) => setOyesPlayerId(event.target.value)}>{members.map((player: any) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><input aria-label="Distancia Oyes" inputMode="decimal" value={oyesValue} onChange={(event) => setOyesValue(event.target.value)} placeholder="Distancia" /><select aria-label="Unidad Oyes" value={oyesUnit} onChange={(event) => setOyesUnit(event.target.value as "m" | "cm" | "ft_in")}><option value="m">metros</option><option value="cm">centímetros</option><option value="ft_in">pies/pulgadas</option></select>{oyesUnit === "ft_in" && <input aria-label="Pulgadas Oyes" inputMode="numeric" value={oyesInches} onChange={(event) => setOyesInches(event.target.value)} placeholder="pulgadas" />}<button className="secondary" type="button" onClick={saveOyes}>Guardar Oyes</button></div> : null; })()}<button className="primary big" onClick={saveHole}>Guardar hoyo</button><button className="secondary" onClick={closeCard}>Cerrar tarjeta</button></>}</section>}

    {screen === "leaderboard" && <section className="card"><h2>Leaderboard en vivo</h2><div className="inlineForm"><input placeholder="Código o ID público" value={publicId} onChange={(event) => setPublicId(event.target.value)} /><button className="secondary" onClick={loadLeaderboard}>Abrir</button></div><div className="segmented"><button className={leaderboardMode === "general" ? "active" : ""} onClick={() => setLeaderboardMode("general")}>General</button><button className={leaderboardMode === "gross" ? "active" : ""} onClick={() => setLeaderboardMode("gross")}>Gross</button><button className={leaderboardMode === "net" ? "active" : ""} onClick={() => setLeaderboardMode("net")}>Neto</button></div><div className="segmented scopeFilters"><button className={leaderboardScope === "all" && !leaderboardGroupId ? "active" : ""} onClick={() => { setLeaderboardScope("all"); setLeaderboardGroupId(""); }}>18 / General</button><button className={leaderboardScope === "front9" ? "active" : ""} onClick={() => { setLeaderboardScope("front9"); setLeaderboardGroupId(""); }}>H1–9</button><button className={leaderboardScope === "back9" ? "active" : ""} onClick={() => { setLeaderboardScope("back9"); setLeaderboardGroupId(""); }}>H10–18</button><button disabled={!guest?.group_id} className={leaderboardGroupId ? "active" : ""} onClick={() => { setLeaderboardScope("all"); setLeaderboardGroupId(guest?.group_id || ""); }}>Mi grupo</button></div><div className="tableWrap"><table><thead><tr><th>Pos</th><th>Jugador</th><th>HCP</th><th>Thru</th><th>Gross</th><th>Neto</th><th>+/- Par</th></tr></thead><tbody>{ranked.map((row, index) => { const relative = effectiveLeaderboardMode === "gross" ? (row.grossRelativeToPar ?? row.relativeToPar) : (row.netRelativeToPar ?? row.relativeToPar); return <tr key={row.playerId}><td>{index + 1}</td><td><b>{row.name}</b>{row.groupName && <small>{row.groupName}</small>}</td><td>{row.handicap}</td><td>{row.finished ? "F" : row.thru}</td><td>{row.gross}</td><td>{row.net}</td><td>{relative > 0 ? "+" : ""}{relative}</td></tr>; })}</tbody></table></div>{Boolean(leaderboard.oyes?.length) && <div className="oyesLeaderboard"><h3>Oyes</h3>{leaderboard.oyes?.map((item) => <div key={item.hole}><b>H{item.hole}</b><span>{item.playerName} · {item.distanceMeters.toFixed(2)} m</span></div>)}</div>}</section>}

    {screen === "mine" && <section className="card"><div className="sectionTitle"><div><h2>Mis Pollas</h2><p>Próximas, en vivo y terminadas.</p></div><button className="textButton" onClick={() => setScreen("create")}>+ Crear</button></div>{busy && <div className="empty">Cargando…</div>}{!busy && !myTournaments.length && <div className="empty">Todavía no has creado Pollas.</div>}{myTournaments.map((tournament) => <button className="recentRound" key={tournament.id} onClick={() => loadAdminTournament(tournament.id)}><span>{tournament.status === "upcoming" ? "Próxima" : tournament.status === "live" ? "● En vivo" : "Terminada"}</span><b>{tournament.name} · {tournament.course_name}</b><strong>{tournament.short_code} · Administrar</strong></button>)}</section>}

    {screen === "manage" && adminData && <>
      <section className="card adminTournament"><div className="sectionTitle"><div><h2>{adminData.tournament.name}</h2><p>{adminData.isOwner ? "OWNER" : "ADMIN"} · {adminData.tournament.short_code}</p></div><button className="secondary" onClick={() => { setPublicId(adminData.tournament.public_id); setScreen("leaderboard"); }}>Ver leaderboard</button></div><label>Estado del torneo<select value={adminData.tournament.status} disabled={busy} onChange={(event) => adminAction({ action: "tournamentStatus", status: event.target.value })}><option value="upcoming">Próximo</option><option value="live">En vivo</option><option value="finished">Finalizado</option></select></label><label>Hoyo para corregir<input type="number" min={1} max={18} value={adminHole} onChange={(event) => setAdminHole(Math.min(18, Math.max(1, Number(event.target.value) || 1)))} /></label><label>Motivo de corrección (opcional)<input value={adminReason} onChange={(event) => setAdminReason(event.target.value)} placeholder="Ej. Corrección firmada por jugador" /></label>{adminMessage && <div className="successBox" role="status">{adminMessage}</div>}</section>
      {(adminData.groups || []).map((group: any) => { const members = (adminData.members || []).filter((member: any) => member.group_id === group.id); return <section className="card adminGroup" key={group.id}><div className="sectionTitle"><div><h3>{group.name}</h3><p>{group.status === "confirmed" ? "✓ Tarjeta confirmada" : "Tarjeta abierta"}</p></div><button className="secondary" disabled={busy} onClick={() => adminAction({ action: "groupStatus", groupId: group.id, status: group.status === "confirmed" ? "open" : "confirmed" })}>{group.status === "confirmed" ? "Reabrir" : "Confirmar"}</button></div><label>Scorer principal<select value={members.find((member: any) => member.is_scorer)?.tournament_players?.id || ""} onChange={(event) => adminAction({ action: "setScorer", groupId: group.id, playerId: event.target.value })}><option value="">Selecciona</option>{members.map((member: any) => <option key={member.tournament_players?.id} value={member.tournament_players?.id}>{member.tournament_players?.name}</option>)}</select></label>{members.map((member: any) => { const player = member.tournament_players; const key = `${player.id}:${adminHole}`; const courseHole = adminData.tournament.course_snapshot?.find((hole: any) => hole.number === adminHole); const value = adminScores[key] ?? courseHole?.par ?? 4; const version = adminData.scores?.find((score: any) => score.player_id === player.id && score.hole === adminHole)?.updated_at; return <div className="scoreRow" key={player.id}><div><b>{player.name}</b><span>HCP {player.handicap}{member.is_scorer ? " · Scorer" : ""}</span></div><div className="stepper"><button aria-label={`Restar golpe a ${player.name}`} onClick={() => setAdminScores((current) => ({ ...current, [key]: Math.max(1, value - 1) }))}>−</button><input aria-label={`Corrección de ${player.name}`} type="number" min={1} max={20} value={value} onChange={(event) => setAdminScores((current) => ({ ...current, [key]: Math.min(20, Math.max(1, Number(event.target.value) || value)) }))} /><button aria-label={`Sumar golpe a ${player.name}`} onClick={() => setAdminScores((current) => ({ ...current, [key]: Math.min(20, value + 1) }))}>+</button><button className="secondary" disabled={busy} onClick={() => adminAction({ action: "score", groupId: group.id, playerId: player.id, hole: adminHole, score: adminScores[key] ?? value, baseUpdatedAt: version, reason: adminReason })}>Guardar</button></div><button className="textButton" disabled={busy} onClick={() => adminAction({ action: "regeneratePin", playerId: player.id })}>Regenerar PIN</button></div>; })}</section>; })}
      {adminData.isOwner && <section className="card"><h3>Administradores</h3><p className="hint">Agrega únicamente el UUID de una cuenta confirmada de The Backyard.</p><div className="inlineForm"><input aria-label="User ID de administrador" value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} placeholder="UUID del usuario" /><button className="secondary" disabled={busy || !adminUserId.trim()} onClick={() => adminAction({ action: "grantAdmin", userId: adminUserId.trim() })}>Agregar admin</button></div>{(adminData.administrators || []).filter((item: any) => item.role === "admin" && !item.revoked_at && item.user_id !== adminData.tournament.created_by).map((item: any) => <div className="row between" key={item.id}><code>{item.user_id}</code><button className="dangerGhost" onClick={() => adminAction({ action: "revokeAdmin", userId: item.user_id })}>Revocar</button></div>)}</section>}
      <section className="card"><h3>Auditoría de scores</h3>{!(adminData.audit || []).length ? <div className="empty">Todavía no hay cambios.</div> : <div className="auditList">{(adminData.audit || []).slice(0, 50).map((item: any) => <div key={item.id}><b>H{item.hole} · {item.old_score ?? "—"} → {item.new_score}</b><span>{new Date(item.changed_at).toLocaleString("es-MX")}{item.reason ? ` · ${item.reason}` : ""}</span></div>)}</div>}</section>
    </>}
  </>;
}
