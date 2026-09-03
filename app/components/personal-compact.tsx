import type { calculatePersonalBets } from "../../lib/engine";
type Result = ReturnType<typeof calculatePersonalBets>["results"][number];
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("es-MX")}`;
export function PersonalCompact({ results, owner, name, hole, onOpen }: { results: Result[]; owner: string; name: (id: string) => string; hole?: number; onOpen: (id: string) => void }) {
  if (!results.length) return null;
  return <section className={`card personalCompact ${hole ? "personalLiveCompact" : ""}`}><h2>Personales</h2>{results.map(result => {
    const rival = name(result.rivalId);
    const active = result.liveComponents.filter(component => !hole || component.holes.includes(hole));
    const provisional = result.liveComponents.reduce((sum, component) => sum + component.ownerMoney, 0);
    const complete = result.liveComponents.every(component => component.complete);
    const diff = (kind: "match" | "medal", suffix: string) => {
      const component = result.liveComponents.find(item => item.key === `${kind}${suffix}`);
      return component?.playedHoles ? signed(kind === "match" ? component.matchState : component.medalDiff) : "—";
    };
    return <button className="personalCompactCard" key={result.betId} onClick={() => onOpen(result.betId)}>
      <b>{hole ? rival : `${owner} vs ${rival}`}</b>
      {hole ? <div>{active.filter(item => !item.key.endsWith("18") || !active.some(other => other.kind === item.kind && !other.key.endsWith("18"))).map(component => {
        const value = component.kind === "match" ? component.matchState : component.medalDiff;
        return <span key={component.key}>{component.kind === "match" ? "Match" : "Medal"}{component.key.endsWith("18") ? " 18" : ""}: {component.playedHoles === 0 ? "Sin hoyos guardados" : value === 0 ? "AS" : `${value > 0 ? owner : rival} ${component.kind === "match" ? `${Math.abs(value)} UP` : `+${Math.abs(value)}`}`}</span>;
      })}</div> : <table><caption>Positivo: {owner} arriba · negativo: {rival} arriba</caption><thead><tr><th></th><th>1ª</th><th>2ª</th><th>TOTAL</th></tr></thead><tbody>{(["match", "medal"] as const).map(kind => <tr key={kind}><th>{kind.toUpperCase()}</th>{["1", "2", "18"].map(suffix => <td key={suffix}>{diff(kind, suffix)}</td>)}</tr>)}</tbody></table>}
      <strong>{!hole && `${complete ? "Resultado" : "Provisional"}: `}{owner}: {money(complete ? result.totalMoney : provisional)}</strong><small>Detalle →</small>
    </button>;
  })}</section>;
}
