"use client";

import { useMemo, useState } from "react";
import { buildPersonalHistory, selectPersonalRivalHistory } from "../../lib/personal-history";
import type { RoundSnapshot } from "../../lib/types";
import { useSecondaryView } from "./use-secondary-view";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";
const dateLabel = (date: string) => new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" });

export function PersonalHistoryPanel({ history, today, onDelete }: {
  history: RoundSnapshot[];
  today: string;
  onDelete: (target: { roundId: string; resultIndex: number; rivalName: string }) => void;
}) {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [rivalFilter, setRivalFilter] = useState("");
  const [selected, setSelected] = useSecondaryView<string>("personalHistoryDetail");
  const allRivals = useMemo(() => buildPersonalHistory(history, today, "all", "recent"), [history, today]);
  const years = useMemo(() => [...new Set(history.filter(round => round.personalResults?.length).map(round => round.date.slice(0, 4)))].sort().reverse(), [history]);
  const datedHistory = useMemo(() => history.filter(round => (!year || round.date.startsWith(year)) && (!month || round.date.slice(5, 7) === month)), [history, year, month]);
  const rivals = useMemo(() => {
    const selectedRival = selectPersonalRivalHistory(buildPersonalHistory(datedHistory, today, "all", "recent"), rivalFilter);
    return selectedRival ? [selectedRival] : [];
  }, [datedHistory, today, rivalFilter]);
  return <section className="card personalRivalHistory">
    <h2>Nassau Individual · histórico</h2>
    <p className="muted">Selecciona un contrincante para consultar el balance de tus rondas contra esa persona.</p>
    {selected && <button className="secondary" onClick={() => setSelected(null)}>← Regresar</button>}
    <div className="rivalHistoryFilters">
      <label>Contrincante<select value={rivalFilter} onChange={(event) => { setRivalFilter(event.target.value); setSelected(null); }}><option value="">Selecciona un contrincante</option>{allRivals.map(rival => <option key={rival.key} value={rival.key}>{rival.name}</option>)}</select></label>
      <label>Año<select value={year} onChange={(event) => { setYear(event.target.value); setSelected(null); }}><option value="">Todos los años</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Mes<select value={month} onChange={(event) => { setMonth(event.target.value); setSelected(null); }}><option value="">Todos los meses</option>{["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}</select></label>
    </div>
    {!rivalFilter ? <div className="empty">Selecciona un contrincante para ver resultados.</div> : !rivals.length ? <div className="empty">No hay resultados contra este contrincante en el periodo seleccionado.</div> : rivals.filter(rival => !selected || rival.key === selected).map((rival) => <div className="rivalHistoryDetails" key={rival.key}>
      <button className="personalHistorySummary" onClick={() => setSelected(rival.key)}><b>{rival.name}</b><span>Rondas: {rival.rounds} · Apuestas: {rival.bets}</span><span>Ganadas: {rival.wins} · Perdidas: {rival.losses} · Empatadas: {rival.ties}</span><span>Ganado: {money(rival.wonMoney)} · Perdido: {money(-rival.lostMoney)}</span><strong className={tone(rival.total)}>Balance: {money(rival.total)}</strong></button>
      {selected === rival.key && <>
      <div className="rivalHistoryBreakdown">Match {money(rival.matchMoney)} · Medal {money(rival.medalMoney)} · Press {money(rival.pressureMoney)}<br />1ª {money(rival.firstMoney)} · 2ª {money(rival.secondMoney)} · Total 18 {money(rival.total18Money)}<small>Press es la porción adicional ya incluida en Match/Medal y 2ª; no se suma otra vez.</small></div>
      {rival.records.map((record) => <article className="rivalHistoryRound" key={record.roundId}>
        <header><div><b>{dateLabel(record.date)} · {record.courseName}</b></div><strong className={tone(record.totalMoney)}>{money(record.totalMoney)}</strong></header>
        {record.entries.map((entry) => <div className="rivalHistoryEntry" key={entry.resultIndex}>
          <div><b>{entry.rivalName} · HCP {entry.rivalHandicap ?? "no registrado"}</b><span>Match {money(entry.matchMoney)} · Medal {money(entry.medalMoney)} · Total {money(entry.totalMoney)}</span>
            {entry.betSnapshot ? <small>Base {money(entry.betSnapshot.baseValue)} · {entry.betSnapshot.advantageStrokes ? `${entry.betSnapshot.advantageStrokes} golpes recibe ${entry.betSnapshot.advantageReceiver === "owner" ? record.ownerName : entry.rivalName}` : "Sin ventaja"} · {(entry.betSnapshot.pressureMultiplier ?? entry.betSnapshot.back9Multiplier ?? 1) > 1 ? `Presión ${entry.betSnapshot.pressureMultiplier ?? entry.betSnapshot.back9Multiplier}x ${entry.betSnapshot.nassauVersion === 2 ? "2ª vuelta jugada" : entry.betSnapshot.pressureNine === "holes_1_9" ? "H1–9" : "H10–18"}` : "Sin presión"} · Carry {entry.betSnapshot.carryEnabled ? "Sí" : "No"}</small> : <small>Registro anterior: configuración no registrada.</small>}
          </div><button className="dangerGhost" onClick={() => onDelete({ roundId: record.roundId, resultIndex: entry.resultIndex, rivalName: entry.rivalName })}>Eliminar registro</button>
        </div>)}
      </article>)}
      </>}
    </div>)}
  </section>;
}
