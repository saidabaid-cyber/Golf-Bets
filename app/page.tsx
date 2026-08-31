"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BallFriendHole,
  BetConfig,
  Course,
  Expense,
  FoursomeSegment,
  HoleScore,
  PersonalBet,
  Player,
  RoundSnapshot,
  UnitEvent,
} from "../lib/types";
import {
  calculateBallFriend,
  calculateFoursomes,
  calculatePersonalBets,
  calculateRabbits,
  calculateSkins,
  calculateUnits,
  expenseTotal,
  mergeBalances,
  opponentPairs,
  payoutWinnerTakesFromAll,
  playOrder,
  playersByIds,
  segmentDefinitions,
  settleBalances,
} from "../lib/engine";

const makeId = () => Math.random().toString(36).slice(2, 10);
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-MX")}`;

const samplePlayers: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "cuau", name: "Cuau", handicap: 11 },
  { id: "armando", name: "Armando", handicap: 7 },
  { id: "jesus", name: "Jesús", handicap: 2 },
  { id: "raul", name: "Raúl", handicap: 11 },
];

const laVista: Course = {
  id: "lavista-blancas",
  name: "La Vista",
  teeName: "Blancas",
  rating: 70.8,
  slope: 128,
  holes: [
    { number: 1, par: 4, strokeIndex: 5 }, { number: 2, par: 3, strokeIndex: 17 },
    { number: 3, par: 4, strokeIndex: 7 }, { number: 4, par: 5, strokeIndex: 1 },
    { number: 5, par: 4, strokeIndex: 9 }, { number: 6, par: 4, strokeIndex: 13 },
    { number: 7, par: 3, strokeIndex: 15 }, { number: 8, par: 4, strokeIndex: 3 },
    { number: 9, par: 5, strokeIndex: 11 }, { number: 10, par: 5, strokeIndex: 12 },
    { number: 11, par: 4, strokeIndex: 8 }, { number: 12, par: 3, strokeIndex: 18 },
    { number: 13, par: 4, strokeIndex: 14 }, { number: 14, par: 4, strokeIndex: 2 },
    { number: 15, par: 5, strokeIndex: 4 }, { number: 16, par: 4, strokeIndex: 10 },
    { number: 17, par: 3, strokeIndex: 16 }, { number: 18, par: 4, strokeIndex: 6 },
  ],
};

function initialBets(ids: string[]): BetConfig {
  return {
    rabbits: { enabled: true, value: 100, hcpPct: 80, decimals: "partial", accumulate: true, participantIds: ids },
    skins: { enabled: true, value: 50, hcpPct: 80, decimals: "partial", accumulate: true, participantIds: ids },
    units: { enabled: true, value: 100, participantIds: ids },
    foursome: {
      enabled: true, hcpPct: 100, decimals: "round", segmentSize: 6,
      mode: "fixed", fixedValue: 200, pointValue: 100, participantIds: ids,
    },
    ballFriend: { enabled: false, value: 20, hcpPct: 80, decimals: "round", maxScore: 9, participantIds: ids },
  };
}

const emptyExpenses: Expense = { caddie: 0, breakfast: 0, lunch: 0, drinks: 0, other: 0 };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={onClick} aria-label="activar"><span /></button>;
}

