"use client";
import "./functional-ux.css";
import { initialBets } from "../lib/new-round-bets";
import { freezeRoundHandicapBases } from "../lib/handicap-base";
import { HandicapBaseControl } from "./components/handicap-base-control";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BallFriendHole,
  BetConfig,
  Course,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  Expense,
  FrequentGroup,
  FrequentPlayer,
  FoursomeSegment,
  HandicapMode,
  HoleScore,
  LobaHole,
  ManualBet,
  MedalPollaConfig,
  PersonalBet,
  Player,
  RoundSnapshot,
  SavedPersonalRival,
  UnitEvent,
} from "../lib/types";
import { BOTTOM_NAV_TARGETS, contrastToggleLabel, rulesContextForRound, type AppTab } from "../lib/app-navigation";
import {
  calculateBallFriend,
  calculateFoursomes,
  calculateManualBets,
  calculateMiniPolla,
  calculateMonkey,
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
  settleBalances,
} from "../lib/engine";
import { PollaLivePanel } from "./components/polla-live-panel";
import { RulesPanel } from "./components/rules-panel";
import { NumericCaptureInput } from "./components/numeric-capture-input";
import { SignedMoneyInput } from "./components/signed-money-input";
import { AccountProvider, useBackyardAccount } from "./components/account-provider";
import { AccountPanel } from "./components/account-panel";
import { BrandLockup } from "./components/brand-lockup";
import { GroupBuilder } from "./components/group-builder";
import { PersonalHistoryPanel } from "./components/personal-history-panel";
import { useScreenNavigation } from "./components/use-screen-navigation";
import { commitHoleCapture, editCapturedScore, holeCapture, isHoleCaptureComplete, type ScoreRows } from "../lib/score-capture";
import { foursomePressure, setFoursomePressure } from "../lib/foursome-config";
import { FoursomeLive } from "./components/foursome-live";
import { PersonalCompact } from "./components/personal-compact";
import { ResultAccordion } from "./components/result-accordion";
import { HistoricalRoundDetail } from "./components/historical-round-detail";
import { FullScorecard } from "./components/full-scorecard";
import { restoreRoundSnapshot, resultSummaryText, upsertRoundSnapshot } from "../lib/round-editing";
import { snapshotPersonalResult } from "../lib/personal-history";
import { createHoleSummarySession, nextHoleDestination, type HoleSummarySession } from "../lib/hole-summary";
import { buildHoleSummary, clearActiveRoundStorage, hasRoundProgress, historicalGolfStats, mergeCoursesPreservingEdits, normalizeRoundDraft, persistRoundHistory, privateLeaderboard, pushUndoState, readStoredJson, resolveHistoricalRoundDeletion, resolvePersonalHistoryDeletion, STORAGE_KEYS, upsertFrequentPlayers } from "../lib/round-utils";
import { monkeyHoleSummary, personalHoleSummary } from "../lib/personal-summary";
import { downloadRoundCsv, downloadRoundImage, downloadRoundPdf, shareRound } from "../lib/round-export";
import { deleteScorecardPhoto, deleteScorecardPhotoCloud, readScorecardPhoto, readScorecardPhotoCloud, saveScorecardPhoto, uploadScorecardPhotoCloud } from "../lib/scorecard-photo";
import { actionableCloudConflicts, CLOUD_TOMBSTONES_KEY, cloudDataFingerprint, collectLocalCloudData, downloadCloudData, findAmbiguousCloudConflicts, isCloudFieldConflict, mergeLocalAndCloud, persistCloudMetadata, resolveAmbiguousCloudConflicts, restoreLocalRoundUi, stableValue, trackLocalCloudEdits, type CloudDataBundle, type CloudDataConflict, recordCloudDeletion, uploadCloudData, withCloudAuthRetry } from "../lib/cloud-sync";
import { describeCloudConflict } from "../lib/cloud-conflict-display";
import { ownsLocalWorkspace, preserveDataConflicts, preserveDraftConflict } from "../lib/account-workspace";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { CloudSyncGate, cloudSyncErrorMessage, syncStatusAfterSkip, type CloudSyncTrigger } from "../lib/cloud-sync-gate";
import { adoptGuestPhotoJobs, flushPhotoQueue, queuePhoto, photoJobs } from "../lib/photo-sync-queue";
import { acknowledgeOfflineBundle, getOfflineDeviceId, markOfflineAttempt, offlineRetryDelayMs, persistOfflineBundle, restoreOfflineWorkspace, writeCloudBundleToStorage } from "../lib/offline-store";
import { PRIVATE_POLLA_LINK_KEY, parsePrivatePollaLink, privatePollaScoreChanges } from "../lib/polla-private-link";
import { enqueuePollaScore } from "../lib/polla-offline";
import { cloneLaVistaLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES_UPDATED_AT, withDefaultLaVistaRules } from "../lib/local-rules";
import { filterHistory, historyYears, MONTH_LABELS } from "../lib/history-filters";
import { priorRabbitStatus, priorSkinsStatus } from "../lib/prior-hole-status";
import { ballFriendScoreResult, ballFriendSetupChipLabel, lobaSetupChipLabel, playerHoleBetLabels, skinHoleNotice } from "../lib/hole-bet-display";
import { buildGeneralResultsTable, pollaDetailBalance, pollaDetailBalances, pollaPositionLabels, summarizeNetUnitQuantities, type ResultCategoryColumn } from "../lib/result-breakdown";
import { collectHoleValidationErrors } from "../lib/hole-validation";
import {
  calculateCounterBet,
  calculateLoba,
  COUNTER_BET_META,
  emptyCounterBetKeepers,
  setCounterQuantity,
} from "../lib/side-bets";
import {
  BallFriendHolePanel,
  CounterBetConfigPanel,
  CounterBetHolePanel,
  CounterBetResults,
  LobaConfigPanel,
  LobaHolePanel,
} from "./components/side-bet-panels";
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
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={onClick} aria-label={label}><span /></button>;
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
  return <div><label>{label}</label><NumericCaptureInput inputMode="decimal" step={step} value={value} onValueChange={(next) => onChange(next ?? 0)} /></div>;
}

function HcpPercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div><label>% HCP</label><NumericCaptureInput inputMode="numeric" min={0} max={100} step={5} value={value} emptyWhenZero={false} onValueChange={(next) => onChange(next === null ? 0 : Math.min(100, Math.max(0, next)))} /></div>;
}

