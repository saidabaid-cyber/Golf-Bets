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
  type BallFitCatalogScope,
} from "../../lib/ball-fitting-api";
import { loadBallFitDraft, removeBallFitDraft, saveBallFitDraft, type BallFitDraft } from "../../lib/ball-fitting-storage";
import type { GolfBallCatalog, PlayerBall, QualitativeLevel } from "../../lib/golf-equipment";
import { LaunchMonitorCapture } from "./launch-monitor-capture";
import styles from "./equipment.module.css";

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

const LEVEL_LABELS: Record<QualitativeLevel, string> = {
  VERY_LOW: "Muy bajo",
  LOW: "Bajo",
  MID: "Medio",
  HIGH: "Alto",
  VERY_HIGH: "Muy alto",
};

const PRICE_RESULT_LABELS = { ECONOMY: "Económica", MID: "Media", PREMIUM: "Premium" } as const;
const DRAFT_SAVE_ERROR = "No pudimos guardar este borrador en el dispositivo. Mantén esta pantalla abierta o libera espacio antes de salir.";
const FIT_REQUEST_ERROR = "No pudimos evaluar el catálogo completo. Revisa tu conexión e inténtalo de nuevo; no mostramos rankings parciales.";

function defaultInput(userId: string, handicap: number | null, currentBallId: string | null, defaults?: BallFitProfileDefaults): BallFitInput {
  return {
    userId,
    currentBallId,
    handicap,
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

function optionalNumber(value: string, minimum: number, maximum: number) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function OptionGrid<T extends string>({ values, labels, selected, onSelect }: {
  values: readonly T[];
  labels: Record<T, string>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  return <div className={styles.optionGrid}>{values.map((value) => <button key={value} type="button" className={`${styles.optionButton} ${selected === value ? styles.selected : ""}`} aria-pressed={selected === value} onClick={() => onSelect(value)}>{labels[value]}</button>)}</div>;
}

type BallFitWizardProps = {
  userId: string;
  defaultHandicap: number | null;
  profileDefaults?: BallFitProfileDefaults;
  currentBall: PlayerBall | null;
  catalog: readonly GolfBallCatalog[];
  onCancel: () => void;
  onComplete: (result: BallFitResult, input: BallFitInput) => boolean | void;
};

export function BallFitWizard({ userId, defaultHandicap, profileDefaults, currentBall, catalog, onCancel, onComplete }: BallFitWizardProps) {
  const [input, setInput] = useState<BallFitInput>(() => defaultInput(userId, defaultHandicap, currentBall?.catalogBallId || null, profileDefaults));
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [savedDraft, setSavedDraft] = useState<BallFitDraft | null>(null);
  const [draftChoicePending, setDraftChoicePending] = useState(false);
  const [result, setResult] = useState<BallFitResult | null>(null);
  const [resultCatalog, setResultCatalog] = useState<GolfBallCatalog[]>([]);
  const [catalogScope, setCatalogScope] = useState<BallFitCatalogScope | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const displayCatalog = useMemo(() => [...new Map([...catalog, ...resultCatalog].map((ball) => [ball.id, ball])).values()], [catalog, resultCatalog]);
  const activeBalls = useMemo(() => catalog.filter((ball) => ball.active), [catalog]);
  const currentCatalogBall = input.currentBallId ? displayCatalog.find((ball) => ball.id === input.currentBallId) || null : null;

  useEffect(() => {
    const saved = loadBallFitDraft(localStorage, userId);
    if (saved) {
      setSavedDraft(saved);
      setDraftChoicePending(true);
    }
    setHydrated(true);
  }, [userId]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (!hydrated || draftChoicePending) return;
    const saved = saveBallFitDraft(localStorage, input, Math.min(step, 6));
    setMessage((current) => saved
      ? current === DRAFT_SAVE_ERROR ? "" : current
      : DRAFT_SAVE_ERROR);
  }, [draftChoicePending, hydrated, input, step]);

  function resumeSavedDraft() {
    if (!savedDraft) return;
    setInput(savedDraft.input);
    setStep(Math.min(savedDraft.step, 5));
    setResult(null);
    setResultCatalog([]);
    setCatalogScope(null);
    setDraftChoicePending(false);
  }

  function startNewFit() {
    removeBallFitDraft(localStorage, userId);
    setInput(defaultInput(userId, defaultHandicap, currentBall?.catalogBallId || null, profileDefaults));
    setStep(0);
    setResult(null);
    setSavedDraft(null);
    setDraftChoicePending(false);
  }

  function patchInput(values: Partial<BallFitInput>) {
    setInput((current) => ({ ...current, ...values, userId }));
  }

  function next() {
    setMessage("");
    setStep((current) => Math.min(5, current + 1));
  }

  function previous() {
    setMessage("");
    if (result) { setResult(null); setResultCatalog([]); setCatalogScope(null); setStep(5); return; }
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

  async function calculate() {
    if (calculating) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setCalculating(true);
    setMessage("");
    try {
      const transportInput = createBallFitTransportInput(input);
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
          setMessage("El catálogo creció más allá del alcance seguro de esta versión. No se calculó un ranking parcial.");
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
      setCatalogScope(fit.scope);
      setStep(6);
      if (!saveBallFitDraft(localStorage, input, 6)) setMessage(DRAFT_SAVE_ERROR);
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
    if (!saveBallFitDraft(localStorage, input, Math.min(step, 6))) {
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
    const completed = onComplete(result, input);
    if (completed !== false) removeBallFitDraft(localStorage, userId);
  }

  const progress = result ? 100 : Math.round(((step + 1) / 6) * 100);
  const completeness = getBallFitInputCompleteness(input);

  if (!hydrated) return <div className={styles.loadingState} role="status">Recuperando tu Ball Fit…</div>;

  if (draftChoicePending && savedDraft) return <div className={styles.wizard}>
    <div className={styles.wizardHeader}><div><div className="eyebrow">THE BACKYARD BALL FIT</div><h2>Tienes un fitting en progreso</h2><p>Guardado {new Date(savedDraft.updatedAt).toLocaleString("es-MX")}</p></div><button type="button" className="textButton" onClick={onCancel}>Cerrar</button></div>
    <section className={styles.questionBlock}><h3>¿Quieres continuar o empezar de nuevo?</h3><p>Reanudar conserva exactamente tus respuestas anteriores. Empezar nuevo precarga el HCP y la bola actuales del perfil.</p></section>
    <div className={styles.wizardActions}><button type="button" className="secondary" onClick={startNewFit}>Empezar nuevo</button><button type="button" className="primary" onClick={resumeSavedDraft}>Reanudar fitting</button></div>
  </div>;

  return <div className={styles.wizard}>
    <div className={styles.wizardHeader}><div><div className="eyebrow">THE BACKYARD BALL FIT</div><h2>{result ? "Tu mejor grupo de bolas" : `Paso ${step + 1} de 6`}</h2><p>{result ? `Afinidad orientativa · señales comparables ${result.inputCompleteness}%` : "2–4 minutos · puedes guardar y regresar"}</p></div><button type="button" className="textButton" onClick={saveAndClose}>Guardar y regresar</button></div>
    <div className={styles.progressTrack} aria-label={`${progress}% del fitting`}><span style={{ width: `${progress}%` }} /></div>

    {!result && step === 0 && <section className={styles.questionBlock}>
      <h3>Tu juego actual</h3>
      <p>Usamos tu HCP capturado si existe. No lo interpretamos como un índice oficial.</p>
      {currentBall && <div className={styles.ballHero}><span className={styles.ballGlyph}>●</span><div><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3><p>Bola actual guardada{currentBall.catalogBallId ? " · disponible para comparación verificada" : " · modelo manual"}</p></div></div>}
      <label>Bola actual para comparar (opcional)<select value={input.currentBallId || ""} onChange={(event) => patchInput({ currentBallId: event.target.value || null })}><option value="">Sin bola fija / no aparece</option>{activeBalls.map((ball) => <option key={ball.id} value={ball.id}>{ball.brand} {ball.model}{ball.generation ? ` · ${ball.generation}` : ""}</option>)}</select></label>
      <p className={styles.subtle}>Esta lista es sólo para indicar tu bola actual. Al calcular, el servidor evalúa el catálogo activo completo o cancela sin mostrar un ranking parcial.</p>
      <div className="grid2"><label>HCP manual (opcional)<input type="number" inputMode="decimal" min={-20} max={54} step="0.1" value={input.handicap ?? ""} onChange={(event) => patchInput({ handicap: optionalNumber(event.target.value, -20, 54) })} placeholder="8.4" /></label><label>Score típico (opcional)<input type="number" inputMode="numeric" min={40} max={200} value={input.typicalScore ?? ""} onChange={(event) => patchInput({ typicalScore: optionalNumber(event.target.value, 40, 200) })} placeholder="86" /></label></div>
    </section>}

    {!result && step === 1 && <section className={styles.questionBlock}>
      <h3>Driver</h3><p>La velocidad es opcional. Nunca inferimos una compresión no publicada a partir de este dato.</p>
      <label>¿Cuánto pegas aproximadamente con driver? (yardas, opcional)<input type="number" inputMode="numeric" min={50} max={500} value={input.driverDistanceYards ?? ""} onChange={(event) => patchInput({ driverDistanceYards: optionalNumber(event.target.value, 50, 500) })} placeholder="Ej. 245" /></label>
      <h4>Velocidad de swing con driver</h4><OptionGrid values={SWING_SPEED_BANDS} labels={SPEED_LABELS} selected={input.swingSpeedBand} onSelect={(value) => patchInput({ swingSpeedBand: value })} />
      <LaunchMonitorCapture userId={userId} value={input.launchMonitorSession} onChange={(launchMonitorSession) => patchInput({ launchMonitorSession })} />
    </section>}

    {!result && step === 2 && <section className={styles.questionBlock}>
      <h3>Feel y vuelo</h3><p>Elige lo que prefieres sentir y ver; “No sé” también es una respuesta válida.</p>
      <h4>¿Cómo prefieres sentir la bola?</h4><OptionGrid values={BALL_FEEL_PREFERENCES} labels={FEEL_LABELS} selected={input.feelPreference} onSelect={(value) => patchInput({ feelPreference: value })} />
      <h4>Trayectoria preferida</h4><OptionGrid values={BALL_TRAJECTORY_PREFERENCES} labels={TRAJECTORY_LABELS} selected={input.trajectoryPreference} onSelect={(value) => patchInput({ trajectoryPreference: value })} />
    </section>}

    {!result && step === 3 && <section className={styles.questionBlock}>
      <h3>Approach y green</h3><p>Esto ayuda a ponderar control de hierros y juego corto cuando el fabricante sí publica esos atributos.</p>
      <h4>Tus greens normalmente son</h4><OptionGrid values={GREEN_FIRMNESS_OPTIONS} labels={GREEN_LABELS} selected={input.greenFirmness} onSelect={(value) => patchInput({ greenFirmness: value })} />
      <h4>En tiros de aproximación normalmente</h4><OptionGrid values={APPROACH_BEHAVIORS} labels={APPROACH_LABELS} selected={input.approachBehavior} onSelect={(value) => patchInput({ approachBehavior: value })} />
      <h4>¿Quieres más control / spin alrededor del green?</h4><OptionGrid values={YES_NO_UNKNOWN} labels={YES_NO_LABELS} selected={input.wantsGreensideSpin} onSelect={(value) => patchInput({ wantsGreensideSpin: value })} />
    </section>}

    {!result && step === 4 && <section className={styles.questionBlock}>
      <h3>¿Qué quieres mejorar?</h3><p>Selecciona y ordena tus prioridades. Las primeras pesan más, siempre dentro de atributos verificados.</p>
      <div className={styles.optionGrid}>{BALL_FIT_PRIORITIES.map((priority) => <button key={priority} type="button" className={`${styles.optionButton} ${input.priorities.includes(priority) ? styles.selected : ""}`} aria-pressed={input.priorities.includes(priority)} onClick={() => togglePriority(priority)}>{PRIORITY_LABELS[priority]}</button>)}</div>
      {input.priorities.length > 0 && <div className={styles.priorityList} aria-label="Prioridades ordenadas">{input.priorities.map((priority, index) => <div className={styles.priorityItem} key={priority}><span>{index + 1}</span><b>{PRIORITY_LABELS[priority]}</b><div><button type="button" disabled={index === 0} aria-label={`Subir ${PRIORITY_LABELS[priority]}`} onClick={() => movePriority(priority, -1)}>↑</button><button type="button" disabled={index === input.priorities.length - 1} aria-label={`Bajar ${PRIORITY_LABELS[priority]}`} onClick={() => movePriority(priority, 1)}>↓</button></div></div>)}</div>}
      <p className={styles.subtle}>Distancia con driver y estabilidad se guardan como contexto. No elevan un Match Score por sí solas porque el catálogo no contiene una medición de laboratorio comparable y verificada para esas metas.</p>
    </section>}

    {!result && step === 5 && <section className={styles.questionBlock}>
      <h3>Precio y color</h3><p>Último paso. Estas preferencias no reemplazan el desempeño que priorizaste.</p>
      <h4>¿Qué tanto importa el precio?</h4><OptionGrid values={BALL_FIT_PRICE_PREFERENCES} labels={PRICE_LABELS} selected={input.pricePreference} onSelect={(value) => patchInput({ pricePreference: value })} />
      <h4>Color preferido</h4><OptionGrid values={BALL_COLOR_PREFERENCES} labels={COLOR_LABELS} selected={input.colorPreference} onSelect={(value) => patchInput({ colorPreference: value })} />
      <p className={styles.subtle}>Completitud de respuestas: {completeness}%. El recomendador puede dar una coincidencia parcial, pero necesita al menos dos preferencias comparables.</p>
    </section>}

    {result && <BallFitResults result={result} catalog={displayCatalog} current={currentCatalogBall} catalogScope={catalogScope} />}
    {calculating && <div className={styles.loadingState} role="status">Evaluando el catálogo completo disponible…</div>}
    {message && <div className={styles.formMessage} role="alert">{message}</div>}
    {message === DRAFT_SAVE_ERROR && <button type="button" className="textButton" onClick={exitWithoutSaving}>Salir sin guardar</button>}
    <div className={styles.wizardActions}>
      <button type="button" className="secondary" onClick={previous} disabled={calculating || (!result && step === 0)}>← Anterior</button>
      {!result && step < 5 && <button type="button" className="primary" onClick={next} disabled={calculating}>Siguiente →</button>}
      {!result && step === 5 && <button type="button" className="primary" onClick={calculate} disabled={calculating}>{calculating ? "Evaluando…" : "Ver mi Top 3"}</button>}
      {result && result.recommendations.length > 0 && <button type="button" className="primary" onClick={finish}>Guardar resultado</button>}
    </div>
  </div>;
}

function fact(value: QualitativeLevel | null) {
  return value ? LEVEL_LABELS[value] : "Sin dato verificado";
}

function technicalFact(value: string | number | null | undefined, suffix = "") {
  return value === null || value === undefined || value === "" ? "Sin dato verificado" : `${value}${suffix}`;
}

export function BallFitResults({ result, catalog, current, catalogScope = null }: { result: BallFitResult; catalog: readonly GolfBallCatalog[]; current: GolfBallCatalog | null; catalogScope?: BallFitCatalogScope | null }) {
  if (!result.recommendations.length) return <section className={styles.emptyState}><b>Aún no hay una comparación suficiente</b><p>{result.warnings[0] || "Agrega dos preferencias comparables y vuelve a intentar."}</p></section>;
  const recommendationCatalog = result.recommendations.map((item) => catalog.find((ball) => ball.id === item.catalogBallId) || null);
  return <>
    {catalogScope && <p className={styles.subtle}>Se evaluó el catálogo activo completo disponible: {catalogScope.evaluatedCandidateCount} modelo(s). No se usó una primera página recortada.</p>}
    <div className={styles.resultGrid}>{result.recommendations.map((recommendation) => {
      const catalogBall = catalog.find((ball) => ball.id === recommendation.catalogBallId);
      return <article className={styles.recommendation} key={recommendation.catalogBallId}>
        <span className={styles.rank}>#{recommendation.rank}</span>
        <h3>{recommendation.brand} {recommendation.model}</h3>
        {recommendation.generation && <p className={styles.subtle}>{recommendation.generation}</p>}
        <span className={styles.matchBadge}>Match {recommendation.matchScore}% · datos {recommendation.dataCoverage}%</span>
        <ul className={styles.whyList}>{recommendation.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className={styles.verifiedFacts}>
          <span>Vuelo<b>{fact(recommendation.attributes.flight)}</b></span>
          <span>Feel<b>{fact(recommendation.attributes.feel)}</b></span>
          <span>Spin driver<b>{fact(recommendation.attributes.driverSpin)}</b></span>
          <span>Spin hierros<b>{fact(recommendation.attributes.ironSpin)}</b></span>
          <span>Spin short game<b>{fact(recommendation.attributes.shortGameSpin)}</b></span>
          <span>Precio<b>{recommendation.attributes.priceTier ? PRICE_RESULT_LABELS[recommendation.attributes.priceTier] : "Sin dato verificado"}</b></span>
        </div>
        <p className={styles.comparisonNote}><b>Frente a tu bola actual:</b> {recommendation.comparisonToCurrent.join(" ")}</p>
        {catalogBall?.officialUrl && <a className="textButton" href={catalogBall.officialUrl} target="_blank" rel="noreferrer">Ver ficha oficial ↗</a>}
      </article>;
    })}</div>

    <div className={styles.comparisonTable} aria-label="Comparar bolas recomendadas"><table><thead><tr><th>Atributo</th><th>Actual</th>{result.recommendations.map((item) => <th key={item.catalogBallId}>{item.brand} {item.model}</th>)}</tr></thead><tbody>
      {(["flight", "feel", "driverSpin", "ironSpin", "shortGameSpin"] as const).map((attribute) => <tr key={attribute}><th>{attribute === "flight" ? "Vuelo" : attribute === "feel" ? "Feel" : attribute === "driverSpin" ? "Spin driver" : attribute === "ironSpin" ? "Spin hierros" : "Spin short game"}</th><td>{fact(current?.[attribute] || null)}</td>{result.recommendations.map((item) => <td key={item.catalogBallId}>{fact(item.attributes[attribute])}</td>)}</tr>)}
      <tr><th>Construcción</th><td>{technicalFact(current?.construction)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.construction)}</td>)}</tr>
      <tr><th>Cubierta</th><td>{technicalFact(current?.coverMaterial)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.coverMaterial)}</td>)}</tr>
      <tr><th>Compresión</th><td>{technicalFact(current?.compression)}</td>{recommendationCatalog.map((ball, index) => <td key={result.recommendations[index].catalogBallId}>{technicalFact(ball?.compression)}</td>)}</tr>
      <tr><th>Precio</th><td>{current?.priceTier ? PRICE_RESULT_LABELS[current.priceTier] : "Sin dato verificado"}</td>{result.recommendations.map((item) => <td key={item.catalogBallId}>{item.attributes.priceTier ? PRICE_RESULT_LABELS[item.attributes.priceTier] : "Sin dato verificado"}</td>)}</tr>
    </tbody></table></div>
    {result.warnings.map((warning) => <p className={styles.disclaimer} key={warning}>{warning}</p>)}
    <p className={styles.disclaimer}>{BACKYARD_BALL_FIT_DISCLAIMER}</p>
  </>;
}
