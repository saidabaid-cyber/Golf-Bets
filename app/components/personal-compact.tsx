import type { calculatePersonalBets } from "../../lib/engine";
import { personalHoleStatus } from "../../lib/personal-summary";
type Result = ReturnType<typeof calculatePersonalBets>["results"][number];
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("es-MX")}`;
export function PersonalCompact({ results, owner, name, hole, title = "Personales", embedded = false, onOpen }: { results: Result[]; owner: string; name: (id: string) => string; hole?: number; title?: string; embedded?: boolean; onOpen: (id: string) => void }) {
  if (!results.length) return null;
  const ownerTotal = results.reduce((total, result) => total + result.totalMoney, 0);
  return <section className={`${embedded ? "" : "card"} personalCompact ${hole ? "personalLiveCompact" : ""}`.trim()}>{!embedded && <h2>{title}</h2>}{results.map(result => {
    const rival = name(result.rivalId);
    const provisional = result.liveComponents.reduce((sum, component) => sum + component.ownerMoney, 0);
    const complete = result.liveComponents.every(component => component.complete);
    const diff = (kind: "match" | "medal", suffix: string) => {
      const component = result.liveComponents.find(item => item.key === `${kind}${suffix}`);
      return component?.playedHoles ? signed(kind === "match" ? component.matchState : component.medalDiff) : "—";
    };
    return <button className="personalCompactCard" key={result.betId} onClick={() => onOpen(result.betId)}>
      <b>{hole ? rival : `${owner} vs ${rival}`}</b>
      {hole ? <div>{personalHoleStatus(result, owner, rival, hole).map(status => <span key={status}>{status}</span>)}</div> : <table><caption>Positivo: {owner} arriba · negativo: {rival} arriba</caption><thead><tr><th></th><th>1ª</th><th>2ª</th><th>TOTAL</th></tr></thead><tbody>{(["match", "medal"] as const).map(kind => <tr key={kind}><th>{kind.toUpperCase()}</th>{["1", "2", "18"].map(suffix => <td key={suffix}>{diff(kind, suffix)}</td>)}</tr>)}</tbody></table>}
      <strong>{!hole && `${complete ? "Resultado" : "Provisional"}: `}{owner}: {money(complete ? result.totalMoney : provisional)}</strong><small>Detalle →</small>
    </button>;
  })}{!hole && <div className="personalCompactTotal"><span>Total de Personales</span><strong className={ownerTotal > 0 ? "good" : ownerTotal < 0 ? "bad" : ""}>{owner}: {money(ownerTotal)}</strong></div>}</section>;
}
