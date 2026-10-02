"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APPROACH_BEHAVIORS,
  BACKYARD_BALL_FIT_DISCLAIMER,
  BALL_COLOR_PREFERENCES,
  BALL_FEEL_PREFERENCES,
  BALL_FIT_PRICE_PREFERENCES,
  BALL_FIT_PRIORITIES,
  BALL_TRAJECTORY_PREFERENCES,
  GREEN_FIRMNESS_OPTIONS,
  SWING_SPEED_BANDS,
  YES_NO_UNKNOWN,
  getBallFitInputCompleteness,
  type BallFitInput,
  type BallFitProfileDefaults,
  type BallFitPriority,
  type BallFitResult,
} from "../../lib/ball-fitting";
import {
  BALL_FIT_CATALOG_SCOPE_ERROR,
  createBallFitTransportInput,
  normalizeBallFitApiSuccess,
} from "../../lib/ball-fitting-api";
import { loadBallFitDraft, removeBallFitDraft, saveBallFitDraft, type BallFitDraft } from "../../lib/ball-fitting-storage";
import { summarizeLaunchMonitorSession, type GolfBallCatalog, type PlayerBall, type QualitativeLevel } from "../../lib/golf-equipment";
import { BALL_FIT_HANDICAP_LABELS, BALL_FIT_EXPERIENCES, normalizeBallFitHandicap, type BallFitHandicapSource } from "../../lib/ball-fit-handicap";
import { LaunchMonitorCapture } from "./launch-monitor-capture";
import { NumericCaptureInput } from "./numeric-capture-input";
import { CatalogProductMedia } from "./catalog-product-media";
import { BackyardIcon, type BackyardIconName } from "./backyard-icon";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";
import { FeedbackLink } from "./feedback-dialog";
import { useEquipmentCatalogSearch } from "./use-equipment-catalog-search";
import styles from "./equipment.module.css";
import { BallFitBallVisual } from "./equipment-visuals";
import { BottomBackAction } from "./bottom-back-action";

const FEEL_LABELS = {
  VERY_SOFT: "Muy suave",
  SOFT: "Suave",
  MEDIUM: "Media",
  FIRM: "Firme",
  VERY_FIRM: "Muy firme",
  ANY: "Me da igual",
} as const;

const TRAJECTORY_LABELS = { LOW: "Baja", MID: "Media", HIGH: "Alta", UNKNOWN: "No sé" } as const;
const GREEN_LABELS = { SOFT: "Blandos", MEDIUM: "Medios", FIRM: "Firmes", VARIES_UNKNOWN: "Varía / no sé" } as const;
const APPROACH_LABELS = { ROLLS_TOO_MUCH: "La bola corre demasiado", STOPS_WELL: "Se detiene bien", TOO_MUCH_BACKSPIN: "Genero demasiado spin / backspin", UNKNOWN: "No sé" } as const;
const YES_NO_LABELS = { YES: "Sí", NO: "No", UNKNOWN: "No sé" } as const;
const PRICE_LABELS = { BEST_FIT: "No importa si es la mejor para mí", PREMIUM: "Premium", MID: "Media", ECONOMY: "Económica" } as const;
const COLOR_LABELS = { WHITE: "Blanco", YELLOW: "Amarillo", OTHER: "Otro", ANY: "Me da igual" } as const;
const SPEED_LABELS = { UNDER_85: "< 85 mph", FROM_85_TO_95: "85–95 mph", FROM_95_TO_105: "95–105 mph", OVER_105: "105+ mph", UNKNOWN: "No la sé" } as const;
const PRIORITY_LABELS: Record<BallFitPriority, string> = {
  DRIVER_DISTANCE: "Distancia con driver",
  LESS_DRIVER_SPIN: "Menos spin con driver",
  STABILITY_CONTROL: "Mayor estabilidad / control",
  HEIGHT: "Altura",
  IRON_CONTROL: "Control con hierros",
  STOP_ON_GREEN: "Poder detener la bola en green",
  WEDGE_SPIN: "Spin de wedges",
  GREENSIDE_FEEL: "Sensación alrededor del green",
  PUTTER_FEEL: "Sensación con putter",
};

const FIT_STEPS = ["Tu juego", "Driver y mediciones", "Sensación y vuelo", "Approach y green", "Tus prioridades", "Precio y color"] as const;

function LaunchMonitorVisual() {
  return <svg viewBox="0 0 240 160" className={styles.launchEntryVisual} aria-hidden="true" focusable="false">
    <defs><linearGradient id="launch-device" x2="1" y2="1"><stop stopColor="#f4ead1" /><stop offset="1" stopColor="#c6a655" /></linearGradient></defs>
    <ellipse cx="116" cy="143" rx="99" ry="9" fill="#062e24" opacity=".4" />
    <path d="M78 125Q125 18 215 32" fill="none" stroke="#d8bd77" strokeWidth="2" strokeDasharray="4 6" />
    <path d="M78 125Q130 67 217 97" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".3" />
    <rect x="28" y="54" width="67" height="83" rx="14" fill="url(#launch-device)" />
    <rect x="36" y="63" width="51" height="53" rx="7" fill="#113c31" />
    <circle cx="61" cy="88" r="14" fill="none" stroke="#c3a766" strokeWidth="1.5" />
    <circle cx="61" cy="88" r="7" fill="#051f19" /><circle cx="65" cy="84" r="3" fill="#e7eee6" />
    <rect x="49" y="124" width="26" height="3" rx="1.5" fill="#526750" />
    <circle cx="136" cy="130" r="12" fill="#fffdf5" /><path d="M129 123l4 3m7-3-3 4m-7 5 4-1m8 1-3 3" stroke="#ced8cd" strokeWidth="1.5" />
    <circle cx="215" cy="32" r="5" fill="#fffdf5" />
  </svg>;
}

const PRIORITY_ICONS: Record<BallFitPriority, BackyardIconName> = {
  DRIVER_DISTANCE: "driverDistance",
  LESS_DRIVER_SPIN: "lessDriverSpin",
  STABILITY_CONTROL: "stabilityControl",
  HEIGHT: "trajectoryHeight",
  IRON_CONTROL: "ironControl",
  STOP_ON_GREEN: "stopOnGreen",
  WEDGE_SPIN: "wedgeSpin",
  GREENSIDE_FEEL: "greensideFeel",
  PUTTER_FEEL: "putterFeel",
};

