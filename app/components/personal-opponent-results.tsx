import { groupCurrentPersonalResults } from "../../lib/personal-opponents";
import type { PersonalOpponentResult } from "../../lib/types";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";

export function PersonalOpponentResults({ entries, compact = false }: { entries: PersonalOpponentResult[]; compact?: boolean }) {
  const rivals = groupCurrentPersonalResults(entries);
  if (!rivals.length) return <div className="empty">Sin resultados personales todavía.</div>;
  return <div className={`personalOpponentResults ${compact ? "compact" : ""}`}>{rivals.map((rival) => <article className="personalOpponentCard" key={rival.key}>
    <header><div><span>Contra</span><b>{rival.name}</b></div><strong className={tone(rival.total)}>{money(rival.total)}</strong></header>
    <div className="personalOpponentTotals"><span>Ganado {money(rival.wonMoney)}</span><span>Perdido {money(-rival.lostMoney)}</span><b>Balance {money(rival.total)}</b></div>
    <details><summary>Ver desglose por apuesta</summary><div>{rival.rounds[0].entries.map((entry, index) => <p key={`${entry.betId}-${entry.mode}-${index}`}><span>{entry.modeLabel}</span><b className={tone(entry.amount)}>{money(entry.amount)}</b></p>)}</div></details>
  </article>)}</div>;
}
