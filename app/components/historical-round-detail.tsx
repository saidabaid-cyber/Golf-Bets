import type { RoundSnapshot } from "../../lib/types";
import { canEditSnapshot } from "../../lib/round-editing";
const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX")}`;
export function HistoricalRoundDetail({ round, onEdit, onPhoto }: { round: RoundSnapshot; onEdit: () => void; onPhoto: () => void }) {
  return <section className="card historicalDetail"><h1>{round.courseName}</h1><p>{round.date} · {round.ownerName} · {round.roundHoles || 18} hoyos · salida H{round.startHole || round.order?.[0] || 1}</p>
    <h2>Neto {money(round.netResult)}</h2><p>Apuestas {money(round.betResult)} · Gastos {money(-round.expenseTotal)}</p>
    <div className="tableWrap"><table><thead><tr><th>Jugador · HCP</th>{round.order?.map(hole => <th key={hole}>H{hole}</th>)}</tr></thead><tbody>{round.players?.map(player => <tr key={player.id}><th>{player.name} · {player.handicap ?? "—"}</th>{round.order?.map(hole => <td key={hole}>{round.scores?.[hole]?.[player.id] ?? "—"}</td>)}</tr>)}</tbody></table></div>
    {Object.entries(round.categoryResults).map(([category,value]) => <div className="transfer" key={category}><span>{category}</span><b>{money(value)}</b></div>)}
    {round.personalResults?.map((result,index) => <div className="transfer" key={index}><span>{round.ownerName} vs {result.rivalName}</span><b>{money(result.totalMoney)}</b></div>)}
    {round.photoId && <button className="secondary" onClick={onPhoto}>Ver tarjeta original</button>}
    {canEditSnapshot(round) ? <button className="primary" onClick={onEdit}>Corregir ronda guardada</button> : <p className="notice">Registro anterior de solo lectura: faltan configuración completa o parejas/segmentos originales. No se inventarán al recalcular.</p>}
  </section>;
}