const LEVEL_LABELS: Record<QualitativeLevel, string> = {
  VERY_LOW: "Muy bajo",
  LOW: "Bajo",
  MID: "Medio",
  HIGH: "Alto",
  VERY_HIGH: "Muy alto",
};

const PRICE_RESULT_LABELS = { ECONOMY: "Económica", MID: "Media", PREMIUM: "Premium" } as const;
const DRAFT_SAVE_ERROR = "No pudimos guardar este borrador en el dispositivo. Mantén esta pantalla abierta o libera espacio antes de salir.";
const FIT_REQUEST_ERROR = "No pudimos completar el análisis. Revisa tu conexión e inténtalo de nuevo.";

function defaultInput(userId: string, handicap: number | null, currentBallId: string | null, defaults?: BallFitProfileDefaults, handicapSource?: BallFitHandicapSource | null): BallFitInput {
  return {
    userId,
    currentBallId,
    ...normalizeBallFitHandicap(handicap, handicapSource),
    experience: "UNKNOWN",
    typicalScore: defaults?.typicalScore ?? null,
    driverDistanceYards: defaults?.driverDistanceYards ?? null,
    swingSpeedBand: defaults?.swingSpeedBand || "UNKNOWN",
    feelPreference: "ANY",
    trajectoryPreference: defaults?.trajectoryPreference || "UNKNOWN",
    greenFirmness: "VARIES_UNKNOWN",
    priorities: defaults?.priorities || [],
    approachBehavior: "UNKNOWN",
    wantsGreensideSpin: "UNKNOWN",
    pricePreference: "BEST_FIT",
    colorPreference: "ANY",
    launchMonitorSession: null,
  };
}

function accountIndexLabel(source: BallFitHandicapSource | null | undefined, value: number) {
  if (source === "GHIN") return `Handicap Index GHIN · ${value}`;
  if (source === "BACKYARD") return `Backyard Index · ${value}`;
  return `HCP manual · ${value}`;
}

function currentGameIndexLabel(source: BallFitHandicapSource | null | undefined, value: number | null) {
  const formatted = value?.toLocaleString("es-MX", { maximumFractionDigits: 1 });
  if (source === "GHIN" && formatted) return `GHIN INDEX ${formatted}`;
  if (source === "BACKYARD" && formatted) return `BACKYARD INDEX ${formatted}`;
  if (source === "MANUAL" && formatted) return `HCP MANUAL ${formatted}`;
  return "SIN ÍNDICE";
}

function catalogEditionLabel(ball: Pick<GolfBallCatalog, "generation" | "year"> | null | undefined) {
  if (!ball) return "";
  const generation = ball.generation?.trim() || "";
  const year = ball.year === null ? "" : String(ball.year);
  if (generation && year && generation.toLocaleLowerCase("es-MX") === year.toLocaleLowerCase("es-MX")) return generation;
  return [generation, year].filter(Boolean).join(" · ");
}

