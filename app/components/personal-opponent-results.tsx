import { groupCurrentPersonalResults } from "../../lib/personal-opponents";
import type { PersonalOpponentResult } from "../../lib/types";
import { SUPPLEMENTAL_META } from "./supplemental-bets-editor";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";
const statusLabel = (status: PersonalOpponentResult["status"]) => status === "final" ? "Final" : status === "partial" ? "Parcial" : "Pendiente";
const personalModeIcon: Record<PersonalOpponentResult["mode"], string> = {
  nassau_individual: SUPPLEMENTAL_META.individual_nassau.icon,
  dollar_stroke: SUPPLEMENTAL_META.dollar_stroke.icon,
  individual_pressures: SUPPLEMENTAL_META.individual_pressures.icon,
};

export function PersonalOpponentResults({ entries, compact = false }: { entries: PersonalOpponentResult[]; compact?: boolean }) {
  const rivals = groupCurrentPersonalResults(entries);
  if (!rivals.length) return <div className="empty">Sin resultados personales todavía.</div>;
  return <div className={`personalOpponentResults ${compact ? "compact" : ""}`}>{rivals.map((rival) => <article className="personalOpponentCard" key={rival.key}>
    <header><div><span>Contra</span><b>{rival.name}</b></div><strong className={tone(rival.total)}>{money(rival.total)}</strong></header>
    <div className="personalOpponentTotals"><span>Ganado {money(rival.wonMoney)}</span><span>Perdido {money(-rival.lostMoney)}</span><b>Balance {money(rival.total)}</b></div>
    <details className="personalBetsDisclosure"><summary>Ver desglose por apuesta</summary><div>{rival.rounds[0].entries.map((entry, index, all) => {
      const sameMode = all.filter((candidate) => candidate.mode === entry.mode);
      const instance = sameMode.length > 1 ? ` · #${sameMode.findIndex((candidate) => candidate === entry) + 1}` : "";
      return <details className="personalModeDisclosure" key={`${entry.betId}-${entry.mode}-${index}`}>
        <summary><span>{personalModeIcon[entry.mode]} {entry.modeLabel}{instance}<small>{statusLabel(entry.status)}</small></span><b className={tone(entry.amount)}>{money(entry.amount)}</b><i aria-hidden="true">⌄</i></summary>
        <div className="personalModeDetails">
          {(entry.detailLines || []).map((line, detailIndex) => <p key={`${entry.betId}-detail-${detailIndex}`}>{line}</p>)}
          {!entry.detailLines?.length && !entry.components?.length && <p>Este resultado heredado conserva su subtotal; el detalle auditable no estaba disponible en esa versión.</p>}
          {(entry.components || []).map((component) => <section className="personalComponentDetail" key={`${entry.betId}-${component.key}`}>
            <header><span><b>{component.label}</b><small>{statusLabel(component.status)}</small></span><strong className={tone(component.amount)}>{money(component.amount)}</strong></header>
            {component.lines.map((line, lineIndex) => <p key={`${component.key}-${lineIndex}`}>{line}</p>)}
          </section>)}
          <div className="personalModeSubtotal"><span>Subtotal de {entry.modeLabel}</span><b className={tone(entry.amount)}>{money(entry.amount)}</b></div>
        </div>
      </details>;
    })}</div></details>
  </article>)}</div>;
}
