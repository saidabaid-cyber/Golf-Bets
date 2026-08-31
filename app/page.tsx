"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BallFriendHole,
  BetConfig,
  Course,
  Expense,
  FoursomeSegment,
  HoleScore,
  ManualBet,
  MedalPollaConfig,
  PersonalBet,
  Player,
  RoundSnapshot,
  SavedPersonalRival,
  UnitEvent,
} from "../lib/types";
import {
  calculateBallFriend,
  calculateFoursomes,
  calculateManualBets,
  calculateMiniPolla,
  calculatePersonalBets,
  calculatePolla,
  calculateRabbits,
  calculateSkins,
  calculateUnits,
  expenseTotal,
  mergeBalances,
  opponentPairs,
  payoutWinnerTakesFromAll,
  playOrder,
  playersByIds,
  personalRivalKey,
  segmentDefinitions,
} from "../lib/engine";

const makeId = () => Math.random().toString(36).slice(2, 10);
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-MX")}`;
const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const quantityAndMoney = (quantity: number, amount: number, signedQuantity = false) =>
  `${signedQuantity && quantity > 0 ? "+" : ""}${quantity.toLocaleString("es-MX")} · ${signedMoney(amount)}`;

const samplePlayers: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "cuau", name: "Cuau", handicap: 11 },
  { id: "armando", name: "Armando", handicap: 7 },
  { id: "jesus", name: "Jesús", handicap: 2 },
  { id: "raul", name: "Raúl", handicap: 11 },
];

const laVistaPars = [4,3,4,5,4,4,3,4,5,5,4,3,4,4,5,4,3,4];
const laVistaStroke = [5,17,7,1,9,13,15,3,11,12,8,18,14,2,4,10,16,6];
const laVistaTees = [
  { id: "lavista-azules", teeName: "Azules", rating: 74.3, slope: 146, totalYards: 7230, yards: [435,187,416,538,419,367,191,425,562,538,388,158,393,505,605,418,213,471] },
  { id: "lavista-blancas", teeName: "Blancas", rating: 70.8, slope: 128, totalYards: 6590, yards: [392,165,398,483,389,343,158,374,488,529,358,138,368,433,581,395,173,425] },
  { id: "lavista-doradas", teeName: "Doradas", rating: 68.4, slope: 121, totalYards: 6038, yards: [362,136,358,469,365,323,138,334,457,490,326,108,326,392,542,368,156,388] },
  { id: "lavista-rojas", teeName: "Rojas", rating: 71.0, slope: 137, totalYards: 5476, yards: [331,115,297,447,319,270,116,306,430,446,306,99,292,364,503,343,135,357] },
] as const;

const laVistaCourses: Course[] = laVistaTees.map((tee) => ({
  id: tee.id,
  name: "La Vista",
  teeName: tee.teeName,
  rating: tee.rating,
  slope: tee.slope,
  totalYards: tee.totalYards,
  holes: laVistaPars.map((par, i) => ({ number: i + 1, par, strokeIndex: laVistaStroke[i], yards: tee.yards[i] })),
}));

const laVistaTemporalPars = [4,3,4,3,4,3,3,4,5,5,4,3,4,4,5,4,3,4];
const laVistaTemporalStroke = [4,16,8,18,6,14,12,2,10,11,7,17,13,1,3,9,15,5];
const laVistaTemporalTees = [
  { id: "lavista-temporal-blue", teeName: "Blue", rating: 70.2, slope: 126 },
  { id: "lavista-temporal-white", teeName: "White", rating: 67.5, slope: 119 },
  { id: "lavista-temporal-gold", teeName: "Gold", rating: 65.2, slope: 113 },
  { id: "lavista-temporal-red", teeName: "Red", rating: 67.9, slope: 127 },
] as const;

const laVistaTemporalCourses: Course[] = laVistaTemporalTees.map((tee) => ({
  id: tee.id,
  name: "La Vista Temporal",
  teeName: tee.teeName,
  rating: tee.rating,
  slope: tee.slope,
  holes: laVistaTemporalPars.map((par, i) => ({ number: i + 1, par, strokeIndex: laVistaTemporalStroke[i] })),
}));

function makeGeneralCourse(id: string, name: string, pars: number[], stroke: number[], yards?: number[]): Course {
  return {
    id,
    name,
    teeName: "General",
    totalYards: yards?.reduce((a, y) => a + y, 0),
    holes: pars.map((par, i) => ({ number: i + 1, par, strokeIndex: stroke[i], yards: yards?.[i] })),
  };
}

// Campos de Puebla precargados. Par + Ventaja/SI son suficientes para el motor de apuestas.
// Rating, slope y tees adicionales se pueden completar/editarlos después sin afectar el cálculo base.
const campestrePuebla = makeGeneralCourse(
  "campestre-puebla-general",
  "Campestre de Puebla",
  [4,3,5,4,4,4,4,3,5,4,4,5,3,4,5,4,3,4],
  [11,17,1,15,7,9,3,13,5,2,18,6,12,10,8,4,14,16],
);

const elCristo = makeGeneralCourse(
  "el-cristo-general",
  "El Cristo",
  [5,3,4,4,4,4,3,4,5,5,3,4,4,4,5,4,3,4],
  [4,18,12,14,6,8,16,2,10,5,15,3,9,11,13,1,17,7],
);

const colaDeLagarto = makeGeneralCourse(
  "cola-de-lagarto-general",
  "Cola de Lagarto",
  [5,4,4,3,4,4,5,3,5,4,3,5,4,4,3,4,3,5],
  [5,17,15,3,13,9,11,7,1,4,14,12,16,2,8,10,6,18],
);

const defaultCourses: Course[] = [
  ...laVistaCourses,
  ...laVistaTemporalCourses,
  campestrePuebla,
  elCristo,
  colaDeLagarto,
];

const laVista = laVistaCourses.find((c) => c.teeName === "Blancas")!;

function localDateMexico() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mergeDefaultCourses(saved: Course[] | null | undefined) {
  const source = Array.isArray(saved) ? saved : [];
  const byId = new Map(source.map((c) => [c.id, c]));
  for (const d of defaultCourses) byId.set(d.id, d); // canonical default course data wins
  return Array.from(byId.values());
}

function initialBets(ids: string[]): BetConfig {
  return {
    rabbits: { enabled: true, value: 100, hcpPct: 100, decimals: "partial", accumulate: true, participantIds: ids },
    skins: { enabled: true, value: 50, hcpPct: 100, decimals: "partial", accumulate: true, participantIds: ids },
    units: { enabled: true, value: 100, participantIds: ids },
    foursome: {
      enabled: true, hcpPct: 100, decimals: "round", segmentSize: 6,
      mode: "fixed", fixedValue: 200, pointValue: 100, participantIds: ids,
    },
    ballFriend: { enabled: false, value: 20, hcpPct: 100, decimals: "round", maxScore: 9, participantIds: ids },
    polla: {
      first9: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
      second9: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
      total18: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
    },
    miniPolla: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: ids },
  };
}

function normalizePolla(raw: any, ids: string[]): BetConfig["polla"] {
  const defaults = initialBets(ids).polla;
  const normalizeComponent = (value: any, fallback: MedalPollaConfig): MedalPollaConfig => ({
    ...fallback,
    ...(value || {}),
    participantIds: Array.isArray(value?.participantIds) ? value.participantIds : fallback.participantIds,
  });

  if (raw?.first9 || raw?.second9 || raw?.total18) {
    return {
      first9: normalizeComponent(raw.first9, defaults.first9),
      second9: normalizeComponent(raw.second9, defaults.second9),
      total18: normalizeComponent(raw.total18, defaults.total18),
    };
  }

  const legacyBase = {
    enabled: Boolean(raw?.enabled),
    hcpPct: raw?.hcpPct ?? 100,
    decimals: raw?.decimals ?? "round",
    participantIds: Array.isArray(raw?.participantIds) ? raw.participantIds : ids,
  };
  return {
    first9: { ...defaults.first9, ...legacyBase, value: raw?.first9Value ?? raw?.nineValue ?? defaults.first9.value },
    second9: { ...defaults.second9, ...legacyBase, value: raw?.second9Value ?? defaults.second9.value },
    total18: { ...defaults.total18, ...legacyBase, value: raw?.total18Value ?? defaults.total18.value },
  };
}