function OptionGrid<T extends string>({ values, labels, selected, onSelect }: {
  values: readonly T[];
  labels: Record<T, string>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  return <div className={styles.optionGrid}>{values.map((value) => <button key={value} type="button" className={`${styles.optionButton} ${selected === value ? styles.selected : ""}`} aria-pressed={selected === value} onClick={() => onSelect(value)}>{labels[value]}</button>)}</div>;
}

function BallFitIntroHero({ currentBall }: { currentBall: PlayerBall | null }) {
  return <>
    <div className={styles.ballFitLead}><h3>Encuentra la pelota ideal para tu juego</h3><p>Analizamos tu forma de jugar para recomendarte el tipo de bola que mejor se adapta a ti.</p></div>
    <div className={styles.ballFitHero}>
      <span className={styles.ballFitOrb}><BallFitBallVisual /></span>
      <div><small>{currentBall ? "TU BOLA ACTUAL" : "PERFIL DE BOLA"}</small><b>{currentBall ? `${currentBall.ballBrand} ${currentBall.ballModel}` : "Balance en cada golpe"}</b><p>{currentBall ? [currentBall.generation, currentBall.year].filter(Boolean).join(" · ") || "Modelo guardado" : "El equilibrio ideal entre distancia, control y sensación."}</p></div>
    </div>
    <div className={styles.fitPillars}><span><BackyardIcon name="arrow" size={22} /><b>Distancia</b><small>Llega más lejos</small></span><span><BackyardIcon name="approach" size={22} /><b>Control</b><small>Juega con precisión</small></span><span><BackyardIcon name="ball" size={22} /><b>Sensación</b><small>Siente la diferencia</small></span></div>
  </>;
}

type BallFitWizardProps = {
  initialLaunchMonitor?: boolean;
  userId: string;
  accessToken?: string | null;
  /** Both current entry points are account-only, even during token refresh. */
  requiresRemoteConsent?: boolean;
  defaultHandicap: number | null;
  defaultHandicapSource?: BallFitHandicapSource | null;
  profileDefaults?: BallFitProfileDefaults;
  savedInput?: BallFitInput | null;
  currentBall: PlayerBall | null;
  catalog: readonly GolfBallCatalog[];
  sessionId?: string | null;
  onCancel: () => void;
  onOpenPrivacy?: () => void;
  onCurrentBallSelect: (ball: GolfBallCatalog) => PlayerBall | null;
  onComplete: (result: BallFitResult, input: BallFitInput, choice: BallFitCompletionChoice) => boolean | void;
};

export type BallFitCompletionChoice =
  | { action: "KEEP_CURRENT" }
  | { action: "RECOMMENDATION"; ball: GolfBallCatalog };

type BallFitResultChoice =
  | { action: "KEEP_CURRENT" }
  | { action: "RECOMMENDATION"; catalogBallId: string }
  | null;

export function BallFitWizard({ initialLaunchMonitor = false, userId, accessToken, requiresRemoteConsent = true, defaultHandicap, defaultHandicapSource, profileDefaults, savedInput, currentBall, catalog, sessionId = null, onCancel, onCurrentBallSelect, onComplete, onOpenPrivacy }: BallFitWizardProps) {
  const [input, setInput] = useState<BallFitInput>(() => savedInput?.userId === userId
    ? structuredClone(savedInput)
    : defaultInput(userId, defaultHandicap, currentBall?.catalogBallId || null, profileDefaults, defaultHandicapSource));
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [savedDraft, setSavedDraft] = useState<BallFitDraft | null>(null);
  const [draftChoicePending, setDraftChoicePending] = useState(false);
  const [result, setResult] = useState<BallFitResult | null>(null);
  const [resultCatalog, setResultCatalog] = useState<GolfBallCatalog[]>([]);
  const [resultChoice, setResultChoice] = useState<BallFitResultChoice>(null);
  const [explicitCurrentBall, setExplicitCurrentBall] = useState<GolfBallCatalog | null>(null);
  const [confirmedCurrentBall, setConfirmedCurrentBall] = useState<PlayerBall | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [ballQuery, setBallQuery] = useState("");
  const [ballSearchOpen, setBallSearchOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(Boolean(initialLaunchMonitor));
  const [launchCaptureCompleted, setLaunchCaptureCompleted] = useState(false);
  const handicapChoiceTouched = useRef(false);
  useViewScrollReset(`${step}:${draftChoicePending}:${hydrated}:${launchOpen}`);
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const draftEntryInitializedRef = useRef<string | null>(null);
  const draftEntryKey = `${userId}\u0000${sessionId || "external-entry"}`;
  const pinnedBallIds = useMemo(() => [...new Set([input.currentBallId, savedDraft?.input.currentBallId].filter((id): id is string => Boolean(id)))], [input.currentBallId, savedDraft?.input.currentBallId]);
  const ballSearch = useEquipmentCatalogSearch({ kind: "BALL", query: ballQuery, fallback: catalog, pinnedIds: pinnedBallIds });
  const displayCatalog = useMemo(() => [...new Map([...catalog, ...ballSearch.items, ...resultCatalog].map((ball) => [ball.id, ball])).values()], [ballSearch.items, catalog, resultCatalog]);
  const currentCatalogBall = input.currentBallId ? displayCatalog.find((ball) => ball.id === input.currentBallId) || null : null;
  const storedCurrentBall = confirmedCurrentBall || currentBall;
  const storedCurrentCatalogBall = explicitCurrentBall
    || (storedCurrentBall?.catalogBallId ? displayCatalog.find((ball) => ball.id === storedCurrentBall.catalogBallId) || null : null);
  const launchSummary = useMemo(() => summarizeLaunchMonitorSession(input.launchMonitorSession), [input.launchMonitorSession]);
  const driverLaunchSummary = launchSummary?.byClub.find((item) => item.club === "DRIVER") ?? null;
  const detectedDriverCarry = driverLaunchSummary?.metrics.carryYards?.median ?? null;
  const detectedDriverSpeed = driverLaunchSummary?.metrics.clubSpeedMph?.median ?? null;
  const launchCaptureApplied = launchCaptureCompleted || (launchSummary?.includedShots ?? 0) > 0;
  const hasCanonicalIndex = defaultHandicap !== null
    && (defaultHandicapSource === "GHIN" || defaultHandicapSource === "BACKYARD")
    && input.handicapSource === defaultHandicapSource
    && input.handicap === defaultHandicap;

  useEffect(() => {
    if (draftEntryInitializedRef.current === draftEntryKey) return;
    draftEntryInitializedRef.current = draftEntryKey;
    const saved = loadBallFitDraft(localStorage, userId);
    if (saved) {
      setSavedDraft(saved);
      if (sessionId && saved.sessionId === sessionId) {
        const selectedBall = saved.input.currentBallId
          ? catalog.find((ball) => ball.id === saved.input.currentBallId) || null
          : null;
        setInput(saved.input);
        setStep(Math.min(saved.step, 5));
        setDraftChoicePending(false);
        if (selectedBall) {
          setExplicitCurrentBall(selectedBall);
          setBallQuery(`${selectedBall.brand} ${selectedBall.model}`);
        }
      } else {
        setDraftChoicePending(true);
      }
    } else {
      setSavedDraft(null);
      setDraftChoicePending(false);
    }
    setHydrated(true);
  }, [catalog, draftEntryKey, sessionId, userId]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (handicapChoiceTouched.current || defaultHandicap === null) return;
    const accountHandicap = normalizeBallFitHandicap(defaultHandicap, defaultHandicapSource);
    if (accountHandicap.handicapSource !== "GHIN" && accountHandicap.handicapSource !== "BACKYARD") return;
    setInput((current) => ({ ...current, ...accountHandicap, userId }));
  }, [defaultHandicap, defaultHandicapSource, userId]);

  useEffect(() => {
    if (!hydrated || draftChoicePending) return;
    const saved = saveBallFitDraft(localStorage, input, Math.min(step, 6), new Date().toISOString(), sessionId);
    setMessage((current) => saved
      ? current === DRAFT_SAVE_ERROR ? "" : current
      : DRAFT_SAVE_ERROR);
  }, [draftChoicePending, hydrated, input, sessionId, step]);

  function resumeSavedDraft() {
    if (!savedDraft) return;
    const draftBall = savedDraft.input.currentBallId
      ? displayCatalog.find((ball) => ball.id === savedDraft.input.currentBallId) || null
      : null;
    if (savedDraft.input.currentBallId && currentBall?.catalogBallId !== savedDraft.input.currentBallId && !draftBall) {
      setMessage(ballSearch.status === "idle" || ballSearch.status === "loading"
        ? "Estamos recuperando la bola guardada. Intenta reanudar en un momento."
        : ballSearch.status === "error"
          ? "No pudimos recuperar la bola guardada. Reintenta cargar el catálogo."
          : "La bola guardada ya no está disponible en el catálogo. Empieza un fitting nuevo para elegir otra.");
      return;
    }
    if (draftBall && currentBall?.catalogBallId !== draftBall.id) {
      const saved = onCurrentBallSelect(draftBall);
      if (!saved) {
        setMessage("No pudimos guardar tu bola actual. Vuelve a intentar.");
        return;
      }
      setExplicitCurrentBall(draftBall);
      setConfirmedCurrentBall(saved);
    }
    // Resuming a draft is an explicit choice. Its fitting-only MANUAL/UNKNOWN
    // value must not be replaced if the account Index refreshes afterward.
    handicapChoiceTouched.current = true;
    setMessage("");
    setInput(savedDraft.input);
    setStep(Math.min(savedDraft.step, 5));
    setResult(null);
    setResultCatalog([]);
    setResultChoice(null);
    setDraftChoicePending(false);
  }

  function startNewFit() {
    removeBallFitDraft(localStorage, userId);
    handicapChoiceTouched.current = false;
    setInput(defaultInput(userId, defaultHandicap, currentBall?.catalogBallId || null, profileDefaults, defaultHandicapSource));
    setStep(0);
    setResult(null);
    setResultChoice(null);
    setExplicitCurrentBall(null);
    setConfirmedCurrentBall(null);
    setSavedDraft(null);
    setDraftChoicePending(false);
  }

  function patchInput(values: Partial<BallFitInput>) {
    setInput((current) => ({ ...current, ...values, userId }));
  }

  async function selectCurrentBall(ball: GolfBallCatalog) {
    const saved = onCurrentBallSelect(ball);
    if (!saved) {
      setMessage("No pudimos guardar tu bola actual. Vuelve a intentar.");
      return;
    }
    const nextInput = { ...input, currentBallId: ball.id, userId };
    setMessage("");
    setExplicitCurrentBall(ball);
    setConfirmedCurrentBall(saved);
    setInput(nextInput);
    setBallQuery(`${ball.brand} ${ball.model}`);
    setBallSearchOpen(false);
    await calculate(nextInput);
  }

  function finishLaunchCapture() {
    setLaunchOpen(false);
    setLaunchCaptureCompleted(true);
    setMessage("");
    const driverCarryKnown = detectedDriverCarry !== null || input.driverDistanceYards !== null;
    const driverSpeedKnown = detectedDriverSpeed !== null || input.swingSpeedBand !== "UNKNOWN";
    setStep(driverCarryKnown && driverSpeedKnown ? 2 : 1);
  }

  function next() {
    if (step === 0 && input.handicapSource === "MANUAL" && input.handicap === null) {
      setMessage("Captura tu HCP entre -20 y 54, o elige ‘No conozco mi hándicap / Estoy empezando’.");
      return;
    }
    setMessage("");
    setStep((current) => Math.min(5, current + 1));
  }

  function previous() {
    setMessage("");
    if (result) { setResult(null); setResultCatalog([]); setResultChoice(null); setStep(5); return; }
    setStep((current) => Math.max(0, current - 1));
  }

  function togglePriority(priority: BallFitPriority) {
    patchInput({ priorities: input.priorities.includes(priority) ? input.priorities.filter((item) => item !== priority) : [...input.priorities, priority] });
  }

  function movePriority(priority: BallFitPriority, delta: -1 | 1) {
    const priorities = [...input.priorities];
    const index = priorities.indexOf(priority);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= priorities.length) return;
    [priorities[index], priorities[destination]] = [priorities[destination], priorities[index]];
    patchInput({ priorities });
  }

  async function calculate(targetInput: BallFitInput = input) {
    if (calculating) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setCalculating(true);
    setMessage("");
    try {
      const transportInput = createBallFitTransportInput(targetInput);
      if (!transportInput) {
        setMessage(FIT_REQUEST_ERROR);
        return;
      }
      const response = await fetch("/api/ball-fitting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: transportInput }),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorRecord = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
        if (errorRecord?.code === BALL_FIT_CATALOG_SCOPE_ERROR) {
          setMessage("No pudimos completar el análisis en este momento. Inténtalo de nuevo más tarde.");
          return;
        }
        setMessage(FIT_REQUEST_ERROR);
        return;
      }
      const fit = normalizeBallFitApiSuccess(payload);
      if (!fit) {
        setMessage(FIT_REQUEST_ERROR);
        return;
      }
      setResult(fit.result);
      setResultCatalog(fit.catalog);
      setResultChoice(null);
      setStep(6);
      if (!saveBallFitDraft(localStorage, targetInput, 6, new Date().toISOString(), sessionId)) setMessage(DRAFT_SAVE_ERROR);
      else if (fit.result.recommendations.length === 0) setMessage(fit.result.warnings[0] || "Necesitamos más preferencias para comparar bolas.");
    } catch (error) {
      if (controller.signal.aborted) return;
      void error;
      setMessage(FIT_REQUEST_ERROR);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setCalculating(false);
    }
  }

  function saveAndClose() {
    if (!saveBallFitDraft(localStorage, input, Math.min(step, 6), new Date().toISOString(), sessionId)) {
      setMessage(DRAFT_SAVE_ERROR);
      return;
    }
    onCancel();
  }

  function exitWithoutSaving() {
    onCancel();
  }

  function finish() {
    if (!result?.recommendations.length) return;
    if (!resultChoice) {
      setMessage("Elige una recomendación o conserva tu bola actual para terminar.");
      return;
    }
    const selectedRecommendation = resultChoice.action === "RECOMMENDATION"
      ? displayCatalog.find((ball) => ball.id === resultChoice.catalogBallId) || null
      : null;
    if (resultChoice.action === "RECOMMENDATION" && !selectedRecommendation) {
      setMessage("No pudimos confirmar esa recomendación. Elige otra opción e intenta de nuevo.");
      return;
    }
    const choice: BallFitCompletionChoice = resultChoice?.action === "KEEP_CURRENT"
      ? { action: "KEEP_CURRENT" }
      : { action: "RECOMMENDATION", ball: selectedRecommendation! };
    const completed = onComplete(result, input, choice);
    if (completed !== false) removeBallFitDraft(localStorage, userId);
  }

  const completeness = getBallFitInputCompleteness(input);
  const unresolvedDraftBall = Boolean(savedDraft?.input.currentBallId
    && currentBall?.catalogBallId !== savedDraft.input.currentBallId
    && !displayCatalog.some((ball) => ball.id === savedDraft.input.currentBallId));
  const resolvingDraftBall = unresolvedDraftBall && (ballSearch.status === "idle" || ballSearch.status === "loading");

  if (!hydrated) return <div className={styles.loadingState} role="status">Recuperando tu Ball Fit…</div>;

  if (draftChoicePending && savedDraft) return <div className={`${styles.wizard} ${styles.ballFitFlow}`}>
    <div className={styles.wizardHeader}><div><div className="eyebrow">THE BACKYARD BALL FIT</div><h2>Tienes un fitting en progreso</h2><p>Guardado {new Date(savedDraft.updatedAt).toLocaleString("es-MX")}</p></div><button type="button" className="textButton" onClick={onCancel}>Cerrar</button></div>
    <section className={styles.questionBlock}><h3>¿Quieres continuar o empezar de nuevo?</h3><p>Reanudar conserva exactamente tus respuestas anteriores. Empezar nuevo precarga el HCP y la bola actuales del perfil.</p></section>
    {message && <div className={styles.formMessage} role="alert">{message}</div>}
    {unresolvedDraftBall && ballSearch.status === "error" && <button type="button" className="textButton" onClick={ballSearch.retry}>Reintentar catálogo</button>}
    <div className={styles.wizardActions}><button type="button" className="secondary" onClick={startNewFit}>Empezar nuevo</button><button type="button" className="primary" onClick={resumeSavedDraft} disabled={resolvingDraftBall}>Reanudar fitting</button></div>
    <BottomBackAction label="Cerrar" onBack={onCancel} />
  </div>;

  if (launchOpen && !result) return <div className={`${styles.wizard} ${styles.ballFitFlow} ${styles.launchWizard}`}>
    <div className={styles.launchWizardHeader}>
      <div><span>MEDICIONES OPCIONALES</span><h2>Captura y analiza tus golpes</h2><p>Sube fotos de tu monitor de lanzamiento y obtén tus datos automáticamente.</p></div>
      <button type="button" className="textButton" onClick={saveAndClose}>Guardar y salir</button>
    </div>
    <LaunchMonitorCapture
      userId={userId}
      accessToken={accessToken}
      requiresRemoteConsent={requiresRemoteConsent}
      value={input.launchMonitorSession}
      onChange={(launchMonitorSession) => patchInput({ launchMonitorSession })}
      onOpenPrivacy={onOpenPrivacy}
      onDone={finishLaunchCapture}
    />
    <BottomBackAction label="Guardar y salir" onBack={saveAndClose} />
  </div>;

  return <div className={`${styles.wizard} ${styles.ballFitFlow}`}>
    <div className={styles.wizardHeader}><div><div className="eyebrow">THE BACKYARD BALL FIT</div><p className={styles.fitStepLabel}>{result ? "Fitting completo" : `Paso ${step + 1} de 6`}</p><h2>{result ? "Tu mejor grupo de bolas" : FIT_STEPS[step]}</h2><p>{result ? "Recomendaciones según tus preferencias" : step === 5 ? "Último paso antes de ver tus recomendaciones" : `Después: ${FIT_STEPS[step + 1]}. Puedes guardar y retomar después.`}</p></div><button type="button" className="textButton" onClick={saveAndClose}>Guardar y salir</button></div>
    <div className={styles.progressTrack} role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={result ? 6 : step + 1} aria-label={result ? "Ball Fit completo" : `Paso ${step + 1} de 6: ${FIT_STEPS[step]}`}>{FIT_STEPS.map((label, item) => <span key={label} data-active={result !== null || item <= step} data-current={!result && item === step} />)}</div>
    {!result && step === 0 && <BallFitIntroHero currentBall={currentBall} />}

    {!result && step === 0 && <section className={styles.questionBlock}>
      <h3>Tu juego actual</h3>
      <p>{hasCanonicalIndex ? "Usaremos tu fuente activa; no necesitas volver a elegirla." : "Elige un dato simple para personalizar el fitting. No modificaremos tu perfil."}</p>
      <div className={styles.handicapChoices} aria-label="Fuente del hándicap para Ball Fit">
        {hasCanonicalIndex && <div className={styles.activeIndex}><span aria-hidden="true">✓</span><div><small>FUENTE ACTIVA</small><b>{accountIndexLabel(defaultHandicapSource, defaultHandicap!)}</b></div></div>}
        {defaultHandicap === null && defaultHandicapSource === "BACKYARD" && <p className={styles.subtle}>Tu Backyard Index todavía no está disponible.</p>}
        {defaultHandicap === null && defaultHandicapSource !== "BACKYARD" && <p className={styles.subtle}>Tu cuenta todavía no tiene un índice disponible.</p>}
        {!hasCanonicalIndex && <button type="button" className={`${styles.optionButton} ${input.handicapSource === "MANUAL" ? styles.selected : ""}`} aria-pressed={input.handicapSource === "MANUAL"} onClick={() => { handicapChoiceTouched.current = true; patchInput({ handicapSource: "MANUAL", handicap: input.handicapSource === "MANUAL" ? input.handicap : null }); }}>Capturar HCP manual</button>}
        {!hasCanonicalIndex && <button type="button" className={`${styles.optionButton} ${input.handicapSource === "UNKNOWN" ? styles.selected : ""}`} aria-pressed={input.handicapSource === "UNKNOWN"} onClick={() => { handicapChoiceTouched.current = true; patchInput({ handicapSource: "UNKNOWN", handicap: null }); }}>No conozco mi hándicap / Estoy empezando</button>}
      </div>
      {input.handicapSource === "MANUAL" && <label>HCP manual (sólo este fitting)<NumericCaptureInput inputMode="decimal" min={-20} max={54} emptyWhenZero={false} value={input.handicap} onValueChange={(handicap) => { handicapChoiceTouched.current = true; patchInput({ handicap }); }} placeholder="Ej. 18" /><small>Declarado por ti; no es GHIN ni Backyard Index.</small></label>}
      {input.handicapSource === "UNKNOWN" && <><h4>¿Cuánta experiencia tienes?</h4><OptionGrid values={BALL_FIT_EXPERIENCES} labels={{ STARTING: "Estoy empezando", OCCASIONAL: "Juego ocasionalmente", REGULAR: "Juego con regularidad", UNKNOWN: "Prefiero no indicar" }} selected={input.experience || "UNKNOWN"} onSelect={(experience) => patchInput({ experience })} /><p className={styles.subtle}>Esto aporta contexto; no calculamos un hándicap estimado.</p></>}
      <label>Score típico en 18 hoyos (opcional)<NumericCaptureInput keyboardMode="numeric" min={40} max={200} value={input.typicalScore} onValueChange={(typicalScore) => patchInput({ typicalScore })} placeholder="Si lo conoces" /></label>
    </section>}

    {!result && step === 1 && <section className={styles.questionBlock}>
      <div className={styles.currentGameSource}><small>TU JUEGO ACTUAL</small><b>{currentGameIndexLabel(input.handicapSource, input.handicap)}</b></div>
      <h3>¿Cómo quieres continuar?</h3>
      <button type="button" aria-label="Agregar mediciones de launch monitor" className={`${styles.launchEntry} ${styles.launchEntryPremium}`} onClick={() => setLaunchOpen(true)}>
        <LaunchMonitorVisual /><span className={styles.launchEntryCopy}><small>DALE MÁS PRECISIÓN A TU FIT</small><b>Agregar mediciones de launch monitor</b><span>Usa tus golpes reales para afinar la recomendación. Fotos de pantalla o captura manual.</span><small>TrackMan · FlightScope · Garmin · GCQuad · Rapsodo</small><strong>Agregar mediciones <span aria-hidden="true">→</span></strong></span>
      </button>
      <div className={styles.manualQuestionnaireSeparator}><span>— O CONTINÚA MANUALMENTE —</span></div>
      <h3>Tu juego con driver</h3>
      {(detectedDriverCarry !== null || detectedDriverSpeed !== null) && <div className={styles.detectedDriverData} aria-label="Datos de launch monitor aplicados">
        <div><small>DATOS YA APLICADOS</small><b>Driver · {driverLaunchSummary?.includedShots ?? 0} golpes válidos</b></div>
        {detectedDriverSpeed !== null && <span>Club speed<b>{detectedDriverSpeed.toLocaleString("es-MX", { maximumFractionDigits: 1 })} mph</b></span>}
        {detectedDriverCarry !== null && <span>Carry<b>{detectedDriverCarry.toLocaleString("es-MX", { maximumFractionDigits: 1 })} yd</b></span>}
      </div>}
      {detectedDriverCarry === null && (!launchCaptureApplied || input.driverDistanceYards === null) && <label>¿Cuánto pegas aproximadamente con driver? (yardas, opcional)<NumericCaptureInput keyboardMode="numeric" min={50} max={500} value={input.driverDistanceYards} onValueChange={(driverDistanceYards) => patchInput({ driverDistanceYards })} placeholder="Ej. 245" /></label>}
      {detectedDriverSpeed === null && (!launchCaptureApplied || input.swingSpeedBand === "UNKNOWN") && <><h4>Velocidad de swing con driver</h4><OptionGrid values={SWING_SPEED_BANDS} labels={SPEED_LABELS} selected={input.swingSpeedBand} onSelect={(value) => patchInput({ swingSpeedBand: value })} /></>}
    </section>}

    {!result && step === 2 && <section className={styles.questionBlock}>
      <h3>Feel y vuelo</h3><p>Elige lo que prefieres sentir y ver; “No sé” también es una respuesta válida.</p>
      <h4>¿Cómo prefieres sentir la bola?</h4><OptionGrid values={BALL_FEEL_PREFERENCES} labels={FEEL_LABELS} selected={input.feelPreference} onSelect={(value) => patchInput({ feelPreference: value })} />
      <h4>Trayectoria preferida</h4><OptionGrid values={BALL_TRAJECTORY_PREFERENCES} labels={TRAJECTORY_LABELS} selected={input.trajectoryPreference} onSelect={(value) => patchInput({ trajectoryPreference: value })} />
    </section>}

    {!result && step === 3 && <section className={styles.questionBlock}>
      <h3>Approach y green</h3><p>Esto ayuda a ponderar control de hierros y juego corto cuando esos atributos están disponibles.</p>
      <h4>Tus greens normalmente son</h4><OptionGrid values={GREEN_FIRMNESS_OPTIONS} labels={GREEN_LABELS} selected={input.greenFirmness} onSelect={(value) => patchInput({ greenFirmness: value })} />
      <h4>En tiros de aproximación normalmente</h4><OptionGrid values={APPROACH_BEHAVIORS} labels={APPROACH_LABELS} selected={input.approachBehavior} onSelect={(value) => patchInput({ approachBehavior: value })} />
      <h4>¿Quieres más control / spin alrededor del green?</h4><OptionGrid values={YES_NO_UNKNOWN} labels={YES_NO_LABELS} selected={input.wantsGreensideSpin} onSelect={(value) => patchInput({ wantsGreensideSpin: value })} />
    </section>}

    {!result && step === 4 && <section className={styles.questionBlock}>
      <h3>¿Qué quieres mejorar?</h3><p>Selecciona y ordena tus prioridades. Las primeras pesan más según los datos disponibles.</p>
      <div className={styles.optionGrid}>{BALL_FIT_PRIORITIES.map((priority) => <button key={priority} type="button" className={`${styles.optionButton} ${styles.visualOption} ${input.priorities.includes(priority) ? styles.selected : ""}`} aria-pressed={input.priorities.includes(priority)} onClick={() => togglePriority(priority)}><BackyardIcon name={PRIORITY_ICONS[priority]} size={22} /><span>{PRIORITY_LABELS[priority]}</span><b aria-hidden="true">{input.priorities.includes(priority) ? "✓" : "+"}</b></button>)}</div>
      {input.priorities.length > 0 && <div className={styles.priorityList} aria-label="Prioridades ordenadas">{input.priorities.map((priority, index) => <div className={styles.priorityItem} key={priority}><span>{index + 1}</span><b>{PRIORITY_LABELS[priority]}</b><div><button type="button" disabled={index === 0} aria-label={`Subir ${PRIORITY_LABELS[priority]}`} onClick={() => movePriority(priority, -1)}>↑</button><button type="button" disabled={index === input.priorities.length - 1} aria-label={`Bajar ${PRIORITY_LABELS[priority]}`} onClick={() => movePriority(priority, 1)}>↓</button></div></div>)}</div>}
      <p className={styles.subtle}>Distancia con driver y estabilidad se guardan como contexto y no elevan un Match Score por sí solas.</p>
    </section>}

    {!result && step === 5 && <fieldset className={styles.questionFieldset} disabled={calculating}>
      <section className={styles.questionBlock}>
      <h3>Precio y color</h3><p>Último paso. Estas preferencias no reemplazan el desempeño que priorizaste.</p>
      <h4>¿Qué tanto importa el precio?</h4><OptionGrid values={BALL_FIT_PRICE_PREFERENCES} labels={PRICE_LABELS} selected={input.pricePreference} onSelect={(value) => patchInput({ pricePreference: value })} />
      <h4>Color preferido</h4><OptionGrid values={BALL_COLOR_PREFERENCES} labels={COLOR_LABELS} selected={input.colorPreference} onSelect={(value) => patchInput({ colorPreference: value })} />
      <h4>Comparación opcional</h4>
      {currentBall && <div className={styles.ballHero}><span className={styles.ballGlyph}><BallFitBallVisual /></span><div><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3><p>{[currentBall.generation, currentBall.year, currentBall.catalogBallId ? "Catálogo" : "Modelo manual"].filter(Boolean).join(" · ")}</p></div></div>}
      <AnchoredSearch label="Bola actual para comparar (opcional)" value={ballQuery} onChange={(value) => { setBallQuery(value); setBallSearchOpen(true); }} onFocus={() => setBallSearchOpen(true)} placeholder="Escribe marca, modelo, generación o año" expanded={ballSearchOpen} status={ballSearchOpen ? ballSearch.status === "loading" ? "Buscando bolas…" : ballSearch.items.length ? `${ballSearch.items.length} resultados del catálogo` : "Sin coincidencias en el catálogo" : currentCatalogBall ? `✓ Seleccionada: ${currentCatalogBall.brand} ${currentCatalogBall.model}` : "Sin comparación"}>
        <AnchoredSearchOption label="No comparar con una bola" selected={input.currentBallId === null} onSelect={() => { patchInput({ currentBallId: null }); setBallQuery(""); setBallSearchOpen(false); }}><b>No comparar con una bola</b><small>No modifica tu bola actual.</small></AnchoredSearchOption>
        {ballSearch.items.filter((ball) => ball.active).map((ball) => <AnchoredSearchOption key={ball.id} selected={input.currentBallId === ball.id} label={`Seleccionar ${ball.brand} ${ball.model}`} onSelect={() => selectCurrentBall(ball)}><b>{ball.brand} {ball.model}</b>{catalogEditionLabel(ball) && <small>{catalogEditionLabel(ball)}</small>}</AnchoredSearchOption>)}
      </AnchoredSearch>
      {ballSearch.hasMore && <button type="button" className="secondary" onClick={() => void ballSearch.loadMore()}>Mostrar más bolas</button>}
      <FeedbackLink category="BALL">¿No encuentras tu bola? Solicítala</FeedbackLink>
      <p className={styles.subtle}>Primero recomendamos con tus datos de juego. Esta selección sólo agrega una comparación contra tu bola actual.</p>
      <p className={styles.subtle}>Completitud de respuestas: {completeness}%. El recomendador puede dar una coincidencia parcial, pero necesita al menos dos preferencias comparables.</p>
      </section>
    </fieldset>}

    {result && <div role="radiogroup" aria-label="Elige tu bola al terminar el fitting">
      <p className={styles.subtle}>{BALL_FIT_HANDICAP_LABELS[input.handicapSource || "UNKNOWN"]}{input.handicap === null ? "" : `: ${input.handicap}`}</p>
      <BallFitResults
        result={result}
        catalog={displayCatalog}
        current={currentCatalogBall}
        selectedCatalogBallId={resultChoice?.action === "RECOMMENDATION" ? resultChoice.catalogBallId : null}
        currentBallCatalogId={storedCurrentCatalogBall?.id || currentBall?.catalogBallId || null}
        onSelect={(catalogBallId) => { setMessage(""); setResultChoice({ action: "RECOMMENDATION", catalogBallId }); }}
        keepCurrent={storedCurrentBall ? {
          brand: explicitCurrentBall?.brand || storedCurrentBall.ballBrand,
          model: explicitCurrentBall?.model || storedCurrentBall.ballModel,
          catalogBall: storedCurrentCatalogBall,
          selected: resultChoice?.action === "KEEP_CURRENT",
          onSelect: () => { setMessage(""); setResultChoice({ action: "KEEP_CURRENT" }); },
        } : undefined}
      />
    </div>}
    {calculating && <div className={styles.loadingState} role="status">Analizando tus preferencias…</div>}
    {message && <div className={styles.formMessage} role="alert">{message}</div>}
    {message === DRAFT_SAVE_ERROR && <button type="button" className="textButton" onClick={exitWithoutSaving}>Salir sin guardar</button>}
    <div className={styles.wizardActions}>
      <button type="button" className="secondary" onClick={previous} disabled={calculating || (!result && step === 0)}>← Anterior</button>
      {!result && step < 5 && <button type="button" className="primary" onClick={next} disabled={calculating}>Siguiente →</button>}
      {!result && step === 5 && <button type="button" className="primary" onClick={() => calculate()} disabled={calculating}>{calculating ? "Evaluando…" : "Ver mi Top 3"}</button>}
      {result && result.recommendations.length > 0 && <button type="button" className="primary" onClick={finish} disabled={!resultChoice}>Guardar elección y terminar</button>}
    </div>
    <BottomBackAction label="Guardar y salir" onBack={saveAndClose} />
  </div>;
}