function ParticipantChips({
  players, selected, onChange,
}: { players: Player[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="chips">{players.map((p) => {
    const on = selected.includes(p.id);
    return <button key={p.id} className={`chipButton ${on ? "selected" : ""}`} onClick={() => {
      onChange(on ? selected.filter((id) => id !== p.id) : [...selected, p.id]);
    }}>{p.name}</button>;
  })}</div>;
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <div><label>{label}</label><input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /></div>;
}

export default function Page() {
  const [tab, setTab] = useState<"setup" | "round" | "results" | "history" | "courses">("setup");
  const [courses, setCourses] = useState<Course[]>([laVista]);
  const [course, setCourse] = useState<Course>(laVista);
  const [courseDraft, setCourseDraft] = useState<Course>(laVista);
  const [startHole, setStartHole] = useState<1 | 10>(1);
  const [players, setPlayers] = useState<Player[]>(samplePlayers);
  const [ownerId, setOwnerId] = useState("said");
  const [bets, setBets] = useState<BetConfig>(() => initialBets(samplePlayers.map((p) => p.id)));
  const [segments, setSegments] = useState<FoursomeSegment[]>(() => segmentDefinitions(playOrder(1), 6));
  const [personalBets, setPersonalBets] = useState<PersonalBet[]>([]);
  const [scores, setScores] = useState<Record<number, HoleScore>>({});
  const [unitEvents, setUnitEvents] = useState<UnitEvent[]>([]);
  const [ballFriendSetup, setBallFriendSetup] = useState<Record<number, BallFriendHole>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expenses, setExpenses] = useState<Expense>(emptyExpenses);
  const [history, setHistory] = useState<RoundSnapshot[]>([]);
  const [roundId, setRoundId] = useState(makeId());
  const [roundDate, setRoundDate] = useState(new Date().toISOString().slice(0, 10));
  const [hydrated, setHydrated] = useState(false);

  const order = useMemo(() => playOrder(startHole), [startHole]);
  const holeNumber = order[currentIndex];
  const hole = course.holes.find((h) => h.number === holeNumber) ?? course.holes[0];

  useEffect(() => {
    try {
      const savedCourses = JSON.parse(localStorage.getItem("golfbets-courses") || "null");
      const savedHistory = JSON.parse(localStorage.getItem("golfbets-history") || "null");
      const draft = JSON.parse(localStorage.getItem("golfbets-draft-v1") || "null");
      if (Array.isArray(savedCourses) && savedCourses.length) setCourses(savedCourses);
      if (Array.isArray(savedHistory)) setHistory(savedHistory);
      if (draft) {
        if (draft.course) setCourse(draft.course);
        if (draft.startHole) setStartHole(draft.startHole);
        if (draft.players) setPlayers(draft.players);
        if (draft.ownerId) setOwnerId(draft.ownerId);
        if (draft.bets) setBets(draft.bets);
        if (draft.segments) setSegments(draft.segments);
        if (draft.personalBets) setPersonalBets(draft.personalBets);
        if (draft.scores) setScores(draft.scores);
        if (draft.unitEvents) setUnitEvents(draft.unitEvents);
        if (draft.ballFriendSetup) setBallFriendSetup(draft.ballFriendSetup);
        if (draft.expenses) setExpenses(draft.expenses);
        if (draft.roundId) setRoundId(draft.roundId);
        if (draft.roundDate) setRoundDate(draft.roundDate);
      }
    } catch { /* ignore corrupt local data */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("golfbets-courses", JSON.stringify(courses));
    localStorage.setItem("golfbets-history", JSON.stringify(history));
    localStorage.setItem("golfbets-draft-v1", JSON.stringify({
      course, startHole, players, ownerId, bets, segments, personalBets, scores,
      unitEvents, ballFriendSetup, expenses, roundId, roundDate,
    }));
  }, [hydrated, courses, history, course, startHole, players, ownerId, bets, segments, personalBets, scores, unitEvents, ballFriendSetup, expenses, roundId, roundDate]);

  useEffect(() => {
    const defs = segmentDefinitions(order, bets.foursome.segmentSize);
    setSegments((old) => defs.map((d, i) => ({ ...d, basePair: old[i]?.basePair ?? [] })));
  }, [startHole, bets.foursome.segmentSize]);

  useEffect(() => {
    const valid = new Set(players.map((p) => p.id));
    const sanitize = (ids: string[]) => ids.filter((id) => valid.has(id));
    setBets((b) => ({
      ...b,
      rabbits: { ...b.rabbits, participantIds: sanitize(b.rabbits.participantIds) },
      skins: { ...b.skins, participantIds: sanitize(b.skins.participantIds) },
      units: { ...b.units, participantIds: sanitize(b.units.participantIds) },
      foursome: { ...b.foursome, participantIds: sanitize(b.foursome.participantIds) },
      ballFriend: { ...b.ballFriend, participantIds: sanitize(b.ballFriend.participantIds) },
    }));
    if (!valid.has(ownerId) && players[0]) setOwnerId(players[0].id);
  }, [players.length]);

  const rabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, order), [course, scores, players, bets.rabbits, order]);
  const skins = useMemo(() => calculateSkins(course, scores, players, bets.skins, order), [course, scores, players, bets.skins, order]);
  const units = useMemo(() => calculateUnits(players, unitEvents, bets.units), [players, unitEvents, bets.units]);
  const foursomes = useMemo(() => calculateFoursomes(course, scores, players, bets.foursome, segments, order), [course, scores, players, bets.foursome, segments, order]);
  const ballFriend = useMemo(() => calculateBallFriend(course, scores, players, bets.ballFriend, ballFriendSetup, order), [course, scores, players, bets.ballFriend, ballFriendSetup, order]);
  const personals = useMemo(() => calculatePersonalBets(personalBets, ownerId, players, course, scores, order), [personalBets, ownerId, players, course, scores, order]);

  const rabbitBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.rabbits.participantIds), rabbits.won, bets.rabbits.value), [players, bets.rabbits, rabbits.won]);
  const skinBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.skins.participantIds), skins.won, bets.skins.value), [players, bets.skins, skins.won]);
  const allBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, personals.balances), [players, rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, personals.balances]);
  const transfers = useMemo(() => settleBalances(allBetBalances), [allBetBalances]);
  const owner = players.find((p) => p.id === ownerId) ?? players[0];
  const ownerBetResult = allBetBalances[owner?.id] ?? 0;
  const ownerExpenseTotal = expenseTotal(expenses);
  const ownerNet = ownerBetResult - ownerExpenseTotal;

  const categoryResults = useMemo(() => ({
    Conejos: rabbitBalances[ownerId] ?? 0,
    Skins: skinBalances[ownerId] ?? 0,
    Unidades: units.balances[ownerId] ?? 0,
    Foursome: foursomes.balances[ownerId] ?? 0,
    "Bola Amiga": ballFriend.balances[ownerId] ?? 0,
    Personales: personals.balances[ownerId] ?? 0,
  }), [rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, personals.balances, ownerId]);

  const playerName = (id?: string) => players.find((p) => p.id === id)?.name ?? "—";

  function updatePlayer(id: string, patch: Partial<Player>) {
    setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p));
  }

  function addPlayer() {
    const id = makeId();
    const p = { id, name: `Jugador ${players.length + 1}`, handicap: 0 };
    setPlayers((ps) => [...ps, p]);
    setBets((b) => ({
      ...b,
      rabbits: { ...b.rabbits, participantIds: [...b.rabbits.participantIds, id] },
      skins: { ...b.skins, participantIds: [...b.skins.participantIds, id] },
      units: { ...b.units, participantIds: [...b.units.participantIds, id] },
      foursome: { ...b.foursome, participantIds: [...b.foursome.participantIds, id] },
      ballFriend: { ...b.ballFriend, participantIds: [...b.ballFriend.participantIds, id] },
    }));
  }

  function scoreFor(playerId: string) {
    return scores[holeNumber]?.[playerId] ?? null;
  }

  function setScore(playerId: string, value: number) {
    setScores((prev) => ({ ...prev, [holeNumber]: { ...(prev[holeNumber] || {}), [playerId]: Math.max(1, value) } }));
  }

  function changeScore(playerId: string, delta: number) {
    setScore(playerId, Number(scoreFor(playerId) ?? hole.par) + delta);
  }

  function addUnit(playerId: string, amount: number) {
    setUnitEvents((e) => [...e, { id: makeId(), hole: holeNumber, playerId, amount }]);
  }

  function undoLastUnit(playerId: string) {
    setUnitEvents((events) => {
      const idx = [...events].map((e, i) => ({ e, i })).reverse().find((x) => x.e.hole === holeNumber && x.e.playerId === playerId)?.i;
      return idx === undefined ? events : events.filter((_, i) => i !== idx);
    });
  }

  function toggleBasePair(segmentId: string, playerId: string) {
    setSegments((segs) => segs.map((s) => {
      if (s.id !== segmentId) return s;
      const pair = [...s.basePair];
      const exists = pair.includes(playerId);
      const next = exists ? pair.filter((id) => id !== playerId) : pair.length < 2 ? [...pair, playerId] : [pair[1], playerId];
      return { ...s, basePair: next };
    }));
  }

  function newPersonalBet() {
    const rival = players.find((p) => p.id !== ownerId);
    if (!rival) return;
    setPersonalBets((b) => [...b, {
      id: makeId(), rivalPlayerId: rival.id, baseValue: 100, advantageReceiverId: rival.id,
      advantageStrokes: 0, back9Multiplier: 1,
      components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
    }]);
  }

  function saveRound() {
    if (!owner) return;
    const snapshot: RoundSnapshot = {
      id: roundId, date: roundDate, courseName: course.name, teeName: course.teeName,
      ownerName: owner.name, betResult: ownerBetResult, expenses, expenseTotal: ownerExpenseTotal,
      netResult: ownerNet, categoryResults,
    };
    setHistory((h) => [snapshot, ...h.filter((x) => x.id !== roundId)]);
    setTab("history");
  }

  function resetRound() {
    const ids = players.map((p) => p.id);
    setScores({}); setUnitEvents([]); setBallFriendSetup({}); setPersonalBets([]); setExpenses(emptyExpenses);
    setBets(initialBets(ids)); setSegments(segmentDefinitions(playOrder(startHole), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(new Date().toISOString().slice(0, 10)); setTab("setup");
  }

  function startNewCourse() {
    const fresh: Course = {
      id: makeId(), name: "Campo nuevo", teeName: "Tee", rating: 72, slope: 113,
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i % 5 === 1 ? 3 : i % 5 === 3 ? 5 : 4, strokeIndex: i + 1 })),
    };
    setCourseDraft(fresh); setTab("courses");
  }

  function saveCourseDraft() {
    setCourses((cs) => [courseDraft, ...cs.filter((c) => c.id !== courseDraft.id)]);
    setCourse(courseDraft); setTab("setup");
  }

  const currentRabbitEvents = rabbits.events.filter((e) => e.hole === holeNumber);
  const currentSkin = skins.events.find((e) => e.hole === holeNumber);
  const unitHoleNet = (id: string) => unitEvents.filter((e) => e.hole === holeNumber && e.playerId === id).reduce((a, e) => a + e.amount, 0);
  const bfParticipants = playersByIds(players, bets.ballFriend.participantIds);
  const bfSetup = ballFriendSetup[holeNumber] ?? { teamA: [] };
  const bfActiveIds = bets.ballFriend.participantIds.filter((id) => id !== bfSetup.restPlayerId);
  const bfTeamB = bfActiveIds.filter((id) => !bfSetup.teamA.includes(id));
  const bfDetail = ballFriend.details.find((d) => d.hole === holeNumber);

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentYear = String(now.getFullYear());
  const monthRounds = history.filter((h) => h.date.startsWith(currentMonth));
  const yearRounds = history.filter((h) => h.date.startsWith(currentYear));
  const sum = (arr: RoundSnapshot[], key: "netResult" | "betResult" | "expenseTotal") => arr.reduce((a, r) => a + r[key], 0);
  const expenseByKey = (arr: RoundSnapshot[], key: keyof Expense) => arr.reduce((a, r) => a + (r.expenses[key] || 0), 0);

  return <main className="app">
    <header className="topbar">
      <div><div className="brand">Golf Bets</div><div className="subbrand">Apuestas · liquidación · histórico</div></div>
      <span className="version">V1</span>
    </header>

    {tab === "setup" && <>
      <section className="hero">
        <div><div className="eyebrow">NUEVA JUGADA</div><h1>Configura y juega.</h1><p>La app calcula lo automático; tú solo capturas score y eventos especiales.</p></div>
        <input className="dateInput" type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} />
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>1. Campo</h2><p>Elige uno guardado o registra uno nuevo.</p></div><button className="textButton" onClick={startNewCourse}>+ Campo</button></div>
        <div className="grid2">
          <div><label>Campo / tee</label><select value={course.id} onChange={(e) => {
            const c = courses.find((x) => x.id === e.target.value); if (c) setCourse(c);
          }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.teeName}</option>)}</select></div>
          <div><label>Salida</label><select value={startHole} onChange={(e) => setStartHole(Number(e.target.value) as 1 | 10)}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></div>
        </div>
        <div className="courseMeta"><span>Par {course.holes.reduce((a, h) => a + h.par, 0)}</span><span>Rating {course.rating ?? "—"}</span><span>Slope {course.slope ?? "—"}</span><button onClick={() => { setCourseDraft(course); setTab("courses"); }}>Editar</button></div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>2. Jugadores</h2><p>HCP de la ronda. La base se recalcula según cada apuesta.</p></div><button className="textButton" onClick={addPlayer}>+ Jugador</button></div>
        {players.map((p) => <div className="playerEdit" key={p.id}>
          <input value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} />
          <input className="hcpInput" type="number" step="0.1" value={p.handicap} onChange={(e) => updatePlayer(p.id, { handicap: Number(e.target.value) })} />
          <button className={`ownerDot ${ownerId === p.id ? "active" : ""}`} onClick={() => setOwnerId(p.id)} title="Jugador principal">★</button>
          <button className="remove" disabled={players.length <= 2} onClick={() => setPlayers((ps) => ps.filter((x) => x.id !== p.id))}>×</button>
        </div>)}
        <div className="hint">★ marca al jugador principal para estadísticas y gastos.</div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>3. Apuestas generales</h2><p>Cada apuesta tiene su propio porcentaje y participantes.</p></div></div>

        <div className="betCard">
          <div className="betHead"><div><b>🐇 Conejos</b><span>Agarra · mantiene · gana · acumula</span></div><Toggle on={bets.rabbits.enabled} onClick={() => setBets({ ...bets, rabbits: { ...bets.rabbits, enabled: !bets.rabbits.enabled } })} /></div>
          {bets.rabbits.enabled && <><div className="grid3"><NumberField label="Valor" value={bets.rabbits.value} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, value: v } })} /><NumberField label="% HCP" value={bets.rabbits.hcpPct} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.rabbits.decimals} onChange={(e) => setBets({ ...bets, rabbits: { ...bets.rabbits, decimals: e.target.value as "partial" | "round" } })}><option value="partial">Cuentan</option><option value="round">Redondear</option></select></div></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.rabbits.participantIds} onChange={(ids) => setBets({ ...bets, rabbits: { ...bets.rabbits, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>⛳ Skins</b><span>Empates acumulan</span></div><Toggle on={bets.skins.enabled} onClick={() => setBets({ ...bets, skins: { ...bets.skins, enabled: !bets.skins.enabled } })} /></div>
          {bets.skins.enabled && <><div className="grid3"><NumberField label="Valor" value={bets.skins.value} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, value: v } })} /><NumberField label="% HCP" value={bets.skins.hcpPct} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.skins.decimals} onChange={(e) => setBets({ ...bets, skins: { ...bets.skins, decimals: e.target.value as "partial" | "round" } })}><option value="partial">Cuentan</option><option value="round">Redondear</option></select></div></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.skins.participantIds} onChange={(ids) => setBets({ ...bets, skins: { ...bets.skins, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🔢 Unidades / Copas</b><span>Positivas menos negativas; todos pagan a todos</span></div><Toggle on={bets.units.enabled} onClick={() => setBets({ ...bets, units: { ...bets.units, enabled: !bets.units.enabled } })} /></div>
          {bets.units.enabled && <><NumberField label="Valor por unidad" value={bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, value: v } })} /><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.units.participantIds} onChange={(ids) => setBets({ ...bets, units: { ...bets.units, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🤝 Foursome</b><span>Fijo · fijo + patada · solo puntos</span></div><Toggle on={bets.foursome.enabled} onClick={() => setBets({ ...bets, foursome: { ...bets.foursome, enabled: !bets.foursome.enabled } })} /></div>
          {bets.foursome.enabled && <>
            <div className="grid3">
              <div><label>Modalidad</label><select value={bets.foursome.mode} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, mode: e.target.value as BetConfig["foursome"]["mode"] } })}><option value="fixed">Fijo</option><option value="fixed_points">Fijo + Patada</option><option value="points">Solo puntos</option></select></div>
              <div><label>Cambia parejas</label><select value={bets.foursome.segmentSize} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, segmentSize: Number(e.target.value) as 3 | 6 | 9 | 18 } })}><option value={3}>Cada 3</option><option value={6}>Cada 6</option><option value={9}>Cada 9</option><option value={18}>18 hoyos</option></select></div>
              <NumberField label="% HCP" value={bets.foursome.hcpPct} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, hcpPct: v } })} />
              {(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") && <NumberField label="Foursome fijo" value={bets.foursome.fixedValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, fixedValue: v } })} />}
              {(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") && <NumberField label="Valor punto / patada" value={bets.foursome.pointValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, pointValue: v } })} />}
              <div><label>Decimales</label><select value={bets.foursome.decimals} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, decimals: e.target.value as "partial" | "round" } })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div>
            </div>
            <label className="miniLabel">Jugadores de Foursome</label><ParticipantChips players={players} selected={bets.foursome.participantIds} onChange={(ids) => setBets({ ...bets, foursome: { ...bets.foursome, participantIds: ids } })} />
            <div className="segments">{segments.map((s) => {
              const holes = order.slice(s.startIndex, s.endIndex + 1);
              const opps = opponentPairs(bets.foursome.participantIds, s.basePair);
              return <div className="segment" key={s.id}><div className="segmentTitle">Hoyos {holes[0]}–{holes[holes.length - 1]} · pareja base</div><div className="chips">{playersByIds(players, bets.foursome.participantIds).map((p) => <button key={p.id} className={`chipButton ${s.basePair.includes(p.id) ? "selected" : ""}`} onClick={() => toggleBasePair(s.id, p.id)}>{p.name}</button>)}</div>{s.basePair.length === 2 && <div className="generated"><b>{playerName(s.basePair[0])} + {playerName(s.basePair[1])}</b>{opps.map((o, i) => <span key={i}>vs {playerName(o[0])} + {playerName(o[1])}</span>)}</div>}</div>;
            })}</div>
          </>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>⚪ Bola Amiga</b><span>Parejas por hoyo · birdie o mejor voltea rival · máximo 9</span></div><Toggle on={bets.ballFriend.enabled} onClick={() => setBets({ ...bets, ballFriend: { ...bets.ballFriend, enabled: !bets.ballFriend.enabled } })} /></div>
          {bets.ballFriend.enabled && <><div className="grid3"><NumberField label="Valor punto" value={bets.ballFriend.value} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, value: v } })} /><NumberField label="% HCP" value={bets.ballFriend.hcpPct} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, hcpPct: v } })} /><NumberField label="Score máximo" value={bets.ballFriend.maxScore} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, maxScore: v } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.ballFriend.participantIds} onChange={(ids) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, participantIds: ids } })} /></>}
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>4. Apuestas personales</h2><p>Ventaja capturada aparte; presión multiplica Match 2 y Medal 2.</p></div><button className="textButton" onClick={newPersonalBet}>+ Personal</button></div>
        {!personalBets.length && <div className="empty">Sin apuestas personales.</div>}
        {personalBets.map((bet) => <div className="personalCard" key={bet.id}>
          <div className="row between"><b>{owner?.name ?? "Base"} vs</b><button className="remove" onClick={() => setPersonalBets((bs) => bs.filter((x) => x.id !== bet.id))}>×</button></div>
          <div className="grid3">
            <div><label>Rival</label><select value={bet.rivalPlayerId} onChange={(e) => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, rivalPlayerId: e.target.value } : b))}>{players.filter((p) => p.id !== ownerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <NumberField label="Valor base" value={bet.baseValue} onChange={(v) => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, baseValue: v } : b))} />
            <NumberField label="Presión 2ª vuelta ×" value={bet.back9Multiplier} onChange={(v) => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, back9Multiplier: Math.max(1, v) } : b))} />
            <div><label>Quién recibe ventaja</label><select value={bet.advantageReceiverId || "none"} onChange={(e) => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, advantageReceiverId: e.target.value === "none" ? undefined : e.target.value } : b))}><option value="none">Scratch</option><option value={ownerId}>{owner?.name}</option><option value={bet.rivalPlayerId}>{playerName(bet.rivalPlayerId)}</option></select></div>
            <NumberField label="Golpes" value={bet.advantageStrokes} onChange={(v) => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, advantageStrokes: Math.max(0, v) } : b))} />
          </div>
          <div className="componentGrid">{([['match1','Match 1'],['medal1','Medal 1'],['match2','Match 2'],['medal2','Medal 2'],['match18','Match N'],['medal18','Medal N']] as const).map(([key, label]) => <button key={key} className={`component ${bet.components[key] ? "selected" : ""}`} onClick={() => setPersonalBets((bs) => bs.map((b) => b.id === bet.id ? { ...b, components: { ...b.components, [key]: !b.components[key] } } : b))}>{label}</button>)}</div>
        </div>)}
      </section>

      <button className="primary big" onClick={() => { setCurrentIndex(0); setTab("round"); }}>Iniciar ronda →</button>
    </>}

    {tab === "round" && <>
      <div className="holeNav">{order.map((h, i) => <button key={h} className={i === currentIndex ? "active" : scores[h] ? "done" : ""} onClick={() => setCurrentIndex(i)}>{h}</button>)}</div>
      <section className="holeHero">
        <div><div className="eyebrow">{course.name} · {course.teeName}</div><h1>Hoyo {holeNumber}</h1><p>Par {hole.par} · Ventaja {hole.strokeIndex}</p></div>
        <div className="progress">{currentIndex + 1}<span>/18</span></div>
      </section>

      <section className="card scoreCard">
        {players.map((p) => <div className="scoreRow" key={p.id}>
          <div><b>{p.name}</b><span>HCP {p.handicap}</span></div>
          <div className="stepper"><button onClick={() => changeScore(p.id, -1)}>−</button><input type="number" value={scoreFor(p.id) ?? ""} placeholder={String(hole.par)} onChange={(e) => setScore(p.id, Number(e.target.value) || hole.par)} /><button onClick={() => changeScore(p.id, 1)}>+</button></div>
        </div>)}
        <div className="liveBadges">
          {currentRabbitEvents.map((e, i) => <span className="badge" key={`${e.type}-${i}`}>🐇 {e.type === "grab" ? "Agarra" : e.type === "hold" ? "Mantiene" : e.type === "win" ? `Gana ×${e.count}` : e.type === "lose" ? "Pierde / libre" : e.type === "accumulate" ? `Acumula → ${e.count}` : "Libre"} {e.playerId ? playerName(e.playerId) : ""}</span>)}
          {currentSkin?.winnerId && <span className="badge">⛳ {playerName(currentSkin.winnerId)} gana {currentSkin.count} skin{currentSkin.count !== 1 ? "s" : ""}</span>}
        </div>
      </section>

      {bets.units.enabled && <section className="card">
        <div className="sectionTitle"><div><h2>Unidades / Copas</h2><p>Marca + o − en este hoyo.</p></div></div>
        {playersByIds(players, bets.units.participantIds).map((p) => <div className="eventRow" key={p.id}><b>{p.name}</b><div className="eventControls"><button onClick={() => addUnit(p.id, -1)}>− Copa</button><strong className={unitHoleNet(p.id) > 0 ? "good" : unitHoleNet(p.id) < 0 ? "bad" : ""}>{unitHoleNet(p.id) > 0 ? "+" : ""}{unitHoleNet(p.id)}</strong><button onClick={() => addUnit(p.id, 1)}>+ Unidad</button><button className="undo" onClick={() => undoLastUnit(p.id)}>↶</button></div></div>)}
      </section>}

      {bets.ballFriend.enabled && <section className="card">
        <div className="sectionTitle"><div><h2>Bola Amiga</h2><p>Elige descanso (si son 5) y una pareja; la otra sale sola.</p></div></div>
        {bfParticipants.length === 5 && <><label className="miniLabel">Descansa</label><div className="chips">{bfParticipants.map((p) => <button key={p.id} className={`chipButton ${bfSetup.restPlayerId === p.id ? "resting" : ""}`} onClick={() => setBallFriendSetup((s) => ({ ...s, [holeNumber]: { teamA: (s[holeNumber]?.teamA || []).filter((id) => id !== p.id), restPlayerId: p.id } }))}>{p.name}</button>)}</div></>}
        <label className="miniLabel">Primera pareja</label>
        <div className="chips">{bfParticipants.filter((p) => p.id !== bfSetup.restPlayerId).map((p) => <button key={p.id} className={`chipButton ${bfSetup.teamA.includes(p.id) ? "selected" : ""}`} onClick={() => setBallFriendSetup((state) => {
          const old = state[holeNumber] || { teamA: [], restPlayerId: bfSetup.restPlayerId };
          const on = old.teamA.includes(p.id);
          const team = on ? old.teamA.filter((id) => id !== p.id) : old.teamA.length < 2 ? [...old.teamA, p.id] : [old.teamA[1], p.id];
          return { ...state, [holeNumber]: { ...old, teamA: team } };
        })}>{p.name}</button>)}</div>
        {bfSetup.teamA.length === 2 && bfTeamB.length === 2 && <div className="versus"><b>{playerName(bfSetup.teamA[0])} + {playerName(bfSetup.teamA[1])}</b><span>VS</span><b>{playerName(bfTeamB[0])} + {playerName(bfTeamB[1])}</b></div>}
        {bfDetail && <div className="ballResult"><span>{bfDetail.numberA.toFixed(1).replace('.0','')} vs {bfDetail.numberB.toFixed(1).replace('.0','')}</span><b className={bfDetail.pointDiff >= 0 ? "good" : "bad"}>{bfDetail.pointDiff >= 0 ? "+" : ""}{bfDetail.pointDiff.toFixed(1).replace('.0','')} puntos equipo 1</b>{(bfDetail.birdieOrBetterA || bfDetail.birdieOrBetterB) && <small>🐦 Birdie o mejor: se volteó el score contrario.</small>}</div>}
      </section>}

      {bets.foursome.enabled && <section className="card compact">
        <h3>Foursome actual</h3>
        {(() => {
          const seg = segments.find((s) => currentIndex >= s.startIndex && currentIndex <= s.endIndex);
          if (!seg || seg.basePair.length !== 2) return <div className="empty">Falta elegir pareja base de este tramo.</div>;
          return <div className="generated"><b>{playerName(seg.basePair[0])} + {playerName(seg.basePair[1])}</b>{opponentPairs(bets.foursome.participantIds, seg.basePair).map((o, i) => <span key={i}>vs {playerName(o[0])} + {playerName(o[1])}</span>)}</div>;
        })()}
      </section>}

      <div className="roundActions"><button className="secondary big" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>← Anterior</button><button className="primary big" onClick={() => currentIndex < 17 ? setCurrentIndex((i) => i + 1) : setTab("results")}>{currentIndex < 17 ? "Guardar y siguiente →" : "Ver resultados →"}</button></div>
    </>}

    {tab === "results" && <>
      <section className="hero resultHero"><div><div className="eyebrow">RESULTADO DEL DÍA</div><h1 className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</h1><p>{owner?.name}: apuestas {money(ownerBetResult)} · gastos {money(-ownerExpenseTotal)}</p></div><button className="secondary" onClick={() => setTab("round")}>Editar tarjeta</button></section>

      <section className="card">
        <h2>Resumen por jugador</h2>
        <div className="tableWrap"><table><thead><tr><th>Jugador</th><th>Conejos</th><th>Skins</th><th>Unidades</th><th>Foursome</th><th>B. Amiga</th><th>Personales</th><th>Total</th></tr></thead><tbody>{players.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{money(rabbitBalances[p.id] ?? 0)}</td><td>{money(skinBalances[p.id] ?? 0)}</td><td>{money(units.balances[p.id] ?? 0)}</td><td>{money(foursomes.balances[p.id] ?? 0)}</td><td>{money(ballFriend.balances[p.id] ?? 0)}</td><td>{money(personals.balances[p.id] ?? 0)}</td><td className={(allBetBalances[p.id] ?? 0) >= 0 ? "good" : "bad"}><b>{money(allBetBalances[p.id] ?? 0)}</b></td></tr>)}</tbody></table></div>
      </section>

      <section className="card">
        <h2>Liquidación</h2><p className="muted">Transferencias neteadas para pagar lo menos posible.</p>
        {!transfers.length ? <div className="empty">Todos quedan tablas.</div> : transfers.map((t, i) => <div className="transfer" key={i}><span><b>{playerName(t.fromPlayerId)}</b> paga a <b>{playerName(t.toPlayerId)}</b></span><strong>{money(t.amount)}</strong></div>)}
      </section>

      {bets.foursome.enabled && <section className="card">
        <h2>Detalle Foursome</h2>
        {foursomes.matches.map((m, i) => <div className="matchLine" key={i}><div><b>H{m.startHole}–{m.endHole}: {playerName(m.basePair[0])}/{playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])}/{playerName(m.opponentPair[1])}</span></div><div className="matchNums"><span>{m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts</span><b className={m.totalMoney >= 0 ? "good" : "bad"}>{m.complete ? money(m.totalMoney) : "Pendiente"}</b></div></div>)}
      </section>}

      {personalBets.length > 0 && <section className="card"><h2>Personales</h2>{personals.results.map((r) => <div className="personalResult" key={r.betId}><div className="row between"><b>{owner?.name} vs {playerName(r.rivalId)}</b><strong className={r.totalMoney >= 0 ? "good" : "bad"}>{money(r.totalMoney)}</strong></div><div className="componentResults">{Object.entries(r.componentMoney).map(([k, v]) => <span key={k}>{k.replace("match","Match ").replace("medal","Medal ").replace("18","N")}: <b>{money(Number(v))}</b></span>)}</div></div>)}</section>}

      <section className="card">
        <h2>Gastos de {owner?.name}</h2>
        <div className="grid2"><NumberField label="Caddie" value={expenses.caddie} onChange={(v) => setExpenses({ ...expenses, caddie: v })} /><NumberField label="Desayuno" value={expenses.breakfast} onChange={(v) => setExpenses({ ...expenses, breakfast: v })} /><NumberField label="Comida" value={expenses.lunch} onChange={(v) => setExpenses({ ...expenses, lunch: v })} /><NumberField label="Bebidas" value={expenses.drinks} onChange={(v) => setExpenses({ ...expenses, drinks: v })} /><NumberField label="Otros" value={expenses.other} onChange={(v) => setExpenses({ ...expenses, other: v })} /></div>
        <div className="totalStrip"><span>Total gastos</span><b>{money(ownerExpenseTotal)}</b></div>
      </section>

      <section className="card summaryCard"><div><span>Apuestas</span><b className={ownerBetResult >= 0 ? "good" : "bad"}>{money(ownerBetResult)}</b></div><div><span>Gastos</span><b className="bad">{money(-ownerExpenseTotal)}</b></div><div className="grand"><span>NETO DEL DÍA</span><b className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</b></div></section>
      <div className="roundActions"><button className="secondary big" onClick={resetRound}>Nueva ronda</button><button className="primary big" onClick={saveRound}>Guardar en histórico</button></div>
    </>}

    {tab === "history" && <>
      <section className="hero"><div><div className="eyebrow">HISTÓRICO</div><h1>Lo que realmente cuesta jugar.</h1><p>Apuestas separadas de caddie, comida y demás gastos.</p></div></section>
      <div className="statsGrid"><div className="stat"><span>Neto este mes</span><b className={sum(monthRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(monthRounds, "netResult"))}</b><small>{monthRounds.length} rondas</small></div><div className="stat"><span>Neto este año</span><b className={sum(yearRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(yearRounds, "netResult"))}</b><small>{yearRounds.length} rondas</small></div><div className="stat"><span>Apuestas año</span><b>{money(sum(yearRounds, "betResult"))}</b><small>sin gastos</small></div><div className="stat"><span>Gasto año</span><b className="bad">{money(-sum(yearRounds, "expenseTotal"))}</b><small>costo real</small></div></div>
      <section className="card"><h2>Gastos del año</h2><div className="expenseBars">{([['caddie','Caddie'],['breakfast','Desayuno'],['lunch','Comida'],['drinks','Bebidas'],['other','Otros']] as [keyof Expense,string][]).map(([k, label]) => <div key={k}><span>{label}</span><b>{money(expenseByKey(yearRounds, k))}</b></div>)}</div></section>
      <section className="card"><div className="sectionTitle"><div><h2>Rondas</h2><p>Más recientes primero.</p></div><button className="textButton" onClick={resetRound}>+ Nueva</button></div>{!history.length ? <div className="empty">Todavía no has guardado rondas.</div> : history.map((r) => <div className="historyRow" key={r.id}><div><b>{r.courseName} · {r.teeName}</b><span>{r.date} · apuestas {money(r.betResult)} · gastos {money(r.expenseTotal)}</span></div><strong className={r.netResult >= 0 ? "good" : "bad"}>{money(r.netResult)}</strong></div>)}</section>
    </>}

    {tab === "courses" && <>
      <section className="hero"><div><div className="eyebrow">CAMPO</div><h1>{courseDraft.name}</h1><p>Par y ventaja de cada hoyo son la base de todos los cálculos.</p></div></section>
      <section className="card"><div className="grid2"><div><label>Nombre</label><input value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} /></div><div><label>Tee</label><input value={courseDraft.teeName} onChange={(e) => setCourseDraft({ ...courseDraft, teeName: e.target.value })} /></div><NumberField label="Rating" step={0.1} value={courseDraft.rating ?? 0} onChange={(v) => setCourseDraft({ ...courseDraft, rating: v })} /><NumberField label="Slope" value={courseDraft.slope ?? 0} onChange={(v) => setCourseDraft({ ...courseDraft, slope: v })} /></div></section>
      <section className="card"><div className="courseGrid"><div className="courseGridHead">Hoyo</div><div className="courseGridHead">Par</div><div className="courseGridHead">Ventaja</div>{courseDraft.holes.map((h) => <div className="courseGridRow" key={h.number}><b>{h.number}</b><input type="number" min={3} max={6} value={h.par} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, par: Number(e.target.value) } : x) })} /><input type="number" min={1} max={18} value={h.strokeIndex} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, strokeIndex: Number(e.target.value) } : x) })} /></div>)}</div></section>
      <div className="roundActions"><button className="secondary big" onClick={() => setTab("setup")}>Cancelar</button><button className="primary big" onClick={saveCourseDraft}>Guardar campo</button></div>
    </>}

    <nav className="bottomNav"><button className={tab === "setup" ? "active" : ""} onClick={() => setTab("setup")}><span>⌂</span>Inicio</button><button className={tab === "round" ? "active" : ""} onClick={() => setTab("round")}><span>18</span>Tarjeta</button><button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><span>$</span>Resultados</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><span>↗</span>Histórico</button></nav>
  </main>;
}