const emptyExpenses: Expense = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };

function normalizeExpenses(raw: any): Expense {
  return {
    caddie: Number(raw?.caddie || 0),
    food: Number(raw?.food ?? ((raw?.breakfast || 0) + (raw?.lunch || 0))),
    drinks: Number(raw?.drinks || 0),
    greenFee: Number(raw?.greenFee || 0),
    cartRental: Number(raw?.cartRental || 0),
    other: Number(raw?.other || 0),
  };
}

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
    }}>{on ? `✓ ${p.name}` : p.name}</button>;
  })}</div>;
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <div><label>{label}</label><input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /></div>;
}

function HcpPercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div><label>% HCP</label><input type="number" inputMode="numeric" min={0} max={100} step={5} placeholder="0" value={value === 0 ? "" : value} onChange={(e) => onChange(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>;
}

function PollaBetEditor({
  title, description, config, players, onChange, unavailable,
}: {
  title: string;
  description: string;
  config: MedalPollaConfig;
  players: Player[];
  onChange: (config: MedalPollaConfig) => void;
  unavailable?: boolean;
}) {
  return <div className="betCard">
    <div className="betHead"><div><b>🏆 {title}</b><span>{description}</span></div><Toggle on={config.enabled} onClick={() => onChange({ ...config, enabled: !config.enabled })} /></div>
    {config.enabled && <>
      <div className="grid3">
        <NumberField label="Valor" value={config.value} onChange={(value) => onChange({ ...config, value })} />
        <HcpPercentInput value={config.hcpPct} onChange={(hcpPct) => onChange({ ...config, hcpPct })} />
        <div><label>Decimales</label><select value={config.decimals} onChange={(e) => onChange({ ...config, decimals: e.target.value as "partial" | "round" })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div>
      </div>
      <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={config.participantIds} onChange={(participantIds) => onChange({ ...config, participantIds })} />
      <div className="hint">Cada valor es por jugador. El pozo se reparte entre los ganadores si empatan.{unavailable ? " Esta apuesta requiere una ronda de 18 hoyos." : ""}</div>
    </>}
  </div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div><label>{label}</label><input type="number" inputMode="decimal" placeholder="0" value={value === 0 ? "" : value} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value) || 0)} /></div>;
}

function OptionalNumberField({ label, value, onChange, step = 1 }: { label: string; value?: number; onChange: (v: number | undefined) => void; step?: number }) {
  return <div><label>{label}</label><input type="number" inputMode="decimal" step={step} placeholder="Opcional" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></div>;
}

