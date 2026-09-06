"use client";

import { useState } from "react";

import type { GolfInsights, ScoredRoundInsight } from "../../lib/golf-insights";

export type StatsDashboardProps = {
  insights: GolfInsights;
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
    y: 15 + ((trendValue(round, mode) - low) / range) * 62,
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

export function StatsDashboard({ insights, onOpenHistory, onOpenRound }: StatsDashboardProps) {
  const [requestedScope, setRequestedScope] = useState<9 | 18>();
  const [trendMode, setTrendMode] = useState<TrendMode>("gross");
  const scoreScopes = ([9, 18] as const).filter((holes) => Boolean(insights.scoreCohorts[holes]));
  const preferredScope = requestedScope && insights.scoreCohorts[requestedScope]
    ? requestedScope
    : initialScoreScope(insights);
  const selectedCohort = insights.scoreCohorts[preferredScope]
    || insights.scoreCohorts[insights.scoreScopeHoles || 18]
    || insights.scoreCohorts[18]
    || insights.scoreCohorts[9];

  if (!insights.scoredRounds || !selectedCohort) {
    return <section className="betaStatsScreen" aria-labelledby="beta-stats-title">
      <section className="hero betaStatsHero"><div><span className="eyebrow">THE BACKYARD · STATS</span><h1 id="beta-stats-title">Tu juego, con datos reales.</h1><p>Las estadísticas se calculan únicamente con tarjetas completas.</p></div></section>
      <section className="card betaStatsEmpty"><span className="betaEmptyFlag" aria-hidden="true">↗</span><h2>Todavía no hay scores completos.</h2><p>{insights.rounds ? "Tus rondas guardadas siguen disponibles, pero aún no contienen una tarjeta completa para calcular estadísticas confiables." : "Cierra y guarda tu primera ronda para empezar a medir tu juego."}</p><button type="button" className="primary" onClick={onOpenHistory}>{insights.rounds ? "Revisar histórico" : "Abrir histórico"}</button></section>
    </section>;
  }

  const totalScoringHoles = insights.pars + insights.birdies + insights.eaglesOrBetter + insights.bogeys + insights.doublesOrWorse;
  const comparableRounds = selectedCohort.recentRounds;
  const scopeLabel = `${selectedCohort.holeCount} hoyos`;
  const completePuttTotals = comparableRounds.flatMap((round) => round.putts === null ? [] : [round.putts]);
  const averagePutts = completePuttTotals.length
    ? completePuttTotals.reduce((total, putts) => total + putts, 0) / completePuttTotals.length
    : undefined;
  const scoringRows = [
    ["Eagle o mejor", insights.eaglesOrBetter],
    ["Birdies", insights.birdies],
    ["Pars", insights.pars],
    ["Bogeys", insights.bogeys],
    ["Dobles +", insights.doublesOrWorse],
  ] as const;

  return <section className="betaStatsScreen" aria-labelledby="beta-stats-title">
    <section className="hero betaStatsHero"><div><span className="eyebrow">THE BACKYARD · STATS</span><h1 id="beta-stats-title">Así viene tu juego.</h1><p>Scores comparables con {selectedCohort.rounds} tarjeta{selectedCohort.rounds === 1 ? "" : "s"} completa{selectedCohort.rounds === 1 ? "" : "s"} de {scopeLabel}. Resultado por hoyo considera las {insights.scoredRounds} completas.</p></div><button type="button" className="secondary" onClick={onOpenHistory}>Ver histórico</button></section>

    {scoreScopes.length === 2 && <div className="segmented scopeFilters" role="group" aria-label="Formato de ronda para comparar">
      {scoreScopes.map((holes) => <button type="button" key={holes} className={selectedCohort.holeCount === holes ? "active" : ""} aria-pressed={selectedCohort.holeCount === holes} onClick={() => setRequestedScope(holes)}>{holes} hoyos <small>· {insights.scoreCohorts[holes]?.rounds}</small></button>)}
    </div>}

    <section className="betaStatTiles" aria-label="Estadísticas principales">
      <article><span>Promedio</span><b>{decimal(selectedCohort.averageScore)}</b><small>score bruto · {scopeLabel}</small></article>
      <article><span>Mejor score</span><b>{selectedCohort.bestScore ?? "—"}</b><small>{scopeLabel}</small></article>
      <article><span>vs par</span><b>{relative(selectedCohort.averageVsPar)}</b><small>promedio · {scopeLabel}</small></article>
      <article><span>Campos</span><b>{insights.coursesPlayed}</b><small>en histórico</small></article>
    </section>

    <section className="card betaTrendCard">
      <div className="sectionTitle"><div><h2>Evolución</h2><p>{trendMode === "gross" ? "Score bruto" : "Resultado vs par"} · {scopeLabel} · hasta las últimas 10 rondas</p></div><span className="betaStatsSample">{comparableRounds.slice(0, 10).length} rondas</span></div>
      <div className="segmented scopeFilters" role="group" aria-label="Métrica de evolución">
        <button type="button" className={trendMode === "gross" ? "active" : ""} aria-pressed={trendMode === "gross"} onClick={() => setTrendMode("gross")}>Gross</button>
        <button type="button" className={trendMode === "relative" ? "active" : ""} aria-pressed={trendMode === "relative"} onClick={() => setTrendMode("relative")}>vs Par</button>
      </div>
      <TrendChart rounds={comparableRounds} mode={trendMode} />
      <div className="betaAverageStrip"><span>Últimas 5 <b>{decimal(selectedCohort.last5Average)}</b></span><span>Últimas 10 <b>{decimal(selectedCohort.last10Average)}</b></span><span>Mejor vs par <b>{relative(selectedCohort.bestVsPar)}</b></span></div>
    </section>

    <section className="card betaScoringCard">
      <div className="sectionTitle"><div><h2>Resultado por hoyo</h2><p>{totalScoringHoles} hoyos con score válido.</p></div></div>
      <div className="betaScoringMix">{scoringRows.map(([label, count]) => {
        const percentage = totalScoringHoles ? (count / totalScoringHoles) * 100 : 0;
        return <div key={label}><span><b>{label}</b><small>{count} · {percentage.toFixed(0)}%</small></span><div aria-hidden="true"><i style={{ width: `${percentage}%` }} /></div></div>;
      })}</div>
    </section>

    <section className="betaSecondaryStats">
      <article className="card"><span className="eyebrow">APUESTAS REGISTRADAS</span><b className={insights.betBalance === undefined ? "" : insights.betBalance >= 0 ? "good" : "bad"}>{insights.betBalance === undefined ? "—" : money(insights.betBalance)}</b><small>{insights.betRounds ? `Balance de ${insights.betRounds} ronda${insights.betRounds === 1 ? "" : "s"} con resultado verificable.` : "Sin liquidaciones verificables en el histórico."}</small></article>
      <article className="card"><span className="eyebrow">PUTTS</span>{averagePutts !== undefined ? <><b>{decimal(averagePutts)}</b><small>Promedio en {completePuttTotals.length} ronda{completePuttTotals.length === 1 ? "" : "s"} de {scopeLabel} con captura completa.</small></> : <><b>—</b><small>No hay una tarjeta de {scopeLabel} con putts en todos sus hoyos.</small></>}</article>
    </section>

    {insights.advancedRounds > 0 && <section className="card betaAdvancedStats">
      <div className="sectionTitle"><div><h2>Estadísticas avanzadas</h2><p>Solo usa datos capturados expresamente; los huecos no se completan.</p></div><span className="betaStatsSample">{insights.advancedRounds} ronda{insights.advancedRounds === 1 ? "" : "s"}</span></div>
      <div className="betaStatTiles" aria-label="Estadísticas avanzadas registradas">
        <article><span>Fairways</span><b>{percentage(insights.fairwaysHit, insights.fairwayAttempts)}</b><small>{insights.fairwaysHit} de {insights.fairwayAttempts} capturados</small></article>
        <article><span>GIR</span><b>{percentage(insights.greensInRegulation, insights.greenAttempts)}</b><small>{insights.greensInRegulation} de {insights.greenAttempts} capturados</small></article>
        <article><span>Penalidades</span><b>{insights.penaltyStrokes}</b><small>golpes registrados</small></article>
      </div>
    </section>}

    <section className="card betaRecentScores">
      <div className="sectionTitle"><div><h2>Rondas recientes · {scopeLabel}</h2><p>Abre una tarjeta para ver todo su detalle.</p></div></div>
      <div>{comparableRounds.slice(0, 5).map((round) => <button type="button" key={round.id} onClick={() => onOpenRound(round.id)}><span><b>{round.courseName}</b><small>{roundDate(round.date)} · {round.holeCount} hoyos · {round.teeName || "Tee sin nombre"}</small></span><strong>{round.gross}<small>{relative(round.relativeToPar)}</small></strong></button>)}</div>
    </section>

    <p className="betaDataNote">No se completan datos faltantes: una métrica sólo aparece cuando la captura necesaria está disponible.</p>
  </section>;
}
