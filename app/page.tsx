"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BallFriendHole,
  BetConfig,
  Course,
  Expense,
  FrequentGroup,
  FrequentPlayer,
  FoursomeSegment,
  HandicapMode,
  HoleScore,
  ManualBet,
  MedalPollaConfig,
  PersonalBet,
  Player,
  RoundSnapshot,
  SavedPersonalRival,
  UnitEvent,
} from "../lib/types";
import { BOTTOM_NAV_TARGETS, contrastToggleLabel, type AppTab } from "../lib/app-navigation";
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
  FOURSOME_GHOST_ID,
  mergeBalances,
  normalizeHandicapMode,
  opponentPairs,
  payoutWinnerTakesFromAll,
  playOrder,
  playersByIds,
  personalRivalKey,
  segmentDefinitions,
} from "../lib/engine";
import { PollaLivePanel } from "./components/polla-live-panel";
import { RulesPanel } from "./components/rules-panel";
import { buildHoleSummary, clearActiveRoundStorage, hasRoundProgress, historicalGolfStats, mergeCoursesPreservingEdits, migrateDraftPressures, privateLeaderboard, pushUndoState, STORAGE_KEYS, upsertFrequentPlayers } from "../lib/round-utils";
import { downloadRoundCsv, downloadRoundImage, downloadRoundPdf, shareRound } from "../lib/round-export";
import { readScorecardPhoto, saveScorecardPhoto } from "../lib/scorecard-photo";
import { cloneLaVistaLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES_UPDATED_AT, withDefaultLaVistaRules } from "../lib/local-rules";
import {
  addFrequentGroupMember,
  addFrequentPlayerTemplate,
  applySavedPersonalRivalTemplate,
  moveFrequentGroupMember,
  parseFrequentGroups,
  personalRivalTemplateFromBet,
  playersFromFrequentGroup,
  removeFrequentGroupMember,
  removeFrequentPlayerTemplate,
  removeSavedPersonalRivalTemplate,
  resolveFrequentGroupDeletion,
  serializeFrequentGroups,
  updateFrequentGroupMember,
  updateFrequentGroupTemplate,
  updateFrequentPlayerTemplate,
  updateSavedPersonalRivalTemplate,
} from "../lib/frequent-templates";

const makeId = () => Math.random().toString(36).slice(2, 10);
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-MX")}`;
const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const quantityAndMoney = (quantity: number, amount: number, signedQuantity = false) =>
  `${signedQuantity && quantity > 0 ? "+" : ""}${quantity.toLocaleString("es-MX")} · ${signedMoney(amount)}`;

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
  localRules: cloneLaVistaLocalRules(),
  localRulesUpdatedAt: LA_VISTA_LOCAL_RULES_UPDATED_AT,
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
  localRules: cloneLaVistaLocalRules(),
  localRulesUpdatedAt: LA_VISTA_LOCAL_RULES_UPDATED_AT,
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

const laVista = laVistaCourses.find((course) => course.teeName === "Blancas")!;
const laVistaTemporal = laVistaTemporalCourses.find((course) => course.teeName === "White")!;

const defaultCourses: Course[] = [
  laVista,
  laVistaTemporal,
  campestrePuebla,
  elCristo,
  colaDeLagarto,
].map((course) => ({ ...course, builtIn: true, updatedAt: course.name === "La Vista Temporal" ? "2026-09-01" : course.updatedAt }));

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

