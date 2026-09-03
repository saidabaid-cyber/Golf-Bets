import type { FoursomeMatchResult } from "../../lib/engine";
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
export function FoursomeLive({ matches, hole, name }: { matches: FoursomeMatchResult[]; hole: number; name: (id: string) => string }) {
  return <div className="foursomeLive">{matches.map((match, index) => {
    const current = match.holePoints.find(item => item.hole === hole);
    const a = match.basePair.map(name).join(" + ");
    const b = match.opponentPair.map(name).join(" + ");
    const winner = match.pointDiff > 0 ? a : b;
    return <article className="foursomeLiveMatch" key={`${match.segmentId}-${index}`}>
      <div className="foursomeTeam"><b>{a}</b><strong>{match.completedHoles ? signed(match.pointDiff) : "—"}</strong></div>
      <div className="foursomeTeam"><b>{b}</b><strong>{match.completedHoles ? signed(-match.pointDiff) : "—"}</strong></div>
      <div className="foursomeCurrent"><small>HOYO ACTUAL</small><b>Hoyo {hole}: {current ? current.points === 0 ? "Empate" : `+${Math.abs(current.points)} ${current.points > 0 ? a : b}` : "Esperando scores"}</b></div>
      <div className="foursomeAccumulated"><small>ACUMULADO DEL SEGMENTO</small><b>{match.completedHoles ? match.pointDiff === 0 ? "AS · 0 puntos" : `${winner} +${Math.abs(match.pointDiff)}` : "Esperando scores"}</b></div>
      {match.completedHoles > 0 && <small>Provisional por integrante de {a}: {signed(match.provisionalTotalMoney)} MXN · {match.completedHoles} hoyos registrados</small>}
    </article>;
  })}</div>;
}
