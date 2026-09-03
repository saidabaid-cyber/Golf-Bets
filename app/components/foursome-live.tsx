import type { FoursomeMatchResult } from "../../lib/engine";
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
export function FoursomeLive({ matches, hole, name, pendingCapture = false }: { matches: FoursomeMatchResult[]; hole: number; name: (id: string) => string; pendingCapture?: boolean }) {
  return <div className="foursomeLive">{matches.map((match, index) => {
    const current = match.holePoints.find(item => item.hole === hole);
    const a = match.basePair.map(name).join(" + ");
    const b = match.opponentPair.map(name).join(" + ");
    const winner = match.pointDiff > 0 ? a : b;
    return <article className="foursomeLiveMatch" key={`${match.segmentId}-${index}`}>
      <div className="foursomeTeam"><b>{a}</b><strong>{match.completedHoles ? signed(match.pointDiff) : "—"}</strong></div>
      <div className="foursomeTeam"><b>{b}</b><strong>{match.completedHoles ? signed(-match.pointDiff) : "—"}</strong></div>
      <p className="foursomeCurrent"><b>HOYO ACTUAL</b> · H{hole}: {pendingCapture ? "Edición sin guardar" : current ? current.points === 0 ? "Empate" : `${current.points > 0 ? a : b} +${Math.abs(current.points)}` : "Esperando scores"}</p>
      <p className="foursomeAccumulated">Acum: {match.completedHoles ? match.pointDiff === 0 ? "AS · 0" : `${winner} +${Math.abs(match.pointDiff)}` : "Sin hoyos guardados"}</p>
      <details className="foursomeLiveDetails"><summary>Detalle</summary><p>H{match.startHole}–{match.endHole} · {match.completedHoles} hoyos con resultado</p>{match.completedHoles > 0 && <p>Provisional por integrante de {a}: {signed(match.provisionalTotalMoney)} MXN. Equipo contrario: {signed(-match.provisionalTotalMoney)} MXN.</p>}<p>La vista previa del hoyo queda oficial al tocar Guardar.</p></details>
    </article>;
  })}</div>;
}
