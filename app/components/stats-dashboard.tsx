"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildGolfInsights, type GolfInsights, type ScoredRoundInsight } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";
import { buildFilteredGolfInsights, buildGolfTrends, filterStatsRounds, type StatsWindow } from "../../features/stats/domain";
import { structuredGolfInsightInput, type GolfInsightExplanation } from "../../features/ai/insights";
import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";
import { golfCaptureStatistics } from "../../lib/golf-capture-statistics";
import { golfStatsSelection } from "../../lib/golf-stats-navigation";
import { ownCareerHistory } from "../../lib/career-statistics";
import { recordProductEvent } from "../../features/analytics/client";

export type StatsCategory = "summary" | "scoring" | "putting" | "driving" | "approach";
export type StatsDashboardProps = {
  initialCategory?: StatsCategory;
  insights: GolfInsights;
  rounds?: RoundSnapshot[];
  consentOwnerId?: string;
  accessToken?: string | null;
  requiresRemoteConsent?: boolean;
  onOpenHistory: () => void;
  onOpenRound: (roundId: string) => void;
};

function decimal(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

function relative(value: number | undefined) {
  if (value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "E";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function money(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}$${Math.abs(rounded).toLocaleString("es-MX")}`;
}

function percentage(hit: number, attempts: number) {
  return attempts ? `${Math.round((hit / attempts) * 100)}%` : "—";
}

function roundDate(value: string) {
  const date = new Date(`${value}T12:00:00-06:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(date);
}

type TrendMode = "gross" | "relative";
const NO_SCORED_ROUNDS: ScoredRoundInsight[] = [];

function trendValue(round: ScoredRoundInsight, mode: TrendMode) {
  return mode === "gross" ? round.gross : round.relativeToPar;
}

function trendValueLabel(round: ScoredRoundInsight, mode: TrendMode) {
  if (mode === "gross") return `${round.gross} golpes`;
  if (round.relativeToPar === 0) return "par";
  return `${round.relativeToPar > 0 ? "+" : ""}${round.relativeToPar} contra par`;
}

function initialScoreScope(insights: GolfInsights): 9 | 18 {
  if (insights.scoreScopeHoles && insights.scoreCohorts[insights.scoreScopeHoles]) return insights.scoreScopeHoles;
  return insights.scoreCohorts[18] ? 18 : 9;
}

function TrendChart({ rounds, mode }: { rounds: ScoredRoundInsight[]; mode: TrendMode }) {
  const ordered = rounds.slice(0, 10).reverse();
  if (!ordered.length) return <p className="betaDataNote">No hay rondas comparables para mostrar la evolución.</p>;
  const values = ordered.map((round) => trendValue(round, mode));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(1, high - low);
  const points = ordered.map((round, index) => ({
    round,
    value: trendValue(round, mode),
    x: ordered.length === 1 ? 150 : 18 + (index * 264) / (ordered.length - 1),
    y: 77 - ((trendValue(round, mode) - low) / range) * 62,
  }));
  const metricLabel = mode === "gross" ? "score bruto" : "resultado contra par";

  return <div className="betaTrendChart">
    <svg viewBox="0 0 300 94" aria-hidden="true" focusable="false">
      <path className="betaTrendGuide" d="M18 15H282M18 46H282M18 77H282" />
      {points.length > 1 && <polyline className="betaTrendLine" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />}
      {points.map((point) => <g key={point.round.id}><circle className="betaTrendPoint" cx={point.x} cy={point.y} r="4" /><text x={point.x} y={Math.max(10, point.y - 8)} textAnchor="middle">{mode === "gross" ? point.value : relative(point.value)}</text></g>)}
    </svg>
    <ol className="srOnly" aria-label={`Datos de evolución de ${metricLabel}`}>
      {ordered.map((round) => <li key={round.id}>{roundDate(round.date)}, {round.courseName}: {trendValueLabel(round, mode)}</li>)}
    </ol>
    <div className="betaTrendDates">{ordered.map((round) => <span key={round.id} title={`${round.courseName} · ${trendValueLabel(round, mode)}`}>{roundDate(round.date)}</span>)}</div>
  </div>;
}

function CaptureRateTrend({ rows, kind }: { rows: ReturnType<typeof golfCaptureStatistics>["series"]; kind: "fir" | "gir" }) {
  const sample = rows.filter(row => (kind === "fir" ? row.firAttempts : row.girAttempts) > 0).slice(0,10).reverse();
  if (!sample.length) return null;
  const attempts = (row: typeof sample[number]) => kind === "fir" ? row.firAttempts : row.girAttempts;
  const hits = (row: typeof sample[number]) => kind === "fir" ? row.firHits : row.girHits;
  return <section className="golfStatsPanel"><h2>{kind.toUpperCase()} por ronda</h2><div className="golfStatsPuttTrend" role="img" aria-label={sample.map(row=>`${roundDate(row.date)}: ${hits(row)} de ${attempts(row)} capturas`).join("; ")}>{sample.map(row=><div key={row.id}><b>{percentage(hits(row),attempts(row))}</b><i style={{height:`${Math.max(2,hits(row)/attempts(row)*80)}px`}}/><small>{roundDate(row.date)}</small><small>{hits(row)}/{attempts(row)}</small></div>)}</div><p>Porcentaje sobre capturas de cada tarjeta; los huecos no se cuentan como fallos.</p></section>;
}

export function StatsDashboard({ insights: suppliedInsights, initialCategory = "summary", rounds = [], consentOwnerId, accessToken, requiresRemoteConsent = false, onOpenHistory, onOpenRound }: StatsDashboardProps) {
  const [selection] = useState(() => golfStatsSelection(typeof window === "undefined" ? "" : window.location?.search ?? ""));
  const [category, setCategory] = useState<StatsCategory>(selection.view === "summary" ? initialCategory : selection.view);
  const [requestedScope, setRequestedScope] = useState<9 | 18 | undefined>(selection.scope);
  const [trendMode, setTrendMode] = useState<TrendMode>("gross");
  const [statsWindow, setStatsWindow] = useState<StatsWindow>(selection.window);
  const [courseFilter, setCourseFilter] = useState(selection.course);
  const [teeFilter, setTeeFilter] = useState(selection.tee);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiExplanation, setAiExplanation] = useState<GolfInsightExplanation | null>(null);
  const aiInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filters = useMemo(() => ({ window: statsWindow, ...(courseFilter ? { courseName: courseFilter } : {}), ...(teeFilter ? { teeName: teeFilter } : {}) }), [courseFilter, statsWindow, teeFilter]);
  const ownedRounds = useMemo(() => consentOwnerId ? ownCareerHistory(rounds, consentOwnerId) : rounds, [rounds, consentOwnerId]);
  const baseInsights = useMemo(() => rounds.length ? buildGolfInsights(ownedRounds) : suppliedInsights, [rounds.length, ownedRounds, suppliedInsights]);
  const scope = requestedScope ?? initialScoreScope(baseInsights);
  const scopedRounds = useMemo(() => { const eligible = new Set(baseInsights.recentRounds.filter(row => row.holeCount === scope).map(row => row.id)); return ownedRounds.filter(round => eligible.has(round.id)); }, [ownedRounds, scope, baseInsights]);
  const filteredRounds = useMemo(() => filterStatsRounds(scopedRounds, filters), [filters, scopedRounds]);
  const insights = useMemo(() => rounds.length ? buildFilteredGolfInsights(scopedRounds, filters) : suppliedInsights, [filters, rounds.length, scopedRounds, suppliedInsights]);
  const metricTrends = useMemo(() => buildGolfTrends(filteredRounds, Math.min(5, Math.max(3, Math.floor(filteredRounds.length / 2)))), [filteredRounds]);
  const courseOptions = useMemo(() => [...new Set(rounds.map((round) => round.courseName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es-MX")), [rounds]);
  const teeOptions = useMemo(() => [...new Set(rounds.flatMap((round) => [round.teeName, ...(round.playerTeeAssignments?.map((tee) => tee.teeName) ?? [])]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es-MX")), [rounds]);
  const insightInput = useMemo(() => structuredGolfInsightInput(insights, metricTrends), [insights, metricTrends]);
  useEffect(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location?.search ?? "").get("screen") !== "stats" || typeof window.history?.replaceState !== "function") return;
    const search = new URLSearchParams(window.location.search);
    search.set("statsView", category); search.set("statsPeriod", String(statsWindow)); search.set("statsHoles", String(scope));
    if (courseFilter) search.set("statsCourse", courseFilter); else search.delete("statsCourse");
    if (teeFilter) search.set("statsTee", teeFilter); else search.delete("statsTee");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`);
  }, [category, statsWindow, scope, courseFilter, teeFilter]);
  async function requestAiInsight() {
    if (aiInFlight.current) return;
    if (!consentOwnerId) { setAiMessage("Revisa tu autorización en Perfil → Cuenta y privacidad → Privacidad / IA."); return; }
    aiInFlight.current = true;
    setAiBusy(true); setAiMessage(""); setAiExplanation(null);
    try {
      const authority = accessToken ? await resolveAuthoritativeAiProcessingConsent({
        accessToken, userId: consentOwnerId, scope: AI_PROVIDER_PROCESSING_CONSENT, storage: browserAiProcessingConsentStorage(),
      }) : null;
      if (!mounted.current) return;
      const allowed = authority
        ? !authority.discarded && authority.active && !authority.pendingLocalRevocation
        : !requiresRemoteConsent && hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), consentOwnerId, AI_PROVIDER_PROCESSING_CONSENT);
      if (!allowed) { setAiMessage("Instrucciones Backyard AI está desactivado. Puedes autorizarlo en Perfil → Cuenta y privacidad → Privacidad / IA."); return; }
      const result = await requestBackyardAi<GolfInsightExplanation>("/api/backyard-ai/insights", { aggregates: insightInput, consent: backyardAiProviderConsent(AI_PROVIDER_PROCESSING_CONSENT) }, 30_000, accessToken);
      if (!mounted.current) return;
      setAiExplanation(result);
      void recordProductEvent({ eventId: `ai-insight-${crypto.randomUUID()}`, eventName: "ai_insight_viewed", accessToken, metadata: { source: "stats", quantity: 1 } });
    }
    catch { if (mounted.current) setAiMessage("No pude verificar la autorización o explicar esta muestra ahora. Tus estadísticas calculadas siguen intactas."); }
    finally { aiInFlight.current = false; if (mounted.current) setAiBusy(false); }
  }
  const scoreScopes = ([9, 18] as const).filter(holes => Boolean(baseInsights.scoreCohorts[holes]));
  const selectedCohort = insights.scoreCohorts[scope];
  const comparableRounds = selectedCohort?.recentRounds ?? NO_SCORED_ROUNDS;
  const facts = useMemo(() => golfCaptureStatistics(filteredRounds, comparableRounds, consentOwnerId), [filteredRounds, comparableRounds, consentOwnerId]);
  const capture = rounds.length ? insights.capture : selectedCohort?.recentRounds.reduce((total, row) => {
    if (!row.capture) return total;
    if (!total) return { ...row.capture, teeShots: { ...row.capture.teeShots } };
    for (const key of Object.keys(row.capture) as (keyof NonNullable<ScoredRoundInsight["capture"]>)[]) {
      if (key === "teeShots") for (const direction of Object.keys(total.teeShots) as (keyof typeof total.teeShots)[]) total.teeShots[direction] += row.capture.teeShots[direction];
      else total[key] += row.capture[key];
    }
    return total;
  }, undefined as ScoredRoundInsight["capture"]);
  const scopeLabel = `${scope} hoyos`;
  const completePuttTotals = comparableRounds.flatMap(round => round.putts === null ? [] : [round.putts]);
  const averagePutts = completePuttTotals.length ? completePuttTotals.reduce((sum, value) => sum + value, 0) / completePuttTotals.length : undefined;
  const scoringRows = [
    ["Eagle o mejor", "eagle", comparableRounds.reduce((sum, row) => sum + row.eaglesOrBetter, 0)],
    ["Birdies", "birdie", comparableRounds.reduce((sum, row) => sum + row.birdies, 0)],
    ["Pars", "par", comparableRounds.reduce((sum, row) => sum + row.pars, 0)],
    ["Bogeys", "bogey", comparableRounds.reduce((sum, row) => sum + row.bogeys, 0)],
    ["Dobles o peor", "double", comparableRounds.reduce((sum, row) => sum + row.doublesOrWorse, 0)],
  ] as const;
  const totalScoringHoles = scoringRows.reduce((sum, row) => sum + row[2], 0);
  const firHits = facts.firHits, firAttempts = facts.firAttempts;
  const girHits = facts.girHits, girAttempts = facts.girAttempts;
  const completePenaltyRounds = facts.series.filter(row => row.penaltyHoles === scope);
  const period = statsWindow === "SEASON" ? `Temporada ${new Date().getFullYear()}` : statsWindow === "ALL" ? "Histórico" : `Últimas ${statsWindow} rondas`;
  const categories = [["summary", "Resumen"], ["scoring", "Scoring"], ["putting", "Putting"], ["driving", "Driving"], ["approach", "Approach"]] as const;
  const emptyCapture = (name: string) => <div className="golfStatsEmpty"><h2>Aún no hay datos suficientes</h2><p>{name} · {period.toLocaleLowerCase("es-MX")} · {scopeLabel}.</p><small>Los campos sin capturar permanecen ausentes.</small></div>;
  const trend = <section className="golfStatsPanel betaTrendCard"><div className="sectionTitle"><div><h2>Evolución</h2><p>{trendMode === "gross" ? "Score bruto" : "Resultado vs par"} · {scopeLabel}</p></div><span>{comparableRounds.slice(0, 10).length} rondas</span></div><div className="segmented scopeFilters" role="group" aria-label="Métrica de evolución"><button type="button" className={trendMode === "gross" ? "active" : ""} aria-pressed={trendMode === "gross"} onClick={() => setTrendMode("gross")}>Gross</button><button type="button" className={trendMode === "relative" ? "active" : ""} aria-pressed={trendMode === "relative"} onClick={() => setTrendMode("relative")}>vs Par</button></div><TrendChart rounds={comparableRounds} mode={trendMode}/></section>;
  const tiles = <section className="betaStatTiles" aria-label="Estadísticas principales"><article><span>Promedio</span><b>{decimal(selectedCohort?.averageScore)}</b><small>gross · {scopeLabel}</small></article><article><span>Mejor score</span><b>{selectedCohort?.bestScore ?? "—"}</b><small>{scopeLabel}</small></article><article><span>vs par</span><b>{relative(selectedCohort?.averageVsPar)}</b><small>promedio</small></article><article><span>Campos</span><b>{new Set(comparableRounds.map(row => row.courseName)).size}</b><small>en la muestra</small></article></section>;
  const recent = <section className="golfStatsPanel betaRecentScores"><h2>Rondas recientes · {scopeLabel}</h2><div>{comparableRounds.slice(0, 5).map(round => <button type="button" key={round.id} onClick={() => onOpenRound(round.id)}><span><b>{round.courseName}</b><small>{roundDate(round.date)} · {round.teeName || "Tee sin nombre"}</small></span><strong>{round.gross}<small>{relative(round.relativeToPar)}</small></strong></button>)}</div></section>;
  return <section className="betaStatsScreen golfStats" aria-labelledby="beta-stats-title">
    <header className="golfStatsHeader"><h1 id="beta-stats-title">Mis estadísticas</h1><button type="button" onClick={onOpenHistory}>Rondas ›</button></header>
    <nav className="golfStatsTabs" aria-label="Categorías de estadísticas">{categories.map(([value, label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>)}</nav>
    <div className="golfStatsControls"><label>Período<select value={statsWindow} onChange={event => setStatsWindow(event.target.value === "ALL" || event.target.value === "SEASON" ? event.target.value : Number(event.target.value) as StatsWindow)}>{([[5,"Últimas 5 rondas"],[10,"Últimas 10 rondas"],[20,"Últimas 20 rondas"],["SEASON","Temporada"],["ALL","Histórico"]] as const).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{scoreScopes.length === 2 && <div className="segmented scopeFilters" role="group" aria-label="Formato de ronda para comparar">{scoreScopes.map(holes => <button type="button" key={holes} className={scope === holes ? "active" : ""} aria-pressed={scope === holes} onClick={() => setRequestedScope(holes)}>{holes} hoyos</button>)}</div>}<details><summary>Campo y tee</summary><div className="betaStatsFilterSelects"><label>Campo<select value={courseFilter} onChange={event => setCourseFilter(event.target.value)}><option value="">Todos</option>{courseOptions.map(course => <option key={course}>{course}</option>)}</select></label><label>Tee<select value={teeFilter} onChange={event => setTeeFilter(event.target.value)}><option value="">Todos</option>{teeOptions.map(tee => <option key={tee}>{tee}</option>)}</select></label></div></details></div>
    <p className="golfStatsSample">{selectedCohort?.rounds ?? 0} tarjetas completas · {scopeLabel} · {period}</p>
    {!selectedCohort ? <div className="golfStatsEmpty"><h2>{courseFilter || teeFilter ? "No hay rondas con estos filtros." : "Todavía no hay scores completos."}</h2><p>Tu histórico conserva todas tus rondas.</p><button type="button" onClick={() => { if (courseFilter || teeFilter) { setCourseFilter(""); setTeeFilter(""); } else onOpenHistory(); }}>{courseFilter || teeFilter ? "Limpiar filtros" : "Abrir histórico"}</button></div> : <>
      {(category === "summary" || category === "scoring") && <>{tiles}{trend}</>}
      {category === "summary" && <><div className="betaStatTiles golfStatsThree">{averagePutts !== undefined && <article><span>PUTTS</span><b>{decimal(averagePutts)}</b><small>{completePuttTotals.length} rondas completas</small></article>}{firAttempts > 0 && <article><span>FIR</span><b>{percentage(firHits,firAttempts)}</b><small>{firHits}/{firAttempts} capturas</small></article>}{girAttempts > 0 && <article><span>GIR</span><b>{percentage(girHits,girAttempts)}</b><small>{girHits}/{girAttempts} capturas</small></article>}</div>{recent}<details className="golfStatsPanel"><summary>Resultados personales del período</summary><p>{insights.betBalance === undefined ? "Sin liquidaciones verificables en el histórico." : `${money(insights.betBalance)} · ${insights.betRounds} rondas con resultado verificable.`}</p></details><details className="golfStatsPanel betaAiInsight"><summary>Explicación de mi juego</summary><p>La IA no recalcula scores, HCP, ganadores ni dinero. Consulta los agregados con tu autorización existente de privacidad.</p><button type="button" className="secondary" disabled={aiBusy || insightInput.sampleRounds < 1} onClick={requestAiInsight}>{aiBusy ? "Analizando…" : "Explicar mi juego"}</button>{aiExplanation && <div><b>{aiExplanation.summary}</b><ul>{aiExplanation.observations.map(observation => <li key={observation}>{observation}</li>)}</ul><small>{aiExplanation.caveat}</small></div>}{aiMessage && <p role="status">{aiMessage}</p>}</details></>}
      {category === "scoring" && <><section className="golfStatsPanel"><h2>Resultado por hoyo</h2><p>{totalScoringHoles} hoyos reales con score.</p><div className="golfStatsBars">{scoringRows.map(([label,result,count]) => <div key={result}><span><i className="golfStatsSymbol" data-result={result} aria-hidden="true"/>{label}</span><div aria-hidden="true"><i style={{width:`${totalScoringHoles ? count/totalScoringHoles*100 : 0}%`}}/></div><b>{count}<small>{percentage(count,totalScoringHoles)}</small></b></div>)}</div></section>{recent}</>}
      {category === "putting" && <>{facts.puttHoles || averagePutts !== undefined ? <><section className="golfStatsPanel"><h2>Putting</h2><div className="betaStatTiles golfStatsThree">{averagePutts !== undefined && <article><span>Putts por ronda</span><b>{decimal(averagePutts)}</b><small>{completePuttTotals.length} tarjetas completas</small></article>}{facts.puttHoles > 0 && <article><span>Putts por hoyo</span><b>{decimal(facts.putts/facts.puttHoles)}</b><small>{facts.puttHoles}/{facts.holes} hoyos capturados</small></article>}{facts.firstPuttHoles > 0 && <article><span>Primer putt</span><b>{decimal(facts.firstPuttFeet/facts.firstPuttHoles)}</b><small>pies · {facts.firstPuttHoles} capturas</small></article>}</div>{facts.puttHoles > 0 && <div className="golfStatsBars">{facts.puttDistribution.map((count,index) => <div key={index}><span>{index === 4 ? "4+ putts" : `${index} ${index === 1 ? "putt" : "putts"}`}</span><div aria-hidden="true"><i style={{width:`${count/facts.puttHoles*100}%`}}/></div><b>{count}<small>{percentage(count,facts.puttHoles)}</small></b></div>)}</div>}</section>{facts.series.some(row => row.putts !== null) && <section className="golfStatsPanel"><h2>Tendencia de putting</h2><div className="golfStatsPuttTrend" role="img" aria-label={facts.series.filter(row=>row.putts!==null).map(row=>`${roundDate(row.date)}: ${row.putts} putts`).join("; ")}>{facts.series.filter(row=>row.putts!==null).slice(0,10).reverse().map(row=><div key={row.id}><b>{row.putts}</b><i style={{height:`${Math.max(2,(row.putts??0)/Math.max(1,...facts.series.map(point=>point.putts??0))*80)}px`}}/><small>{roundDate(row.date)}</small></div>)}</div><p>Sólo tarjetas con putts en todos sus hoyos.</p></section>}</> : emptyCapture("Putts registrados")}</>}
      {category === "driving" && <>{firAttempts > 0 && <section className="golfStatsPanel golfStatsRate"><h2>Fairways</h2><div className="golfStatsRing" style={{background:`conic-gradient(var(--by-forest) ${firHits/firAttempts*100}%,var(--by-sage) 0)`}}><b>{percentage(firHits,firAttempts)}</b></div><p>{firHits} aciertos / {firAttempts} capturas · {facts.firEligible} hoyos aplicables</p><small>{facts.series.filter(row=>row.firAttempts>0).length} rondas con captura. Par 3 excluido.</small></section>}{capture && capture.teeShotHoles > 0 && <section className="golfStatsPanel" aria-label="Dirección de Tee Shot capturada"><h2>Dirección de salida</h2><p>Dirección de {capture.teeShotHoles} salidas capturadas.</p><div className="golfStatsBars" aria-label="Distribución de dirección de Tee Shot">{([["far_left","Muy izquierda"],["left","Izquierda"],["center","Centro"],["right","Derecha"],["far_right","Muy derecha"]] as const).map(([direction,label])=><div key={direction}><span>{label}</span><div aria-hidden="true"><i style={{width:`${capture.teeShots[direction]/capture.teeShotHoles*100}%`}}/></div><b>{capture.teeShots[direction]}</b></div>)}</div></section>}{facts.clubs.size > 0 && <section className="golfStatsPanel"><h2>Distancia por bastón</h2><p>Salidas registradas · yardas</p>{[...facts.clubs].map(([club,row])=><p key={club}><b>{club}</b> {decimal(row.totalYards/row.count)} yd · {row.count} capturas</p>)}</section>}<CaptureRateTrend rows={facts.series} kind="fir"/>{!firAttempts && !capture?.teeShotHoles && !facts.clubs.size && emptyCapture("FIR y dirección de salida")}</>}
      {category === "approach" && <>{girAttempts > 0 ? <section className="golfStatsPanel golfStatsRate"><h2>Greens en regulación</h2><div className="golfStatsRing" style={{background:`conic-gradient(var(--by-forest) ${girHits/girAttempts*100}%,var(--by-sage) 0)`}}><b>{percentage(girHits,girAttempts)}</b></div><p>{girHits} aciertos / {girAttempts} capturas explícitas</p><div className="betaStatTiles golfStatsThree">{[...facts.girByPar].sort(([a],[b])=>a-b).map(([par,row])=><article key={par}><span>Par {par}</span><b>{percentage(row.hits,row.attempts)}</b><small>{row.hits}/{row.attempts} capturas</small></article>)}</div></section> : emptyCapture("GIR capturado")}<CaptureRateTrend rows={facts.series} kind="gir"/>{(facts.penaltyHoles > 0 || capture && (capture.greenSideBunkerHoles+capture.fairwayBunkerHoles+capture.unclassifiedBunkerHoles+capture.outOfBoundsHoles)>0) && <section className="golfStatsPanel" aria-label="Bunkers y OB capturados"><h2>Bunkers y penalidades</h2><div className="betaStatTiles golfStatsThree">{facts.penaltyHoles>0&&<article><span>Penalidades</span><b>{facts.penalties}</b><small>{facts.penaltyHoles} hoyos capturados</small></article>}{capture?.greenSideBunkerHoles ? <article><span>Bunker de green</span><b>{capture.greenSideBunkers}</b><small>{capture.greenSideBunkerHoles} capturas</small></article>:null}{capture?.fairwayBunkerHoles ? <article><span>Bunker de fairway</span><b>{capture.fairwayBunkers}</b><small>{capture.fairwayBunkerHoles} capturas</small></article>:null}{capture?.unclassifiedBunkerHoles ? <article><span>Bunker sin clasificar</span><b>{capture.unclassifiedBunkers}</b><small>captura anterior · {capture.unclassifiedBunkerHoles} hoyos</small></article>:null}{capture?.outOfBoundsHoles ? <article><span>OB</span><b>{capture.outOfBounds}</b><small>{capture.outOfBoundsHoles} capturas</small></article>:null}</div>{completePenaltyRounds.length>0&&<p>Penalidades por ronda: <b>{decimal(completePenaltyRounds.reduce((sum,row)=>sum+row.penalties,0)/completePenaltyRounds.length)}</b> · {completePenaltyRounds.filter(row=>row.penalties>0).length}/{completePenaltyRounds.length} tarjetas con penalidades. Sólo captura completa de los {scope} hoyos.</p>}<small>OB no se suma a penalidades. No se infieren eventos desde el score.</small></section>}</>}
    </>}
    <details className="golfStatsAudit"><summary>Cómo se calcula esta muestra</summary><p>{period} · {scopeLabel}. {selectedCohort?.rounds ?? 0} tarjetas completas atribuibles a tu jugador. Primero se separa el formato; después se aplica el período y los filtros.</p><p>Scoring: gross y diferencia con par por hoyo real. Putts por ronda: todos los hoyos capturados; distribución: sólo los capturados, incluido cero. FIR: aciertos/capturas en par 4 y 5. GIR: aciertos/capturas explícitas; esta serie no reconstruye GIR desde un total. Penalidades y OB: hechos registrados, sin doble conteo.</p><p>Putts: {facts.puttHoles}/{facts.holes} hoyos. FIR: {firAttempts}/{facts.firEligible} aplicables. GIR: {girAttempts}/{facts.holes}. Penalidades: {facts.penaltyHoles}/{facts.holes}. Bastones: yardas; primer putt: pies. Sin tracking o estadísticas GPS inferidas.</p></details>
  </section>;
}
