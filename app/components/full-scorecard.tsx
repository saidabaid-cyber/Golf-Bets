import { playingHandicap, strokeAllowanceForHole } from "../../lib/engine";
import type { Course, HoleScore, Player } from "../../lib/types";
import { hasValidRoundHandicap } from "../../lib/handicap-base";

export function FullScorecard({ course, players, scores, order, scale, onScale }: {
  course: Course;
  players: Player[];
  scores: Record<number, HoleScore>;
  order: number[];
  scale: number;
  onScale: (scale: number) => void;
}) {
  const included = new Set(order);
  const front = Array.from({ length: 9 }, (_, index) => index + 1).filter(hole => included.has(hole));
  const back = Array.from({ length: 9 }, (_, index) => index + 10).filter(hole => included.has(hole));
  const byNumber = new Map(course.holes.map(hole => [hole.number, hole]));
  const sum = (holes: number[], playerId: string) => {
    const entered = holes.filter(hole => typeof scores[hole]?.[playerId] === "number");
    return entered.length ? entered.reduce((total, hole) => total + Number(scores[hole]?.[playerId]), 0) : null;
  };

  return <section className="card fullScorecard" style={{ "--scorecard-scale": scale / 100 } as React.CSSProperties}>
    <div className="sectionTitle"><div><h2>Tarjeta completa</h2><p>Gross, neto y golpes recibidos. Los hoyos pendientes permanecen vacíos.</p></div></div>
    <div className="scorecardZoom" aria-label="Tamaño de tarjeta">{[75, 90, 100].map(value => <button type="button" className="secondary" aria-pressed={scale === value} key={value} onClick={() => onScale(value)}>{value}%</button>)}</div>
    <div className="tableWrap scorecardTable" tabIndex={0} aria-label="Tarjeta completa, desliza horizontalmente">
      <table><thead><tr><th>Jugador</th>{front.map(hole => <th key={hole}><span>H{hole}</span><small>SI {byNumber.get(hole)?.strokeIndex ?? "—"}</small></th>)}{front.length > 0 && <th className="scorecardCut">OUT</th>}{back.map(hole => <th key={hole}><span>H{hole}</span><small>SI {byNumber.get(hole)?.strokeIndex ?? "—"}</small></th>)}{back.length > 0 && <th className="scorecardCut">IN</th>}<th>TOTAL</th><th>+/− PAR</th></tr></thead>
      <tbody>{players.map(player => {
        const roundHcp = hasValidRoundHandicap(player) ? playingHandicap(Math.max(0, player.handicap), 100, "half_up") : null;
        const allHoles = [...front, ...back];
        const entered = allHoles.filter(hole => typeof scores[hole]?.[player.id] === "number");
        const total = sum(allHoles, player.id);
        const relative = total === null ? null : total - entered.reduce((par, hole) => par + (byNumber.get(hole)?.par || 0), 0);
        const cell = (holeNumber: number) => {
          const gross = scores[holeNumber]?.[player.id];
          const hole = byNumber.get(holeNumber);
          if (typeof gross !== "number" || !hole) return <td key={holeNumber} aria-label={`${player.name} hoyo ${holeNumber} pendiente`}></td>;
          if (roundHcp === null) return <td key={holeNumber}><b>{gross}</b><small>Completa el HCP<br />Neto —</small></td>;
          const strokes = strokeAllowanceForHole(roundHcp, hole.strokeIndex, "half_up");
          return <td key={holeNumber}><b>{gross}</b><small>{strokes ? `+${strokes} golpe${strokes === 1 ? "" : "s"}` : "Sin ventaja"}<br />Neto {gross - strokes}</small></td>;
        };
        const out = sum(front, player.id);
        const inn = sum(back, player.id);
        return <tr key={player.id}><td><b>{player.name || "Sin nombre"}</b><small>HCP {player.handicap ?? "—"}</small></td>{front.map(cell)}{front.length > 0 && <td className="scorecardCut"><b>{out ?? ""}</b></td>}{back.map(cell)}{back.length > 0 && <td className="scorecardCut"><b>{inn ?? ""}</b></td>}<td><b>{total ?? ""}</b></td><td className={relative === null ? "" : relative <= 0 ? "good" : "bad"}>{relative === null ? "" : `${relative > 0 ? "+" : ""}${relative}`}</td></tr>;
      })}</tbody></table>
    </div>
  </section>;
}