function fact(value: QualitativeLevel | null) {
  return value ? LEVEL_LABELS[value] : "Sin dato";
}

function technicalFact(value: string | number | null | undefined, suffix = "") {
  return value === null || value === undefined || value === "" ? "Sin dato" : `${value}${suffix}`;
}

export function BallFitResults({ result, catalog, current, selectedCatalogBallId, currentBallCatalogId, onSelect, keepCurrent }: {
  result: BallFitResult;
  catalog: readonly GolfBallCatalog[];
  current: GolfBallCatalog | null;
  selectedCatalogBallId?: string | null;
  currentBallCatalogId?: string | null;
  onSelect?: (catalogBallId: string) => void;
  keepCurrent?: {
    brand: string;
    model: string;
    catalogBall: GolfBallCatalog | null;
    selected: boolean;
    onSelect: () => void;
  };
}) {
  if (!result.recommendations.length) return <section className={styles.emptyState}><b>Aún no hay una comparación suficiente</b><p>{result.warnings[0] || "Agrega dos preferencias comparables y vuelve a intentar."}</p></section>;
  const recommendationCatalog = result.recommendations.map((item) => catalog.find((ball) => ball.id === item.catalogBallId) || null);
  return <>
    <div className={styles.resultGrid}>{result.recommendations.map((recommendation) => {
      const catalogBall = catalog.find((ball) => ball.id === recommendation.catalogBallId);
      const selected = selectedCatalogBallId === recommendation.catalogBallId;
      const card = <article className={`${styles.recommendation} ${selected ? styles.resultSelected : ""}`} key={recommendation.catalogBallId}>
        {onSelect && <span className={styles.resultSelectionIndicator} aria-hidden="true">{selected ? "✓" : "○"}</span>}
        <div className={styles.recommendationMedia}><CatalogProductMedia item={catalogBall} fallback={<BackyardIcon name="ball" size={56} />} /></div>
        <span className={styles.rank}>#{recommendation.rank}</span>
        <h3>{recommendation.brand} {recommendation.model}</h3>
        {currentBallCatalogId === recommendation.catalogBallId && <p className={styles.currentRecommendation}>TU BOLA ACTUAL · TAMBIÉN RECOMENDADA</p>}
        {recommendation.generation && <p className={styles.subtle}>{recommendation.generation}</p>}
        <span className={styles.matchBadge}>Match {recommendation.matchScore}%</span>
        <ul className={styles.whyList}>{recommendation.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className={styles.verifiedFacts}>
          <span>Vuelo<b>{fact(recommendation.attributes.flight)}</b></span>
          <span>Feel<b>{fact(recommendation.attributes.feel)}</b></span>
          <span>Spin driver<b>{fact(recommendation.attributes.driverSpin)}</b></span>
          <span>Spin hierros<b>{fact(recommendation.attributes.ironSpin)}</b></span>
          <span>Spin short game<b>{fact(recommendation.attributes.shortGameSpin)}</b></span>
          <span>Precio<b>{recommendation.attributes.priceTier ? PRICE_RESULT_LABELS[recommendation.attributes.priceTier] : "Sin dato"}</b></span>
          <span>Construcción<b>{technicalFact(catalogBall?.construction)}</b></span>
          <span>Cubierta<b>{technicalFact(catalogBall?.coverMaterial)}</b></span>
          <span>Compresión<b>{technicalFact(catalogBall?.compression)}</b></span>
        </div>
        <p className={styles.comparisonNote}><b>Frente a tu bola actual:</b> {recommendation.comparisonToCurrent.join(" ")}</p>
      </article>;
      return onSelect ? <div className={styles.recommendationChoice} key={recommendation.catalogBallId}>
        <input type="radio" name="ball-fit-result-choice" aria-label={`Elegir ${recommendation.brand} ${recommendation.model}`} checked={selected} onChange={() => onSelect(recommendation.catalogBallId)} />
        {card}
      </div> : card;
    })}</div>

    {keepCurrent && <div className={`${styles.currentBallChoice} ${keepCurrent.selected ? styles.resultSelected : ""}`}>
      <input type="radio" name="ball-fit-result-choice" aria-label="Conservar mi bola actual" checked={keepCurrent.selected} onChange={keepCurrent.onSelect} />
      <span className={styles.resultSelectionIndicator} aria-hidden="true">{keepCurrent.selected ? "✓" : "○"}</span>
      <div className={styles.currentBallChoiceMedia}><CatalogProductMedia item={keepCurrent.catalogBall} fallback={<BallFitBallVisual />} /></div>
      <div><small>TU BOLA ACTUAL</small><h3>{keepCurrent.brand} {keepCurrent.model}</h3>{catalogEditionLabel(keepCurrent.catalogBall) && <p className={styles.subtle}>{catalogEditionLabel(keepCurrent.catalogBall)}</p>}<b>{keepCurrent.selected ? "✓ Conservar mi bola actual" : "Conservar mi bola actual"}</b></div>
    </div>}

    <div className={styles.comparisonTable} aria-label="Comparar bolas recomendadas"><table><thead><tr><th>Atributo</th><th>Actual</th>{result.recommendations.map((item) => <th key={item.catalogBallId}>{item.brand} {item.model}</th>)}</tr></thead><tbody>
      {(["flight", "feel", "driverSpin", "ironSpin", "shortGameSpin"] as const).map((attribute) => <tr key={attribute}><th>{attribute === "flight" ? "Vuelo" : attribute === "feel" ? "Feel" : attribute === "driverSpin" ? "Spin driver" : attribute === "ironSpin" ? "Spin hierros" : "Spin short game"}</th><td>{fact(current?.[attribute] || null)}</td>{result.recommendations.map((item) => <td key={item.catalogBallId}>{fact(item.attributes[attribute])}</td>)}</tr>)}
      <tr><th>Construcción</th><td>{technicalFact(current?.construction)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.construction)}</td>)}</tr>
      <tr><th>Cubierta</th><td>{technicalFact(current?.coverMaterial)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.coverMaterial)}</td>)}</tr>
      <tr><th>Compresión</th><td>{technicalFact(current?.compression)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.compression)}</td>)}</tr>
      <tr><th>Precio</th><td>{current?.priceTier ? PRICE_RESULT_LABELS[current.priceTier] : "Sin dato"}</td>{result.recommendations.map((item) => <td key={item.catalogBallId}>{item.attributes.priceTier ? PRICE_RESULT_LABELS[item.attributes.priceTier] : "Sin dato"}</td>)}</tr>
    </tbody></table></div>
    {result.warnings.map((warning) => <p className={styles.disclaimer} key={warning}>{warning}</p>)}
    <p className={styles.disclaimer}>{BACKYARD_BALL_FIT_DISCLAIMER}</p>
  </>;
}
