"use client";

import { useId, useMemo } from "react";
import { deriveRoundAchievements, roundAchievementLabels } from "../../lib/round-achievements";
import type { RoundSnapshot } from "../../lib/types";

const EMPTY_PRIOR_ROUNDS: readonly RoundSnapshot[] = [];

export function RoundAchievementSummary({ round, priorRounds = EMPTY_PRIOR_ROUNDS, accountUserId }: {
  round: RoundSnapshot;
  priorRounds?: readonly RoundSnapshot[];
  accountUserId: string;
}) {
  const titleId = useId();
  const linked = round.players?.some(player => player?.accountUserId === accountUserId) === true;
  const summary = useMemo(() => linked
    ? deriveRoundAchievements(round, priorRounds, accountUserId)
    : null, [round, priorRounds, accountUserId, linked]);
  const labels = useMemo(() => summary ? roundAchievementLabels(summary) : [], [summary]);
  if (!linked) return null;

  if (!summary) return <section className="card historicalAchievementSummary" aria-labelledby={titleId}>
    <div className="sectionTitle"><div><span className="eyebrow">HISTÓRICO · HECHOS LOCALES</span><h2 id={titleId}>Logros deportivos</h2></div></div>
    {round.lifecycleState === "completed" && round.roundHoles === 9
      ? <p className="historicalAchievementNotice">Ronda de 9 hoyos: no elegible para logros comparables de 18 hoyos. Su tarjeta y resultado permanecen en Histórico.</p>
      : <p className="historicalAchievementNotice">No hay una tarjeta terminada de 18 hoyos con par y scores completos para acreditar logros. No se infiere ninguno.</p>}
  </section>;

  return <section className="card historicalAchievementSummary" aria-labelledby={titleId}>
    <div className="sectionTitle"><div><span className="eyebrow">HISTÓRICO · HECHOS LOCALES</span><h2 id={titleId}>Logros deportivos</h2>
      <p>Un resumen verificable de esta ronda; no es un attest ni una publicación automática.</p></div></div>
    <div className="historicalAchievementMetrics">
      <span><small>Score · 18 hoyos</small><b>{summary.grossScore}</b><em>{summary.scoreToPar > 0 ? "+" : ""}{summary.scoreToPar} vs par {summary.coursePar}</em></span>
      <span><small>Birdies / águilas+</small><b>{summary.birdies} / {summary.eaglesOrBetter}</b><em>Derivados sólo de score y par</em></span>
      <span><small>Putts</small><b>{summary.puttsTotal ?? "—"}</b><em>{summary.puttsTotal === null ? "Sin captura completa" : "18 hoyos capturados"}</em></span>
      <span><small>GIR</small><b>{summary.gir ? `${summary.gir.hit}/18` : "—"}</b><em>{summary.gir?.source === "explicit" ? "Captura explícita" : summary.gir ? "Score + putts capturados" : "Evidencia insuficiente"}</em></span>
    </div>
    {labels.length > 0
      ? <ul className="historicalAchievementBadges" aria-label="Logros verificados">{summary.achievements.map((achievement, index) => <li key={achievement.code}>{labels[index]}</li>)}</ul>
      : <p className="historicalAchievementNotice">Ronda válida; sin badge adicional acreditado.</p>}
    <p className="historicalAchievementFootnote">El récord personal requiere al menos una ronda anterior comparable del mismo jugador. Los nombres, likes y comentarios no acreditan logros.</p>
  </section>;
}