export default function Page() {
  const [tab, setTab] = useState<"setup" | "round" | "personals" | "results" | "history" | "courses">("setup");
  const [courses, setCourses] = useState<Course[]>(defaultCourses);
  const [course, setCourse] = useState<Course>(laVista);
  const [courseDraft, setCourseDraft] = useState<Course>(laVista);
  const [startHole, setStartHole] = useState<1 | 10>(1);
  const [roundHoles, setRoundHoles] = useState<9 | 18>(18);
  const [players, setPlayers] = useState<Player[]>(samplePlayers);
  const [ownerId, setOwnerId] = useState("said");
  const [bets, setBets] = useState<BetConfig>(() => initialBets(samplePlayers.map((p) => p.id)));
  const [segments, setSegments] = useState<FoursomeSegment[]>(() => segmentDefinitions(playOrder(1), 6));
  const [personalBets, setPersonalBets] = useState<PersonalBet[]>([]);
  const [savedPersonalRivals, setSavedPersonalRivals] = useState<SavedPersonalRival[]>([]);
  const [manualBets, setManualBets] = useState<ManualBet[]>([]);
  const [showFullScorecard, setShowFullScorecard] = useState(false);
  const [scores, setScores] = useState<Record<number, HoleScore>>({});
  const [unitEvents, setUnitEvents] = useState<UnitEvent[]>([]);
  const [ballFriendSetup, setBallFriendSetup] = useState<Record<number, BallFriendHole>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expenses, setExpenses] = useState<Expense>(emptyExpenses);
  const [history, setHistory] = useState<RoundSnapshot[]>([]);
  const [roundId, setRoundId] = useState(makeId());
  const [roundDate, setRoundDate] = useState(localDateMexico());
  const [quickPars, setQuickPars] = useState("");
  const [quickStroke, setQuickStroke] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const order = useMemo(() => playOrder(startHole).slice(0, roundHoles), [startHole, roundHoles]);
  const holeNumber = order[currentIndex];
  const hole = course.holes.find((h) => h.number === holeNumber) ?? course.holes[0];
  const courseNames: string[] = useMemo(() => Array.from(new Set<string>(courses.map((c) => c.name))).sort((a, b) => a.localeCompare(b)), [courses]);
  const teesForCourse = useMemo(() => courses.filter((c) => c.name === course.name), [courses, course.name]);
  const totalYards = course.totalYards ?? course.holes.reduce((a, h) => a + (h.yards || 0), 0);

  useEffect(() => {
    try {
      const savedCourses = JSON.parse(localStorage.getItem("golfbets-courses") || "null");
      const savedHistory = JSON.parse(localStorage.getItem("golfbets-history") || "null");
      const savedRivals = JSON.parse(localStorage.getItem("golfbets-personal-rivals") || "null");
      const draft = JSON.parse(localStorage.getItem("golfbets-draft-v1") || "null");
      const mergedCourses = mergeDefaultCourses(savedCourses);
      setCourses(mergedCourses);
      if (Array.isArray(savedHistory)) setHistory(savedHistory.map((r: any) => ({ ...r, expenses: normalizeExpenses(r.expenses) })));
      if (Array.isArray(savedRivals)) setSavedPersonalRivals(savedRivals);
      if (draft) {
        if (draft.course) setCourse(mergedCourses.find((c) => c.id === draft.course.id) || draft.course);
        if (draft.startHole) setStartHole(draft.startHole);
        if (draft.roundHoles === 9 || draft.roundHoles === 18) setRoundHoles(draft.roundHoles);
        if (draft.players) setPlayers(draft.players);
        if (draft.ownerId) setOwnerId(draft.ownerId);
        if (draft.bets) {
          const draftPlayerIds = (draft.players || samplePlayers).map((p: Player) => p.id);
          const defaults = initialBets(draftPlayerIds);
          setBets({
            ...defaults,
            ...draft.bets,
            polla: normalizePolla(draft.bets.polla, draftPlayerIds),
            miniPolla: { ...defaults.miniPolla, ...(draft.bets.miniPolla || {}) },
          });
        }
        if (draft.segments) setSegments(draft.segments);
        if (draft.personalBets) setPersonalBets(draft.personalBets.map((b: any) => ({
          id: b.id || makeId(),
          rivalMode: b.rivalMode || "group",
          rivalPlayerId: b.rivalPlayerId,
          externalRivalId: b.externalRivalId,
          rivalName: b.rivalName || (draft.players || samplePlayers).find((p: Player) => p.id === b.rivalPlayerId)?.name || "Rival",
          externalScores: b.externalScores || {},
          baseValue: b.baseValue ?? 100,
          advantageReceiver: (b.advantageReceiver === "owner" || b.advantageReceiver === "rival") ? b.advantageReceiver : (b.advantageReceiverId ? (b.advantageReceiverId === (draft.ownerId || ownerId) ? "owner" : "rival") : "rival"),
          advantageStrokes: b.advantageReceiver === "none" ? 0 : (b.advantageStrokes ?? 0),
          back9Multiplier: b.back9Multiplier ?? 1,
          components: b.components || { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
        })));
        if (Array.isArray(draft.manualBets)) setManualBets(draft.manualBets);
        if (draft.scores) setScores(draft.scores);
        if (draft.unitEvents) setUnitEvents(draft.unitEvents);
        if (draft.ballFriendSetup) setBallFriendSetup(draft.ballFriendSetup);
        if (draft.expenses) setExpenses(normalizeExpenses(draft.expenses));
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
    localStorage.setItem("golfbets-personal-rivals", JSON.stringify(savedPersonalRivals));
    localStorage.setItem("golfbets-draft-v1", JSON.stringify({
      course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores,
      unitEvents, ballFriendSetup, expenses, roundId, roundDate,
    }));
  }, [hydrated, courses, history, savedPersonalRivals, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores, unitEvents, ballFriendSetup, expenses, roundId, roundDate]);

  useEffect(() => {
    const defs = segmentDefinitions(order, bets.foursome.segmentSize);
    setSegments((old) => defs.map((d, i) => ({ ...d, basePair: old[i]?.basePair ?? [] })));
  }, [order, bets.foursome.segmentSize]);

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
      polla: {
        first9: { ...b.polla.first9, participantIds: sanitize(b.polla.first9.participantIds) },
        second9: { ...b.polla.second9, participantIds: sanitize(b.polla.second9.participantIds) },
        total18: { ...b.polla.total18, participantIds: sanitize(b.polla.total18.participantIds) },
      },
      miniPolla: { ...(b.miniPolla ?? initialBets(players.map((p) => p.id)).miniPolla), participantIds: sanitize((b.miniPolla ?? initialBets(players.map((p) => p.id)).miniPolla).participantIds) },
    }));
    if (!valid.has(ownerId) && players[0]) setOwnerId(players[0].id);
  }, [players.length]);

  // When a hole opens, every group player gets Par as a REAL score by default.
  // This fixes the old behavior where Par was only a placeholder and the hole stayed incomplete
  // until the user touched +/−. The user now only changes players who did not make Par.
  useEffect(() => {
    if (tab !== "round" || !hole) return;
    setScores((prev) => {
      const current = prev[holeNumber] || {};
      let changed = false;
      const nextRow: HoleScore = { ...current };
      for (const p of players) {
        if (typeof nextRow[p.id] !== "number") { nextRow[p.id] = hole.par; changed = true; }
      }
      return changed ? { ...prev, [holeNumber]: nextRow } : prev;
    });
  }, [tab, holeNumber, hole.par, players]);

  const rabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, order), [course, scores, players, bets.rabbits, order]);
  const skins = useMemo(() => calculateSkins(course, scores, players, bets.skins, order), [course, scores, players, bets.skins, order]);
  const units = useMemo(() => calculateUnits(players, unitEvents, bets.units, course, scores, order), [players, unitEvents, bets.units, course, scores, order]);
  const foursomes = useMemo(() => calculateFoursomes(course, scores, players, bets.foursome, segments, order), [course, scores, players, bets.foursome, segments, order]);
  const ballFriend = useMemo(() => calculateBallFriend(course, scores, players, bets.ballFriend, ballFriendSetup, order), [course, scores, players, bets.ballFriend, ballFriendSetup, order]);
  const personals = useMemo(() => calculatePersonalBets(personalBets, ownerId, players, course, scores, order), [personalBets, ownerId, players, course, scores, order]);
  const polla = useMemo(() => calculatePolla(course, scores, players, bets.polla, order), [course, scores, players, bets.polla, order]);
  const miniPolla = useMemo(() => calculateMiniPolla(course, scores, players, bets.miniPolla, order), [course, scores, players, bets.miniPolla, order]);
  const manual = useMemo(() => calculateManualBets(players, manualBets), [players, manualBets]);

  const rabbitBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.rabbits.participantIds), rabbits.won, bets.rabbits.value), [players, bets.rabbits, rabbits.won]);
  const skinBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.skins.participantIds), skins.won, bets.skins.value), [players, bets.skins, skins.won]);
  const allBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, personals.balances, manual.balances), [players, rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, personals.balances, manual.balances]);
  const settlementIds = useMemo(() => {
    const ids = [...players.map((p) => p.id)];
    for (const r of personals.results) if (r.rivalId.startsWith("personal:") && !ids.includes(r.rivalId)) ids.push(r.rivalId);
    return ids;
  }, [players, personals.results]);
  const owner = players.find((p) => p.id === ownerId) ?? players[0];
  const ownerBetResult = allBetBalances[owner?.id] ?? 0;
  const ownerExpenseTotal = expenseTotal(expenses);
  const ownerNet = ownerBetResult - ownerExpenseTotal;
  const totalRabbitsWon = Object.values(rabbits.won).reduce((total, count) => total + count, 0);
  const totalSkinsWon = Object.values(skins.won).reduce((total, count) => total + count, 0);
  const pollaEnabled = bets.polla.first9.enabled || bets.polla.second9.enabled || bets.polla.total18.enabled;

  const categoryResults = useMemo(() => ({
    Conejos: rabbitBalances[ownerId] ?? 0,
    Skins: skinBalances[ownerId] ?? 0,
    Unidades: units.balances[ownerId] ?? 0,
    Foursome: foursomes.balances[ownerId] ?? 0,
    "Bola Amiga": ballFriend.balances[ownerId] ?? 0,
    Polla: polla.balances[ownerId] ?? 0,
    "Mini Polla": miniPolla.balances[ownerId] ?? 0,
    Personales: personals.balances[ownerId] ?? 0,
    Manuales: manual.balances[ownerId] ?? 0,
  }), [rabbitBalances, skinBalances, units.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, personals.balances, manual.balances, ownerId]);

  const playerName = (id?: string) => {
    const group = players.find((p) => p.id === id)?.name;
    if (group) return group;
    const external = personalBets.find((b) => personalRivalKey(b) === id);
    return external?.rivalName || "—";
  };

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
      polla: {
        first9: { ...b.polla.first9, participantIds: [...b.polla.first9.participantIds, id] },
        second9: { ...b.polla.second9, participantIds: [...b.polla.second9.participantIds, id] },
        total18: { ...b.polla.total18, participantIds: [...b.polla.total18.participantIds, id] },
      },
      miniPolla: { ...b.miniPolla, participantIds: [...b.miniPolla.participantIds, id] },
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

  function goToHoleIndex(index: number) {
    setCurrentIndex(Math.max(0, Math.min(order.length - 1, index)));
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function newManualBet() {
    setManualBets((bets) => [...bets, {
      id: makeId(),
      name: `Apuesta manual ${bets.length + 1}`,
      amounts: Object.fromEntries(players.map((p) => [p.id, 0])),
    }]);
  }

  function updateManualBet(id: string, patch: Partial<ManualBet>) {
    setManualBets((bets) => bets.map((b) => b.id === id ? { ...b, ...patch } : b));
  }

  function setManualAmount(betId: string, playerId: string, value: number) {
    setManualBets((bets) => bets.map((b) => b.id === betId ? { ...b, amounts: { ...b.amounts, [playerId]: value } } : b));
  }

  function manualBetTotal(bet: ManualBet) {
    return players.reduce((sum, p) => sum + Number(bet.amounts[p.id] ?? 0), 0);
  }

  function addUnit(playerId: string, amount: number, label = amount > 0 ? "Otra positiva" : "Copa") {
    setUnitEvents((e) => [...e, { id: makeId(), hole: holeNumber, playerId, amount, label }]);
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
    setPersonalBets((b) => [...b, {
      id: makeId(),
      rivalMode: rival ? "group" : "external",
      rivalPlayerId: rival?.id,
      externalRivalId: savedPersonalRivals[0]?.id,
      rivalName: rival?.name || savedPersonalRivals[0]?.name || "Rival",
      externalScores: {},
      baseValue: 100,
      advantageReceiver: "rival",
      advantageStrokes: 0,
      back9Multiplier: 1,
      components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
    }]);
  }

  function savePersonalRival(name: string) {
    const clean = name.trim();
    if (!clean) return undefined;
    const existing = savedPersonalRivals.find((r) => r.name.toLocaleLowerCase("es-MX") === clean.toLocaleLowerCase("es-MX"));
    if (existing) return existing;
    const rival = { id: makeId(), name: clean };
    setSavedPersonalRivals((rs) => [...rs, rival]);
    return rival;
  }

  function updatePersonalBet(id: string, patch: Partial<PersonalBet>) {
    setPersonalBets((bets) => bets.map((b) => b.id === id ? { ...b, ...patch } : b));
  }

  function setExternalPersonalScore(betId: string, hole: number, value: number | null) {
    setPersonalBets((bets) => bets.map((b) => b.id === betId ? {
      ...b,
      externalScores: { ...b.externalScores, [hole]: value },
    } : b));
  }

  function saveRound() {
    if (!owner) return;
    const snapshot: RoundSnapshot = {
      id: roundId, date: roundDate, courseName: course.name, teeName: course.teeName,
      ownerName: owner.name, roundHoles, startHole, betResult: ownerBetResult, expenses, expenseTotal: ownerExpenseTotal,
      netResult: ownerNet, categoryResults,
      personalResults: personals.results.map((r) => ({
        rivalKey: r.rivalId,
        rivalName: playerName(r.rivalId),
        totalMoney: r.totalMoney,
        componentMoney: r.componentMoney,
      })),
    };
    setHistory((h) => [snapshot, ...h.filter((x) => x.id !== roundId)]);
    setTab("history");
  }

  function resetRound() {
    const ids = players.map((p) => p.id);
    setScores({}); setUnitEvents([]); setBallFriendSetup({}); setPersonalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets(ids)); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setTab("setup");
  }

  function startNewCourse() {
    const fresh: Course = {
      id: makeId(), name: "Campo nuevo", teeName: "General",
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
    };
    setCourseDraft(fresh); setTab("courses");
  }

  function parse18Numbers(text: string) {
    return text.trim().split(/[\s,;|/]+/).map(Number).filter((n) => Number.isFinite(n));
  }

  function applyQuickCourseData() {
    const strokes = parse18Numbers(quickStroke);
    const pars = parse18Numbers(quickPars);
    if (strokes.length !== 18 || new Set(strokes).size !== 18 || !strokes.every((n) => n >= 1 && n <= 18)) {
      window.alert("Ventaja/SI debe contener los números 1 a 18, una sola vez cada uno.");
      return;
    }
    if (pars.length && (pars.length !== 18 || !pars.every((n) => n >= 3 && n <= 6))) {
      window.alert("Si pegas Par, deben ser 18 valores entre 3 y 6.");
      return;
    }
    setCourseDraft((d) => ({
      ...d,
      holes: d.holes.map((h, i) => ({
        ...h,
        strokeIndex: strokes[i],
        par: pars.length === 18 ? pars[i] : h.par,
      })),
    }));
  }

  function saveCourseDraft() {
    const name = courseDraft.name.trim();
    const teeName = courseDraft.teeName.trim() || "General";
    const strokes = courseDraft.holes.map((h) => h.strokeIndex);
    if (!name) {
      window.alert("Escribe el nombre del campo.");
      return;
    }
    if (courseDraft.holes.length !== 18 || !courseDraft.holes.every((h) => Number.isInteger(h.par) && h.par >= 3 && h.par <= 6)) {
      window.alert("Par debe tener 18 valores enteros entre 3 y 6.");
      return;
    }
    if (new Set(strokes).size !== 18 || !strokes.every((n) => Number.isInteger(n) && n >= 1 && n <= 18)) {
      window.alert("Ventaja/SI debe contener los números 1 a 18, una sola vez cada uno.");
      return;
    }
    const saved = { ...courseDraft, name, teeName, holes: courseDraft.holes.map((h) => ({ ...h })) };
    setCourses((cs) => [saved, ...cs.filter((c) => c.id !== saved.id)]);
    setCourse(saved); setTab("setup");
  }

  function cloneTeeDraft() {
    setCourseDraft((d) => ({
      ...d,
      id: makeId(),
      teeName: "Nuevo tee",
      rating: undefined,
      slope: undefined,
      holes: d.holes.map((h) => ({ ...h, yards: undefined })),
    }));
  }

  function renderManualBetsEditor(compact = false) {
    return <section className={`card ${compact ? "compact" : ""}`}>
      <div className="sectionTitle"><div><h2>Apuestas manuales</h2><p>Para cualquier apuesta no contemplada. Captura ganancia (+) o pérdida (−); debe cerrar en $0.</p></div><button className="textButton" onClick={newManualBet}>+ Apuesta</button></div>
      {!manualBets.length && <div className="empty">Sin apuestas manuales.</div>}
      {manualBets.map((bet) => {
        const total = manualBetTotal(bet);
        const valid = Math.abs(total) < 0.001;
        return <div className="manualBet" key={bet.id}>
          <div className="row between"><input className="manualName" value={bet.name} onChange={(e) => updateManualBet(bet.id, { name: e.target.value })} /><button className="remove" onClick={() => setManualBets((bs) => bs.filter((x) => x.id !== bet.id))}>×</button></div>
          <div className="manualGrid">{players.map((p) => <label key={p.id}><span>{p.name}</span><input type="number" inputMode="decimal" step="50" value={bet.amounts[p.id] ?? 0} onChange={(e) => setManualAmount(bet.id, p.id, Number(e.target.value) || 0)} /></label>)}</div>
          <div className={`manualBalance ${valid ? "good" : "bad"}`}>{valid ? "✓ Cierra en $0 y se suma al resultado" : `Falta cuadrar ${money(-total)}`}</div>
        </div>;
      })}
    </section>;
  }

  const currentRabbitEvents = rabbits.events.filter((e) => e.hole === holeNumber);
  const currentSkin = skins.events.find((e) => e.hole === holeNumber);
  const unitHoleManual = (id: string) => unitEvents.filter((e) => e.hole === holeNumber && e.playerId === id).reduce((a, e) => a + e.amount, 0);
  const unitHoleAuto = (id: string) => units.autoByHole[holeNumber]?.[id] ?? 0;
  const unitHoleNet = (id: string) => unitHoleManual(id) + unitHoleAuto(id);
  const bfParticipants = playersByIds(players, bets.ballFriend.participantIds);
  const bfSetup = ballFriendSetup[holeNumber] ?? { teamA: [] };
  const bfActiveIds = bets.ballFriend.participantIds.filter((id) => id !== bfSetup.restPlayerId);
  const bfTeamB = bfActiveIds.filter((id) => !bfSetup.teamA.includes(id));
  const bfDetail = ballFriend.details.find((d) => d.hole === holeNumber);

  const now = new Date();
  const todayMx = localDateMexico();
  const currentMonth = todayMx.slice(0, 7);
  const currentYear = todayMx.slice(0, 4);
  const monthRounds = history.filter((h) => h.date.startsWith(currentMonth));
  const yearRounds = history.filter((h) => h.date.startsWith(currentYear));
  const sum = (arr: RoundSnapshot[], key: "netResult" | "betResult" | "expenseTotal") => arr.reduce((a, r) => a + r[key], 0);
  const expenseByKey = (arr: RoundSnapshot[], key: keyof Expense) => arr.reduce((a, r) => a + (r.expenses[key] || 0), 0);

  const personalHistory = useMemo(() => {
    const byRival = new Map<string, { key: string; name: string; total: number; rounds: number; wins: number; losses: number; ties: number }>();
    for (const r of history) {
      for (const pr of r.personalResults || []) {
        const current = byRival.get(pr.rivalKey) || { key: pr.rivalKey, name: pr.rivalName, total: 0, rounds: 0, wins: 0, losses: 0, ties: 0 };
        current.total += pr.totalMoney;
        current.rounds += 1;
        if (pr.totalMoney > 0) current.wins += 1;
        else if (pr.totalMoney < 0) current.losses += 1;
        else current.ties += 1;
        byRival.set(pr.rivalKey, current);
      }
    }
    return Array.from(byRival.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [history]);

  return <main className="app">
    <header className="topbar">
      <div><div className="brand">Golf Bets</div><div className="subbrand">Apuestas · liquidación · histórico</div></div>
      <span className="version">V2.4</span>
    </header>

    {tab === "setup" && <>
      <section className="hero">
        <div><div className="eyebrow">NUEVA JUGADA</div><h1>Configura y juega.</h1><p>La app calcula lo automático; tú solo capturas score y eventos especiales.</p></div>
        <input className="dateInput" type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} />
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>1. Campo</h2><p>Elige el campo y después la salida/tee.</p></div><button className="textButton" onClick={startNewCourse}>+ Campo</button></div>
        <div className="grid3">
          <div><label>Campo</label><select value={course.name} onChange={(e) => {
            const next = courses.find((x) => x.name === e.target.value); if (next) setCourse(next);
          }}>{courseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
          <div><label>Tee / salida</label><select value={course.id} onChange={(e) => {
            const c = courses.find((x) => x.id === e.target.value); if (c) setCourse(c);
          }}>{teesForCourse.map((c) => <option key={c.id} value={c.id}>{c.teeName}</option>)}</select></div>
          <div><label>Inicio de ronda</label><select value={startHole} onChange={(e) => setStartHole(Number(e.target.value) as 1 | 10)}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></div>
          <div><label>Hoyos a jugar</label><select value={roundHoles} onChange={(e) => setRoundHoles(Number(e.target.value) as 9 | 18)}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></div>
        </div>
        <div className="courseMeta"><span>Par {course.holes.reduce((a, h) => a + h.par, 0)}</span><span>Rating {course.rating ?? "—"}</span><span>Slope {course.slope ?? "—"}</span>{totalYards > 0 && <span>{totalYards.toLocaleString("es-MX")} yd</span>}<button onClick={() => { setCourseDraft(course); setTab("courses"); }}>Editar tee</button></div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>2. Jugadores</h2><p>HCP de la ronda. La base se recalcula según cada apuesta.</p></div><button className="textButton" onClick={addPlayer}>+ Jugador</button></div>
        {players.map((p) => <div className="playerEdit" key={p.id}>
          <input value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} />
          <input className="hcpInput" type="number" inputMode="decimal" step="0.1" min={-15} max={54} value={p.handicap} onChange={(e) => updatePlayer(p.id, { handicap: e.target.value === "" ? 0 : Number(e.target.value) })} onBlur={(e) => updatePlayer(p.id, { handicap: Number(e.target.value) || 0 })} />
          <button className={`ownerDot ${ownerId === p.id ? "active" : ""}`} onClick={() => setOwnerId(p.id)} title="Jugador principal">★</button>
          <button className="remove" disabled={players.length <= 2} onClick={() => setPlayers((ps) => ps.filter((x) => x.id !== p.id))}>×</button>
        </div>)}
        <div className="hint">★ marca al jugador principal para estadísticas y gastos.</div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>3. Apuestas generales</h2><p>Cada apuesta tiene su propio porcentaje y participantes.</p></div></div>

        <div className="betCard">
          <div className="betHead"><div><b>🐇 Conejos</b><span>Agarra · mantiene · gana · acumula</span></div><Toggle on={bets.rabbits.enabled} onClick={() => setBets({ ...bets, rabbits: { ...bets.rabbits, enabled: !bets.rabbits.enabled } })} /></div>
          {bets.rabbits.enabled && <><div className="grid3"><NumberField label="Valor" value={bets.rabbits.value} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, value: v } })} /><HcpPercentInput value={bets.rabbits.hcpPct} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.rabbits.decimals} onChange={(e) => setBets({ ...bets, rabbits: { ...bets.rabbits, decimals: e.target.value as "partial" | "round" } })}><option value="partial">Cuentan</option><option value="round">Redondear</option></select></div></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.rabbits.participantIds} onChange={(ids) => setBets({ ...bets, rabbits: { ...bets.rabbits, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>⛳ Skins</b><span>Empates acumulan</span></div><Toggle on={bets.skins.enabled} onClick={() => setBets({ ...bets, skins: { ...bets.skins, enabled: !bets.skins.enabled } })} /></div>
          {bets.skins.enabled && <><div className="grid3"><NumberField label="Valor" value={bets.skins.value} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, value: v } })} /><HcpPercentInput value={bets.skins.hcpPct} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.skins.decimals} onChange={(e) => setBets({ ...bets, skins: { ...bets.skins, decimals: e.target.value as "partial" | "round" } })}><option value="partial">Cuentan</option><option value="round">Redondear</option></select></div></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.skins.participantIds} onChange={(ids) => setBets({ ...bets, skins: { ...bets.skins, participantIds: ids } })} /></>}
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
              <HcpPercentInput value={bets.foursome.hcpPct} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, hcpPct: v } })} />
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
          {bets.ballFriend.enabled && <><div className="grid3"><NumberField label="Valor punto" value={bets.ballFriend.value} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, value: v } })} /><HcpPercentInput value={bets.ballFriend.hcpPct} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, hcpPct: v } })} /><NumberField label="Score máximo" value={bets.ballFriend.maxScore} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, maxScore: v } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.ballFriend.participantIds} onChange={(ids) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, participantIds: ids } })} /></>}
        </div>

        <PollaBetEditor
          title="Polla 1ª vuelta"
          description="Mejor medal neto de los primeros 9 hoyos jugados"
          config={bets.polla.first9}
          players={players}
          onChange={(first9) => setBets({ ...bets, polla: { ...bets.polla, first9 } })}
        />

        <PollaBetEditor
          title="Polla 2ª vuelta"
          description="Mejor medal neto de los segundos 9 hoyos jugados"
          config={bets.polla.second9}
          players={players}
          unavailable={roundHoles === 9}
          onChange={(second9) => setBets({ ...bets, polla: { ...bets.polla, second9 } })}
        />

        <PollaBetEditor
          title="Polla 18 hoyos"
          description="Mejor medal neto de la ronda completa"
          config={bets.polla.total18}
          players={players}
          unavailable={roundHoles === 9}
          onChange={(total18) => setBets({ ...bets, polla: { ...bets.polla, total18 } })}
        />

        <div className="betCard">
          <div className="betHead"><div><b>⚡ Mini Polla</b><span>Medal neto de los últimos 3 hoyos realmente jugados</span></div><Toggle on={bets.miniPolla.enabled} onClick={() => setBets({ ...bets, miniPolla: { ...bets.miniPolla, enabled: !bets.miniPolla.enabled } })} /></div>
          {bets.miniPolla.enabled && <>
            <div className="grid3"><NumberField label="Valor" value={bets.miniPolla.value} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, value: v } })} /><HcpPercentInput value={bets.miniPolla.hcpPct} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.miniPolla.decimals} onChange={(e) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, decimals: e.target.value as "partial" | "round" } })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div></div>
            <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.miniPolla.participantIds} onChange={(ids) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, participantIds: ids } })} />
            <div className="hint">Siempre toma los últimos 3 hoyos realmente jugados: {order.slice(-3).join(", ")}.</div>
          </>}
        </div>
      </section>

      {renderManualBetsEditor(true)}

      <section className="card compact personalShortcut">
        <div><b>Apuestas personales</b><p className="muted">Van separadas porque el rival puede estar en otro foursome.</p></div>
        <button className="secondary" onClick={() => setTab("personals")}>Configurar Personales →</button>
      </section>

      <button className="primary big" onClick={() => { setCurrentIndex(0); setTab("round"); }}>Iniciar ronda →</button>
    </>}

    {tab === "personals" && <>
      <section className="hero">
        <div><div className="eyebrow">APUESTAS PERSONALES</div><h1>{owner?.name ?? "Jugador principal"}</h1><p>Separadas del foursome. El rival puede jugar contigo o en otro grupo.</p></div>
        <button className="secondary" onClick={newPersonalBet}>+ Personal</button>
      </section>

      {!personalBets.length && <section className="card"><div className="empty">Todavía no hay apuestas personales. Toca “+ Personal”.</div></section>}

      {personalBets.map((bet) => {
        const groupRival = bet.rivalPlayerId ? players.find((p) => p.id === bet.rivalPlayerId) : undefined;
        const displayRival = bet.rivalMode === "group" ? (groupRival?.name || "Rival") : (bet.rivalName || "Rival");
        return <section className="card" key={bet.id}>
          <div className="sectionTitle"><div><h2>{owner?.name ?? "Base"} vs {displayRival}</h2><p>Ventaja y presión aplican solo a esta apuesta.</p></div><button className="remove" onClick={() => setPersonalBets((bs) => bs.filter((x) => x.id !== bet.id))}>×</button></div>
          <div className="grid3">
            <div><label>¿Dónde juega el rival?</label><select value={bet.rivalMode} onChange={(e) => {
              const mode = e.target.value as "group" | "external";
              const first = players.find((p) => p.id !== ownerId);
              const saved = savedPersonalRivals[0];
              updatePersonalBet(bet.id, {
                rivalMode: mode,
                rivalPlayerId: mode === "group" ? (bet.rivalPlayerId || first?.id) : undefined,
                externalRivalId: mode === "external" ? (bet.externalRivalId || saved?.id) : undefined,
                rivalName: mode === "group" ? (first?.name || bet.rivalName) : (saved?.name || bet.rivalName || "Rival"),
              });
            }}><option value="group">Mi foursome</option><option value="external">Otro foursome</option></select></div>
            {bet.rivalMode === "group" ? <div><label>Rival</label><select value={bet.rivalPlayerId || ""} onChange={(e) => {
              const rp = players.find((p) => p.id === e.target.value);
              updatePersonalBet(bet.id, { rivalPlayerId: e.target.value, rivalName: rp?.name || "Rival" });
            }}>{players.filter((p) => p.id !== ownerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div> : <>
              <div><label>Rival guardado</label><select value={bet.externalRivalId || ""} onChange={(e) => {
                const saved = savedPersonalRivals.find((r) => r.id === e.target.value);
                updatePersonalBet(bet.id, { externalRivalId: saved?.id, rivalName: saved?.name || bet.rivalName });
              }}><option value="">+ Nuevo rival</option>{savedPersonalRivals.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div><label>Nombre del rival</label><input value={bet.rivalName} placeholder="Ej. Daniel" onChange={(e) => updatePersonalBet(bet.id, { rivalName: e.target.value, externalRivalId: undefined })} onBlur={() => {
                if (bet.externalRivalId || !bet.rivalName.trim()) return;
                const saved = savePersonalRival(bet.rivalName);
                if (saved) updatePersonalBet(bet.id, { externalRivalId: saved.id, rivalName: saved.name });
              }} /></div>
            </>}
            <NumberField label="Valor base" value={bet.baseValue} onChange={(v) => updatePersonalBet(bet.id, { baseValue: v })} />
            {roundHoles === 18 && <NumberField label="Presión 2ª vuelta ×" value={bet.back9Multiplier} onChange={(v) => updatePersonalBet(bet.id, { back9Multiplier: Math.max(1, v) })} />}
            <div><label>Quién recibe ventaja</label><select value={bet.advantageReceiver === "owner" ? "owner" : "rival"} onChange={(e) => updatePersonalBet(bet.id, { advantageReceiver: e.target.value as "owner" | "rival" })}><option value="owner">{owner?.name} recibe</option><option value="rival">{displayRival} recibe</option></select></div>
            <NumberField label="Golpes que recibe" value={bet.advantageStrokes} onChange={(v) => updatePersonalBet(bet.id, { advantageStrokes: Math.max(0, v) })} />
          </div>
          {bet.advantageStrokes === 0 && <div className="hint">0 golpes = sin ventaja.</div>}
          <div className="componentGrid">{(roundHoles === 9
            ? ([["match1","Match 9"],["medal1","Medal 9"]] as [keyof PersonalBet["components"], string][])
            : ([["match1","Match 1"],["medal1","Medal 1"],["match2","Match 2"],["medal2","Medal 2"],["match18","Match N"],["medal18","Medal N"]] as [keyof PersonalBet["components"], string][])
          ).map(([key, label]) => <button key={key} className={`component ${bet.components[key] ? "selected" : ""}`} onClick={() => updatePersonalBet(bet.id, { components: { ...bet.components, [key]: !bet.components[key] } })}>{bet.components[key] ? "✓ " : ""}{label}</button>)}</div>

          {bet.rivalMode === "external" && <div className="externalCard">
            <div className="row between"><div><b>Tarjeta de {displayRival}</b><div className="muted">Captúrala aparte; no entra a Conejos, Skins, Foursome, Bola Amiga ni Unidades.</div></div><span className="pillSmall">Otro grupo</span></div>
            <div className="externalScoreGrid">{order.map((h) => {
              const hd = course.holes.find((x) => x.number === h)!;
              return <label className="externalHole" key={h}><span>H{h}<small> P{hd.par}</small></span><input type="number" min={1} inputMode="numeric" value={bet.externalScores?.[h] ?? ""} placeholder="–" onChange={(e) => setExternalPersonalScore(bet.id, h, e.target.value === "" ? null : Number(e.target.value))} /></label>;
            })}</div>
          </div>}
        </section>;
      })}

      <button className="primary big" style={{width:"100%"}} onClick={() => setTab("round")}>Ir a Tarjeta →</button>
    </>}

    {tab === "round" && <>
      <div className="holeNav">{order.map((h, i) => <button key={h} className={i === currentIndex ? "active" : scores[h] ? "done" : ""} onClick={() => goToHoleIndex(i)}>{h}</button>)}</div>
      <section className="holeHero">
        <div><div className="eyebrow">{course.name} · {course.teeName}</div><h1>Hoyo {holeNumber}</h1><p>Par {hole.par} · Ventaja {hole.strokeIndex}</p></div>
        <div className="progress">{currentIndex + 1}<span>/{order.length}</span></div>
      </section>

      <div className="scorecardToggle row"><button className="secondary" onClick={() => setShowFullScorecard((v) => !v)}>{showFullScorecard ? "Ocultar tarjeta completa" : "Ver tarjeta completa"}</button><button className="secondary" onClick={() => { setTab("results"); window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 0); }}>Gastos</button></div>

      {showFullScorecard && <section className="card fullScorecard">
        <div className="sectionTitle"><div><h2>Tarjeta completa</h2><p>Scores de todos los jugadores en el orden real de juego. Desliza horizontalmente.</p></div></div>
        <div className="tableWrap scorecardTable"><table><thead><tr><th>Jugador</th>{order.map((h) => <th key={h}>{h}</th>)}{roundHoles === 18 && <><th>V1</th><th>V2</th></>}<th>TOT</th><th>+/−</th></tr></thead><tbody>{players.map((p) => {
          const scoreAt = (h: number) => scores[h]?.[p.id];
          const first9 = order.slice(0, 9).filter((h) => typeof scoreAt(h) === "number").reduce((a, h) => a + Number(scoreAt(h)), 0);
          const second9 = order.slice(9, 18).filter((h) => typeof scoreAt(h) === "number").reduce((a, h) => a + Number(scoreAt(h)), 0);
          const entered = order.filter((h) => typeof scoreAt(h) === "number");
          const total = entered.reduce((a, h) => a + Number(scoreAt(h)), 0);
          const parEntered = entered.reduce((a, h) => a + (course.holes.find((x) => x.number === h)?.par || 0), 0);
          const rel = total - parEntered;
          return <tr key={p.id}><td><b>{p.name}</b></td>{order.map((h) => <td key={h}>{typeof scoreAt(h) === "number" ? scoreAt(h) : "—"}</td>)}{roundHoles === 18 && <><td><b>{first9 || "—"}</b></td><td><b>{second9 || "—"}</b></td></>}<td><b>{total || "—"}</b></td><td className={rel <= 0 ? "good" : "bad"}>{entered.length ? `${rel > 0 ? "+" : ""}${rel}` : "—"}</td></tr>;
        })}</tbody></table></div>
      </section>}

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
        <div className="sectionTitle"><div><h2>Unidades / Copas</h2><p>Birdie/Águila/Albatros/HIO se detectan solos. Marca aquí solo las especiales.</p></div></div>
        {playersByIds(players, bets.units.participantIds).map((p) => <div className="eventRow unitEventRow" key={p.id}>
          <div><b>{p.name}</b><span className="muted">Auto {unitHoleAuto(p.id) >= 0 ? "+" : ""}{unitHoleAuto(p.id)} · Manual {unitHoleManual(p.id) >= 0 ? "+" : ""}{unitHoleManual(p.id)} · Neto <b>{unitHoleNet(p.id) >= 0 ? "+" : ""}{unitHoleNet(p.id)}</b></span></div>
          <div className="unitButtons">
            <button onClick={() => addUnit(p.id, 1, "Sandy Par")}>+ Sandy</button>
            <button onClick={() => addUnit(p.id, 1, "Oyes")}>+ Oyes</button>
            <button onClick={() => addUnit(p.id, 1, "Hole Out")}>+ Hole Out</button>
            <button onClick={() => addUnit(p.id, 1, "Otra positiva")}>+ Otra</button>
            <button onClick={() => addUnit(p.id, -1, "Copa")}>− Copa</button>
            <button onClick={() => addUnit(p.id, -1, "Otra negativa")}>− Otra</button>
            <button className="undo" onClick={() => undoLastUnit(p.id)}>↶</button>
          </div>
        </div>)}
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
          const liveMatches = foursomes.matches.filter((m) => m.segmentId === seg.id);
          if (!liveMatches.length) return <div className="empty">Configura las parejas de este tramo.</div>;
          return <div className="foursomeLive">{liveMatches.map((m, i) => {
            const current = m.holePoints.find((hp) => hp.hole === holeNumber)?.points;
            return <div className="foursomeLiveRow" key={i}>
              <div><b>{playerName(m.basePair[0])} + {playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])} + {playerName(m.opponentPair[1])}</span></div>
              <div className="matchNums"><small>Hoyo {current === undefined ? "—" : `${current > 0 ? "+" : ""}${current}`}</small><b className={m.pointDiff > 0 ? "good" : m.pointDiff < 0 ? "bad" : ""}>{m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts</b></div>
            </div>;
          })}</div>;
        })()}
      </section>}

      <div className="roundActions"><button className="secondary big" disabled={currentIndex === 0} onClick={() => goToHoleIndex(currentIndex - 1)}>← Anterior</button><button className="primary big" onClick={() => currentIndex < order.length - 1 ? goToHoleIndex(currentIndex + 1) : (setTab("results"), window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0))}>{currentIndex < order.length - 1 ? "Guardar y siguiente →" : "Ver resultados →"}</button></div>
    </>}

    {tab === "results" && <>
      <section className="hero resultHero"><div><div className="eyebrow">RESULTADO DEL DÍA</div><h1 className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</h1><p>{owner?.name}: apuestas {money(ownerBetResult)} · gastos {money(-ownerExpenseTotal)}</p></div><button className="secondary" onClick={() => setTab("round")}>Editar tarjeta</button></section>

      <section className="roundStats" aria-label="Conteos globales de la ronda">
        <div className="stat"><span>Conejos ganados</span><b>{totalRabbitsWon}</b><small>realmente cobrados</small></div>
        <div className="stat"><span>Skins ganados</span><b>{totalSkinsWon}</b><small>sin carry final</small></div>
        <div className="stat"><span>Unidades registradas</span><b>{units.registeredTotal}</b><small>positivas y copas</small></div>
      </section>

      <section className="card">
        <h2>Resumen por jugador</h2>
        <div className="tableWrap"><table><thead><tr><th>Jugador</th><th>Conejos</th><th>Skins</th><th>Unidades</th><th>Foursome</th><th>B. Amiga</th><th>Polla</th><th>Mini</th><th>Personales</th><th>Manuales</th><th>Total</th></tr></thead><tbody>{players.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{quantityAndMoney(rabbits.won[p.id] ?? 0, rabbitBalances[p.id] ?? 0)}</td><td>{quantityAndMoney(skins.won[p.id] ?? 0, skinBalances[p.id] ?? 0)}</td><td>{quantityAndMoney(units.net[p.id] ?? 0, units.balances[p.id] ?? 0, true)}</td><td>{money(foursomes.balances[p.id] ?? 0)}</td><td>{money(ballFriend.balances[p.id] ?? 0)}</td><td>{money(polla.balances[p.id] ?? 0)}</td><td>{money(miniPolla.balances[p.id] ?? 0)}</td><td>{money(personals.balances[p.id] ?? 0)}</td><td>{money(manual.balances[p.id] ?? 0)}</td><td className={(allBetBalances[p.id] ?? 0) >= 0 ? "good" : "bad"}><b>{money(allBetBalances[p.id] ?? 0)}</b></td></tr>)}</tbody></table></div>
      </section>

      <section className="card">
        <h2>Resultado final por jugador</h2><p className="muted">Cuánto gana o pierde exactamente cada persona en todas las apuestas.</p>
        {settlementIds.map((id) => {
          const total = allBetBalances[id] ?? 0;
          return <div className="transfer" key={id}><span><b>{playerName(id)}</b></span><strong className={total > 0 ? "good" : total < 0 ? "bad" : ""}>{total > 0 ? "+" : ""}{money(total)}</strong></div>;
        })}
      </section>

      {bets.foursome.enabled && <section className="card">
        <h2>Detalle Foursome</h2>
        {foursomes.matches.map((m, i) => <div className="matchLine" key={i}><div><b>H{m.startHole}–{m.endHole}: {playerName(m.basePair[0])}/{playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])}/{playerName(m.opponentPair[1])}</span></div><div className="matchNums"><span>{m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts</span><b className={m.totalMoney >= 0 ? "good" : "bad"}>{m.complete ? money(m.totalMoney) : "Pendiente"}</b></div></div>)}
      </section>}

      {(pollaEnabled || bets.miniPolla.enabled) && <section className="card"><h2>Polla / Mini Polla</h2>
        {[...polla.details, ...miniPolla.details].map((d) => <div className="pollaResult" key={d.key}><div className="row between"><div><b>{d.label}</b><div className="muted">Hoyos {d.holes.join(", ")} · valor {money(d.value)} por jugador</div></div><strong>{d.complete ? (d.winnerIds.length ? d.winnerIds.map(playerName).join(" / ") : "—") : "Pendiente"}</strong></div>{d.complete && <div className="componentResults"><span>Ganador{d.winnerIds.length !== 1 ? "es" : ""}: <b>{d.winnerIds.map(playerName).join(" / ")}</b></span><span>Premio bruto c/u: <b>{money(d.grossPrizePerWinner)}</b></span>{d.winnerIds.length > 1 && <span>Empate: <b>premio dividido</b></span>}</div>}</div>)}
      </section>}

      {personalBets.length > 0 && <section className="card"><h2>Personales</h2>{personals.results.map((r) => <div className="personalResult" key={r.betId}><div className="row between"><b>{owner?.name} vs {playerName(r.rivalId)}</b><strong className={r.totalMoney >= 0 ? "good" : "bad"}>{money(r.totalMoney)}</strong></div><div className="componentResults">{(roundHoles === 9
        ? ([['match1', 'Match 9'], ['medal1', 'Medal 9']] as const)
        : ([['match1', 'Match 1'], ['medal1', 'Medal 1'], ['match2', 'Match 2'], ['medal2', 'Medal 2'], ['match18', 'Match N'], ['medal18', 'Medal N']] as const)
      ).map(([key, label]) => <span key={key}>{label}: <b>{money(r.componentMoney[key])}</b></span>)}</div></div>)}</section>}

      {renderManualBetsEditor()}

      <section className="card">
        <h2>Gastos de {owner?.name}</h2>
        <div className="grid2">
          <MoneyInput label="Caddie" value={expenses.caddie} onChange={(v) => setExpenses({ ...expenses, caddie: v })} />
          <MoneyInput label="Alimentos" value={expenses.food} onChange={(v) => setExpenses({ ...expenses, food: v })} />
          <MoneyInput label="Bebidas" value={expenses.drinks} onChange={(v) => setExpenses({ ...expenses, drinks: v })} />
          <MoneyInput label="Greenfee" value={expenses.greenFee} onChange={(v) => setExpenses({ ...expenses, greenFee: v })} />
          <MoneyInput label="Renta carrito" value={expenses.cartRental} onChange={(v) => setExpenses({ ...expenses, cartRental: v })} />
          <MoneyInput label="Otros" value={expenses.other} onChange={(v) => setExpenses({ ...expenses, other: v })} />
        </div>
        <div className="totalStrip"><span>Total gastos</span><b>{money(ownerExpenseTotal)}</b></div>
      </section>

      <section className="card summaryCard"><div><span>Apuestas</span><b className={ownerBetResult >= 0 ? "good" : "bad"}>{money(ownerBetResult)}</b></div><div><span>Gastos</span><b className="bad">{money(-ownerExpenseTotal)}</b></div><div className="grand"><span>NETO DEL DÍA</span><b className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</b></div></section>
      <div className="roundActions"><button className="secondary big" onClick={resetRound}>Nueva ronda</button><button className="primary big" onClick={saveRound}>Guardar en histórico</button></div>
    </>}

    {tab === "history" && <>
      <section className="hero"><div><div className="eyebrow">HISTÓRICO</div><h1>Lo que realmente cuesta jugar.</h1><p>Apuestas separadas de caddie, alimentos, bebidas y demás gastos.</p></div></section>
      <div className="statsGrid"><div className="stat"><span>Neto este mes</span><b className={sum(monthRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(monthRounds, "netResult"))}</b><small>{monthRounds.length} rondas</small></div><div className="stat"><span>Neto este año</span><b className={sum(yearRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(yearRounds, "netResult"))}</b><small>{yearRounds.length} rondas</small></div><div className="stat"><span>Apuestas año</span><b>{money(sum(yearRounds, "betResult"))}</b><small>sin gastos</small></div><div className="stat"><span>Gasto año</span><b className="bad">{money(-sum(yearRounds, "expenseTotal"))}</b><small>costo real</small></div></div>
      <section className="card"><h2>Gastos del año</h2><div className="expenseBars">{([['caddie','Caddie'],['food','Alimentos'],['drinks','Bebidas'],['greenFee','Greenfee'],['cartRental','Renta carrito'],['other','Otros']] as [keyof Expense,string][]).map(([k, label]) => <div key={k}><span>{label}</span><b>{money(expenseByKey(yearRounds, k))}</b></div>)}</div></section>
      <section className="card">
        <h2>Apuestas personales · histórico</h2>
        <p className="muted">Balance acumulado contra cada rival.</p>
        {!personalHistory.length ? <div className="empty">Todavía no hay personales guardadas.</div> : personalHistory.map((r) => <div className="historyRow" key={r.key}><div><b>{r.name}</b><span>{r.rounds} rondas · {r.wins} ganadas · {r.losses} perdidas{r.ties ? ` · ${r.ties} tablas` : ""}</span></div><strong className={r.total > 0 ? "good" : r.total < 0 ? "bad" : ""}>{r.total > 0 ? "+" : ""}{money(r.total)}</strong></div>)}
      </section>
      <section className="card"><div className="sectionTitle"><div><h2>Rondas</h2><p>Más recientes primero.</p></div><button className="textButton" onClick={resetRound}>+ Nueva</button></div>{!history.length ? <div className="empty">Todavía no has guardado rondas.</div> : history.map((r) => <div className="historyRow" key={r.id}><div><b>{r.courseName} · {r.teeName}</b><span>{r.date} · {r.roundHoles || 18} hoyos · apuestas {money(r.betResult)} · gastos {money(r.expenseTotal)}</span></div><strong className={r.netResult >= 0 ? "good" : "bad"}>{money(r.netResult)}</strong></div>)}</section>
    </>}

    {tab === "courses" && <>
      <section className="hero"><div><div className="eyebrow">CAMPO / TEE</div><h1>{courseDraft.name}</h1><p>Para jugar solo necesitas Par y Ventaja/SI. El campo queda guardado en este dispositivo.</p></div><button className="secondary" onClick={cloneTeeDraft}>+ Tee</button></section>
      <section className="card"><div className="grid2"><div><label>Nombre del campo</label><input value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} /></div><div><label>Nombre del tee</label><input value={courseDraft.teeName} onChange={(e) => setCourseDraft({ ...courseDraft, teeName: e.target.value })} /></div><OptionalNumberField label="Rating (opcional)" step={0.1} value={courseDraft.rating} onChange={(v) => setCourseDraft({ ...courseDraft, rating: v })} /><OptionalNumberField label="Slope (opcional)" value={courseDraft.slope} onChange={(v) => setCourseDraft({ ...courseDraft, slope: v })} /></div></section>
      <section className="card"><div className="sectionTitle"><div><h2>Carga rápida</h2><p>Pega 18 ventajas/SI. Par es opcional si ya está correcto en la tabla.</p></div><button className="textButton" onClick={applyQuickCourseData}>Aplicar</button></div><div className="grid2"><div><label>Ventaja / SI (18 números)</label><textarea rows={3} placeholder="5, 17, 7, 1..." value={quickStroke} onChange={(e) => setQuickStroke(e.target.value)} /></div><div><label>Par (opcional, 18 números)</label><textarea rows={3} placeholder="4, 3, 4, 5..." value={quickPars} onChange={(e) => setQuickPars(e.target.value)} /></div></div></section>
      <section className="card"><div className="courseGrid simpleCourseGrid"><div className="courseGridHead">Hoyo</div><div className="courseGridHead">Par</div><div className="courseGridHead">Ventaja</div>{courseDraft.holes.map((h) => <div className="courseGridRow" key={h.number}><b>{h.number}</b><input type="number" min={3} max={6} value={h.par} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, par: Number(e.target.value) } : x) })} /><input type="number" min={1} max={18} value={h.strokeIndex} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, strokeIndex: Number(e.target.value) } : x) })} /></div>)}</div></section>
      <div className="roundActions"><button className="secondary big" onClick={() => setTab("setup")}>Cancelar</button><button className="primary big" onClick={saveCourseDraft}>Guardar tee</button></div>
    </>}

    <nav className="bottomNav"><button className={tab === "setup" ? "active" : ""} onClick={() => setTab("setup")}><span>⌂</span>Inicio</button><button className={tab === "round" ? "active" : ""} onClick={() => setTab("round")}><span>{roundHoles}</span>Tarjeta</button><button className={tab === "personals" ? "active" : ""} onClick={() => setTab("personals")}><span>↔</span>Personales</button><button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><span>$</span>Resultados</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><span>↗</span>Histórico</button></nav>
  </main>;
}
