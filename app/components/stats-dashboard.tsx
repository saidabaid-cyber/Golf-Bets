"use client";

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

function roundDate(value: string) {
  const date = new Date(`${value}T12:00:00-06:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(date);
}

function TrendChart({ rounds }: { rounds: ScoredRoundInsight[] }) {
  const ordered = rounds.slice(0, 10).reverse();
  const values = ordered.map((round) => round.gross);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(1, high - low);
  const points = ordered.map((round, index) => ({
    round,
    x: ordered.length === 1 ? 150 : 18 + (index * 264) / (ordered.length - 1),
    y: 15 + ((round.gross - low) / range) * 62,
  }));

  return <div className="betaTrendChart">
    <svg viewBox="0 0 300 94" role="img" aria-label={`Evolución de score en ${ordered.length} ronda${ordered.length === 1 ? "" : "s"}`}>
      <title>Evolución de score bruto; un punto más alto representa un score menor.</title>
      <path className="betaTrendGuide" d="M18 15H282M18 46H282M18 77H282" />
      {points.length > 1 && <polyline className="betaTrendLine" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />}
      {points.map((point) => <g key={point.round.id}><circle className="betaTrendPoint" cx={point.x} cy={point.y} r="4" /><text x={point.x} y={Math.max(10, point.y - 8)} textAnchor="middle">{point.round.gross}</text></g>)}
    </svg>
    <div className="betaTrendDates">{ordered.map((round) => <span key={round.id} title={`${round.courseName} · ${round.gross}`}>{roundDate(round.date)}</span>)}</div>
  </div>;
}

export function StatsDashboard({ insights, onOpenHistory, onOpenRound }: StatsDashboardProps) {
  if (!insights.scoredRounds) {
    return <section className="betaStatsScreen" aria-labelledby="beta-stats-title">
      <section className="hero betaStatsHero"><div><span className="eyebrow">THE BACKYARD · STATS</span><h1 id="beta-stats-title">Tu juego, con datos reales.</h1><p>Las estadísticas se calculan únicamente con tarjetas completas.</p></div></section>
      <section className="card betaStatsEmpty"><span className="betaEmptyFlag" aria-hidden="true">↗</span><h2>Todavía no hay scores completos.</h2><p>{insights.rounds ? "Tus rondas guardadas siguen disponibles, pero aún no contienen una tarjeta completa para calcular estadísticas confiables." : "Cierra y guarda tu primera ronda para empezar a medir tu juego."}</p><button type="button" className="primary" onClick={onOpenHistory}>{insights.rounds ? "Revisar histórico" : "Abrir histórico"}</button></section>
    </section>;
  }

  const totalScoringHoles = insights.pars + insights.birdies + insights.eaglesOrBetter + insights.bogeys + insights.doublesOrWorse;
  const comparableRounds = insights.recentRounds.filter((round) => round.holeCount === insights.scoreScopeHoles);
  const scopeLabel = `${insights.scoreScopeHoles} hoyos`;
  const scoringRows = [
    ["Eagle o mejor", insights.eaglesOrBetter],
    ["Birdies", insights.birdies],
    ["Pars", insights.pars],
    ["Bogeys", insights.bogeys],
    ["Dobles +", insights.doublesOrWorse],
  ] as const;

  return <section className="betaStatsScreen" aria-labelledby="beta-stats-title">
    <section className="hero betaStatsHero"><div><span className="eyebrow">THE BACKYARD · STATS</span><h1 id="beta-stats-title">Así viene tu juego.</h1><p>Scores comparables con {insights.scoreSampleRounds} tarjeta{insights.scoreSampleRounds === 1 ? "" : "s"} completa{insights.scoreSampleRounds === 1 ? "" : "s"} de {scopeLabel}. Resultado por hoyo considera las {insights.scoredRounds} completas.</p></div><button type="button" className="secondary" onClick={onOpenHistory}>Ver histórico</button></section>

    <section className="betaStatTiles" aria-label="Estadísticas principales">
      <article><span>Promedio</span><b>{decimal(insights.averageScore)}</b><small>score bruto · {scopeLabel}</small></article>
      <article><span>Mejor score</span><b>{insights.bestScore ?? "—"}</b><small>{scopeLabel}</small></article>
      <article><span>vs par</span><b>{relative(insights.averageVsPar)}</b><small>promedio</small></article>
      <article><span>Campos</span><b>{insights.coursesPlayed}</b><small>en histórico</small></article>
    </section>

    <section className="card betaTrendCard">
      <div className="sectionTitle"><div><h2>Evolución</h2><p>Score bruto · {scopeLabel} · hasta las últimas 10 rondas</p></div><span className="betaStatsSample">{comparableRounds.slice(0, 10).length} rondas</span></div>
      <TrendChart rounds={comparableRounds} />
      <div className="betaAverageStrip"><span>Últimas 5 <b>{decimal(insights.last5Average)}</b></span><span>Últimas 10 <b>{decimal(insights.last10Average)}</b></span><span>Mejor vs par <b>{relative(insights.bestVsPar)}</b></span></div>
    </section>

    <section className="card betaScoringCard">
      <div className="sectionTitle"><div><h2>Resultado por hoyo</h2><p>{totalScoringHoles} hoyos con score válido.</p></div></div>
      <div className="betaScoringMix">{scoringRows.map(([label, count]) => {
        const percentage = totalScoringHoles ? (count / totalScoringHoles) * 100 : 0;
        return <div key={label}><span><b>{label}</b><small>{count} · {percentage.toFixed(0)}%</small></span><div aria-hidden="true"><i style={{ width: `${percentage}%` }} /></div></div>;
      })}</div>
    </section>

    <section className="betaSecondaryStats">
      <article className="card"><span className="eyebrow">APUESTAS REGISTRADAS</span><b className={insights.betBalance >= 0 ? "good" : "bad"}>{money(insights.betBalance)}</b><small>Balance acumulado del histórico disponible.</small></article>
      <article className="card"><span className="eyebrow">PUTTS</span>{insights.averagePutts !== undefined ? <><b>{decimal(insights.averagePutts)}</b><small>Promedio en {insights.puttRounds} ronda{insights.puttRounds === 1 ? "" : "s"} de {scopeLabel} con captura completa.</small></> : <><b>—</b><small>Se mostrará cuando una ronda tenga putts en todos sus hoyos.</small></>}</article>
    </section>

    <section className="card betaRecentScores">
      <div className="sectionTitle"><div><h2>Rondas recientes</h2><p>Abre una tarjeta para ver todo su detalle.</p></div></div>
      <div>{insights.recentRounds.slice(0, 5).map((round) => <button type="button" key={round.id} onClick={() => onOpenRound(round.id)}><span><b>{round.courseName}</b><small>{roundDate(round.date)} · {round.holeCount} hoyos · {round.teeName || "Tee sin nombre"}</small></span><strong>{round.gross}<small>{relative(round.relativeToPar)}</small></strong></button>)}</div>
    </section>

    <p className="betaDataNote">No se completan datos faltantes: una métrica sólo aparece cuando la captura necesaria está disponible.</p>
  </section>;
}