function mexicoDateLabel(date: string) {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${months[month - 1]} de ${year}`;
}

function mergeDefaultCourses(saved: Course[] | null | undefined) {
  return mergeCoursesPreservingEdits(defaultCourses, saved).map(withDefaultLaVistaRules);
}

function initialBets(ids: string[]): BetConfig {
  return {
    rabbits: { enabled: true, value: 100, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: ids },
    skins: { enabled: true, value: 50, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: ids },
    units: { enabled: true, value: 100, participantIds: ids },
    foursome: {
      enabled: true, hcpPct: 100, decimals: "round", segmentSize: 6,
      mode: "fixed", fixedValue: 200, pointValue: 100, pressSecond9: false,
      pressureMultiplier: 1, pressureNine: "holes_10_18", participantIds: ids,
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

function Toggle({ on, onClick, label = "activar" }: { on: boolean; onClick: () => void; label?: string }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={onClick} aria-label={label}><span /></button>;
}

function ParticipantChips({
  players, selected, onChange,
}: { players: Player[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="chips">{players.map((p) => {
    const on = selected.includes(p.id);
    return <button key={p.id} className={`chipButton ${on ? "selected" : ""}`} onClick={() => {
      onChange(on ? selected.filter((id) => id !== p.id) : [...selected, p.id]);
    }}>{on ? `✓ ${p.name.trim() || "Sin nombre"}` : p.name.trim() || "Sin nombre"}</button>;
  })}</div>;
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <div><label>{label}</label><input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /></div>;
}

function HcpPercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div><label>% HCP</label><input type="number" inputMode="numeric" min={0} max={100} step={5} placeholder="0" value={value === 0 ? "" : value} onChange={(e) => onChange(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>;
}

function HandicapModeSelect({ value, onChange }: { value: HandicapMode; onChange: (mode: HandicapMode) => void }) {
  return <div><label>Modo HCP</label><select value={normalizeHandicapMode(value)} onChange={(e) => onChange(e.target.value as HandicapMode)}>
    <option value="decimal">Décimas / sin redondear</option>
    <option value="half_up">.5 sube</option>
    <option value="half_down">.5 baja</option>
    <option value="six_up">.6 sube</option>
    <option value="four_down">.4 baja</option>
  </select></div>;
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
        <MoneyInput label="Valor" value={config.value} onChange={(value) => onChange({ ...config, value })} />
        <HcpPercentInput value={config.hcpPct} onChange={(hcpPct) => onChange({ ...config, hcpPct })} />
        <div><label>Decimales</label><select value={config.decimals} onChange={(e) => onChange({ ...config, decimals: e.target.value as "partial" | "round" })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div>
      </div>
      <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={config.participantIds} onChange={(participantIds) => onChange({ ...config, participantIds })} />
      <div className="hint">Cada valor es por jugador. El pozo se reparte entre los ganadores si empatan.{unavailable ? " Esta apuesta requiere una ronda de 18 hoyos." : ""}</div>
    </>}
  </div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div><label>{label}</label><div className="moneyField"><span>$</span><input type="number" inputMode="decimal" placeholder="0" value={value === 0 ? "" : value} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value) || 0)} /></div></div>;
}

export default function Page() {
  const [tab, setTab] = useState<AppTab>("welcome");
  const [courses, setCourses] = useState<Course[]>(defaultCourses);
  const [course, setCourse] = useState<Course>(laVista);
  const [courseDraft, setCourseDraft] = useState<Course>(laVista);
  const [startHole, setStartHole] = useState<1 | 10>(1);
  const [roundHoles, setRoundHoles] = useState<9 | 18>(18);
  const [players, setPlayers] = useState<Player[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [bets, setBets] = useState<BetConfig>(() => initialBets([]));
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
  const [todayMexico] = useState(localDateMexico);
  const [quickPars, setQuickPars] = useState("");
  const [quickStroke, setQuickStroke] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saved");
  const [holeSummary, setHoleSummary] = useState<string[]>([]);
  const [highContrast, setHighContrast] = useState(false);
  const [frequentPlayers, setFrequentPlayers] = useState<FrequentPlayer[]>([]);
  const [frequentGroups, setFrequentGroups] = useState<FrequentGroup[]>([]);
  const [groupName, setGroupName] = useState("");
  const [frequentGroupDraft, setFrequentGroupDraft] = useState<FrequentGroup | null>(null);
  const [frequentGroupToDelete, setFrequentGroupToDelete] = useState<FrequentGroup | null>(null);
  const [groupMemberSource, setGroupMemberSource] = useState<"frequent" | "new">("frequent");
  const [selectedGroupFrequentPlayerId, setSelectedGroupFrequentPlayerId] = useState("");
  const [newGroupMember, setNewGroupMember] = useState<{ name: string; handicap: number | null }>({ name: "", handicap: null });
  const [saveNewGroupMemberAsFrequent, setSaveNewGroupMemberAsFrequent] = useState(false);
  const [pendingGroupFrequentPlayers, setPendingGroupFrequentPlayers] = useState<Array<Pick<Player, "name" | "handicap">>>([]);
  const [privateBoardMode, setPrivateBoardMode] = useState<"gross" | "net">("net");
  const [undoCount, setUndoCount] = useState(0);
  const [showDeleteRoundConfirm, setShowDeleteRoundConfirm] = useState(false);
  const [showLocalRulesEditor, setShowLocalRulesEditor] = useState(false);
  const [editingFrequentPlayerId, setEditingFrequentPlayerId] = useState<string | null>(null);
  const [frequentPlayerDraft, setFrequentPlayerDraft] = useState<{ name: string; handicap: number | null }>({ name: "", handicap: null });
  const [frequentPlayerToDelete, setFrequentPlayerToDelete] = useState<FrequentPlayer | null>(null);
  const [editingSavedRivalId, setEditingSavedRivalId] = useState<string | null>(null);
  const [savedRivalDraft, setSavedRivalDraft] = useState<SavedPersonalRival | null>(null);
  const [savedRivalToDelete, setSavedRivalToDelete] = useState<SavedPersonalRival | null>(null);
  const [rulesCourseContext, setRulesCourseContext] = useState("");
  const undoStack = useRef<Array<{ scores: Record<number, HoleScore>; unitEvents: UnitEvent[]; manualBets: ManualBet[]; ballFriendSetup: Record<number, BallFriendHole> }>>([]);
  const suppressNextDraftSave = useRef(false);

  const order = useMemo(() => playOrder(startHole).slice(0, roundHoles), [startHole, roundHoles]);
  const holeNumber = order[currentIndex];
  const hole = course.holes.find((h) => h.number === holeNumber) ?? course.holes[0];
  const courseNames: string[] = useMemo(() => Array.from(new Set<string>(courses.map((c) => c.name))).sort((a, b) => a.localeCompare(b)), [courses]);
  const privateBoard = useMemo(() => privateLeaderboard(course, players, scores, order), [course, players, scores, order]);

  useEffect(() => {
    try {
      const savedCourses = JSON.parse(localStorage.getItem(STORAGE_KEYS.courses) || "null");
      const savedHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "null");
      const savedRivals = JSON.parse(localStorage.getItem(STORAGE_KEYS.rivals) || "null");
      const draft = migrateDraftPressures(JSON.parse(localStorage.getItem(STORAGE_KEYS.draft) || "null"));
      const savedFrequentPlayers = JSON.parse(localStorage.getItem(STORAGE_KEYS.frequentPlayers) || "[]");
      const savedFrequentGroups = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
      const mergedCourses = mergeDefaultCourses(savedCourses);
      setCourses(mergedCourses);
      if (Array.isArray(savedHistory)) setHistory(savedHistory.map((r: any) => ({ ...r, expenses: normalizeExpenses(r.expenses) })));
      if (Array.isArray(savedRivals)) setSavedPersonalRivals(savedRivals);
      if (Array.isArray(savedFrequentPlayers)) setFrequentPlayers(savedFrequentPlayers);
      setFrequentGroups(savedFrequentGroups);
      setHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) === "true");
      setDraftAvailable(hasRoundProgress(draft));
      if (draft) {
        if (draft.course) setCourse(withDefaultLaVistaRules(mergedCourses.find((c) => c.id === draft.course.id) || draft.course));
        if (draft.startHole) setStartHole(draft.startHole);
        if (draft.roundHoles === 9 || draft.roundHoles === 18) setRoundHoles(draft.roundHoles);
        if (draft.players) setPlayers(draft.players);
        if (draft.ownerId) setOwnerId(draft.ownerId);
        if (draft.bets) {
          const draftPlayerIds = (draft.players || []).map((p: Player) => p.id);
          const defaults = initialBets(draftPlayerIds);
          setBets({
            ...defaults,
            ...draft.bets,
            rabbits: { ...defaults.rabbits, ...(draft.bets.rabbits || {}), decimals: normalizeHandicapMode(draft.bets.rabbits?.decimals) },
            skins: { ...defaults.skins, ...(draft.bets.skins || {}), decimals: normalizeHandicapMode(draft.bets.skins?.decimals) },
            foursome: { ...defaults.foursome, ...(draft.bets.foursome || {}) },
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
          rivalName: b.rivalName || (draft.players || []).find((p: Player) => p.id === b.rivalPlayerId)?.name || "Rival",
          externalScores: b.externalScores || {},
          baseValue: b.baseValue ?? 100,
          advantageReceiver: (b.advantageReceiver === "owner" || b.advantageReceiver === "rival") ? b.advantageReceiver : (b.advantageReceiverId ? (b.advantageReceiverId === draft.ownerId ? "owner" : "rival") : "rival"),
          advantageStrokes: b.advantageReceiver === "none" ? 0 : (b.advantageStrokes ?? 0),
          back9Multiplier: b.back9Multiplier ?? 1,
          pressureMultiplier: b.pressureMultiplier ?? b.back9Multiplier ?? 1,
          pressureNine: b.pressureNine ?? (draft.startHole === 10 ? "holes_1_9" : "holes_10_18"),
          components: b.components || { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
        })));
        if (Array.isArray(draft.manualBets)) setManualBets(draft.manualBets);
        if (draft.scores) setScores(draft.scores);
        if (draft.unitEvents) setUnitEvents(draft.unitEvents);
        if (draft.ballFriendSetup) setBallFriendSetup(draft.ballFriendSetup);
        if (draft.expenses) setExpenses(normalizeExpenses(draft.expenses));
        if (draft.roundId) setRoundId(draft.roundId);
        if (draft.roundDate) setRoundDate(draft.roundDate);
        if (Number.isInteger(draft.currentIndex)) setCurrentIndex(Math.max(0, Math.min((draft.roundHoles || 18) - 1, draft.currentIndex)));
      }
    } catch { /* ignore corrupt local data */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (suppressNextDraftSave.current) {
      suppressNextDraftSave.current = false;
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(courses));
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
        localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(savedPersonalRivals));
        localStorage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(frequentPlayers));
        localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(frequentGroups));
        localStorage.setItem(STORAGE_KEYS.contrast, String(highContrast));
        localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
          version: 3, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores,
          unitEvents, ballFriendSetup, expenses, roundId, roundDate, currentIndex,
        }));
        setDraftAvailable(hasRoundProgress({ players, scores, currentIndex }));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, courses, history, savedPersonalRivals, frequentPlayers, frequentGroups, highContrast, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores, unitEvents, ballFriendSetup, expenses, roundId, roundDate, currentIndex]);

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
    if (!valid.has(ownerId)) setOwnerId(players[0]?.id ?? "");
  }, [players, ownerId]);

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
  }, [tab, holeNumber, hole, players]);

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
    if (id === FOURSOME_GHOST_ID) return "Fantasma";
    const group = players.find((p) => p.id === id);
    if (group) return group.name.trim() || "Sin nombre";
    const external = personalBets.find((b) => personalRivalKey(b) === id);
    return external?.rivalName || "—";
  };

  function checkpoint() {
    undoStack.current = pushUndoState(undoStack.current, {
      scores: structuredClone(scores),
      unitEvents: structuredClone(unitEvents),
      manualBets: structuredClone(manualBets),
      ballFriendSetup: structuredClone(ballFriendSetup),
    });
    setUndoCount(undoStack.current.length);
  }

  function undoLastAction() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setUndoCount(undoStack.current.length);
    setScores(previous.scores);
    setUnitEvents(previous.unitEvents);
    setManualBets(previous.manualBets);
    setBallFriendSetup(previous.ballFriendSetup);
  }

  function updatePlayer(id: string, patch: Partial<Player>) {
    setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p));
  }

  function appendPlayer(name = "", handicap: number | null = null) {
    const id = makeId();
    const p: Player = { id, name, handicap };
    setPlayers((ps) => [...ps, p]);
    if (!players.length) setOwnerId(id);
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

  function addPlayer() {
    appendPlayer();
  }

  function scoreFor(playerId: string) {
    return scores[holeNumber]?.[playerId] ?? null;
  }

  function setScore(playerId: string, value: number) {
    checkpoint();
    setScores((prev) => ({ ...prev, [holeNumber]: { ...(prev[holeNumber] || {}), [playerId]: Math.max(1, value) } }));
  }

  function changeScore(playerId: string, delta: number) {
    setScore(playerId, Number(scoreFor(playerId) ?? hole.par) + delta);
  }

  function goToHoleIndex(index: number) {
    setCurrentIndex(Math.max(0, Math.min(order.length - 1, index)));
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function navigateFromBottomBar(target: AppTab) {
    if (target === "rules") setRulesCourseContext(course.name);
    setTab(target);
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
    checkpoint();
    setManualBets((bets) => bets.map((b) => b.id === betId ? { ...b, amounts: { ...b.amounts, [playerId]: value } } : b));
  }

  function manualBetTotal(bet: ManualBet) {
    return players.reduce((sum, p) => sum + Number(bet.amounts[p.id] ?? 0), 0);
  }

  function addUnit(playerId: string, amount: number, label = amount > 0 ? "Otra positiva" : "Copa") {
    checkpoint();
    setUnitEvents((e) => [...e, { id: makeId(), hole: holeNumber, playerId, amount, label }]);
  }

  function undoLastUnit(playerId: string) {
    checkpoint();
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
    const saved = savedPersonalRivals[0];
    const draft: PersonalBet = {
      id: makeId(),
      rivalMode: rival ? "group" : "external",
      rivalPlayerId: rival?.id,
      externalRivalId: rival ? undefined : saved?.id,
      rivalName: rival?.name || saved?.name || "Rival",
      externalScores: {},
      baseValue: 100,
      advantageReceiver: "rival",
      advantageStrokes: 0,
      back9Multiplier: 1,
      pressureMultiplier: 1,
      pressureNine: "holes_10_18",
      components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
    };
    setPersonalBets((bets) => [...bets, !rival && saved ? applySavedPersonalRivalTemplate(draft, saved) : draft]);
  }

  function savePersonalRivalFromBet(bet: PersonalBet) {
    if (!bet.rivalName.trim()) return;
    const now = new Date().toISOString();
    const existing = savedPersonalRivals.find((rival) => rival.id === bet.externalRivalId);
    if (existing) {
      const template = personalRivalTemplateFromBet(bet, existing.id, now, existing.handicap ?? null);
      setSavedPersonalRivals((templates) => updateSavedPersonalRivalTemplate(templates, existing.id, template, now));
      return;
    }
    const id = makeId();
    const template = personalRivalTemplateFromBet(bet, id, now);
    setSavedPersonalRivals((templates) => [...templates, template]);
    updatePersonalBet(bet.id, { externalRivalId: id, rivalName: template.name });
  }

  function beginEditFrequentPlayer(template: FrequentPlayer) {
    setEditingFrequentPlayerId(template.id);
    setFrequentPlayerDraft({ name: template.name, handicap: template.handicap });
  }

  function saveFrequentPlayerEdit() {
    if (!editingFrequentPlayerId || !frequentPlayerDraft.name.trim()) return;
    setFrequentPlayers((templates) => updateFrequentPlayerTemplate(templates, editingFrequentPlayerId, frequentPlayerDraft, new Date().toISOString()));
    setEditingFrequentPlayerId(null);
  }

  function beginEditSavedRival(template: SavedPersonalRival) {
    setEditingSavedRivalId(template.id);
    setSavedRivalDraft({
      ...template,
      handicap: template.handicap ?? null,
      baseValue: template.baseValue ?? 100,
      advantageReceiver: template.advantageReceiver ?? "rival",
      advantageStrokes: template.advantageStrokes ?? 0,
      pressureMultiplier: template.pressureMultiplier ?? 1,
      pressureNine: template.pressureNine ?? "holes_10_18",
    });
  }

  function saveSavedRivalEdit() {
    if (!editingSavedRivalId || !savedRivalDraft?.name.trim()) return;
    setSavedPersonalRivals((templates) => updateSavedPersonalRivalTemplate(templates, editingSavedRivalId, savedRivalDraft, new Date().toISOString()));
    setEditingSavedRivalId(null);
    setSavedRivalDraft(null);
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

  function currentSnapshot(): RoundSnapshot | null {
    if (!owner) return null;
    return {
      id: roundId, date: roundDate, courseName: course.name, teeName: course.teeName,
      ownerName: owner.name, roundHoles, startHole, betResult: ownerBetResult, expenses, expenseTotal: ownerExpenseTotal,
      netResult: ownerNet, categoryResults, players: structuredClone(players), scores: structuredClone(scores),
      courseSnapshot: structuredClone(course), order: [...order], completedAt: new Date().toISOString(),
      personalResults: personals.results.map((r) => ({
        rivalKey: r.rivalId,
        rivalName: playerName(r.rivalId),
        totalMoney: r.totalMoney,
        componentMoney: r.componentMoney,
      })),
    };
  }

  function saveRound() {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    setHistory((h) => [snapshot, ...h.filter((x) => x.id !== roundId)]);
    const timestamp = new Date().toISOString();
    setFrequentPlayers((current) => upsertFrequentPlayers(current, players, timestamp));
    setTab("history");
  }

  function resetRound() {
    setPlayers([]); setOwnerId("");
    setScores({}); setUnitEvents([]); setBallFriendSetup({}); setPersonalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets([])); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); undoStack.current = []; setUndoCount(0); setTab("setup");
  }

  function deleteActiveRound() {
    suppressNextDraftSave.current = true;
    clearActiveRoundStorage(window.localStorage);
    setPlayers([]); setOwnerId("");
    setScores({}); setUnitEvents([]); setBallFriendSetup({}); setPersonalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets([])); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); undoStack.current = []; setUndoCount(0); setSaveStatus("saved"); setTab("welcome");
  }

  function startNewCourse() {
    const fresh: Course = {
      id: makeId(), name: "Campo nuevo", teeName: "General", builtIn: false,
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
    const updatedAt = localDateMexico();
    const savedRules = isLaVistaCourse(name)
      ? (Array.isArray(courseDraft.localRules) ? courseDraft.localRules : cloneLaVistaLocalRules()).filter((rule) => rule.title.trim() && rule.text.trim()).map((rule) => ({ ...rule, title: rule.title.trim(), text: rule.text.trim() }))
      : courseDraft.localRules;
    const saved = { ...courseDraft, name, teeName: "General", rating: undefined, slope: undefined, totalYards: undefined, updatedAt, localRules: savedRules, localRulesUpdatedAt: isLaVistaCourse(name) ? updatedAt : courseDraft.localRulesUpdatedAt, holes: courseDraft.holes.map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex })) };
    setCourses((cs) => [saved, ...cs.filter((c) => c.id !== saved.id)]);
    setCourse(saved); setShowLocalRulesEditor(false); setTab("setup");
  }

  function duplicateCourseDraft() {
    setCourseDraft((d) => ({
      ...d,
      id: makeId(),
      name: `${d.name} copia`,
      teeName: "General",
      builtIn: false,
      updatedAt: undefined,
      rating: undefined,
      slope: undefined,
      holes: d.holes.map((h) => ({ ...h, yards: undefined })),
    }));
  }

  function deleteCourseDraft() {
    if (courseDraft.builtIn || !window.confirm(`¿Eliminar el campo personalizado “${courseDraft.name}”?`)) return;
    const remaining = courses.filter((candidate) => candidate.id !== courseDraft.id);
    setCourses(remaining);
    setCourse(remaining[0] || laVista);
    setTab("setup");
  }

  function restoreOriginalCourse() {
    const original = defaultCourses.find((candidate) => candidate.id === courseDraft.id);
    if (!original || !window.confirm("¿Restablecer la configuración original? Se perderán las ediciones actuales del campo, no las rondas históricas.")) return;
    const restored = structuredClone(original);
    setCourseDraft(restored);
    setCourses((current) => [restored, ...current.filter((candidate) => candidate.id !== restored.id)]);
    setCourse(restored);
  }

  function saveFrequentGroup() {
    const name = groupName.trim();
    const groupPlayers = players.filter((player) => player.name.trim()).map((player) => ({ name: player.name.trim(), handicap: player.handicap }));
    if (!name || !groupPlayers.length) return;
    setFrequentGroups((groups) => [{ id: makeId(), name, players: groupPlayers, uses: 0, updatedAt: new Date().toISOString() }, ...groups.filter((group) => group.name.toLocaleLowerCase("es-MX") !== name.toLocaleLowerCase("es-MX"))]);
    setGroupName("");
  }

  function loadFrequentGroup(group: FrequentGroup) {
    const loaded = playersFromFrequentGroup(group, makeId);
    setPlayers(loaded);
    setOwnerId(loaded[0]?.id || "");
    setBets(initialBets(loaded.map((player) => player.id)));
    setFrequentGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, uses: item.uses + 1, updatedAt: new Date().toISOString() } : item));
  }

  function resetFrequentGroupEditor() {
    setFrequentGroupDraft(null);
    setGroupMemberSource("frequent");
    setSelectedGroupFrequentPlayerId("");
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
    setPendingGroupFrequentPlayers([]);
  }

  function beginEditFrequentGroup(group: FrequentGroup) {
    setFrequentGroupDraft(structuredClone(group));
    setGroupMemberSource(frequentPlayers.length ? "frequent" : "new");
    setSelectedGroupFrequentPlayerId(frequentPlayers[0]?.id || "");
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
    setPendingGroupFrequentPlayers([]);
  }

  function addExistingPlayerToFrequentGroup() {
    const saved = frequentPlayers.find((player) => player.id === selectedGroupFrequentPlayerId);
    if (!saved) return;
    setFrequentGroupDraft((group) => group ? addFrequentGroupMember(group, { name: saved.name, handicap: saved.handicap }) : group);
  }

  function addNewPlayerToFrequentGroup() {
    const member = { name: newGroupMember.name.trim(), handicap: newGroupMember.handicap };
    if (!member.name || frequentGroupDraft?.players.some((candidate) => candidate.name.trim().toLocaleLowerCase("es-MX") === member.name.toLocaleLowerCase("es-MX"))) return;
    setFrequentGroupDraft((group) => group ? addFrequentGroupMember(group, member) : group);
    if (saveNewGroupMemberAsFrequent) setPendingGroupFrequentPlayers((members) => [...members, member]);
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
  }

  function editFrequentGroupMember(index: number, patch: Partial<FrequentGroup["players"][number]>) {
    const previous = frequentGroupDraft?.players[index];
    if (!previous) return;
    setFrequentGroupDraft((group) => group ? updateFrequentGroupMember(group, index, patch) : group);
    setPendingGroupFrequentPlayers((members) => members.map((member) => member.name === previous.name ? { ...member, ...patch } : member));
  }

  function removeMemberFromFrequentGroup(index: number) {
    const previous = frequentGroupDraft?.players[index];
    if (!previous) return;
    setFrequentGroupDraft((group) => group ? removeFrequentGroupMember(group, index) : group);
    setPendingGroupFrequentPlayers((members) => members.filter((member) => member.name !== previous.name));
  }

  function saveFrequentGroupEdit() {
    if (!frequentGroupDraft?.name.trim() || !frequentGroupDraft.players.length || frequentGroupDraft.players.some((member) => !member.name.trim())) return;
    const now = new Date().toISOString();
    setFrequentGroups((groups) => updateFrequentGroupTemplate(groups, frequentGroupDraft.id, frequentGroupDraft, now));
    if (pendingGroupFrequentPlayers.length) {
      setFrequentPlayers((templates) => pendingGroupFrequentPlayers.reduce(
        (current, member) => addFrequentPlayerTemplate(current, member, makeId(), now),
        templates,
      ));
    }
    resetFrequentGroupEditor();
  }

  async function attachScorecardPhoto(round: RoundSnapshot, file?: File) {
    if (!file) return;
    await saveScorecardPhoto(round.id, file);
    setHistory((rounds) => rounds.map((item) => item.id === round.id ? { ...item, photoId: round.id } : item));
  }

  async function viewScorecardPhoto(round: RoundSnapshot) {
    const blob = await readScorecardPhoto(round.photoId || round.id);
    if (!blob) return window.alert("No se encontró la foto local.");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
          <div className="manualGrid">{players.map((p) => <label key={p.id}><span>{p.name}</span><div className="moneyField"><span>$</span><input type="number" inputMode="decimal" step="50" placeholder="0" value={(bet.amounts[p.id] ?? 0) === 0 ? "" : bet.amounts[p.id]} onChange={(e) => setManualAmount(bet.id, p.id, Number(e.target.value) || 0)} /></div></label>)}</div>
          <div className={`manualBalance ${valid ? "good" : "bad"}`}>{valid ? "✓ Cierra en $0 y se suma al resultado" : `Falta cuadrar ${money(-total)}`}</div>
        </div>;
      })}
    </section>;
  }

  function renderPersonalLive(title = "Apuestas personales · en vivo", currentPhysicalNineOnly = false) {
    if (!personalBets.length) return null;
    const ownerLabel = owner?.name.trim() || "Jugador principal";
    return <section className="card personalLive">
      <div className="sectionTitle"><div><h2>{title}</h2><p>Estado por componente con dinero, scores netos y detalle hoyo por hoyo.</p></div></div>
      {personals.results.map((result) => {
        const rivalLabel = playerName(result.rivalId);
        return <div className="personalLiveBet" key={result.betId}>
          <div className="row between personalLiveHead"><b>{ownerLabel} vs {rivalLabel}</b><span>Liquidado: <strong className={result.totalMoney > 0 ? "good" : result.totalMoney < 0 ? "bad" : ""}>{signedMoney(result.totalMoney)}</strong></span></div>
          {!result.liveComponents.length && <div className="empty">No hay componentes activos.</div>}
          {result.liveComponents.filter((component) => {
            if (!currentPhysicalNineOnly) return true;
            if (component.key === "match18" || component.key === "medal18") return true;
            return holeNumber <= 9 ? component.key === "match1" || component.key === "medal1" : component.key === "match2" || component.key === "medal2";
          }).map((component) => {
            const leaderName = component.leader === "owner" ? ownerLabel : component.leader === "rival" ? rivalLabel : "";
            const loserName = component.leader === "owner" ? rivalLabel : component.leader === "rival" ? ownerLabel : "";
            const status = component.playedHoles === 0
              ? "Aún sin resultado"
              : component.leader === "tie"
                ? (component.complete ? "Empataron" : "Van empatados")
                : `${leaderName} ${component.complete ? "ganó" : "va ganando"} · ${loserName} ${component.complete ? "perdió" : "va perdiendo"}`;
            const matchState = component.matchState === 0
              ? "AS"
              : `${component.matchState > 0 ? ownerLabel : rivalLabel} ${Math.abs(component.matchState)} UP`;
            const medalDifference = component.medalDiff === 0
              ? "AS · 0 golpes"
              : `${component.medalDiff > 0 ? ownerLabel : rivalLabel} por ${Math.abs(component.medalDiff)} golpe${Math.abs(component.medalDiff) === 1 ? "" : "s"}`;
            return <div className="personalLiveComponent" key={component.key}>
              <div className="row between"><div><b>{component.label}</b><small>{component.playedHoles} hoyo{component.playedHoles === 1 ? "" : "s"} registrado{component.playedHoles === 1 ? "" : "s"}</small></div><strong className={component.complete ? "settled" : "liveNow"}>{component.complete ? "Final" : "En vivo"}</strong></div>
              <div className="liveStatus">{status}</div>
              <div className="personalMoney">En juego <b>{money(component.stake)}</b> · {ownerLabel} <b className={component.ownerMoney > 0 ? "good" : component.ownerMoney < 0 ? "bad" : ""}>{signedMoney(component.ownerMoney)}</b> · {rivalLabel} <b className={component.ownerMoney < 0 ? "good" : component.ownerMoney > 0 ? "bad" : ""}>{signedMoney(-component.ownerMoney)}</b></div>
              {component.kind === "match" ? <>
                <div className="auditLine"><span>Estado Match</span><b>{matchState}</b></div>
                <div className="holeAudit">{component.holeResults.length ? component.holeResults.map((holeResult) => <span key={holeResult.hole}>H{holeResult.hole}: {holeResult.winner === "tie" ? "Empate" : holeResult.winner === "owner" ? ownerLabel : rivalLabel} ({holeResult.ownerScore}–{holeResult.rivalScore})</span>) : <span>Sin hoyos completos</span>}</div>
              </> : <>
                <div className="auditLine"><span>Neto acumulado</span><b>{ownerLabel} {component.ownerNetTotal} · {rivalLabel} {component.rivalNetTotal}</b></div>
                <div className="auditLine"><span>Diferencia Medal</span><b>{medalDifference}</b></div>
              </>}
            </div>;
          })}
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

  function saveAndAdvance() {
    const extras: string[] = [];
    const rabbit = currentRabbitEvents.at(-1);
    if (rabbit) extras.push(`Conejo: ${rabbit.playerId ? playerName(rabbit.playerId) : "libre"} · ${rabbit.type}`);
    if (currentSkin) extras.push(`Skins: ${currentSkin.winnerId ? `${playerName(currentSkin.winnerId)} cobra ${currentSkin.count}` : `carry ${currentSkin.count}`}`);
    const currentFoursome = foursomes.matches.find((match) => match.holePoints.some((item) => item.hole === holeNumber));
    if (currentFoursome) extras.push(`Foursome: ${playerName(currentFoursome.basePair[0])}/${playerName(currentFoursome.basePair[1])} ${currentFoursome.pointDiff >= 0 ? "+" : ""}${currentFoursome.pointDiff}`);
    setHoleSummary(buildHoleSummary(holeNumber, players, scores, extras));
    window.setTimeout(() => {
      setHoleSummary([]);
      if (currentIndex < order.length - 1) goToHoleIndex(currentIndex + 1);
      else { setTab("results"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    }, 900);
  }

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
  const golfStats = useMemo(() => historicalGolfStats(history), [history]);

  return <main className={`app ${highContrast ? "highContrast" : ""}`}>
    <header className="topbar">
      <div><div className="brand">Golf Bets</div><div className="subbrand">Apuestas · liquidación · histórico</div></div>
      <div className="topActions"><span className={`saveIndicator ${saveStatus}`}>{saveStatus === "saving" ? "Guardando…" : saveStatus === "error" ? "No se pudo guardar" : "✓ Guardado"}</span><button className="contrastButton" onClick={() => setHighContrast((value) => !value)} aria-pressed={highContrast}>{contrastToggleLabel(highContrast)}</button><span className="version">V3</span></div>
    </header>

    {tab === "welcome" && <section className="welcomeScreen">
      <div className="eyebrow">HOY EN MÉXICO</div>
      <time dateTime={todayMexico}>{mexicoDateLabel(todayMexico)}</time>
      <h1>¿Listos para jugar?</h1>
      <p>Inicia una ronda nueva y configura jugadores, campo y apuestas.</p>
      <button className="primary big" onClick={resetRound}>Nueva ronda</button>
      {draftAvailable && <div className="activeRoundActions"><button className="secondary big" onClick={() => setTab(players.length ? "round" : "setup")}>Continuar ronda · H{order[currentIndex]}</button><button className="deleteRoundButton" onClick={() => setShowDeleteRoundConfirm(true)}>Eliminar ronda</button></div>}
      <div className="welcomeLinks"><button className="secondary" onClick={() => { setRulesCourseContext(draftAvailable ? course.name : ""); setTab("rules"); }}>⚑ Reglas de Golf</button><button className="secondary" onClick={() => setTab("pollaLive")}>🏆 Polla Live</button></div>
      {history[0] && <button className="recentRound" onClick={() => setTab("history")}><span>Última ronda</span><b>{history[0].courseName} · {history[0].date}</b><strong className={history[0].netResult >= 0 ? "good" : "bad"}>{signedMoney(history[0].netResult)}</strong></button>}
    </section>}

    {tab === "setup" && <>
      <section className="hero">
        <div><div className="eyebrow">NUEVA JUGADA</div><h1>Configura y juega.</h1><p>La app calcula lo automático; tú solo capturas score y eventos especiales.</p></div>
        <input className="dateInput" type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} />
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>1. Campo</h2><p>Elige el campo; Par y Ventaja/SI se conservan por hoyo.</p></div><button className="textButton" onClick={startNewCourse}>+ Campo</button></div>
        <div className="grid2">
          <div><label>Campo</label><select value={course.name} onChange={(e) => {
            const next = courses.find((x) => x.name === e.target.value); if (next) setCourse(next);
          }}>{courseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
          <div><label>Inicio de ronda</label><select value={startHole} onChange={(e) => setStartHole(Number(e.target.value) as 1 | 10)}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></div>
          <div><label>Hoyos a jugar</label><select value={roundHoles} onChange={(e) => setRoundHoles(Number(e.target.value) as 9 | 18)}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></div>
        </div>
        <div className="courseMeta"><span>18 hoyos configurados</span>{course.updatedAt && <span>Última actualización: {course.updatedAt}</span>}<button onClick={() => { setCourseDraft(withDefaultLaVistaRules(course)); setShowLocalRulesEditor(false); setTab("courses"); }}>{course.name === "La Vista Temporal" ? "Editar campo temporal" : "Editar campo"}</button>{isLaVistaCourse(course.name) && <button onClick={() => { setRulesCourseContext(course.name); setTab("rules"); }}>Ver Reglas Locales</button>}{isLaVistaCourse(course.name) && <button onClick={() => { setCourseDraft(withDefaultLaVistaRules(course)); setShowLocalRulesEditor(true); setTab("courses"); }}>Editar Reglas Locales</button>}</div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>2. Jugadores</h2><p>HCP de la ronda. La base se recalcula según cada apuesta.</p></div><button className="textButton" onClick={addPlayer}>+ Jugador</button></div>
        {!players.length && <div className="empty">Agrega los jugadores de esta ronda.</div>}
        {players.map((p) => <div className="playerEdit" key={p.id}>
          <input placeholder="Nombre" value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} />
          <input className="hcpInput" type="number" inputMode="decimal" step="0.1" min={-15} max={54} placeholder="HCP" value={p.handicap ?? ""} onChange={(e) => updatePlayer(p.id, { handicap: e.target.value === "" ? null : Number(e.target.value) })} />
          <button className={`ownerDot ${ownerId === p.id ? "active" : ""}`} onClick={() => setOwnerId(p.id)} title="Jugador principal">★</button>
          <button className="remove" onClick={() => setPlayers((ps) => ps.filter((x) => x.id !== p.id))}>×</button>
        </div>)}
        <div className="hint">★ marca al jugador principal para estadísticas y gastos.</div>
        {(frequentGroups.length > 0 || frequentPlayers.length > 0) && <div className="frequentBox">
          <b>Grupos / jugadores frecuentes</b>
          {frequentGroups.length > 0 && <div className="frequentGroupList"><span className="templateSectionLabel">Grupos frecuentes</span>{frequentGroups.map((group) => <div className="templateRow groupTemplateRow" key={group.id}>
            <button className="templateLoad" onClick={() => loadFrequentGroup(group)} aria-label={`Cargar grupo ${group.name} a la ronda`}><b>{group.name}</b><span>{group.players.map((member) => member.name).join(" · ")}<br />Toca el nombre para cargar este grupo</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentGroup(group)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentGroupToDelete(group)}>🗑 Eliminar</button></div>
          </div>)}</div>}
          {frequentPlayers.length > 0 && <div className="frequentTemplateList"><span className="templateSectionLabel">Jugadores frecuentes</span>{frequentPlayers.map((saved) => editingFrequentPlayerId === saved.id ? <div className="templateEditor" key={saved.id}>
            <input aria-label="Nombre frecuente" value={frequentPlayerDraft.name} onChange={(event) => setFrequentPlayerDraft((draft) => ({ ...draft, name: event.target.value }))} />
            <input aria-label="HCP frecuente" className="hcpInput" type="number" inputMode="decimal" step="0.1" min={-15} max={54} placeholder="HCP" value={frequentPlayerDraft.handicap ?? ""} onChange={(event) => setFrequentPlayerDraft((draft) => ({ ...draft, handicap: event.target.value === "" ? null : Number(event.target.value) }))} />
            <div className="templateActions"><button className="primary" disabled={!frequentPlayerDraft.name.trim()} onClick={saveFrequentPlayerEdit}>Guardar</button><button className="secondary" onClick={() => setEditingFrequentPlayerId(null)}>Cancelar</button></div>
          </div> : <div className="templateRow" key={saved.id}>
            <button className="templateLoad" onClick={() => appendPlayer(saved.name, saved.handicap)}><b>{saved.name}</b><span>HCP {saved.handicap ?? "—"} · + Agregar</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentPlayer(saved)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentPlayerToDelete(saved)}>🗑 Eliminar</button></div>
          </div>)}</div>}
        </div>}
        {players.some((player) => player.name.trim()) && <div className="inlineForm"><input placeholder="Nombre del grupo frecuente" value={groupName} onChange={(event) => setGroupName(event.target.value)} /><button className="secondary" onClick={saveFrequentGroup}>Guardar grupo</button></div>}
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>3. Apuestas generales</h2><p>Cada apuesta tiene su propio porcentaje y participantes.</p></div></div>

        <div className="betCard">
          <div className="betHead"><div><b>🐇 Conejos</b><span>Agarra · mantiene · gana · acumula</span></div><Toggle on={bets.rabbits.enabled} onClick={() => setBets({ ...bets, rabbits: { ...bets.rabbits, enabled: !bets.rabbits.enabled } })} /></div>
          {bets.rabbits.enabled && <><div className="grid3"><MoneyInput label="Valor" value={bets.rabbits.value} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, value: v } })} /><HcpPercentInput value={bets.rabbits.hcpPct} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, hcpPct: v } })} /><HandicapModeSelect value={bets.rabbits.decimals} onChange={(decimals) => setBets({ ...bets, rabbits: { ...bets.rabbits, decimals } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.rabbits.participantIds} onChange={(ids) => setBets({ ...bets, rabbits: { ...bets.rabbits, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>⛳ Skins</b><span>Empates acumulan</span></div><Toggle on={bets.skins.enabled} onClick={() => setBets({ ...bets, skins: { ...bets.skins, enabled: !bets.skins.enabled } })} /></div>
          {bets.skins.enabled && <><div className="grid3"><MoneyInput label="Valor" value={bets.skins.value} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, value: v } })} /><HcpPercentInput value={bets.skins.hcpPct} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, hcpPct: v } })} /><HandicapModeSelect value={bets.skins.decimals} onChange={(decimals) => setBets({ ...bets, skins: { ...bets.skins, decimals } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.skins.participantIds} onChange={(ids) => setBets({ ...bets, skins: { ...bets.skins, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🔢 Unidades / Copas</b><span>Positivas menos negativas; todos pagan a todos</span></div><Toggle on={bets.units.enabled} onClick={() => setBets({ ...bets, units: { ...bets.units, enabled: !bets.units.enabled } })} /></div>
          {bets.units.enabled && <><MoneyInput label="Valor por unidad" value={bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, value: v } })} /><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.units.participantIds} onChange={(ids) => setBets({ ...bets, units: { ...bets.units, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🤝 Foursome</b><span>Fijo · fijo + patada · solo puntos</span></div><Toggle on={bets.foursome.enabled} onClick={() => setBets({ ...bets, foursome: { ...bets.foursome, enabled: !bets.foursome.enabled } })} /></div>
          {bets.foursome.enabled && <>
            <div className="grid3">
              <div><label>Modalidad</label><select value={bets.foursome.mode} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, mode: e.target.value as BetConfig["foursome"]["mode"] } })}><option value="fixed">Fijo</option><option value="fixed_points">Fijo + Patada</option><option value="points">Solo puntos</option></select></div>
              <div><label>Cambia parejas</label><select value={bets.foursome.segmentSize} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, segmentSize: Number(e.target.value) as 3 | 6 | 9 | 18 } })}><option value={3}>Cada 3</option><option value={6}>Cada 6</option><option value={9}>Cada 9</option><option value={18}>18 hoyos</option></select></div>
              <HcpPercentInput value={bets.foursome.hcpPct} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, hcpPct: v } })} />
              {(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Foursome fijo" value={bets.foursome.fixedValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, fixedValue: v } })} />}
              {(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Valor punto / patada" value={bets.foursome.pointValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, pointValue: v } })} />}
              <div><label>Decimales</label><select value={bets.foursome.decimals} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, decimals: e.target.value as "partial" | "round" } })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div>
            </div>
            {roundHoles === 18 && <div className="pressureOption pressureGrid">
              <div><b>Presión Foursome</b><span>Se identifica siempre por hoyos físicos, aunque la salida sea H10.</span></div>
              <div><label>Multiplicador</label><select value={bets.foursome.pressureMultiplier ?? (bets.foursome.pressSecond9 ? 2 : 1)} onChange={(event) => setBets({ ...bets, foursome: { ...bets.foursome, pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5, pressSecond9: false } })}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}x{value === 1 ? " · sin presión" : ""}</option>)}</select></div>
              <div><label>Vuelta presionada</label><select value={bets.foursome.pressureNine ?? "holes_10_18"} onChange={(event) => setBets({ ...bets, foursome: { ...bets.foursome, pressureNine: event.target.value as "holes_1_9" | "holes_10_18" } })}><option value="holes_1_9">H1–9</option><option value="holes_10_18">H10–18</option></select></div>
            </div>}
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
          {bets.ballFriend.enabled && <><div className="grid3"><MoneyInput label="Valor punto" value={bets.ballFriend.value} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, value: v } })} /><HcpPercentInput value={bets.ballFriend.hcpPct} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, hcpPct: v } })} /><NumberField label="Score máximo" value={bets.ballFriend.maxScore} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, maxScore: v } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.ballFriend.participantIds} onChange={(ids) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, participantIds: ids } })} /></>}
        </div>

        <PollaBetEditor
          title="Polla H1–9"
          description="Mejor medal neto en los hoyos físicos H1–9"
          config={bets.polla.first9}
          players={players}
          onChange={(first9) => setBets({ ...bets, polla: { ...bets.polla, first9 } })}
        />

        <PollaBetEditor
          title="Polla H10–18"
          description="Mejor medal neto en los hoyos físicos H10–18"
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
            <div className="grid3"><MoneyInput label="Valor" value={bets.miniPolla.value} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, value: v } })} /><HcpPercentInput value={bets.miniPolla.hcpPct} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, hcpPct: v } })} /><div><label>Decimales</label><select value={bets.miniPolla.decimals} onChange={(e) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, decimals: e.target.value as "partial" | "round" } })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div></div>
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

      <button className="primary big" disabled={!players.length || players.some((player) => !player.name.trim())} onClick={() => { setCurrentIndex(0); setTab("round"); }}>Iniciar ronda →</button>
    </>}

    {tab === "personals" && <>
      <section className="hero">
        <div><div className="eyebrow">APUESTAS PERSONALES</div><h1>{owner?.name ?? "Jugador principal"}</h1><p>Separadas del foursome. El rival puede jugar contigo o en otro grupo.</p></div>
        <button className="secondary" onClick={newPersonalBet}>+ Personal</button>
      </section>

      {savedPersonalRivals.length > 0 && <section className="card savedRivalsCard">
        <div className="sectionTitle"><div><h2>Rivales guardados</h2><p>Plantillas para apuestas futuras. Editarlas no cambia esta ronda ni el Histórico.</p></div></div>
        <div className="frequentTemplateList">{savedPersonalRivals.map((saved) => editingSavedRivalId === saved.id && savedRivalDraft ? <div className="templateEditor rivalTemplateEditor" key={saved.id}>
          <div className="grid3">
            <div><label>Nombre</label><input value={savedRivalDraft.name} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)} /></div>
            <div><label>HCP predeterminado</label><input type="number" inputMode="decimal" step="0.1" min={-15} max={54} placeholder="HCP" value={savedRivalDraft.handicap ?? ""} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, handicap: event.target.value === "" ? null : Number(event.target.value) } : draft)} /></div>
            <MoneyInput label="Valor base" value={savedRivalDraft.baseValue ?? 100} onChange={(value) => setSavedRivalDraft((draft) => draft ? { ...draft, baseValue: value } : draft)} />
            <div><label>Quién recibe ventaja</label><select value={savedRivalDraft.advantageReceiver ?? "rival"} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, advantageReceiver: event.target.value as "owner" | "rival" } : draft)}><option value="owner">Jugador principal</option><option value="rival">Rival</option></select></div>
            <NumberField label="Golpes que recibe" value={savedRivalDraft.advantageStrokes ?? 0} onChange={(value) => setSavedRivalDraft((draft) => draft ? { ...draft, advantageStrokes: Math.max(0, value) } : draft)} />
            <div><label>Multiplicador</label><select value={savedRivalDraft.pressureMultiplier ?? 1} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 } : draft)}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}x{value === 1 ? " · sin presión" : ""}</option>)}</select></div>
            <div><label>Vuelta</label><select value={savedRivalDraft.pressureNine ?? "holes_10_18"} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, pressureNine: event.target.value as "holes_1_9" | "holes_10_18" } : draft)}><option value="holes_1_9">H1–9</option><option value="holes_10_18">H10–18</option></select></div>
          </div>
          <div className="templateActions"><button className="primary" disabled={!savedRivalDraft.name.trim()} onClick={saveSavedRivalEdit}>Guardar plantilla</button><button className="secondary" onClick={() => { setEditingSavedRivalId(null); setSavedRivalDraft(null); }}>Cancelar</button></div>
        </div> : <div className="templateRow" key={saved.id}>
          <div className="templateSummary"><b>{saved.name}</b><span>HCP {saved.handicap ?? "—"} · {money(saved.baseValue ?? 100)} base · {saved.advantageStrokes ?? 0} golpes · {saved.pressureMultiplier ?? 1}x</span></div>
          <div className="templateActions"><button className="secondary" onClick={() => beginEditSavedRival(saved)}>✏ Editar</button><button className="dangerGhost" onClick={() => setSavedRivalToDelete(saved)}>🗑 Eliminar</button></div>
        </div>)}</div>
      </section>}

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
              const saved = savedPersonalRivals.find((template) => template.id === bet.externalRivalId) || savedPersonalRivals[0];
              const nextBet: PersonalBet = {
                ...bet,
                rivalMode: mode,
                rivalPlayerId: mode === "group" ? (bet.rivalPlayerId || first?.id) : undefined,
                externalRivalId: mode === "external" ? (bet.externalRivalId || saved?.id) : undefined,
                rivalName: mode === "group" ? (first?.name || bet.rivalName) : (saved?.name || bet.rivalName || "Rival"),
              };
              updatePersonalBet(bet.id, mode === "external" && saved ? applySavedPersonalRivalTemplate(nextBet, saved) : nextBet);
            }}><option value="group">Mi foursome</option><option value="external">Otro foursome</option></select></div>
            {bet.rivalMode === "group" ? <div><label>Rival</label><select value={bet.rivalPlayerId || ""} onChange={(e) => {
              const rp = players.find((p) => p.id === e.target.value);
              updatePersonalBet(bet.id, { rivalPlayerId: e.target.value, rivalName: rp?.name || "Rival" });
            }}>{players.filter((p) => p.id !== ownerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div> : <>
              <div><label>Rival guardado</label><select value={bet.externalRivalId || ""} onChange={(e) => {
                const saved = savedPersonalRivals.find((r) => r.id === e.target.value);
                updatePersonalBet(bet.id, saved ? applySavedPersonalRivalTemplate(bet, saved) : { externalRivalId: undefined });
              }}><option value="">+ Nuevo rival</option>{savedPersonalRivals.map((r) => <option key={r.id} value={r.id}>{r.name}{typeof r.handicap === "number" ? ` · HCP ${r.handicap}` : ""}</option>)}</select></div>
              <div><label>Nombre del rival para esta ronda</label><input value={bet.rivalName} placeholder="Ej. Daniel" onChange={(e) => updatePersonalBet(bet.id, { rivalName: e.target.value })} /></div>
              <div className="templateSaveAction"><label>Plantilla frecuente</label><button className="secondary" disabled={!bet.rivalName.trim()} onClick={() => savePersonalRivalFromBet(bet)}>{bet.externalRivalId ? "Guardar cambio en rival frecuente" : "Guardar como rival frecuente"}</button></div>
            </>}
            <MoneyInput label="Valor base" value={bet.baseValue} onChange={(v) => updatePersonalBet(bet.id, { baseValue: v })} />
            {roundHoles === 18 && <div><label>Multiplicador</label><select value={bet.pressureMultiplier ?? bet.back9Multiplier ?? 1} onChange={(event) => updatePersonalBet(bet.id, { pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5, back9Multiplier: 1 })}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}x{value === 1 ? " · sin presión" : ""}</option>)}</select></div>}
            {roundHoles === 18 && <div><label>Vuelta</label><select value={bet.pressureNine ?? "holes_10_18"} onChange={(event) => updatePersonalBet(bet.id, { pressureNine: event.target.value as "holes_1_9" | "holes_10_18" })}><option value="holes_1_9">H1–9</option><option value="holes_10_18">H10–18</option></select></div>}
            <div><label>Quién recibe ventaja</label><select value={bet.advantageReceiver === "owner" ? "owner" : "rival"} onChange={(e) => updatePersonalBet(bet.id, { advantageReceiver: e.target.value as "owner" | "rival" })}><option value="owner">{owner?.name} recibe</option><option value="rival">{displayRival} recibe</option></select></div>
            <NumberField label="Golpes que recibe" value={bet.advantageStrokes} onChange={(v) => updatePersonalBet(bet.id, { advantageStrokes: Math.max(0, v) })} />
          </div>
          {bet.advantageStrokes === 0 && <div className="hint">0 golpes = sin ventaja.</div>}
          <div className="componentGrid">{(roundHoles === 9
            ? ([["match1","Match 9"],["medal1","Medal 9"]] as [keyof PersonalBet["components"], string][])
            : ([["match1","Match H1–9"],["medal1","Medal H1–9"],["match2","Match H10–18"],["medal2","Medal H10–18"],["match18","Match Total 18"],["medal18","Medal Total 18"]] as [keyof PersonalBet["components"], string][])
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
        <div><div className="eyebrow">{course.name}</div><h1>Hoyo {holeNumber}</h1><p>Par {hole.par} · Ventaja {hole.strokeIndex}</p></div>
        <div className="progress">{currentIndex + 1}<span>/{order.length}</span></div>
      </section>

      <div className="scorecardToggle row"><button className="secondary" onClick={() => setShowFullScorecard((v) => !v)}>{showFullScorecard ? "Ocultar tarjeta completa" : "Ver tarjeta completa"}</button><button className="secondary" onClick={() => setTab("standings")}>CÓMO VAMOS</button><button className="secondary" onClick={undoLastAction} disabled={undoCount === 0}>↶ Deshacer</button><button className="secondary" onClick={() => { setTab("results"); window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 0); }}>Gastos</button></div>

      {showFullScorecard && <section className="card fullScorecard">
        <div className="sectionTitle"><div><h2>Tarjeta completa</h2><p>Scores de todos los jugadores en el orden real de juego. Desliza horizontalmente.</p></div></div>
        <div className="tableWrap scorecardTable"><table><thead><tr><th>Jugador</th>{order.map((h) => <th key={h}><span>H{h}</span><small>Ventaja {course.holes.find((x) => x.number === h)?.strokeIndex ?? "—"}</small></th>)}<th>OUT</th><th>IN</th><th>TOTAL</th><th>+/− Par</th></tr></thead><tbody>{players.map((p) => {
          const scoreAt = (h: number) => scores[h]?.[p.id];
          const first9 = order.filter((h) => h <= 9 && typeof scoreAt(h) === "number").reduce((a, h) => a + Number(scoreAt(h)), 0);
          const second9 = order.filter((h) => h >= 10 && typeof scoreAt(h) === "number").reduce((a, h) => a + Number(scoreAt(h)), 0);
          const entered = order.filter((h) => typeof scoreAt(h) === "number");
          const total = entered.reduce((a, h) => a + Number(scoreAt(h)), 0);
          const parEntered = entered.reduce((a, h) => a + (course.holes.find((x) => x.number === h)?.par || 0), 0);
          const rel = total - parEntered;
          return <tr key={p.id}><td><b>{p.name.trim() || "Sin nombre"} · HCP {p.handicap ?? "—"}</b></td>{order.map((h) => <td key={h}>{typeof scoreAt(h) === "number" ? scoreAt(h) : "—"}</td>)}<td><b>{first9 || "—"}</b></td><td><b>{second9 || "—"}</b></td><td><b>{total || "—"}</b></td><td className={rel <= 0 ? "good" : "bad"}>{entered.length ? `${rel > 0 ? "+" : ""}${rel}` : "—"}</td></tr>;
        })}</tbody></table></div>
      </section>}

      <section className="card scoreCard">
        {players.map((p) => <div className="scoreRow" key={p.id}>
          <div><b>{p.name.trim() || "Sin nombre"}</b><span>HCP {p.handicap ?? "—"}</span></div>
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
              <div className="matchNums"><small>Hoyo {current === undefined ? "—" : `${current > 0 ? "+" : ""}${current}`}</small><b className={m.pointDiff > 0 ? "good" : m.pointDiff < 0 ? "bad" : ""}>{m.pointDiff === 0 ? "AS" : `${m.pointDiff > 0 ? `${playerName(m.basePair[0])}/${playerName(m.basePair[1])}` : `${playerName(m.opponentPair[0])}/${playerName(m.opponentPair[1])}`} +${Math.abs(m.pointDiff)}`}</b><small>Acumulado {m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts</small></div>
            </div>;
          })}</div>;
        })()}
      </section>}

      {renderPersonalLive("Apuestas personales · en vivo", true)}

      <div className="roundActions"><button className="secondary big" disabled={currentIndex === 0} onClick={() => goToHoleIndex(currentIndex - 1)}>← Anterior</button><button className="primary big" onClick={saveAndAdvance}>{currentIndex < order.length - 1 ? "Guardar y siguiente →" : "Ver resultados →"}</button></div>
      {holeSummary.length > 0 && <div className="holeSummary" role="status">{holeSummary.map((line, index) => index === 0 ? <b key={line}>{line}</b> : <span key={`${line}-${index}`}>{line}</span>)}</div>}
    </>}

    {tab === "standings" && <>
      <section className="hero standingsHero"><div><div className="eyebrow">CÓMO VAMOS</div><h1>Balance provisional.</h1><p>Solo cuenta apuestas ya cobradas o componentes completos; lo pendiente sigue marcado en vivo.</p></div><button className="secondary" onClick={() => setTab("round")}>Volver al hoyo</button></section>
      <section className="provisionalGrid">{[...players].sort((a, b) => (allBetBalances[b.id] || 0) - (allBetBalances[a.id] || 0)).map((player, index) => <div className="stat" key={player.id}><span>{index + 1} · {player.name || "Sin nombre"}</span><b className={(allBetBalances[player.id] || 0) > 0 ? "good" : (allBetBalances[player.id] || 0) < 0 ? "bad" : ""}>{signedMoney(allBetBalances[player.id] || 0)}</b><small>provisional</small></div>)}</section>
      <section className="card highlights"><h2>Highlights</h2>{(() => { const leader = [...players].sort((a, b) => (allBetBalances[b.id] || 0) - (allBetBalances[a.id] || 0))[0]; const rabbitLeader = [...players].sort((a, b) => (rabbits.won[b.id] || 0) - (rabbits.won[a.id] || 0))[0]; const skinLeader = [...players].sort((a, b) => (skins.won[b.id] || 0) - (skins.won[a.id] || 0))[0]; return <div className="highlightList">{leader && (allBetBalances[leader.id] || 0) > 0 && <span>🔥 {leader.name} lidera {signedMoney(allBetBalances[leader.id])}</span>}{rabbitLeader && (rabbits.won[rabbitLeader.id] || 0) > 0 && <span>🐇 {rabbitLeader.name} lleva {rabbits.won[rabbitLeader.id]} Conejos</span>}{skinLeader && (skins.won[skinLeader.id] || 0) > 0 && <span>⛳ {skinLeader.name} lleva {skins.won[skinLeader.id]} Skins</span>}{!leader && <span>Aún sin datos.</span>}</div>; })()}</section>
      <section className="card"><h2>Desglose por apuesta</h2><div className="tableWrap"><table><thead><tr><th>Jugador</th><th>Conejos</th><th>Skins</th><th>Unidades</th><th>Foursome</th><th>Bola Amiga</th><th>Pollas</th><th>Personales</th><th>Manuales</th></tr></thead><tbody>{players.map((player) => <tr key={player.id}><td><b>{player.name}</b></td><td>{signedMoney(rabbitBalances[player.id] || 0)}</td><td>{signedMoney(skinBalances[player.id] || 0)}</td><td>{signedMoney(units.balances[player.id] || 0)}</td><td>{signedMoney(foursomes.balances[player.id] || 0)}</td><td>{signedMoney(ballFriend.balances[player.id] || 0)}</td><td>{signedMoney((polla.balances[player.id] || 0) + (miniPolla.balances[player.id] || 0))}</td><td>{signedMoney(personals.balances[player.id] || 0)}</td><td>{signedMoney(manual.balances[player.id] || 0)}</td></tr>)}</tbody></table></div></section>
      <section className="card"><div className="sectionTitle"><div><h2>Leaderboard de la ronda</h2><p>Gross y Neto auditable con el HCP de ronda.</p></div><div className="segmented"><button className={privateBoardMode === "gross" ? "active" : ""} onClick={() => setPrivateBoardMode("gross")}>Gross</button><button className={privateBoardMode === "net" ? "active" : ""} onClick={() => setPrivateBoardMode("net")}>Neto</button></div></div><div className="tableWrap"><table><thead><tr><th>Pos</th><th>Jugador</th><th>HCP</th><th>Gross</th><th>Neto</th><th>+/- Par</th><th>Thru</th></tr></thead><tbody>{[...privateBoard].sort((a, b) => a[privateBoardMode] - b[privateBoardMode]).map((row, index) => <tr key={row.playerId}><td>{index + 1}</td><td><b>{row.name}</b></td><td>{row.handicap ?? "—"}</td><td>{row.gross || "—"}</td><td>{row.net || "—"}</td><td>{row.thru ? `${row.relativeToPar > 0 ? "+" : ""}${row.relativeToPar}` : "—"}</td><td>{row.finished ? "F" : row.thru}</td></tr>)}</tbody></table></div></section>
    </>}

    {tab === "results" && <>
      <section className="hero resultHero"><div><div className="eyebrow">RESULTADO DEL DÍA</div><h1 className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</h1><p>{owner?.name}: apuestas {money(ownerBetResult)} · gastos {money(-ownerExpenseTotal)}</p></div><button className="secondary" onClick={() => setTab("round")}>Editar tarjeta</button></section>

      <section className="roundStats" aria-label="Conteos globales de la ronda">
        <div className="stat"><span>Conejos ganados</span><b>{totalRabbitsWon}</b><small>realmente cobrados</small></div>
        <div className="stat"><span>Skins ganados</span><b>{totalSkinsWon}</b><small>sin carry final</small></div>
        <div className="stat"><span>Unidades registradas</span><b>{units.registeredTotal}</b><small>positivas y copas</small></div>
      </section>

      <section className="card betValues"><h2>Valores de apuesta</h2><div className="valueGrid">
        {bets.rabbits.enabled && <span><b>Conejos</b>{money(bets.rabbits.value)} c/u</span>}
        {bets.skins.enabled && <span><b>Skins</b>{money(bets.skins.value)} c/u</span>}
        {bets.units.enabled && <span><b>Unidades</b>{money(bets.units.value)} por unidad</span>}
        {bets.foursome.enabled && <span><b>Foursome</b>{(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.fixedValue)} fijo` : ""}{bets.foursome.mode === "fixed_points" ? " · " : ""}{(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.pointValue)} punto` : ""}{(bets.foursome.pressureMultiplier || 1) > 1 ? ` · ${bets.foursome.pressureNine === "holes_1_9" ? "H1–9" : "H10–18"} ${bets.foursome.pressureMultiplier}x` : ""}</span>}
        {bets.ballFriend.enabled && <span><b>Bola Amiga</b>{money(bets.ballFriend.value)} por punto</span>}
        {polla.details.map((detail) => <span key={detail.key}><b>{detail.label}</b>{money(detail.value)}</span>)}
        {bets.miniPolla.enabled && <span><b>Mini Polla</b>{money(bets.miniPolla.value)}</span>}
        {personalBets.map((bet) => <span key={bet.id}><b>Personal {owner?.name} vs {bet.rivalMode === "group" ? playerName(bet.rivalPlayerId) : bet.rivalName}</b>{money(bet.baseValue)} base{(bet.pressureMultiplier || 1) > 1 ? ` · ${bet.pressureNine === "holes_1_9" ? "H1–9" : "H10–18"} ${bet.pressureMultiplier}x` : ""}</span>)}
      </div></section>

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
        {foursomes.matches.map((m, i) => <div className="matchLine" key={i}><div><b>H{m.startHole}–{m.endHole}: {playerName(m.basePair[0])}/{playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])}/{playerName(m.opponentPair[1])}</span></div><div className="matchNums"><span>{m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts{m.pressureMultiplier > 1 ? ` · H1–9 ${m.first9PointDiff >= 0 ? "+" : ""}${m.first9PointDiff}${m.pressureNine === "holes_1_9" ? ` x${m.pressureMultiplier}` : ""} · H10–18 ${m.second9PointDiff >= 0 ? "+" : ""}${m.second9PointDiff}${m.pressureNine === "holes_10_18" ? ` x${m.pressureMultiplier}` : ""}` : ""}</span><b className={m.totalMoney >= 0 ? "good" : "bad"}>{m.complete ? money(m.totalMoney) : "Pendiente"}</b></div></div>)}
      </section>}

      {(pollaEnabled || bets.miniPolla.enabled) && <section className="card"><h2>Polla / Mini Polla</h2>
        {[...polla.details, ...miniPolla.details].map((d) => <div className="pollaResult" key={d.key}><div className="row between"><div><b>{d.label}</b><div className="muted">Hoyos {d.holes.join(", ")} · valor {money(d.value)} por jugador</div></div><strong>{d.complete ? (d.winnerIds.length ? d.winnerIds.map(playerName).join(" / ") : "—") : "Pendiente"}</strong></div>{d.complete && <div className="componentResults"><span>Ganador{d.winnerIds.length !== 1 ? "es" : ""}: <b>{d.winnerIds.map(playerName).join(" / ")}</b></span><span>Premio bruto c/u: <b>{money(d.grossPrizePerWinner)}</b></span>{d.winnerIds.length > 1 && <span>Empate: <b>premio dividido</b></span>}</div>}</div>)}
      </section>}

      {renderPersonalLive("Personales")}

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
      <div className="roundActions"><button className="secondary big" onClick={async () => { const snapshot = currentSnapshot(); if (snapshot) await shareRound(snapshot); }}>Compartir ronda</button><button className="secondary big" onClick={resetRound}>Nueva ronda</button><button className="primary big" onClick={saveRound}>Guardar en histórico</button></div>
    </>}

    {tab === "history" && <>
      <section className="hero"><div><div className="eyebrow">HISTÓRICO</div><h1>Lo que realmente cuesta jugar.</h1><p>Apuestas separadas de caddie, alimentos, bebidas y demás gastos.</p></div></section>
      <section className="statsGrid"><div className="stat"><span>Rondas</span><b>{golfStats.rounds}</b><small>{golfStats.coursesPlayed} campo{golfStats.coursesPlayed === 1 ? "" : "s"}</small></div><div className="stat"><span>Promedio Gross</span><b>{golfStats.averageGross === undefined ? "—" : golfStats.averageGross.toFixed(1)}</b><small>{golfStats.scoredRounds ? `${golfStats.scoredRounds} tarjetas completas` : "sin tarjetas completas"}</small></div><div className="stat"><span>Promedio Neto</span><b>{golfStats.averageNet === undefined ? "—" : golfStats.averageNet.toFixed(1)}</b><small>HCP de ronda</small></div><div className="stat"><span>Mejor ronda</span><b>{golfStats.bestRelativeToPar === undefined ? "—" : `${golfStats.bestRelativeToPar > 0 ? "+" : ""}${golfStats.bestRelativeToPar}`}</b><small>contra Par</small></div></section>
      <div className="statsGrid"><div className="stat"><span>Neto este mes</span><b className={sum(monthRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(monthRounds, "netResult"))}</b><small>{monthRounds.length} rondas</small></div><div className="stat"><span>Neto este año</span><b className={sum(yearRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(yearRounds, "netResult"))}</b><small>{yearRounds.length} rondas</small></div><div className="stat"><span>Apuestas año</span><b>{money(sum(yearRounds, "betResult"))}</b><small>sin gastos</small></div><div className="stat"><span>Gasto año</span><b className="bad">{money(-sum(yearRounds, "expenseTotal"))}</b><small>costo real</small></div></div>
      {golfStats.rounds > 0 && <section className="card"><h2>Balance por apuesta</h2><div className="expenseBars">{Object.entries(golfStats.categoryTotals).map(([name, value]) => <div key={name}><span>{name}</span><b className={value > 0 ? "good" : value < 0 ? "bad" : ""}>{signedMoney(value)}</b></div>)}</div></section>}
      <section className="card"><h2>Gastos del año</h2><div className="expenseBars">{([['caddie','Caddie'],['food','Alimentos'],['drinks','Bebidas'],['greenFee','Greenfee'],['cartRental','Renta carrito'],['other','Otros']] as [keyof Expense,string][]).map(([k, label]) => <div key={k}><span>{label}</span><b>{money(expenseByKey(yearRounds, k))}</b></div>)}</div></section>
      <section className="card">
        <h2>Apuestas personales · histórico</h2>
        <p className="muted">Balance acumulado contra cada rival.</p>
        {!personalHistory.length ? <div className="empty">Todavía no hay personales guardadas.</div> : personalHistory.map((r) => <div className="historyRow" key={r.key}><div><b>{r.name}</b><span>{r.rounds} rondas · {r.wins} ganadas · {r.losses} perdidas{r.ties ? ` · ${r.ties} tablas` : ""}</span></div><strong className={r.total > 0 ? "good" : r.total < 0 ? "bad" : ""}>{r.total > 0 ? "+" : ""}{money(r.total)}</strong></div>)}
      </section>
      <section className="card"><div className="sectionTitle"><div><h2>Rondas</h2><p>Más recientes primero. Los campos se guardan como snapshot.</p></div><button className="textButton" onClick={resetRound}>+ Nueva</button></div>{!history.length ? <div className="empty">Todavía no has guardado rondas.</div> : history.map((r) => <div className="historyRound" key={r.id}><div className="historyRow"><div><b>{r.courseName}</b><span>{r.date} · {r.roundHoles || 18} hoyos · apuestas {money(r.betResult)} · gastos {money(r.expenseTotal)}</span></div><strong className={r.netResult >= 0 ? "good" : "bad"}>{money(r.netResult)}</strong></div><div className="historyActions"><button onClick={() => downloadRoundCsv(r)}>CSV</button><button onClick={() => downloadRoundPdf(r)}>PDF</button><button onClick={() => downloadRoundImage(r)}>Imagen</button><button onClick={() => shareRound(r)}>Compartir</button><label className="uploadButton">{r.photoId ? "Cambiar foto" : "Agregar foto de tarjeta"}<input type="file" accept="image/*" capture="environment" onChange={(event) => attachScorecardPhoto(r, event.target.files?.[0])} /></label>{r.photoId && <button onClick={() => viewScorecardPhoto(r)}>Ver tarjeta original</button>}</div></div>)}</section>
    </>}

    {tab === "courses" && <>
      <section className="hero"><div><div className="eyebrow">CAMPO</div><h1>{courseDraft.name}</h1><p>Solo Par y Ventaja/SI. Las rondas históricas no cambian al editar este campo.</p>{courseDraft.updatedAt && <small>Última actualización: {courseDraft.updatedAt}</small>}</div><button className="secondary" onClick={duplicateCourseDraft}>Duplicar campo</button></section>
      <section className="card"><div><label>Nombre del campo</label><input value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} /></div></section>
      {isLaVistaCourse(courseDraft.name) && <section className="card localRulesEditor">
        <div className="sectionTitle"><div><h2>Reglas Locales · La Vista</h2><p>Se guardan con el campo y cada ronda conserva su propio snapshot.</p>{courseDraft.localRulesUpdatedAt && <small>Última actualización: {courseDraft.localRulesUpdatedAt}</small>}</div><button className="secondary" onClick={() => setShowLocalRulesEditor((value) => !value)}>{showLocalRulesEditor ? "Cerrar editor" : "Editar Reglas Locales"}</button></div>
        {showLocalRulesEditor && <>
          <div className="localRuleEditorList">{(courseDraft.localRules || []).map((rule) => <article className="localRuleEditorRow" key={rule.id}>
            <div className="row between"><b>{rule.hole ? `Hoyo ${rule.hole}` : "Regla general"}</b><Toggle on={rule.enabled} label={`Activar ${rule.title}`} onClick={() => setCourseDraft({ ...courseDraft, localRules: (courseDraft.localRules || []).map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: !candidate.enabled } : candidate) })} /></div>
            <div className="grid2"><div><label>Ámbito</label><select value={rule.hole ?? ""} onChange={(event) => setCourseDraft({ ...courseDraft, localRules: (courseDraft.localRules || []).map((candidate) => candidate.id === rule.id ? { ...candidate, hole: event.target.value === "" ? null : Number(event.target.value) } : candidate) })}><option value="">General</option>{Array.from({ length: 18 }, (_, index) => <option key={index + 1} value={index + 1}>Hoyo {index + 1}</option>)}</select></div><div><label>Título</label><input value={rule.title} onChange={(event) => setCourseDraft({ ...courseDraft, localRules: (courseDraft.localRules || []).map((candidate) => candidate.id === rule.id ? { ...candidate, title: event.target.value } : candidate) })} /></div></div>
            <label>Regla local</label><textarea rows={3} value={rule.text} onChange={(event) => setCourseDraft({ ...courseDraft, localRules: (courseDraft.localRules || []).map((candidate) => candidate.id === rule.id ? { ...candidate, text: event.target.value } : candidate) })} />
            <button className="removeCourse" onClick={() => setCourseDraft({ ...courseDraft, localRules: (courseDraft.localRules || []).filter((candidate) => candidate.id !== rule.id) })}>Eliminar regla</button>
          </article>)}</div>
          <button className="secondary big" onClick={() => setCourseDraft({ ...courseDraft, localRules: [...(courseDraft.localRules || []), { id: makeId(), title: "Nueva regla local", text: "", enabled: true, hole: null }] })}>+ Agregar Regla Local</button>
        </>}
      </section>}
      <section className="card"><div className="sectionTitle"><div><h2>Carga rápida</h2><p>Pega 18 ventajas/SI. Par es opcional si ya está correcto en la tabla.</p></div><button className="textButton" onClick={applyQuickCourseData}>Aplicar</button></div><div className="grid2"><div><label>Ventaja / SI (18 números)</label><textarea rows={3} placeholder="5, 17, 7, 1..." value={quickStroke} onChange={(e) => setQuickStroke(e.target.value)} /></div><div><label>Par (opcional, 18 números)</label><textarea rows={3} placeholder="4, 3, 4, 5..." value={quickPars} onChange={(e) => setQuickPars(e.target.value)} /></div></div></section>
      <section className="card"><div className="courseGrid simpleCourseGrid"><div className="courseGridHead">Hoyo</div><div className="courseGridHead">Par</div><div className="courseGridHead">Ventaja</div>{courseDraft.holes.map((h) => <div className="courseGridRow" key={h.number}><b>{h.number}</b><input type="number" min={3} max={6} value={h.par} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, par: Number(e.target.value) } : x) })} /><input type="number" min={1} max={18} value={h.strokeIndex} onChange={(e) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, strokeIndex: Number(e.target.value) } : x) })} /></div>)}</div></section>
      <div className="courseDanger">{courseDraft.name === "La Vista Temporal" && <button className="secondary" onClick={restoreOriginalCourse}>Restablecer configuración original</button>}{!courseDraft.builtIn && <button className="removeCourse" onClick={deleteCourseDraft}>Eliminar campo personalizado</button>}</div>
      <div className="roundActions"><button className="secondary big" onClick={() => setTab("setup")}>Cancelar</button><button className="primary big" onClick={saveCourseDraft}>Guardar campo</button></div>
    </>}

    {tab === "rules" && <RulesPanel courseName={rulesCourseContext} localRules={isLaVistaCourse(rulesCourseContext) ? course.localRules : undefined} localRulesUpdatedAt={isLaVistaCourse(rulesCourseContext) ? course.localRulesUpdatedAt : undefined} />}
    {tab === "pollaLive" && <PollaLivePanel courses={courses} />}

    {frequentGroupDraft && <div className="modalBackdrop" role="presentation"><section className="groupEditorDialog" role="dialog" aria-modal="true" aria-labelledby="edit-group-title" aria-describedby="edit-group-description">
      <div className="groupEditorHeader"><h2 id="edit-group-title">Editar grupo frecuente</h2><p id="edit-group-description">Los cambios se aplicarán únicamente a futuras cargas del grupo.</p></div>
      <label>Nombre del grupo<input value={frequentGroupDraft.name} onChange={(event) => setFrequentGroupDraft((group) => group ? { ...group, name: event.target.value } : group)} /></label>
      <div className="groupEditorSectionTitle"><h3>Integrantes</h3><span>{frequentGroupDraft.players.length}</span></div>
      <div className="groupMemberList">{frequentGroupDraft.players.map((member, index) => <div className="groupMemberEditor" key={index}>
        <label>Jugador {index + 1}<input aria-label={`Nombre del integrante ${index + 1}`} value={member.name} onChange={(event) => editFrequentGroupMember(index, { name: event.target.value })} /></label>
        <label>HCP predeterminado<input aria-label={`HCP del integrante ${index + 1}`} type="number" inputMode="decimal" step="0.1" min={-15} max={54} placeholder="HCP" value={member.handicap ?? ""} onChange={(event) => editFrequentGroupMember(index, { handicap: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <div className="groupMemberActions"><button className="secondary" aria-label={`Subir a ${member.name}`} disabled={index === 0} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, -1) : group)}>↑</button><button className="secondary" aria-label={`Bajar a ${member.name}`} disabled={index === frequentGroupDraft.players.length - 1} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, 1) : group)}>↓</button><button className="dangerGhost" onClick={() => removeMemberFromFrequentGroup(index)}>Quitar</button></div>
      </div>)}</div>
      {!frequentGroupDraft.players.length && <div className="empty">Agrega al menos un integrante para guardar el grupo.</div>}
      <div className="groupMemberAdd"><div className="groupEditorSectionTitle"><h3>Agregar integrante</h3></div>
        <div className="segmented"><button className={groupMemberSource === "frequent" ? "active" : ""} disabled={!frequentPlayers.length} onClick={() => setGroupMemberSource("frequent")}>Jugador frecuente</button><button className={groupMemberSource === "new" ? "active" : ""} onClick={() => setGroupMemberSource("new")}>Jugador nuevo</button></div>
        {groupMemberSource === "frequent" && frequentPlayers.length > 0 && <div className="groupMemberAddRow"><label>Elegir jugador<select value={selectedGroupFrequentPlayerId} onChange={(event) => setSelectedGroupFrequentPlayerId(event.target.value)}>{frequentPlayers.map((player) => <option key={player.id} value={player.id}>{player.name} · HCP {player.handicap ?? "—"}</option>)}</select></label><button className="secondary" disabled={!selectedGroupFrequentPlayerId} onClick={addExistingPlayerToFrequentGroup}>Agregar</button></div>}
        {groupMemberSource === "new" && <><div className="groupMemberNewRow"><label>Nombre<input placeholder="Nombre del jugador" value={newGroupMember.name} onChange={(event) => setNewGroupMember((member) => ({ ...member, name: event.target.value }))} /></label><label>HCP predeterminado<input type="number" inputMode="decimal" step="0.1" min={-15} max={54} placeholder="HCP" value={newGroupMember.handicap ?? ""} onChange={(event) => setNewGroupMember((member) => ({ ...member, handicap: event.target.value === "" ? null : Number(event.target.value) }))} /></label></div><label className="checkRow"><input type="checkbox" checked={saveNewGroupMemberAsFrequent} onChange={(event) => setSaveNewGroupMemberAsFrequent(event.target.checked)} />Guardar como jugador frecuente</label><button className="secondary groupMemberAddButton" disabled={!newGroupMember.name.trim()} onClick={addNewPlayerToFrequentGroup}>Agregar jugador nuevo</button></>}
      </div>
      <div className="dialogActions"><button className="secondary" onClick={resetFrequentGroupEditor}>Cancelar</button><button className="primary" disabled={!frequentGroupDraft.name.trim() || !frequentGroupDraft.players.length || frequentGroupDraft.players.some((member) => !member.name.trim())} onClick={saveFrequentGroupEdit}>Guardar</button></div>
    </section></div>}

    {showDeleteRoundConfirm && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-round-title" aria-describedby="delete-round-description"><h2 id="delete-round-title">¿Eliminar esta ronda?</h2><p id="delete-round-description">Se eliminará la ronda en curso y sus datos capturados. Esta acción no se puede deshacer.</p><div className="dialogActions"><button className="secondary" onClick={() => setShowDeleteRoundConfirm(false)}>Cancelar</button><button className="dangerButton" onClick={deleteActiveRound}>Eliminar ronda</button></div></section></div>}

    {frequentGroupToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-group-title" aria-describedby="delete-group-description"><h2 id="delete-group-title">¿Eliminar grupo frecuente?</h2><p id="delete-group-description">Esto solo eliminará el grupo guardado. No afectará jugadores, rondas ni histórico.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentGroupToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { setFrequentGroups((groups) => resolveFrequentGroupDeletion(groups, frequentGroupToDelete.id, "delete")); if (frequentGroupDraft?.id === frequentGroupToDelete.id) resetFrequentGroupEditor(); setFrequentGroupToDelete(null); }}>Eliminar</button></div></section></div>}

    {frequentPlayerToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-frequent-title" aria-describedby="delete-frequent-description"><h2 id="delete-frequent-title">¿Eliminar jugador frecuente?</h2><p id="delete-frequent-description">Esto solamente lo eliminará de tu lista de jugadores frecuentes. No afectará rondas anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentPlayerToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { setFrequentPlayers((templates) => removeFrequentPlayerTemplate(templates, frequentPlayerToDelete.id)); if (editingFrequentPlayerId === frequentPlayerToDelete.id) setEditingFrequentPlayerId(null); setFrequentPlayerToDelete(null); }}>Eliminar</button></div></section></div>}

    {savedRivalToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-rival-title" aria-describedby="delete-rival-description"><h2 id="delete-rival-title">¿Eliminar rival guardado?</h2><p id="delete-rival-description">Esto solamente lo eliminará de tu lista de rivales para futuras apuestas personales. No afectará rondas ni resultados anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setSavedRivalToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { setSavedPersonalRivals((templates) => removeSavedPersonalRivalTemplate(templates, savedRivalToDelete.id)); if (editingSavedRivalId === savedRivalToDelete.id) { setEditingSavedRivalId(null); setSavedRivalDraft(null); } setSavedRivalToDelete(null); }}>Eliminar</button></div></section></div>}

    {tab !== "welcome" && <nav className="bottomNav"><button onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Inicio)}><span>⌂</span>Inicio</button><button className={tab === "round" || tab === "standings" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Tarjeta)}><span>{roundHoles}</span>Tarjeta</button><button className={tab === "personals" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Personales)}><span>↔</span>Personales</button><button className={tab === "results" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Resultados)}><span>$</span>Resultados</button><button className={tab === "history" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Histórico)}><span>↗</span>Histórico</button><button className={tab === "rules" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Reglas)}><span>⚑</span>Reglas</button></nav>}
  </main>;
}
