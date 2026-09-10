import { buildPlayerRoundStats } from "../../lib/round-statistics";
import type { RoundSnapshot } from "../../lib/types";

const DIRECTION = { far_left: "↞", left: "←", center: "●", right: "→", far_right: "↠" } as const;

export function RoundStatsCard({ round, playerId }: { round: RoundSnapshot; playerId: string }) {
  if (!round.courseSnapshot || !round.scores || !round.players?.some((player) => player.id === playerId)) return null;
  const order = Array.isArray(round.order) && round.order.length
    ? round.order
    : round.courseSnapshot.holes.map((hole) => hole.number);
  const data = buildPlayerRoundStats({ playerId, course: round.courseSnapshot, order, scores: round.scores, putts: round.putts, advancedStats: round.advancedStats });
  const player = round.players.find((candidate) => candidate.id === playerId)!;
  if (!data.holes.some((hole) => hole.score !== null)) return null;
  const pct = (hit: number, attempts: number) => attempts ? `${Math.round(hit / attempts * 100)}%` : "—";
  return <section className="card roundStatsCard" aria-labelledby="round-stats-title">
    <div className="sectionTitle"><div><h2 id="round-stats-title">Tarjeta y estadísticas de {player.name}</h2><p>Hechos guardados del juego. GIR se deriva sólo cuando existen score y putts.</p></div></div>
    <div className="roundStatsTableWrap"><table><thead><tr><th>Hoyo</th><th>Score</th><th>Putts</th><th>Salida</th><th>Palo</th><th>Bunkers</th><th>Penalty</th><th>OB</th><th>GIR</th></tr></thead><tbody>
      {data.holes.map((hole) => <tr key={hole.hole}><th>{hole.hole}<small>Par {hole.par}</small></th><td>{hole.score ?? "—"}</td><td>{hole.putts ?? "—"}</td><td>{hole.teeDirection ? DIRECTION[hole.teeDirection as keyof typeof DIRECTION] : "—"}</td><td>{hole.teeClub || "—"}</td><td>{hole.greenSideBunkers + hole.fairwayBunkers || "—"}</td><td>{hole.penaltyAreas || "—"}</td><td>{hole.outOfBounds || "—"}</td><td>{hole.gir === null ? "—" : hole.gir ? "✓" : "·"}</td></tr>)}
      <tr className="roundStatsTotal"><th>TOTAL</th><td>{data.totals.total.score}</td><td>{data.totals.total.putts}</td><td colSpan={6}>OUT {data.totals.out.score || "—"} · IN {data.totals.in.score || "—"}</td></tr>
    </tbody></table></div>
    <div className="roundStatsSummary"><span><small>Fairways</small><b>{pct(data.summary.fairwaysHit, data.summary.fairwayAttempts)}</b></span><span><small>Putts</small><b>{data.summary.puttHoles ? data.summary.putts : "—"}</b></span><span><small>GIR</small><b>{pct(data.summary.gir, data.summary.girAttempts)}</b></span><span><small>Bunkers</small><b>{data.summary.bunkers}</b></span><span><small>Penalty</small><b>{data.summary.penaltyAreas}</b></span><span><small>OB</small><b>{data.summary.outOfBounds}</b></span></div>
  </section>;
}
