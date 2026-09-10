"use client";
import "./functional-ux.css";
import { initialBets, restoreBetConfig } from "../lib/new-round-bets";
import { collectBetConfigurationIssues } from "../lib/bet-config-validation";
import { isFiniteZeroSum } from "../lib/settlement-integrity";
import { freezeRoundHandicapBases, missingHandicapsForActiveBets, normalizeRoundHandicapBasis } from "../lib/handicap-base";
import { HandicapBaseControl } from "./components/handicap-base-control";
import { RoundHandicapBasisControl } from "./components/round-handicap-basis-control";
import { SetupBetCard } from "./components/setup-bet-card";
import { BET_PRESENTATION, betDisplayLabel, historicalBetDisplayLabel, SUPPLEMENTAL_BET_PRESENTATION, supplementalBetDisplayLabel } from "../lib/bet-catalog";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AdvancedStatsByHole,
  BallFriendHole,
  BetConfig,
  Course,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  CounterBetPeriod,
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
  PlayerTeeAssignmentSnapshot,
  RabbitMode,
  RoundHandicapBasis,
  RoundPresentation,
  RoundSnapshot,
  ScoreCaptureMode,
  SavedPersonalRival,
  SkinsMode,
  SupplementalBet,
  PuttsByHole,
  UnitEvent,
} from "../lib/types";
import { activeBetSafeDestination, activeRoundContinueTarget, contrastToggleLabel, resolveActiveRoundStatus, rulesContextForRound, type AppTab } from "../lib/app-navigation";
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
  normalizeFoursomeSegments,
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
import { resolveRoundDraftCore, resolvedOwnerIdForRoundDraft } from "./draft-restoration";
import { accountDeletionMarkerKey, ACCOUNT_STORAGE_KEYS, hasCurrentBettingDataConsent, parseLegalAcceptances } from "../lib/account-state";
import { AccountPanel } from "./components/account-panel";
import { BrandLockup } from "./components/brand-lockup";
import { GroupBuilder } from "./components/group-builder";
import { AppBottomNav } from "./components/app-bottom-nav";
import { HomeDashboard, type ActiveRoundSummary } from "./components/home-dashboard";
import { PlayHub } from "./components/play-hub";
import type { AiRoundSetupTelemetry } from "./components/backyard-ai/ai-round-setup";
import { RoundFinalResult } from "./components/backyard-ai/round-final-result";
import { SocialFeed } from "./components/social-feed";
import { StatsDashboard } from "./components/stats-dashboard";
import { BalanceLedgerPanel } from "./components/balance-ledger-panel";
import { CourseLibrary } from "./components/course-library";
import { PersonalHistoryPanel } from "./components/personal-history-panel";
import { PersonalOpponentResults } from "./components/personal-opponent-results";
import { useScreenNavigation } from "./components/use-screen-navigation";
import { applyPendingScoreEdits, commitHoleCapture, editCapturedScore, holeCapture, isHoleCaptureComplete, type ScoreRows } from "../lib/score-capture";
import { foursomePressure, setFoursomePressure } from "../lib/foursome-config";
import { FoursomeLive } from "./components/foursome-live";
import { ResultAccordion } from "./components/result-accordion";
import { HistoricalRoundDetail } from "./components/historical-round-detail";
import { FullScorecard } from "./components/full-scorecard";
import { RoundCaptureV2 } from "./components/round-capture-v2";
import { GolfLeaderboard } from "./components/golf-leaderboard";
import { restoreRoundSnapshot, resultSummaryText } from "../lib/round-editing";
import { abandonedPressurePlayersWithMissingScores, firstIncompleteRoundCapture, incompleteCoreBetSettlements, incompleteExternalPersonalBets, requiredRoundCaptureFactErrors, unsettledSupplementalBetResults } from "../lib/round-completion";
import { migrateSupplementalNassau } from "../lib/nassau-migration";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { snapshotPersonalResult } from "../lib/personal-history";
import { createHoleSummarySession, nextHoleDestination, type HoleSummarySession } from "../lib/hole-summary";
import { buildHoleSummary, clearActiveRoundStorage, hasRoundProgress, mergeCoursesPreservingEdits, normalizeRoundDraft, persistRoundHistory, privateLeaderboard, pushUndoState, readStoredJson, resolveHistoricalRoundDeletion, resolvePersonalHistoryDeletion, STORAGE_KEYS, upsertFrequentPlayers } from "../lib/round-utils";
import { monkeyHoleSummary, personalHoleSummary } from "../lib/personal-summary";
import { downloadRoundCsv, downloadRoundImage, downloadRoundPdf, shareRound } from "../lib/round-export";
import { adoptScorecardPhotos, deleteScorecardPhoto, deleteScorecardPhotoCloud, markScorecardPhotosCommitted, readScorecardPhoto, readScorecardPhotoCloud, resolveScorecardPhotoCommit, saveScorecardPhoto, uploadScorecardPhotoCloud } from "../lib/scorecard-photo";
import { createRoundSetupDraft, type RoundSetupCourseIdentity, type RoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import { coursesForPendingIdentity, normalizeRoundSetupCourseIdentity, resolveManualRoundCourseState } from "../lib/backyard-ai/runtime/manual-course-focus";
import type { ScorecardValidationOverrides, ScorecardValidationResult } from "../lib/backyard-ai/schemas/scorecard";
import { buildDeterministicRoundRecap } from "../lib/backyard-ai/recap/round-recap";
import { recordRoundCompletionMetric, recordRoundSetupMetrics, recordScorecardMetrics, recordScorecardOutcomeMetrics, updateBackyardAiMetrics } from "../lib/backyard-ai/observability/metrics";
import type { ScorecardCorrectionEvidence } from "../lib/backyard-ai/observability/scorecard-telemetry";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, appendLearningRecord, createPersonalLearningEvent, createScorecardCorrection, readLearningConsent, scorecardCorrectionLearningEvent } from "../lib/backyard-ai/memory/learning-events";
import { buildRoundSetupCorrectionRecords } from "../lib/backyard-ai/memory/setup-learning";
import { persistUserPreference } from "../lib/backyard-ai/memory/personal-memory";
import { persistGroupPreference } from "../lib/backyard-ai/memory/group-memory";
import type { GroupPreference, UserPreference } from "../lib/backyard-ai/memory/types";
import { normalizeMexicanSpanish } from "../lib/backyard-ai/runtime/intent-parser";
import { roundSetupChangeContainsBettingData, runRoundSetupActionWithBettingConsent } from "../lib/backyard-ai/runtime/betting-consent-boundary";
import { actionableCloudConflicts, CLOUD_TOMBSTONES_KEY, cloudDataFingerprint, cloudSyncPayloadFingerprint, collectLocalCloudData, downloadCloudData, findActiveDraftOwnershipConflicts, findAmbiguousCloudConflicts, hasLocalCloudPreferenceState, isCloudFieldConflict, mergeLocalFirstActiveDraft, persistCloudMetadata, resolveAmbiguousCloudConflicts, restoreLocalRoundUi, stableValue, trackLocalCloudCheckpoint, trackLocalCloudEdits, type CloudDataBundle, type CloudDataConflict, recordCloudDeletion, uploadCloudData, withCloudAuthRetry } from "../lib/cloud-sync";
import { describeCloudConflict } from "../lib/cloud-conflict-display";
import { ownsLocalWorkspace, preserveDataConflicts, preserveDraftConflict } from "../lib/account-workspace";
import { accountPrimaryPlayerId, accountPrimaryRoundPlayer, syncAccountPrimaryFrequentPlayer, syncLinkedRoundPlayerName } from "../lib/account-primary-player";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { CloudSyncGate, cloudSyncErrorMessage, syncStatusAfterSkip, type CloudSyncTrigger } from "../lib/cloud-sync-gate";
import { adoptGuestPhotoJobs, flushPhotoQueue, queuePhoto, photoJobs, roundScorecardPhotoIds } from "../lib/photo-sync-queue";
import { acknowledgeOfflineBundle, getOfflineDeviceId, markOfflineAttempt, offlineRetryDelayMs, persistOfflineBundle, restoreOfflineWorkspace, writeCloudBundleToStorage } from "../lib/offline-store";
import { PRIVATE_POLLA_LINK_KEY, parsePrivatePollaLink, privatePollaScoreChanges } from "../lib/polla-private-link";
import { enqueuePollaScore } from "../lib/polla-offline";
import { isLaVistaCourse, withDefaultLaVistaRules } from "../lib/local-rules";
import { DEFAULT_COURSES, DEFAULT_LA_VISTA_COURSE } from "../lib/golf-course-directory";
import { filterHistory, historyYears, MONTH_LABELS } from "../lib/history-filters";
import { priorRabbitStatus, priorSkinsStatus } from "../lib/prior-hole-status";
import { ballFriendScoreResult, ballFriendSetupChipLabel, lobaSetupChipLabel, playerHoleBetLabels, skinHoleNotice } from "../lib/hole-bet-display";
import { calculateSupplementalBets, normalizeSupplementalBets, supplementalBetsForRoundHoles, supplementalBetValue } from "../lib/supplemental-bets";
import { isPersonalSupplementalType, setRememberedCategoryEnabled } from "../lib/bet-activation";
import { buildPersonalOpponentResults } from "../lib/personal-opponents";
import { persistPendingRoundReview, persistRoundDraftCheckpoint, ROUND_REVIEW_NOTICE } from "../lib/round-review";
import { normalizeHistoricalRoundLifecycle, normalizeRoundStartedAt, withDerivedRoundLifecycle } from "../lib/round-lifecycle";
import { backupActiveRoundForReplacement } from "../lib/new-round-safety";
import { normalizeAdvancedStats, normalizeScoreCaptureMode, updateAdvancedHoleStat } from "../lib/advanced-stats";
import { viperQuantityFromPutts } from "../lib/round-capture";
import { groupNassauPresentation, normalizeRoundPresentation } from "../lib/round-presentation";
import { BetHelpButton, SupplementalBetsEditor, SupplementalBetResults } from "./components/supplemental-bets-editor";
import { buildGeneralResultsTable, pollaDetailBalance, pollaDetailBalances, pollaPositionLabels, summarizeNetUnitQuantities, type ResultCategoryColumn } from "../lib/result-breakdown";
import { collectHoleValidationErrors } from "../lib/hole-validation";
import { buildGolfInsights, buildPersonalActivity, type PersonalActivity } from "../lib/golf-insights";
import { buildHistoricalRoundRecap } from "../lib/historical-round-recap";
import { coursePreferenceStorageKey, normalizeCourseIds, rememberRecentCourse, toggleFavoriteCourse } from "../lib/course-preferences";
import {
  calculateCounterBet,
  calculateLoba,
  confirmCounterQuantity,
  COUNTER_BET_META,
  counterCaptureQuantity,
  counterQuantity,
  counterBetSecondNineMultiplier,
  counterBetSecondNinePressed,
  emptyCounterBetKeepers,
  normalizeCounterBetEvents,
  setCounterDistance,
  setCounterQuantity,
  snapshotCounterBetEvents,
  updateCounterBetKeeper,
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
  frequentGroupMemberFromFrequentPlayer,
  moveFrequentGroupMember,
  parseFrequentGroups,
  personalRivalTemplateFromBet,
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
import { hasDuplicateGroupPlayers } from "../lib/group-generator";
import { createGroupGameTemplate, frequentGroupTemplateSummary, instantiateGroupGameTemplate, normalizeRoundTemplateOrigin, updateGroupTemplateFromRound, type RoundTemplateOrigin } from "../lib/group-game-template";
import { assignTeeToEveryPlayer, reconcilePlayerTeeAssignments, teeOptionsForCourse, updatePlayerTeeAssignment } from "../lib/player-tee-assignments";
import { defaultMaxBaseAppearances, generateAutomaticFoursomes, markFoursomeSegmentEdited } from "../lib/foursome-generator";
import { advantageFieldsFromSigned, configureCurrentIndexPersonal, configureSlidingPersonal, frequentPersonalSuggestions, slidingAdjustment } from "../lib/personal-modes";
import { loadEquipmentProfile, type PlayerClub } from "../lib/golf-equipment";

const AiRoundSetup = dynamic(() => import("./components/backyard-ai/ai-round-setup").then((module) => module.AiRoundSetup), { ssr: false });
const ScorecardScanner = dynamic(() => import("./components/backyard-ai/scorecard-scanner").then((module) => module.ScorecardScanner), { ssr: false });
const makeId = () => Math.random().toString(36).slice(2, 10);
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-MX")}`;
const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;

function frequentGroupHasDuplicateMembers(group: FrequentGroup) {
  return hasDuplicateGroupPlayers(group.players.map((member, index) => ({ id: `member-${index}`, ...member })));
}

const laVista = DEFAULT_LA_VISTA_COURSE;
const defaultCourses = DEFAULT_COURSES;

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
  return mergeCoursesPreservingEdits(defaultCourses, saved).map(withDefaultLaVistaRules);
}

const emptyExpenses: Expense = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };
const RABBIT_MODE_OPTIONS: ReadonlyArray<{ value: RabbitMode; label: string; description: string }> = [
  { value: "continuous", label: "Conejos continuos", description: "Al ganar un conejo puede comenzar uno nuevo." },
  { value: "three_hole_blocks", label: "6 Conejos", description: "Un conejo por cada bloque de 3 hoyos." },
];
const SKINS_MODE_OPTIONS: ReadonlyArray<{ value: SkinsMode; label: string; description: string }> = [
  { value: "carry", label: "Acumulables", description: "Los skins sin ganador pasan al siguiente hoyo." },
  { value: "no_carry", label: "No acumulables", description: "Cada hoyo vale 1 skin; los empates no se acumulan." },
];

function captureClubLabel(club: PlayerClub) {
  if (club.customModel) return club.customModel;
  const category = club.category === "DRIVER" ? "Driver"
    : club.category === "MINI_DRIVER" ? "Mini Driver"
      : club.category === "FAIRWAY_WOOD" ? "Madera"
        : club.category === "HYBRID" ? "Híbrido"
          : club.category === "UTILITY_IRON" ? "Utility"
            : club.category === "IRON_SET" ? "Hierro"
              : club.category === "WEDGE" ? "Wedge"
                : "Putter";
  return club.loft ? `${category} ${club.loft}°` : category;
}

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

function normalizeHistorySnapshot(round: RoundSnapshot): RoundSnapshot {
  return normalizeHistoricalRoundLifecycle(migrateSupplementalNassau({
    ...round,
    presentation: normalizeRoundPresentation(round.presentation),
    expenses: normalizeExpenses(round.expenses),
    scoreCaptureMode: normalizeScoreCaptureMode(round.scoreCaptureMode),
    advancedStats: normalizeAdvancedStats(round.advancedStats),
  }));
}

function Toggle({ on, onClick, label = "activar", disabled = false }: { on: boolean; onClick: () => void; label?: string; disabled?: boolean }) {
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={onClick} aria-label={label} title={disabled ? "Completa el consentimiento específico desde Mi Cuenta" : undefined} disabled={disabled}><span /></button>;
}