function TrophyIcon({ tone }: { tone: "silver" | "gold" }) {
  return <svg className={`trophyIcon ${tone}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4c0 4-2 7-5 7S7 11 7 7V3Zm0 2H4v2c0 2 1.4 3.5 3.5 3.8M17 5h3v2c0 2-1.4 3.5-3.5 3.8M12 14v4m-4 3h8m-6-3h4" /></svg>;
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
  title, description, config, players, onChange, unavailable, trophy = "gold",
}: {
  title: string;
  description: string;
  config: MedalPollaConfig;
  players: Player[];
  onChange: (config: MedalPollaConfig) => void;
  unavailable?: boolean;
  trophy?: "silver" | "gold";
}) {
  return <div className="betCard">
    <div className="betHead"><div><b className="betTitle"><TrophyIcon tone={trophy} />{title}</b><span>{description}</span></div><Toggle on={config.enabled} onClick={() => onChange({ ...config, enabled: !config.enabled })} /></div>
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
  return <div><label>{label}</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" value={value} onValueChange={(next) => onChange(next ?? 0)} /></div></div>;
}

function GolfBetsApp() {
  const { identity, cloudLinked, cloudStatus, cloudIssues, setCloudStatus, applyCloudPreferences, reportCloudSyncError, clearCloudSyncError, refreshCloudSession } = useBackyardAccount();
  const { tab, setTab, goBack } = useScreenNavigation();
  const [rulesVisited, setRulesVisited] = useState(false);
  useEffect(() => { if (tab === "rules") setRulesVisited(true); }, [tab]);
  const [personalDetailId, setPersonalDetailId] = useState<string | null>(null);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [editingRound, setEditingRound] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [pendingRoundAction, setPendingRoundAction] = useState<{ message: string; run: () => void } | null>(null);
  const [pendingCloudConflict, setPendingCloudConflict] = useState<{ local: CloudDataBundle; cloud: CloudDataBundle; conflicts: CloudDataConflict[] } | null>(null);
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
  const [scoreEdits, setScoreEdits] = useState<ScoreRows>({});
  const [scorecardScale, setScorecardScale] = useState(100);
  const finishRound = useRef<() => void>(() => undefined);
  const [unitEvents, setUnitEvents] = useState<UnitEvent[]>([]);
  const [counterBetEvents, setCounterBetEvents] = useState<CounterBetEvent[]>([]);
  const [counterBetKeepers, setCounterBetKeepers] = useState<CounterBetKeepers>(emptyCounterBetKeepers);
  const [lobaHoles, setLobaHoles] = useState<Record<number, LobaHole>>({});
  const [ballFriendSetup, setBallFriendSetup] = useState<Record<number, BallFriendHole>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
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
  const offlineDeviceId = useRef("");
  const [holeSummary, setHoleSummary] = useState<string[]>([]);
  const [holeValidationErrors, setHoleValidationErrors] = useState<string[]>([]);
  const [holeBetEditor, setHoleBetEditor] = useState<"loba" | "ballFriend" | null>(null);
  const [resultsView, setResultsView] = useState<"players" | "general">("general");
  const [highContrast, setHighContrast] = useState(true);
  const [roundClosed, setRoundClosed] = useState(false);
  const [historyYear, setHistoryYear] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
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
  const [editingFrequentPlayerId, setEditingFrequentPlayerId] = useState<string | null>(null);
  const [frequentPlayerDraft, setFrequentPlayerDraft] = useState<{ name: string; handicap: number | null }>({ name: "", handicap: null });
  const [frequentPlayerToDelete, setFrequentPlayerToDelete] = useState<FrequentPlayer | null>(null);
  const [editingSavedRivalId, setEditingSavedRivalId] = useState<string | null>(null);
  const [savedRivalDraft, setSavedRivalDraft] = useState<SavedPersonalRival | null>(null);
  const [savedRivalToDelete, setSavedRivalToDelete] = useState<SavedPersonalRival | null>(null);
  const [historicalRoundToDelete, setHistoricalRoundToDelete] = useState<RoundSnapshot | null>(null);
  const [personalHistoryToDelete, setPersonalHistoryToDelete] = useState<{ roundId: string; resultIndex: number; rivalName: string } | null>(null);
  const [rulesCourseContext, setRulesCourseContext] = useState("");
  const undoStack = useRef<Array<{ scores: Record<number, HoleScore>; scoreEdits: ScoreRows; unitEvents: UnitEvent[]; counterBetEvents: CounterBetEvent[]; counterBetKeepers: CounterBetKeepers; lobaHoles: Record<number, LobaHole>; manualBets: ManualBet[]; ballFriendSetup: Record<number, BallFriendHole> }>>([]);
  const holeSummarySession = useRef<HoleSummarySession | null>(null);
  const [holeSummaryPaused, setHoleSummaryPaused] = useState(false);
  const flushLocalState = useRef<(() => boolean) | null>(null);
  const requestCloudSync = useRef<(() => void) | null>(null);
  const saveAfterNumericCommit = useRef(false);
  const latestSaveAndAdvance = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (tab !== "round") {
      holeSummarySession.current?.dispose();
      holeSummarySession.current = null; setHoleSummaryPaused(false); setHoleSummary([]);
    }
  }, [tab]);
  const liveIdentity = useRef(identity);
  useEffect(() => { liveIdentity.current = identity; }, [identity]);
  const hadLocalPreferences = useRef(false);

  const order = useMemo(() => playOrder(startHole).slice(0, roundHoles), [startHole, roundHoles]);
  const holeNumber = order[currentIndex];
  const hole = course.holes.find((h) => h.number === holeNumber) ?? course.holes[0];
  const courseNames: string[] = useMemo(() => Array.from(new Set<string>(courses.map((c) => c.name))).sort((a, b) => a.localeCompare(b)), [courses]);
  const privateBoard = useMemo(() => privateLeaderboard(course, players, scores, order), [course, players, scores, order]);
  const completedHoles = useMemo(() => new Set(order.filter(number => players.length > 0 && players.every(player => typeof scores[number]?.[player.id] === "number"))), [order, players, scores]);
  const scoreDraft = useMemo(() => holeCapture(scores, scoreEdits, hole, players), [scores, scoreEdits, hole, players]);
  const scoreCaptureComplete = isHoleCaptureComplete(scores, scoreEdits, holeNumber, players);
  const liveScores = useMemo(() => scoreCaptureComplete ? { ...scores, [holeNumber]: scoreDraft } : scores, [scoreCaptureComplete, scores, holeNumber, scoreDraft]);
  const liveCompletedHoles = useMemo(() => new Set([...completedHoles, ...(scoreCaptureComplete ? [holeNumber] : [])]), [completedHoles, scoreCaptureComplete, holeNumber]);

  const applyDraft = useCallback((value: unknown, options: { preserveLocalUi?: boolean } = {}) => {
    if (!options.preserveLocalUi) {
      holeSummarySession.current?.dispose();
      holeSummarySession.current = null; setHoleSummaryPaused(false); setHoleSummary([]);
    }
    const draft = normalizeRoundDraft(value);
    setRoundClosed(false);
    setDraftAvailable(hasRoundProgress(draft));
    if (!draft) {
      setPlayers([]); setOwnerId(""); setScores({}); setScoreEdits({}); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({});
      setPersonalBets([]); setManualBets([]); setExpenses(emptyExpenses); setBets(initialBets([]));
      setStartHole(1); setRoundHoles(18); setSegments(segmentDefinitions(playOrder(1), 6));
      if (!options.preserveLocalUi) setCurrentIndex(0);
      setRoundId(makeId()); setRoundDate(localDateMexico());
    }
      if (draft) {
        if (draft.course) setCourse(withDefaultLaVistaRules(draft.course));
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
            foursome: { ...defaults.foursome, ...(draft.bets.foursome || {}), handicapMethod: draft.bets.foursome?.handicapMethod || "configured", baseMode: draft.bets.foursome?.baseMode },
            polla: normalizePolla(draft.bets.polla, draftPlayerIds),
            miniPolla: { ...defaults.miniPolla, ...(draft.bets.miniPolla || {}) },
            vipers: { ...defaults.vipers, ...(draft.bets.vipers || {}) },
            camels: { ...defaults.camels, ...(draft.bets.camels || {}) },
            fish: { ...defaults.fish, ...(draft.bets.fish || {}) },
            loba: { ...defaults.loba, ...(draft.bets.loba || {}) },
          });
        }
        if (draft.segments) setSegments(draft.segments);
        if (draft.personalBets) setPersonalBets(draft.personalBets.map((b: any) => ({
          id: b.id || makeId(),
          rivalMode: b.rivalMode || "group",
          rivalPlayerId: b.rivalPlayerId,
          externalRivalId: b.externalRivalId,
          rivalHandicap: b.rivalHandicap ?? null,
          nassauVersion: 2,
          carryEnabled: b.carryEnabled ?? false,
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
        setScoreEdits(draft.scoreEdits || {});
        if (draft.unitEvents) setUnitEvents(draft.unitEvents);
        setCounterBetEvents(Array.isArray(draft.counterBetEvents) ? draft.counterBetEvents : []);
        setCounterBetKeepers({ ...emptyCounterBetKeepers(), ...(draft.counterBetKeepers || {}) });
        setLobaHoles(draft.lobaHoles && typeof draft.lobaHoles === "object" ? draft.lobaHoles : {});
        if (draft.ballFriendSetup) setBallFriendSetup(draft.ballFriendSetup);
        if (draft.expenses) setExpenses(normalizeExpenses(draft.expenses));
        if (draft.roundId) setRoundId(draft.roundId);
        if (draft.roundDate) setRoundDate(draft.roundDate);
        if (!options.preserveLocalUi && Number.isInteger(draft.currentIndex)) setCurrentIndex(Math.max(0, Math.min((draft.roundHoles || 18) - 1, draft.currentIndex)));
      }
    undoStack.current = []; setUndoCount(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    const hydrate = async () => {
      try {
        offlineDeviceId.current = await getOfflineDeviceId();
        if (!cancelled && ownsLocalWorkspace(localStorage, identity.userId)) {
          await restoreOfflineWorkspace(identity.userId, localStorage, identity.defaultHandicap);
        }
      } catch {
        if (!cancelled) setSaveStatus("error");
      }
      if (cancelled || !ownsLocalWorkspace(localStorage, identity.userId)) return;
      hadLocalPreferences.current = localStorage.getItem(STORAGE_KEYS.contrast) !== null;
      const savedCourses = readStoredJson<unknown>(localStorage, STORAGE_KEYS.courses, null);
      const savedHistory = readStoredJson<unknown>(localStorage, STORAGE_KEYS.history, null);
      const savedRivals = readStoredJson<unknown>(localStorage, STORAGE_KEYS.rivals, null);
      const draft = normalizeRoundDraft(readStoredJson<unknown>(localStorage, STORAGE_KEYS.draft, null));
      const savedFrequentPlayers = readStoredJson<unknown>(localStorage, STORAGE_KEYS.frequentPlayers, []);
      const savedFrequentGroups = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
      try {
        setCourses(mergeDefaultCourses(Array.isArray(savedCourses) ? savedCourses as Course[] : null));
        if (Array.isArray(savedHistory)) setHistory(savedHistory.map((r: any) => ({ ...r, expenses: normalizeExpenses(r.expenses) })));
        if (Array.isArray(savedRivals)) setSavedPersonalRivals(savedRivals);
        if (Array.isArray(savedFrequentPlayers)) setFrequentPlayers(savedFrequentPlayers);
        setFrequentGroups(savedFrequentGroups);
        setHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== "false");
        setDraftAvailable(hasRoundProgress(draft));
        applyDraft(draft);
      } catch { /* keep safe defaults for structurally invalid legacy data */ }
      const entry = new URLSearchParams(window.location.search);
      if (entry.has("polla")) setTab("pollaLive");
      else if (entry.get("screen") === "account") setTab("account");
      setHydrated(true);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [identity.userId, identity.defaultHandicap, setTab, applyDraft]);

  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus("saving");
    const persist = () => {
      if (!ownsLocalWorkspace(localStorage, identity.userId)) return false;
      try {
        const draft = { version: 4, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores, scoreEdits, unitEvents, counterBetEvents, counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, currentIndex };
        const activeDraft = roundClosed ? null : draft;
        trackLocalCloudEdits(localStorage, activeDraft, { highContrast, language: "es-MX", notificationsEnabled: false, defaultHandicap: identity.defaultHandicap });
        localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(courses));
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
        localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(savedPersonalRivals));
        localStorage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(frequentPlayers));
        localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(frequentGroups));
        localStorage.setItem(STORAGE_KEYS.contrast, String(highContrast));
        localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(!roundClosed && hasRoundProgress(draft) ? draft : null));
        setDraftAvailable(!roundClosed && hasRoundProgress({ players, scores, currentIndex }));
        const offline = collectLocalCloudData(localStorage, identity.defaultHandicap, hadLocalPreferences.current);
        offline.deviceId = offlineDeviceId.current;
        void persistOfflineBundle(identity.userId, offline, identity.mode === "authenticated" && cloudLinked)
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("error"));
        return true;
      } catch {
        setSaveStatus("error");
        return false;
      }
    };
    flushLocalState.current = persist;
    const timer = window.setTimeout(persist, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, identity.userId, identity.mode, identity.defaultHandicap, cloudLinked, courses, history, savedPersonalRivals, frequentPlayers, frequentGroups, highContrast, roundClosed, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores, scoreEdits, unitEvents, counterBetEvents, counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, currentIndex]);

  useEffect(() => {
    if (!hydrated) return;
    const flush = () => flushLocalState.current?.();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [hydrated]);

  const applyCloudBundle = useCallback((data: CloudDataBundle, local: CloudDataBundle) => {
    const changed = (left: unknown, right: unknown) => JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right));
    if (changed(local.activeDraft, data.activeDraft)) {
      preserveDraftConflict(localStorage, local.activeDraft);
      applyDraft(data.activeDraft, { preserveLocalUi: true });
      setFeedback("Ronda actualizada desde la nube. La versión local anterior se conservó en este dispositivo.");
    }
    const mergedCourses = mergeDefaultCourses(data.courses);
    if (changed(local.courses, data.courses)) setCourses(mergedCourses);
    if (changed(local.history, data.history)) setHistory(data.history.map(round => ({ ...round, expenses: normalizeExpenses(round.expenses) })));
    if (changed(local.rivals, data.rivals)) setSavedPersonalRivals(data.rivals);
    if (changed(local.frequentPlayers, data.frequentPlayers)) setFrequentPlayers(data.frequentPlayers);
    if (changed(local.frequentGroups, data.frequentGroups)) setFrequentGroups(data.frequentGroups);
    setHighContrast(data.preferences.highContrast);
    applyCloudPreferences(data.preferences);
    localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(mergedCourses));
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(data.history));
    localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(data.rivals));
    localStorage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(data.frequentPlayers));
    localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(data.frequentGroups));
    localStorage.setItem(STORAGE_KEYS.contrast, String(data.preferences.highContrast));
    const localDraftWithNavigation = restoreLocalRoundUi(data.activeDraft, { currentIndex: currentIndexRef.current });
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(localDraftWithNavigation));
    localStorage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify(data.tombstones));
    persistCloudMetadata(localStorage, data);
    hadLocalPreferences.current = true;
    const applied = collectLocalCloudData(localStorage, data.preferences.defaultHandicap, true);
    applied.deviceId = offlineDeviceId.current;
    return cloudDataFingerprint(applied);
  }, [applyCloudPreferences, applyDraft]);

  useEffect(() => {
    if (!hydrated || identity.mode !== "authenticated" || !cloudLinked) return;
    const userId = identity.userId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scheduledTrigger: CloudSyncTrigger = "mount";
    let failedAttempts = 0;
    let nextAutoAttemptAt = 0;
    const gate = new CloudSyncGate();
    const debug = (event: string, trigger?: CloudSyncTrigger) => {
      if (process.env.NODE_ENV === "development") console.info("[cloud-sync]", event, { trigger, user: userId.slice(0, 8) });
    };
    const current = () => !cancelled && ownsLocalWorkspace(localStorage, userId) && liveIdentity.current.userId === userId && Boolean(liveIdentity.current.accessToken);
    const read = () => {
      if (!flushLocalState.current?.()) throw new Error("No se pudo guardar el estado local; no se enviaron datos incompletos.");
      const data = collectLocalCloudData(localStorage, liveIdentity.current.defaultHandicap, hadLocalPreferences.current);
      data.deviceId = offlineDeviceId.current;
      return data;
    };
    const schedule = (trigger: CloudSyncTrigger = "local") => {
      if (!current()) return;
      clearTimeout(timer);
      const priority: Record<CloudSyncTrigger, number> = { local: 0, visible: 1, online: 2, mount: 3, manual: 4 };
      if (priority[trigger] > priority[scheduledTrigger]) scheduledTrigger = trigger;
      setCloudStatus("pending");
      timer = setTimeout(() => {
        const next = scheduledTrigger;
        scheduledTrigger = "local";
        void sync(next);
      }, trigger === "manual" ? 0 : 1_500);
    };
    const sync = async (trigger: CloudSyncTrigger) => {
      if (!current()) return;
      if (!navigator.onLine) { setCloudStatus("offline"); return; }
      if (trigger !== "manual" && Date.now() < nextAutoAttemptAt) { setCloudStatus("error"); return; }
      let fingerprint = "";
      let queued: CloudSyncTrigger | null = null;
      try {
        const initial = read();
        fingerprint = cloudDataFingerprint(initial);
        const decision = gate.begin(fingerprint, trigger);
        const skippedStatus = syncStatusAfterSkip(decision);
        if (skippedStatus) { setCloudStatus(skippedStatus); return; }
        if (decision !== "run") return;
        debug("start", trigger);
        let appliedFingerprint = "";
        const completed = await runCloudSyncCycle({
          read, current, status: setCloudStatus,
          download: () => withCloudAuthRetry(downloadCloudData, liveIdentity.current.accessToken || "", refreshCloudSession),
          upload: data => withCloudAuthRetry(token => uploadCloudData(data, token), liveIdentity.current.accessToken || "", refreshCloudSession),
          conflicts: (local, cloud) => {
            const conflicts = actionableCloudConflicts(findAmbiguousCloudConflicts(local, cloud));
            if (!conflicts.length) return false;
            preserveDataConflicts(localStorage, conflicts);
            setPendingCloudConflict({ local, cloud, conflicts });
            setFeedback("Encontramos cambios simultáneos. Elige qué copia conservar; ninguna fue eliminada.");
            return true;
          },
          media: async data => {
            adoptGuestPhotoJobs(localStorage, userId);
            for (const round of data.history.filter(item => item.photoId)) {
              if (!current()) throw new Error("Sync cancelled");
              const marker = `backyard-photo-uploaded-v1:${userId}:${round.photoId}`;
              if (!localStorage.getItem(marker) && !photoJobs(localStorage).some(job => job.userId === userId && job.roundId === round.id)) {
                const blob = await readScorecardPhoto(round.photoId!);
                if (!current()) throw new Error("Sync cancelled");
                if (blob) queuePhoto(localStorage, { userId, roundId: round.id, photoId: round.photoId!, operation: "upload", revision: makeId() });
              }
            }
            await flushPhotoQueue(localStorage, userId, data, {
              read: readScorecardPhoto,
              upload: async (roundId, photoId, blob) => {
                const result = await uploadScorecardPhotoCloud(userId, roundId, blob, photoId);
                if (result && current()) localStorage.setItem(`backyard-photo-uploaded-v1:${userId}:${photoId}`, "true");
                return result;
              },
              remove: roundId => deleteScorecardPhotoCloud(userId, roundId),
            }, current);
          },
          apply: (data: CloudDataBundle) => { appliedFingerprint = applyCloudBundle(data, read()); },
          retry: () => { queued = "local"; },
        });
        if (completed) {
          const confirmedFingerprint = appliedFingerprint || cloudDataFingerprint(read());
          queued = gate.success(confirmedFingerprint);
          void acknowledgeOfflineBundle(userId, confirmedFingerprint);
          failedAttempts = 0; nextAutoAttemptAt = 0;
          clearCloudSyncError();
          debug("finish", trigger);
        } else {
          queued = gate.pending() || queued;
          debug("local-change-during-sync", trigger);
        }
      } catch (error) {
        gate.failure(fingerprint);
        if (isCloudFieldConflict(error) && current()) {
          try {
            const local = read();
            const cloud = await withCloudAuthRetry(downloadCloudData, liveIdentity.current.accessToken || "", refreshCloudSession);
            const discovered = actionableCloudConflicts(findAmbiguousCloudConflicts(local, cloud));
            const serverConflicts = actionableCloudConflicts(error.conflicts);
            const conflicts = discovered.length ? discovered : serverConflicts;
            if (conflicts.length) {
              preserveDataConflicts(localStorage, conflicts);
              setPendingCloudConflict({ local, cloud, conflicts });
              reportCloudSyncError(error);
              setFeedback("Encontramos cambios simultáneos solo en los datos indicados. Los demás cambios compatibles se conservaron.");
              setCloudStatus("pending");
              return;
            }
            // The write raced with a compatible field. Rebase on the latest
            // canonical copy, keep local navigation, and retry immediately.
            const rebased = mergeLocalAndCloud(local, cloud);
            applyCloudBundle(rebased, local);
            clearCloudSyncError();
            setCloudStatus("pending");
            window.setTimeout(() => window.dispatchEvent(new Event("backyard-sync-retry")), 0);
            return;
          } catch (recoveryError) {
            if (current()) reportCloudSyncError(recoveryError);
          }
        }
        failedAttempts += 1;
        nextAutoAttemptAt = Date.now() + offlineRetryDelayMs(failedAttempts);
        const message = cloudSyncErrorMessage(error);
        if (current() && message) reportCloudSyncError(error);
        if (current()) void markOfflineAttempt(userId, message || "Sincronización cancelada");
        debug("error", trigger);
      } finally {
        if (queued && current()) schedule(queued);
      }
    };
    requestCloudSync.current = () => schedule("local");
    const onOnline = () => schedule("online");
    const onOffline = () => { if (current()) setCloudStatus("offline"); };
    const onRetry = () => schedule("manual");
    const onVisible = () => { if (document.visibilityState === "visible") schedule("visible"); };
    const onFocus = () => schedule("visible");
    // Realtime is intentionally not required for round ownership sync. A
    // bounded foreground refresh makes two open devices converge without
    // maintaining a fragile channel while a player is moving on the course.
    const foregroundRefresh = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) schedule("visible");
    }, 45_000);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("backyard-sync-retry", onRetry);
    document.addEventListener("visibilitychange", onVisible);
    schedule("mount");
    return () => {
      cancelled = true; gate.cancel(); clearTimeout(timer); requestCloudSync.current = null;
      window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus); window.clearInterval(foregroundRefresh);
      window.removeEventListener("backyard-sync-retry", onRetry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, identity.mode, identity.userId, identity.accessToken, cloudLinked, setCloudStatus, applyCloudBundle, reportCloudSyncError, clearCloudSyncError, refreshCloudSession]);

  useEffect(() => {
    requestCloudSync.current?.();
  }, [courses, history, savedPersonalRivals, frequentPlayers, frequentGroups, highContrast, course, startHole, roundHoles, players, ownerId, bets, segments, personalBets, manualBets, scores, scoreEdits, unitEvents, counterBetEvents, counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, identity.defaultHandicap]);

  function resolveCloudConflict(choice: "local" | "cloud") {
    if (!pendingCloudConflict) return;
    const [conflict, ...remaining] = pendingCloudConflict.conflicts;
    if (!conflict) { setPendingCloudConflict(null); return; }
    const resolved = resolveAmbiguousCloudConflicts(pendingCloudConflict.local, pendingCloudConflict.cloud, [conflict], choice);
    if (remaining.length) {
      setPendingCloudConflict({ ...pendingCloudConflict, local: resolved, conflicts: remaining });
      return;
    }
    const mergedCourses = mergeDefaultCourses(resolved.courses);
    resolved.courses = mergedCourses;
    writeCloudBundleToStorage(localStorage, resolved);
    setCourses(mergedCourses);
    setHistory(resolved.history.map(round => ({ ...round, expenses: normalizeExpenses(round.expenses) })));
    setSavedPersonalRivals(resolved.rivals);
    setFrequentPlayers(resolved.frequentPlayers);
    setFrequentGroups(resolved.frequentGroups);
    setHighContrast(resolved.preferences.highContrast);
    applyCloudPreferences(resolved.preferences);
    applyDraft(resolved.activeDraft, { preserveLocalUi: true });
    setPendingCloudConflict(null);
    setCloudStatus(navigator.onLine ? "pending" : "offline");
    setFeedback(choice === "local" ? "Conservamos la copia de este dispositivo. Se sincronizará sin borrar la otra versión auditada." : "Conservamos la copia de la nube. La versión local anterior quedó auditada en este dispositivo.");
    requestCloudSync.current?.();
  }

  useEffect(() => {
    if (!hydrated) return;
    const defs = segmentDefinitions(order, bets.foursome.segmentSize);
    setSegments((old) => defs.map((d, i) => ({ ...d, basePair: old[i]?.basePair ?? [] })));
  }, [hydrated, order, bets.foursome.segmentSize]);

  useEffect(() => {
    if (!hydrated) return;
    const valid = new Set(players.map((p) => p.id));
    const sanitize = (ids: string[]) => ids.filter((id) => valid.has(id));
    setBets((b) => ({
      ...b,
      rabbits: { ...b.rabbits, participantIds: sanitize(b.rabbits.participantIds) },
      skins: { ...b.skins, participantIds: sanitize(b.skins.participantIds) },
      units: { ...b.units, participantIds: sanitize(b.units.participantIds) },
      monkey: b.monkey ? { ...b.monkey, participantIds: sanitize(b.monkey.participantIds) } : undefined,
      foursome: { ...b.foursome, participantIds: sanitize(b.foursome.participantIds) },
      ballFriend: { ...b.ballFriend, participantIds: sanitize(b.ballFriend.participantIds) },
      polla: {
        first9: { ...b.polla.first9, participantIds: sanitize(b.polla.first9.participantIds) },
        second9: { ...b.polla.second9, participantIds: sanitize(b.polla.second9.participantIds) },
        total18: { ...b.polla.total18, participantIds: sanitize(b.polla.total18.participantIds) },
      },
      miniPolla: { ...(b.miniPolla ?? initialBets(players.map((p) => p.id)).miniPolla), participantIds: sanitize((b.miniPolla ?? initialBets(players.map((p) => p.id)).miniPolla).participantIds) },
      vipers: { ...(b.vipers ?? initialBets(players.map((p) => p.id)).vipers), participantIds: sanitize((b.vipers ?? initialBets(players.map((p) => p.id)).vipers).participantIds) },
      camels: { ...(b.camels ?? initialBets(players.map((p) => p.id)).camels), participantIds: sanitize((b.camels ?? initialBets(players.map((p) => p.id)).camels).participantIds) },
      fish: { ...(b.fish ?? initialBets(players.map((p) => p.id)).fish), participantIds: sanitize((b.fish ?? initialBets(players.map((p) => p.id)).fish).participantIds) },
      loba: { ...(b.loba ?? initialBets(players.map((p) => p.id)).loba), participantIds: sanitize((b.loba ?? initialBets(players.map((p) => p.id)).loba).participantIds) },
    }));
    if (!valid.has(ownerId)) setOwnerId(players[0]?.id ?? "");
  }, [hydrated, players, ownerId]);

  // Par is a suggestion, never a played score until explicit confirmation.
  // Existing numeric drafts remain intact: old versions did not record provenance.

  useEffect(() => () => { holeSummarySession.current?.dispose(); }, []);

  const rabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, order), [course, scores, players, bets.rabbits, order]);
  const skins = useMemo(() => calculateSkins(course, scores, players, bets.skins, order), [course, scores, players, bets.skins, order]);
  const units = useMemo(() => calculateUnits(players, unitEvents, bets.units, course, scores, order), [players, unitEvents, bets.units, course, scores, order]);
  const monkey = useMemo(() => calculateMonkey(course, scores, players, bets.monkey, order), [course, scores, players, bets.monkey, order]);
  const foursomes = useMemo(() => calculateFoursomes(course, scores, players, bets.foursome, segments, order), [course, scores, players, bets.foursome, segments, order]);
  const ballFriend = useMemo(() => calculateBallFriend(course, scores, players, bets.ballFriend, ballFriendSetup, order), [course, scores, players, bets.ballFriend, ballFriendSetup, order]);
  const personals = useMemo(() => calculatePersonalBets(personalBets, ownerId, players, course, scores, order), [personalBets, ownerId, players, course, scores, order]);
  const polla = useMemo(() => calculatePolla(course, scores, players, bets.polla, order), [course, scores, players, bets.polla, order]);
  const miniPolla = useMemo(() => calculateMiniPolla(course, scores, players, bets.miniPolla, order), [course, scores, players, bets.miniPolla, order]);
  const manual = useMemo(() => calculateManualBets(players, manualBets), [players, manualBets]);
  const vipers = useMemo(() => calculateCounterBet("vipers", players, bets.vipers, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.vipers, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const camels = useMemo(() => calculateCounterBet("camels", players, bets.camels, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.camels, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const fish = useMemo(() => calculateCounterBet("fish", players, bets.fish, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.fish, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const loba = useMemo(() => calculateLoba(course, scores, players, bets.loba, lobaHoles, order, completedHoles), [course, scores, players, bets.loba, lobaHoles, order, completedHoles]);
  const liveRabbits = useMemo(() => calculateRabbits(course, liveScores, players, bets.rabbits, order), [course, liveScores, players, bets.rabbits, order]);
  const liveSkins = useMemo(() => calculateSkins(course, liveScores, players, bets.skins, order), [course, liveScores, players, bets.skins, order]);
  const liveUnits = useMemo(() => calculateUnits(players, unitEvents, bets.units, course, liveScores, order), [players, unitEvents, bets.units, course, liveScores, order]);
  const liveMonkey = useMemo(() => calculateMonkey(course, liveScores, players, bets.monkey, order), [course, liveScores, players, bets.monkey, order]);
  const liveFoursomes = useMemo(() => calculateFoursomes(course, liveScores, players, bets.foursome, segments, order), [course, liveScores, players, bets.foursome, segments, order]);
  const liveBallFriend = useMemo(() => calculateBallFriend(course, liveScores, players, bets.ballFriend, ballFriendSetup, order), [course, liveScores, players, bets.ballFriend, ballFriendSetup, order]);
  const livePersonals = useMemo(() => calculatePersonalBets(personalBets, ownerId, players, course, liveScores, order), [personalBets, ownerId, players, course, liveScores, order]);
  const liveLoba = useMemo(() => calculateLoba(course, liveScores, players, bets.loba, lobaHoles, order, liveCompletedHoles), [course, liveScores, players, bets.loba, lobaHoles, order, liveCompletedHoles]);
  const priorOrder = useMemo(() => order.slice(0, currentIndex), [order, currentIndex]);
  const priorRabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, priorOrder), [course, scores, players, bets.rabbits, priorOrder]);
  const priorSkins = useMemo(() => calculateSkins(course, scores, players, bets.skins, priorOrder), [course, scores, players, bets.skins, priorOrder]);

  const rabbitBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.rabbits.participantIds), rabbits.won, bets.rabbits.value), [players, bets.rabbits, rabbits.won]);
  const skinBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.skins.participantIds), skins.won, bets.skins.value), [players, bets.skins, skins.won]);
  const allBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, personals.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, personals.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
  const generalBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
  const liveBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.provisionalBalances, ballFriend.balances, polla.balances, miniPolla.balances, personals.provisionalBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.provisionalBalances, ballFriend.balances, polla.balances, miniPolla.balances, personals.provisionalBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
  const settlementTransfers = useMemo(() => settleBalances(allBetBalances), [allBetBalances]);
  const settlementDifference = useMemo(() => Object.values(allBetBalances).reduce((sum, amount) => sum + amount, 0), [allBetBalances]);
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
  const unitQuantitySummary = useMemo(
    () => summarizeNetUnitQuantities(units.net, players.map(player => player.id)),
    [units.net, players],
  );
  const pollaEnabled = bets.polla.first9.enabled || bets.polla.second9.enabled || bets.polla.total18.enabled;
  const pollaFirstDetail = polla.details.find(detail => detail.key === "first9");
  const pollaSecondDetail = polla.details.find(detail => detail.key === "second9");
  const pollaNassauDetail = polla.details.find(detail => detail.key === "total18");
  const miniPollaDetail = miniPolla.details.find(detail => detail.key === "mini");
  const pollaFirstBalances = useMemo(() => pollaDetailBalances(pollaFirstDetail), [pollaFirstDetail]);
  const pollaSecondBalances = useMemo(() => pollaDetailBalances(pollaSecondDetail), [pollaSecondDetail]);
  const pollaNassauBalances = useMemo(() => pollaDetailBalances(pollaNassauDetail), [pollaNassauDetail]);
  const miniPollaComponentBalances = useMemo(() => pollaDetailBalances(miniPollaDetail), [miniPollaDetail]);

  const categoryResults = useMemo(() => ({
    Conejos: rabbitBalances[ownerId] ?? 0,
    Skins: skinBalances[ownerId] ?? 0,
    Unidades: units.balances[ownerId] ?? 0,
    ...(bets.monkey?.enabled ? { Monkey: monkey.balances[ownerId] ?? 0 } : {}),
    Foursome: foursomes.balances[ownerId] ?? 0,
    "Bola Amiga": ballFriend.balances[ownerId] ?? 0,
    "Polla 1ª vuelta": pollaFirstBalances[ownerId] ?? 0,
    "Polla 2ª vuelta": pollaSecondBalances[ownerId] ?? 0,
    "Polla Nassau": pollaNassauBalances[ownerId] ?? 0,
    "Mini Polla": miniPolla.balances[ownerId] ?? 0,
    "🐍 Víboras": vipers.balances[ownerId] ?? 0,
    "🐫 Camellos": camels.balances[ownerId] ?? 0,
    "🐟 Peces": fish.balances[ownerId] ?? 0,
    "🐺 Loba": loba.balances[ownerId] ?? 0,
    Personales: personals.balances[ownerId] ?? 0,
    Manuales: manual.balances[ownerId] ?? 0,
  }), [rabbitBalances, skinBalances, units.balances, monkey.balances, bets.monkey?.enabled, foursomes.balances, ballFriend.balances, pollaFirstBalances, pollaSecondBalances, pollaNassauBalances, miniPolla.balances, vipers.balances, camels.balances, fish.balances, loba.balances, personals.balances, manual.balances, ownerId]);

  const generalResultCategories = useMemo<ResultCategoryColumn[]>(() => [
    { key: "rabbits", label: "🐇 Conejos", balances: rabbitBalances, active: bets.rabbits.enabled, played: rabbits.events.length > 0, quantityTotal: totalRabbitsWon, quantities: rabbits.won, quantityLabel: "conejos" },
    { key: "skins", label: "⛳ Skins", balances: skinBalances, active: bets.skins.enabled, played: skins.events.length > 0, quantityTotal: totalSkinsWon, quantities: skins.won, quantityLabel: "skins" },
    { key: "units", label: "📏 Unidades", balances: units.balances, active: bets.units.enabled, played: completedHoles.size > 0, quantityTotal: unitQuantitySummary.total, quantities: unitQuantitySummary.quantities, quantityLabel: "unidades", signedQuantity: true },
    { key: "monkey", label: "🐒 Monkey", balances: monkey.balances, active: Boolean(bets.monkey?.enabled), played: monkey.details.length > 0, quantities: monkey.points, quantityLabel: "puntos" },
    { key: "foursome", label: "Foursome", balances: foursomes.balances, active: bets.foursome.enabled, played: foursomes.matches.some(match => match.completedHoles > 0) },
    { key: "ballFriend", label: "⚪🤝 Bola Amiga", balances: ballFriend.balances, active: bets.ballFriend.enabled, played: ballFriend.details.length > 0, quantityTotal: ballFriend.details.length, quantities: ballFriend.points, quantityLabel: "puntos", signedQuantity: true },
    { key: "pollaFirst", label: "Polla 1ª vuelta", balances: pollaFirstBalances, active: bets.polla.first9.enabled, played: Boolean(pollaFirstDetail?.complete), detailByPlayer: pollaPositionLabels(pollaFirstDetail, settlementIds) },
    { key: "pollaSecond", label: "Polla 2ª vuelta", balances: pollaSecondBalances, active: bets.polla.second9.enabled, played: Boolean(pollaSecondDetail?.complete), detailByPlayer: pollaPositionLabels(pollaSecondDetail, settlementIds) },
    { key: "pollaNassau", label: "Polla Nassau", balances: pollaNassauBalances, active: bets.polla.total18.enabled, played: Boolean(pollaNassauDetail?.complete), detailByPlayer: pollaPositionLabels(pollaNassauDetail, settlementIds) },
    { key: "miniPolla", label: "Mini Polla", balances: miniPollaComponentBalances, active: bets.miniPolla.enabled, played: Boolean(miniPollaDetail?.complete), detailByPlayer: pollaPositionLabels(miniPollaDetail, settlementIds) },
    { key: "vipers", label: "🐍 Víboras", balances: vipers.balances, active: bets.vipers.enabled, played: vipers.totalQuantity > 0 || vipers.halves.some(half => half.settled) },
    { key: "camels", label: "🐫 Camellos", balances: camels.balances, active: bets.camels.enabled, played: camels.totalQuantity > 0 || camels.halves.some(half => half.settled) },
    { key: "fish", label: "🐟 Peces", balances: fish.balances, active: bets.fish.enabled, played: fish.totalQuantity > 0 || fish.halves.some(half => half.settled) },
    { key: "loba", label: "🐺 Loba", balances: loba.balances, active: bets.loba.enabled, played: loba.details.length > 0 },
    { key: "manual", label: "Manuales", balances: manual.balances, active: manualBets.length > 0, played: manualBets.some(bet => Object.values(bet.amounts).some(amount => amount !== 0)) },
  ], [rabbitBalances, bets.rabbits.enabled, rabbits.events.length, rabbits.won, totalRabbitsWon, skinBalances, bets.skins.enabled, skins.events.length, skins.won, totalSkinsWon, units.balances, unitQuantitySummary, bets.units.enabled, completedHoles, monkey.balances, monkey.points, monkey.details.length, bets.monkey?.enabled, foursomes.balances, bets.foursome.enabled, foursomes.matches, ballFriend.balances, ballFriend.points, bets.ballFriend.enabled, ballFriend.details.length, pollaFirstBalances, pollaSecondBalances, pollaNassauBalances, miniPollaComponentBalances, bets.polla.first9.enabled, bets.polla.second9.enabled, bets.polla.total18.enabled, bets.miniPolla.enabled, pollaFirstDetail, pollaSecondDetail, pollaNassauDetail, miniPollaDetail, settlementIds, vipers.balances, bets.vipers.enabled, vipers.totalQuantity, vipers.halves, camels.balances, bets.camels.enabled, camels.totalQuantity, camels.halves, fish.balances, bets.fish.enabled, fish.totalQuantity, fish.halves, loba.balances, bets.loba.enabled, loba.details.length, manual.balances, manualBets]);
  const generalResults = useMemo(
    () => buildGeneralResultsTable(players.map(player => player.id), generalResultCategories, generalBetBalances),
    [players, generalResultCategories, generalBetBalances],
  );

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
      scoreEdits: structuredClone(scoreEdits),
      unitEvents: structuredClone(unitEvents),
      counterBetEvents: structuredClone(counterBetEvents),
      counterBetKeepers: structuredClone(counterBetKeepers),
      lobaHoles: structuredClone(lobaHoles),
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
    setScoreEdits(previous.scoreEdits);
    setUnitEvents(previous.unitEvents);
    setCounterBetEvents(previous.counterBetEvents);
    setCounterBetKeepers(previous.counterBetKeepers);
    setLobaHoles(previous.lobaHoles);
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
      vipers: { ...b.vipers, participantIds: [...b.vipers.participantIds, id] },
      camels: { ...b.camels, participantIds: [...b.camels.participantIds, id] },
      fish: { ...b.fish, participantIds: [...b.fish.participantIds, id] },
      loba: { ...b.loba, participantIds: [...b.loba.participantIds, id] },
    }));
  }

  function addPlayer() {
    appendPlayer();
  }

  function scoreFor(playerId: string) {
    return holeCapture(scores, scoreEdits, hole, players)[playerId];
  }

  function setScore(playerId: string, value: number | null) {
    checkpoint();
    setScoreEdits(prev => editCapturedScore(prev, holeNumber, playerId, value));
  }

  function confirmRoundChange(message: string, run: () => void) {
    const played = Object.values(scores).some(row => Object.values(row).some(value => typeof value === "number"));
    if (played) setPendingRoundAction({ message: `${message}\nLos scores se conservan. Los resultados de esta ronda se recalcularán; el histórico no cambia hasta guardar. ¿Continuar?`, run });
    else run();
  }

  function editActiveRound() { setRoundClosed(false); setEditingRound(true); setTab("setup"); }

  function changeScore(playerId: string, delta: number) {
    setScore(playerId, Number(scoreFor(playerId) ?? hole.par) + delta);
  }

  function goToHoleIndex(index: number) {
    setCurrentIndex(Math.max(0, Math.min(order.length - 1, index)));
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function navigateFromBottomBar(target: AppTab) {
    setFeedback("");
    if (target === "rules") setRulesCourseContext(rulesContextForRound(hasRoundProgress({ players, scores, currentIndex }), course.name));
    if (roundClosed && (target === "round" || target === "standings" || target === "personals")) {
      setTab("history");
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
      return;
    }
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

  function changeCounterBet(kind: CounterBetKind, playerId: string, quantity: number) {
    checkpoint();
    setCounterBetEvents(events => setCounterQuantity(events, kind, holeNumber, playerId, quantity, makeId()));
  }

  function setCounterBetKeeper(kind: CounterBetKind, playerId: string) {
    checkpoint();
    const nine = holeNumber <= 9 ? "holes_1_9" : "holes_10_18";
    setCounterBetKeepers(current => ({ ...current, [kind]: { ...current[kind], [nine]: playerId || undefined } }));
  }

  function setLobaHole(next: LobaHole) {
    checkpoint();
    setLobaHoles(current => ({ ...current, [holeNumber]: next }));
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
      nassauVersion: 2,
      carryEnabled: false,
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
      carryEnabled: template.carryEnabled ?? false,
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
    const timestamp = new Date().toISOString();
    return structuredClone({
      id: roundId, date: roundDate, courseName: course.name, teeName: course.teeName,
      snapshotVersion: 2, ownerId: owner.id, segments, playerBalances: allBetBalances,
      categoryBalances: { Conejos: rabbitBalances, Skins: skinBalances, Unidades: units.balances, Monkey: monkey.balances, Foursome: foursomes.balances, "Bola Amiga": ballFriend.balances, "Polla 1ª vuelta": pollaFirstBalances, "Polla 2ª vuelta": pollaSecondBalances, "Polla Nassau": pollaNassauBalances, "Mini Polla": miniPollaComponentBalances, "🐍 Víboras": vipers.balances, "🐫 Camellos": camels.balances, "🐟 Peces": fish.balances, "🐺 Loba": loba.balances, Personales: personals.balances, Manuales: manual.balances },
      resultDetails: { rabbits, skins, units, monkey, foursomes, ballFriend, polla, miniPolla, vipers, camels, fish, loba, settlementTransfers, settlementDifference, personals, manual },
      ownerName: owner.name, roundHoles, startHole, betResult: ownerBetResult, expenses, expenseTotal: ownerExpenseTotal,
      netResult: ownerNet, categoryResults, players: structuredClone(players), scores: structuredClone(scores),
      courseSnapshot: structuredClone(course), order: [...order], completedAt: timestamp, updatedAt: timestamp,
      betConfig: structuredClone(bets), unitEvents: structuredClone(unitEvents), counterBetEvents: structuredClone(counterBetEvents), counterBetKeepers: structuredClone(counterBetKeepers), lobaHoles: structuredClone(lobaHoles), personalBets: structuredClone(personalBets),
      manualBets: structuredClone(manualBets), ballFriendSetup: structuredClone(ballFriendSetup),
      personalResults: personals.results.map((r) => snapshotPersonalResult(personalBets.find((bet) => bet.id === r.betId)!, r, players)),
    });
  }

  function saveRound(allowPendingCloud = false) {
    if (order.some(number => players.some(player => Object.hasOwn(scoreEdits[number] || {}, player.id)))) { setFeedback("Hay scores editados sin guardar. Guarda cada hoyo modificado desde Tarjeta antes de terminar."); return; }
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    if (order.some(number => players.some(player => typeof scores[number]?.[player.id] !== "number"))) {
      setFeedback("Faltan scores por confirmar. Completa la tarjeta antes de terminar la ronda."); return;
    }
    if (!allowPendingCloud && identity.mode === "authenticated" && cloudLinked && cloudStatus !== "synced") {
      setPendingRoundAction({
        message: "Esta ronda quedará cerrada y segura en este dispositivo, pero todavía tiene cambios pendientes de sincronizar con la nube. ¿Cerrar provisionalmente y sincronizar cuando vuelva la conexión?",
        run: () => saveRound(true),
      });
      return;
    }
    if (history.some(round => round.id === roundId)) {
      setPendingRoundAction({ message: "¿Sobrescribir esta ronda terminada? Se actualizarán sus resultados e histórico Personal con el mismo ID; se conservará la foto. No se creará otra ronda.", run: () => saveConfirmedRound(snapshot) }); return;
    }
    saveConfirmedRound(snapshot);
  }

  function saveConfirmedRound(snapshot: RoundSnapshot) {
    const saved = upsertRoundSnapshot(history, snapshot);
    try { persistRoundHistory(localStorage, saved); } catch { setFeedback("No se pudo guardar la ronda. Libera espacio e intenta nuevamente."); return; }
    setHistory(saved);
    clearActiveRoundStorage(window.localStorage);
    setRoundClosed(true);
    setDraftAvailable(false);
    const timestamp = new Date().toISOString();
    setFrequentPlayers((current) => upsertFrequentPlayers(current, players, timestamp));
    setFeedback(identity.mode === "authenticated" && cloudLinked && cloudStatus !== "synced" ? "Ronda guardada en este dispositivo · Pendiente de sincronizar" : "Ronda guardada ✓");
    setTab("results");
  }

  useEffect(() => { finishRound.current = saveRound; });

  function editHistoricalRound(snapshot: RoundSnapshot) {
    const restored = restoreRoundSnapshot(snapshot);
    if (!restored) return;
    setPendingRoundAction({ message: "¿Corregir esta ronda terminada? Se abrirá una copia editable en lugar de la ronda activa. El histórico permanecerá intacto hasta confirmar Guardar; se reutilizará el ID y se conservará la foto.", run: () => {
    setRoundId(restored.id); setRoundDate(restored.date); setCourse(restored.courseSnapshot!);
    setPlayers(restored.players!); setOwnerId(restored.ownerId); setScores(restored.scores!); setScoreEdits({});
    setStartHole(restored.startHole || (restored.order![0] === 10 ? 10 : 1)); setRoundHoles(restored.roundHoles || (restored.order!.length === 9 ? 9 : 18));
    setBets(restored.betConfig!); setSegments(restored.segments || []);
    setPersonalBets(restored.personalBets || []); setUnitEvents(restored.unitEvents || []);
    setCounterBetEvents(restored.counterBetEvents || []); setCounterBetKeepers(restored.counterBetKeepers || emptyCounterBetKeepers()); setLobaHoles(restored.lobaHoles || {});
    setManualBets(restored.manualBets || []); setBallFriendSetup(restored.ballFriendSetup || {}); setExpenses(normalizeExpenses(restored.expenses));
    setCurrentIndex(0); setRoundClosed(false); setEditingRound(true); setDraftAvailable(true); undoStack.current = []; setUndoCount(0); setTab("setup");
    }});
  }

  async function copyResultsSummary() {
    const base = resultSummaryText(course.name, roundDate, settlementIds.map(id => ({ id, name: playerName(id) })), allBetBalances, ownerId, ownerExpenseTotal);
    const payments = settlementTransfers.length ? ["", "Pagos finales", ...settlementTransfers.map(transfer => `${playerName(transfer.fromPlayerId)} paga a ${playerName(transfer.toPlayerId)} ${money(transfer.amount)}`)] : ["", "Pagos finales", "Todo queda saldado."];
    const text = [...base.split("\n"), ...payments].join("\n");
    try { await navigator.clipboard.writeText(text); setFeedback("Resumen copiado"); }
    catch { setFeedback("No se pudo copiar automáticamente. Selecciona y copia el resumen de abajo."); setCopyFallback(text); }
  }

  function resetRound() {
    setEditingRound(false); setRoundClosed(false); setFeedback("");
    setPlayers([]); setOwnerId("");
    setScores({}); setScoreEdits({}); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({}); setPersonalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets([])); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); undoStack.current = []; setUndoCount(0); setTab("setup");
  }

  function deleteActiveRound() {
    flushLocalState.current = null;
    trackLocalCloudEdits(localStorage, null, { highContrast, language: "es-MX", notificationsEnabled: false, defaultHandicap: identity.defaultHandicap });
    clearActiveRoundStorage(window.localStorage);
    setPlayers([]); setOwnerId("");
    setScores({}); setScoreEdits({}); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({}); setPersonalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets([])); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6));
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setRoundClosed(false); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); undoStack.current = []; setUndoCount(0); setSaveStatus("saved"); setTab("welcome");
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
    const updatedAt = new Date().toISOString();
    const saved = withDefaultLaVistaRules({ ...courseDraft, name, teeName: "General", rating: undefined, slope: undefined, totalYards: undefined, updatedAt, holes: courseDraft.holes.map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex })) });
    const apply = () => { setCourses((cs) => [saved, ...cs.filter((c) => c.id !== saved.id)]); setCourse(saved); goBack(); };
    if (Object.values(scores).some(hole => Object.values(hole).some(value => typeof value === "number")) && JSON.stringify(saved.holes) !== JSON.stringify(course.holes)) {
      setPendingRoundAction({ message: "Cambiar Par o Ventaja/SI recalculará las apuestas de la ronda activa. Los scores capturados y el histórico guardado se conservan.", run: apply });
    } else apply();
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
    recordCloudDeletion(localStorage, "course", courseDraft.id);
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

  function saveGeneratedFrequentGroup(name: string, groupPlayers: Array<Pick<Player, "name" | "handicap">>) {
    const normalized = name.trim().toLocaleLowerCase("es-MX");
    if (!normalized || frequentGroups.some((group) => group.name.trim().toLocaleLowerCase("es-MX") === normalized)) return false;
    setFrequentGroups((groups) => [{ id: makeId(), name: name.trim(), players: structuredClone(groupPlayers), uses: 0, updatedAt: new Date().toISOString() }, ...groups]);
    return true;
  }

  function startRoundWithGeneratedGroup(groupPlayers: Player[]) {
    resetRound();
    const loaded = groupPlayers.map((player) => ({ ...player, id: makeId() }));
    setPlayers(loaded);
    setOwnerId(loaded[0]?.id || "");
    setBets(initialBets(loaded.map((player) => player.id)));
    setTab("setup");
  }

  function loadFrequentGroup(group: FrequentGroup) {
    confirmRoundChange("Cargar el grupo reemplazará los jugadores y apuestas actuales. Los scores anteriores quedarán conservados, pero no se asignarán automáticamente a nuevos jugadores.", () => {
    const loaded = playersFromFrequentGroup(group, makeId);
    setPlayers(loaded);
    setOwnerId(loaded[0]?.id || "");
    setBets(initialBets(loaded.map((player) => player.id)));
    setFrequentGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, uses: item.uses + 1, updatedAt: new Date().toISOString() } : item));
    });
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
    const photoId = `${round.id}-${makeId()}`;
    try {
      await saveScorecardPhoto(photoId, file);
      if (!ownsLocalWorkspace(localStorage, identity.userId)) return;
      queuePhoto(localStorage, { userId: identity.userId, roundId: round.id, photoId, operation: "upload", revision: makeId() });
      setHistory(rounds => rounds.map(item => item.id === round.id ? { ...item, photoId, updatedAt: new Date().toISOString() } : item));
      setFeedback(cloudLinked ? "Foto guardada en este dispositivo · sincronización pendiente." : "Foto guardada en este dispositivo.");
    } catch { setFeedback("No se pudo guardar la foto. Conserva el original y vuelve a intentarlo."); }
  }

  async function viewScorecardPhoto(round: RoundSnapshot) {
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      let blob = await readScorecardPhoto(round.photoId || round.id);
      if (!blob && identity.mode === "authenticated" && cloudLinked) blob = await readScorecardPhotoCloud(identity.userId, round.id, round.photoId);
      if (!blob) throw new Error("Photo unavailable");
      const url = URL.createObjectURL(blob);
      if (preview) preview.location.replace(url);
      else { URL.revokeObjectURL(url); throw new Error("Popup blocked"); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      preview?.close();
      setFeedback("No pudimos abrir la foto. Puede seguir pendiente en el dispositivo original; revisa la conexión o permite abrir la ventana.");
    }
  }

  async function confirmHistoricalRoundDeletion() {
    if (!historicalRoundToDelete) return;
    const target = historicalRoundToDelete;
    const next = resolveHistoricalRoundDeletion(history, target.id, "delete");
    try {
      recordCloudDeletion(localStorage, "round", target.id);
      queuePhoto(localStorage, { userId: identity.userId, roundId: target.id, photoId: target.photoId || target.id, operation: "delete", revision: makeId() });
      persistRoundHistory(window.localStorage, next);
      setHistory(next); setHistoricalRoundToDelete(null);
      if (target.photoId) {
        try { await deleteScorecardPhoto(target.photoId); } catch { /* Cloud cleanup remains independently retryable. */ }
      }
    } catch { setFeedback("No se pudo guardar la eliminación. Reintenta; no se confirmó la sincronización."); }
  }

  function confirmPersonalHistoryDeletion() {
    if (!personalHistoryToDelete) return;
    const target = personalHistoryToDelete;
    const next = resolvePersonalHistoryDeletion(history, target.roundId, target.resultIndex, "delete");
    persistRoundHistory(window.localStorage, next);
    setHistory(next);
    setPersonalHistoryToDelete(null);
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
          <div className="manualGrid">{players.map((p) => <label key={p.id}><span>{p.name}</span><SignedMoneyInput label={`${bet.name || "apuesta manual"} · ${p.name}`} value={bet.amounts[p.id] ?? 0} onChange={(next) => setManualAmount(bet.id, p.id, next)} /></label>)}</div>
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
      {personals.results.filter(result => !personalDetailId || result.betId === personalDetailId).map((result) => {
        const rivalLabel = playerName(result.rivalId);
        const config = personalBets.find(bet => bet.id === result.betId);
        return <div className="personalLiveBet" key={result.betId}>
          {config && <p>Base {money(config.baseValue)} · {config.advantageStrokes ? `${config.advantageStrokes} golpes recibe ${config.advantageReceiver === "owner" ? ownerLabel : rivalLabel}` : "Sin ventaja"} · Carry {config.carryEnabled ? "Sí" : "No"} · {result.pressureMultiplier > 1 ? `Presión ${result.pressureMultiplier}x en 2ª vuelta jugada` : "Sin presión"}</p>}
          <div className="row between personalLiveHead"><b>{ownerLabel} vs {rivalLabel}</b><span>Liquidado: <strong className={result.totalMoney > 0 ? "good" : result.totalMoney < 0 ? "bad" : ""}>{signedMoney(result.totalMoney)}</strong></span></div>
          {!result.liveComponents.length && <div className="empty">No hay componentes activos.</div>}
          {result.liveComponents.filter((component) => {
            if (!currentPhysicalNineOnly) return true;
            if (roundHoles === 9) return component.key === "match1" || component.key === "medal1";
            if (component.key === "match18" || component.key === "medal18") return true;
            return component.holes.includes(holeNumber);
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
              {(component.key === "match2" || component.key === "medal2") && <div className="hint">{component.kind === "match" ? "Match" : "Medal"} 2ª: {money(component.stake)} ({money(component.pressureStake)} {result.pressureMultiplier > 1 ? "presión" : "base"} + {money(component.carryIn)} carry){component.complete && component.leader === "tie" ? " · Empate final: no se cobra" : ""}</div>}
              {component.carryOut > 0 && <div className="hint">Empate: {money(component.carryOut)} pasan a {component.kind === "match" ? "Match" : "Medal"} 2ª. No se cobran en esta vuelta.</div>}
              {component.kind === "match" ? <>
                <div className="auditLine"><span>Estado Match</span><b>{matchState}</b></div>
                <div className="holeAudit">{component.holeResults.length ? component.holeResults.map((holeResult) => <span key={holeResult.hole}>H{holeResult.hole}: {holeResult.winner === "tie" ? "Empate" : holeResult.winner === "owner" ? ownerLabel : rivalLabel} · {ownerLabel} {holeResult.ownerGross} − {holeResult.ownerStrokes} = {holeResult.ownerScore} · {rivalLabel} {holeResult.rivalGross} − {holeResult.rivalStrokes} = {holeResult.rivalScore}</span>) : <span>Sin hoyos completos</span>}</div>
              </> : <>
                <div className="auditLine"><span>Neto acumulado</span><b>{ownerLabel} {component.ownerNetTotal} · {rivalLabel} {component.rivalNetTotal}</b></div>
                <div className="auditLine"><span>Diferencia Medal</span><b>{medalDifference}</b></div>
              </>}
            </div>;
          })}
          <div className="hint">Bruto liquidado: {ownerLabel} {money(result.grossOwner)} · {rivalLabel} {money(result.grossRival)}. Neto {ownerLabel}: {signedMoney(result.totalMoney)}. Provisional: {signedMoney(result.liveComponents.reduce((sum, component) => sum + component.ownerMoney, 0))}.</div>
        </div>;
      })}
    </section>;
  }

  function renderMonkeyLive() {
    if (!bets.monkey?.enabled) return null;
    const currentResult = scoreCaptureComplete ? liveMonkey : monkey;
    const current = currentResult.details.find(item=>item.hole===holeNumber);
    return <section className="card"><h2>🐒 Monkey · {money(bets.monkey.value)} por punto</h2>
      <p>3 jugadores · 2 puntos por rival ganado, 1 por empate. HCP rebajado, sin porcentaje.</p>
      {!currentResult.valid ? <div className="empty">Selecciona exactamente tres jugadores en configuración.</div> : playersByIds(players,bets.monkey.participantIds).map(player=><div className="transfer" key={player.id}><span><b>{player.name}</b><small> H{holeNumber}: {current?.points[player.id] ?? "—"} · Total {currentResult.points[player.id]} pts</small></span><strong>{signedMoney(currentResult.balances[player.id])}</strong></div>)}
    </section>;
  }

  const currentRabbitEvents = liveRabbits.events.filter((e) => e.hole === holeNumber);
  const currentSkin = liveSkins.events.find((e) => e.hole === holeNumber);
  const unitHoleManual = (id: string) => unitEvents.filter((e) => e.hole === holeNumber && e.playerId === id).reduce((a, e) => a + e.amount, 0);
  const unitHoleAuto = (id: string) => liveUnits.autoByHole[holeNumber]?.[id] ?? 0;
  const unitHoleNet = (id: string) => unitHoleManual(id) + unitHoleAuto(id);
  const bfSetup = ballFriendSetup[holeNumber] ?? { teamA: [] };
  const bfDetail = liveBallFriend.details.find((d) => d.hole === holeNumber);
  const savedBfDetail = ballFriend.details.find((d) => d.hole === holeNumber);

  function closeHoleSummary() {
    holeSummarySession.current?.finish();
  }

  function toggleHoleSummaryPause() {
    holeSummarySession.current?.togglePause();
  }

  function commitFocusedNumericCapture() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.dataset.numericCapture === "true") {
      saveAfterNumericCommit.current = true;
      active.blur();
    }
  }

  function requestSaveAndAdvance() {
    if (!saveAfterNumericCommit.current) {
      saveAndAdvance();
      return;
    }
    saveAfterNumericCommit.current = false;
    queueMicrotask(() => latestSaveAndAdvance.current());
  }

  function saveAndAdvance() {
    if (holeSummarySession.current) return;
    const validationErrors = collectHoleValidationErrors({
      scoreCaptureComplete,
      holeNumber,
      players,
      counterBets: [
        { kind: "vipers", config: bets.vipers },
        { kind: "camels", config: bets.camels },
        { kind: "fish", config: bets.fish },
      ],
      counterBetKeepers,
      lobaConfig: bets.loba,
      lobaHole: lobaHoles[holeNumber],
      foursomeConfig: bets.foursome,
      foursomeSegments: segments,
      order,
      ballFriendConfig: bets.ballFriend,
      ballFriendSetup: ballFriendSetup[holeNumber],
    });
    if (validationErrors.length) {
      setFeedback("");
      setHoleValidationErrors(validationErrors);
      return;
    }
    const committed = commitHoleCapture(scores, scoreEdits, hole, players);
    if (!committed) { setHoleValidationErrors(["Completa los scores vacíos antes de guardar el hoyo."]); return; }
    setHoleValidationErrors([]);
    setFeedback("");
    checkpoint();
    // Also covers entering Tarjeta directly without pressing Iniciar ronda.
    const savedBets = freezeRoundHandicapBases(bets, players);
    setBets(savedBets);
    setScores(committed.scores); setScoreEdits(committed.edits);
    const savedScores = committed.scores;
    const savedRabbits = calculateRabbits(course, savedScores, players, bets.rabbits, order);
    const savedSkins = calculateSkins(course, savedScores, players, bets.skins, order);
    const savedFoursomes = calculateFoursomes(course, savedScores, players, savedBets.foursome, segments, order);
    const savedUnits = calculateUnits(players, unitEvents, bets.units, course, savedScores, order);
    const savedBallFriend = calculateBallFriend(course, savedScores, players, savedBets.ballFriend, ballFriendSetup, order);
    const savedPolla = calculatePolla(course, savedScores, players, bets.polla, order);
    const savedMiniPolla = calculateMiniPolla(course, savedScores, players, bets.miniPolla, order);
    const savedPersonals = calculatePersonalBets(personalBets, ownerId, players, course, savedScores, order);
    const savedMonkey = calculateMonkey(course, savedScores, players, bets.monkey, order);
    const savedCompletedHoles = new Set([...completedHoles, holeNumber]);
    const savedVipers = calculateCounterBet("vipers", players, bets.vipers, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedCamels = calculateCounterBet("camels", players, bets.camels, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedFish = calculateCounterBet("fish", players, bets.fish, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedLoba = calculateLoba(course, savedScores, players, bets.loba, lobaHoles, order, savedCompletedHoles);
    const extras: string[] = [];
    const rabbit = savedRabbits.events.filter(event => event.hole === holeNumber).at(-1);
    const currentSkin = savedSkins.events.find(item => item.hole === holeNumber);
    if (rabbit) extras.push(`🐇 Conejo: ${rabbit.playerId ? playerName(rabbit.playerId) : "libre"}`);
    if (currentSkin) extras.push(...skinHoleNotice(currentSkin, bets.skins.value, currentIndex === order.length - 1, playerName));
    const currentFoursomes = savedFoursomes.matches.filter((match) => match.holePoints.some((item) => item.hole === holeNumber));
    for (const match of currentFoursomes) {
      const holePoints = match.holePoints.find((item) => item.hole === holeNumber)?.points ?? 0;
      const leader = (holePoints > 0 ? match.basePair : match.opponentPair).map(playerName).join(" + ");
      const accumulated = (match.pointDiff > 0 ? match.basePair : match.opponentPair).map(playerName).join(" + ");
      extras.push(`Foursome · ${holePoints === 0 ? "Empate" : `${leader} +${Math.abs(holePoints)}`}\nAcum: ${match.pointDiff === 0 ? "AS" : `${accumulated} +${Math.abs(match.pointDiff)}`}`);
    }
    const unitLines = players.map((player) => ({ name: player.name, value: (savedUnits.autoByHole[holeNumber]?.[player.id] || 0) + unitHoleManual(player.id) })).filter((item) => item.value !== 0);
    if (unitLines.length) extras.push(`📏 Unidades: ${unitLines.map((item) => `${item.name} ${item.value > 0 ? "+" : ""}${item.value}`).join(" · ")}`);
    const bfDetail = savedBallFriend.details.find(item => item.hole === holeNumber);
    if (bfDetail) extras.push(`⚪🤝 Bola Amiga: ${playerName(bfDetail.teamA[0])}/${playerName(bfDetail.teamA[1])} ${bfDetail.pointDiff >= 0 ? "+" : ""}${bfDetail.pointDiff} pts`);
    for (const detail of [...savedPolla.details, ...savedMiniPolla.details].filter((item) => item.complete && item.holes.at(-1) === holeNumber)) {
      extras.push(`${detail.label}: ${detail.winnerIds.map(playerName).join(" / ")} gana${detail.winnerIds.length > 1 ? "n" : ""}`);
    }
    for (const result of [savedVipers, savedCamels, savedFish]) {
      const quantity = counterBetEvents.filter(item => item.kind === result.kind && item.hole === holeNumber).reduce((sum, item) => sum + item.quantity, 0);
      if (quantity) { const meta = COUNTER_BET_META[result.kind]; extras.push(`${meta.emoji} ${meta.plural}: ${quantity}`); }
    }
    const lobaDetail = savedLoba.details.find(detail => detail.hole === holeNumber);
    if (lobaDetail) {
      const lobaNames = lobaDetail.lobaTeam.map(playerName).join(" + ");
      const opponentNames = lobaDetail.opponents.map(playerName).join(" + ");
      extras.push(`🐺 ${lobaNames} ${lobaDetail.lobaBestNet} neto vs ${opponentNames} ${lobaDetail.opponentBestNet} neto · 🔥${lobaDetail.fireMultiplier}x · ${lobaDetail.winner === "tie" ? "Empate" : lobaDetail.winner === "loba_team" ? `ganó ${lobaNames}` : `ganó ${opponentNames}`}${bets.loba.unitsEnabled ? ` · 📏 ${lobaDetail.lobaUnits} vs ${lobaDetail.opponentUnits}` : ""}`);
    }
    for (const result of savedPersonals.results) {
      const line = personalHoleSummary(result, playerName(ownerId), playerName(result.rivalId), holeNumber);
      if (line) extras.push(line);
    }
    if (bets.monkey?.enabled) {
      const participants = playersByIds(players, [...new Set(bets.monkey.participantIds)]);
      extras.push(savedMonkey.valid ? monkeyHoleSummary(participants, savedMonkey.points) : "Monkey: selecciona exactamente tres jugadores");
    }
    const privatePollaLink = parsePrivatePollaLink(localStorage.getItem(PRIVATE_POLLA_LINK_KEY));
    if (privatePollaLink) {
      const changes = privatePollaScoreChanges(privatePollaLink, holeNumber, savedScores[holeNumber] || {});
      changes.forEach((change) => enqueuePollaScore(change));
      if (changes.length && navigator.onLine) import("../lib/polla-offline").then(({ flushPollaScoreQueue }) => flushPollaScoreQueue(privatePollaLink.accessToken, { tournamentId: privatePollaLink.tournamentId, groupId: privatePollaLink.groupId })).catch(() => undefined);
    }
    setHoleSummary(buildHoleSummary(holeNumber, players, savedScores, extras));
    const savedIndex = currentIndex;
    holeSummarySession.current = createHoleSummarySession({
      now: () => window.performance.now(),
      schedule: (action, delay) => window.setTimeout(action, delay),
      cancel: timer => window.clearTimeout(timer),
      onPauseChange: paused => setHoleSummaryPaused(paused),
      onAdvance: () => {
        holeSummarySession.current = null;
        setHoleSummaryPaused(false);
        setHoleSummary([]);
        const destination = nextHoleDestination(order, savedIndex);
        if (destination.kind === "hole") goToHoleIndex(destination.index);
        else { setTab("results"); finishRound.current(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      },
    });
  }
  latestSaveAndAdvance.current = saveAndAdvance;

  const todayMx = localDateMexico();
  const currentMonth = todayMx.slice(0, 7);
  const currentYear = todayMx.slice(0, 4);
  const monthRounds = history.filter((h) => h.date.startsWith(currentMonth));
  const yearRounds = history.filter((h) => h.date.startsWith(currentYear));
  const sum = (arr: RoundSnapshot[], key: "netResult" | "betResult" | "expenseTotal") => arr.reduce((a, r) => a + r[key], 0);
  const expenseByKey = (arr: RoundSnapshot[], key: keyof Expense) => arr.reduce((a, r) => a + (r.expenses[key] || 0), 0);

  const golfStats = useMemo(() => historicalGolfStats(history), [history]);
  const availableHistoryYears = useMemo(() => historyYears(history), [history]);
  const filteredHistory = useMemo(() => filterHistory(history, historyYear, historyMonth), [history, historyYear, historyMonth]);

  return <main className={`app ${highContrast ? "highContrast" : ""} ${tab === "results" ? "compactResults" : ""}`}>
    {tab !== "rules" && <header className="topbar">
      <button className="brandHomeButton" onClick={() => setTab("welcome")} aria-label="Ir a Inicio"><BrandLockup compact /></button>
      <div className="topActions"><span className={`saveIndicator ${saveStatus}`}>{saveStatus === "saving" ? "Guardando…" : saveStatus === "error" ? "Error de guardado" : identity.mode !== "authenticated" || !cloudLinked ? "Guardado en este dispositivo" : cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando…" : cloudStatus === "offline" ? "Sin conexión · pendiente" : cloudStatus === "error" ? "Error de sincronización" : "Pendiente de sincronizar"}</span><button className="contrastButton" onClick={() => setHighContrast((value) => !value)} aria-pressed={highContrast}>{contrastToggleLabel(highContrast)}</button><button className="accountButton" onClick={() => setTab("account")} aria-label="Abrir Mi Cuenta">{identity.mode === "guest" ? <svg className="guestAvatar" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-5 3-7.5 7.5-7.5s7 2.5 7.5 7.5"/></svg> : (identity.displayName.trim()[0] || "S").toUpperCase()}</button></div>
    </header>}

    {tab === "welcome" && <section className="welcomeScreen">
      <div className="eyebrow">HOY EN MÉXICO</div>
      <time dateTime={todayMexico}>{mexicoDateLabel(todayMexico)}</time>
      <h1>¿Listos para jugar?</h1>
      <p>Inicia una ronda nueva y configura jugadores, campo y apuestas.</p>
      <div className="guestModeLine">{identity.mode === "guest" ? "Modo invitado · Los datos permanecen en este dispositivo" : cloudIssues.some((issue) => issue.kind === "session_expired") ? `Perfil local · ${identity.displayName} · Vuelve a iniciar sesión para conectar la nube` : `The Backyard Account · ${identity.displayName}`}</div>
      <button className="primary big" onClick={resetRound}>Nueva ronda</button>
      <button className="secondary big groupsHomeButton" onClick={() => setTab("groups")}>Armar grupos</button>
      {draftAvailable && !roundClosed && <div className="activeRoundActions"><button className="secondary big" onClick={editActiveRound}>Editar ronda</button><button className="primary big" onClick={() => setTab(players.length ? "round" : "setup")}>Continuar ronda · H{order[currentIndex]}</button><button className="deleteRoundButton" onClick={() => setShowDeleteRoundConfirm(true)}>Eliminar ronda</button></div>}
      <div className="welcomeLinks"><button className="secondary" onClick={() => { setRulesCourseContext(draftAvailable ? course.name : ""); setTab("rules"); }}>⚑ Reglas de Golf</button><button className="secondary" onClick={() => setTab("pollaLive")}>🏆 Polla Live</button></div>
      {history[0] && <button className="recentRound" onClick={() => setTab("history")}><span>Última ronda</span><b>{history[0].courseName} · {history[0].date}</b><strong className={history[0].netResult >= 0 ? "good" : "bad"}>{signedMoney(history[0].netResult)}</strong></button>}
      <button className="textButton accountHomeLink" onClick={() => setTab("account")}>Mi Cuenta</button>
    </section>}

    {tab !== "welcome" && tab !== "rules" && <button className="secondary pageBack" onClick={goBack}>← Regresar</button>}
    {feedback && <div className="notice" role="status">{feedback}<button className="textButton" aria-label="Cerrar mensaje" onClick={() => setFeedback("")}>×</button></div>}
    {copyFallback && <section className="card"><label>Resumen para copiar<textarea readOnly value={copyFallback} onFocus={event => event.currentTarget.select()} /></label><button onClick={() => setCopyFallback("")}>← Regresar</button></section>}
    {pendingRoundAction && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="round-change-title"><h2 id="round-change-title">Confirmar cambios</h2><p>{pendingRoundAction.message}</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setPendingRoundAction(null)}>Cancelar</button><button className="primary" onClick={() => { const action = pendingRoundAction; setPendingRoundAction(null); action.run(); }}>Confirmar</button></div></section></div>}
    {pendingCloudConflict && (() => { const conflict = pendingCloudConflict.conflicts[0]; if (!conflict) return null; const display = describeCloudConflict(conflict, playerName); return <div className="modalBackdrop"><section className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="cloud-conflict-title"><h2 id="cloud-conflict-title">Cambio en dos dispositivos</h2><p>Elige únicamente el dato en conflicto. Los demás cambios compatibles ya se combinaron.</p><div className="cloudConflictField"><b>{display.label}</b><span>Nube: {display.cloudValue}</span><span>Este dispositivo: {display.localValue}</span></div>{pendingCloudConflict.conflicts.length > 1 && <small>Quedan {pendingCloudConflict.conflicts.length} conflictos por revisar.</small>}<div className="dialogActions"><button className="secondary" onClick={() => resolveCloudConflict("cloud")}>Usar nube para este dato</button><button className="primary" onClick={() => resolveCloudConflict("local")}>Usar este dispositivo</button></div></section></div>; })()}
    {holeValidationErrors.length > 0 && <div className="modalBackdrop" role="presentation"><section className="confirmDialog holeValidationDialog" role="alertdialog" aria-modal="true" aria-labelledby="hole-validation-title" aria-describedby="hole-validation-description"><h2 id="hole-validation-title">Falta completar este hoyo</h2><p id="hole-validation-description">Revisa todos estos puntos antes de guardar y avanzar:</p><ul>{holeValidationErrors.map(error => <li key={error}>{error}</li>)}</ul><div className="dialogActions"><button autoFocus className="primary" onClick={() => setHoleValidationErrors([])}>Volver y completar</button></div></section></div>}
    {tab === "personalDetail" && renderPersonalLive("Detalle Personal")}
    {tab === "historyDetail" && (() => { const saved = history.find(round => round.id === historyDetailId); return saved ? <HistoricalRoundDetail round={saved} onEdit={() => editHistoricalRound(saved)} onPhoto={() => viewScorecardPhoto(saved)} /> : <div className="empty">La ronda ya no está disponible.</div>; })()}
    {tab === "groups" && <GroupBuilder frequentPlayers={frequentPlayers} frequentGroups={frequentGroups} onBack={goBack} onPlay={startRoundWithGeneratedGroup} onSaveFrequentGroup={saveGeneratedFrequentGroup} onEditFrequentGroup={beginEditFrequentGroup} onDeleteFrequentGroup={setFrequentGroupToDelete} />}

    {tab === "account" && <AccountPanel highContrast={highContrast} onHighContrastChange={setHighContrast} />}

    {tab === "setup" && <>
      <section className="hero setupHero">
        <div className="setupHeroCopy"><div className="eyebrow">NUEVA JUGADA</div><h1>Configura y juega.</h1><p>La app calcula lo automático; tú solo capturas score y eventos especiales.</p></div>
        <div className="heroDate"><input aria-label="Fecha de la ronda" className="dateInput" type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} /></div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>1. Campo</h2><p>Elige el campo; Par y Ventaja/SI se conservan por hoyo.</p></div><button className="textButton" onClick={startNewCourse}>+ Campo</button></div>
        <div className="grid2">
          <div><label>Campo</label><select value={course.name} onChange={(e) => {
            const next = courses.find((x) => x.name === e.target.value); if (next) confirmRoundChange("Cambiar campo modifica el Par/SI aplicado a los scores existentes.", () => setCourse(next));
          }}>{courseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
          <div><label>Inicio de ronda</label><select value={startHole} onChange={(e) => { const next = Number(e.target.value) as 1 | 10; confirmRoundChange("Cambiar la salida cambia el orden Nassau y los segmentos de Foursome.", () => { setStartHole(next); setCurrentIndex(0); }); }}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></div>
          <div><label>Hoyos a jugar</label><select value={roundHoles} onChange={(e) => { const next = Number(e.target.value) as 9 | 18; confirmRoundChange("Cambiar la duración excluye del cálculo los hoyos fuera de la nueva vuelta, sin borrar sus scores.", () => { setRoundHoles(next); setCurrentIndex(0); }); }}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></div>
        </div>
        <div className="courseMeta"><span>18 hoyos configurados</span>{course.updatedAt && <span>Última actualización: {course.updatedAt}</span>}<button onClick={() => { setCourseDraft(withDefaultLaVistaRules(course)); setTab("courses"); }}>{course.name === "La Vista Temporal" ? "Editar campo temporal" : "Editar campo"}</button>{isLaVistaCourse(course.name) && <button onClick={() => { setRulesCourseContext(course.name); setTab("rules"); }}>Ver Reglas Locales</button>}</div>
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>2. Jugadores</h2><p>HCP de la ronda. La base se recalcula según cada apuesta.</p></div><button className="textButton" onClick={addPlayer}>+ Jugador</button></div>
        {!players.length && <div className="empty">Agrega los jugadores de esta ronda.</div>}
        {players.map((p) => <div className="playerEdit" key={p.id}>
          <input placeholder="Nombre" value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} />
          <NumericCaptureInput className="hcpInput" inputMode="decimal" step={0.1} min={-15} max={54} placeholder="HCP" value={p.handicap} emptyWhenZero={false} onValueChange={(handicap) => updatePlayer(p.id, { handicap })} />
          <button className={`ownerDot ${ownerId === p.id ? "active" : ""}`} onClick={() => setOwnerId(p.id)} title="Jugador principal">★</button>
          <button className="remove" aria-label={`Quitar a ${p.name || "jugador"}`} onClick={() => { confirmRoundChange(`Quitar a ${p.name} lo excluye de las apuestas y parejas actuales.`, () => setPlayers((ps) => ps.filter((x) => x.id !== p.id))); }}>×</button>
        </div>)}
        <div className="hint">★ marca al jugador principal para estadísticas y gastos.</div>
        {(frequentGroups.length > 0 || frequentPlayers.length > 0) && <div className="frequentBox">
          {frequentGroups.length > 0 && <details className="frequentDisclosure"><summary>Grupos guardados ({frequentGroups.length})</summary><div className="frequentGroupList">{frequentGroups.map((group) => <div className="templateRow groupTemplateRow" key={group.id}>
            <button className="templateLoad" onClick={() => loadFrequentGroup(group)} aria-label={`Cargar grupo ${group.name} a la ronda`}><b>{group.name}</b><span>{group.players.map((member) => member.name).join(" · ")}<br />Toca el nombre para cargar este grupo</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentGroup(group)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentGroupToDelete(group)}>🗑 Eliminar</button></div>
          </div>)}</div></details>}
          {frequentPlayers.length > 0 && <details className="frequentDisclosure"><summary>Jugadores frecuentes ({frequentPlayers.length})</summary><div className="frequentTemplateList">{frequentPlayers.map((saved) => editingFrequentPlayerId === saved.id ? <div className="templateEditor" key={saved.id}>
            <input aria-label="Nombre frecuente" value={frequentPlayerDraft.name} onChange={(event) => setFrequentPlayerDraft((draft) => ({ ...draft, name: event.target.value }))} />
            <NumericCaptureInput aria-label="HCP frecuente" className="hcpInput" inputMode="decimal" step={0.1} min={-15} max={54} placeholder="HCP" value={frequentPlayerDraft.handicap} emptyWhenZero={false} onValueChange={(handicap) => setFrequentPlayerDraft((draft) => ({ ...draft, handicap }))} />
            <div className="templateActions"><button className="primary" disabled={!frequentPlayerDraft.name.trim()} onClick={saveFrequentPlayerEdit}>Guardar</button><button className="secondary" onClick={() => setEditingFrequentPlayerId(null)}>Cancelar</button></div>
          </div> : <div className="templateRow" key={saved.id}>
            <button className="templateLoad" onClick={() => appendPlayer(saved.name, saved.handicap)}><b>{saved.name}</b><span>HCP {saved.handicap ?? "—"} · + Agregar</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentPlayer(saved)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentPlayerToDelete(saved)}>🗑 Eliminar</button></div>
          </div>)}</div></details>}
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
          <div className="betHead"><div><b>📏 Unidades / Copas</b><span>Positivas menos negativas; todos pagan a todos</span></div><Toggle on={bets.units.enabled} onClick={() => setBets({ ...bets, units: { ...bets.units, enabled: !bets.units.enabled } })} /></div>
          {bets.units.enabled && <><div className="grid2"><MoneyInput label="Valor por unidad" value={bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, value: v } })} /><MoneyInput label="Valor por Copa" value={bets.units.copaValue ?? bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, copaValue: v } })} /></div><label className="miniLabel">Participan en Unidades / Copas</label><ParticipantChips players={players} selected={bets.units.participantIds} onChange={(ids) => setBets({ ...bets, units: { ...bets.units, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🤝 Foursome</b><span>Fijo · fijo + patada · solo puntos</span></div><Toggle on={bets.foursome.enabled} onClick={() => setBets({ ...bets, foursome: { ...bets.foursome, enabled: !bets.foursome.enabled } })} /></div>
          {bets.foursome.enabled && <>
            <HandicapBaseControl name="Foursome" config={bets.foursome} fallback="moving" onChange={baseMode => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", baseMode, fixedBaseHandicap: undefined } })} />
            <div className="grid3">
              <div><label>Modalidad</label><select value={bets.foursome.mode} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, mode: e.target.value as BetConfig["foursome"]["mode"] } })}><option value="fixed">Fijo</option><option value="fixed_points">Fijo + Patada</option><option value="points">Solo puntos</option></select></div>
              <div><label>Cambia parejas</label><select value={bets.foursome.segmentSize} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, segmentSize: Number(e.target.value) as 3 | 6 | 9 | 18 } })}><option value={3}>Cada 3</option><option value={6}>Cada 6</option><option value={9}>Cada 9</option><option value={18}>18 hoyos</option></select></div>
              <HcpPercentInput value={bets.foursome.hcpPct} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", hcpPct: v } })} />
              {(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Foursome fijo" value={bets.foursome.fixedValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, fixedValue: v } })} />}
              {(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Valor punto / patada" value={bets.foursome.pointValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, pointValue: v } })} />}
              <div><label>Decimales</label><select aria-label="Decimales Foursome" value={bets.foursome.decimals} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", decimals: e.target.value as "partial" | "round" } })}><option value="round">Redondear</option><option value="partial">Cuentan</option></select></div>
            </div>
            {roundHoles === 18 && <div className="pressureOption pressureGrid">
              <div><b>Presión Foursome</b><span>Se identifica siempre por hoyos físicos, aunque la salida sea H10.</span></div>
              <div><label>Presión</label><select value={bets.foursome.pressureMultiplier ?? (bets.foursome.pressSecond9 ? 2 : 1)} onChange={(event) => setBets({ ...bets, foursome: { ...bets.foursome, ...setFoursomePressure(bets.foursome, Number(event.target.value) as 1 | 2 | 3 | 4 | 5) } })}><option value={1}>Sin presión</option>{[2,3,4,5].map((value) => <option key={value} value={value}>{value}x</option>)}</select></div>
              {foursomePressure(bets.foursome) > 1 && <div><label>Vuelta presionada</label><select value={bets.foursome.pressureNine ?? "holes_10_18"} onChange={(event) => setBets({ ...bets, foursome: { ...bets.foursome, pressureNine: event.target.value as "holes_1_9" | "holes_10_18" } })}><option value="holes_1_9">H1–9</option><option value="holes_10_18">H10–18</option></select></div>}
            </div>}
            <label className="miniLabel">Jugadores de Foursome</label><ParticipantChips players={players} selected={bets.foursome.participantIds} onChange={(ids) => setBets({ ...bets, foursome: { ...bets.foursome, participantIds: ids } })} />
            <div className="segments">{segments.map((s) => {
              const holes = order.slice(s.startIndex, s.endIndex + 1);
              const opps = opponentPairs(bets.foursome.participantIds, s.basePair);
              return <div className="segment" key={s.id}><div className="segmentTitle">Hoyos {holes[0]}–{holes[holes.length - 1]} · pareja base</div><div className="chips">{playersByIds(players, bets.foursome.participantIds).map((p) => <button key={p.id} className={`chipButton ${s.basePair.includes(p.id) ? "selected" : ""}`} onClick={() => toggleBasePair(s.id, p.id)}>{p.name}</button>)}</div>{s.basePair.length === 2 && <div className="generated"><b>{playerName(s.basePair[0])} + {playerName(s.basePair[1])}</b>{opps.length === 1 ? <span>vs {opps[0].map(playerName).join(" + ")}</span> : <span>vs {playersByIds(players, bets.foursome.participantIds).filter(player => !s.basePair.includes(player.id)).map(player => player.name).join(" · ")} · {opps.length} matches</span>}</div>}</div>;
            })}</div>
          </>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>⚪🤝 Bola Amiga</b><span>Parejas por hoyo · birdie o mejor voltea rival · máximo 9</span></div><Toggle on={bets.ballFriend.enabled} onClick={() => setBets({ ...bets, ballFriend: { ...bets.ballFriend, enabled: !bets.ballFriend.enabled } })} /></div>
          {bets.ballFriend.enabled && <HandicapBaseControl name="Bola Amiga" config={bets.ballFriend} fallback="fixed" onChange={baseMode => setBets({ ...bets, ballFriend: { ...bets.ballFriend, baseMode, fixedBaseHandicap: undefined } })} />}
          {bets.ballFriend.enabled && <><div className="grid3"><MoneyInput label="Valor punto" value={bets.ballFriend.value} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, value: v } })} /><HcpPercentInput value={bets.ballFriend.hcpPct} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, hcpPct: v } })} /><NumberField label="Score máximo" value={bets.ballFriend.maxScore} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, maxScore: v } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.ballFriend.participantIds} onChange={(ids) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, participantIds: ids } })} /></>}
        </div>

        <div className="betCard">
          <div className="betHead"><div><b>🐒 Monkey</b><span>Exactamente tres jugadores</span></div><Toggle on={Boolean(bets.monkey?.enabled)} onClick={()=>setBets({...bets,monkey:{value:20,participantIds:players.slice(0,3).map(p=>p.id),...bets.monkey,enabled:!bets.monkey?.enabled}})} /></div>
          {bets.monkey?.enabled && <><MoneyInput label="Valor punto Monkey" value={bets.monkey.value} onChange={value=>setBets({...bets,monkey:{...bets.monkey!,value}})} /><ParticipantChips players={players} selected={bets.monkey.participantIds} onChange={participantIds=>setBets({...bets,monkey:{...bets.monkey!,participantIds}})} /><p>{monkey.valid ? "HCP rebajado entre estos tres. Sin porcentaje ni redondeo añadido." : "Selecciona exactamente tres jugadores; no se calcula con otra cantidad."}</p></>}
        </div>

        <PollaBetEditor
          title="Polla H1–9"
          trophy="silver"
          description="Mejor medal neto en los hoyos físicos H1–9"
          config={bets.polla.first9}
          players={players}
          unavailable={roundHoles === 9 && startHole === 10}
          onChange={(first9) => setBets({ ...bets, polla: { ...bets.polla, first9 } })}
        />

        <PollaBetEditor
          title="Polla H10–18"
          trophy="silver"
          description="Mejor medal neto en los hoyos físicos H10–18"
          config={bets.polla.second9}
          players={players}
          unavailable={roundHoles === 9 && startHole === 1}
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

        <CounterBetConfigPanel kind="vipers" config={bets.vipers} players={players} onChange={vipers => setBets({ ...bets, vipers })} />
        <CounterBetConfigPanel kind="camels" config={bets.camels} players={players} onChange={camels => setBets({ ...bets, camels })} />
        <CounterBetConfigPanel kind="fish" config={bets.fish} players={players} onChange={fish => setBets({ ...bets, fish })} />
        <LobaConfigPanel config={bets.loba} players={players} onChange={lobaConfig => setBets({ ...bets, loba: lobaConfig })} />
      </section>

      {renderManualBetsEditor(true)}

      <section className="card compact personalShortcut">
        <div><b>Apuestas personales</b><p className="muted">Van separadas porque el rival puede estar en otro foursome.</p></div>
        <button className="secondary" onClick={() => setTab("personals")}>Configurar Personales →</button>
      </section>

      <button className="primary big" disabled={!players.length || players.some((player) => !player.name.trim())} onClick={() => { setBets(current => freezeRoundHandicapBases(current, players)); if (!editingRound) setCurrentIndex(0); setEditingRound(false); setTab("round"); }}>{editingRound ? "Guardar configuración y continuar →" : "Iniciar ronda →"}</button>
    </>}

    {tab === "personals" && <>
      <section className="hero">
        <div><div className="eyebrow">APUESTAS PERSONALES</div><h1>{owner?.name ?? "Jugador principal"}</h1><p>Separadas del foursome. El rival puede jugar contigo o en otro grupo.</p></div>
        <button className="secondary" onClick={newPersonalBet}>+ Personal</button>
      </section>

      <PersonalHistoryPanel history={history} today={todayMx} onDelete={setPersonalHistoryToDelete} />

      {savedPersonalRivals.length > 0 && <section className="card savedRivalsCard">
        <div className="sectionTitle"><div><h2>Rivales guardados</h2><p>Plantillas para apuestas futuras. Editarlas no cambia esta ronda ni el Histórico.</p></div></div>
        <div className="frequentTemplateList">{savedPersonalRivals.map((saved) => editingSavedRivalId === saved.id && savedRivalDraft ? <div className="templateEditor rivalTemplateEditor" key={saved.id}>
          <div className="grid3">
            <div><label>Nombre</label><input value={savedRivalDraft.name} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)} /></div>
            <div><label>HCP predeterminado</label><NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={54} placeholder="HCP" value={savedRivalDraft.handicap} emptyWhenZero={false} onValueChange={(handicap) => setSavedRivalDraft((draft) => draft ? { ...draft, handicap } : draft)} /></div>
            <MoneyInput label="Valor base" value={savedRivalDraft.baseValue ?? 100} onChange={(value) => setSavedRivalDraft((draft) => draft ? { ...draft, baseValue: value } : draft)} />
            <div><label>Quién recibe ventaja</label><select value={savedRivalDraft.advantageReceiver ?? "rival"} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, advantageReceiver: event.target.value as "owner" | "rival" } : draft)}><option value="owner">Jugador principal</option><option value="rival">Rival</option></select></div>
            <NumberField label="Golpes que recibe" value={savedRivalDraft.advantageStrokes ?? 0} onChange={(value) => setSavedRivalDraft((draft) => draft ? { ...draft, advantageStrokes: Math.max(0, value) } : draft)} />
            <div><label>Multiplicador</label><select value={savedRivalDraft.pressureMultiplier ?? 1} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 } : draft)}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}x{value === 1 ? " · sin presión" : ""}</option>)}</select></div>
            <div><label htmlFor="saved-rival-carry">Carry</label><select id="saved-rival-carry" value={savedRivalDraft.carryEnabled ? "yes" : "no"} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, carryEnabled: event.target.value === "yes" } : draft)}><option value="no">No</option><option value="yes">Sí</option></select><small>Presión en segunda vuelta jugada.</small></div>
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
                updatePersonalBet(bet.id, saved ? applySavedPersonalRivalTemplate(bet, saved) : { externalRivalId: undefined, rivalHandicap: null });
              }}><option value="">+ Nuevo rival</option>{savedPersonalRivals.map((r) => <option key={r.id} value={r.id}>{r.name}{typeof r.handicap === "number" ? ` · HCP ${r.handicap}` : ""}</option>)}</select></div>
              <div><label>Nombre del rival para esta ronda</label><input value={bet.rivalName} placeholder="Ej. Daniel" onChange={(e) => updatePersonalBet(bet.id, { rivalName: e.target.value })} /></div>
              <div className="templateSaveAction"><label>Plantilla frecuente</label><button className="secondary" disabled={!bet.rivalName.trim()} onClick={() => savePersonalRivalFromBet(bet)}>{bet.externalRivalId ? "Guardar cambio en rival frecuente" : "Guardar como rival frecuente"}</button></div>
            </>}
            <MoneyInput label="Valor base" value={bet.baseValue} onChange={(v) => updatePersonalBet(bet.id, { baseValue: v })} />
            {roundHoles === 18 && <div><label htmlFor={`pressure-${bet.id}`}>Presión · 2ª vuelta jugada</label><select id={`pressure-${bet.id}`} value={bet.pressureMultiplier ?? bet.back9Multiplier ?? 1} onChange={(event) => updatePersonalBet(bet.id, { pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5, back9Multiplier: 1 })}><option value={1}>Sin presión</option><option value={2}>Sí · 2x</option>{[3,4,5].map((value) => <option key={value} value={value}>{value}x</option>)}</select><small>Aplica a {startHole === 10 ? "H1–9" : "H10–18"}. Total 18 conserva valor base.</small></div>}
            {roundHoles === 18 && <div><label htmlFor={`carry-${bet.id}`}>Carry</label><select id={`carry-${bet.id}`} value={bet.carryEnabled ? "yes" : "no"} onChange={(event) => updatePersonalBet(bet.id, { carryEnabled: event.target.value === "yes" })}><option value="no">No</option><option value="yes">Sí</option></select><small>Match y Medal independientes. Se suma a la presión.</small></div>}
            <div><label>Quién recibe ventaja</label><select value={bet.advantageReceiver === "owner" ? "owner" : "rival"} onChange={(e) => updatePersonalBet(bet.id, { advantageReceiver: e.target.value as "owner" | "rival" })}><option value="owner">{owner?.name} recibe</option><option value="rival">{displayRival} recibe</option></select></div>
            <NumberField label="Golpes que recibe" value={bet.advantageStrokes} onChange={(v) => updatePersonalBet(bet.id, { advantageStrokes: Math.max(0, v) })} />
          </div>
          {bet.advantageStrokes === 0 && <div className="hint">Sin ventaja.</div>}
          <div className="componentGrid">{(roundHoles === 9
            ? ([["match1","Match 9"],["medal1","Medal 9"]] as [keyof PersonalBet["components"], string][])
            : ([["match1",`Match 1ª · ${startHole === 10 ? "H10–18" : "H1–9"}`],["medal1",`Medal 1ª · ${startHole === 10 ? "H10–18" : "H1–9"}`],["match2",`Match 2ª · ${startHole === 10 ? "H1–9" : "H10–18"}`],["medal2",`Medal 2ª · ${startHole === 10 ? "H1–9" : "H10–18"}`],["match18","Match Total 18"],["medal18","Medal Total 18"]] as [keyof PersonalBet["components"], string][])
          ).map(([key, label]) => <button key={key} className={`component ${bet.components[key] ? "selected" : ""}`} onClick={() => updatePersonalBet(bet.id, { components: { ...bet.components, [key]: !bet.components[key] } })}>{bet.components[key] ? "✓ " : ""}{label}</button>)}</div>

          {bet.rivalMode === "external" && <div className="externalCard">
            <div className="row between"><div><b>Tarjeta de {displayRival}</b><div className="muted">Captúrala aparte; no entra a Conejos, Skins, Foursome, Bola Amiga ni Unidades.</div></div><span className="pillSmall">Otro grupo</span></div>
            <div className="externalScoreGrid">{order.map((h) => {
              const hd = course.holes.find((x) => x.number === h)!;
              return <label className="externalHole" key={h}><span>H{h}<small> P{hd.par}</small></span><NumericCaptureInput min={1} inputMode="numeric" value={bet.externalScores?.[h]} emptyWhenZero={false} placeholder="–" onValueChange={(value) => setExternalPersonalScore(bet.id, h, value)} /></label>;
            })}</div>
          </div>}
        </section>;
      })}

      <button className="primary big" style={{width:"100%"}} onClick={() => setTab("round")}>Ir a Tarjeta →</button>
    </>}

    {tab === "round" && <>
      <section className="holeHero">
        <div><div className="eyebrow">{course.name}</div><h1>Hoyo {holeNumber}</h1><p>Par {hole.par} · Ventaja {hole.strokeIndex}</p></div>
        <div className="progress">{currentIndex + 1}<span>/{order.length}</span></div>
      </section>
      <div className="holeNav">{order.map((h, i) => <button key={h} className={i === currentIndex ? "active" : scores[h] ? "done" : ""} onClick={() => goToHoleIndex(i)}>{h}</button>)}</div>

      <div className="scorecardToggle row"><button className="secondary" onClick={() => setShowFullScorecard((v) => !v)}>{showFullScorecard ? "Ocultar tarjeta completa" : "Ver tarjeta completa"}</button><button className="secondary" onClick={() => setTab("standings")}>CÓMO VAMOS</button><button className="secondary" onClick={undoLastAction} disabled={undoCount === 0}>↶ Deshacer</button><button className="secondary" onClick={() => { setTab("results"); window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 0); }}>Gastos</button></div>

      {showFullScorecard && <FullScorecard course={course} players={players} scores={scores} order={order} scale={scorecardScale} onScale={setScorecardScale} />}

      <section className="card scoreCard">
        <p className="scoreCaptureHint">Todos comienzan en Par. Configura las apuestas del hoyo, ajusta las excepciones y guarda para calcular los resultados.</p>
        {(bets.loba.enabled || bets.ballFriend.enabled) && <div className="scoreBetQuickSetup" aria-label="Apuestas de este hoyo">
          {bets.loba.enabled && <button type="button" onClick={() => setHoleBetEditor("loba")}>{lobaSetupChipLabel(lobaHoles[holeNumber], players)}</button>}
          {bets.ballFriend.enabled && <button type="button" onClick={() => setHoleBetEditor("ballFriend")}>{ballFriendSetupChipLabel(bfSetup, players, bets.ballFriend.participantIds)}</button>}
        </div>}
        {players.map((p) => {
          const indicators = playerHoleBetLabels(p.id, bets.loba.enabled ? lobaHoles[holeNumber] : undefined, bets.ballFriend.enabled ? bfSetup : undefined, bets.ballFriend.participantIds);
          return <div className="scoreRow" key={p.id}>
          <div><b>{p.name.trim() || "Sin nombre"}</b><span>HCP {p.handicap ?? "—"}</span>{indicators.length > 0 && <span className="playerHoleBetBadges">{indicators.map(indicator => <i key={indicator}>{indicator}</i>)}</span>}</div>
          <div className="scoreControls"><div className="stepper"><button aria-label={`Restar golpe a ${p.name}`} onClick={() => changeScore(p.id, -1)}>−</button><NumericCaptureInput aria-label={`Score ${p.name} hoyo ${holeNumber}`} min={1} step={1} value={scoreFor(p.id)} emptyWhenZero={false} commitUnchanged placeholder={String(hole.par)} onValueChange={(value) => setScore(p.id, value)} /><button aria-label={`Sumar golpe a ${p.name}`} onClick={() => changeScore(p.id, 1)}>+</button></div><button className="parReset" aria-label={`Restablecer Par de ${p.name}`} onClick={() => setScore(p.id, hole.par)}>PAR</button></div>
        </div>;})}
        {scoreCaptureComplete && <div className="liveBadges">
          {currentRabbitEvents.map((e, i) => <span className="badge" key={`${e.type}-${i}`}>🐇 {e.type === "grab" ? "Agarra" : e.type === "hold" ? "Mantiene" : e.type === "win" ? `Gana ×${e.count}` : e.type === "lose" ? "Pierde / libre" : e.type === "accumulate" ? `Acumula → ${e.count}` : "Libre"} {e.playerId ? playerName(e.playerId) : ""}</span>)}
          {skinHoleNotice(currentSkin, bets.skins.value, currentIndex === order.length - 1, playerName).map((line, index) => <span className={`badge ${!currentSkin?.winnerId ? "skinCarryBadge" : ""}`} key={`${line}-${index}`}>{line}</span>)}
        </div>}
        {completedHoles.has(holeNumber) && savedBfDetail && <div className="ballFriendScoreResult" role="status">{ballFriendScoreResult(savedBfDetail, bets.ballFriend.value)}</div>}
      </section>

      {(bets.rabbits.enabled || bets.skins.enabled) && <section className="card compact priorBetStatus" aria-label="Estado antes de este hoyo">
        <div className="sectionTitle"><div><h2>Antes del hoyo {holeNumber}</h2><p>Solo considera hoyos anteriores ya guardados.</p></div></div>
        <div className="priorBetGrid">
          {bets.rabbits.enabled && <article><span aria-hidden="true">🐇</span><div><b>Conejo</b>{priorRabbitStatus(priorRabbits.events, priorRabbits.pending, bets.rabbits.value, playerName).map((line) => <small key={line}>{line}</small>)}</div></article>}
          {bets.skins.enabled && <article><span aria-hidden="true">⛳</span><div><b>Skins</b>{priorSkinsStatus(priorSkins.carry, bets.skins.value).map((line) => <small key={line}>{line}</small>)}</div></article>}
        </div>
      </section>}

      <button className="secondary" onClick={editActiveRound}>Editar configuración</button>

      {holeBetEditor && <div className="modalBackdrop holeBetModalBackdrop" role="presentation"><section className="confirmDialog holeBetEditorDialog" role="dialog" aria-modal="true" aria-labelledby="hole-bet-editor-title">
        <h2 id="hole-bet-editor-title">{holeBetEditor === "loba" ? "Configurar Loba" : "Configurar Bola Amiga"}</h2>
        {holeBetEditor === "loba" ? <LobaHolePanel config={bets.loba} players={players} hole={holeNumber} capture={lobaHoles[holeNumber] || { fireMultiplier: 1, unitCounts: {} }} liveDetail={liveLoba.details.find(detail => detail.hole === holeNumber)} onChange={setLobaHole} showValidation /> : <BallFriendHolePanel config={bets.ballFriend} players={players} hole={holeNumber} capture={bfSetup} liveDetail={bfDetail} onChange={next => { checkpoint(); setBallFriendSetup(state => ({ ...state, [holeNumber]: next })); }} showValidation />}
        <div className="dialogActions"><button type="button" className="primary" onClick={() => setHoleBetEditor(null)}>Guardar selección</button></div>
      </section></div>}

      {!scoreCaptureComplete && <div className="scoreGate" role="status">Captura o confirma el score de cada jugador. Los resultados vivos aparecerán al completar el último.</div>}

      {scoreCaptureComplete && <>
        <CounterBetHolePanel kind="vipers" config={bets.vipers} players={players} events={counterBetEvents} hole={holeNumber} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("vipers", playerId, value)} onKeeper={playerId => setCounterBetKeeper("vipers", playerId)} />
        <CounterBetHolePanel kind="camels" config={bets.camels} players={players} events={counterBetEvents} hole={holeNumber} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("camels", playerId, value)} onKeeper={playerId => setCounterBetKeeper("camels", playerId)} />
        <CounterBetHolePanel kind="fish" config={bets.fish} players={players} events={counterBetEvents} hole={holeNumber} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("fish", playerId, value)} onKeeper={playerId => setCounterBetKeeper("fish", playerId)} />
      </>}

      {scoreCaptureComplete && bets.units.enabled && <section className="card">
        <div className="sectionTitle"><div><h2>📏 Unidades / Copas</h2><p>Birdie/Águila/Albatros/HIO se detectan solos. Marca aquí solo las especiales.</p></div></div>
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

      {scoreCaptureComplete && bets.foursome.enabled && <section className="card compact">
        <h3>Foursome actual</h3>
        {(() => {
          const seg = segments.find((s) => currentIndex >= s.startIndex && currentIndex <= s.endIndex);
          if (!seg || seg.basePair.length !== 2) return <div className="empty">Falta elegir pareja base de este tramo.</div>;
          const liveMatches = liveFoursomes.matches.filter((m) => m.segmentId === seg.id);
          if (!liveMatches.length) return <div className="empty">Configura las parejas de este tramo.</div>;
          return <FoursomeLive matches={liveMatches} hole={holeNumber} name={playerName} />;
        })()}
      </section>}

      {scoreCaptureComplete && <PersonalCompact results={livePersonals.results} owner={owner?.name || "Jugador principal"} name={playerName} hole={holeNumber} onOpen={id => { setPersonalDetailId(id); setTab("personalDetail"); }} />}
      {scoreCaptureComplete && renderMonkeyLive()}

      <div className="roundActions"><button className="secondary big" disabled={currentIndex === 0 || holeSummary.length > 0} onClick={() => goToHoleIndex(currentIndex - 1)}>← Anterior</button><button className="primary big" disabled={holeSummary.length > 0} onPointerDown={commitFocusedNumericCapture} onClick={requestSaveAndAdvance}>{currentIndex < order.length - 1 ? "Guardar y siguiente hoyo →" : "Terminar y guardar ronda →"}</button></div>
      {holeSummary.length > 0 && <div className="holeSummaryBackdrop" onClick={(event) => event.stopPropagation()}><div className={`holeSummary ${holeSummaryPaused ? "paused" : ""}`} role="dialog" aria-modal="true" aria-label={`Resumen del hoyo ${holeNumber}`} onClick={toggleHoleSummaryPause}><button type="button" autoFocus className="holeSummaryClose" aria-label="Cerrar resumen y avanzar" onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeHoleSummary(); }}>×</button><div className="holeSummaryContent" role="status" aria-live="polite"><h2>{holeSummary[0]} ✓</h2><p className="holeSummaryScores">{holeSummary.slice(1, players.length + 1).map((line, index) => <span key={index}>{line}</span>)}</p><div className="holeSummaryBets">{holeSummary.slice(players.length + 1).map((line, index) => <p key={index}>{line}</p>)}</div><small className="holeSummaryHoldHint">{holeSummaryPaused ? "Pausado · toca para reanudar" : "Toca el resumen para pausar"}</small></div><div className="holeSummaryTimer" aria-hidden="true" /></div></div>}
    </>}

    {tab === "standings" && <>
      {renderMonkeyLive()}
      <section className="hero standingsHero"><div><div className="eyebrow">CÓMO VAMOS</div><h1>Balance provisional.</h1><p>Combina lo ya cobrado con el valor provisional de Foursome y Personales; las Pollas pendientes no se liquidan antes de tiempo.</p></div><button className="secondary" onClick={() => setTab("round")}>Volver al hoyo</button></section>
      <section className="provisionalGrid">{[...players].sort((a, b) => (liveBetBalances[b.id] || 0) - (liveBetBalances[a.id] || 0)).map((player, index) => <div className="stat" key={player.id}><span>{index + 1} · {player.name || "Sin nombre"}</span><b className={(liveBetBalances[player.id] || 0) > 0 ? "good" : (liveBetBalances[player.id] || 0) < 0 ? "bad" : ""}>{signedMoney(liveBetBalances[player.id] || 0)}</b><small>provisional</small></div>)}</section>
      <section className="card highlights"><h2>Highlights</h2>{(() => { const leader = [...players].sort((a, b) => (liveBetBalances[b.id] || 0) - (liveBetBalances[a.id] || 0))[0]; const rabbitLeader = [...players].sort((a, b) => (rabbits.won[b.id] || 0) - (rabbits.won[a.id] || 0))[0]; const skinLeader = [...players].sort((a, b) => (skins.won[b.id] || 0) - (skins.won[a.id] || 0))[0]; return <div className="highlightList">{leader && (liveBetBalances[leader.id] || 0) > 0 && <span>🔥 {leader.name} lidera {signedMoney(liveBetBalances[leader.id])}</span>}{rabbitLeader && (rabbits.won[rabbitLeader.id] || 0) > 0 && <span>🐇 {rabbitLeader.name} lleva {rabbits.won[rabbitLeader.id]} Conejos</span>}{skinLeader && (skins.won[skinLeader.id] || 0) > 0 && <span>⛳ {skinLeader.name} lleva {skins.won[skinLeader.id]} Skins</span>}{!leader && <span>Aún sin datos.</span>}</div>; })()}</section>
<section className="card"><h2>Desglose por apuesta</h2><div className="tableWrap"><table><thead><tr><th>Jugador</th><th>🐇</th><th>⛳</th><th>📏</th><th>Foursome</th><th>⚪🤝 Bola Amiga</th><th>Pollas</th><th>Personales</th><th>Manuales</th>{bets.monkey?.enabled && <th>Monkey</th>}{bets.vipers.enabled && <th>🐍</th>}{bets.camels.enabled && <th>🐫</th>}{bets.fish.enabled && <th>🐟</th>}{bets.loba.enabled && <th>🐺</th>}</tr></thead><tbody>{players.map((player) => <tr key={player.id}><td><b>{player.name}</b></td><td>{signedMoney(rabbitBalances[player.id] || 0)}</td><td>{signedMoney(skinBalances[player.id] || 0)}</td><td>{signedMoney(units.balances[player.id] || 0)}</td><td>{signedMoney(foursomes.provisionalBalances[player.id] || 0)}</td><td>{signedMoney(ballFriend.balances[player.id] || 0)}</td><td>{signedMoney((polla.balances[player.id] || 0) + (miniPolla.balances[player.id] || 0))}</td><td>{signedMoney(personals.provisionalBalances[player.id] || 0)}</td><td>{signedMoney(manual.balances[player.id] || 0)}</td>{bets.monkey?.enabled && <td>{signedMoney(monkey.balances[player.id] || 0)}</td>}{bets.vipers.enabled && <td>{signedMoney(vipers.balances[player.id] || 0)}</td>}{bets.camels.enabled && <td>{signedMoney(camels.balances[player.id] || 0)}</td>}{bets.fish.enabled && <td>{signedMoney(fish.balances[player.id] || 0)}</td>}{bets.loba.enabled && <td>{signedMoney(loba.balances[player.id] || 0)}</td>}</tr>)}</tbody></table></div></section>
      <section className="card"><div className="sectionTitle"><div><h2>Leaderboard de la ronda</h2><p>Gross y Neto auditable con el HCP de ronda.</p></div><div className="segmented"><button className={privateBoardMode === "gross" ? "active" : ""} onClick={() => setPrivateBoardMode("gross")}>Gross</button><button className={privateBoardMode === "net" ? "active" : ""} onClick={() => setPrivateBoardMode("net")}>Neto</button></div></div><div className="tableWrap"><table><thead><tr><th>Pos</th><th>Jugador</th><th>HCP</th><th>Gross</th><th>Neto</th><th>+/- Par</th><th>Thru</th></tr></thead><tbody>{[...privateBoard].sort((a, b) => a[privateBoardMode] - b[privateBoardMode]).map((row, index) => <tr key={row.playerId}><td>{index + 1}</td><td><b>{row.name}</b></td><td>{row.handicap ?? "—"}</td><td>{row.gross || "—"}</td><td>{row.net || "—"}</td><td>{row.thru ? `${row.relativeToPar > 0 ? "+" : ""}${row.relativeToPar}` : "—"}</td><td>{row.finished ? "F" : row.thru}</td></tr>)}</tbody></table></div></section>
    </>}

    {tab === "results" && <>
      <section className="hero resultHero"><div><div className="eyebrow">RESULTADO DEL DÍA</div><h1 className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</h1><p>{owner?.name}: apuestas {money(ownerBetResult)} · gastos {money(-ownerExpenseTotal)}</p></div>{roundClosed ? <button className="secondary" onClick={() => setTab("history")}>Ver ronda guardada</button> : <button className="secondary" onClick={() => setTab("round")}>Editar tarjeta</button>}</section>

      <ResultAccordion id="final-player-summary" title="Resultado final por jugador" defaultOpen className="finalPlayerSummary">
        <p className="muted">Cuánto gana o pierde exactamente cada persona en todas las apuestas.</p>
        {settlementIds.map((id) => {
          const total = allBetBalances[id] ?? 0;
          return <div className="transfer" key={id}><span><b>{playerName(id)}</b></span><strong className={total > 0 ? "good" : total < 0 ? "bad" : ""}>{total > 0 ? "+" : ""}{money(total)}</strong></div>;
        })}
        {(bets.rabbits.enabled || bets.skins.enabled || bets.units.enabled) && <div className="roundStats" aria-label="Conteos globales de la ronda">
          {bets.rabbits.enabled && <div className="stat"><span>🐇 Conejos · Jugados</span><b>{totalRabbitsWon}</b><small>realmente cobrados</small></div>}
          {bets.skins.enabled && <div className="stat"><span>⛳ Skins · Jugados</span><b>{totalSkinsWon}</b><small>sin carry final</small></div>}
          {bets.units.enabled && <div className="stat"><span>📏 Unidades · Netas</span><b>{unitQuantitySummary.total > 0 ? "+" : ""}{unitQuantitySummary.total}</b><small>suma del neto mostrado</small></div>}
        </div>}
      </ResultAccordion>

      <ResultAccordion id="bet-values" title="Valores de apuesta" className="betValues"><div className="valueGrid">
        {bets.rabbits.enabled && <span><b>🐇 Conejos</b>{money(bets.rabbits.value)} c/u</span>}
        {bets.skins.enabled && <span><b>⛳ Skins</b>{money(bets.skins.value)} c/u</span>}
        {bets.units.enabled && <span><b>📏 Unidades / Copas</b>{money(bets.units.value)} por unidad · {money(bets.units.copaValue ?? bets.units.value)} por Copa</span>}
        {bets.foursome.enabled && <span><b>Foursome</b>{(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.fixedValue)} fijo` : ""}{bets.foursome.mode === "fixed_points" ? " · " : ""}{(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.pointValue)} punto` : ""}{(bets.foursome.pressureMultiplier || 1) > 1 ? ` · ${bets.foursome.pressureNine === "holes_1_9" ? "H1–9" : "H10–18"} ${bets.foursome.pressureMultiplier}x` : ""}</span>}
        {bets.ballFriend.enabled && <span><b>⚪🤝 Bola Amiga</b>{money(bets.ballFriend.value)} por punto</span>}
        {polla.details.map((detail) => <span key={detail.key}><b>{detail.label}</b>{money(detail.value)}</span>)}
        {bets.miniPolla.enabled && <span><b>Mini Polla</b>{money(bets.miniPolla.value)}</span>}
        {bets.vipers.enabled && <span><b>🐍 Víboras</b>{money(bets.vipers.value)} · H10–18 {bets.vipers.secondNineMultiplier}x</span>}
        {bets.camels.enabled && <span><b>🐫 Camellos</b>{money(bets.camels.value)} · H10–18 {bets.camels.secondNineMultiplier}x</span>}
        {bets.fish.enabled && <span><b>🐟 Peces</b>{money(bets.fish.value)} · H10–18 {bets.fish.secondNineMultiplier}x</span>}
        {bets.loba.enabled && <span><b>🐺 Loba</b>{money(bets.loba.value)} base · HCP {bets.loba.hcpPct ?? 100}%{bets.loba.unitsEnabled ? ` · 📏 ${money(bets.loba.unitValue)}` : ""}</span>}
        {personalBets.map((bet) => <span key={bet.id}><b>Personal {owner?.name} vs {bet.rivalMode === "group" ? playerName(bet.rivalPlayerId) : bet.rivalName}</b>{money(bet.baseValue)} base{roundHoles === 18 && (bet.pressureMultiplier || 1) > 1 ? ` · 2ª jugada ${bet.pressureMultiplier}x` : ""} · Carry {bet.carryEnabled ? "Sí" : "No"}</span>)}
      </div></ResultAccordion>

      <ResultAccordion id="general-summary" title={resultsView === "general" ? "Resumen General" : "Resumen por jugador"} defaultOpen className="playerSummary">
        <div className="resultsViewHeader"><div className="segmented" aria-label="Vista de resultados"><button className={resultsView === "players" ? "active" : ""} aria-pressed={resultsView === "players"} onClick={() => setResultsView("players")}>Jugadores</button><button className={resultsView === "general" ? "active" : ""} aria-pressed={resultsView === "general"} onClick={() => setResultsView("general")}>Resumen General</button></div></div>
        {resultsView === "players" ? <><div className="row between resultsPlayerTools"><h3>Resumen por jugador</h3><button className="secondary" onClick={copyResultsSummary}>Copiar para WhatsApp</button></div><div className="playerResultGrid">{players.map((p) => <details className="playerResultCard" key={p.id}>
          <summary><b>{p.name}</b><span className="playerIndicators">{bets.rabbits.enabled ? `🐇 ${rabbits.won[p.id] ?? 0}` : ""}{bets.skins.enabled ? ` · ⛳ ${skins.won[p.id] ?? 0}` : ""}{bets.units.enabled ? ` · 📏 ${(units.net[p.id] ?? 0) > 0 ? "+" : ""}${units.net[p.id] ?? 0}` : ""}</span><strong className={(allBetBalances[p.id] ?? 0) > 0 ? "good" : (allBetBalances[p.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(allBetBalances[p.id] ?? 0)}</strong></summary>
          <div className="playerBetBlocks">
            {bets.rabbits.enabled && <div><span>🐇 Conejos · Jugados</span><b>{rabbits.won[p.id] ?? 0}</b><i>{signedMoney(rabbitBalances[p.id] ?? 0)}</i></div>}
            {bets.skins.enabled && <div><span>⛳ Skins · Jugados</span><b>{skins.won[p.id] ?? 0}</b><i>{signedMoney(skinBalances[p.id] ?? 0)}</i></div>}
            {bets.units.enabled && <div><span>📏 Unidades · Netas</span><b>{(unitQuantitySummary.quantities[p.id] ?? 0) > 0 ? "+" : ""}{unitQuantitySummary.quantities[p.id] ?? 0}</b><i>{signedMoney(units.balances[p.id] ?? 0)}</i></div>}
            {bets.foursome.enabled && <div><span>Foursome</span><i>{signedMoney(foursomes.balances[p.id] ?? 0)}</i></div>}
            {bets.ballFriend.enabled && <div><span>⚪🤝 Bola Amiga</span><i>{signedMoney(ballFriend.balances[p.id] ?? 0)}</i></div>}
            {polla.details.filter((detail) => Object.hasOwn(detail.totals, p.id)).map((detail) => <div key={detail.key}><span>{detail.label}</span><b>1</b><i>{signedMoney(pollaDetailBalance(detail, p.id))}</i></div>)}
            {miniPolla.details.filter((detail) => Object.hasOwn(detail.totals, p.id)).map((detail) => <div key={detail.key}><span>Mini Polla</span><b>1</b><i>{signedMoney(pollaDetailBalance(detail, p.id))}</i></div>)}
            {personalBets.length > 0 && <div><span>Personales</span><i>{signedMoney(personals.balances[p.id] ?? 0)}</i></div>}
            {manualBets.length > 0 && <div><span>Manuales</span><i>{signedMoney(manual.balances[p.id] ?? 0)}</i></div>}
            {bets.monkey?.enabled && <div><span>🐒 Monkey</span><b>{monkey.points[p.id] ?? 0}</b><i>{signedMoney(monkey.balances[p.id] ?? 0)}</i></div>}
            {bets.vipers.enabled && <div><span>🐍 Víboras</span><b>{vipers.totalQuantity}</b><i>{signedMoney(vipers.balances[p.id] ?? 0)}</i></div>}
            {bets.camels.enabled && <div><span>🐫 Camellos</span><b>{camels.totalQuantity}</b><i>{signedMoney(camels.balances[p.id] ?? 0)}</i></div>}
            {bets.fish.enabled && <div><span>🐟 Peces</span><b>{fish.totalQuantity}</b><i>{signedMoney(fish.balances[p.id] ?? 0)}</i></div>}
            {bets.loba.enabled && <div><span>🐺 Loba</span><b>{loba.details.length}</b><i>{signedMoney(loba.balances[p.id] ?? 0)}</i></div>}
          </div>
        </details>)}</div></> : <div className="generalResultsWrap"><p className="muted">Todas las apuestas activas y ya jugadas. Desliza horizontalmente para revisar cada categoría.</p>{generalResults.categories.length ? <div className="generalResultsScroll" tabIndex={0} aria-label="Resumen general de resultados por apuesta"><table className="generalResultsTable"><thead><tr><th>Jugador</th>{generalResults.categories.map(category => <th key={category.key}>{category.label}{category.quantityTotal !== undefined ? ` · ${category.quantityTotal}` : ""}</th>)}<th>TOTAL</th></tr></thead><tbody>{generalResults.rows.map(row => <tr key={row.playerId}><th scope="row">{playerName(row.playerId)}</th>{generalResults.categories.map(category => { const amount = row.cells[category.key] || 0; const quantity = category.quantities?.[row.playerId]; const quantityText = quantity === undefined ? "" : `${category.signedQuantity && quantity > 0 ? "+" : ""}${quantity} ${category.quantityLabel || ""}`.trim(); return <td key={category.key}><div className="generalResultCell">{category.detailByPlayer?.[row.playerId] && <span>{category.detailByPlayer[row.playerId]}</span>}{quantityText && <span>{quantityText}</span>}<strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div></td>; })}<td className={!row.consistent ? "bad" : row.total > 0 ? "good" : row.total < 0 ? "bad" : ""}>{signedMoney(row.total)}</td></tr>)}<tr className="generalResultsTotal"><th scope="row">TOTAL GENERAL</th>{generalResults.categories.map(category => <td key={category.key} className={Math.abs(generalResults.categoryTotals[category.key] || 0) < 0.001 ? "good" : "bad"}>{signedMoney(generalResults.categoryTotals[category.key] || 0)}</td>)}<td className={Math.abs(generalResults.grandTotal) < 0.001 ? "good" : "bad"}>{signedMoney(generalResults.grandTotal)}</td></tr></tbody></table></div> : <div className="empty">Todavía no hay apuestas activas con hoyos jugados.</div>}</div>}
      </ResultAccordion>

      {bets.rabbits.enabled && <ResultAccordion id="rabbits" title={`🐇 Conejos · ${totalRabbitsWon}`}><div className="resultBalanceList">{playersByIds(players, bets.rabbits.participantIds).map(player => <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{rabbits.won[player.id] ?? 0} conejos</small></span><strong className={(rabbitBalances[player.id] ?? 0) > 0 ? "good" : (rabbitBalances[player.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(rabbitBalances[player.id] ?? 0)}</strong></div>)}</div></ResultAccordion>}
      {bets.skins.enabled && <ResultAccordion id="skins" title={`⛳ Skins · ${totalSkinsWon}`}><div className="resultBalanceList">{playersByIds(players, bets.skins.participantIds).map(player => <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{skins.won[player.id] ?? 0} skins</small></span><strong className={(skinBalances[player.id] ?? 0) > 0 ? "good" : (skinBalances[player.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(skinBalances[player.id] ?? 0)}</strong></div>)}</div></ResultAccordion>}
      {bets.units.enabled && <ResultAccordion id="units" title={`📏 Unidades · ${unitQuantitySummary.total > 0 ? "+" : ""}${unitQuantitySummary.total}`}><div className="resultBalanceList">{playersByIds(players, bets.units.participantIds).map(player => { const quantity = unitQuantitySummary.quantities[player.id] ?? 0; const amount = units.balances[player.id] ?? 0; return <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{quantity > 0 ? "+" : ""}{quantity} unidades netas</small></span><strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div>; })}</div></ResultAccordion>}
      {bets.ballFriend.enabled && <ResultAccordion id="ball-friend" title="⚪🤝 Bola Amiga"><div className="resultBalanceList">{playersByIds(players, bets.ballFriend.participantIds).map(player => { const amount = ballFriend.balances[player.id] ?? 0; const points = ballFriend.points[player.id] ?? 0; return <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{points > 0 ? "+" : ""}{points} puntos</small></span><strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div>; })}</div></ResultAccordion>}

      {personals.results.length > 0 && <ResultAccordion id="personals" title="Resultados de Apuestas Personales"><PersonalCompact embedded results={personals.results} owner={owner?.name || "Jugador principal"} name={playerName} onOpen={id => { setPersonalDetailId(id); setTab("personalDetail"); }} /></ResultAccordion>}

      <ResultAccordion id="settlement" title="Liquidación final" className={`settlementCard ${Math.abs(settlementDifference) < 0.001 ? "" : "settlementError"}`}>
        <div className="row between"><p className="muted">Pagos mínimos sugeridos después de netear todas las apuestas.</p><b>{Math.abs(settlementDifference) < 0.001 ? "✓ Suma $0" : `Inconsistencia ${signedMoney(settlementDifference)}`}</b></div>
        {settlementTransfers.length ? settlementTransfers.map((transfer, index) => <div className="transfer" key={`${transfer.fromPlayerId}-${transfer.toPlayerId}-${index}`}><span><b>{playerName(transfer.fromPlayerId)}</b> paga a {playerName(transfer.toPlayerId)}</span><strong>{money(transfer.amount)}</strong></div>) : <div className="empty">No hay pagos pendientes.</div>}
      </ResultAccordion>

      {bets.vipers.enabled && <CounterBetResults title="🐍 Víboras" halves={vipers.halves} playerName={playerName} />}
      {bets.camels.enabled && <CounterBetResults title="🐫 Camellos" halves={camels.halves} playerName={playerName} />}
      {bets.fish.enabled && <CounterBetResults title="🐟 Peces" halves={fish.halves} playerName={playerName} />}
      {bets.loba.enabled && <ResultAccordion id="loba" title="🐺 Loba" className="sideBetResult">{loba.details.length ? loba.details.map(detail => <div className="lobaResultHole" key={detail.hole}><div><b>H{detail.hole} · 🔥{detail.fireMultiplier}x · HCP {detail.hcpPct}%</b><span>{detail.lobaTeam.map(playerName).join(" + ")} {detail.lobaBestNet} neto vs {detail.opponents.map(playerName).join(" + ")} {detail.opponentBestNet} neto</span><span>{detail.winner === "tie" ? "Empate" : detail.winner === "loba_team" ? "Ganó equipo 🐺" : "Ganaron contrarios"}</span></div><strong>{money(detail.effectiveValue)}</strong><small>📏 Equipos {detail.lobaUnits} vs {detail.opponentUnits} · unidad efectiva {money(detail.effectiveUnitValue)}</small><div className="lobaResultUnits">{Object.entries(detail.playerUnits).map(([id, unitDetail]) => <span key={id}>{playerName(id)} · Auto +{unitDetail.automatic} · Manual +{unitDetail.manual} · Total +{unitDetail.total}</span>)}</div><div className="sideBetBalances">{Object.entries(detail.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</b></span>)}</div></div>) : <div className="empty">Sin hoyos completos.</div>}</ResultAccordion>}

      {bets.foursome.enabled && <ResultAccordion id="foursome" title="Foursome">
        {foursomes.matches.map((m, i) => <div className="matchLine foursomeResultLine" key={i}><div><b>H{m.startHole}–{m.endHole}: {playerName(m.basePair[0])}/{playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])}/{playerName(m.opponentPair[1])}</span></div><div className="matchNums"><span>Resultado: {m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts{m.pressureMultiplier > 1 ? ` · H1–9 ${m.first9PointDiff >= 0 ? "+" : ""}${m.first9PointDiff}${m.pressureNine === "holes_1_9" ? ` x${m.pressureMultiplier}` : ""} · H10–18 ${m.second9PointDiff >= 0 ? "+" : ""}${m.second9PointDiff}${m.pressureNine === "holes_10_18" ? ` x${m.pressureMultiplier}` : ""}` : ""}</span><small>{m.complete ? "Fijo" : "Fijo provisional"}: {signedMoney(m.complete ? m.fixedMoney : m.provisionalFixedMoney)} · {m.complete ? "Puntos/patada" : "Puntos/patada provisional"}: {signedMoney(m.complete ? m.pointMoney : m.provisionalPointMoney)}</small><b className={(m.complete ? m.totalMoney : m.provisionalTotalMoney) > 0 ? "good" : (m.complete ? m.totalMoney : m.provisionalTotalMoney) < 0 ? "bad" : ""}>{m.complete ? `Resultado económico: ${signedMoney(m.totalMoney)}` : `Provisional: ${signedMoney(m.provisionalTotalMoney)}`}</b></div></div>)}
      </ResultAccordion>}

      {pollaEnabled && <ResultAccordion id="polla" title="Polla">
        {polla.details.map((d) => <div className="pollaResult" key={d.key}><div className="row between"><div><b>{d.label}</b><div className="muted">Hoyos {d.holes.join(", ")} · valor {money(d.value)} por jugador</div></div><strong>{d.complete ? (d.winnerIds.length ? d.winnerIds.map(playerName).join(" / ") : "—") : "Pendiente"}</strong></div>{d.complete && <div className="componentResults"><span>Ganador{d.winnerIds.length !== 1 ? "es" : ""}: <b>{d.winnerIds.map(playerName).join(" / ")}</b></span><span>Premio bruto c/u: <b>{money(d.grossPrizePerWinner)}</b></span>{d.winnerIds.length > 1 && <span>Empate: <b>premio dividido</b></span>}</div>}</div>)}
      </ResultAccordion>}
      {bets.miniPolla.enabled && <ResultAccordion id="mini-polla" title="Mini Polla">
        {miniPolla.details.map((d) => <div className="pollaResult" key={d.key}><div className="row between"><div><b>{d.label}</b><div className="muted">Hoyos {d.holes.join(", ")} · valor {money(d.value)} por jugador</div></div><strong>{d.complete ? (d.winnerIds.length ? d.winnerIds.map(playerName).join(" / ") : "—") : "Pendiente"}</strong></div>{d.complete && <div className="componentResults"><span>Ganador{d.winnerIds.length !== 1 ? "es" : ""}: <b>{d.winnerIds.map(playerName).join(" / ")}</b></span><span>Premio bruto c/u: <b>{money(d.grossPrizePerWinner)}</b></span>{d.winnerIds.length > 1 && <span>Empate: <b>premio dividido</b></span>}</div>}</div>)}
      </ResultAccordion>}

      {bets.monkey?.enabled && <ResultAccordion id="monkey" title="🐒 Monkey">{renderMonkeyLive()}</ResultAccordion>}

      <ResultAccordion id="manuals" title="Manuales">{renderManualBetsEditor(true)}</ResultAccordion>

      <ResultAccordion id="expenses" title={`Gastos de ${owner?.name}`}>
        <div className="grid2">
          <MoneyInput label="Caddie" value={expenses.caddie} onChange={(v) => setExpenses({ ...expenses, caddie: v })} />
          <MoneyInput label="Alimentos" value={expenses.food} onChange={(v) => setExpenses({ ...expenses, food: v })} />
          <MoneyInput label="Bebidas" value={expenses.drinks} onChange={(v) => setExpenses({ ...expenses, drinks: v })} />
          <MoneyInput label="Greenfee" value={expenses.greenFee} onChange={(v) => setExpenses({ ...expenses, greenFee: v })} />
          <MoneyInput label="Renta carrito" value={expenses.cartRental} onChange={(v) => setExpenses({ ...expenses, cartRental: v })} />
          <MoneyInput label="Otros" value={expenses.other} onChange={(v) => setExpenses({ ...expenses, other: v })} />
        </div>
        <div className="totalStrip"><span>Total gastos</span><b>{money(ownerExpenseTotal)}</b></div>
      </ResultAccordion>

      <section className="card summaryCard"><div><span>Apuestas</span><b className={ownerBetResult >= 0 ? "good" : "bad"}>{money(ownerBetResult)}</b></div><div><span>Gastos</span><b className="bad">{money(-ownerExpenseTotal)}</b></div><div className="grand"><span>NETO DEL DÍA</span><b className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</b></div></section>
      <div className="roundActions"><button className="secondary big" onClick={async () => { const snapshot = currentSnapshot(); if (snapshot) await shareRound(snapshot); }}>Compartir ronda</button><button className="secondary big" onClick={resetRound}>Nueva ronda</button>{roundClosed ? <button className="primary big" onClick={() => setTab("history")}>Abrir Histórico</button> : <button className="primary big" onClick={() => saveRound()}>Guardar en histórico</button>}</div>
    </>}

    {tab === "history" && <>
      <section className="hero"><div><div className="eyebrow">HISTÓRICO</div><h1>Lo que realmente cuesta jugar.</h1><p>Apuestas separadas de caddie, alimentos, bebidas y demás gastos.</p></div></section>
      <section className="statsGrid"><div className="stat"><span>Rondas</span><b>{golfStats.rounds}</b><small>{golfStats.coursesPlayed} campo{golfStats.coursesPlayed === 1 ? "" : "s"}</small></div><div className="stat"><span>Promedio Gross</span><b>{golfStats.averageGross === undefined ? "—" : golfStats.averageGross.toFixed(1)}</b><small>{golfStats.scoredRounds ? `${golfStats.scoredRounds} tarjetas completas` : "sin tarjetas completas"}</small></div><div className="stat"><span>Promedio Neto</span><b>{golfStats.averageNet === undefined ? "—" : golfStats.averageNet.toFixed(1)}</b><small>HCP de ronda</small></div><div className="stat"><span>Mejor ronda</span><b>{golfStats.bestRelativeToPar === undefined ? "—" : `${golfStats.bestRelativeToPar > 0 ? "+" : ""}${golfStats.bestRelativeToPar}`}</b><small>contra Par</small></div></section>
      <div className="statsGrid"><div className="stat"><span>Neto este mes</span><b className={sum(monthRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(monthRounds, "netResult"))}</b><small>{monthRounds.length} rondas</small></div><div className="stat"><span>Neto este año</span><b className={sum(yearRounds, "netResult") >= 0 ? "good" : "bad"}>{money(sum(yearRounds, "netResult"))}</b><small>{yearRounds.length} rondas</small></div><div className="stat"><span>Apuestas año</span><b>{money(sum(yearRounds, "betResult"))}</b><small>sin gastos</small></div><div className="stat"><span>Gasto año</span><b className="bad">{money(-sum(yearRounds, "expenseTotal"))}</b><small>costo real</small></div></div>
      {golfStats.rounds > 0 && <section className="card"><h2>Balance por apuesta</h2><div className="expenseBars">{Object.entries(golfStats.categoryTotals).map(([name, value]) => <div key={name}><span>{name}</span><b className={value > 0 ? "good" : value < 0 ? "bad" : ""}>{signedMoney(value)}</b></div>)}</div></section>}
      <section className="card"><h2>Gastos del año</h2><div className="expenseBars">{([['caddie','Caddie'],['food','Alimentos'],['drinks','Bebidas'],['greenFee','Greenfee'],['cartRental','Renta carrito'],['other','Otros']] as [keyof Expense,string][]).map(([k, label]) => <div key={k}><span>{label}</span><b>{money(expenseByKey(yearRounds, k))}</b></div>)}</div></section>
      <PersonalHistoryPanel history={history} today={todayMx} onDelete={setPersonalHistoryToDelete} />
      <section className="card"><div className="sectionTitle"><div><h2>Rondas</h2><p>Más recientes primero. Los campos se guardan como snapshot.</p></div><button className="textButton" onClick={resetRound}>+ Nueva</button></div>
        <div className="historyFilters" aria-label="Filtrar rondas por fecha"><label>Año<select value={historyYear} onChange={(event) => setHistoryYear(event.target.value)}><option value="">Todos</option>{availableHistoryYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label>Mes<select value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}><option value="">Todos</option>{MONTH_LABELS.map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}</select></label></div>
        {!history.length ? <div className="empty">Todavía no has guardado rondas.</div> : !filteredHistory.length ? <div className="empty">No hay rondas en el periodo seleccionado.</div> : filteredHistory.map((r) => <div className="historyRound" key={r.id}><div className="historyRow"><div><b>{r.courseName}</b><span>{r.date} · {r.roundHoles || 18} hoyos · apuestas {money(r.betResult)} · gastos {money(r.expenseTotal)}</span></div><strong className={r.netResult >= 0 ? "good" : "bad"}>{money(r.netResult)}</strong></div><div className="historyActions"><button onClick={() => { setHistoryDetailId(r.id); setTab("historyDetail"); }}>Abrir ronda</button><button onClick={() => downloadRoundCsv(r)}>CSV</button><button onClick={() => downloadRoundPdf(r)}>PDF</button><button onClick={() => downloadRoundImage(r)}>Imagen</button><button onClick={() => shareRound(r)}>Compartir</button><label className="uploadButton">{r.photoId ? "Cambiar foto" : "Agregar foto de tarjeta"}<input type="file" accept="image/*" capture="environment" onChange={(event) => attachScorecardPhoto(r, event.target.files?.[0])} /></label>{r.photoId && <button onClick={() => viewScorecardPhoto(r)}>Ver tarjeta original</button>}<button className="dangerGhost" onClick={() => setHistoricalRoundToDelete(r)}>Eliminar ronda</button></div></div>)}
      </section>
    </>}

    {tab === "courses" && <>
      <section className="hero"><div><div className="eyebrow">CAMPO</div><h1>{courseDraft.name}</h1><p>Solo Par y Ventaja/SI. Las rondas históricas no cambian al editar este campo.</p>{courseDraft.updatedAt && <small>Última actualización: {courseDraft.updatedAt}</small>}</div><button className="secondary" onClick={duplicateCourseDraft}>Duplicar campo</button></section>
      <section className="card"><div><label>Nombre del campo</label><input value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} /></div></section>
      <section className="card"><div className="sectionTitle"><div><h2>Carga rápida</h2><p>Pega 18 ventajas/SI. Par es opcional si ya está correcto en la tabla.</p></div><button className="textButton" onClick={applyQuickCourseData}>Aplicar</button></div><div className="grid2"><div><label>Ventaja / SI (18 números)</label><textarea rows={3} placeholder="5, 17, 7, 1..." value={quickStroke} onChange={(e) => setQuickStroke(e.target.value)} /></div><div><label>Par (opcional, 18 números)</label><textarea rows={3} placeholder="4, 3, 4, 5..." value={quickPars} onChange={(e) => setQuickPars(e.target.value)} /></div></div></section>
      <section className="card"><div className="courseGrid simpleCourseGrid"><div className="courseGridHead">Hoyo</div><div className="courseGridHead">Par</div><div className="courseGridHead">Ventaja</div>{courseDraft.holes.map((h) => <div className="courseGridRow" key={h.number}><b>{h.number}</b><NumericCaptureInput min={3} max={6} value={h.par} emptyWhenZero={false} onValueChange={(par) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, par: par ?? h.par } : x) })} /><NumericCaptureInput min={1} max={18} value={h.strokeIndex} emptyWhenZero={false} onValueChange={(strokeIndex) => setCourseDraft({ ...courseDraft, holes: courseDraft.holes.map((x) => x.number === h.number ? { ...x, strokeIndex: strokeIndex ?? h.strokeIndex } : x) })} /></div>)}</div></section>
      <div className="courseDanger">{courseDraft.name === "La Vista Temporal" && <button className="secondary" onClick={restoreOriginalCourse}>Restablecer configuración original</button>}{!courseDraft.builtIn && <button className="removeCourse" onClick={deleteCourseDraft}>Eliminar campo personalizado</button>}</div>
      <div className="roundActions"><button className="secondary big" onClick={goBack}>← Regresar</button><button className="primary big" onClick={saveCourseDraft}>Guardar campo</button></div>
    </>}

    {(rulesVisited || tab === "rules") && <div hidden={tab !== "rules"}><RulesPanel active={tab === "rules"} courseName={rulesCourseContext} localRules={isLaVistaCourse(rulesCourseContext) ? course.localRules : undefined} localRulesUpdatedAt={isLaVistaCourse(rulesCourseContext) ? course.localRulesUpdatedAt : undefined} onBack={goBack} /></div>}
    {tab === "pollaLive" && <PollaLivePanel courses={courses} privateRound={{ active: draftAvailable && players.length > 0, players }} />}

    {frequentGroupDraft && <div className="modalBackdrop" role="presentation"><section className="groupEditorDialog" role="dialog" aria-modal="true" aria-labelledby="edit-group-title" aria-describedby="edit-group-description">
      <div className="groupEditorHeader"><h2 id="edit-group-title">Editar grupo frecuente</h2><p id="edit-group-description">Los cambios se aplicarán únicamente a futuras cargas del grupo.</p></div>
      <label>Nombre del grupo<input value={frequentGroupDraft.name} onChange={(event) => setFrequentGroupDraft((group) => group ? { ...group, name: event.target.value } : group)} /></label>
      <div className="groupEditorSectionTitle"><h3>Integrantes</h3><span>{frequentGroupDraft.players.length}</span></div>
      <div className="groupMemberList">{frequentGroupDraft.players.map((member, index) => <div className="groupMemberEditor" key={index}>
        <label>Jugador {index + 1}<input aria-label={`Nombre del integrante ${index + 1}`} value={member.name} onChange={(event) => editFrequentGroupMember(index, { name: event.target.value })} /></label>
        <label>HCP predeterminado<NumericCaptureInput aria-label={`HCP del integrante ${index + 1}`} inputMode="decimal" step={0.1} min={-15} max={54} placeholder="HCP" value={member.handicap} emptyWhenZero={false} onValueChange={(handicap) => editFrequentGroupMember(index, { handicap })} /></label>
        <div className="groupMemberActions"><button className="secondary" aria-label={`Subir a ${member.name}`} disabled={index === 0} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, -1) : group)}>↑</button><button className="secondary" aria-label={`Bajar a ${member.name}`} disabled={index === frequentGroupDraft.players.length - 1} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, 1) : group)}>↓</button><button className="dangerGhost" onClick={() => removeMemberFromFrequentGroup(index)}>Quitar</button></div>
      </div>)}</div>
      {!frequentGroupDraft.players.length && <div className="empty">Agrega al menos un integrante para guardar el grupo.</div>}
      <div className="groupMemberAdd"><div className="groupEditorSectionTitle"><h3>Agregar integrante</h3></div>
        <div className="segmented"><button className={groupMemberSource === "frequent" ? "active" : ""} disabled={!frequentPlayers.length} onClick={() => setGroupMemberSource("frequent")}>Jugador frecuente</button><button className={groupMemberSource === "new" ? "active" : ""} onClick={() => setGroupMemberSource("new")}>Jugador nuevo</button></div>
        {groupMemberSource === "frequent" && frequentPlayers.length > 0 && <div className="groupMemberAddRow"><label>Elegir jugador<select value={selectedGroupFrequentPlayerId} onChange={(event) => setSelectedGroupFrequentPlayerId(event.target.value)}>{frequentPlayers.map((player) => <option key={player.id} value={player.id}>{player.name} · HCP {player.handicap ?? "—"}</option>)}</select></label><button className="secondary" disabled={!selectedGroupFrequentPlayerId} onClick={addExistingPlayerToFrequentGroup}>Agregar</button></div>}
        {groupMemberSource === "new" && <><div className="groupMemberNewRow"><label>Nombre<input placeholder="Nombre del jugador" value={newGroupMember.name} onChange={(event) => setNewGroupMember((member) => ({ ...member, name: event.target.value }))} /></label><label>HCP predeterminado<NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={54} placeholder="HCP" value={newGroupMember.handicap} emptyWhenZero={false} onValueChange={(handicap) => setNewGroupMember((member) => ({ ...member, handicap }))} /></label></div><label className="checkRow"><input type="checkbox" checked={saveNewGroupMemberAsFrequent} onChange={(event) => setSaveNewGroupMemberAsFrequent(event.target.checked)} />Guardar como jugador frecuente</label><button className="secondary groupMemberAddButton" disabled={!newGroupMember.name.trim()} onClick={addNewPlayerToFrequentGroup}>Agregar jugador nuevo</button></>}
      </div>
      <div className="dialogActions"><button className="secondary" onClick={resetFrequentGroupEditor}>Cancelar</button><button className="primary" disabled={!frequentGroupDraft.name.trim() || !frequentGroupDraft.players.length || frequentGroupDraft.players.some((member) => !member.name.trim())} onClick={saveFrequentGroupEdit}>Guardar</button></div>
    </section></div>}

    {showDeleteRoundConfirm && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-round-title" aria-describedby="delete-round-description"><h2 id="delete-round-title">¿Eliminar esta ronda?</h2><p id="delete-round-description">Se eliminará la ronda en curso y sus datos capturados. Esta acción no se puede deshacer.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setShowDeleteRoundConfirm(false)}>Cancelar</button><button className="dangerButton" onClick={deleteActiveRound}>Eliminar ronda</button></div></section></div>}

    {historicalRoundToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-history-round-title" aria-describedby="delete-history-round-description"><h2 id="delete-history-round-title">¿Eliminar esta ronda del histórico?</h2><p id="delete-history-round-description">Esta acción eliminará definitivamente esta ronda guardada y sus resultados.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setHistoricalRoundToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={confirmHistoricalRoundDeletion}>Eliminar</button></div></section></div>}

    {personalHistoryToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-personal-history-title" aria-describedby="delete-personal-history-description"><h2 id="delete-personal-history-title">¿Eliminar este registro personal?</h2><p id="delete-personal-history-description">Esto eliminará este resultado del histórico de Personales contra {personalHistoryToDelete.rivalName}.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setPersonalHistoryToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={confirmPersonalHistoryDeletion}>Eliminar</button></div></section></div>}

    {frequentGroupToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-group-title" aria-describedby="delete-group-description"><h2 id="delete-group-title">¿Eliminar grupo guardado?</h2><p id="delete-group-description">Esto eliminará únicamente este grupo. No afectará jugadores ni rondas anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentGroupToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "frequent_group", frequentGroupToDelete.id); setFrequentGroups((groups) => resolveFrequentGroupDeletion(groups, frequentGroupToDelete.id, "delete")); if (frequentGroupDraft?.id === frequentGroupToDelete.id) resetFrequentGroupEditor(); setFrequentGroupToDelete(null); }}>Eliminar</button></div></section></div>}

    {frequentPlayerToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-frequent-title" aria-describedby="delete-frequent-description"><h2 id="delete-frequent-title">¿Eliminar jugador frecuente?</h2><p id="delete-frequent-description">Esto solamente lo eliminará de tu lista de jugadores frecuentes. No afectará rondas anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentPlayerToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "frequent_player", frequentPlayerToDelete.id); setFrequentPlayers((templates) => removeFrequentPlayerTemplate(templates, frequentPlayerToDelete.id)); if (editingFrequentPlayerId === frequentPlayerToDelete.id) setEditingFrequentPlayerId(null); setFrequentPlayerToDelete(null); }}>Eliminar</button></div></section></div>}

    {savedRivalToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-rival-title" aria-describedby="delete-rival-description"><h2 id="delete-rival-title">¿Eliminar rival guardado?</h2><p id="delete-rival-description">Esto solamente lo eliminará de tu lista de rivales para futuras apuestas personales. No afectará rondas ni resultados anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setSavedRivalToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "rival", savedRivalToDelete.id); setSavedPersonalRivals((templates) => removeSavedPersonalRivalTemplate(templates, savedRivalToDelete.id)); if (editingSavedRivalId === savedRivalToDelete.id) { setEditingSavedRivalId(null); setSavedRivalDraft(null); } setSavedRivalToDelete(null); }}>Eliminar</button></div></section></div>}

    {tab !== "welcome" && <nav className="bottomNav"><button onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Inicio)}><span>⌂</span>Inicio</button><button className={tab === "round" || tab === "standings" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Tarjeta)}><span>{roundHoles}</span>Tarjeta</button><button className={tab === "personals" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Personales)}><span>↔</span>Personales</button><button className={tab === "results" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Resultados)}><span>$</span>Resultados</button><button className={tab === "history" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Histórico)}><span>↗</span>Histórico</button><button className={tab === "rules" ? "active" : ""} onClick={() => navigateFromBottomBar(BOTTOM_NAV_TARGETS.Reglas)}><span>⚑</span>Reglas</button></nav>}
  </main>;
}

export default function Page() {
  return <AccountProvider><GolfBetsApp /></AccountProvider>;
}