function SetupModeTitle({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <span className="setupModeTitle"><b>{icon} {title}</b><small>{description}</small></span>;
}

function BetModeControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T | null | undefined;
  options: ReadonlyArray<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return <div className="betModeControl">
    <span className="miniLabel" id={`${label}-mode-label`}>Modalidad</span>
    <div className="segmented" role="group" aria-labelledby={`${label}-mode-label`}>
      {options.map((option) => <button type="button" key={option.value} className={option.value === selected?.value ? "active" : ""} aria-pressed={option.value === selected?.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
    <p>{selected?.description ?? "Selecciona una modalidad válida para continuar."}</p>
  </div>;
}

function ParticipantChips({
  players, selected, onChange,
}: { players: Player[]; selected: string[] | undefined; onChange: (ids: string[]) => void }) {
  const selectedIds = Array.isArray(selected) ? selected : [];
  return <div className="chips">{players.map((p) => {
    const on = selectedIds.includes(p.id);
    return <button key={p.id} className={`chipButton ${on ? "selected" : ""}`} onClick={() => {
      onChange(on ? selectedIds.filter((id) => id !== p.id) : [...selectedIds, p.id]);
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

function HandicapModeSelect({ value, onChange }: { value: unknown; onChange: (mode: HandicapMode) => void }) {
  const known = value === "partial" || value === "round" || value === "decimal" || value === "half_up" || value === "half_down" || value === "six_up" || value === "four_down";
  const selected = known ? normalizeHandicapMode(value as HandicapMode) : "";
  return <div><label>Modo HCP</label><select value={selected} onChange={(e) => onChange(e.target.value as HandicapMode)}>
    <option value="" disabled>Selecciona</option>
    <option value="decimal">Décimas / sin redondear</option>
    <option value="half_up">.5 sube</option>
    <option value="half_down">.5 baja</option>
    <option value="six_up">.6 sube</option>
    <option value="four_down">.4 baja</option>
  </select></div>;
}

function DecimalModeSelect({
  label = "Decimales",
  value,
  onChange,
}: {
  label?: string;
  value: unknown;
  onChange: (mode: "partial" | "round") => void;
}) {
  const selected = value === "partial" || value === "round" ? value : "";
  return <div><label>{label}</label><select value={selected} onChange={(event) => onChange(event.target.value as "partial" | "round")}>
    <option value="" disabled>Selecciona</option>
    <option value="round">Redondear</option>
    <option value="partial">Cuentan</option>
  </select></div>;
}

function PollaBetEditor({
  title, icon, description, config, players, onChange, unavailable, trophy = "gold", requestActivation, locked = false,
}: {
  title: string;
  icon: string;
  description: string;
  config: MedalPollaConfig;
  players: Player[];
  onChange: (config: MedalPollaConfig) => void;
  unavailable?: boolean;
  trophy?: "silver" | "gold";
  requestActivation?: () => Promise<boolean>;
  locked?: boolean;
}) {
  return <SetupBetCard id={title.replace(/\W+/g, "-").toLowerCase()} icon={icon} title={title} description={description} help="polla" enabled={config.enabled} locked={locked} requestActivation={requestActivation} onEnabledChange={(enabled) => onChange({ ...config, enabled })}>
      <span className="visuallyHidden"><TrophyIcon tone={trophy} /></span>
      <div className="grid3">
        <MoneyInput label="Valor" value={config.value} onChange={(value) => onChange({ ...config, value })} />
        <HcpPercentInput value={config.hcpPct} onChange={(hcpPct) => onChange({ ...config, hcpPct })} />
        <DecimalModeSelect value={config.decimals} onChange={(decimals) => onChange({ ...config, decimals })} />
      </div>
      <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={config.participantIds} onChange={(participantIds) => onChange({ ...config, participantIds })} />
      <div className="hint">Cada valor es por jugador. El pozo se reparte entre los ganadores si empatan.{unavailable ? " Esta apuesta requiere una ronda de 18 hoyos." : ""}</div>
  </SetupBetCard>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div><label>{label}</label><div className="moneyField"><span>$</span><NumericCaptureInput inputMode="decimal" min={0} value={value} onValueChange={(next) => onChange(next ?? 0)} /></div></div>;
}

type NewRoundIntent =
  | { kind: "blank" }
  | { kind: "ai" }
  | { kind: "players"; players: Player[] }
  | { kind: "group"; group: FrequentGroup };

function GolfBetsApp() {
  const { identity, bettingConsentGranted, requestBettingConsent, cloudLinked, cloudStatus, setCloudStatus, applyCloudPreferences, reportCloudSyncError, clearCloudSyncError, refreshCloudSession } = useBackyardAccount();
  const { tab, setTab, goBack, setNavigationGuard } = useScreenNavigation();
  const ownerClubChoices = useMemo(() => {
    if (typeof window === "undefined" || tab !== "round") return [];
    const loaded = loadEquipmentProfile(localStorage, identity.userId);
    if (!loaded.ok || !loaded.profile) return [];
    return [...new Set(loaded.profile.clubs.filter((club) => club.isCurrent).map(captureClubLabel))];
  }, [identity.userId, tab]);
  const [rulesVisited, setRulesVisited] = useState(false);
  useEffect(() => { if (tab === "rules") setRulesVisited(true); }, [tab]);
  const [personalDetailId] = useState<string | null>(null);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [editingRound, setEditingRound] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [pendingRoundAction, setPendingRoundAction] = useState<{ message: string; run: () => void } | null>(null);
  const [pendingCloudConflict, setPendingCloudConflict] = useState<{ local: CloudDataBundle; cloud: CloudDataBundle; conflicts: CloudDataConflict[] } | null>(null);
  const [courses, setCourses] = useState<Course[]>(defaultCourses);
  const [favoriteCourseIds, setFavoriteCourseIds] = useState<string[]>([]);
  const [recentCourseIds, setRecentCourseIds] = useState<string[]>([]);
  const [course, setCourse] = useState<Course>(laVista);
  const [courseSelected, setCourseSelected] = useState(false);
  const [pendingCourseIdentity, setPendingCourseIdentity] = useState<RoundSetupCourseIdentity | null>(null);
  const [courseSelectionError, setCourseSelectionError] = useState(false);
  const [showBetSetupErrors, setShowBetSetupErrors] = useState(false);
  const [courseDraft, setCourseDraft] = useState<Course>(laVista);
  const [courseEditorSelectOnSave, setCourseEditorSelectOnSave] = useState(false);
  const [startHole, setStartHole] = useState<1 | 10>(1);
  const [roundHoles, setRoundHoles] = useState<9 | 18>(18);
  const [roundHandicapBasis, setRoundHandicapBasis] = useState<RoundHandicapBasis>("relative");
  const [roundPresentation, setRoundPresentation] = useState<RoundPresentation>(() => normalizeRoundPresentation(undefined));
  const groupNassauLabels = useMemo(() => groupNassauPresentation(roundPresentation), [roundPresentation]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerTeeAssignments, setPlayerTeeAssignments] = useState<PlayerTeeAssignmentSnapshot[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [bets, setBets] = useState<BetConfig>(() => initialBets([]));
  const [segments, setSegments] = useState<FoursomeSegment[]>(() => segmentDefinitions(playOrder(1), 6));
  const [foursomeMaxBaseAppearances, setFoursomeMaxBaseAppearances] = useState(2);
  const [foursomeGenerationMessage, setFoursomeGenerationMessage] = useState("");
  const [personalBets, setPersonalBets] = useState<PersonalBet[]>([]);
  const [savedPersonalRivals, setSavedPersonalRivals] = useState<SavedPersonalRival[]>([]);
  const [dismissedFrequentPersonalIds, setDismissedFrequentPersonalIds] = useState<string[]>([]);
  const [manualBets, setManualBets] = useState<ManualBet[]>([]);
  const [supplementalBets, setSupplementalBets] = useState<SupplementalBet[]>([]);
  const [putts, setPutts] = useState<PuttsByHole>({});
  const [scoreCaptureMode, setScoreCaptureMode] = useState<ScoreCaptureMode>("quick");
  const [advancedStats, setAdvancedStats] = useState<AdvancedStatsByHole>({});
  const [showFullScorecard, setShowFullScorecard] = useState(false);
  const [scores, setScores] = useState<Record<number, HoleScore>>({});
  const [scoreEdits, setScoreEdits] = useState<ScoreRows>({});
  const [scorecardPhotoIds, setScorecardPhotoIds] = useState<string[]>([]);
  const [scorecardScanStartedAt, setScorecardScanStartedAt] = useState<number | null>(null);
  const [scorecardScale, setScorecardScale] = useState(100);
  const [unitEvents, setUnitEvents] = useState<UnitEvent[]>([]);
  const [counterBetEvents, setCounterBetEvents] = useState<CounterBetEvent[]>([]);
  const [counterBetKeepers, setCounterBetKeepers] = useState<CounterBetKeepers>(emptyCounterBetKeepers);
  const [lobaHoles, setLobaHoles] = useState<Record<number, LobaHole>>({});
  const [ballFriendSetup, setBallFriendSetup] = useState<Record<number, BallFriendHole>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const [expenses, setExpenses] = useState<Expense>(emptyExpenses);
  const [history, setHistory] = useState<RoundSnapshot[]>([]);
  const [roundId, setRoundId] = useState(makeId());
  const [roundDate, setRoundDate] = useState(localDateMexico());
  const [roundStartedAt, setRoundStartedAt] = useState<string | null>(null);
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
  const [personalSetupOpen, setPersonalSetupOpen] = useState(false);
  const [nassauSetupOpen, setNassauSetupOpen] = useState(false);
  const [manualSetupOpen, setManualSetupOpen] = useState(false);
  const [expandedPersonalId, setExpandedPersonalId] = useState<string | null>(null);
  const personalSetupListRef = useRef<HTMLDivElement>(null);
  const pendingPersonalFocus = useRef<string | null>(null);
  const manualSetupListRef = useRef<HTMLElement>(null);
  const pendingManualFocus = useRef<string | null>(null);
  const [openResultSections, setOpenResultSections] = useState<Record<string, boolean>>({ "golf-result": true, "final-player-summary": true, "general-summary": true });
  const [pendingResultScroll, setPendingResultScroll] = useState<string | null>(null);
  const [highContrast, setHighContrast] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [roundClosed, setRoundClosed] = useState(false);
  const [roundReviewPending, setRoundReviewPending] = useState(false);
  const [showRoundFinishedNotice, setShowRoundFinishedNotice] = useState(false);
  const [historyYear, setHistoryYear] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
  const [frequentPlayers, setFrequentPlayers] = useState<FrequentPlayer[]>([]);
  const [frequentGroups, setFrequentGroups] = useState<FrequentGroup[]>([]);
  const [roundTemplateOrigin, setRoundTemplateOrigin] = useState<RoundTemplateOrigin | null>(null);
  const [groupName, setGroupName] = useState("");
  const [frequentGroupDraft, setFrequentGroupDraft] = useState<FrequentGroup | null>(null);
  const [frequentGroupEditError, setFrequentGroupEditError] = useState("");
  const [frequentGroupToDelete, setFrequentGroupToDelete] = useState<FrequentGroup | null>(null);
  const [groupMemberSource, setGroupMemberSource] = useState<"frequent" | "new">("frequent");
  const [selectedGroupFrequentPlayerId, setSelectedGroupFrequentPlayerId] = useState("");
  const [newGroupMember, setNewGroupMember] = useState<{ name: string; handicap: number | null }>({ name: "", handicap: null });
  const [saveNewGroupMemberAsFrequent, setSaveNewGroupMemberAsFrequent] = useState(false);
  const [pendingGroupFrequentPlayers, setPendingGroupFrequentPlayers] = useState<Array<Pick<Player, "name" | "handicap">>>([]);
  const [privateBoardMode, setPrivateBoardMode] = useState<"gross" | "net">("net");
  const [undoCount, setUndoCount] = useState(0);
  const [showDeleteRoundConfirm, setShowDeleteRoundConfirm] = useState(false);
  const [showNewRoundConfirm, setShowNewRoundConfirm] = useState(false);
  const [newRoundBackupError, setNewRoundBackupError] = useState("");
  const [pendingNewRoundIntent, setPendingNewRoundIntent] = useState<NewRoundIntent | null>(null);
  const [editingFrequentPlayerId, setEditingFrequentPlayerId] = useState<string | null>(null);
  const [frequentPlayerDraft, setFrequentPlayerDraft] = useState<{ name: string; handicap: number | null }>({ name: "", handicap: null });
  const [frequentPlayerToDelete, setFrequentPlayerToDelete] = useState<FrequentPlayer | null>(null);
  const [editingSavedRivalId, setEditingSavedRivalId] = useState<string | null>(null);
  const [savedRivalDraft, setSavedRivalDraft] = useState<SavedPersonalRival | null>(null);
  const [savedRivalToDelete, setSavedRivalToDelete] = useState<SavedPersonalRival | null>(null);
  const [historicalRoundToDelete, setHistoricalRoundToDelete] = useState<RoundSnapshot | null>(null);
  const [personalHistoryToDelete, setPersonalHistoryToDelete] = useState<{ roundId: string; resultIndex: number; rivalName: string } | null>(null);
  const [rulesCourseContext, setRulesCourseContext] = useState("");
  const undoStack = useRef<Array<{ scores: Record<number, HoleScore>; scoreEdits: ScoreRows; putts: PuttsByHole; advancedStats: AdvancedStatsByHole; unitEvents: UnitEvent[]; counterBetEvents: CounterBetEvent[]; counterBetKeepers: CounterBetKeepers; lobaHoles: Record<number, LobaHole>; manualBets: ManualBet[]; ballFriendSetup: Record<number, BallFriendHole> }>>([]);
  const holeSummarySession = useRef<HoleSummarySession | null>(null);
  const holeSummaryPointerStart = useRef<{ x: number; y: number } | null>(null);
  const [holeSummaryPaused, setHoleSummaryPaused] = useState(false);
  const flushLocalState = useRef<(() => boolean) | null>(null);
  const localPersistRevision = useRef(0);
  const requestCloudSync = useRef<(() => void) | null>(null);
  const latestSaveAndAdvance = useRef<() => void>(() => undefined);
  const latestSaveRound = useRef<(options?: { prepareReview?: boolean }) => void>(() => undefined);
  const roundSaveInFlight = useRef(false);
  const bettingActionPending = useRef(false);
  const hasPersistedBettingConsent = () => bettingConsentGranted || hasCurrentBettingDataConsent(
    parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances)),
    identity.userId,
  );
  const runAfterBettingConsent = (action: () => void) => {
    if (hasPersistedBettingConsent()) { action(); return; }
    if (bettingActionPending.current) return;
    bettingActionPending.current = true;
    void requestBettingConsent().then((accepted) => { if (accepted) action(); }).finally(() => { bettingActionPending.current = false; });
  };
  function hasActiveBettingConfiguration() {
    return [
      bets.rabbits, bets.skins, bets.units, bets.foursome, bets.ballFriend,
      bets.monkey, bets.polla.first9, bets.polla.second9, bets.polla.total18,
      bets.miniPolla, bets.vipers, bets.camels, bets.fish, bets.loba,
    ].some((config) => Boolean(config?.enabled))
      || personalBets.some((bet) => bet.enabled !== false)
      || supplementalBets.some((bet) => bet.enabled !== false)
      || manualBets.some((bet) => bet.enabled !== false)
      || Object.values(expenses).some((value) => value !== 0);
  }
  function ensureRoundStarted() {
    if (roundStartedAt || roundReviewPending) return roundStartedAt;
    const hasConfirmedScore = Object.values(scores).some((row) => Object.values(row).some((score) => typeof score === "number"));
    if (hasConfirmedScore) return null;
    const startedAt = new Date().toISOString();
    setRoundStartedAt(current => current ?? startedAt);
    return startedAt;
  }
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    if (tab !== "round") {
      holeSummarySession.current?.dispose();
      holeSummarySession.current = null; setHoleSummaryPaused(false); setHoleSummary([]);
    }
  }, [tab]);
  useEffect(() => {
    const targetId = pendingPersonalFocus.current;
    if (tab !== "setup" || !personalSetupOpen || !targetId || expandedPersonalId !== targetId) return;
    const section = Array.from(personalSetupListRef.current?.querySelectorAll<HTMLElement>("[data-personal-editor]") || []).find((element) => element.dataset.personalEditor === targetId);
    if (!section) return;
    pendingPersonalFocus.current = null;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [tab, personalSetupOpen, expandedPersonalId, personalBets]);
  useEffect(() => {
    const targetId = pendingManualFocus.current;
    if (tab !== "setup" || !manualSetupOpen || !targetId) return;
    const section = Array.from(manualSetupListRef.current?.querySelectorAll<HTMLElement>("[data-manual-editor]") || []).find((element) => element.dataset.manualEditor === targetId);
    if (!section) return;
    pendingManualFocus.current = null;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [tab, manualSetupOpen, manualBets]);
  useEffect(() => {
    const id = pendingResultScroll;
    if (tab !== "results" || !id || !openResultSections[id]) return;
    const section = document.getElementById(`result-section-${id}`);
    if (!section) return;
    setPendingResultScroll(null);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab, openResultSections, pendingResultScroll]);
  const liveIdentity = useRef(identity);
  useEffect(() => { liveIdentity.current = identity; }, [identity]);
  const hadLocalPreferences = useRef(false);
  const changeHighContrast = useCallback((value: boolean) => {
    hadLocalPreferences.current = true;
    setHighContrast(value);
  }, []);
  const changeNotifications = useCallback((value: boolean) => {
    hadLocalPreferences.current = true;
    setNotificationsEnabled(value);
  }, []);

  const order = useMemo(() => playOrder(startHole).slice(0, roundHoles), [startHole, roundHoles]);
  const protectedScorecardPhotoIds = useMemo(() => [...new Set([
    ...scorecardPhotoIds,
    ...history.flatMap(roundScorecardPhotoIds),
  ])], [history, scorecardPhotoIds]);
  const holeNumber = order[currentIndex];
  const hole = course.holes.find((h) => h.number === holeNumber) ?? course.holes[0];
  const courseOptions = useMemo(() => [...courses].sort((left, right) => (
    left.name.localeCompare(right.name, "es-MX") || left.teeName.localeCompare(right.teeName, "es-MX")
  )), [courses]);
  const teeOptions = useMemo(() => courseSelected ? teeOptionsForCourse(course, courseOptions) : [], [course, courseOptions, courseSelected]);
  const pendingCourseCandidates = useMemo(
    () => coursesForPendingIdentity(courseOptions, pendingCourseIdentity),
    [courseOptions, pendingCourseIdentity],
  );
  const pendingCourseCandidateIds = useMemo(
    () => new Set(pendingCourseCandidates.map((candidate) => candidate.id)),
    [pendingCourseCandidates],
  );
  const otherCourseOptions = useMemo(
    () => courseOptions.filter((candidate) => !pendingCourseCandidateIds.has(candidate.id)),
    [courseOptions, pendingCourseCandidateIds],
  );
  const privateBoard = useMemo(() => privateLeaderboard(course, players, scores, order), [course, players, scores, order]);
  const completedHoles = useMemo(() => new Set(order.filter(number => players.length > 0 && players.every(player => typeof scores[number]?.[player.id] === "number"))), [order, players, scores]);
  const scoreDraft = useMemo(() => holeCapture(scores, scoreEdits, hole, players), [scores, scoreEdits, hole, players]);
  const scoreCaptureComplete = isHoleCaptureComplete(scores, scoreEdits, holeNumber, players);
  const missingActiveHandicapPlayers = useMemo(() => missingHandicapsForActiveBets(players, bets, supplementalBets), [players, bets, supplementalBets]);
  const betConfigurationIssues = useMemo(() => collectBetConfigurationIssues({
    players,
    ownerId,
    bets,
    segments,
    personalBets,
    supplementalBets,
    manualBets,
    roundHoles,
    startHole,
    handicapBasis: roundHandicapBasis,
  }), [players, ownerId, bets, segments, personalBets, supplementalBets, manualBets, roundHoles, startHole, roundHandicapBasis]);
  useEffect(() => {
    if (!courseSelected) { setPlayerTeeAssignments([]); return; }
    setPlayerTeeAssignments((current) => reconcilePlayerTeeAssignments(current, players, course, new Date().toISOString()));
  }, [course, courseSelected, players]);
  useEffect(() => {
    setNavigationGuard((next) => {
      const safeDestination = activeBetSafeDestination(next, draftAvailable && !roundClosed && betConfigurationIssues.length > 0);
      if (safeDestination !== next) {
        setShowBetSetupErrors(true);
        setEditingRound(true);
        setFeedback("Corrige las apuestas activas antes de abrir la tarjeta o sus resultados.");
      }
      return safeDestination;
    });
    return () => setNavigationGuard();
  }, [betConfigurationIssues.length, draftAvailable, roundClosed, setNavigationGuard]);
  useEffect(() => {
    const safeDestination = activeBetSafeDestination(tab, draftAvailable && !roundClosed && betConfigurationIssues.length > 0);
    if (safeDestination === tab) return;
    const frame = requestAnimationFrame(() => {
      setShowBetSetupErrors(true);
      setEditingRound(true);
      setFeedback("La configuración recibida cambió. Corrige sus apuestas antes de continuar.");
      setTab(safeDestination);
    });
    return () => cancelAnimationFrame(frame);
  }, [betConfigurationIssues.length, draftAvailable, roundClosed, setTab, tab]);
  const liveScores = useMemo(() => scoreCaptureComplete ? { ...scores, [holeNumber]: scoreDraft } : scores, [scoreCaptureComplete, scores, holeNumber, scoreDraft]);
  const liveCompletedHoles = useMemo(() => new Set([...completedHoles, ...(scoreCaptureComplete ? [holeNumber] : [])]), [completedHoles, scoreCaptureComplete, holeNumber]);

  const applyDraft = useCallback((value: unknown, options: { preserveLocalUi?: boolean } = {}) => {
    if (!options.preserveLocalUi) {
      holeSummarySession.current?.dispose();
      holeSummarySession.current = null; setHoleSummaryPaused(false); setHoleSummary([]);
    }
    const draft = normalizeRoundDraft(value, resolvedOwnerIdForRoundDraft(value, identity.userId));
    const draftCore = draft ? resolveRoundDraftCore(draft, identity.userId) : null;
    setRoundPresentation(normalizeRoundPresentation(draft?.presentation));
    const draftRoundHoles: 9 | 18 = draftCore?.roundHoles ?? 18;
    setRoundClosed(false);
    setRoundReviewPending(Boolean(draft?.reviewPending));
    setRoundStartedAt(normalizeRoundStartedAt(draft?.startedAt) ?? null);
    setRoundTemplateOrigin(normalizeRoundTemplateOrigin(draft?.templateOrigin));
    setDraftAvailable(hasRoundProgress(draft));
    if (!draft) {
      setPlayers([]); setPlayerTeeAssignments([]); setOwnerId(""); setScores({}); setScoreEdits({}); setScorecardPhotoIds([]); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({});
      setPersonalBets([]); setManualBets([]); setSupplementalBets([]); setPutts({}); setScoreCaptureMode("quick"); setAdvancedStats({}); setExpenses(emptyExpenses); setBets(initialBets([]));
      setStartHole(1); setRoundHoles(18); setRoundHandicapBasis("relative"); setSegments(segmentDefinitions(playOrder(1), 6));
      setCourse(laVista); setCourseSelected(false); setPendingCourseIdentity(null); setCourseSelectionError(false);
      if (!options.preserveLocalUi) setCurrentIndex(0);
      setRoundId(makeId()); setRoundDate(localDateMexico()); setRoundStartedAt(null);
    }
    if (draft && draftCore) {
        setCourse(draft.course ? withDefaultLaVistaRules(draft.course) : laVista);
        setCourseSelected(draft.courseSelected === true);
        setPendingCourseIdentity(draft.courseSelected === true ? null : normalizeRoundSetupCourseIdentity(draft.courseIdentity));
        setCourseSelectionError(false);
        setStartHole(draftCore.startHole);
        setRoundHoles(draftCore.roundHoles);
        setRoundHandicapBasis(normalizeRoundHandicapBasis(draft.handicapBasis));
        setPlayers(draftCore.players);
        setPlayerTeeAssignments(reconcilePlayerTeeAssignments(draft.playerTeeAssignments, draftCore.players, draft.course ? withDefaultLaVistaRules(draft.course) : laVista, new Date().toISOString()));
        setOwnerId(draftCore.ownerId);
        const draftPlayerIds = draftCore.players.map((p: Player) => p.id);
        const restored = restoreBetConfig(draft.bets, draftPlayerIds, {
          startHole: draftCore.startHole,
          roundHoles: draftCore.roundHoles,
        });
        setBets({
          ...restored,
          rabbits: restored.rabbits,
          skins: restored.skins,
          foursome: restored.foursome,
          ballFriend: restored.ballFriend,
          polla: restored.polla,
        });
        if (draft.segments) {
          const draftOrder = playOrder(draftCore.startHole).slice(0, draftRoundHoles);
          const segmentSize = [3, 6, 9, 18].includes(draft.bets?.foursome?.segmentSize) ? draft.bets.foursome.segmentSize : 6;
          setSegments(normalizeFoursomeSegments(draft.segments, draftOrder, segmentSize));
        }
        if (draft.personalBets) setPersonalBets(draft.personalBets.map((b: any) => ({
          id: b.id,
          enabled: b.enabled,
          rivalMode: b.rivalMode,
          rivalPlayerId: b.rivalPlayerId,
          externalRivalId: b.externalRivalId,
          rivalHandicap: b.rivalHandicap ?? null,
          nassauVersion: b.nassauVersion,
          carryEnabled: b.carryEnabled,
          rivalName: b.rivalName,
          externalScores: b.externalScores && typeof b.externalScores === "object" && !Array.isArray(b.externalScores) ? b.externalScores : {},
          baseValue: Object.hasOwn(b, "baseValue") ? b.baseValue : undefined,
          advantageReceiver: b.nassauVersion === 2
            ? b.advantageReceiver
            : (b.advantageReceiver === "owner" || b.advantageReceiver === "rival" || b.advantageReceiver === "none")
              ? b.advantageReceiver
              : b.advantageReceiverId ? (b.advantageReceiverId === draftCore.ownerId ? "owner" : "rival")
                : b.advantageStrokes === 0 ? "none" : undefined,
          advantageStrokes: Object.hasOwn(b, "advantageStrokes") ? b.advantageStrokes : undefined,
          back9Multiplier: b.back9Multiplier,
          pressureMultiplier: b.pressureMultiplier,
          pressureNine: b.pressureNine,
          advantageMode: b.advantageMode,
          ownerIndexSnapshot: b.ownerIndexSnapshot,
          rivalIndexSnapshot: b.rivalIndexSnapshot,
          slidingAdvantage: b.slidingAdvantage,
          components: b.components,
        })));
        if (Array.isArray(draft.manualBets)) setManualBets(draft.manualBets.map((bet: ManualBet) => ({ ...bet, name: typeof bet.name === "string" ? bet.name : "" })));
        setSupplementalBets(normalizeSupplementalBets(draft.supplementalBets, draftRoundHoles));
        setPutts(draft.putts && typeof draft.putts === "object" ? draft.putts : {});
        setScoreCaptureMode(normalizeScoreCaptureMode(draft.scoreCaptureMode));
        setAdvancedStats(normalizeAdvancedStats(draft.advancedStats));
        if (draft.scores) setScores(draft.scores);
        setScoreEdits(draft.scoreEdits || {});
        setScorecardPhotoIds(Array.isArray(draft.scorecardPhotoIds) ? draft.scorecardPhotoIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : []);
        if (draft.unitEvents) setUnitEvents(draft.unitEvents);
        setCounterBetEvents(normalizeCounterBetEvents(draft.counterBetEvents));
        setCounterBetKeepers({ ...emptyCounterBetKeepers(), ...(draft.counterBetKeepers || {}) });
        setLobaHoles(draft.lobaHoles && typeof draft.lobaHoles === "object" ? draft.lobaHoles : {});
        if (draft.ballFriendSetup) setBallFriendSetup(draft.ballFriendSetup);
        setExpenses(draft.expenses ? normalizeExpenses(draft.expenses) : emptyExpenses);
        setRoundId(typeof draft.roundId === "string" && draft.roundId.trim() ? draft.roundId : makeId());
        setRoundDate(typeof draft.roundDate === "string" && draft.roundDate.trim() ? draft.roundDate : localDateMexico());
        if (!options.preserveLocalUi && Number.isInteger(draft.currentIndex)) setCurrentIndex(Math.max(0, Math.min(draftRoundHoles - 1, draft.currentIndex)));
      }
    undoStack.current = []; setUndoCount(0);
  }, [identity.userId]);

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
      hadLocalPreferences.current = hasLocalCloudPreferenceState(localStorage);
      const savedCourses = readStoredJson<unknown>(localStorage, STORAGE_KEYS.courses, null);
      const savedHistory = readStoredJson<unknown>(localStorage, STORAGE_KEYS.history, null);
      const savedRivals = readStoredJson<unknown>(localStorage, STORAGE_KEYS.rivals, null);
      const rawDraft = readStoredJson<unknown>(localStorage, STORAGE_KEYS.draft, null);
      const draft = normalizeRoundDraft(rawDraft, resolvedOwnerIdForRoundDraft(rawDraft, identity.userId));
      const savedFrequentPlayers = readStoredJson<unknown>(localStorage, STORAGE_KEYS.frequentPlayers, []);
      const savedFrequentGroups = parseFrequentGroups(localStorage.getItem(STORAGE_KEYS.frequentGroups));
      try {
        const mergedCourses = mergeDefaultCourses(Array.isArray(savedCourses) ? savedCourses as Course[] : null);
        const availableCourseIds = mergedCourses.map((item) => item.id);
        setCourses(mergedCourses);
        setFavoriteCourseIds(normalizeCourseIds(readStoredJson<unknown>(localStorage, coursePreferenceStorageKey("favorites", identity.userId), []), availableCourseIds));
        setRecentCourseIds(normalizeCourseIds(readStoredJson<unknown>(localStorage, coursePreferenceStorageKey("recents", identity.userId), []), availableCourseIds));
        if (Array.isArray(savedHistory)) setHistory((savedHistory as RoundSnapshot[]).map(normalizeHistorySnapshot));
        if (Array.isArray(savedRivals)) setSavedPersonalRivals(savedRivals);
        if (Array.isArray(savedFrequentPlayers)) setFrequentPlayers(savedFrequentPlayers);
        setFrequentGroups(savedFrequentGroups);
        setHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== "false");
        setNotificationsEnabled(localStorage.getItem(STORAGE_KEYS.notifications) === "true");
        setDraftAvailable(hasRoundProgress(draft));
        applyDraft(draft);
      } catch { /* keep safe defaults for structurally invalid legacy data */ }
      const entry = new URLSearchParams(window.location.search);
      if (entry.get("screen") === "account") setTab("account");
      setHydrated(true);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [identity.userId, identity.defaultHandicap, setTab, applyDraft]);

  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus("saving");
    const revision = localPersistRevision.current;
    const persist = () => {
      if (revision !== localPersistRevision.current) return false;
      if (localStorage.getItem(accountDeletionMarkerKey(identity.userId))) return false;
      if (!ownsLocalWorkspace(localStorage, identity.userId)) return false;
      try {
        const draft = withDerivedRoundLifecycle({ version: 10, course, courseSelected, courseIdentity: courseSelected ? undefined : pendingCourseIdentity ?? undefined, playerTeeAssignments, startHole, roundHoles, handicapBasis: roundHandicapBasis, players, ownerId, bets, segments, personalBets, supplementalBets, manualBets, scores, scoreEdits, putts, scorecardPhotoIds, scoreCaptureMode, advancedStats, unitEvents, counterBetEvents, counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, startedAt: roundStartedAt ?? undefined, currentIndex, reviewPending: roundReviewPending, templateOrigin: roundTemplateOrigin ?? undefined });
        const activeDraft = roundClosed ? null : draft;
        trackLocalCloudEdits(localStorage, activeDraft, { highContrast, language: "es-MX", notificationsEnabled, defaultHandicap: identity.defaultHandicap });
        localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(courses));
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
        localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(savedPersonalRivals));
        localStorage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(frequentPlayers));
        localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(frequentGroups));
        localStorage.setItem(STORAGE_KEYS.contrast, String(highContrast));
        localStorage.setItem(STORAGE_KEYS.notifications, String(notificationsEnabled));
        localStorage.setItem(coursePreferenceStorageKey("favorites", identity.userId), JSON.stringify(favoriteCourseIds));
        localStorage.setItem(coursePreferenceStorageKey("recents", identity.userId), JSON.stringify(recentCourseIds));
        localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(!roundClosed && hasRoundProgress(draft) ? draft : null));
        setDraftAvailable(!roundClosed && hasRoundProgress(draft));
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
  }, [hydrated, identity.userId, identity.mode, identity.defaultHandicap, cloudLinked, courses, favoriteCourseIds, recentCourseIds, history, savedPersonalRivals, frequentPlayers, frequentGroups, highContrast, notificationsEnabled, roundClosed, roundReviewPending, course, courseSelected, pendingCourseIdentity, playerTeeAssignments, startHole, roundHoles, roundHandicapBasis, players, ownerId, bets, segments, personalBets, supplementalBets, manualBets, scores, scoreEdits, scorecardPhotoIds, putts, scoreCaptureMode, advancedStats, unitEvents, counterBetEvents, counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, roundStartedAt, roundTemplateOrigin, currentIndex]);

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

  useEffect(() => {
    if (!hydrated || identity.mode !== "authenticated" || !identity.displayName.trim()) return;
    const profile = {
      userId: identity.userId,
      displayName: identity.displayName,
      email: identity.email,
      avatarUrl: identity.avatarUrl,
      defaultHandicap: identity.defaultHandicap,
    };
    const updatedAt = new Date().toISOString();
    setFrequentPlayers((current) => syncAccountPrimaryFrequentPlayer(current, profile, updatedAt));
    setPlayers((current) => syncLinkedRoundPlayerName(current, profile));
  }, [hydrated, identity.mode, identity.userId, identity.displayName, identity.email, identity.avatarUrl, identity.defaultHandicap]);

  const applyCloudBundle = useCallback((data: CloudDataBundle, local: CloudDataBundle) => {
    // Cloud responses can arrive after a local-first finalization. Reconcile
    // again at the UI boundary so a canonical response captured before the
    // save can never replace a newly confirmed Historical round.
    const reconciled = mergeLocalFirstActiveDraft(local, data);
    const changed = (left: unknown, right: unknown) => JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right));
    if (!hasRoundProgress(local.activeDraft) && changed(local.activeDraft, reconciled.activeDraft)) {
      preserveDraftConflict(localStorage, local.activeDraft);
      applyDraft(reconciled.activeDraft, { preserveLocalUi: true });
      setFeedback("Ronda actualizada desde la nube. La versión local anterior se conservó en este dispositivo.");
    }
    const mergedCourses = mergeDefaultCourses(reconciled.courses);
    if (changed(local.courses, reconciled.courses)) setCourses(mergedCourses);
    if (changed(local.history, reconciled.history)) setHistory(reconciled.history.map(normalizeHistorySnapshot));
    if (changed(local.rivals, reconciled.rivals)) setSavedPersonalRivals(reconciled.rivals);
    if (changed(local.frequentPlayers, reconciled.frequentPlayers)) setFrequentPlayers(reconciled.frequentPlayers);
    if (changed(local.frequentGroups, reconciled.frequentGroups)) setFrequentGroups(reconciled.frequentGroups);
    if (local.preferences.highContrast !== reconciled.preferences.highContrast) setHighContrast(reconciled.preferences.highContrast);
    if (local.preferences.notificationsEnabled !== reconciled.preferences.notificationsEnabled) setNotificationsEnabled(reconciled.preferences.notificationsEnabled);
    if (!Object.is(local.preferences.defaultHandicap, reconciled.preferences.defaultHandicap)) applyCloudPreferences(reconciled.preferences);
    localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(mergedCourses));
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(reconciled.history));
    localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(reconciled.rivals));
    localStorage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(reconciled.frequentPlayers));
    localStorage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(reconciled.frequentGroups));
    localStorage.setItem(STORAGE_KEYS.contrast, String(reconciled.preferences.highContrast));
    localStorage.setItem(STORAGE_KEYS.notifications, String(reconciled.preferences.notificationsEnabled));
    const localDraftWithNavigation = restoreLocalRoundUi(reconciled.activeDraft, { currentIndex: currentIndexRef.current });
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(localDraftWithNavigation));
    localStorage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify(reconciled.tombstones));
    persistCloudMetadata(localStorage, reconciled);
    hadLocalPreferences.current = true;
    const applied = collectLocalCloudData(localStorage, reconciled.preferences.defaultHandicap, true);
    applied.deviceId = offlineDeviceId.current;
    return cloudSyncPayloadFingerprint(applied);
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
      if (process.env.NODE_ENV === "development") console.info("[cloud-sync]", event, { trigger });
    };
    const current = () => !cancelled && !localStorage.getItem(accountDeletionMarkerKey(userId)) && ownsLocalWorkspace(localStorage, userId) && liveIdentity.current.userId === userId && Boolean(liveIdentity.current.accessToken);
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
        const offlineFingerprint = cloudDataFingerprint(initial);
        fingerprint = cloudSyncPayloadFingerprint(initial);
        const decision = gate.begin(fingerprint, trigger);
        const skippedStatus = syncStatusAfterSkip(decision);
        if (skippedStatus) { setCloudStatus(skippedStatus); return; }
        if (decision !== "run") return;
        debug("start", trigger);
        let appliedFingerprint = "";
        const completed = await runCloudSyncCycle({
          read, current, status: setCloudStatus,
          merge: mergeLocalFirstActiveDraft,
          shouldUpload: (_local, remote, merged) => cloudSyncPayloadFingerprint(remote) !== cloudSyncPayloadFingerprint(merged),
          download: () => withCloudAuthRetry(downloadCloudData, liveIdentity.current.accessToken || "", refreshCloudSession),
          upload: data => withCloudAuthRetry(token => uploadCloudData(data, token), liveIdentity.current.accessToken || "", refreshCloudSession),
          conflicts: (local, cloud) => {
            const ownershipConflicts = findActiveDraftOwnershipConflicts(local, cloud);
            const conflicts = actionableCloudConflicts(ownershipConflicts.length ? ownershipConflicts : findAmbiguousCloudConflicts(local, cloud));
            if (!conflicts.length) return false;
            preserveDataConflicts(localStorage, conflicts);
            setPendingCloudConflict({ local, cloud, conflicts });
            setFeedback("Encontramos cambios simultáneos. Elige qué copia conservar; ninguna fue eliminada.");
            return true;
          },
          media: async data => {
            const importedPhotoIds = [...new Set([
              ...data.history.flatMap(roundScorecardPhotoIds),
              ...roundScorecardPhotoIds((data.activeDraft || {}) as { photoId?: unknown; scorecardPhotoIds?: unknown }),
            ])];
            await adoptScorecardPhotos(importedPhotoIds, "guest", userId);
            if (!current()) throw new Error("Sync cancelled");
            adoptGuestPhotoJobs(localStorage, userId);
            for (const round of data.history.filter(item => roundScorecardPhotoIds(item).length)) {
              if (!current()) throw new Error("Sync cancelled");
              for (const photoId of roundScorecardPhotoIds(round)) {
                const marker = `backyard-photo-uploaded-v1:${userId}:${photoId}`;
                if (!localStorage.getItem(marker) && !photoJobs(localStorage).some(job => job.userId === userId && job.roundId === round.id && job.photoId === photoId)) {
                  const blob = await readScorecardPhoto(photoId, userId, { adoptLegacy: true });
                  if (!current()) throw new Error("Sync cancelled");
                  if (blob) queuePhoto(localStorage, { userId, roundId: round.id, photoId, operation: "upload", revision: makeId() });
                }
              }
            }
            await flushPhotoQueue(localStorage, userId, data, {
              read: photoId => readScorecardPhoto(photoId, userId, { adoptLegacy: true }),
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
          const confirmedFingerprint = appliedFingerprint || cloudSyncPayloadFingerprint(read());
          queued = gate.success(confirmedFingerprint);
          // The gate compares only server-visible payload. The durable outbox
          // uses the complete snapshot fingerprint, so acknowledge exactly the
          // mutation that entered this cycle and never a newer local write.
          void acknowledgeOfflineBundle(userId, offlineFingerprint);
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
            const rebased = mergeLocalFirstActiveDraft(local, cloud);
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
    // Realtime is intentionally not required for round ownership sync. A
    // bounded foreground refresh makes two open devices converge without
    // maintaining a fragile channel while a player is moving on the course.
    const foregroundRefresh = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) schedule("visible");
    }, 45_000);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("backyard-sync-retry", onRetry);
    document.addEventListener("visibilitychange", onVisible);
    schedule("mount");
    return () => {
      cancelled = true; gate.cancel(); clearTimeout(timer); requestCloudSync.current = null;
      window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline);
      window.clearInterval(foregroundRefresh);
      window.removeEventListener("backyard-sync-retry", onRetry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, identity.mode, identity.userId, cloudLinked, setCloudStatus, applyCloudBundle, reportCloudSyncError, clearCloudSyncError, refreshCloudSession]);

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
    setHistory(resolved.history.map(normalizeHistorySnapshot));
    setSavedPersonalRivals(resolved.rivals);
    setFrequentPlayers(resolved.frequentPlayers);
    setFrequentGroups(resolved.frequentGroups);
    setHighContrast(resolved.preferences.highContrast);
    setNotificationsEnabled(resolved.preferences.notificationsEnabled);
    applyCloudPreferences(resolved.preferences);
    applyDraft(resolved.activeDraft, { preserveLocalUi: true });
    setPendingCloudConflict(null);
    setCloudStatus(navigator.onLine ? "pending" : "offline");
    setFeedback(choice === "local" ? "Conservamos la copia de este dispositivo. Se sincronizará sin borrar la otra versión auditada." : "Conservamos la copia de la nube. La versión local anterior quedó auditada en este dispositivo.");
    requestCloudSync.current?.();
  }

  useEffect(() => {
    if (!hydrated) return;
    setSegments((old) => normalizeFoursomeSegments(old, order, bets.foursome.segmentSize));
    setFoursomeMaxBaseAppearances(defaultMaxBaseAppearances(bets.foursome.segmentSize));
    setFoursomeGenerationMessage("");
  }, [hydrated, order, bets.foursome.segmentSize]);

  useEffect(() => {
    if (!hydrated) return;
    const valid = new Set(players.map((p) => p.id));
    const sanitize = (ids: string[] | undefined) => (Array.isArray(ids) ? ids : []).filter((id) => valid.has(id));
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
    setSupplementalBets((current) => current.map((bet) => {
      if (bet.type === "individual_nassau" || bet.type === "dollar_stroke") return {
        ...bet,
        playerAId: valid.has(bet.playerAId) ? bet.playerAId : "",
        playerBId: valid.has(bet.playerBId) ? bet.playerBId : "",
        advantageReceiverId: bet.advantageReceiverId && valid.has(bet.advantageReceiverId) ? bet.advantageReceiverId : undefined,
      };
      if (bet.type === "team_pressures") return { ...bet, participantIds: sanitize(bet.participantIds), abandonedPlayerIds: sanitize(bet.abandonedPlayerIds || []), teamA: sanitize(bet.teamA) };
      if (bet.type === "vegas") return { ...bet, participantIds: sanitize(bet.participantIds), teamA: sanitize(bet.teamA) };
      return { ...bet, participantIds: sanitize(bet.participantIds) };
    }));
    if (!valid.has(ownerId)) setOwnerId(players[0]?.id ?? "");
  }, [hydrated, players, ownerId]);

  // Par is a suggestion, never a played score until explicit confirmation.
  // Existing numeric drafts remain intact: old versions did not record provenance.

  useEffect(() => () => { holeSummarySession.current?.dispose(); }, []);

  const rabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, order, roundHandicapBasis), [course, scores, players, bets.rabbits, order, roundHandicapBasis]);
  const skins = useMemo(() => calculateSkins(course, scores, players, bets.skins, order, roundHandicapBasis), [course, scores, players, bets.skins, order, roundHandicapBasis]);
  const units = useMemo(() => calculateUnits(players, unitEvents, bets.units, course, scores, order), [players, unitEvents, bets.units, course, scores, order]);
  const monkey = useMemo(() => calculateMonkey(course, scores, players, bets.monkey, order, roundHandicapBasis), [course, scores, players, bets.monkey, order, roundHandicapBasis]);
  const foursomes = useMemo(() => calculateFoursomes(course, scores, players, bets.foursome, segments, order, roundHandicapBasis), [course, scores, players, bets.foursome, segments, order, roundHandicapBasis]);
  const ballFriend = useMemo(() => calculateBallFriend(course, scores, players, bets.ballFriend, ballFriendSetup, order, roundHandicapBasis), [course, scores, players, bets.ballFriend, ballFriendSetup, order, roundHandicapBasis]);
  const personals = useMemo(() => calculatePersonalBets(personalBets, ownerId, players, course, scores, order), [personalBets, ownerId, players, course, scores, order]);
  const unresolvedExternalPersonalBets = useMemo(
    () => incompleteExternalPersonalBets(personalBets, personals.results),
    [personalBets, personals.results],
  );
  const polla = useMemo(() => calculatePolla(course, scores, players, bets.polla, order, roundHandicapBasis), [course, scores, players, bets.polla, order, roundHandicapBasis]);
  const miniPolla = useMemo(() => calculateMiniPolla(course, scores, players, bets.miniPolla, order, roundHandicapBasis), [course, scores, players, bets.miniPolla, order, roundHandicapBasis]);
  const manual = useMemo(() => calculateManualBets(players, manualBets), [players, manualBets]);
  const supplemental = useMemo(() => calculateSupplementalBets(supplementalBets, players, course, scores, putts, order, roundHandicapBasis), [supplementalBets, players, course, scores, putts, order, roundHandicapBasis]);
  const vipers = useMemo(() => calculateCounterBet("vipers", players, bets.vipers, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.vipers, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const camels = useMemo(() => calculateCounterBet("camels", players, bets.camels, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.camels, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const fish = useMemo(() => calculateCounterBet("fish", players, bets.fish, counterBetEvents, counterBetKeepers, order, completedHoles), [players, bets.fish, counterBetEvents, counterBetKeepers, order, completedHoles]);
  const loba = useMemo(() => calculateLoba(course, scores, players, bets.loba, lobaHoles, order, completedHoles, roundHandicapBasis), [course, scores, players, bets.loba, lobaHoles, order, completedHoles, roundHandicapBasis]);
  const liveRabbits = useMemo(() => calculateRabbits(course, liveScores, players, bets.rabbits, order, roundHandicapBasis), [course, liveScores, players, bets.rabbits, order, roundHandicapBasis]);
  const liveSkins = useMemo(() => calculateSkins(course, liveScores, players, bets.skins, order, roundHandicapBasis), [course, liveScores, players, bets.skins, order, roundHandicapBasis]);
  const liveMonkey = useMemo(() => calculateMonkey(course, liveScores, players, bets.monkey, order, roundHandicapBasis), [course, liveScores, players, bets.monkey, order, roundHandicapBasis]);
  const liveFoursomes = useMemo(() => calculateFoursomes(course, liveScores, players, bets.foursome, segments, order, roundHandicapBasis), [course, liveScores, players, bets.foursome, segments, order, roundHandicapBasis]);
  const liveBallFriend = useMemo(() => calculateBallFriend(course, liveScores, players, bets.ballFriend, ballFriendSetup, order, roundHandicapBasis), [course, liveScores, players, bets.ballFriend, ballFriendSetup, order, roundHandicapBasis]);
  const liveSupplemental = useMemo(() => calculateSupplementalBets(supplementalBets, players, course, liveScores, putts, order, roundHandicapBasis), [supplementalBets, players, course, liveScores, putts, order, roundHandicapBasis]);
  const personalOpponentResults = useMemo(() => buildPersonalOpponentResults({ ownerId, players, course, scores, putts, order, canonicalResults: personals.results, personalBets, supplementalBets, handicapBasis: roundHandicapBasis }), [ownerId, players, course, scores, putts, order, personals.results, personalBets, supplementalBets, roundHandicapBasis]);
  const livePersonalOpponentResults = useMemo(() => buildPersonalOpponentResults({ ownerId, players, course, scores, putts, order, canonicalResults: personals.results, personalBets, supplementalBets, handicapBasis: roundHandicapBasis }), [ownerId, players, course, scores, putts, order, personals.results, personalBets, supplementalBets, roundHandicapBasis]);
  const supplementalGeneralResults = useMemo(() => supplemental.results.filter((result) => !isPersonalSupplementalType(result.type)), [supplemental.results]);
  const liveSupplementalGeneralResults = useMemo(() => liveSupplemental.results.filter((result) => !isPersonalSupplementalType(result.type)), [liveSupplemental.results]);
  const supplementalGeneralBalances = useMemo(() => mergeBalances(players, ...supplementalGeneralResults.map((result) => result.balances)), [players, supplementalGeneralResults]);
  const supplementalPersonalBalances = useMemo(() => mergeBalances(players, ...supplemental.results.filter((result) => isPersonalSupplementalType(result.type)).map((result) => result.balances)), [players, supplemental.results]);
  const personalCombinedBalances = useMemo(() => mergeBalances(players, personals.balances, supplementalPersonalBalances), [players, personals.balances, supplementalPersonalBalances]);
  const liveLoba = useMemo(() => calculateLoba(course, liveScores, players, bets.loba, lobaHoles, order, liveCompletedHoles, roundHandicapBasis), [course, liveScores, players, bets.loba, lobaHoles, order, liveCompletedHoles, roundHandicapBasis]);
  const priorOrder = useMemo(() => order.slice(0, currentIndex), [order, currentIndex]);
  const priorRabbits = useMemo(() => calculateRabbits(course, scores, players, bets.rabbits, priorOrder, roundHandicapBasis), [course, scores, players, bets.rabbits, priorOrder, roundHandicapBasis]);
  const priorSkins = useMemo(() => calculateSkins(course, scores, players, bets.skins, priorOrder, roundHandicapBasis), [course, scores, players, bets.skins, priorOrder, roundHandicapBasis]);

  const rabbitBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.rabbits.participantIds), rabbits.won, bets.rabbits.value), [players, bets.rabbits, rabbits.won]);
  const skinBalances = useMemo(() => payoutWinnerTakesFromAll(playersByIds(players, bets.skins.participantIds), skins.won, bets.skins.value), [players, bets.skins, skins.won]);
  const allBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, supplemental.balances, personals.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, supplemental.balances, personals.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
  const generalBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, supplementalGeneralBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances, polla.balances, miniPolla.balances, supplementalGeneralBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
  const liveBetBalances = useMemo(() => mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.provisionalBalances, ballFriend.balances, polla.balances, miniPolla.balances, liveSupplemental.balances, personals.provisionalBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances), [players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.provisionalBalances, ballFriend.balances, polla.balances, miniPolla.balances, liveSupplemental.balances, personals.provisionalBalances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances]);
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
  const rabbitMode = bets.rabbits.mode === undefined ? "continuous" : bets.rabbits.mode;
  const skinsMode = bets.skins.mode === undefined ? "carry" : bets.skins.mode;
  const unitQuantitySummary = useMemo(
    () => summarizeNetUnitQuantities(units.net, players.map(player => player.id)),
    [units.net, players],
  );
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
    ...Object.fromEntries(supplementalGeneralResults.map((result, index) => [`${result.label}${supplementalGeneralResults.length > 1 ? ` ${index + 1}` : ""}`, result.balances[ownerId] ?? 0])),
    Personales: personalOpponentResults.reduce((sum, result) => sum + result.amount, 0),
    Manuales: manual.balances[ownerId] ?? 0,
  }), [rabbitBalances, skinBalances, units.balances, monkey.balances, bets.monkey?.enabled, foursomes.balances, ballFriend.balances, pollaFirstBalances, pollaSecondBalances, pollaNassauBalances, miniPolla.balances, vipers.balances, camels.balances, fish.balances, loba.balances, supplementalGeneralResults, personalOpponentResults, manual.balances, ownerId]);

  const generalResultCategories = useMemo<ResultCategoryColumn[]>(() => [
    { key: "rabbits", label: "🐇 Conejos", balances: rabbitBalances, active: bets.rabbits.enabled, played: rabbits.events.length > 0, quantityTotal: totalRabbitsWon, quantities: rabbits.won, quantityLabel: "conejos" },
    { key: "skins", label: "⛳ Skins", balances: skinBalances, active: bets.skins.enabled, played: skins.events.length > 0, quantityTotal: totalSkinsWon, quantities: skins.won, quantityLabel: "skins" },
    { key: "units", label: "📏 Unidades", balances: units.balances, active: bets.units.enabled, played: completedHoles.size > 0, quantityTotal: unitQuantitySummary.total, quantities: unitQuantitySummary.quantities, quantityLabel: "unidades", signedQuantity: true },
    { key: "monkey", label: "🐒 Monkey", balances: monkey.balances, active: Boolean(bets.monkey?.enabled), played: monkey.details.length > 0, quantities: monkey.points, quantityLabel: "puntos" },
    { key: "foursome", label: "🤝 Foursome", balances: foursomes.balances, active: bets.foursome.enabled, played: foursomes.matches.some(match => match.completedHoles > 0) },
    { key: "ballFriend", label: "⚪🤝 Bola Amiga", balances: ballFriend.balances, active: bets.ballFriend.enabled, played: ballFriend.details.length > 0, quantityTotal: ballFriend.details.length, quantities: ballFriend.points, quantityLabel: "puntos", signedQuantity: true },
    { key: "pollaFirst", label: `🥈 ${groupNassauLabels.component("first9")}`, balances: pollaFirstBalances, active: bets.polla.first9.enabled, played: Boolean(pollaFirstDetail?.complete), detailByPlayer: pollaPositionLabels(pollaFirstDetail, settlementIds) },
    { key: "pollaSecond", label: `🥈 ${groupNassauLabels.component("second9")}`, balances: pollaSecondBalances, active: bets.polla.second9.enabled, played: Boolean(pollaSecondDetail?.complete), detailByPlayer: pollaPositionLabels(pollaSecondDetail, settlementIds) },
    { key: "pollaNassau", label: `🏆 ${groupNassauLabels.component("total18")}`, balances: pollaNassauBalances, active: bets.polla.total18.enabled, played: Boolean(pollaNassauDetail?.complete), detailByPlayer: pollaPositionLabels(pollaNassauDetail, settlementIds) },
    { key: "miniPolla", label: "⚡ Mini Polla", balances: miniPollaComponentBalances, active: bets.miniPolla.enabled, played: Boolean(miniPollaDetail?.complete), detailByPlayer: pollaPositionLabels(miniPollaDetail, settlementIds) },
    { key: "vipers", label: "🐍 Víboras", balances: vipers.balances, active: bets.vipers.enabled, played: vipers.totalQuantity > 0 || vipers.halves.some(half => half.settled) },
    { key: "camels", label: "🐫 Camellos", balances: camels.balances, active: bets.camels.enabled, played: camels.totalQuantity > 0 || camels.halves.some(half => half.settled) },
    { key: "fish", label: "🐟 Peces", balances: fish.balances, active: bets.fish.enabled, played: fish.totalQuantity > 0 || fish.halves.some(half => half.settled) },
    { key: "loba", label: "🐺 Loba", balances: loba.balances, active: bets.loba.enabled, played: loba.details.length > 0 },
    ...supplementalGeneralResults.map(result => ({ key: `supplemental-${result.betId}`, label: supplementalBetDisplayLabel(result.type, result.label), balances: result.balances, active: true, played: result.lines.length > 0 || result.complete })),
    { key: "manual", label: "✍️ Manuales", balances: manual.balances, active: manualBets.some(bet => bet.enabled !== false), played: manualBets.some(bet => bet.enabled !== false && Object.values(bet.amounts ?? {}).some(amount => amount !== 0)) },
  ], [rabbitBalances, bets.rabbits.enabled, rabbits.events.length, rabbits.won, totalRabbitsWon, skinBalances, bets.skins.enabled, skins.events.length, skins.won, totalSkinsWon, units.balances, unitQuantitySummary, bets.units.enabled, completedHoles, monkey.balances, monkey.points, monkey.details.length, bets.monkey?.enabled, foursomes.balances, bets.foursome.enabled, foursomes.matches, ballFriend.balances, ballFriend.points, bets.ballFriend.enabled, ballFriend.details.length, pollaFirstBalances, pollaSecondBalances, pollaNassauBalances, miniPollaComponentBalances, bets.polla.first9.enabled, bets.polla.second9.enabled, bets.polla.total18.enabled, bets.miniPolla.enabled, pollaFirstDetail, pollaSecondDetail, pollaNassauDetail, miniPollaDetail, settlementIds, vipers.balances, bets.vipers.enabled, vipers.totalQuantity, vipers.halves, camels.balances, bets.camels.enabled, camels.totalQuantity, camels.halves, fish.balances, bets.fish.enabled, fish.totalQuantity, fish.halves, loba.balances, bets.loba.enabled, loba.details.length, supplementalGeneralResults, manual.balances, manualBets, groupNassauLabels]);
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
  const finalResultPlayers = settlementIds.map((id) => {
    const leaderboard = privateBoard.find((row) => row.playerId === id);
    return {
      id,
      name: playerName(id),
      ...(leaderboard?.finished ? { gross: leaderboard.gross, ...(leaderboard.net === null ? {} : { net: leaderboard.net }) } : {}),
    };
  });
  const finalRoundRecap = buildDeterministicRoundRecap({
    players: settlementIds.map((id) => ({ id, name: playerName(id) })),
    balances: allBetBalances,
    skinsWon: skins.won,
    rabbitsWon: rabbits.won,
    transfers: settlementTransfers,
  });

  function resultAccordionProps(id: string) {
    return {
      open: Boolean(openResultSections[id]),
      onOpenChange: (open: boolean) => {
        if (open) setPendingResultScroll(id);
        setOpenResultSections((current) => ({ ...current, [id]: open }));
      },
    };
  }

  function openResultSection(id: string) {
    setPendingResultScroll(id);
    setOpenResultSections((current) => ({ ...current, [id]: true }));
  }

  function checkpoint() {
    undoStack.current = pushUndoState(undoStack.current, {
      scores: structuredClone(scores),
      scoreEdits: structuredClone(scoreEdits),
      putts: structuredClone(putts),
      advancedStats: structuredClone(advancedStats),
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
    setPutts(previous.putts);
    setAdvancedStats(previous.advancedStats);
    setUnitEvents(previous.unitEvents);
    setCounterBetEvents(previous.counterBetEvents);
    setCounterBetKeepers(previous.counterBetKeepers);
    setLobaHoles(previous.lobaHoles);
    setManualBets(previous.manualBets);
    setBallFriendSetup(previous.ballFriendSetup);
  }

  function updatePlayer(id: string, patch: Partial<Player>) {
    const nextPlayers = players.map((player) => player.id === id ? { ...player, ...patch } : player);
    setPlayers(nextPlayers);
    setPersonalBets((current) => current.map((bet) => {
      if ((bet.advantageMode ?? "current_index") !== "current_index") return bet;
      const rival = bet.rivalMode === "group"
        ? nextPlayers.find((player) => player.id === bet.rivalPlayerId)
        : { id: bet.externalRivalId || `external:${bet.id}`, name: bet.rivalName, handicap: bet.rivalHandicap ?? null };
      return configureCurrentIndexPersonal(bet, nextPlayers.find((player) => player.id === ownerId), rival, roundDate);
    }));
  }

  function appendPlayer(name = "", handicap: number | null = null, accountUserId?: string) {
    if (accountUserId && players.some((player) => player.accountUserId === accountUserId || player.id === accountPrimaryPlayerId(accountUserId))) {
      setFeedback("Ese jugador principal ya está en la ronda.");
      return;
    }
    const id = accountUserId ? accountPrimaryPlayerId(accountUserId) : makeId();
    const p: Player = { id, name, handicap, ...(accountUserId ? { accountUserId } : {}) };
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

  function setPutt(playerId: string, value: number | null) {
    checkpoint();
    const normalizedValue = value === null ? null : Math.max(0, Math.trunc(value));
    setPutts((current) => {
      const row = { ...(current[holeNumber] || {}) };
      if (normalizedValue === null) delete row[playerId];
      else row[playerId] = normalizedValue;
      return { ...current, [holeNumber]: row };
    });
    if (bets.vipers.enabled && bets.vipers.participantIds.includes(playerId)) {
      setCounterBetEvents((events) => setCounterQuantity(events, "vipers", holeNumber, playerId, viperQuantityFromPutts(normalizedValue), makeId()));
    }
  }

  function setAdvancedStat(playerId: string, patch: Parameters<typeof updateAdvancedHoleStat>[3]) {
    checkpoint();
    setAdvancedStats((current) => updateAdvancedHoleStat(current, holeNumber, playerId, patch));
  }

  function confirmRoundChange(message: string, run: () => void) {
    const played = Object.values(scores).some(row => Object.values(row).some(value => typeof value === "number"));
    if (played) setPendingRoundAction({ message: `${message}\nLos scores se conservan. Los resultados de esta ronda se recalcularán; el histórico no cambia hasta guardar. ¿Continuar?`, run });
    else run();
  }

  function editActiveRound() { setRoundClosed(false); setEditingRound(true); setTab("setup"); }

  function goToHoleIndex(index: number) {
    setCurrentIndex(Math.max(0, Math.min(order.length - 1, index)));
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function navigateFromBottomBar(target: AppTab) {
    setFeedback("");
    if (target === "rules") setRulesCourseContext(rulesContextForRound(hasRoundProgress({ players, scores, currentIndex }) && courseSelected, course.name));
    if (roundClosed && (target === "round" || target === "standings")) {
      setTab("history");
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
      return;
    }
    setTab(target);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function openRulesForRound() {
    setRulesCourseContext(rulesContextForRound(hasRoundProgress({ players, scores, currentIndex }) && courseSelected, course.name));
    setTab("rules");
  }

  function openHistoricalRound(roundToOpenId: string) {
    setHistoryDetailId(roundToOpenId);
    setTab("historyDetail");
  }

  function openPersonalActivity(item: PersonalActivity) {
    if (item.roundId) {
      openHistoricalRound(item.roundId);
      return;
    }
    if (item.groupId) setTab("groups");
  }

  function newManualBet() {
    const id = makeId();
    setManualSetupOpen(true);
    pendingManualFocus.current = id;
    setManualBets((bets) => [...bets, {
      id,
      enabled: true,
      name: `Apuesta manual ${bets.length + 1}`,
      amounts: Object.fromEntries(players.map((p) => [p.id, 0])),
    }]);
  }

  function setManualModeEnabled(enabled: boolean) {
    setManualSetupOpen(enabled);
    if (enabled && manualBets.length === 0) {
      newManualBet();
      return;
    }
    setManualBets((items) => setRememberedCategoryEnabled(items, enabled));
  }

  function updateManualBet(id: string, patch: Partial<ManualBet>) {
    setManualBets((bets) => bets.map((b) => b.id === id ? { ...b, ...patch } : b));
  }

  function setManualAmount(betId: string, playerId: string, value: number) {
    checkpoint();
    setManualBets((bets) => bets.map((b) => b.id === betId ? { ...b, amounts: { ...b.amounts, [playerId]: value } } : b));
  }

  function manualBetTotal(bet: ManualBet) {
    return players.reduce((sum, p) => sum + Number(bet.amounts?.[p.id] ?? 0), 0);
  }

  function manualBetIsValid(bet: ManualBet) {
    return typeof bet.name === "string"
      && Boolean(bet.name.trim())
      && isFiniteZeroSum(players.map((player) => bet.amounts?.[player.id] ?? 0));
  }

  function addUnit(playerId: string, amount: number, label = amount > 0 ? "Otra positiva" : "Copa") {
    checkpoint();
    setUnitEvents((e) => [...e, { id: makeId(), hole: holeNumber, playerId, amount, label }]);
  }

  function changeCounterBet(kind: CounterBetKind, playerId: string, quantity: number) {
    checkpoint();
    setCounterBetEvents(events => setCounterQuantity(events, kind, holeNumber, playerId, quantity, makeId()));
  }

  function confirmCounterBetCapture(kind: CounterBetKind, playerId: string, quantity: number | null) {
    checkpoint();
    setCounterBetEvents(events => confirmCounterQuantity(events, kind, holeNumber, playerId, quantity, makeId()));
  }

  function changeCounterBetDistance(kind: CounterBetKind, eventHole: number, playerId: string, distance: number | null) {
    checkpoint();
    setCounterBetEvents(events => setCounterDistance(events, kind, eventHole, playerId, distance));
  }

  function setCounterBetKeeper(kind: CounterBetKind, playerId: string, period: CounterBetPeriod) {
    checkpoint();
    setCounterBetKeepers(current => updateCounterBetKeeper(current, kind, period, playerId, order));
  }

  function setLobaHole(next: LobaHole) {
    checkpoint();
    setLobaHoles(current => ({ ...current, [holeNumber]: next }));
  }

  function toggleBasePair(segmentId: string, playerId: string) {
    setSegments((segs) => segs.map((s) => {
      if (!s || typeof s !== "object" || s.id !== segmentId) return s;
      const pair = Array.isArray(s.basePair) ? [...s.basePair] : [];
      const exists = pair.includes(playerId);
      const next = exists ? pair.filter((id) => id !== playerId) : pair.length < 2 ? [...pair, playerId] : [pair[1], playerId];
      return markFoursomeSegmentEdited({ ...s, basePair: next });
    }));
  }

  function generateFoursomesAutomatically() {
    const result = generateAutomaticFoursomes({
      participantIds: bets.foursome.participantIds,
      order,
      segmentSize: bets.foursome.segmentSize,
      maxBaseAppearances: foursomeMaxBaseAppearances,
      idFactory: makeId,
    });
    if (!result.ok) { setFoursomeGenerationMessage(result.message); return; }
    const apply = () => {
      setSegments(result.segments);
      setFoursomeGenerationMessage("Parejas generadas por Backyard. Puedes editar cualquier segmento antes de jugar.");
    };
    const hasAffectedScores = order.some((hole) => Object.values(scores[hole] || {}).some((score) => typeof score === "number"));
    if (hasAffectedScores) confirmRoundChange("Ya existen scores. Cambiar las parejas puede recalcular Foursome; revisa el resultado antes de guardar.", apply);
    else apply();
  }

  function newPersonalBet() {
    const rival = players.find((p) => p.id !== ownerId);
    const saved = savedPersonalRivals[0];
    const draft: PersonalBet = {
      id: makeId(),
      enabled: true,
      rivalMode: rival ? "group" : "external",
      rivalPlayerId: rival?.id,
      externalRivalId: rival ? undefined : saved?.id,
      rivalName: rival?.name || saved?.name || "Rival",
      externalScores: {},
      baseValue: 100,
      advantageMode: "current_index",
      advantageReceiver: "rival",
      advantageStrokes: 0,
      back9Multiplier: 1,
      nassauVersion: 2,
      carryEnabled: false,
      pressureMultiplier: 1,
      pressureNine: "holes_10_18",
      components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
    };
    setPersonalSetupOpen(true);
    setExpandedPersonalId(draft.id);
    pendingPersonalFocus.current = draft.id;
    const currentIndexDraft = configureCurrentIndexPersonal(draft, players.find((player) => player.id === ownerId), rival, roundDate);
    setPersonalBets((bets) => [...bets, !rival && saved ? applySavedPersonalRivalTemplate(currentIndexDraft, saved) : currentIndexDraft]);
  }

  function setPersonalAdvantageMode(bet: PersonalBet, mode: "current_index" | "sliding" | "manual") {
    const ownerPlayer = players.find((player) => player.id === ownerId);
    const groupRival = bet.rivalMode === "group" ? players.find((player) => player.id === bet.rivalPlayerId) : undefined;
    const rival = groupRival || { id: bet.externalRivalId || `external:${bet.id}`, name: bet.rivalName, handicap: bet.rivalHandicap ?? null };
    if (mode === "current_index") updatePersonalBet(bet.id, configureCurrentIndexPersonal(bet, ownerPlayer, rival, roundDate));
    else if (mode === "sliding") {
      const indexed = configureCurrentIndexPersonal(bet, ownerPlayer, rival, roundDate);
      const initial = bet.slidingAdvantage ?? (indexed.advantageReceiver === "rival" ? indexed.advantageStrokes : indexed.advantageReceiver === "owner" ? -indexed.advantageStrokes : 0);
      updatePersonalBet(bet.id, configureSlidingPersonal(indexed, initial));
    } else updatePersonalBet(bet.id, { advantageMode: "manual" });
  }

  function activateFrequentPersonal(template: SavedPersonalRival, edit = false) {
    const rival = players.find((player) => player.name.trim().toLocaleLowerCase("es-MX") === template.name.trim().toLocaleLowerCase("es-MX"));
    if (!rival) return;
    const id = makeId();
    const base: PersonalBet = {
      id, enabled: true, rivalMode: "group", rivalPlayerId: rival.id, externalRivalId: template.id, rivalName: rival.name,
      rivalHandicap: rival.handicap, externalScores: {}, baseValue: template.baseValue ?? 100,
      advantageReceiver: template.advantageReceiver ?? "rival", advantageStrokes: template.advantageStrokes ?? 0,
      advantageMode: template.mode ?? "current_index", slidingAdvantage: template.slidingAdvantage,
      back9Multiplier: 1, pressureMultiplier: template.pressureMultiplier ?? 1, pressureNine: template.pressureNine ?? "holes_10_18",
      carryEnabled: template.carryEnabled ?? false,
      components: template.components ? { ...template.components } : { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
    };
    const configured = base.advantageMode === "sliding"
      ? configureSlidingPersonal(base, base.slidingAdvantage)
      : configureCurrentIndexPersonal(base, players.find((player) => player.id === ownerId), rival, roundDate);
    setPersonalBets((current) => [...current, configured]);
    setPersonalSetupOpen(true); setNassauSetupOpen(true); setExpandedPersonalId(edit ? id : null);
    setDismissedFrequentPersonalIds((current) => [...new Set([...current, template.id])]);
  }

  function setPersonalModeEnabled(enabled: boolean) {
    setPersonalSetupOpen(enabled || personalSetupOpen);
    setNassauSetupOpen(enabled);
    if (enabled && personalBets.length === 0) {
      newPersonalBet();
      return;
    }
    setPersonalBets((items) => setRememberedCategoryEnabled(items, enabled));
  }

  function savePersonalRivalFromBet(bet: PersonalBet) {
    if (!bet.rivalName.trim()) return;
    const now = new Date().toISOString();
    const groupRivalHandicap = bet.rivalMode === "group"
      ? players.find((player) => player.id === bet.rivalPlayerId)?.handicap ?? null
      : bet.rivalHandicap ?? null;
    const existing = savedPersonalRivals.find((rival) => rival.id === bet.externalRivalId);
    if (existing) {
      const template = personalRivalTemplateFromBet(bet, existing.id, now, groupRivalHandicap ?? existing.handicap ?? null);
      setSavedPersonalRivals((templates) => updateSavedPersonalRivalTemplate(templates, existing.id, template, now));
      return;
    }
    const id = makeId();
    const template = personalRivalTemplateFromBet(bet, id, now, groupRivalHandicap);
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
      externalScores: { ...b.externalScores, [hole]: value === null ? null : Math.max(1, Math.trunc(value)) },
    } : b));
  }

  function currentSnapshot(): RoundSnapshot | null {
    if (!owner) return null;
    const timestamp = new Date().toISOString();
    const finalizedCounterBetEvents = snapshotCounterBetEvents(counterBetEvents, {
      vipers: bets.vipers,
      camels: bets.camels,
      fish: bets.fish,
    }, order);
    const personalSlidingAdjustments = personalBets.flatMap((bet) => {
      const result = personals.results.find((candidate) => candidate.betId === bet.id);
      if (!result) return [];
      const adjustment = slidingAdjustment({ bet, ownerResult: result.totalMoney, rivalKey: personalRivalKey(bet), roundId, updatedAt: timestamp });
      return adjustment ? [adjustment] : [];
    });
    return structuredClone({
      id: roundId, lifecycleState: "completed", startedAt: roundStartedAt ?? undefined, scoreCaptureMode, date: roundDate, courseName: course.name, teeName: course.teeName,
      snapshotVersion: 2, ownerId: owner.id, handicapBasis: roundHandicapBasis, presentation: normalizeRoundPresentation(roundPresentation), segments, playerBalances: allBetBalances,
      categoryBalances: { Conejos: rabbitBalances, Skins: skinBalances, Unidades: units.balances, Monkey: monkey.balances, Foursome: foursomes.balances, "Bola Amiga": ballFriend.balances, "Polla 1ª vuelta": pollaFirstBalances, "Polla 2ª vuelta": pollaSecondBalances, "Polla Nassau": pollaNassauBalances, "Mini Polla": miniPollaComponentBalances, "🐍 Víboras": vipers.balances, "🐫 Camellos": camels.balances, "🐟 Peces": fish.balances, "🐺 Loba": loba.balances, ...Object.fromEntries(supplementalGeneralResults.map((result, index) => [`${result.label}${supplementalGeneralResults.length > 1 ? ` ${index + 1}` : ""}`, result.balances])), Personales: personalCombinedBalances, Manuales: manual.balances },
      resultDetails: { rabbits, skins, units, monkey, foursomes, ballFriend, polla, miniPolla, vipers, camels, fish, loba, supplemental, settlementTransfers, settlementDifference, personals, manual },
      ownerName: owner.name, roundHoles, startHole, betResult: ownerBetResult, expenses, expenseTotal: ownerExpenseTotal,
      netResult: ownerNet, categoryResults, players: structuredClone(players), scores: structuredClone(scores),
      courseSnapshot: structuredClone(course), playerTeeAssignments: structuredClone(playerTeeAssignments), order: [...order], completedAt: timestamp, updatedAt: timestamp,
      ...(scorecardPhotoIds.length ? { photoId: scorecardPhotoIds[0], scorecardPhotoIds: [...scorecardPhotoIds] } : {}),
      betConfig: structuredClone(bets), unitEvents: structuredClone(unitEvents), counterBetEvents: structuredClone(finalizedCounterBetEvents), counterBetKeepers: structuredClone(counterBetKeepers), lobaHoles: structuredClone(lobaHoles), personalBets: structuredClone(personalBets),
      supplementalBets: structuredClone(supplementalBets), putts: structuredClone(putts), advancedStats: structuredClone(advancedStats), manualBets: structuredClone(manualBets), ballFriendSetup: structuredClone(ballFriendSetup),
      personalResults: personals.results.map((r) => snapshotPersonalResult(personalBets.find((bet) => bet.id === r.betId)!, r, players)),
      personalOpponentResults: structuredClone(personalOpponentResults), personalSlidingAdjustments,
    });
  }

  function roundDraftPayload(overrides: { scores?: Record<number, HoleScore>; scoreEdits?: ScoreRows; bets?: BetConfig; currentIndex?: number; reviewPending?: boolean; startedAt?: string | null; scorecardPhotoIds?: string[] } = {}) {
    return withDerivedRoundLifecycle({
      version: 10, course, courseSelected, courseIdentity: courseSelected ? undefined : pendingCourseIdentity ?? undefined, playerTeeAssignments, startHole, roundHoles, handicapBasis: roundHandicapBasis, presentation: normalizeRoundPresentation(roundPresentation), players, ownerId,
      bets: overrides.bets || bets, segments, personalBets, supplementalBets, manualBets,
      scores: overrides.scores || scores, scoreEdits: overrides.scoreEdits || scoreEdits, putts, scoreCaptureMode, advancedStats, unitEvents, counterBetEvents,
      counterBetKeepers, lobaHoles, ballFriendSetup, expenses, roundId, roundDate, startedAt: normalizeRoundStartedAt(overrides.startedAt) ?? roundStartedAt ?? undefined,
      currentIndex: overrides.currentIndex ?? currentIndex,
      reviewPending: overrides.reviewPending ?? roundReviewPending,
      scorecardPhotoIds: overrides.scorecardPhotoIds ?? scorecardPhotoIds,
      templateOrigin: roundTemplateOrigin ?? undefined,
    });
  }

  function persistReviewBeforeLeavingRound(savedScores: Record<number, HoleScore>, savedEdits: ScoreRows, savedBets: BetConfig, savedIndex: number, startedAt?: string | null, savedPhotoIds?: string[]) {
    try {
      if (localStorage.getItem(accountDeletionMarkerKey(identity.userId))) return false;
      const previousDraft = readStoredJson<unknown>(window.localStorage, STORAGE_KEYS.draft, null);
      const draft = persistPendingRoundReview(window.localStorage, roundDraftPayload({ scores: savedScores, scoreEdits: savedEdits, bets: savedBets, currentIndex: savedIndex, reviewPending: true, startedAt, scorecardPhotoIds: savedPhotoIds }));
      trackLocalCloudCheckpoint(localStorage, draft, { highContrast, language: "es-MX", notificationsEnabled, defaultHandicap: identity.defaultHandicap }, previousDraft);
      setRoundReviewPending(true);
      setDraftAvailable(true);
      setSaveStatus("saved");
      const offline = collectLocalCloudData(localStorage, identity.defaultHandicap, hadLocalPreferences.current);
      offline.deviceId = offlineDeviceId.current;
      void persistOfflineBundle(identity.userId, offline, identity.mode === "authenticated" && cloudLinked).catch(() => {
        setFeedback("Ronda terminada y guardada en este dispositivo; el respaldo secundario y la sincronización siguen pendientes.");
      });
      requestCloudSync.current?.();
      return true;
    } catch {
      setSaveStatus("error");
      setFeedback("No se pudo comprobar la ronda pendiente en este dispositivo. Conservamos la ronda abierta; libera espacio y vuelve a pulsar Terminar ronda.");
      return false;
    }
  }

  function persistCommittedHoleBeforeAdvance(savedScores: Record<number, HoleScore>, savedEdits: ScoreRows, savedBets: BetConfig, savedIndex: number, startedAt?: string | null, savedPhotoIds?: string[]) {
    try {
      if (localStorage.getItem(accountDeletionMarkerKey(identity.userId))) return false;
      const previousDraft = readStoredJson<unknown>(window.localStorage, STORAGE_KEYS.draft, null);
      const draft = roundDraftPayload({ scores: savedScores, scoreEdits: savedEdits, bets: savedBets, currentIndex: savedIndex, reviewPending: false, startedAt, scorecardPhotoIds: savedPhotoIds });
      // localStorage is the synchronous durability boundary used by Safari/PWA.
      // Metadata and the offline outbox are created only after exact readback.
      persistRoundDraftCheckpoint(window.localStorage, draft);
      trackLocalCloudCheckpoint(localStorage, draft, { highContrast, language: "es-MX", notificationsEnabled, defaultHandicap: identity.defaultHandicap }, previousDraft);
      setRoundReviewPending(false);
      setShowRoundFinishedNotice(false);
      setDraftAvailable(true);
      setSaveStatus("saved");
      const offline = collectLocalCloudData(localStorage, identity.defaultHandicap, hadLocalPreferences.current);
      offline.deviceId = offlineDeviceId.current;
      // The verified localStorage checkpoint is already durable. IndexedDB and
      // cloud remain best-effort here and the regular retry loop will resume them.
      void persistOfflineBundle(identity.userId, offline, identity.mode === "authenticated" && cloudLinked).catch(() => undefined);
      requestCloudSync.current?.();
      return true;
    } catch {
      setSaveStatus("error");
      setFeedback("No se pudo guardar el hoyo en este dispositivo. Conservamos la captura en pantalla; libera espacio y vuelve a pulsar Guardar hoyo.");
      return false;
    }
  }

  function saveRound(options: { prepareReview?: boolean } = {}) {
    const preparingReview = options.prepareReview === true;
    if (betConfigurationIssues.length) {
      setShowBetSetupErrors(true);
      setEditingRound(true);
      setTab("setup");
      setFeedback("Revisa la configuración de apuestas antes de guardar resultados en Histórico.");
      return;
    }
    if (hasActiveBettingConfiguration() && !hasPersistedBettingConsent()) {
      runAfterBettingConsent(() => latestSaveRound.current(options));
      return;
    }
    if (!roundReviewPending && !preparingReview) { setFeedback("Primero termina el último hoyo y revisa los resultados. La ronda todavía no puede incorporarse al Histórico."); return; }
    if (missingActiveHandicapPlayers.length) {
      setFeedback(`Completa el HCP de ${missingActiveHandicapPlayers.map((player) => player.name.trim() || "Sin nombre").join(", ")} antes de guardar los cálculos en Histórico.`); return;
    }
    if (order.some(number => players.some(player => Object.hasOwn(scoreEdits[number] || {}, player.id)))) { setFeedback("Hay scores editados sin guardar. Guarda cada hoyo modificado desde Tarjeta antes de archivar."); return; }
    const abandonedPressurePlayers = abandonedPressurePlayersWithMissingScores(order, players, scores, supplementalBets);
    if (abandonedPressurePlayers.length) {
      setFeedback(`El score máximo de ${abandonedPressurePlayers.map((player) => player.name.trim() || "Sin nombre").join(", ")} solo se usa para calcular Presiones por pareja. Esta versión todavía no archiva tarjetas DNF: conserva la ronda abierta y no captures scores ficticios.`);
      return;
    }
    if (order.some(number => players.some(player => typeof scores[number]?.[player.id] !== "number"))) {
      setFeedback("Faltan scores por confirmar. Completa la tarjeta antes de terminar la ronda."); return;
    }
    const incompleteCapture = firstIncompleteRoundCapture({
      order, players, scores, bets, segments, supplementalBets, putts,
      counterBetKeepers, counterBetEvents, lobaHoles, ballFriendSetup,
    });
    if (incompleteCapture) {
      setCurrentIndex(incompleteCapture.index);
      setHoleValidationErrors(incompleteCapture.errors);
      setTab("round");
      setFeedback(`Revisa las capturas pendientes del hoyo ${incompleteCapture.holeNumber} antes de guardar la ronda.`);
      return;
    }
    const unsettledSupplemental = unsettledSupplementalBetResults(supplemental.results);
    const activeSupplementalCount = supplementalBets.filter((bet) => bet.enabled !== false).length;
    if (unsettledSupplemental.length || supplemental.results.length !== activeSupplementalCount) {
      const labels = [...new Set(unsettledSupplemental.map((result) => supplementalBetDisplayLabel(result.type, result.label)))];
      setFeedback(`No se guardó la ronda: ${labels.length ? labels.join(", ") : "una apuesta complementaria"} sigue provisional. Revisa sus capturas o configuración antes de liquidar.`);
      return;
    }
    if (unresolvedExternalPersonalBets.length) {
      const firstPendingPersonal = unresolvedExternalPersonalBets[0];
      setEditingRound(true);
      setPersonalSetupOpen(true);
      setExpandedPersonalId(firstPendingPersonal.id);
      pendingPersonalFocus.current = firstPendingPersonal.id;
      setTab("setup");
      setFeedback(`Completa la tarjeta externa de ${unresolvedExternalPersonalBets.map((bet) => bet.rivalName?.trim() || "Rival externo").join(", ")} para liquidar sus apuestas personales antes de guardar.`); return;
    }
    const incompleteCoreBets = incompleteCoreBetSettlements({
      order,
      bets,
      segments,
      foursomeMatches: foursomes.matches,
      pollaDetails: polla.details,
      miniPollaDetails: miniPolla.details,
      personalBets,
      personalResults: personals.results,
      monkey,
      ballFriendDetails: ballFriend.details,
      loba,
    });
    if (incompleteCoreBets.length) {
      setFeedback(`No se guardó la ronda: falta cerrar ${incompleteCoreBets.join(", ")}. Revisa sus capturas antes de liquidar.`);
      return;
    }
    if (!isFiniteZeroSum(Object.values(allBetBalances))) {
      setFeedback("No se guardó la ronda porque la liquidación no suma $0 o contiene un importe inválido. Revisa las apuestas activas.");
      return;
    }
    if (preparingReview) {
      if (!persistReviewBeforeLeavingRound(scores, scoreEdits, bets, currentIndex, roundStartedAt, scorecardPhotoIds)) return;
      setFeedback("Ronda terminada. Revisa la liquidación antes de guardarla en Histórico.");
      setShowRoundFinishedNotice(true);
      setTab("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    const storedHistory = readStoredJson<unknown>(localStorage, STORAGE_KEYS.history, []);
    if (Array.isArray(storedHistory) && storedHistory.some((round) => round && typeof round === "object" && (round as RoundSnapshot).id === roundId)) {
      setPendingRoundAction({ message: "¿Sobrescribir esta ronda terminada? Se actualizarán sus resultados e histórico Personal con el mismo ID; se conservará la foto. No se creará otra ronda.", run: () => { void saveConfirmedRound(snapshot); } }); return;
    }
    void saveConfirmedRound(snapshot);
  }

  async function saveConfirmedRound(snapshot: RoundSnapshot) {
    if (roundSaveInFlight.current) return;
    roundSaveInFlight.current = true;
    localPersistRevision.current += 1;
    setSaveStatus("saving");
    const queueForCloud = identity.mode === "authenticated" && cloudLinked;
    try {
      const saved = await saveRoundHistoryLocalFirst({
        storage: window.localStorage,
        ownerId: identity.userId,
        snapshot,
        deviceId: offlineDeviceId.current,
        defaultHandicap: identity.defaultHandicap,
        hasLocalPreferenceState: hadLocalPreferences.current,
        queueForCloud,
      });
      clearActiveRoundStorage(window.localStorage);
      setHistory(() => saved.history.map(normalizeHistorySnapshot));
      setRoundClosed(true);
      setRoundReviewPending(false);
      setDraftAvailable(false);
      updateBackyardAiMetrics(localStorage, identity.userId, (current) => recordRoundCompletionMetric(current, true));
      const timestamp = new Date().toISOString();
      setFrequentPlayers((current) => upsertFrequentPlayers(current, players, timestamp));
      if (snapshot.personalSlidingAdjustments?.length) {
        setSavedPersonalRivals((current) => current.map((template) => {
          const adjustment = snapshot.personalSlidingAdjustments?.find((candidate) => snapshot.personalBets?.find((bet) => bet.id === candidate.betId)?.externalRivalId === template.id);
          if (!adjustment) return template;
          const fields = advantageFieldsFromSigned(adjustment.newAdvantage);
          return { ...template, mode: "sliding", slidingAdvantage: adjustment.newAdvantage, advantageReceiver: fields.advantageReceiver === "none" ? "rival" : fields.advantageReceiver, advantageStrokes: fields.advantageStrokes, updatedAt: timestamp };
        }));
      }
      setSaveStatus("saved");
      if (queueForCloud) {
        setCloudStatus(navigator.onLine ? "pending" : "offline");
        setFeedback("Ronda guardada en este dispositivo · sincronización pendiente.");
        requestCloudSync.current?.();
      } else if (!saved.offlinePersisted) {
        setFeedback("Ronda guardada en este dispositivo.");
      } else {
        setFeedback("Ronda guardada ✓");
      }
      recordScorecardResultReached();
      setTab("results");
    } catch {
      updateBackyardAiMetrics(localStorage, identity.userId, (current) => recordRoundCompletionMetric(current, false));
      setSaveStatus("error");
      setFeedback("No se pudo comprobar la ronda en este dispositivo. El borrador sigue seguro; libera espacio y vuelve a intentar.");
    } finally {
      roundSaveInFlight.current = false;
    }
  }

  useLayoutEffect(() => {
    latestSaveRound.current = saveRound;
  });

  function editHistoricalRound(snapshot: RoundSnapshot) {
    const restored = restoreRoundSnapshot(snapshot);
    if (!restored) return;
    const restoredRoundHoles: 9 | 18 = restored.roundHoles || (restored.order!.length === 9 ? 9 : 18);
    setPendingRoundAction({ message: "¿Corregir esta ronda terminada? Se abrirá una copia editable en lugar de la ronda activa. El histórico permanecerá intacto hasta confirmar Guardar; se reutilizará el ID y se conservará la foto.", run: () => {
    setRoundId(restored.id); setRoundDate(restored.date); setRoundStartedAt(normalizeRoundStartedAt(restored.startedAt) ?? null); setCourse(restored.courseSnapshot!); setCourseSelected(true); setPendingCourseIdentity(null); setCourseSelectionError(false);
    setRoundTemplateOrigin(null);
    setPlayers(restored.players!); setPlayerTeeAssignments(reconcilePlayerTeeAssignments(restored.playerTeeAssignments, restored.players!, restored.courseSnapshot!, new Date().toISOString())); setOwnerId(restored.ownerId); setScores(restored.scores!); setScoreEdits({}); setScorecardPhotoIds(restored.scorecardPhotoIds || (restored.photoId ? [restored.photoId] : []));
    setStartHole(restored.startHole || (restored.order![0] === 10 ? 10 : 1)); setRoundHoles(restoredRoundHoles);
    setRoundHandicapBasis(normalizeRoundHandicapBasis(restored.handicapBasis));
    setRoundPresentation(normalizeRoundPresentation(restored.presentation));
    setBets(restored.betConfig!); setSegments(normalizeFoursomeSegments(restored.segments, restored.order!, restored.betConfig!.foursome.segmentSize));
    setPersonalBets(restored.personalBets || []); setUnitEvents(restored.unitEvents || []);
    setSupplementalBets(normalizeSupplementalBets(restored.supplementalBets, restoredRoundHoles)); setPutts(restored.putts || {});
    setScoreCaptureMode(normalizeScoreCaptureMode(restored.scoreCaptureMode)); setAdvancedStats(normalizeAdvancedStats(restored.advancedStats));
    setCounterBetEvents(normalizeCounterBetEvents(restored.counterBetEvents)); setCounterBetKeepers(restored.counterBetKeepers || emptyCounterBetKeepers()); setLobaHoles(restored.lobaHoles || {});
    setManualBets(restored.manualBets || []); setBallFriendSetup(restored.ballFriendSetup || {}); setExpenses(normalizeExpenses(restored.expenses));
    setCurrentIndex(0); setRoundClosed(false); setRoundReviewPending(true); setEditingRound(true); setDraftAvailable(true); undoStack.current = []; setUndoCount(0); setTab("setup");
    }});
  }

  async function copyResultsSummary() {
    const base = resultSummaryText(course.name, roundDate, settlementIds.map(id => ({ id, name: playerName(id) })), allBetBalances, ownerId, ownerExpenseTotal);
    const payments = settlementTransfers.length ? ["", "Pagos finales", ...settlementTransfers.map(transfer => `${playerName(transfer.fromPlayerId)} paga a ${playerName(transfer.toPlayerId)} ${money(transfer.amount)}`)] : ["", "Pagos finales", "Todo queda saldado."];
    const text = [...base.split("\n"), ...payments].join("\n");
    try { await navigator.clipboard.writeText(text); setFeedback("Resumen copiado"); }
    catch { setFeedback("No se pudo copiar automáticamente. Selecciona y copia el resumen de abajo."); setCopyFallback(text); }
  }

  function resetRound(nextFeedback = "") {
    const principal = identity.mode === "authenticated" ? accountPrimaryRoundPlayer(identity) : null;
    const nextPlayers = principal ? [principal] : [];
    setEditingRound(false); setRoundClosed(false); setRoundReviewPending(false); setShowRoundFinishedNotice(false); setFeedback("");
    setRoundTemplateOrigin(null);
    setRoundPresentation(normalizeRoundPresentation(undefined));
    setPlayers(nextPlayers); setPlayerTeeAssignments([]); setOwnerId(principal?.id || "");
    setScores({}); setScoreEdits({}); setScorecardPhotoIds([]); setScorecardScanStartedAt(null); setPutts({}); setScoreCaptureMode("quick"); setAdvancedStats({}); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({}); setPersonalBets([]); setSupplementalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets(nextPlayers.map((player) => player.id))); setRoundHandicapBasis("relative"); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6)); setCourse(laVista); setCourseSelected(false); setPendingCourseIdentity(null); setCourseSelectionError(false);
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setRoundStartedAt(null); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); setShowNewRoundConfirm(false); setNewRoundBackupError(""); setPendingNewRoundIntent(null); undoStack.current = []; setUndoCount(0); setTab("setup");
    if (nextFeedback) setFeedback(nextFeedback);
  }

  function applyNewRoundIntent(intent: NewRoundIntent, nextFeedback = "") {
    resetRound(nextFeedback);
    if (intent.kind === "blank") return;
    if (intent.kind === "ai") { setTab("aiSetup"); return; }
    if (intent.kind === "group") {
      applyFrequentGroupToDraft(intent.group);
      return;
    }
    const loaded = intent.players.map((player) => ({ ...player, id: player.accountUserId ? accountPrimaryPlayerId(player.accountUserId) : makeId() }));
    setPlayers(loaded); setOwnerId(loaded.find((player) => player.accountUserId === identity.userId)?.id || loaded[0]?.id || ""); setBets(initialBets(loaded.map((player) => player.id)));
  }

  function applyFrequentGroupToDraft(group: FrequentGroup) {
    const loaded = instantiateGroupGameTemplate(group, makeId);
    setPlayers(loaded.players); setOwnerId(loaded.ownerId); setStartHole(loaded.startHole); setRoundHoles(loaded.roundHoles); setRoundHandicapBasis(loaded.roundHandicapBasis);
    setBets(loaded.bets); setSegments(loaded.segments); setPersonalBets(loaded.personalBets); setSupplementalBets(loaded.supplementalBets); setManualBets(loaded.manualBets);
    setRoundTemplateOrigin(loaded.origin);
    setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({}); setPutts({}); setAdvancedStats({}); setScoreEdits({});
  }

  function requestNewRoundIntent(intent: NewRoundIntent) {
    if (!roundClosed && hasRoundProgress(roundDraftPayload())) {
      setNewRoundBackupError("");
      setPendingNewRoundIntent(intent);
      setShowNewRoundConfirm(true);
      return;
    }
    applyNewRoundIntent(intent);
  }

  function requestNewRound() {
    requestNewRoundIntent({ kind: "blank" });
  }

  function requestAiRound() {
    requestNewRoundIntent({ kind: "ai" });
  }

  function applyAiDraftToRound(draft: RoundSetupDraft, start: boolean) {
    const manualCourseState = start ? null : resolveManualRoundCourseState({
      currentCourse: course,
      availableCourses: courseOptions,
      draftCourse: draft.course,
      draftCourseSelected: draft.courseSelected,
      courseIdentity: draft.courseIdentity,
    });
    const nextCourse = manualCourseState?.course ?? draft.course;
    if (nextCourse) {
      const normalizedCourse = withDefaultLaVistaRules(nextCourse);
      setCourse(normalizedCourse);
      setPlayerTeeAssignments(reconcilePlayerTeeAssignments(draft.playerTeeAssignments, draft.players, normalizedCourse, new Date().toISOString()));
    } else {
      setPlayerTeeAssignments([]);
    }
    setCourseSelected(manualCourseState?.courseSelected ?? draft.courseSelected);
    setPendingCourseIdentity(manualCourseState?.pendingIdentity ?? null);
    setCourseSelectionError(false);
    setRoundDate(draft.date);
    setPlayers(structuredClone(draft.players));
    setOwnerId(draft.ownerId);
    setStartHole(draft.startHole);
    setRoundHoles(draft.roundHoles);
    setRoundHandicapBasis(draft.handicapBasis);
    setBets(start ? freezeRoundHandicapBases(structuredClone(draft.bets), draft.players, draft.handicapBasis) : structuredClone(draft.bets));
    setSegments(structuredClone(draft.segments));
    setPersonalBets(structuredClone(draft.personalBets));
    setSupplementalBets(structuredClone(draft.supplementalBets));
    setManualBets(structuredClone(draft.manualBets));
    setBallFriendSetup(structuredClone(draft.ballFriendSetup));
    setRoundPresentation(normalizeRoundPresentation(draft.presentation));
    setRoundTemplateOrigin(draft.templateOrigin ?? null);
    setEditingRound(!start);
    setRoundClosed(false);
    setRoundReviewPending(false);
    setDraftAvailable(true);
    setCurrentIndex(0);
    if (start) {
      setRoundStartedAt((current) => current ?? new Date().toISOString());
      setFeedback("Ronda configurada con Backyard AI. El motor determinista queda a cargo de todos los cálculos.");
      setTab("round");
    } else {
      setFeedback(manualCourseState?.courseSelected
        ? "Configuración de Backyard AI cargada en el modo manual avanzado."
        : manualCourseState?.pendingIdentity
          ? `Abrí la edición manual con lo que ya entendí. Elige el tee de ${manualCourseState.pendingIdentity.name} para continuar.`
          : "Abrí la edición manual con lo que ya entendí. Elige campo y tee para continuar.");
      setTab("setup");
    }
  }

  function persistConfirmedAiParticipationPreferences(plan: AiRoundSetupTelemetry["plan"], draft: RoundSetupDraft) {
    const consent = readLearningConsent(localStorage, identity.userId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
    if (!plan.canConfirm || !hasPersistedBettingConsent() || !consent.personalMemoryEnabled || !/\bnunca\b/.test(normalizeMexicanSpanish(plan.interpretation.input))) return;
    const now = new Date().toISOString();
    for (const action of plan.interpretation.actions) {
      const gameKey = action.type === "configure_core_bet" ? action.bet
        : action.type === "configure_group_nassau" ? "nassau"
          : action.type === "configure_ball_friend" ? "ballFriend"
            : null;
      if (!gameKey || !("excludedPlayerNames" in action)) continue;
      const participantIds = action.type === "configure_core_bet" ? draft.bets[action.bet]?.participantIds
        : action.type === "configure_group_nassau" ? draft.bets.polla.first9.participantIds
          : draft.bets.ballFriend.participantIds;
      for (const playerName of action.excludedPlayerNames || []) {
        const player = draft.players.find((candidate) => normalizeMexicanSpanish(candidate.name) === normalizeMexicanSpanish(playerName));
        if (!player || participantIds?.includes(player.id)) continue;
        const common = {
          schemaVersion: 1 as const,
          id: makeId(),
          key: "bet.participation",
          value: { playerName: player.name, participates: false },
          context: { region: "MX", gameKey },
          origin: "CORRECTION" as const,
          status: "CONFIRMED" as const,
          confidence: 1,
          createdAt: now,
          updatedAt: now,
          confirmedAt: now,
          useCount: 0,
          dataScope: "PERSONAL" as const,
          trainingUse: "EXCLUDED" as const,
        };
        const groupId = draft.templateOrigin?.groupId;
        if (groupId) {
          const preference: GroupPreference = { ...common, recordType: "GROUP_PREFERENCE", ownerId: identity.userId, groupId };
          persistGroupPreference(localStorage, preference, now);
        } else {
          const preference: UserPreference = { ...common, recordType: "USER_PREFERENCE", ownerId: identity.userId };
          persistUserPreference(localStorage, preference, now);
        }
      }
    }
  }

  function confirmAiRound(draft: RoundSetupDraft, plan: AiRoundSetupTelemetry["plan"]) {
    const start = () => {
      applyAiDraftToRound(draft, true);
      persistConfirmedAiParticipationPreferences(plan, draft);
      const consent = readLearningConsent(localStorage, identity.userId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
      if (!consent.personalMemoryEnabled) return;
      const event = createPersonalLearningEvent({
        id: makeId(), ownerId: identity.userId, eventType: "SETUP_ACCEPTED", verified: true,
        occurredAt: new Date().toISOString(), locale: draft.locale, region: "MX",
        payload: { success: true, roundHoles: draft.roundHoles, startHole: draft.startHole },
      });
      if (event) appendLearningRecord(localStorage, identity.userId, event);
    };
    runRoundSetupActionWithBettingConsent(draft, start, runAfterBettingConsent);
  }

  function editAiRoundManually(draft: RoundSetupDraft) {
    const edit = () => applyAiDraftToRound(draft, false);
    runRoundSetupActionWithBettingConsent(draft, edit, runAfterBettingConsent);
  }

  function recordAiRoundPlan(event: AiRoundSetupTelemetry) {
    updateBackyardAiMetrics(localStorage, identity.userId, (current) => recordRoundSetupMetrics(current, {
      success: event.success,
      corrections: event.isCorrection ? 1 : 0,
      questionCount: event.questionCount,
      durationMs: event.durationMs,
      confidence: event.confidence,
    }));
    if (!event.isCorrection) return;
    const consent = readLearningConsent(localStorage, identity.userId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
    if (!consent.personalMemoryEnabled) return;
    if (roundSetupChangeContainsBettingData({
      previousDraft: event.previousDraft,
      nextDraft: event.plan.draft,
      actions: event.plan.actions,
    }) && !hasPersistedBettingConsent()) return;
    const evidence = buildRoundSetupCorrectionRecords({
      ownerId: identity.userId,
      previousDraft: event.previousDraft,
      plan: event.plan,
      confidence: event.confidence,
      durationMs: event.durationMs,
      usedModel: event.usedModel,
      idFactory: makeId,
    });
    for (const record of evidence.records) appendLearningRecord(localStorage, identity.userId, record);
  }

  function openScorecardScanner() {
    setScorecardScanStartedAt(performance.now());
    setHoleValidationErrors([]);
    setTab("scorecardScan");
  }

  function recordScorecardResultReached() {
    if (scorecardScanStartedAt === null) return;
    updateBackyardAiMetrics(localStorage, identity.userId, (current) => recordScorecardOutcomeMetrics(current, {
      outcome: "result",
      photoToResultMs: Math.max(0, performance.now() - scorecardScanStartedAt),
    }));
    setScorecardScanStartedAt(null);
  }

  function applyScannedScorecard(
    result: ScorecardValidationResult,
    photoIds: string[],
    overrides: ScorecardValidationOverrides,
    corrections: ScorecardCorrectionEvidence[],
  ) {
    if (!result.ready) return false;
    const nextScores = applyPendingScoreEdits(scores, scoreEdits);
    for (const cell of result.acceptedCells) {
      nextScores[cell.hole] = { ...(nextScores[cell.hole] || {}), [cell.playerId]: cell.value };
    }
    const savedBets = freezeRoundHandicapBases(bets, players, roundHandicapBasis);
    const startedAt = roundStartedAt ?? new Date().toISOString();
    const photoCommit = resolveScorecardPhotoCommit(scorecardPhotoIds, photoIds);
    const incomplete = firstIncompleteRoundCapture({
      order,
      players,
      scores: nextScores,
      bets: savedBets,
      segments,
      supplementalBets,
      putts,
      counterBetKeepers,
      counterBetEvents,
      lobaHoles,
      ballFriendSetup,
    });
    const savedIndex = incomplete?.index ?? Math.max(0, order.length - 1);
    const persisted = persistCommittedHoleBeforeAdvance(nextScores, {}, savedBets, savedIndex, startedAt, photoCommit.durablePhotoIds);
    if (!persisted) return false;

    checkpoint();
    setScores(nextScores);
    setScoreEdits({});
    setBets(savedBets);
    setScorecardPhotoIds(photoCommit.durablePhotoIds);
    setRoundStartedAt(startedAt);
    if (ownsLocalWorkspace(localStorage, identity.userId)) {
      try {
        const replacingPhotos = photoCommit.removedPhotoIds.length > 0;
        photoCommit.newlyDurablePhotoIds.forEach((photoId, index) => queuePhoto(localStorage, {
          userId: identity.userId,
          roundId,
          photoId,
          operation: replacingPhotos && index === 0 ? "replace" : "upload",
          revision: makeId(),
        }));
        requestCloudSync.current?.();
      } catch {
        // The durable round already references these local blobs. Keep them
        // committed even when the optional cloud outbox cannot be written.
        setCloudStatus("error");
      }
    }
    photoCommit.removedPhotoIds.forEach((photoId) => {
      void deleteScorecardPhoto(photoId).catch(() => undefined);
    });

    const averageConfidence = result.evidence.averageCellConfidence;
    updateBackyardAiMetrics(localStorage, identity.userId, (current) => recordScorecardMetrics(current, {
      detectedCells: result.evidence.detectedCellCount,
      correctedCells: corrections.length,
      averageConfidence,
    }));

    const consent = readLearningConsent(localStorage, identity.userId, BACKYARD_AI_MEMORY_POLICY_VERSION).consent;
    if (consent.personalMemoryEnabled) {
      const interactionId = `${roundId}-scorecard-${makeId()}`;
      const createdAt = new Date().toISOString();
      for (const evidence of corrections) {
        const correction = createScorecardCorrection({
          id: makeId(),
          ownerId: identity.userId,
          interactionId,
          roundId,
          roundPlayerId: evidence.playerId,
          hole: evidence.hole,
          extractedScore: evidence.extractedScore,
          correctedScore: evidence.correctedScore,
          confidence: evidence.confidence,
          source: evidence.source,
          ...(evidence.photoId && photoIds.includes(evidence.photoId) ? { imageReference: evidence.photoId } : {}),
          reason: evidence.reason,
          createdAt,
        });
        if (!correction) continue;
        appendLearningRecord(localStorage, identity.userId, correction);
        const learning = scorecardCorrectionLearningEvent(correction, makeId());
        if (learning) appendLearningRecord(localStorage, identity.userId, learning);
      }
      const accepted = createPersonalLearningEvent({
        id: makeId(),
        ownerId: identity.userId,
        eventType: "SCORECARD_ACCEPTED",
        verified: true,
        occurredAt: createdAt,
        locale: "es-MX",
        region: "MX",
        payload: { cellCount: result.evidence.detectedCellCount, acceptedScoreCount: result.acceptedCells.length, confidence: averageConfidence, source: "VISION" },
      });
      if (accepted) appendLearningRecord(localStorage, identity.userId, accepted);
      const matchCorrections = (overrides.playerMappings?.length ?? 0) + (overrides.acceptCourseMismatch ? 1 : 0);
      if (matchCorrections) {
        const matchEvent = createPersonalLearningEvent({
          id: makeId(),
          ownerId: identity.userId,
          eventType: "MATCH_CORRECTED",
          verified: true,
          occurredAt: createdAt,
          locale: "es-MX",
          region: "MX",
          payload: { correctedValue: matchCorrections, source: "VISION" },
        });
        if (matchEvent) appendLearningRecord(localStorage, identity.userId, matchEvent);
      }
    }

    if (incomplete) {
      setCurrentIndex(incomplete.index);
      setHoleValidationErrors(incomplete.errors);
      setFeedback("Los scores de la foto ya están guardados. Falta confirmar únicamente la información especial de esta apuesta.");
      setTab("round");
      return true;
    }

    setFeedback("Tarjeta confirmada. Validando apuestas y liquidación antes de cerrar la ronda…");
    window.setTimeout(() => latestSaveRound.current({ prepareReview: true }), 0);
    return true;
  }

  function confirmNewRound() {
    setNewRoundBackupError("");
    try {
      const intent = pendingNewRoundIntent;
      if (!intent) throw new Error("new round intent missing");
      if (!backupActiveRoundForReplacement(localStorage, () => Boolean(flushLocalState.current?.()))) throw new Error("backup verification failed");
      applyNewRoundIntent(intent, "La ronda anterior quedó respaldada en este dispositivo.");
    } catch {
      setNewRoundBackupError("No se pudo comprobar el respaldo de la ronda actual. No se inició otra ronda; vuelve a intentar.");
    }
  }

  function deleteActiveRound() {
    const photosToDelete = [...scorecardPhotoIds];
    if (photosToDelete.length && ownsLocalWorkspace(localStorage, identity.userId)) {
      queuePhoto(localStorage, { userId: identity.userId, roundId, photoId: photosToDelete[0], operation: "delete", revision: makeId() });
      requestCloudSync.current?.();
    }
    photosToDelete.forEach((photoId) => { void deleteScorecardPhoto(photoId).catch(() => undefined); });
    flushLocalState.current = null;
    trackLocalCloudEdits(localStorage, null, { highContrast, language: "es-MX", notificationsEnabled, defaultHandicap: identity.defaultHandicap });
    clearActiveRoundStorage(window.localStorage);
    setRoundTemplateOrigin(null);
    setRoundPresentation(normalizeRoundPresentation(undefined));
    setPlayers([]); setPlayerTeeAssignments([]); setOwnerId("");
    setScores({}); setScoreEdits({}); setScorecardPhotoIds([]); setScorecardScanStartedAt(null); setPutts({}); setScoreCaptureMode("quick"); setAdvancedStats({}); setUnitEvents([]); setCounterBetEvents([]); setCounterBetKeepers(emptyCounterBetKeepers()); setLobaHoles({}); setBallFriendSetup({}); setPersonalBets([]); setSupplementalBets([]); setManualBets([]); setShowFullScorecard(false); setExpenses(emptyExpenses);
    setBets(initialBets([])); setRoundHandicapBasis("relative"); setSegments(segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6)); setCourse(laVista); setCourseSelected(false); setPendingCourseIdentity(null); setCourseSelectionError(false);
    setCurrentIndex(0); setRoundId(makeId()); setRoundDate(localDateMexico()); setRoundStartedAt(null); setRoundClosed(false); setRoundReviewPending(false); setDraftAvailable(false); setHoleSummary([]); setShowDeleteRoundConfirm(false); setShowRoundFinishedNotice(false); undoStack.current = []; setUndoCount(0); setSaveStatus("saved"); setTab("welcome");
  }

  function startNewCourse() {
    const fresh: Course = {
      id: makeId(), name: "Campo nuevo", teeName: "General", builtIn: false,
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
    };
    setCourseEditorSelectOnSave(tab === "setup");
    setCourseDraft(fresh); setTab("courses");
  }

  function selectRoundCourse(nextCourse: Course, returnToSetup = false) {
    const apply = () => {
      setCourse(nextCourse);
      setPlayerTeeAssignments(assignTeeToEveryPlayer(players, nextCourse, new Date().toISOString()));
      setCourseSelected(true);
      setPendingCourseIdentity(null);
      setCourseSelectionError(false);
      setRecentCourseIds((current) => rememberRecentCourse(current, nextCourse.id));
      if (returnToSetup) setTab("setup");
    };
    if (nextCourse.id === course.id) apply();
    else confirmRoundChange("Cambiar campo modifica el Par/SI aplicado a los scores existentes.", apply);
  }

  function editCourseFromLibrary(nextCourse: Course) {
    setCourseEditorSelectOnSave(false);
    setCourseDraft(structuredClone(nextCourse));
    setTab("courses");
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
    const changesActiveCourse = courseEditorSelectOnSave;
    const apply = () => {
      setCourses((cs) => [saved, ...cs.filter((c) => c.id !== saved.id)]);
      if (changesActiveCourse) {
        setCourse(saved);
        setCourseSelected(true);
        setPendingCourseIdentity(null);
        setCourseSelectionError(false);
        setRecentCourseIds((current) => rememberRecentCourse(current, saved.id));
      }
      goBack();
    };
    if (changesActiveCourse && Object.values(scores).some(hole => Object.values(hole).some(value => typeof value === "number")) && JSON.stringify(saved.holes) !== JSON.stringify(course.holes)) {
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
    if (courseDraft.builtIn) return;
    const selectedForRound = courseSelected && courseDraft.id === course.id;
    const hasScores = Object.values(scores).some(hole => Object.values(hole).some(value => typeof value === "number"));
    if (selectedForRound && hasScores) {
      window.alert("Este campo está en uso por la ronda activa. Selecciona otro campo antes de eliminarlo para conservar el score y sus cálculos.");
      return;
    }
    const warning = selectedForRound
      ? `¿Eliminar el campo personalizado “${courseDraft.name}”? También se quitará de la ronda que estás configurando.`
      : `¿Eliminar el campo personalizado “${courseDraft.name}”?`;
    if (!window.confirm(warning)) return;
    recordCloudDeletion(localStorage, "course", courseDraft.id);
    const remaining = courses.filter((candidate) => candidate.id !== courseDraft.id);
    setCourses(remaining);
    setFavoriteCourseIds((current) => current.filter((id) => id !== courseDraft.id));
    setRecentCourseIds((current) => current.filter((id) => id !== courseDraft.id));
    if (selectedForRound) {
      setCourse(remaining[0] || laVista);
      setCourseSelected(false);
      setPendingCourseIdentity(null);
      setCourseSelectionError(false);
      setTab("setup");
    } else goBack();
  }

  function restoreOriginalCourse() {
    const original = defaultCourses.find((candidate) => candidate.id === courseDraft.id);
    if (!original || !window.confirm("¿Restablecer la configuración original? Se perderán las ediciones actuales del campo, no las rondas históricas.")) return;
    const restored = structuredClone(original);
    setCourseDraft(restored);
    setCourses((current) => [restored, ...current.filter((candidate) => candidate.id !== restored.id)]);
    if (courseEditorSelectOnSave) setCourse(restored);
  }

  function saveFrequentGroup() {
    const name = groupName.trim();
    if (!name || !players.some((player) => player.name.trim())) return;
    if (frequentGroups.some((group) => group.name.trim().toLocaleLowerCase("es-MX") === name.toLocaleLowerCase("es-MX"))) { setFeedback("Ya existe un grupo con ese nombre."); return; }
    const groupId = makeId();
    const mapped = players.filter((player) => player.name.trim()).map((player) => ({ player, memberId: `member-${makeId()}` }));
    const groupPlayers = mapped.map(({ player, memberId }) => ({ memberId, kind: player.accountUserId ? "account" as const : "guest" as const, name: player.name.trim(), handicap: player.handicap, ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}) }));
    const gameTemplate = createGroupGameTemplate({ ownerId, players, startHole, roundHoles, roundHandicapBasis, bets, segments, personalBets, supplementalBets, manualBets }, Object.fromEntries(mapped.map(({ player, memberId }) => [player.id, memberId])));
    setFrequentGroups((groups) => [{ id: groupId, name, privacy: "private", players: groupPlayers, gameTemplate, uses: 0, updatedAt: new Date().toISOString() }, ...groups]);
    setGroupName("");
    setFeedback(`${name} guardado con sus apuestas habituales.`);
  }

  function saveGeneratedFrequentGroup(name: string, groupPlayers: Array<Pick<Player, "name" | "handicap" | "accountUserId">>) {
    const normalized = name.trim().toLocaleLowerCase("es-MX");
    if (!normalized || frequentGroups.some((group) => group.name.trim().toLocaleLowerCase("es-MX") === normalized)) return false;
    setFrequentGroups((groups) => [{ id: makeId(), name: name.trim(), privacy: "private", players: structuredClone(groupPlayers).map((player) => ({ ...player, memberId: `member-${makeId()}`, kind: player.accountUserId ? "account" as const : "guest" as const })), uses: 0, updatedAt: new Date().toISOString() }, ...groups]);
    return true;
  }

  function startRoundWithGeneratedGroup(groupPlayers: Player[]) {
    requestNewRoundIntent({ kind: "players", players: structuredClone(groupPlayers) });
  }

  function loadFrequentGroup(group: FrequentGroup) {
    confirmRoundChange("Cargar el grupo reemplazará los jugadores y apuestas actuales. Los scores anteriores quedarán conservados, pero no se asignarán automáticamente a nuevos jugadores.", () => {
      applyFrequentGroupToDraft(group);
      setFeedback(`${group.name} cargado. Las apuestas se editarán solo para esta ronda.`);
    });
  }

  function saveRoundAsFrequentGroupTemplate() {
    if (!roundTemplateOrigin) return;
    if (betConfigurationIssues.length) { setShowBetSetupErrors(true); setFeedback("Corrige las apuestas activas antes de actualizar la configuración habitual."); return; }
    const group = frequentGroups.find((candidate) => candidate.id === roundTemplateOrigin.groupId);
    if (!group) { setFeedback("El grupo original ya no existe. Guarda esta ronda como un grupo nuevo si quieres conservar la configuración."); return; }
    const updatedAt = new Date().toISOString();
    const result = updateGroupTemplateFromRound(group, roundTemplateOrigin, { ownerId, players, startHole, roundHoles, roundHandicapBasis, bets, segments, personalBets, supplementalBets, manualBets }, updatedAt);
    if (result.status === "stale") { setFeedback("El grupo cambió en otro momento. Ábrelo de nuevo antes de reemplazar su configuración habitual."); return; }
    setFrequentGroups((groups) => groups.map((candidate) => candidate.id === group.id ? result.group : candidate));
    setRoundTemplateOrigin({ ...roundTemplateOrigin, basedOnUpdatedAt: updatedAt });
    setFeedback(`Configuración habitual de ${group.name} actualizada explícitamente.`);
  }

  function resetFrequentGroupEditor() {
    setFrequentGroupDraft(null);
    setFrequentGroupEditError("");
    setGroupMemberSource("frequent");
    setSelectedGroupFrequentPlayerId("");
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
    setPendingGroupFrequentPlayers([]);
  }

  function beginEditFrequentGroup(group: FrequentGroup) {
    setFrequentGroupDraft(structuredClone(group));
    setFrequentGroupEditError("");
    setGroupMemberSource(frequentPlayers.length ? "frequent" : "new");
    setSelectedGroupFrequentPlayerId(frequentPlayers[0]?.id || "");
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
    setPendingGroupFrequentPlayers([]);
  }

  function addExistingPlayerToFrequentGroup() {
    const saved = frequentPlayers.find((player) => player.id === selectedGroupFrequentPlayerId);
    if (!saved || !frequentGroupDraft) return;
    const member = frequentGroupMemberFromFrequentPlayer(saved);
    if (!member) return;
    const next = addFrequentGroupMember(frequentGroupDraft, member);
    if (next === frequentGroupDraft) {
      setFrequentGroupEditError("Esta cuenta o jugador ya forma parte del grupo.");
      return;
    }
    setFrequentGroupEditError("");
    setFrequentGroupDraft(next);
  }

  function addNewPlayerToFrequentGroup() {
    const member = { name: newGroupMember.name.trim(), handicap: newGroupMember.handicap };
    if (!member.name || !frequentGroupDraft) return;
    const next = addFrequentGroupMember(frequentGroupDraft, member);
    if (next === frequentGroupDraft) {
      setFrequentGroupEditError("Esta cuenta o jugador ya forma parte del grupo.");
      return;
    }
    setFrequentGroupEditError("");
    setFrequentGroupDraft(next);
    if (saveNewGroupMemberAsFrequent) setPendingGroupFrequentPlayers((members) => [...members, member]);
    setNewGroupMember({ name: "", handicap: null });
    setSaveNewGroupMemberAsFrequent(false);
  }

  function editFrequentGroupMember(index: number, patch: Partial<FrequentGroup["players"][number]>) {
    const previous = frequentGroupDraft?.players[index];
    if (!previous) return;
    setFrequentGroupEditError("");
    setFrequentGroupDraft((group) => group ? updateFrequentGroupMember(group, index, patch) : group);
    setPendingGroupFrequentPlayers((members) => members.map((member) => member.name === previous.name ? { ...member, ...patch } : member));
  }

  function removeMemberFromFrequentGroup(index: number) {
    const previous = frequentGroupDraft?.players[index];
    if (!previous) return;
    setFrequentGroupEditError("");
    setFrequentGroupDraft((group) => group ? removeFrequentGroupMember(group, index) : group);
    setPendingGroupFrequentPlayers((members) => members.filter((member) => member.name !== previous.name));
  }

  function saveFrequentGroupEdit() {
    if (!frequentGroupDraft?.name.trim() || !frequentGroupDraft.players.length || frequentGroupDraft.players.some((member) => !member.name.trim())) return;
    if (frequentGroupHasDuplicateMembers(frequentGroupDraft)) {
      setFrequentGroupEditError("Hay una cuenta o jugador repetido. Corrige los integrantes antes de guardar.");
      return;
    }
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
      await saveScorecardPhoto(photoId, file, identity.userId);
      if (!ownsLocalWorkspace(localStorage, identity.userId)) { await deleteScorecardPhoto(photoId); return; }
      const priorPhotoIds = roundScorecardPhotoIds(round);
      queuePhoto(localStorage, { userId: identity.userId, roundId: round.id, photoId, operation: priorPhotoIds.length ? "replace" : "upload", revision: makeId() });
      const nextHistory = history.map(item => item.id === round.id ? { ...item, photoId, scorecardPhotoIds: [photoId], updatedAt: new Date().toISOString() } : item);
      persistRoundHistory(localStorage, nextHistory);
      setHistory(nextHistory);
      await markScorecardPhotosCommitted([photoId], identity.userId).catch(() => undefined);
      await Promise.allSettled(priorPhotoIds.filter((priorId) => priorId !== photoId).map(deleteScorecardPhoto));
      setFeedback(cloudLinked ? "Foto guardada en este dispositivo · sincronización pendiente." : "Foto guardada en este dispositivo.");
    } catch {
      await deleteScorecardPhoto(photoId).catch(() => undefined);
      setFeedback("No se pudo guardar la foto. Conserva el original y vuelve a intentarlo.");
    }
  }

  async function viewScorecardPhoto(round: RoundSnapshot) {
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      let blob = await readScorecardPhoto(round.photoId || round.id, identity.userId, { adoptLegacy: true });
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
      for (const photoId of roundScorecardPhotoIds(target)) {
        try { await deleteScorecardPhoto(photoId); } catch { /* Cloud cleanup remains independently retryable. */ }
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

  function renderPersonalBetsEditor() {
    const frequentPrompts = frequentPersonalSuggestions(savedPersonalRivals, players).filter(({ template }) => (
      !dismissedFrequentPersonalIds.includes(template.id)
      && !personalBets.some((bet) => bet.enabled !== false && (bet.externalRivalId === template.id || bet.rivalName.trim().toLocaleLowerCase("es-MX") === template.name.trim().toLocaleLowerCase("es-MX")))
    ));
    return <>
      {frequentPrompts.map(({ template, message }) => <section className="card frequentPersonalPrompt" key={template.id}><p>{message}</p><div className="dialogActions"><button type="button" className="primary" onClick={() => activateFrequentPersonal(template)}>SÍ</button><button type="button" className="secondary" onClick={() => setDismissedFrequentPersonalIds((current) => [...current, template.id])}>NO</button><button type="button" className="secondary" onClick={() => activateFrequentPersonal(template, true)}>EDITAR</button></div></section>)}
      {savedPersonalRivals.length > 0 && <section className="card savedRivalsCard">
        <div className="sectionTitle"><div><h3>Rivales guardados</h3><p>Plantillas para apuestas futuras. Editarlas no cambia esta ronda ni el Histórico.</p></div></div>
        <div className="frequentTemplateList">{savedPersonalRivals.map((saved) => editingSavedRivalId === saved.id && savedRivalDraft ? <div className="templateEditor rivalTemplateEditor" key={saved.id}>
          <div className="grid3">
            <div><label>Nombre</label><input value={savedRivalDraft.name} onChange={(event) => setSavedRivalDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)} /></div>
            <div><label>HCP predeterminado</label><NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={36} placeholder="HCP" value={savedRivalDraft.handicap} emptyWhenZero={false} onValueChange={(handicap) => setSavedRivalDraft((draft) => draft ? { ...draft, handicap } : draft)} /></div>
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

      {!personalBets.length && <div className="empty">Todavía no hay Nassau Individual. Toca “+ Nassau Individual”.</div>}

      <div ref={personalSetupListRef} className="personalSetupList">{[...personalBets].sort((first, second) => Number(second.enabled !== false) - Number(first.enabled !== false)).map((bet) => {
        const groupRival = bet.rivalPlayerId ? players.find((p) => p.id === bet.rivalPlayerId) : undefined;
        const displayRival = bet.rivalMode === "group" ? (groupRival?.name || "Rival") : (bet.rivalName || "Rival");
        const expanded = expandedPersonalId === bet.id;
        return <section className={`card personalSetupItem ${bet.enabled === false ? "betItemDisabled" : ""}`} key={bet.id} data-personal-editor={bet.id}>
          <div className="personalSetupHeading"><button type="button" aria-expanded={expanded} aria-disabled={bet.enabled === false} aria-controls={`personal-editor-${bet.id}`} onClick={() => { if (bet.enabled !== false) setExpandedPersonalId(expanded ? null : bet.id); }}><span>{owner?.name ?? "Base"} vs {displayRival}<small>{bet.enabled === false ? "Desactivada · no participa" : "Activa"}</small></span><i aria-hidden="true">{expanded ? "⌃" : "⌄"}</i></button><Toggle on={bet.enabled !== false} disabled={!bettingConsentGranted} label={`${bet.enabled === false ? "Activar" : "Desactivar"} Nassau Individual contra ${displayRival}`} onClick={() => {
            if (bet.enabled === false) runAfterBettingConsent(() => { updatePersonalBet(bet.id, { enabled: true, enabledBeforeCategoryOff: undefined }); setExpandedPersonalId(bet.id); });
            else { updatePersonalBet(bet.id, { enabled: false, enabledBeforeCategoryOff: undefined }); if (expanded) setExpandedPersonalId(null); }
          }} /><button type="button" className="remove" aria-label={`Eliminar Nassau Individual contra ${displayRival}`} onClick={() => { setPersonalBets((items) => items.filter((item) => item.id !== bet.id)); if (expanded) setExpandedPersonalId(null); }}>×</button></div>
          {expanded && bet.enabled !== false && <fieldset disabled={!bettingConsentGranted} id={`personal-editor-${bet.id}`} className="personalSetupBody bettingEditorFieldset">
          <p className="muted">Ventaja y presión aplican solo a esta apuesta.</p>
          <div className="grid3">
            <div><label>¿Dónde juega el rival?</label><select data-personal-first value={bet.rivalMode === "group" || bet.rivalMode === "external" ? bet.rivalMode : ""} onFocus={(event) => event.currentTarget.closest<HTMLElement>("[data-personal-editor]")?.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={(e) => {
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
            }}><option value="" disabled>Selecciona</option><option value="group">Mi foursome</option><option value="external">Otro foursome</option></select></div>
            {bet.rivalMode === "group" ? <div><label>Rival</label><select value={bet.rivalPlayerId || ""} onChange={(e) => {
              const rp = players.find((p) => p.id === e.target.value);
              const next = { ...bet, rivalPlayerId: e.target.value, rivalName: rp?.name || "Rival" };
              updatePersonalBet(bet.id, (bet.advantageMode ?? "current_index") === "current_index" ? configureCurrentIndexPersonal(next, players.find((player) => player.id === ownerId), rp, roundDate) : next);
            }}>{players.filter((p) => p.id !== ownerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div> : bet.rivalMode === "external" ? <>
              <div><label>Rival guardado</label><select value={bet.externalRivalId || ""} onChange={(e) => {
                const saved = savedPersonalRivals.find((r) => r.id === e.target.value);
                updatePersonalBet(bet.id, saved ? applySavedPersonalRivalTemplate(bet, saved) : { externalRivalId: undefined, rivalHandicap: null });
              }}><option value="">+ Nuevo rival</option>{savedPersonalRivals.map((r) => <option key={r.id} value={r.id}>{r.name}{typeof r.handicap === "number" ? ` · HCP ${r.handicap}` : ""}</option>)}</select></div>
              <div><label>Nombre del rival para esta ronda</label><input value={bet.rivalName ?? ""} placeholder="Ej. Daniel" onChange={(e) => updatePersonalBet(bet.id, { rivalName: e.target.value })} /></div>
              <div className="templateSaveAction"><label>Plantilla frecuente</label><button className="secondary" disabled={!bet.rivalName?.trim()} onClick={() => savePersonalRivalFromBet(bet)}>{bet.externalRivalId ? "Guardar cambio en rival frecuente" : "Guardar como rival frecuente"}</button></div>
            </> : null}
            <MoneyInput label="Valor base" value={bet.baseValue} onChange={(v) => updatePersonalBet(bet.id, { baseValue: v })} />
            <div><label>Modo de ventaja</label><select value={bet.advantageMode ?? "current_index"} onChange={(event) => setPersonalAdvantageMode(bet, event.target.value as "current_index" | "sliding" | "manual")}><option value="current_index">ÍNDICE ACTUAL</option><option value="sliding">SLIDING</option><option value="manual">Manual avanzada</option></select><small>{(bet.advantageMode ?? "current_index") === "current_index" ? "Usa la fuente canónica vigente; el HCP de perfil se marca provisional." : bet.advantageMode === "sliding" ? "La ventaja cambia un golpe al guardar el resultado de esta Personal." : "Configuración explícita para compatibilidad y casos avanzados."}</small></div>
            {roundHoles === 18 && <div><label htmlFor={`pressure-${bet.id}`}>Presión · 2ª vuelta jugada</label><select id={`pressure-${bet.id}`} value={bet.pressureMultiplier ?? bet.back9Multiplier ?? 1} onChange={(event) => updatePersonalBet(bet.id, { pressureMultiplier: Number(event.target.value) as 1 | 2 | 3 | 4 | 5, back9Multiplier: 1 })}><option value={1}>Sin presión</option><option value={2}>Sí · 2x</option>{[3,4,5].map((value) => <option key={value} value={value}>{value}x</option>)}</select><small>Aplica a {startHole === 10 ? "H1–9" : "H10–18"}. Total 18 conserva valor base.</small></div>}
            {roundHoles === 18 && <div><label htmlFor={`carry-${bet.id}`}>Carry</label><select id={`carry-${bet.id}`} value={bet.carryEnabled ? "yes" : "no"} onChange={(event) => updatePersonalBet(bet.id, { carryEnabled: event.target.value === "yes" })}><option value="no">No</option><option value="yes">Sí</option></select><small>Match y Medal independientes. Se suma a la presión.</small></div>}
            {bet.advantageMode === "sliding" ? <div><label>Ventaja Sliding firmada</label><NumericCaptureInput min={-54} max={54} step={1} value={bet.slidingAdvantage ?? 0} emptyWhenZero={false} onValueChange={(value) => updatePersonalBet(bet.id, configureSlidingPersonal(bet, value ?? 0))} /><small>Positivo: {displayRival} recibe. Negativo: {owner?.name} recibe.</small></div> : <>
              <div><label>Quién recibe ventaja</label><select disabled={(bet.advantageMode ?? "current_index") === "current_index"} value={bet.advantageReceiver === "owner" || bet.advantageReceiver === "rival" ? bet.advantageReceiver : ""} onChange={(e) => updatePersonalBet(bet.id, { advantageReceiver: e.target.value as "owner" | "rival" })}><option value="" disabled>Selecciona</option><option value="owner">{owner?.name} recibe</option><option value="rival">{displayRival} recibe</option></select></div>
              <div><label>Golpes que recibe</label><NumericCaptureInput disabled={(bet.advantageMode ?? "current_index") === "current_index"} min={0} max={54} step={1} value={bet.advantageStrokes} emptyWhenZero={false} onValueChange={(value) => updatePersonalBet(bet.id, { advantageStrokes: Math.max(0, value ?? 0) })} /></div>
            </>}
          </div>
          {(bet.advantageMode ?? "current_index") === "current_index" && (!bet.ownerIndexSnapshot || !bet.rivalIndexSnapshot) && <div className="notice bad">Falta un índice vigente. Captura HCP para ambos o cambia a Manual avanzada.</div>}
          {(bet.advantageMode ?? "current_index") === "current_index" && bet.ownerIndexSnapshot && bet.rivalIndexSnapshot && <div className="hint">Fuente: {bet.ownerIndexSnapshot.indexSource === "PROFILE_FALLBACK" || bet.rivalIndexSnapshot.indexSource === "PROFILE_FALLBACK" ? "HCP de perfil provisional" : bet.ownerIndexSnapshot.indexSource}. No se presenta como Handicap Index® oficial.</div>}
          <div className="templateSaveAction"><button className="secondary" disabled={!bet.rivalName?.trim()} onClick={() => savePersonalRivalFromBet(bet)}>GUARDAR COMO PERSONAL FRECUENTE</button></div>
          {bet.advantageStrokes === 0 && <div className="hint">Sin ventaja.</div>}
          <div className="componentGrid">{(roundHoles === 9
            ? ([["match1","Match 9"],["medal1","Medal 9"]] as [keyof PersonalBet["components"], string][])
            : ([["match1",`Match 1ª · ${startHole === 10 ? "H10–18" : "H1–9"}`],["medal1",`Medal 1ª · ${startHole === 10 ? "H10–18" : "H1–9"}`],["match2",`Match 2ª · ${startHole === 10 ? "H1–9" : "H10–18"}`],["medal2",`Medal 2ª · ${startHole === 10 ? "H1–9" : "H10–18"}`],["match18","Match Total 18"],["medal18","Medal Total 18"]] as [keyof PersonalBet["components"], string][])
          ).map(([key, label]) => {
            const selected = Boolean(bet.components?.[key]);
            return <button type="button" key={key} className={`component ${selected ? "selected" : ""}`} onClick={() => updatePersonalBet(bet.id, { components: { ...(bet.components || {}), [key]: !selected } as PersonalBet["components"] })}>{selected ? "✓ " : ""}{label}</button>;
          })}</div>

          {bet.rivalMode === "external" && <div className="externalCard">
            <div className="row between"><div><b>Tarjeta de {displayRival}</b><div className="muted">Captúrala aparte; no entra a Conejos, Skins, Foursome, Bola Amiga ni Unidades.</div></div><span className="pillSmall">Otro grupo</span></div>
            <div className="externalScoreGrid">{order.map((h) => {
              const hd = course.holes.find((x) => x.number === h)!;
              return <label className="externalHole" key={h}><span>H{h}<small> P{hd.par}</small></span><NumericCaptureInput min={1} inputMode="numeric" value={bet.externalScores?.[h]} emptyWhenZero={false} placeholder="–" onValueChange={(value) => setExternalPersonalScore(bet.id, h, value)} /></label>;
            })}</div>
          </div>}
          </fieldset>}
        </section>;
      })}</div>
    </>;
  }

  function renderManualBetsEditor(embedded = false) {
    return <section ref={embedded ? manualSetupListRef : undefined} className={embedded ? "manualBetsEditor" : "card"}>
      {!embedded && <div className="sectionTitle"><div><h2>Apuestas manuales</h2><p>Para cualquier apuesta no contemplada. Captura ganancia (+) o pérdida (−); debe cerrar en $0.</p></div><button className="textButton" onClick={newManualBet}>+ Apuesta</button></div>}
      {embedded && <p className="muted">Para cualquier apuesta no contemplada. Captura ganancia (+) o pérdida (−); debe cerrar en $0.</p>}
      {!manualBets.length && <div className="empty">Sin apuestas manuales.</div>}
      {[...manualBets].sort((first, second) => Number(second.enabled !== false) - Number(first.enabled !== false)).map((bet) => {
        const total = manualBetTotal(bet);
        const valid = manualBetIsValid(bet);
        return <div data-manual-editor={bet.id} className={`manualBet ${bet.enabled === false ? "betItemDisabled" : ""}`} key={bet.id}>
          <div className="row between"><input disabled={!bettingConsentGranted} data-manual-first className="manualName" value={bet.name ?? ""} onChange={(e) => updateManualBet(bet.id, { name: e.target.value })} /><span className="manualBetActions"><Toggle on={bet.enabled !== false} disabled={!bettingConsentGranted} label={`${bet.enabled === false ? "Activar" : "Desactivar"} ${bet.name || "apuesta manual"}`} onClick={() => {
            if (bet.enabled === false) runAfterBettingConsent(() => updateManualBet(bet.id, { enabled: true, enabledBeforeCategoryOff: undefined }));
            else updateManualBet(bet.id, { enabled: false, enabledBeforeCategoryOff: undefined });
          }} /><button className="remove" aria-label={`Eliminar ${bet.name || "apuesta manual"}`} onClick={() => setManualBets((bs) => bs.filter((x) => x.id !== bet.id))}>×</button></span></div>
          {bet.enabled !== false && <><fieldset disabled={!bettingConsentGranted} className="manualGrid bettingEditorFieldset">{players.map((p) => <label key={p.id}><span>{p.name}</span><SignedMoneyInput label={`${bet.name || "apuesta manual"} · ${p.name}`} value={bet.amounts?.[p.id] ?? 0} onChange={(next) => setManualAmount(bet.id, p.id, next)} /></label>)}</fieldset>
          <div className={`manualBalance ${valid ? "good" : "bad"}`}>{valid
            ? "✓ Cierra en $0 y se suma al resultado"
            : !bet.name?.trim() ? "Escribe un nombre para la apuesta" : `Falta cuadrar ${money(-total)}`}</div></>}
        </div>;
      })}
    </section>;
  }

  function renderManualBetResults() {
    const activeManualBets = manualBets.filter((bet) => bet.enabled !== false);
    if (!activeManualBets.length) return <div className="empty">Sin apuestas manuales activas en esta ronda.</div>;
    return <div className="manualResultsList">{activeManualBets.map((bet) => {
      const total = manualBetTotal(bet);
      const valid = manualBetIsValid(bet);
      return <article className="manualResult" key={bet.id}>
        <div className="row between"><b>{typeof bet.name === "string" && bet.name.trim() ? bet.name.trim() : "Apuesta manual"}</b><span className={valid ? "good" : "bad"}>{valid ? "✓ Cierra en $0" : !bet.name?.trim() ? "Falta nombre" : "Pendiente de cuadrar"}</span></div>
        <div className="manualResultPlayers">{players.map((player) => { const amount = bet.amounts?.[player.id] ?? 0; return <div key={player.id}><span>{player.name}</span><strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div>; })}</div>
        <div className="manualResultTotal"><span>Total de la apuesta</span><b className={valid ? "good" : "bad"}>{signedMoney(total)}</b></div>
      </article>;
    })}</div>;
  }

  function renderPollaResult(detail: (typeof polla.details)[number]) {
    const label = groupNassauLabels.resultComponent(detail.key);
    return <div className="pollaResult"><div className="row between"><div><b>{label}</b><div className="muted">Hoyos {detail.holes.join(", ")} · valor {money(detail.value)} por jugador</div></div><strong>{detail.complete ? (detail.winnerIds.length ? detail.winnerIds.map(playerName).join(" / ") : "—") : "Pendiente"}</strong></div>{detail.complete && <div className="componentResults"><span>Ganador{detail.winnerIds.length !== 1 ? "es" : ""}: <b>{detail.winnerIds.map(playerName).join(" / ")}</b></span><span>Premio bruto c/u: <b>{money(detail.grossPrizePerWinner)}</b></span>{detail.winnerIds.length > 1 && <span>Empate: <b>premio dividido</b></span>}</div>}</div>;
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
  const currentRabbitNumber = Math.floor((holeNumber - 1) / 3) + 1;
  const currentRabbitBlockWinner = rabbitMode === "three_hole_blocks"
    ? liveRabbits.events.find((event) => event.rabbitNumber === currentRabbitNumber && event.type === "win")
    : undefined;
  const currentSkin = liveSkins.events.find((e) => e.hole === holeNumber);
  const unitHoleManual = (id: string) => unitEvents.filter((e) => e.hole === holeNumber && e.playerId === id).reduce((a, e) => a + e.amount, 0);
  const bfSetup = ballFriendSetup[holeNumber] ?? { teamA: [] };
  const bfDetail = liveBallFriend.details.find((d) => d.hole === holeNumber);
  const savedBfDetail = ballFriend.details.find((d) => d.hole === holeNumber);

  function toggleHoleSummaryPause() {
    holeSummarySession.current?.togglePause();
  }

  function handleHoleSummaryTap(event: React.MouseEvent<HTMLDivElement>) {
    const start = holeSummaryPointerStart.current;
    holeSummaryPointerStart.current = null;
    if (!start || Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8) return;
    if ((event.target as HTMLElement).closest("button,a,input,select,textarea,summary")) return;
    toggleHoleSummaryPause();
  }

  function commitFocusedNumericCapture() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.dataset.numericCapture === "true") {
      active.blur();
    }
  }

  function requestSaveAndAdvance() {
    // Keyboard activation and some iOS touch paths can reach click without a
    // reliable pointerdown. Blur once more here if needed before reading state.
    commitFocusedNumericCapture();
    // pointerdown/blur commits the input with flushSync. The layout effect from
    // that render has already refreshed this ref, so Save reads the confirmed
    // score immediately without a timing delay or a stale closure.
    latestSaveAndAdvance.current();
  }

  function requestRoundHistorySave() {
    commitFocusedNumericCapture();
    latestSaveRound.current();
  }

  function saveAndAdvance() {
    if (holeSummarySession.current) return;
    if (hasActiveBettingConfiguration() && !hasPersistedBettingConsent()) {
      runAfterBettingConsent(() => latestSaveAndAdvance.current());
      return;
    }
    const missingCaptureFacts = requiredRoundCaptureFactErrors({
      players,
      bets,
      supplementalBets,
      putts,
      counterBetEvents,
    }, currentIndex, holeNumber);
    const capturedScoreCandidates = {
      ...scores,
      [holeNumber]: {
        ...(scores[holeNumber] || {}),
        ...Object.fromEntries(players.flatMap((player) => {
          const edited = scoreEdits[holeNumber]?.[player.id];
          return typeof edited === "number" ? [[player.id, edited]] : [];
        })),
      },
    };
    const abandonedHere = abandonedPressurePlayersWithMissingScores([holeNumber], players, capturedScoreCandidates, supplementalBets);
    const withdrawalErrors = abandonedHere.length ? [
      `El score máximo de ${abandonedHere.map((player) => player.name.trim() || "Sin nombre").join(", ")} solo se usa para calcular Presiones por pareja; esta versión no admite terminar una tarjeta con jugador retirado (DNF). Conserva la ronda abierta y no captures scores ficticios.`,
    ] : [];
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
      counterBetEvents,
      lobaConfig: bets.loba,
      lobaHole: lobaHoles[holeNumber],
      foursomeConfig: bets.foursome,
      foursomeSegments: segments,
      order,
      ballFriendConfig: bets.ballFriend,
      ballFriendSetup: ballFriendSetup[holeNumber],
      extraErrors: [
        ...missingCaptureFacts,
        ...betConfigurationIssues.map((issue) => issue.message),
      ],
    });
    validationErrors.unshift(...withdrawalErrors);
    if (validationErrors.length) {
      setFeedback("");
      setHoleValidationErrors(validationErrors);
      return;
    }
    const committed = commitHoleCapture(scores, scoreEdits, hole, players);
    if (!committed) { setHoleValidationErrors(["Completa los scores vacíos antes de guardar el hoyo."]); return; }
    const startedAt = ensureRoundStarted();
    // Also covers entering Tarjeta directly without pressing Iniciar ronda.
    const savedBets = freezeRoundHandicapBases(bets, players, roundHandicapBasis);
    const savedIndex = currentIndex;
    const checkpointPersisted = persistCommittedHoleBeforeAdvance(committed.scores, committed.edits, savedBets, savedIndex, startedAt);
    if (!checkpointPersisted) return;
    setHoleValidationErrors([]);
    setFeedback("");
    checkpoint();
    setBets(savedBets);
    setScores(committed.scores); setScoreEdits(committed.edits);
    const savedScores = committed.scores;
    const savedRabbits = calculateRabbits(course, savedScores, players, bets.rabbits, order, roundHandicapBasis);
    const savedSkins = calculateSkins(course, savedScores, players, bets.skins, order, roundHandicapBasis);
    const savedFoursomes = calculateFoursomes(course, savedScores, players, savedBets.foursome, segments, order, roundHandicapBasis);
    const savedUnits = calculateUnits(players, unitEvents, bets.units, course, savedScores, order);
    const savedBallFriend = calculateBallFriend(course, savedScores, players, savedBets.ballFriend, ballFriendSetup, order, roundHandicapBasis);
    const savedPolla = calculatePolla(course, savedScores, players, bets.polla, order, roundHandicapBasis);
    const savedMiniPolla = calculateMiniPolla(course, savedScores, players, bets.miniPolla, order, roundHandicapBasis);
    const savedPersonals = calculatePersonalBets(personalBets, ownerId, players, course, savedScores, order);
    const savedSupplemental = calculateSupplementalBets(supplementalBets, players, course, savedScores, putts, order, roundHandicapBasis);
    const savedMonkey = calculateMonkey(course, savedScores, players, bets.monkey, order, roundHandicapBasis);
    const savedCompletedHoles = new Set([...completedHoles, holeNumber]);
    const savedVipers = calculateCounterBet("vipers", players, bets.vipers, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedCamels = calculateCounterBet("camels", players, bets.camels, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedFish = calculateCounterBet("fish", players, bets.fish, counterBetEvents, counterBetKeepers, order, savedCompletedHoles);
    const savedLoba = calculateLoba(course, savedScores, players, bets.loba, lobaHoles, order, savedCompletedHoles, roundHandicapBasis);
    const extras: string[] = [];
    const rabbit = savedRabbits.events.filter(event => event.hole === holeNumber).at(-1);
    const rabbitBlockWinner = rabbitMode === "three_hole_blocks"
      ? savedRabbits.events.find((event) => event.rabbitNumber === currentRabbitNumber && event.type === "win")
      : undefined;
    const currentSkin = savedSkins.events.find(item => item.hole === holeNumber);
    if (bets.rabbits.enabled) extras.push(`🐇 Conejo: ${rabbit?.playerId ? playerName(rabbit.playerId) : rabbit ? "libre" : rabbitBlockWinner?.playerId ? `bloque cerrado · ganó ${playerName(rabbitBlockWinner.playerId)}` : "pendiente de resolverse"}`);
    if (bets.skins.enabled) extras.push(...(currentSkin ? skinHoleNotice(currentSkin, bets.skins.value, currentIndex === order.length - 1, playerName, skinsMode) : ["⛳ Skins: pendiente de resolverse"]));
    const currentFoursomes = savedFoursomes.matches.filter((match) => match.holePoints.some((item) => item.hole === holeNumber));
    for (const match of currentFoursomes) {
      const holePoints = match.holePoints.find((item) => item.hole === holeNumber)?.points ?? 0;
      const leader = (holePoints > 0 ? match.basePair : match.opponentPair).map(playerName).join(" + ");
      const accumulated = (match.pointDiff > 0 ? match.basePair : match.opponentPair).map(playerName).join(" + ");
      extras.push(`🤝 Foursome · ${holePoints === 0 ? "Empate" : `${leader} +${Math.abs(holePoints)}`}\nAcum: ${match.pointDiff === 0 ? "AS" : `${accumulated} +${Math.abs(match.pointDiff)}`}`);
    }
    const unitLines = players.map((player) => ({ name: player.name, value: (savedUnits.autoByHole[holeNumber]?.[player.id] || 0) + unitHoleManual(player.id) })).filter((item) => item.value !== 0);
    if (bets.units.enabled) extras.push(`📏 Unidades · hoyo: ${unitLines.length ? unitLines.map((item) => `${item.name} ${item.value > 0 ? "+" : ""}${item.value}`).join(" · ") : "sin movimiento"}`);
    const bfDetail = savedBallFriend.details.find(item => item.hole === holeNumber);
    if (bfDetail) extras.push(`⚪🤝 Bola Amiga: ${playerName(bfDetail.teamA[0])}/${playerName(bfDetail.teamA[1])} ${bfDetail.pointDiff >= 0 ? "+" : ""}${bfDetail.pointDiff} pts`);
    for (const detail of [...savedPolla.details, ...savedMiniPolla.details].filter((item) => item.complete && item.holes.at(-1) === holeNumber)) {
      const icon = detail.key === "total18" ? "🏆" : detail.key === "mini" ? "⚡" : "🥈";
      const label = detail.key === "mini" ? "Mini Polla" : groupNassauLabels.component(detail.key);
      extras.push(`${icon} ${label}: ${detail.winnerIds.map(playerName).join(" / ")} gana${detail.winnerIds.length > 1 ? "n" : ""}`);
    }
    const activePollaLabels = [
      [bets.polla.first9.enabled, `🥈 ${groupNassauLabels.component("first9")}`, savedPolla.details.find((detail) => detail.key === "first9")],
      [bets.polla.second9.enabled, `🥈 ${groupNassauLabels.component("second9")}`, savedPolla.details.find((detail) => detail.key === "second9")],
      [bets.polla.total18.enabled, `🏆 ${groupNassauLabels.component("total18")}`, savedPolla.details.find((detail) => detail.key === "total18")],
      [bets.miniPolla.enabled, "⚡ Mini Polla", savedMiniPolla.details.find((detail) => detail.key === "mini")],
    ] as const;
    for (const [enabled, label, detail] of activePollaLabels) if (enabled && !detail?.complete) extras.push(`${label}: pendiente · acumulado hasta H${holeNumber}`);
    for (const result of [savedVipers, savedCamels, savedFish]) {
      const quantity = counterBetEvents.filter(item => item.kind === result.kind && item.hole === holeNumber).reduce((sum, item) => sum + item.quantity, 0);
      const active = result.kind === "vipers" ? bets.vipers.enabled : result.kind === "camels" ? bets.camels.enabled : bets.fish.enabled;
      if (active) { const meta = COUNTER_BET_META[result.kind]; extras.push(`${meta.emoji} ${meta.plural} · hoyo: ${quantity || "sin movimiento"}`); }
    }
    const lobaDetail = savedLoba.details.find(detail => detail.hole === holeNumber);
    if (lobaDetail) {
      const lobaNames = lobaDetail.lobaTeam.map(playerName).join(" + ");
      const opponentNames = lobaDetail.opponents.map(playerName).join(" + ");
      extras.push(`🐺 ${lobaNames} ${lobaDetail.lobaBestNet} neto vs ${opponentNames} ${lobaDetail.opponentBestNet} neto · 🔥${lobaDetail.fireMultiplier}x · ${lobaDetail.winner === "tie" ? "Empate" : lobaDetail.winner === "loba_team" ? `ganó ${lobaNames}` : `ganó ${opponentNames}`}${bets.loba.unitsEnabled ? ` · 📏 ${lobaDetail.lobaUnits} vs ${lobaDetail.opponentUnits}` : ""}`);
    }
    for (const result of savedPersonals.results) {
      const line = personalHoleSummary(result, playerName(ownerId), playerName(result.rivalId), holeNumber);
      if (line) extras.push(`↔ Personales · ${line}`);
    }
    for (const result of savedSupplemental.results) {
      const balance = Object.entries(result.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => `${playerName(id)} ${signedMoney(amount)}`).join(" · ");
      const holeLine = [...result.lines].reverse().find((line) => line.includes(`H${holeNumber}`));
      extras.push(`${isPersonalSupplementalType(result.type) ? "↔ Personales · " : ""}${supplementalBetDisplayLabel(result.type, result.label)} · hoyo: ${holeLine || "pendiente o sin movimiento"}\nAcumulado hasta H${holeNumber}: ${balance || "$0"}`);
    }
    for (const bet of manualBets.filter((item) => item.enabled !== false)) {
      const balance = Object.entries(bet.amounts ?? {}).filter(([, amount]) => amount !== 0).map(([id, amount]) => `${playerName(id)} ${signedMoney(amount)}`).join(" · ");
      extras.push(`✍️ Manuales · ${bet.name || "Apuesta"}: ${balance || "pendiente o $0"}`);
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
        else latestSaveRound.current({ prepareReview: true });
      },
    });
  }
  useLayoutEffect(() => { latestSaveAndAdvance.current = saveAndAdvance; });

  const todayMx = localDateMexico();
  const currentMonth = todayMx.slice(0, 7);
  const currentYear = todayMx.slice(0, 4);
  const betaGolfInsights = useMemo(() => buildGolfInsights(history), [history]);
  const monthGolfInsights = useMemo(
    () => buildGolfInsights(history.filter((round) => typeof round.date === "string" && round.date.startsWith(currentMonth))),
    [history, currentMonth],
  );
  const yearGolfInsights = useMemo(
    () => buildGolfInsights(history.filter((round) => typeof round.date === "string" && round.date.startsWith(currentYear))),
    [history, currentYear],
  );
  const personalActivity = useMemo(
    () => buildPersonalActivity(history, frequentGroups, identity.displayName),
    [history, frequentGroups, identity.displayName],
  );
  const activeRoundSummary = useMemo<ActiveRoundSummary | null>(() => {
    if (!draftAvailable || roundClosed) return null;
    const scoreStarted = Boolean(roundStartedAt) || currentIndex > 0 || Object.values(scores).some((row) => Object.values(row).some((value) => typeof value === "number"));
    const status: ActiveRoundSummary["status"] = resolveActiveRoundStatus({ reviewPending: roundReviewPending, courseSelected, playerCount: players.length, scoreStarted });
    return {
      courseName: courseSelected ? course.name : pendingCourseIdentity ? `${pendingCourseIdentity.name} · tee por elegir` : "Campo por elegir",
      roundDate,
      status,
      totalHoles: roundHoles,
      currentHole: status === "live" ? order[currentIndex] : undefined,
      playedHoles: completedHoles.size,
      playerCount: players.length,
    };
  }, [draftAvailable, roundClosed, roundReviewPending, courseSelected, course.name, pendingCourseIdentity, roundDate, roundStartedAt, roundHoles, order, currentIndex, completedHoles, players.length, scores]);
  const openActiveRound = () => {
    if (betConfigurationIssues.length) {
      setShowBetSetupErrors(true);
      setEditingRound(true);
      setFeedback("La ronda se conserva, pero debes corregir sus apuestas activas antes de continuar la tarjeta.");
      setTab("setup");
      return;
    }
    setTab("round");
  };
  const continueActiveRound = () => {
    const target = activeRoundContinueTarget(activeRoundSummary?.status, courseSelected);
    if (target === "round") openActiveRound();
    else setTab(target);
  };
  const handlePageBack = () => {
    if (tab === "setup" && editingRound && betConfigurationIssues.length) {
      setEditingRound(false);
      setShowBetSetupErrors(true);
      setFeedback("La configuración incompleta quedó guardada como borrador. Corrígela antes de continuar la tarjeta.");
      setTab("welcome");
      return;
    }
    goBack();
  };
  const availableHistoryYears = useMemo(() => historyYears(history), [history]);
  const filteredHistory = useMemo(() => filterHistory(history, historyYear, historyMonth), [history, historyYear, historyMonth]);
  const personalModesActive = personalBets.some((bet) => bet.enabled !== false)
    || supplementalBets.some((bet) => bet.enabled !== false && isPersonalSupplementalType(bet.type));
  const resultNavigationItems = [
    { id: "golf-result", label: "Golf", visible: true },
    { id: "bet-values", label: "Valores de apuesta", visible: true },
    { id: "general-summary", label: "Resumen General", visible: true },
    { id: "rabbits", label: betDisplayLabel("rabbits"), visible: bets.rabbits.enabled },
    { id: "skins", label: betDisplayLabel("skins"), visible: bets.skins.enabled },
    { id: "units", label: betDisplayLabel("units"), visible: bets.units.enabled },
    { id: "ball-friend", label: betDisplayLabel("ball_friend"), visible: bets.ballFriend.enabled },
    { id: "vipers", label: betDisplayLabel("vipers"), visible: bets.vipers.enabled },
    { id: "camels", label: betDisplayLabel("camels"), visible: bets.camels.enabled },
    { id: "fish", label: betDisplayLabel("fish"), visible: bets.fish.enabled },
    { id: "loba", label: betDisplayLabel("loba"), visible: bets.loba.enabled },
    { id: "foursome", label: betDisplayLabel("foursome"), visible: bets.foursome.enabled },
    { id: "polla-first9", label: `🥈 ${groupNassauLabels.component("first9")}`, visible: bets.polla.first9.enabled },
    { id: "polla-second9", label: `🥈 ${groupNassauLabels.component("second9")}`, visible: bets.polla.second9.enabled },
    { id: "polla-total18", label: `🏆 ${groupNassauLabels.component("total18")}`, visible: bets.polla.total18.enabled },
    { id: "mini-polla", label: betDisplayLabel("mini_polla"), visible: bets.miniPolla.enabled },
    { id: "monkey", label: betDisplayLabel("monkey"), visible: Boolean(bets.monkey?.enabled) },
    ...supplementalGeneralResults.map((result) => ({ id: `supplemental-${result.betId}`, label: supplementalBetDisplayLabel(result.type, result.label), visible: true })),
    { id: "manuals", label: betDisplayLabel("manuals"), visible: manualBets.some((bet) => bet.enabled !== false) },
    { id: "personals", label: betDisplayLabel("personals"), visible: personalModesActive },
    { id: "expenses", label: "Gastos", visible: true },
  ].filter((item) => item.visible);

  return <main className={`app ${highContrast ? "highContrast" : ""} ${tab === "results" ? "compactResults" : ""}`}>
    {tab !== "rules" && <header className="topbar">
      <button className="brandHomeButton" onClick={() => setTab("welcome")} aria-label="Ir a Inicio"><BrandLockup compact /></button>
      <div className="topActions"><span className={`saveIndicator ${saveStatus}`}>{saveStatus === "saving" ? "Guardando…" : saveStatus === "error" ? "Error de guardado" : identity.mode !== "authenticated" || !cloudLinked ? "Guardado en este dispositivo" : cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando…" : cloudStatus === "offline" ? "Sin conexión · pendiente" : cloudStatus === "error" ? "Error de sincronización" : "Pendiente de sincronizar"}</span><button className="contrastButton" onClick={() => changeHighContrast(!highContrast)} aria-pressed={highContrast}>{contrastToggleLabel(highContrast)}</button><button className="accountButton" onClick={() => setTab("profile")} aria-label="Abrir perfil y cuenta">{identity.mode === "guest" ? <svg className="guestAvatar" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-5 3-7.5 7.5-7.5s7 2.5 7.5 7.5"/></svg> : (identity.displayName.trim()[0] || "S").toUpperCase()}</button></div>
    </header>}

    {tab === "welcome" && <HomeDashboard
      displayName={identity.displayName}
      avatarUrl={identity.avatarUrl}
      handicap={identity.defaultHandicap}
      activeRound={activeRoundSummary}
      latestRound={betaGolfInsights.recentRounds[0] || null}
      insights={betaGolfInsights}
      groupCount={frequentGroups.length}
      activity={personalActivity}
      onContinueRound={continueActiveRound}
      onAiRound={requestAiRound}
      onNewRound={requestNewRound}
      onOpenProfile={() => setTab("profile")}
      onOpenHistory={() => setTab("history")}
      onOpenBalances={() => setTab("balances")}
      onOpenStats={() => setTab("stats")}
      onOpenGroups={() => setTab("groups")}
      onOpenSocial={() => setTab("social")}
      onOpenCourses={() => setTab("courseLibrary")}
      onOpenRules={openRulesForRound}
      onOpenRound={openHistoricalRound}
      onOpenActivity={openPersonalActivity}
    />}

    {!(["welcome", "play", "groups", "social", "profile"] as AppTab[]).includes(tab) && tab !== "rules" && <button className="secondary pageBack" onClick={handlePageBack}>← Regresar</button>}

    {tab === "play" && <PlayHub
      activeRound={activeRoundSummary}
      onContinueRound={continueActiveRound}
      onEditRound={activeRoundSummary ? editActiveRound : undefined}
      onAiRound={requestAiRound}
      onNewRound={requestNewRound}
      onOpenHistory={() => setTab("history")}
      onOpenBalances={() => setTab("balances")}
      onOpenPersonalHistory={() => setTab("personals")}
      onOpenStats={() => setTab("stats")}
      onOpenCourses={() => setTab("courseLibrary")}
      onOpenGroups={() => setTab("groups")}
      onOpenRules={openRulesForRound}
      onOpenStandings={() => setTab("standings")}
      onOpenResults={() => setTab("results")}
    />}

    {tab === "aiSetup" && <AiRoundSetup
      initialDraft={createRoundSetupDraft({
        locale: "es-MX",
        date: roundDate,
        course: courseSelected ? course : null,
        courseSelected,
        courseIdentity: courseSelected ? undefined : pendingCourseIdentity ?? undefined,
        players,
        playerTeeAssignments,
        ownerId,
        startHole,
        roundHoles,
        handicapBasis: roundHandicapBasis,
        presentation: roundPresentation,
        bets,
        segments,
        personalBets,
        supplementalBets,
        manualBets,
        ballFriendSetup,
        templateOrigin: roundTemplateOrigin ?? undefined,
      })}
      memoryContext={{ profile: identity, frequentPlayers, frequentGroups, history, courses, today: roundDate, idFactory: makeId }}
      accessToken={identity.accessToken}
      requiresRemoteConsent={identity.mode === "authenticated"}
      savedPersonalRivals={savedPersonalRivals}
      onConfirm={confirmAiRound}
      onManualEdit={editAiRoundManually}
      onCancel={() => setTab("welcome")}
      onPlanned={recordAiRoundPlan}
    />}

    {tab === "scorecardScan" && <ScorecardScanner
      storageOwnerId={identity.userId}
      accessToken={identity.accessToken}
      requiresRemoteConsent={identity.mode === "authenticated"}
      hasActiveBettingData={hasActiveBettingConfiguration()}
      requestBettingConsent={requestBettingConsent}
      protectedPhotoIds={protectedScorecardPhotoIds}
      round={{
        roundId,
        players: players.map((player) => ({ id: player.id, name: player.name })),
        course: {
          id: course.id,
          name: course.name,
          aliases: [course.clubName].filter((name): name is string => Boolean(name?.trim())),
          holes: course.holes.map((candidate) => ({ number: candidate.number, par: candidate.par })),
        },
        startHole,
        roundHoles,
        digitalScores: applyPendingScoreEdits(scores, scoreEdits),
      }}
      onApply={applyScannedScorecard}
      onManualFallback={() => { setScorecardScanStartedAt(null); setTab("round"); }}
      onCancel={() => { setScorecardScanStartedAt(null); setTab("round"); }}
    />}

    {tab === "social" && <SocialFeed activity={personalActivity} identityUserId={identity.userId} notificationsEnabled={notificationsEnabled} onNotificationsEnabledChange={changeNotifications} onOpenRound={openHistoricalRound} onOpenGroup={() => setTab("groups")} onCreateRound={requestNewRound} onOpenGroups={() => setTab("groups")} />}
    {tab === "balances" && <BalanceLedgerPanel history={history} currentUserId={identity.mode === "authenticated" ? identity.userId : undefined} />}
    {tab === "stats" && <StatsDashboard insights={betaGolfInsights} onOpenHistory={() => setTab("history")} onOpenRound={openHistoricalRound} />}
    {tab === "courseLibrary" && <CourseLibrary courses={courses} favoriteCourseIds={favoriteCourseIds} recentCourseIds={recentCourseIds} selectedCourseId={courseSelected ? course.id : null} onToggleFavorite={(courseId) => setFavoriteCourseIds((current) => toggleFavoriteCourse(current, courseId))} onSelectCourse={(nextCourse) => selectRoundCourse(nextCourse, true)} onCreateCourse={startNewCourse} onEditCourse={editCourseFromLibrary} />}

    {feedback && <div className="notice" role="status">{feedback}<button className="textButton" aria-label="Cerrar mensaje" onClick={() => setFeedback("")}>×</button></div>}
    {copyFallback && <section className="card"><label>Resumen para copiar<textarea readOnly value={copyFallback} onFocus={event => event.currentTarget.select()} /></label><button onClick={() => setCopyFallback("")}>← Regresar</button></section>}
    {showNewRoundConfirm && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="new-round-title" aria-describedby="new-round-description"><h2 id="new-round-title">¿Iniciar una nueva ronda?</h2><p id="new-round-description">Ya tienes una ronda en curso. Si comienzas una nueva, la ronda actual dejará de ser la ronda activa.</p>{newRoundBackupError && <div className="notice bad" role="alert">{newRoundBackupError}</div>}<div className="dialogActions"><button autoFocus className="secondary" onClick={() => { setShowNewRoundConfirm(false); setNewRoundBackupError(""); setPendingNewRoundIntent(null); }}>Cancelar</button><button className="primary" onClick={confirmNewRound}>Sí, iniciar nueva ronda</button></div></section></div>}
    {pendingRoundAction && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="round-change-title"><h2 id="round-change-title">Confirmar cambios</h2><p>{pendingRoundAction.message}</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setPendingRoundAction(null)}>Cancelar</button><button className="primary" onClick={() => { const action = pendingRoundAction; setPendingRoundAction(null); action.run(); }}>Confirmar</button></div></section></div>}
    {showRoundFinishedNotice && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="round-finished-title"><h2 id="round-finished-title">Ronda terminada</h2><p>{ROUND_REVIEW_NOTICE}</p><div className="dialogActions"><button autoFocus className="primary" onClick={() => { setShowRoundFinishedNotice(false); setTab("results"); }}>Revisar resultados</button></div></section></div>}
    {pendingCloudConflict && (() => { const conflict = pendingCloudConflict.conflicts[0]; if (!conflict) return null; const display = describeCloudConflict(conflict, playerName); return <div className="modalBackdrop"><section className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="cloud-conflict-title"><h2 id="cloud-conflict-title">Cambio en dos dispositivos</h2><p>Elige únicamente el dato en conflicto. Los demás cambios compatibles ya se combinaron.</p><div className="cloudConflictField"><b>{display.label}</b><span>Nube: {display.cloudValue}</span><span>Este dispositivo: {display.localValue}</span></div>{pendingCloudConflict.conflicts.length > 1 && <small>Quedan {pendingCloudConflict.conflicts.length} conflictos por revisar.</small>}<div className="dialogActions"><button className="secondary" onClick={() => resolveCloudConflict("cloud")}>Usar nube para este dato</button><button className="primary" onClick={() => resolveCloudConflict("local")}>Usar este dispositivo</button></div></section></div>; })()}
    {holeValidationErrors.length > 0 && <div className="modalBackdrop" role="presentation"><section className="confirmDialog holeValidationDialog" role="alertdialog" aria-modal="true" aria-labelledby="hole-validation-title" aria-describedby="hole-validation-description"><h2 id="hole-validation-title">Falta completar este hoyo</h2><p id="hole-validation-description">Revisa todos estos puntos antes de guardar y avanzar:</p><ul>{holeValidationErrors.map(error => <li key={error}>{error}</li>)}</ul><div className="dialogActions"><button autoFocus className="primary" onClick={() => setHoleValidationErrors([])}>Volver y completar</button></div></section></div>}
    {tab === "personalDetail" && renderPersonalLive("Detalle Personal")}
    {tab === "historyDetail" && (() => { const saved = history.find(round => round.id === historyDetailId); return saved ? <HistoricalRoundDetail round={saved} onEdit={() => editHistoricalRound(saved)} onPhoto={() => viewScorecardPhoto(saved)} /> : <div className="empty">La ronda ya no está disponible.</div>; })()}
    {tab === "groups" && <GroupBuilder frequentPlayers={frequentPlayers} frequentGroups={frequentGroups} onBack={() => setTab("welcome")} onPlay={startRoundWithGeneratedGroup} onSaveFrequentGroup={saveGeneratedFrequentGroup} onEditFrequentGroup={beginEditFrequentGroup} onDeleteFrequentGroup={setFrequentGroupToDelete} />}

    {tab === "profile" && <AccountPanel view="profile" highContrast={highContrast} onHighContrastChange={changeHighContrast} notificationsEnabled={notificationsEnabled} onNotificationsEnabledChange={changeNotifications} golfInsights={betaGolfInsights} onOpenStats={() => setTab("stats")} onOpenAccount={() => setTab("account")} />}
    {tab === "account" && <AccountPanel view="account" highContrast={highContrast} onHighContrastChange={changeHighContrast} notificationsEnabled={notificationsEnabled} onNotificationsEnabledChange={changeNotifications} golfInsights={betaGolfInsights} onOpenStats={() => setTab("stats")} />}

    {tab === "setup" && <>
      <section className="hero setupHero">
        <div className="setupHeroCopy"><div className="eyebrow">NUEVA JUGADA</div><h1>Configura y juega.</h1><p>La app calcula lo automático; tú solo capturas score y eventos especiales.</p></div>
        <div className="heroDate"><input aria-label="Fecha de la ronda" className="dateInput" type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} /><button type="button" className="secondary" onClick={() => { setEditingRound(false); setFeedback("Tu configuración quedó guardada como borrador."); setTab("welcome"); }}>Guardar y salir</button></div>
      </section>

      {roundTemplateOrigin && (() => { const sourceGroup = frequentGroups.find((group) => group.id === roundTemplateOrigin.groupId); return sourceGroup ? <section className="roundTemplateNotice" role="status"><div><span>PLANTILLA CARGADA</span><b>{sourceGroup.name}</b><p>Los cambios de HCP y apuestas pertenecen únicamente a esta ronda.</p></div><button className="secondary" onClick={saveRoundAsFrequentGroupTemplate}>Guardar estos cambios como configuración habitual</button></section> : null; })()}

      <section className="card">
        <div className="sectionTitle"><div><h2>1. Campo y tee inicial</h2><p>Elige una salida como punto de partida. Después puedes asignar un tee distinto a cada jugador.</p></div><div className="courseSetupActions"><button className="textButton" onClick={() => setTab("courseLibrary")}>Buscar / cerca</button><button className="textButton" onClick={startNewCourse}>+ Campo</button></div></div>
        {!courseSelected && pendingCourseIdentity && <div className="notice" id="round-course-ai-focus" role="status"><b>Campo reconocido: {pendingCourseIdentity.name}</b><br />{pendingCourseCandidates.length ? "Elige uno de sus tees destacados primero, o selecciona otro campo." : "No encontré un tee exacto en el catálogo actual. Selecciona cualquier campo y tee para continuar."}</div>}
        <div className="grid2">
          <div className={`courseSelectionField ${courseSelectionError ? "isMissing" : ""}`}><label htmlFor="round-course">Campo · Tee</label><select id="round-course" value={courseSelected ? course.id : ""} aria-invalid={courseSelectionError} aria-describedby={[!courseSelected && pendingCourseIdentity ? "round-course-ai-focus" : "", courseSelectionError ? "round-course-error" : ""].filter(Boolean).join(" ") || undefined} onChange={(e) => {
            const next = courses.find((candidate) => candidate.id === e.target.value); if (next) selectRoundCourse(next);
          }}><option value="" disabled>{pendingCourseIdentity ? `Selecciona tee de ${pendingCourseIdentity.name}` : "Selecciona campo y tee"}</option>{pendingCourseIdentity ? <>{pendingCourseCandidates.length > 0 && <optgroup label={`Tees de ${pendingCourseIdentity.name}`}>{pendingCourseCandidates.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.teeName}</option>)}</optgroup>}{otherCourseOptions.length > 0 && <optgroup label="Otros campos y tees">{otherCourseOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.teeName}</option>)}</optgroup>}</> : courseOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.teeName}</option>)}</select>{courseSelectionError && <span id="round-course-error" className="courseSelectionError" role="alert">Selecciona un campo para continuar.</span>}</div>
          <div><label>Inicio de ronda</label><select value={startHole} onChange={(e) => { const next = Number(e.target.value) as 1 | 10; confirmRoundChange("Cambiar la salida cambia el orden Nassau y los segmentos de Foursome.", () => { setStartHole(next); setCurrentIndex(0); }); }}><option value={1}>Hoyo 1</option><option value={10}>Hoyo 10</option></select></div>
          <div><label>Hoyos a jugar</label><select value={roundHoles} onChange={(e) => { const next = Number(e.target.value) as 9 | 18; confirmRoundChange("Cambiar la duración excluye del cálculo los hoyos fuera de la nueva vuelta, sin borrar sus scores.", () => { setRoundHoles(next); setSupplementalBets((current) => supplementalBetsForRoundHoles(current, next)); setCurrentIndex(0); }); }}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></div>
        </div>
        {courseSelected && <div className="courseMeta"><span>{course.holes.length} hoyos configurados</span><span>Tee {course.teeName}</span>{course.updatedAt && <span>Última actualización: {course.updatedAt}</span>}<button onClick={() => { setCourseEditorSelectOnSave(true); setCourseDraft(withDefaultLaVistaRules(course)); setTab("courses"); }}>{course.name === "La Vista Temporal" ? "Editar campo temporal" : "Editar campo"}</button>{isLaVistaCourse(course.name) && <button onClick={() => { setRulesCourseContext(course.name); setTab("rules"); }}>Ver Reglas Locales</button>}</div>}
        {courseSelected && players.length > 0 && <div className="playerTeeAssignments">
          <div className="row between"><div><b>TEES</b><small>Se guarda un snapshot por jugador para esta ronda.</small></div><button type="button" className="secondary" onClick={() => setPlayerTeeAssignments(assignTeeToEveryPlayer(players, course, new Date().toISOString()))}>TODOS IGUAL</button></div>
          <div className="playerTeeGrid">{players.map((player) => {
            const assignment = playerTeeAssignments.find((item) => item.playerId === player.id);
            const selectedTee = teeOptions.find((option) => (option.catalogTeeId || option.id) === assignment?.teeId) || course;
            return <label key={player.id}><span>{player.name || "Jugador"}</span><select aria-label={`Tee de ${player.name || "jugador"}`} value={selectedTee.id} onChange={(event) => {
              const nextTee = teeOptions.find((option) => option.id === event.target.value);
              if (nextTee) setPlayerTeeAssignments((current) => updatePlayerTeeAssignment(current, player.id, nextTee, new Date().toISOString()));
            }}>{teeOptions.map((option) => <option key={option.id} value={option.id}>{option.teeName}{typeof option.rating === "number" ? ` · ${option.rating}/${option.slope ?? "—"}` : ""}</option>)}</select></label>;
          })}</div>
          <p className="hint">EDITAR POR JUGADOR está siempre disponible. El HCP capturado sigue siendo el valor canónico de la ronda; no se inventa un índice a partir del tee.</p>
        </div>}
      </section>

      <section className="card" id="round-players">
        <div className="sectionTitle"><div><h2>2. Jugadores</h2><p>Captura el HCP original de cada jugador para esta ronda.</p></div><button className="textButton" onClick={addPlayer}>+ Jugador</button></div>
        {!players.length && <div className="empty">Agrega los jugadores de esta ronda.</div>}
        {players.map((p) => <div className="playerEdit" key={p.id}>
          <input placeholder="Nombre" value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} />
          <div className={`roundHcpField ${typeof p.handicap === "number" && Number.isFinite(p.handicap) ? "" : "isMissing"}`}><NumericCaptureInput className="hcpInput" inputMode="decimal" step={0.1} min={-15} max={36} placeholder="HCP" value={p.handicap} emptyWhenZero={false} aria-invalid={typeof p.handicap !== "number" || !Number.isFinite(p.handicap)} aria-describedby={typeof p.handicap !== "number" || !Number.isFinite(p.handicap) ? `round-hcp-error-${p.id}` : undefined} onValueChange={(handicap) => updatePlayer(p.id, { handicap })} />{(typeof p.handicap !== "number" || !Number.isFinite(p.handicap)) && <span className="roundHcpError" id={`round-hcp-error-${p.id}`}>Completa el HCP</span>}</div>
          <button className={`ownerDot ${ownerId === p.id ? "active" : ""}`} onClick={() => setOwnerId(p.id)} title="Jugador principal">★</button>
          <button className="remove" aria-label={`Quitar a ${p.name || "jugador"}`} onClick={() => { confirmRoundChange(`Quitar a ${p.name} lo excluye de las apuestas y parejas actuales.`, () => setPlayers((ps) => ps.filter((x) => x.id !== p.id))); }}>×</button>
        </div>)}
        <RoundHandicapBasisControl value={roundHandicapBasis} onChange={setRoundHandicapBasis} />
        <div className="hint">★ marca al jugador principal para estadísticas y gastos.</div>
        {(frequentGroups.length > 0 || frequentPlayers.length > 0) && <div className="frequentBox">
          {frequentGroups.length > 0 && <details className="frequentDisclosure"><summary><span>Grupos guardados ({frequentGroups.length})<small>Toca aquí para agregar un grupo</small></span></summary><div className="frequentGroupList">{frequentGroups.map((group) => <div className="templateRow groupTemplateRow" key={group.id}>
            <button className="templateLoad" onClick={() => loadFrequentGroup(group)} aria-label={`Cargar grupo ${group.name} a la ronda`}><b>{group.name}</b><span>{group.players.map((member) => member.name).join(" · ")}<br />{frequentGroupTemplateSummary(group)} · Toca para cargar</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentGroup(group)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentGroupToDelete(group)}>🗑 Eliminar</button></div>
          </div>)}</div></details>}
          {frequentPlayers.length > 0 && <details className="frequentDisclosure"><summary><span>Jugadores frecuentes ({frequentPlayers.length})<small>Toca aquí para agregar un jugador</small></span></summary><div className="frequentTemplateList">{frequentPlayers.map((saved) => editingFrequentPlayerId === saved.id ? <div className="templateEditor" key={saved.id}>
            <input aria-label="Nombre frecuente" value={frequentPlayerDraft.name} onChange={(event) => setFrequentPlayerDraft((draft) => ({ ...draft, name: event.target.value }))} />
            <NumericCaptureInput aria-label="HCP frecuente" className="hcpInput" inputMode="decimal" step={0.1} min={-15} max={36} placeholder="HCP" value={frequentPlayerDraft.handicap} emptyWhenZero={false} onValueChange={(handicap) => setFrequentPlayerDraft((draft) => ({ ...draft, handicap }))} />
            <div className="templateActions"><button className="primary" disabled={!frequentPlayerDraft.name.trim()} onClick={saveFrequentPlayerEdit}>Guardar</button><button className="secondary" onClick={() => setEditingFrequentPlayerId(null)}>Cancelar</button></div>
          </div> : <div className="templateRow" key={saved.id}>
            <button className="templateLoad" onClick={() => appendPlayer(saved.name, saved.handicap, saved.accountUserId)}><b>{saved.name}</b><span>HCP {saved.handicap ?? "—"} · + Agregar</span></button>
            <div className="templateActions"><button className="secondary" onClick={() => beginEditFrequentPlayer(saved)}>✏ Editar</button><button className="dangerGhost" onClick={() => setFrequentPlayerToDelete(saved)}>🗑 Eliminar</button></div>
          </div>)}</div></details>}
        </div>}
        {players.some((player) => player.name.trim()) && <div className="inlineForm"><input placeholder="Nombre del grupo frecuente" value={groupName} onChange={(event) => setGroupName(event.target.value)} /><button className="secondary" onClick={saveFrequentGroup}>Guardar grupo</button></div>}
      </section>

      <section className="card">
        <div className="sectionTitle"><div><h2>3. Apuestas grupales</h2><p>Todas las modalidades del grupo, con su porcentaje y participantes.</p></div></div>
        {!bettingConsentGranted && <div className="notice compactConsentNotice" role="status">Para activar o registrar apuestas, completa el consentimiento específico desde <button type="button" className="textButton" onClick={() => setTab("account")}>Mi Cuenta</button>. Tus datos anteriores se conservan.</div>}
        <div className="groupedBetSetupList">

        <SetupBetCard id="rabbits" icon="🐇" title="Conejos" description="Gana hoyos · captura y conserva el conejo" help="rabbits" enabled={bets.rabbits.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, rabbits: { ...current.rabbits, enabled } }))}><BetModeControl label="conejos" value={rabbitMode} options={RABBIT_MODE_OPTIONS} onChange={(mode) => setBets((current) => ({ ...current, rabbits: { ...current.rabbits, mode, ...(mode === "continuous" ? { accumulate: true } : {}) } }))} /><div className="grid3"><MoneyInput label="Valor" value={bets.rabbits.value} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, value: v } })} /><HcpPercentInput value={bets.rabbits.hcpPct} onChange={(v) => setBets({ ...bets, rabbits: { ...bets.rabbits, hcpPct: v } })} /><HandicapModeSelect value={bets.rabbits.decimals} onChange={(decimals) => setBets({ ...bets, rabbits: { ...bets.rabbits, decimals } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.rabbits.participantIds} onChange={(ids) => setBets({ ...bets, rabbits: { ...bets.rabbits, participantIds: ids } })} /></SetupBetCard>

        <SetupBetCard id="skins" icon="⛳" title="Skins" description="Mejor score neto único gana el skin" help="skins" enabled={bets.skins.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, skins: { ...current.skins, enabled } }))}><BetModeControl label="skins" value={skinsMode} options={SKINS_MODE_OPTIONS} onChange={(mode) => setBets((current) => ({ ...current, skins: { ...current.skins, mode } }))} /><div className="grid3"><MoneyInput label="Valor" value={bets.skins.value} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, value: v } })} /><HcpPercentInput value={bets.skins.hcpPct} onChange={(v) => setBets({ ...bets, skins: { ...bets.skins, hcpPct: v } })} /><HandicapModeSelect value={bets.skins.decimals} onChange={(decimals) => setBets({ ...bets, skins: { ...bets.skins, decimals } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.skins.participantIds} onChange={(ids) => setBets({ ...bets, skins: { ...bets.skins, participantIds: ids } })} /></SetupBetCard>

        <SetupBetCard id="units" icon="📏" title="Unidades / Copas" description="Puntos positivos y negativos · todos contra todos" help="units" enabled={bets.units.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, units: { ...current.units, enabled } }))}><div className="grid2"><MoneyInput label="Valor por unidad" value={bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, value: v } })} /><MoneyInput label="Valor por Copa" value={bets.units.copaValue ?? bets.units.value} onChange={(v) => setBets({ ...bets, units: { ...bets.units, copaValue: v } })} /></div><label className="miniLabel">Participan en Unidades / Copas</label><ParticipantChips players={players} selected={bets.units.participantIds} onChange={(ids) => setBets({ ...bets, units: { ...bets.units, participantIds: ids } })} /></SetupBetCard>

        <SetupBetCard id="foursome" icon="🤝" title="Foursome" description="Parejas · puntos por Low/High según configuración" help="foursome" enabled={bets.foursome.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, foursome: { ...current.foursome, enabled } }))}>
          <>
            {roundHandicapBasis === "relative" && <HandicapBaseControl name="Foursome" config={bets.foursome} fallback="moving" onChange={baseMode => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", baseMode, fixedBaseHandicap: undefined } })} />}
            <div className="grid3">
              <div><label>Modalidad</label><select value={bets.foursome.mode} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, mode: e.target.value as BetConfig["foursome"]["mode"] } })}><option value="fixed">Fijo</option><option value="fixed_points">Fijo + Patada</option><option value="points">Solo puntos</option></select></div>
              <div><label>Cambia parejas</label><select value={bets.foursome.segmentSize} onChange={(e) => setBets({ ...bets, foursome: { ...bets.foursome, segmentSize: Number(e.target.value) as 3 | 6 | 9 | 18 } })}><option value={3}>Cada 3</option><option value={6}>Cada 6</option><option value={9}>Cada 9</option><option value={18}>18 hoyos</option></select></div>
              <HcpPercentInput value={bets.foursome.hcpPct} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", hcpPct: v } })} />
              {(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Foursome fijo" value={bets.foursome.fixedValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, fixedValue: v } })} />}
              {(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") && <MoneyInput label="Valor punto / patada" value={bets.foursome.pointValue} onChange={(v) => setBets({ ...bets, foursome: { ...bets.foursome, pointValue: v } })} />}
              <DecimalModeSelect label="Decimales Foursome" value={bets.foursome.decimals} onChange={(decimals) => setBets({ ...bets, foursome: { ...bets.foursome, handicapMethod: "configured", decimals } })} />
            </div>
            {roundHoles === 18 && <div className="pressureOption pressureGrid">
              <div><b>Presión Foursome</b><span>Se aplica siempre a la segunda vuelta jugada.</span></div>
              <div><label>Presión</label><select value={bets.foursome.pressureMultiplier ?? (bets.foursome.pressSecond9 ? 2 : 1)} onChange={(event) => setBets({ ...bets, foursome: { ...bets.foursome, ...setFoursomePressure(bets.foursome, Number(event.target.value) as 1 | 2 | 3 | 4 | 5) } })}><option value={1}>Sin presión</option>{[2,3,4,5].map((value) => <option key={value} value={value}>{value}x</option>)}</select></div>
              {foursomePressure(bets.foursome) > 1 && <div><label>Vuelta presionada</label><strong>2ª jugada · H{order[9]}–H{order.at(-1)}</strong></div>}
            </div>}
            <label className="miniLabel">Jugadores de Foursome</label><ParticipantChips players={players} selected={bets.foursome.participantIds} onChange={(ids) => setBets({ ...bets, foursome: { ...bets.foursome, participantIds: ids } })} />
            <div className="foursomeAutoTools">
              <button type="button" className="secondary" disabled={![4, 5].includes(bets.foursome.participantIds.length)} onClick={generateFoursomesAutomatically}>GENERAR FOURSOMES AUTOMÁTICAMENTE</button>
              {bets.foursome.participantIds.length === 5 && <label>Máximo de apariciones en pareja base<NumericCaptureInput min={1} max={6} step={1} value={foursomeMaxBaseAppearances} emptyWhenZero={false} onValueChange={(value) => setFoursomeMaxBaseAppearances(Math.max(1, Math.trunc(value ?? 1)))} /></label>}
              <span>EDITAR PAREJAS · toca jugadores en cada segmento</span>
            </div>
            {foursomeGenerationMessage && <div className={foursomeGenerationMessage.startsWith("Parejas") ? "notice" : "notice bad"} role="status">{foursomeGenerationMessage}</div>}
            <div className="segments">{segments.map((s) => {
              if (!s || typeof s !== "object") return null;
              const holes = order.slice(s.startIndex, s.endIndex + 1);
              const basePair = Array.isArray(s.basePair) ? s.basePair : [];
              const opps = opponentPairs(bets.foursome.participantIds, basePair);
              return <div className="segment" key={s.id}><div className="segmentTitle">Hoyos {holes[0]}–{holes[holes.length - 1]} · pareja base {s.generatedByBackyard && <em>GENERADA POR BACKYARD</em>}</div><div className="chips">{playersByIds(players, bets.foursome.participantIds).map((p) => <button key={p.id} className={`chipButton ${basePair.includes(p.id) ? "selected" : ""}`} onClick={() => toggleBasePair(s.id, p.id)}>{p.name}</button>)}</div>{basePair.length === 2 && <div className="generated"><b>{playerName(basePair[0])} + {playerName(basePair[1])}</b>{opps.length === 1 ? <span>vs {opps[0].map(playerName).join(" + ")}</span> : <span>vs {playersByIds(players, bets.foursome.participantIds).filter(player => !basePair.includes(player.id)).map(player => player.name).join(" · ")} · {opps.length} matches</span>}</div>}</div>;
            })}</div>
          </>
        </SetupBetCard>

        <SetupBetCard id="ball-friend" icon="⚪🤝" title="Bola Amiga" description="Los 2 jugadores de la derecha vs los 2 de la izquierda" help="ball_friend" enabled={bets.ballFriend.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, ballFriend: { ...current.ballFriend, enabled } }))}>{roundHandicapBasis === "relative" && <HandicapBaseControl name="Bola Amiga" config={bets.ballFriend} fallback="fixed" onChange={baseMode => setBets({ ...bets, ballFriend: { ...bets.ballFriend, baseMode, fixedBaseHandicap: undefined } })} />}<div className="grid3"><MoneyInput label="Valor punto" value={bets.ballFriend.value} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, value: v } })} /><HcpPercentInput value={bets.ballFriend.hcpPct} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, hcpPct: v } })} /><NumberField label="Score máximo" value={bets.ballFriend.maxScore} onChange={(v) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, maxScore: v } })} /><DecimalModeSelect value={bets.ballFriend.decimals} onChange={(decimals) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, decimals } })} /></div><label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.ballFriend.participantIds} onChange={(ids) => setBets({ ...bets, ballFriend: { ...bets.ballFriend, participantIds: ids } })} /></SetupBetCard>

        <SetupBetCard id="monkey" icon="🐒" title="Monkey" description="Exactamente tres jugadores · 6 puntos por hoyo" help="monkey" enabled={Boolean(bets.monkey?.enabled)} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, monkey: { value: 20, hcpPct: 100, participantIds: players.slice(0, 3).map((player) => player.id), ...current.monkey, enabled } }))}><div className="grid2"><MoneyInput label="Valor punto Monkey" value={bets.monkey?.value ?? 20} onChange={value=>setBets(current => ({...current,monkey:{...current.monkey!,value}}))} /><HcpPercentInput value={bets.monkey?.hcpPct ?? 100} onChange={hcpPct=>setBets(current => ({...current,monkey:{...current.monkey!,hcpPct}}))} /></div><ParticipantChips players={players} selected={bets.monkey?.participantIds ?? []} onChange={participantIds=>setBets(current => ({...current,monkey:{...current.monkey!,participantIds}}))} /><p>{monkey.valid ? roundHandicapBasis === "course" ? `HCP sobre el campo · ${bets.monkey?.hcpPct ?? 100}% · sin redondeo.` : `HCP entre estos tres · ${bets.monkey?.hcpPct ?? 100}% · sin redondeo.` : missingActiveHandicapPlayers.length ? "Completa el HCP de los participantes para calcular." : "Selecciona exactamente tres jugadores; no se calcula con otra cantidad."}</p></SetupBetCard>

        <PollaBetEditor
          title={groupNassauLabels.component("first9")}
          icon={BET_PRESENTATION.polla_first.icon}
          trophy="silver"
          description={`Mejor medal neto en la primera vuelta jugada · H${order[0]}–H${order[Math.min(8, order.length - 1)]}`}
          config={bets.polla.first9}
          players={players}
          unavailable={false}
          requestActivation={requestBettingConsent}
          locked={!bettingConsentGranted}
          onChange={(first9) => setBets((current) => ({ ...current, polla: { ...current.polla, first9: { ...current.polla.first9, ...first9 } } }))}
        />

        <PollaBetEditor
          title={groupNassauLabels.component("second9")}
          icon={BET_PRESENTATION.polla_second.icon}
          trophy="silver"
          description={roundHoles === 18 ? `Mejor medal neto en la segunda vuelta jugada · H${order[9]}–H${order.at(-1)}` : "Disponible en rondas de 18 hoyos"}
          config={bets.polla.second9}
          players={players}
          unavailable={roundHoles === 9}
          requestActivation={requestBettingConsent}
          locked={!bettingConsentGranted}
          onChange={(second9) => setBets((current) => ({ ...current, polla: { ...current.polla, second9: { ...current.polla.second9, ...second9 } } }))}
        />

        <PollaBetEditor
          title={groupNassauLabels.component("total18")}
          icon={BET_PRESENTATION.polla_total.icon}
          description="Mejor medal neto de la ronda completa"
          config={bets.polla.total18}
          players={players}
          unavailable={roundHoles === 9}
          requestActivation={requestBettingConsent}
          locked={!bettingConsentGranted}
          onChange={(total18) => setBets((current) => ({ ...current, polla: { ...current.polla, total18: { ...current.polla.total18, ...total18 } } }))}
        />

        <SetupBetCard id="mini-polla" icon="⚡" title="Mini Polla" description="Medal neto de los últimos 3 hoyos realmente jugados" help="mini_polla" enabled={bets.miniPolla.enabled} locked={!bettingConsentGranted} requestActivation={requestBettingConsent} onEnabledChange={(enabled) => setBets((current) => ({ ...current, miniPolla: { ...current.miniPolla, enabled } }))}>
          <>
            <div className="grid3"><MoneyInput label="Valor" value={bets.miniPolla.value} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, value: v } })} /><HcpPercentInput value={bets.miniPolla.hcpPct} onChange={(v) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, hcpPct: v } })} /><DecimalModeSelect value={bets.miniPolla.decimals} onChange={(decimals) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, decimals } })} /></div>
            <label className="miniLabel">Participan</label><ParticipantChips players={players} selected={bets.miniPolla.participantIds} onChange={(ids) => setBets({ ...bets, miniPolla: { ...bets.miniPolla, participantIds: ids } })} />
            <div className="hint">Siempre toma los últimos 3 hoyos realmente jugados: {order.slice(-3).join(", ")}.</div>
          </>
        </SetupBetCard>

        <CounterBetConfigPanel kind="vipers" config={bets.vipers} players={players} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} onChange={vipers => setBets((current) => ({ ...current, vipers: { ...current.vipers, ...vipers } }))} />
        <CounterBetConfigPanel kind="camels" config={bets.camels} players={players} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} onChange={camels => setBets((current) => ({ ...current, camels: { ...current.camels, ...camels } }))} />
        <CounterBetConfigPanel kind="fish" config={bets.fish} players={players} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} onChange={fish => setBets((current) => ({ ...current, fish: { ...current.fish, ...fish } }))} />
        <LobaConfigPanel config={bets.loba} players={players} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} onChange={lobaConfig => setBets((current) => ({ ...current, loba: { ...current.loba, ...lobaConfig } }))} />
        <SupplementalBetsEditor bets={supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} roundHoles={roundHoles} />
        </div>
      </section>

      <ResultAccordion
        id="setup-manuals"
        title={<SetupModeTitle icon={BET_PRESENTATION.manuals.icon} title={BET_PRESENTATION.manuals.title} description="Importes directos por jugador · la suma debe cerrar en $0" />}
        open={manualSetupOpen}
        disclosureDisabled={!manualBets.some((bet) => bet.enabled !== false) || !bettingConsentGranted}
        onOpenChange={(open) => { if (manualBets.some((bet) => bet.enabled !== false) && bettingConsentGranted) setManualSetupOpen(open); }}
        className="setupBetsAccordion"
        headerAction={<span className="resultHeaderActions"><BetHelpButton kind="manual" /><Toggle on={manualBets.some((bet) => bet.enabled !== false)} disabled={!bettingConsentGranted} label={`${manualBets.some((bet) => bet.enabled !== false) ? "Desactivar" : "Activar"} Apuestas Manuales`} onClick={() => {
          const enabled = manualBets.some((bet) => bet.enabled !== false);
          if (enabled) setManualModeEnabled(false); else runAfterBettingConsent(() => setManualModeEnabled(true));
        }} /></span>}
      >{manualBets.some((bet) => bet.enabled !== false) && <><div className="setupModeTools"><button type="button" className="textButton" onClick={() => runAfterBettingConsent(newManualBet)}>+ Apuesta</button></div>{renderManualBetsEditor(true)}</>}</ResultAccordion>

      <ResultAccordion id="setup-personals" title={<SetupModeTitle icon={BET_PRESENTATION.personals.icon} title={BET_PRESENTATION.personals.title} description="Nassau, Dollar a Stroke y Presiones individuales" />} open={personalSetupOpen} onOpenChange={setPersonalSetupOpen} className="setupBetsAccordion personalSetupGroup" headerAction={<span className="resultHeaderActions"><BetHelpButton kind="personal_group" /></span>}>
        <ResultAccordion
          id="setup-personal-nassau"
          title={<SetupModeTitle icon={SUPPLEMENTAL_BET_PRESENTATION.individual_nassau.icon} title={SUPPLEMENTAL_BET_PRESENTATION.individual_nassau.title} description={SUPPLEMENTAL_BET_PRESENTATION.individual_nassau.description} />}
          open={nassauSetupOpen}
          disclosureDisabled={!personalBets.some((bet) => bet.enabled !== false) || !bettingConsentGranted}
          onOpenChange={(open) => { if (personalBets.some((bet) => bet.enabled !== false) && bettingConsentGranted) setNassauSetupOpen(open); }}
          className="setupBetsAccordion nestedSetupAccordion"
          headerAction={<span className="resultHeaderActions"><BetHelpButton kind="personal" /><Toggle on={personalBets.some((bet) => bet.enabled !== false)} disabled={!bettingConsentGranted} label={`${personalBets.some((bet) => bet.enabled !== false) ? "Desactivar" : "Activar"} Nassau Individual`} onClick={() => {
            const enabled = personalBets.some((bet) => bet.enabled !== false);
            if (enabled) setPersonalModeEnabled(false); else runAfterBettingConsent(() => { setPersonalModeEnabled(true); setNassauSetupOpen(true); });
          }} /></span>}
        >{personalBets.some((bet) => bet.enabled !== false) && <><div className="setupModeTools"><button type="button" className="textButton" onClick={() => runAfterBettingConsent(() => { newPersonalBet(); setNassauSetupOpen(true); })}>+ Nassau Individual</button></div>{supplementalBets.some((bet) => bet.type === "individual_nassau") && <div className="notice">Se conserva sin reinterpretar una Nassau heredada entre jugadores distintos del principal. Sigue calculándose con su ID, pareja, ventaja y monto originales; no se convirtió automáticamente.</div>}{renderPersonalBetsEditor()}</>}</ResultAccordion>
        {supplementalBets.some((bet) => bet.type === "individual_nassau") && <SupplementalBetsEditor bets={supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} types={["individual_nassau"]} roundHoles={roundHoles} allowAdd={false} />}
        <SupplementalBetsEditor bets={supplementalBets} players={players} onChange={setSupplementalBets} requestActivation={requestBettingConsent} locked={!bettingConsentGranted} types={["dollar_stroke", "individual_pressures"]} roundHoles={roundHoles} />
      </ResultAccordion>

      {showBetSetupErrors && betConfigurationIssues.length > 0 && <div id="round-bet-validation" className="notice bad" role="alert">
        <b>Revisa las apuestas activas antes de iniciar.</b>
        <ul>{betConfigurationIssues.map((issue) => <li key={`${issue.code}:${issue.sectionId}`}>{issue.message}</li>)}</ul>
      </div>}

      <button className="primary big" disabled={!players.length || players.some((player) => !player.name.trim())} onClick={() => {
        if (!courseSelected) {
          setCourseSelectionError(true);
          document.getElementById("round-course")?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (betConfigurationIssues.length) {
          setShowBetSetupErrors(true);
          requestAnimationFrame(() => document.getElementById("round-bet-validation")?.scrollIntoView({ behavior: "smooth", block: "center" }));
          return;
        }
        setShowBetSetupErrors(false);
        const start = () => { ensureRoundStarted(); setBets(current => freezeRoundHandicapBases(current, players, roundHandicapBasis)); if (!editingRound) setCurrentIndex(0); setEditingRound(false); setTab("round"); };
        if (hasActiveBettingConfiguration()) runAfterBettingConsent(start); else start();
      }}>{editingRound ? "Guardar configuración y continuar →" : "Iniciar ronda →"}</button>
    </>}

    {tab === "personals" && <>
      <section className="hero">
        <div><div className="eyebrow">HISTÓRICO PERSONAL</div><h1>Personales</h1><p>Consulta tus rondas, ganadas, perdidas y balance contra un contrincante.</p></div>
      </section>

      <PersonalHistoryPanel history={history} today={todayMx} onDelete={setPersonalHistoryToDelete} />
    </>}

    {tab === "round" && <>
      <RoundCaptureV2
        course={course}
        hole={hole}
        order={order}
        currentIndex={currentIndex}
        completedHoles={completedHoles}
        players={players}
        playerTeeAssignments={playerTeeAssignments}
        ownerId={ownerId}
        ownerAvatarUrl={identity.avatarUrl}
        ownerClubChoices={ownerClubChoices}
        mode={scoreCaptureMode}
        bets={bets}
        supplementalBets={supplementalBets}
        scores={Object.fromEntries(players.map((player) => [player.id, scoreFor(player.id)]))}
        putts={putts[holeNumber] || {}}
        advancedStats={advancedStats[holeNumber] || {}}
        counterQuantities={{
          vipers: Object.fromEntries(players.map((player) => [player.id, counterQuantity(counterBetEvents, "vipers", holeNumber, player.id)])),
          camels: Object.fromEntries(players.map((player) => [player.id, counterCaptureQuantity(counterBetEvents, "camels", holeNumber, player.id)])),
          fish: Object.fromEntries(players.map((player) => [player.id, counterCaptureQuantity(counterBetEvents, "fish", holeNumber, player.id)])),
        }}
        unitQuantities={Object.fromEntries(players.map((player) => [player.id, unitHoleManual(player.id)]))}
        groupNassauLabel={bets.polla.first9.enabled || bets.polla.second9.enabled || bets.polla.total18.enabled ? groupNassauLabels.summary : undefined}
        ballFriendLabel={ballFriendSetupChipLabel(bfSetup, players, bets.ballFriend.participantIds)}
        lobaLabel={lobaSetupChipLabel(lobaHoles[holeNumber], players)}
        playerIndicators={(playerId) => playerHoleBetLabels(playerId, bets.loba.enabled ? lobaHoles[holeNumber] : undefined, bets.ballFriend.enabled ? bfSetup : undefined, bets.ballFriend.participantIds)}
        onNavigateHole={goToHoleIndex}
        onModeChange={setScoreCaptureMode}
        onScoreChange={setScore}
        onPuttsChange={setPutt}
        onCounterChange={confirmCounterBetCapture}
        onUnitDelta={(playerId, delta) => addUnit(playerId, delta, delta > 0 ? "Captura rápida positiva" : "Captura rápida negativa")}
        onAdvancedChange={setAdvancedStat}
        onOpenLoba={() => setHoleBetEditor("loba")}
        onOpenBallFriend={() => setHoleBetEditor("ballFriend")}
        onOpenScanner={openScorecardScanner}
        onToggleFullCard={() => setShowFullScorecard((visible) => !visible)}
        fullCardVisible={showFullScorecard}
        onOpenStandings={() => setTab("standings")}
        onUndo={undoLastAction}
        undoDisabled={undoCount === 0}
      />
      {showFullScorecard && <FullScorecard course={course} players={players} scores={scores} order={order} scale={scorecardScale} onScale={setScorecardScale} />}

      {scoreCaptureComplete && <div className="liveBadges">
          {currentRabbitEvents.map((e, i) => <span className="badge" key={`${e.type}-${i}`}>🐇 {e.type === "grab" ? "Agarra" : e.type === "hold" ? "Mantiene" : e.type === "win" ? `Gana ×${e.count}` : e.type === "lose" ? "Pierde / libre" : e.type === "accumulate" ? `Acumula → ${e.count}` : "Libre"} {e.playerId ? playerName(e.playerId) : ""}</span>)}
          {rabbitMode === "three_hole_blocks" && currentRabbitEvents.length === 0 && currentRabbitBlockWinner?.playerId && <span className="badge">🐇 Conejo {currentRabbitNumber} ya ganado por {playerName(currentRabbitBlockWinner.playerId)}</span>}
          {skinHoleNotice(currentSkin, bets.skins.value, currentIndex === order.length - 1, playerName, skinsMode).map((line, index) => <span className={`badge ${!currentSkin?.winnerId ? "skinCarryBadge" : ""}`} key={`${line}-${index}`}>{line}</span>)}
      </div>}
      {completedHoles.has(holeNumber) && savedBfDetail && <div className="ballFriendScoreResult" role="status">{ballFriendScoreResult(savedBfDetail, bets.ballFriend.value)}</div>}

      {(bets.rabbits.enabled || bets.skins.enabled) && <section className="card compact priorBetStatus" aria-label="Estado antes de este hoyo">
        <div className="sectionTitle"><div><h2>Antes del hoyo {holeNumber}</h2><p>Solo considera hoyos anteriores ya guardados.</p></div></div>
        <div className="priorBetGrid">
          {bets.rabbits.enabled && <article><span aria-hidden="true">🐇</span><div><b>Conejo</b>{priorRabbitStatus(priorRabbits.events, priorRabbits.pending, bets.rabbits.value, playerName, rabbitMode, holeNumber).map((line) => <small key={line}>{line}</small>)}</div></article>}
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
        <CounterBetHolePanel resolutionOnly kind="vipers" config={bets.vipers} players={players} events={counterBetEvents} hole={holeNumber} order={order} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("vipers", playerId, value)} onDistance={(eventHole, playerId, value) => changeCounterBetDistance("vipers", eventHole, playerId, value)} onKeeper={(playerId, period) => setCounterBetKeeper("vipers", playerId, period)} />
        <CounterBetHolePanel resolutionOnly kind="camels" config={bets.camels} players={players} events={counterBetEvents} hole={holeNumber} order={order} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("camels", playerId, value)} onDistance={(eventHole, playerId, value) => changeCounterBetDistance("camels", eventHole, playerId, value)} onKeeper={(playerId, period) => setCounterBetKeeper("camels", playerId, period)} />
        <CounterBetHolePanel resolutionOnly kind="fish" config={bets.fish} players={players} events={counterBetEvents} hole={holeNumber} order={order} keepers={counterBetKeepers} onQuantity={(playerId, value) => changeCounterBet("fish", playerId, value)} onDistance={(eventHole, playerId, value) => changeCounterBetDistance("fish", eventHole, playerId, value)} onKeeper={(playerId, period) => setCounterBetKeeper("fish", playerId, period)} />
      </>}

      {scoreCaptureComplete && bets.foursome.enabled && <section className="card compact">
        <h3>🤝 Foursome actual</h3>
        {(() => {
          const seg = segments.find((s) => currentIndex >= s.startIndex && currentIndex <= s.endIndex);
          if (!seg || seg.basePair.length !== 2) return <div className="empty">Falta elegir pareja base de este tramo.</div>;
          const liveMatches = liveFoursomes.matches.filter((m) => m.segmentId === seg.id);
          if (!liveMatches.length) return <div className="empty">Configura las parejas de este tramo.</div>;
          return <FoursomeLive matches={liveMatches} hole={holeNumber} name={playerName} />;
        })()}
      </section>}

      {scoreCaptureComplete && livePersonalOpponentResults.length > 0 && <section className="card compact personalLiveCompact"><div className="sectionTitle"><div><h2>↔ Personales · en vivo</h2><p>Separadas del Resumen General.</p></div></div><PersonalOpponentResults entries={livePersonalOpponentResults} compact /></section>}
      {scoreCaptureComplete && liveSupplementalGeneralResults.length > 0 && <section className="card compact"><div className="sectionTitle"><div><h2>Otras apuestas · en vivo</h2><p>Acumulado hasta H{holeNumber} con scores confirmados.</p></div></div><SupplementalBetResults results={liveSupplementalGeneralResults} players={players} throughHole={holeNumber} /></section>}
      {scoreCaptureComplete && renderMonkeyLive()}

      {currentIndex === order.length - 1 && <section className="card compact finishWithCardAi">
        <div><span className="eyebrow">CAMINO ALTERNATIVO</span><h2>¿Jugaste con tarjeta física?</h2><p>Fotografía la tarjeta y Backyard confirmará únicamente las celdas dudosas antes de ejecutar el motor.</p></div>
        <button type="button" className="primary big" onClick={openScorecardScanner}>📸 ESCANEAR TARJETA PARA FINALIZAR</button>
      </section>}
      <div className="roundActions"><button className="secondary big" disabled={currentIndex === 0 || holeSummary.length > 0} onClick={() => goToHoleIndex(currentIndex - 1)}>← Anterior</button><button className="primary big" disabled={holeSummary.length > 0} onPointerDown={commitFocusedNumericCapture} onClick={requestSaveAndAdvance}>{currentIndex < order.length - 1 ? "Guardar y siguiente hoyo →" : "Terminar ronda"}</button></div>
      {holeSummary.length > 0 && <div className="holeSummaryBackdrop" onClick={(event) => event.stopPropagation()}><div className={`holeSummary ${holeSummaryPaused ? "paused" : ""}`} role="dialog" aria-modal="true" aria-label={`Resumen del hoyo ${holeNumber}`} onPointerDown={(event) => { holeSummaryPointerStart.current = { x: event.clientX, y: event.clientY }; }} onClick={handleHoleSummaryTap}><button type="button" className="holeSummaryClose" aria-label="Cerrar resumen y avanzar" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); holeSummaryPointerStart.current = null; holeSummarySession.current?.finish(); }}>×</button><div className="holeSummaryContent" role="status" aria-live="polite"><h2>{holeSummary[0]} ✓</h2><p className="holeSummaryScores">{holeSummary.slice(1, players.length + 1).map((line, index) => <span key={index}>{line}</span>)}</p><div className="holeSummaryBets">{holeSummary.slice(players.length + 1).map((line, index) => <p key={index}>{line}</p>)}</div><small className="holeSummaryHoldHint">{holeSummaryPaused ? "Pausado · toca una zona libre para reanudar" : "Toca una zona libre para pausar"}</small></div><div className="holeSummaryTimer" aria-hidden="true" /></div></div>}
    </>}

    {tab === "standings" && <>
      {renderMonkeyLive()}
      <section className="hero standingsHero"><div><div className="eyebrow">CÓMO VAMOS</div><h1>Balance provisional.</h1><p>Combina lo ya cobrado con el valor provisional de Foursome y Personales; el resultado pendiente de {groupNassauLabels.name} no se liquida antes de tiempo.</p></div><button className="secondary" onClick={openActiveRound}>Volver al hoyo</button></section>
      <section className="provisionalGrid">{[...players].sort((a, b) => (liveBetBalances[b.id] || 0) - (liveBetBalances[a.id] || 0)).map((player, index) => <div className="stat" key={player.id}><span>{index + 1} · {player.name || "Sin nombre"}</span><b className={(liveBetBalances[player.id] || 0) > 0 ? "good" : (liveBetBalances[player.id] || 0) < 0 ? "bad" : ""}>{signedMoney(liveBetBalances[player.id] || 0)}</b><small>provisional</small></div>)}</section>
      <section className="card highlights"><h2>Highlights</h2>{(() => { const leader = [...players].sort((a, b) => (liveBetBalances[b.id] || 0) - (liveBetBalances[a.id] || 0))[0]; const rabbitLeader = [...players].sort((a, b) => (rabbits.won[b.id] || 0) - (rabbits.won[a.id] || 0))[0]; const skinLeader = [...players].sort((a, b) => (skins.won[b.id] || 0) - (skins.won[a.id] || 0))[0]; return <div className="highlightList">{leader && (liveBetBalances[leader.id] || 0) > 0 && <span>🔥 {leader.name} lidera {signedMoney(liveBetBalances[leader.id])}</span>}{rabbitLeader && (rabbits.won[rabbitLeader.id] || 0) > 0 && <span>🐇 {rabbitLeader.name} lleva {rabbits.won[rabbitLeader.id]} Conejos</span>}{skinLeader && (skins.won[skinLeader.id] || 0) > 0 && <span>⛳ {skinLeader.name} lleva {skins.won[skinLeader.id]} Skins</span>}{!leader && <span>Aún sin datos.</span>}</div>; })()}</section>
<section className="card"><h2>Desglose por apuesta</h2><div className="tableWrap"><table><thead><tr><th>Jugador</th><th>🐇</th><th>⛳</th><th>📏</th><th>🤝 Foursome</th><th>⚪🤝 Bola Amiga</th><th>🏆 {groupNassauLabels.name}{bets.miniPolla.enabled ? " / Mini Polla" : ""}</th>{liveSupplementalGeneralResults.map((result) => <th key={result.betId}>{supplementalBetDisplayLabel(result.type, result.label)}</th>)}<th>↔ Personales</th><th>✍️ Manuales</th>{bets.monkey?.enabled && <th>🐒 Monkey</th>}{bets.vipers.enabled && <th>🐍</th>}{bets.camels.enabled && <th>🐫</th>}{bets.fish.enabled && <th>🐟</th>}{bets.loba.enabled && <th>🐺</th>}</tr></thead><tbody>{players.map((player) => <tr key={player.id}><td><b>{player.name}</b></td><td>{signedMoney(rabbitBalances[player.id] || 0)}</td><td>{signedMoney(skinBalances[player.id] || 0)}</td><td>{signedMoney(units.balances[player.id] || 0)}</td><td>{signedMoney(foursomes.provisionalBalances[player.id] || 0)}</td><td>{signedMoney(ballFriend.balances[player.id] || 0)}</td><td>{signedMoney((polla.balances[player.id] || 0) + (miniPolla.balances[player.id] || 0))}</td>{liveSupplementalGeneralResults.map((result) => <td key={result.betId}>{signedMoney(result.balances[player.id] || 0)}</td>)}<td>{signedMoney(ownerId === player.id ? livePersonalOpponentResults.reduce((sum, entry) => sum + entry.amount, 0) : livePersonalOpponentResults.filter((entry) => entry.opponentId === player.id).reduce((sum, entry) => sum - entry.amount, 0))}</td><td>{signedMoney(manual.balances[player.id] || 0)}</td>{bets.monkey?.enabled && <td>{signedMoney(monkey.balances[player.id] || 0)}</td>}{bets.vipers.enabled && <td>{signedMoney(vipers.balances[player.id] || 0)}</td>}{bets.camels.enabled && <td>{signedMoney(camels.balances[player.id] || 0)}</td>}{bets.fish.enabled && <td>{signedMoney(fish.balances[player.id] || 0)}</td>}{bets.loba.enabled && <td>{signedMoney(loba.balances[player.id] || 0)}</td>}</tr>)}</tbody></table></div></section>
      <section className="card"><GolfLeaderboard rows={privateBoard} mode={privateBoardMode} onModeChange={setPrivateBoardMode} context="live" /></section>
    </>}

    {tab === "results" && <>
      {roundReviewPending || roundClosed
        ? <RoundFinalResult players={finalResultPlayers} balances={allBetBalances} transfers={settlementTransfers} recap={finalRoundRecap} />
        : <section className="hero resultHero"><div><div className="eyebrow">EN JUEGO</div><h1>RESULTADOS PROVISIONALES</h1><p>La ronda sigue abierta. Estos datos pueden cambiar hasta confirmar todos los hoyos.</p></div></section>}

      <nav className="resultJumpNav" aria-label="Ir a un resultado">
        {resultNavigationItems.map((item) => <button type="button" key={item.id} aria-pressed={Boolean(openResultSections[item.id])} onClick={() => openResultSection(item.id)}>{item.label}</button>)}
      </nav>

      <ResultAccordion id="golf-result" title="Resultado de golf" className="golfResult" {...resultAccordionProps("golf-result")}>
        <GolfLeaderboard rows={privateBoard} mode={privateBoardMode} onModeChange={setPrivateBoardMode} context="results" />
      </ResultAccordion>

      <ResultAccordion id="bet-values" title="Valores de apuesta" className="betValues" {...resultAccordionProps("bet-values")}><div className="valueGrid">
        {bets.rabbits.enabled && <span><b>🐇 Conejos</b>{money(bets.rabbits.value)} c/u</span>}
        {bets.skins.enabled && <span><b>⛳ Skins</b>{money(bets.skins.value)} c/u</span>}
        {bets.units.enabled && <span><b>📏 Unidades / Copas</b>{money(bets.units.value)} por unidad · {money(bets.units.copaValue ?? bets.units.value)} por Copa</span>}
        {bets.foursome.enabled && <span><b>🤝 Foursome</b>{(bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.fixedValue)} fijo` : ""}{bets.foursome.mode === "fixed_points" ? " · " : ""}{(bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") ? `${money(bets.foursome.pointValue)} punto` : ""}{roundHoles === 18 && (bets.foursome.pressureMultiplier || 1) > 1 ? ` · 2ª vuelta H${order[9]}–H${order.at(-1)} ${bets.foursome.pressureMultiplier}x` : ""}</span>}
        {bets.ballFriend.enabled && <span><b>⚪🤝 Bola Amiga</b>{money(bets.ballFriend.value)} por punto</span>}
        {bets.monkey?.enabled && <span><b>🐒 Monkey</b>{money(bets.monkey.value)} por punto · HCP {bets.monkey.hcpPct ?? 100}%</span>}
        {polla.details.map((detail) => <span key={detail.key}><b>{detail.key === "total18" ? "🏆" : "🥈"} {groupNassauLabels.resultComponent(detail.key)}</b>{money(detail.value)}</span>)}
        {bets.miniPolla.enabled && <span><b>⚡ Mini Polla</b>{money(bets.miniPolla.value)}</span>}
        {bets.vipers.enabled && <span><b>🐍 Víboras</b>{money(bets.vipers.value)} por evento · dos bolsas · {roundHoles === 18 && counterBetSecondNinePressed(bets.vipers) ? `2ª vuelta H${order[9]}–H${order.at(-1)} presionada ${counterBetSecondNineMultiplier(bets.vipers)}x` : "sin presión"}</span>}
        {bets.camels.enabled && <span><b>🐫 Camellos</b>{money(bets.camels.value)} por evento · dos bolsas · {roundHoles === 18 && counterBetSecondNinePressed(bets.camels) ? `2ª vuelta H${order[9]}–H${order.at(-1)} presionada ${counterBetSecondNineMultiplier(bets.camels)}x` : "sin presión"}</span>}
        {bets.fish.enabled && <span><b>🐟 Peces</b>{money(bets.fish.value)} por evento · dos bolsas · {roundHoles === 18 && counterBetSecondNinePressed(bets.fish) ? `2ª vuelta H${order[9]}–H${order.at(-1)} presionada ${counterBetSecondNineMultiplier(bets.fish)}x` : "sin presión"}</span>}
        {bets.loba.enabled && <span><b>🐺 Loba</b>{money(bets.loba.value)} base · HCP {bets.loba.hcpPct ?? 100}%{bets.loba.unitsEnabled ? ` · 📏 ${money(bets.loba.unitValue)}` : ""}</span>}
        {supplementalBets.filter((bet) => bet.enabled !== false).map((bet) => <span key={bet.id}><b>{supplementalBetDisplayLabel(bet.type)}</b>{money(supplementalBetValue(bet))}</span>)}
        {personalBets.filter((bet) => bet.enabled !== false).map((bet) => <span key={bet.id}><b>🏌️ Nassau Individual · {owner?.name} vs {bet.rivalMode === "group" ? playerName(bet.rivalPlayerId) : bet.rivalName}</b>{money(bet.baseValue)} base{roundHoles === 18 && (bet.pressureMultiplier || 1) > 1 ? ` · 2ª jugada ${bet.pressureMultiplier}x` : ""} · Carry {bet.carryEnabled ? "Sí" : "No"}</span>)}
      </div></ResultAccordion>

      <ResultAccordion id="general-summary" title={resultsView === "general" ? "Resumen General" : "Resumen por jugador"} className="playerSummary" {...resultAccordionProps("general-summary")}>
        <div className="resultsViewHeader"><div className="segmented" aria-label="Vista de resultados"><button className={resultsView === "players" ? "active" : ""} aria-pressed={resultsView === "players"} onClick={() => setResultsView("players")}>Jugadores</button><button className={resultsView === "general" ? "active" : ""} aria-pressed={resultsView === "general"} onClick={() => setResultsView("general")}>Resumen General</button></div></div>
        {resultsView === "players" ? <><div className="row between resultsPlayerTools"><h3>Resumen por jugador</h3><button className="secondary" onClick={copyResultsSummary}>Copiar para WhatsApp</button></div><div className="playerResultGrid">{players.map((p) => <details className="playerResultCard" key={p.id}>
          <summary><b>{p.name}</b><span className="playerIndicators">{bets.rabbits.enabled ? `🐇 ${rabbits.won[p.id] ?? 0}` : ""}{bets.skins.enabled ? ` · ⛳ ${skins.won[p.id] ?? 0}` : ""}{bets.units.enabled ? ` · 📏 ${(units.net[p.id] ?? 0) > 0 ? "+" : ""}${units.net[p.id] ?? 0}` : ""}</span><strong className={(allBetBalances[p.id] ?? 0) > 0 ? "good" : (allBetBalances[p.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(allBetBalances[p.id] ?? 0)}</strong></summary>
          <div className="playerBetBlocks">
            {bets.rabbits.enabled && <div><span>🐇 Conejos · Jugados</span><b>{rabbits.won[p.id] ?? 0}</b><i>{signedMoney(rabbitBalances[p.id] ?? 0)}</i></div>}
            {bets.skins.enabled && <div><span>⛳ Skins · Jugados</span><b>{skins.won[p.id] ?? 0}</b><i>{signedMoney(skinBalances[p.id] ?? 0)}</i></div>}
            {bets.units.enabled && <div><span>📏 Unidades · Netas</span><b>{(unitQuantitySummary.quantities[p.id] ?? 0) > 0 ? "+" : ""}{unitQuantitySummary.quantities[p.id] ?? 0}</b><i>{signedMoney(units.balances[p.id] ?? 0)}</i></div>}
            {bets.foursome.enabled && <div><span>🤝 Foursome</span><i>{signedMoney(foursomes.balances[p.id] ?? 0)}</i></div>}
            {bets.ballFriend.enabled && <div><span>⚪🤝 Bola Amiga</span><i>{signedMoney(ballFriend.balances[p.id] ?? 0)}</i></div>}
            {polla.details.filter((detail) => Object.hasOwn(detail.totals, p.id)).map((detail) => <div key={detail.key}><span>{detail.key === "total18" ? "🏆" : "🥈"} {groupNassauLabels.resultComponent(detail.key)}</span><b>1</b><i>{signedMoney(pollaDetailBalance(detail, p.id))}</i></div>)}
            {miniPolla.details.filter((detail) => Object.hasOwn(detail.totals, p.id)).map((detail) => <div key={detail.key}><span>⚡ Mini Polla</span><b>1</b><i>{signedMoney(pollaDetailBalance(detail, p.id))}</i></div>)}
            {supplemental.results.map((result) => <div key={result.betId}><span>{supplementalBetDisplayLabel(result.type, result.label)}</span><i>{signedMoney(result.balances[p.id] ?? 0)}</i></div>)}
            {personalBets.some((bet) => bet.enabled !== false) && <div><span>↔ Personales</span><i>{signedMoney(personals.balances[p.id] ?? 0)}</i></div>}
            {manualBets.some((bet) => bet.enabled !== false) && <div><span>✍️ Manuales</span><i>{signedMoney(manual.balances[p.id] ?? 0)}</i></div>}
            {bets.monkey?.enabled && <div><span>🐒 Monkey</span><b>{monkey.points[p.id] ?? 0}</b><i>{signedMoney(monkey.balances[p.id] ?? 0)}</i></div>}
            {bets.vipers.enabled && <div><span>🐍 Víboras</span><b>{vipers.totalQuantity}</b><i>{signedMoney(vipers.balances[p.id] ?? 0)}</i></div>}
            {bets.camels.enabled && <div><span>🐫 Camellos</span><b>{camels.totalQuantity}</b><i>{signedMoney(camels.balances[p.id] ?? 0)}</i></div>}
            {bets.fish.enabled && <div><span>🐟 Peces</span><b>{fish.totalQuantity}</b><i>{signedMoney(fish.balances[p.id] ?? 0)}</i></div>}
            {bets.loba.enabled && <div><span>🐺 Loba</span><b>{loba.details.length}</b><i>{signedMoney(loba.balances[p.id] ?? 0)}</i></div>}
          </div>
        </details>)}</div></> : <div className="generalResultsWrap"><p className="muted">Todas las apuestas activas y ya jugadas. Desliza horizontalmente para revisar cada categoría.</p>{generalResults.categories.length ? <div className="generalResultsScroll" tabIndex={0} aria-label="Resumen general de resultados por apuesta"><table className="generalResultsTable"><thead><tr><th>Jugador</th>{generalResults.categories.map(category => <th key={category.key}>{category.label}{category.quantityTotal !== undefined ? ` · ${category.quantityTotal}` : ""}</th>)}<th>TOTAL</th></tr></thead><tbody>{generalResults.rows.map(row => <tr key={row.playerId}><th scope="row">{playerName(row.playerId)}</th>{generalResults.categories.map(category => { const amount = row.cells[category.key] || 0; const quantity = category.quantities?.[row.playerId]; const quantityText = quantity === undefined ? "" : `${category.signedQuantity && quantity > 0 ? "+" : ""}${quantity} ${category.quantityLabel || ""}`.trim(); return <td key={category.key}><div className="generalResultCell">{category.detailByPlayer?.[row.playerId] && <span>{category.detailByPlayer[row.playerId]}</span>}{quantityText && <span>{quantityText}</span>}<strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div></td>; })}<td className={!row.consistent ? "bad" : row.total > 0 ? "good" : row.total < 0 ? "bad" : ""}>{signedMoney(row.total)}</td></tr>)}<tr className="generalResultsTotal"><th scope="row">TOTAL GENERAL</th>{generalResults.categories.map(category => <td key={category.key} className={Math.abs(generalResults.categoryTotals[category.key] || 0) < 0.001 ? "good" : "bad"}>{signedMoney(generalResults.categoryTotals[category.key] || 0)}</td>)}<td className={Math.abs(generalResults.grandTotal) < 0.001 ? "good" : "bad"}>{signedMoney(generalResults.grandTotal)}</td></tr></tbody></table></div> : <div className="empty">Todavía no hay apuestas activas con hoyos jugados.</div>}</div>}
      </ResultAccordion>

      {bets.rabbits.enabled && <ResultAccordion id="rabbits" title={`${betDisplayLabel("rabbits")} · ${totalRabbitsWon}`} {...resultAccordionProps("rabbits")}><div className="resultBalanceList">{playersByIds(players, bets.rabbits.participantIds).map(player => <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{rabbits.won[player.id] ?? 0} conejos</small></span><strong className={(rabbitBalances[player.id] ?? 0) > 0 ? "good" : (rabbitBalances[player.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(rabbitBalances[player.id] ?? 0)}</strong></div>)}</div>{rabbitMode === "three_hole_blocks" && <div className="rabbitBlockResults">{[...new Set(order.map((currentHole) => Math.floor((currentHole - 1) / 3) + 1))].map((rabbitNumber) => { const start = (rabbitNumber - 1) * 3 + 1; const end = start + 2; const winner = rabbits.events.find((event) => event.rabbitNumber === rabbitNumber && event.type === "win"); const complete = completedHoles.has(end); return <div className="matchLine" key={rabbitNumber}><span><b>Conejo {rabbitNumber}</b>H{start}–H{end}</span><strong>{winner?.playerId ? playerName(winner.playerId) : complete ? "Sin ganador" : "Pendiente"}</strong></div>; })}</div>}</ResultAccordion>}
      {bets.skins.enabled && <ResultAccordion id="skins" title={`${betDisplayLabel("skins")} · ${totalSkinsWon}`} {...resultAccordionProps("skins")}><div className="resultBalanceList">{playersByIds(players, bets.skins.participantIds).map(player => <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{skins.won[player.id] ?? 0} skins</small></span><strong className={(skinBalances[player.id] ?? 0) > 0 ? "good" : (skinBalances[player.id] ?? 0) < 0 ? "bad" : ""}>{signedMoney(skinBalances[player.id] ?? 0)}</strong></div>)}</div></ResultAccordion>}
      {bets.units.enabled && <ResultAccordion id="units" title={`${betDisplayLabel("units")} · ${unitQuantitySummary.total > 0 ? "+" : ""}${unitQuantitySummary.total}`} {...resultAccordionProps("units")}><div className="resultBalanceList">{playersByIds(players, bets.units.participantIds).map(player => { const quantity = unitQuantitySummary.quantities[player.id] ?? 0; const amount = units.balances[player.id] ?? 0; return <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{quantity > 0 ? "+" : ""}{quantity} unidades netas</small></span><strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div>; })}</div></ResultAccordion>}
      {bets.ballFriend.enabled && <ResultAccordion id="ball-friend" title={betDisplayLabel("ball_friend")} {...resultAccordionProps("ball-friend")}><div className="resultBalanceList">{playersByIds(players, bets.ballFriend.participantIds).map(player => { const amount = ballFriend.balances[player.id] ?? 0; const points = ballFriend.points[player.id] ?? 0; return <div className="transfer" key={player.id}><span><b>{player.name}</b><small>{points > 0 ? "+" : ""}{points} puntos</small></span><strong className={amount > 0 ? "good" : amount < 0 ? "bad" : ""}>{signedMoney(amount)}</strong></div>; })}</div></ResultAccordion>}

      {bets.vipers.enabled && <CounterBetResults id="vipers" title="🐍 Víboras" halves={vipers.halves} playerName={playerName} {...resultAccordionProps("vipers")} />}
      {bets.camels.enabled && <CounterBetResults id="camels" title="🐫 Camellos" halves={camels.halves} playerName={playerName} {...resultAccordionProps("camels")} />}
      {bets.fish.enabled && <CounterBetResults id="fish" title="🐟 Peces" halves={fish.halves} playerName={playerName} {...resultAccordionProps("fish")} />}
      {bets.loba.enabled && <ResultAccordion id="loba" title="🐺 Loba" className="sideBetResult" {...resultAccordionProps("loba")}>{loba.details.length ? loba.details.map(detail => <div className="lobaResultHole" key={detail.hole}><div><b>H{detail.hole} · 🔥{detail.fireMultiplier}x · HCP {detail.hcpPct}%</b><span>{detail.lobaTeam.map(playerName).join(" + ")} {detail.lobaBestNet} neto vs {detail.opponents.map(playerName).join(" + ")} {detail.opponentBestNet} neto</span><span>{detail.winner === "tie" ? "Empate" : detail.winner === "loba_team" ? "Ganó equipo 🐺" : "Ganaron contrarios"}</span></div><strong>{money(detail.effectiveValue)}</strong><small>📏 Equipos {detail.lobaUnits} vs {detail.opponentUnits} · unidad efectiva {money(detail.effectiveUnitValue)}</small><div className="lobaResultUnits">{Object.entries(detail.playerUnits).map(([id, unitDetail]) => <span key={id}>{playerName(id)} · Auto +{unitDetail.automatic} · Manual +{unitDetail.manual} · Total +{unitDetail.total}</span>)}</div><div className="sideBetBalances">{Object.entries(detail.balances).filter(([, amount]) => amount !== 0).map(([id, amount]) => <span key={id}>{playerName(id)} <b className={amount > 0 ? "good" : "bad"}>{signedMoney(amount)}</b></span>)}</div></div>) : <div className="empty">Sin hoyos completos.</div>}</ResultAccordion>}

      {bets.foursome.enabled && <ResultAccordion id="foursome" title="🤝 Foursome" {...resultAccordionProps("foursome")}>
        {foursomes.matches.map((m, i) => <div className="matchLine foursomeResultLine" key={i}><div><b>H{m.startHole}–{m.endHole}: {playerName(m.basePair[0])}/{playerName(m.basePair[1])}</b><span>vs {playerName(m.opponentPair[0])}/{playerName(m.opponentPair[1])}</span></div><div className="matchNums"><span>Resultado: {m.pointDiff > 0 ? "+" : ""}{m.pointDiff} pts{m.pressureMultiplier > 1 ? ` · 1ª H${order[0]}–H${order[8]} ${m.first9PointDiff >= 0 ? "+" : ""}${m.first9PointDiff} · 2ª H${order[9]}–H${order.at(-1)} ${m.second9PointDiff >= 0 ? "+" : ""}${m.second9PointDiff} x${m.pressureMultiplier}` : ""}</span><small>{m.complete ? "Fijo" : "Fijo provisional"}: {signedMoney(m.complete ? m.fixedMoney : m.provisionalFixedMoney)} · {m.complete ? "Puntos/patada" : "Puntos/patada provisional"}: {signedMoney(m.complete ? m.pointMoney : m.provisionalPointMoney)}</small><b className={(m.complete ? m.totalMoney : m.provisionalTotalMoney) > 0 ? "good" : (m.complete ? m.totalMoney : m.provisionalTotalMoney) < 0 ? "bad" : ""}>{m.complete ? `Resultado económico: ${signedMoney(m.totalMoney)}` : `Provisional: ${signedMoney(m.provisionalTotalMoney)}`}</b></div></div>)}
      </ResultAccordion>}

      {bets.polla.first9.enabled && <ResultAccordion id="polla-first9" title={`🥈 ${groupNassauLabels.component("first9")}`} {...resultAccordionProps("polla-first9")}>{pollaFirstDetail ? renderPollaResult(pollaFirstDetail) : <div className="empty">Pendiente de completar los hoyos configurados.</div>}</ResultAccordion>}
      {bets.polla.second9.enabled && <ResultAccordion id="polla-second9" title={`🥈 ${groupNassauLabels.component("second9")}`} {...resultAccordionProps("polla-second9")}>{pollaSecondDetail ? renderPollaResult(pollaSecondDetail) : <div className="empty">Pendiente de completar los hoyos configurados.</div>}</ResultAccordion>}
      {bets.polla.total18.enabled && <ResultAccordion id="polla-total18" title={`🏆 ${groupNassauLabels.component("total18")}`} {...resultAccordionProps("polla-total18")}>{pollaNassauDetail ? renderPollaResult(pollaNassauDetail) : <div className="empty">Pendiente de completar la ronda.</div>}</ResultAccordion>}
      {bets.miniPolla.enabled && <ResultAccordion id="mini-polla" title={betDisplayLabel("mini_polla")} {...resultAccordionProps("mini-polla")}>
        {miniPolla.details.map((detail) => <div key={detail.key}>{renderPollaResult(detail)}</div>)}
      </ResultAccordion>}

      {bets.monkey?.enabled && <ResultAccordion id="monkey" title={betDisplayLabel("monkey")} {...resultAccordionProps("monkey")}>{renderMonkeyLive()}</ResultAccordion>}

      {supplementalGeneralResults.map((result) => <ResultAccordion key={result.betId} id={`supplemental-${result.betId}`} title={supplementalBetDisplayLabel(result.type, result.label)} {...resultAccordionProps(`supplemental-${result.betId}`)}><SupplementalBetResults results={[result]} players={players} /></ResultAccordion>)}

      {manualBets.some((bet) => bet.enabled !== false) && <ResultAccordion id="manuals" title={betDisplayLabel("manuals")} {...resultAccordionProps("manuals")}>{renderManualBetResults()}</ResultAccordion>}

      {personalModesActive && <ResultAccordion id="personals" title={betDisplayLabel("personals")} {...resultAccordionProps("personals")}><p className="muted">Balances contra cada contrincante. Estas tres modalidades no forman parte del Resumen General.</p><PersonalOpponentResults entries={personalOpponentResults} /></ResultAccordion>}

      <ResultAccordion id="expenses" title="Gastos" {...resultAccordionProps("expenses")}>
        <div className="grid2">
          <MoneyInput label="Caddie" value={expenses.caddie} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, caddie: v }))} />
          <MoneyInput label="Alimentos" value={expenses.food} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, food: v }))} />
          <MoneyInput label="Bebidas" value={expenses.drinks} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, drinks: v }))} />
          <MoneyInput label="Greenfee" value={expenses.greenFee} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, greenFee: v }))} />
          <MoneyInput label="Renta carrito" value={expenses.cartRental} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, cartRental: v }))} />
          <MoneyInput label="Otros" value={expenses.other} onChange={(v) => runAfterBettingConsent(() => setExpenses({ ...expenses, other: v }))} />
        </div>
        <div className="totalStrip"><span>Total gastos</span><b>{money(ownerExpenseTotal)}</b></div>
      </ResultAccordion>

      <section className="card summaryCard"><div><span>Apuestas</span><b className={ownerBetResult >= 0 ? "good" : "bad"}>{money(ownerBetResult)}</b></div><div><span>Gastos</span><b className="bad">{money(-ownerExpenseTotal)}</b></div><div className="grand"><span>NETO DEL DÍA</span><b className={ownerNet >= 0 ? "good" : "bad"}>{money(ownerNet)}</b></div></section>
      <div className="roundActions">{(roundReviewPending || roundClosed) && <button className="secondary big" onClick={async () => { const snapshot = currentSnapshot(); if (snapshot) await shareRound(snapshot); }}>Compartir ronda</button>}{!roundReviewPending && <button className="secondary big" onClick={requestNewRound}>Nueva ronda</button>}{roundClosed ? <button className="primary big" onClick={() => setTab("history")}>Abrir Histórico</button> : roundReviewPending ? <button className="primary big" disabled={saveStatus === "saving"} onPointerDown={commitFocusedNumericCapture} onClick={requestRoundHistorySave}>Guardar en Histórico</button> : <button className="primary big" onClick={openActiveRound}>Volver a la ronda</button>}</div>
    </>}

    {tab === "history" && <>
      <section className="hero"><div><div className="eyebrow">HISTÓRICO</div><h1>Lo que realmente cuesta jugar.</h1><p>Apuestas separadas de caddie, alimentos, bebidas y demás gastos.</p></div></section>
      <section className="statsGrid"><div className="stat"><span>Rondas</span><b>{betaGolfInsights.rounds}</b><small>{betaGolfInsights.coursesPlayed} campo{betaGolfInsights.coursesPlayed === 1 ? "" : "s"} verificado{betaGolfInsights.coursesPlayed === 1 ? "" : "s"}</small></div><div className="stat"><span>Promedio Gross</span><b>{betaGolfInsights.averageScore === undefined ? "—" : betaGolfInsights.averageScore.toFixed(1)}</b><small>{betaGolfInsights.scoredRounds ? `${betaGolfInsights.scoreSampleRounds} tarjetas completas · ${betaGolfInsights.scoreScopeHoles}H` : "sin tarjetas completas"}</small></div><div className="stat"><span>Promedio Neto</span><b>{betaGolfInsights.averageNet === undefined ? "—" : betaGolfInsights.averageNet.toFixed(1)}</b><small>{betaGolfInsights.netRounds ? `${betaGolfInsights.netRounds} con HCP de ronda` : "sin HCP verificable"}</small></div><div className="stat"><span>Mejor ronda</span><b>{betaGolfInsights.bestVsPar === undefined ? "—" : `${betaGolfInsights.bestVsPar > 0 ? "+" : ""}${betaGolfInsights.bestVsPar}`}</b><small>contra Par · {betaGolfInsights.scoreScopeHoles ? `${betaGolfInsights.scoreScopeHoles}H` : "sin muestra"}</small></div></section>
      <div className="statsGrid"><div className="stat"><span>Neto este mes</span><b className={monthGolfInsights.netResult === undefined ? "" : monthGolfInsights.netResult >= 0 ? "good" : "bad"}>{monthGolfInsights.netResult === undefined ? "—" : money(monthGolfInsights.netResult)}</b><small>{monthGolfInsights.netResultRounds ? `${monthGolfInsights.netResultRounds} resultado${monthGolfInsights.netResultRounds === 1 ? "" : "s"} conciliado${monthGolfInsights.netResultRounds === 1 ? "" : "s"}` : "sin resultado conciliado"}</small></div><div className="stat"><span>Neto este año</span><b className={yearGolfInsights.netResult === undefined ? "" : yearGolfInsights.netResult >= 0 ? "good" : "bad"}>{yearGolfInsights.netResult === undefined ? "—" : money(yearGolfInsights.netResult)}</b><small>{yearGolfInsights.netResultRounds ? `${yearGolfInsights.netResultRounds} resultado${yearGolfInsights.netResultRounds === 1 ? "" : "s"} conciliado${yearGolfInsights.netResultRounds === 1 ? "" : "s"}` : "sin resultado conciliado"}</small></div><div className="stat"><span>Apuestas año</span><b>{yearGolfInsights.betBalance === undefined ? "—" : money(yearGolfInsights.betBalance)}</b><small>{yearGolfInsights.betRounds ? `${yearGolfInsights.betRounds} resultado${yearGolfInsights.betRounds === 1 ? "" : "s"} verificado${yearGolfInsights.betRounds === 1 ? "" : "s"}` : "sin resultado verificable"}</small></div><div className="stat"><span>Gasto año</span><b className={yearGolfInsights.expenseTotal === undefined ? "" : "bad"}>{yearGolfInsights.expenseTotal === undefined ? "—" : money(-yearGolfInsights.expenseTotal)}</b><small>{yearGolfInsights.expenseRounds ? `${yearGolfInsights.expenseRounds} ronda${yearGolfInsights.expenseRounds === 1 ? "" : "s"} conciliada${yearGolfInsights.expenseRounds === 1 ? "" : "s"}` : "sin gasto conciliado"}</small></div></div>
      {Object.keys(betaGolfInsights.categoryTotals).length > 0 && <ResultAccordion id="history-bet-balance" title="Balance por apuesta"><div className="expenseBars">{Object.entries(betaGolfInsights.categoryTotals).map(([name, value]) => <div key={name}><span>{historicalBetDisplayLabel(name)}</span><b className={value > 0 ? "good" : value < 0 ? "bad" : ""}>{signedMoney(value)}</b></div>)}</div></ResultAccordion>}
      <ResultAccordion id="history-year-expenses" title="Gastos del año"><div className="expenseBars">{([['caddie','Caddie'],['food','Alimentos'],['drinks','Bebidas'],['greenFee','Greenfee'],['cartRental','Renta carrito'],['other','Otros']] as [keyof Expense,string][]).map(([k, label]) => <div key={k}><span>{label}</span><b>{yearGolfInsights.expenseBreakdown ? money(yearGolfInsights.expenseBreakdown[k]) : "—"}</b></div>)}</div>{yearGolfInsights.expenseRounds === 0 && <p className="muted">No hay gastos anuales conciliados para agregar.</p>}</ResultAccordion>
      <section className="card"><div className="sectionTitle"><div><h2>Rondas</h2><p>Más recientes primero. Los campos se guardan como snapshot.</p></div><button className="textButton" onClick={requestNewRound}>+ Nueva</button></div>
        <div className="historyFilters" aria-label="Filtrar rondas por fecha"><label>Año<select value={historyYear} onChange={(event) => setHistoryYear(event.target.value)}><option value="">Todos</option>{availableHistoryYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label>Mes<select value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}><option value="">Todos</option>{MONTH_LABELS.map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}</select></label></div>
        {!history.length ? <div className="empty">Todavía no has guardado rondas.</div> : !filteredHistory.length ? <div className="empty">No hay rondas en el periodo seleccionado.</div> : filteredHistory.map((r) => {
          const recap = buildHistoricalRoundRecap(r);
          const financials = recap.financials;
          const holeLabel = recap.meta.holeCount ? `${recap.meta.holeCount} hoyos` : "hoyos no registrados";
          return <div className="historyRound" key={r.id}><div className="historyRow"><div><b>{recap.meta.courseName || "Campo no disponible"}</b><span>{recap.meta.date || "Fecha no disponible"} · {holeLabel} · apuestas {financials?.betResult === undefined ? "—" : money(financials.betResult)} · gastos {financials?.expenseTotal === undefined ? "—" : money(financials.expenseTotal)}</span></div><strong className={financials?.netResult === undefined ? "" : financials.netResult >= 0 ? "good" : "bad"}>{financials?.netResult === undefined ? "—" : money(financials.netResult)}</strong></div><div className="historyActions"><button onClick={() => { setHistoryDetailId(r.id); setTab("historyDetail"); }}>Abrir ronda</button><button onClick={() => downloadRoundCsv(r)}>CSV</button><button onClick={() => downloadRoundPdf(r)}>PDF</button><button onClick={() => downloadRoundImage(r)}>Imagen</button><button onClick={() => shareRound(r)}>Compartir</button><label className="uploadButton">{r.photoId ? "Cambiar foto" : "Agregar foto de tarjeta"}<input type="file" accept="image/*" capture="environment" onChange={(event) => attachScorecardPhoto(r, event.target.files?.[0])} /></label>{r.photoId && <button onClick={() => viewScorecardPhoto(r)}>Ver tarjeta original</button>}<button className="dangerGhost" onClick={() => setHistoricalRoundToDelete(r)}>Eliminar ronda</button></div></div>;
        })}
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
        <label>HCP predeterminado<NumericCaptureInput aria-label={`HCP del integrante ${index + 1}`} inputMode="decimal" step={0.1} min={-15} max={36} placeholder="HCP" value={member.handicap} emptyWhenZero={false} onValueChange={(handicap) => editFrequentGroupMember(index, { handicap })} /></label>
        <div className="groupMemberActions"><button className="secondary" aria-label={`Subir a ${member.name}`} disabled={index === 0} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, -1) : group)}>↑</button><button className="secondary" aria-label={`Bajar a ${member.name}`} disabled={index === frequentGroupDraft.players.length - 1} onClick={() => setFrequentGroupDraft((group) => group ? moveFrequentGroupMember(group, index, 1) : group)}>↓</button><button className="dangerGhost" onClick={() => removeMemberFromFrequentGroup(index)}>Quitar</button></div>
      </div>)}</div>
      {!frequentGroupDraft.players.length && <div className="empty">Agrega al menos un integrante para guardar el grupo.</div>}
      <div className="groupMemberAdd"><div className="groupEditorSectionTitle"><h3>Agregar integrante</h3></div>
        <div className="segmented"><button className={groupMemberSource === "frequent" ? "active" : ""} disabled={!frequentPlayers.length} onClick={() => setGroupMemberSource("frequent")}>Jugador frecuente</button><button className={groupMemberSource === "new" ? "active" : ""} onClick={() => setGroupMemberSource("new")}>Jugador nuevo</button></div>
        {groupMemberSource === "frequent" && frequentPlayers.length > 0 && <div className="groupMemberAddRow"><label>Elegir jugador<select value={selectedGroupFrequentPlayerId} onChange={(event) => setSelectedGroupFrequentPlayerId(event.target.value)}>{frequentPlayers.map((player) => <option key={player.id} value={player.id}>{player.name} · HCP {player.handicap ?? "—"}</option>)}</select></label><button className="secondary" disabled={!selectedGroupFrequentPlayerId} onClick={addExistingPlayerToFrequentGroup}>Agregar</button></div>}
        {groupMemberSource === "new" && <><div className="groupMemberNewRow"><label>Nombre<input placeholder="Nombre del jugador" value={newGroupMember.name} onChange={(event) => setNewGroupMember((member) => ({ ...member, name: event.target.value }))} /></label><label>HCP predeterminado<NumericCaptureInput inputMode="decimal" step={0.1} min={-15} max={36} placeholder="HCP" value={newGroupMember.handicap} emptyWhenZero={false} onValueChange={(handicap) => setNewGroupMember((member) => ({ ...member, handicap }))} /></label></div><label className="checkRow"><input type="checkbox" checked={saveNewGroupMemberAsFrequent} onChange={(event) => setSaveNewGroupMemberAsFrequent(event.target.checked)} />Guardar como jugador frecuente</label><button className="secondary groupMemberAddButton" disabled={!newGroupMember.name.trim()} onClick={addNewPlayerToFrequentGroup}>Agregar jugador nuevo</button></>}
      </div>
      {frequentGroupEditError && <div className="notice bad" role="alert">{frequentGroupEditError}</div>}
      <div className="dialogActions"><button className="secondary" onClick={resetFrequentGroupEditor}>Cancelar</button><button className="primary" disabled={!frequentGroupDraft.name.trim() || !frequentGroupDraft.players.length || frequentGroupDraft.players.some((member) => !member.name.trim())} onClick={saveFrequentGroupEdit}>Guardar</button></div>
    </section></div>}

    {showDeleteRoundConfirm && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-round-title" aria-describedby="delete-round-description"><h2 id="delete-round-title">¿Eliminar esta ronda?</h2><p id="delete-round-description">Se eliminará la ronda en curso y sus datos capturados. Esta acción no se puede deshacer.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setShowDeleteRoundConfirm(false)}>Cancelar</button><button className="dangerButton" onClick={deleteActiveRound}>Eliminar ronda</button></div></section></div>}

    {historicalRoundToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-history-round-title" aria-describedby="delete-history-round-description"><h2 id="delete-history-round-title">¿Eliminar esta ronda del histórico?</h2><p id="delete-history-round-description">Esta acción eliminará definitivamente esta ronda guardada y sus resultados.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setHistoricalRoundToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={confirmHistoricalRoundDeletion}>Eliminar</button></div></section></div>}

    {personalHistoryToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-personal-history-title" aria-describedby="delete-personal-history-description"><h2 id="delete-personal-history-title">¿Eliminar este registro personal?</h2><p id="delete-personal-history-description">Esto eliminará este resultado del histórico de Personales contra {personalHistoryToDelete.rivalName}.</p><div className="dialogActions"><button autoFocus className="secondary" onClick={() => setPersonalHistoryToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={confirmPersonalHistoryDeletion}>Eliminar</button></div></section></div>}

    {frequentGroupToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-group-title" aria-describedby="delete-group-description"><h2 id="delete-group-title">¿Eliminar grupo guardado?</h2><p id="delete-group-description">Esto eliminará únicamente este grupo. No afectará jugadores ni rondas anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentGroupToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "frequent_group", frequentGroupToDelete.id); setFrequentGroups((groups) => resolveFrequentGroupDeletion(groups, frequentGroupToDelete.id, "delete")); if (frequentGroupDraft?.id === frequentGroupToDelete.id) resetFrequentGroupEditor(); setFrequentGroupToDelete(null); }}>Eliminar</button></div></section></div>}

    {frequentPlayerToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-frequent-title" aria-describedby="delete-frequent-description"><h2 id="delete-frequent-title">¿Eliminar jugador frecuente?</h2><p id="delete-frequent-description">Esto solamente lo eliminará de tu lista de jugadores frecuentes. No afectará rondas anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setFrequentPlayerToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "frequent_player", frequentPlayerToDelete.id); setFrequentPlayers((templates) => removeFrequentPlayerTemplate(templates, frequentPlayerToDelete.id)); if (editingFrequentPlayerId === frequentPlayerToDelete.id) setEditingFrequentPlayerId(null); setFrequentPlayerToDelete(null); }}>Eliminar</button></div></section></div>}

    {savedRivalToDelete && <div className="modalBackdrop" role="presentation"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-rival-title" aria-describedby="delete-rival-description"><h2 id="delete-rival-title">¿Eliminar rival guardado?</h2><p id="delete-rival-description">Esto solamente lo eliminará de tu lista de rivales para futuras apuestas personales. No afectará rondas ni resultados anteriores.</p><div className="dialogActions"><button className="secondary" onClick={() => setSavedRivalToDelete(null)}>Cancelar</button><button className="dangerButton" onClick={() => { recordCloudDeletion(localStorage, "rival", savedRivalToDelete.id); setSavedPersonalRivals((templates) => removeSavedPersonalRivalTemplate(templates, savedRivalToDelete.id)); if (editingSavedRivalId === savedRivalToDelete.id) { setEditingSavedRivalId(null); setSavedRivalDraft(null); } setSavedRivalToDelete(null); }}>Eliminar</button></div></section></div>}

    <AppBottomNav activeTab={tab} onNavigate={navigateFromBottomBar} />
  </main>;
}

export default function Page() {
  return <AccountProvider><GolfBetsApp /></AccountProvider>;
}
