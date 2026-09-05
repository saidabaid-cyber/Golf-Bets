"use client";

import { useMemo, useState } from "react";
import { buildPersonalOpponentHistory } from "../../lib/personal-opponents";
import type { RoundSnapshot } from "../../lib/types";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";
const dateLabel = (date: string) => new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" });

export function PersonalHistoryPanel({ history, onDelete }: {
  history: RoundSnapshot[];
  today: string;
  onDelete: (target: { roundId: string; resultIndex: number; rivalName: string }) => void;
}) {
  void onDelete; // Deleting an entire historical round remains available in Histórico.
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [rivalKey, setRivalKey] = useState("");
  const allRivals = useMemo(() => buildPersonalOpponentHistory(history), [history]);
  const years = useMemo(() => [...new Set(history.filter((round) => (round.personalOpponentResults?.length || round.personalResults?.length)).map((round) => round.date.slice(0, 4)))].sort().reverse(), [history]);
  const filteredHistory = useMemo(() => history.filter((round) => (!year || round.date.startsWith(year)) && (!month || round.date.slice(5, 7) === month)), [history, year, month]);
  const selected = useMemo(() => buildPersonalOpponentHistory(filteredHistory).find((rival) => rival.key === rivalKey), [filteredHistory, rivalKey]);

  return <section className="card personalRivalHistory">
    <h2>Personales · histórico</h2>
    <p className="muted">Selecciona un contrincante para consultar Nassau individual, Dollar a Stroke y Presiones individuales.</p>
    <div className="rivalHistoryFilters">
      <label>Contrincante<select value={rivalKey} onChange={(event) => setRivalKey(event.target.value)}><option value="">Selecciona un contrincante</option>{allRivals.map((rival) => <option key={rival.key} value={rival.key}>{rival.name}</option>)}</select></label>
      <label>Año<select value={year} onChange={(event) => setYear(event.target.value)}><option value="">Todos los años</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Mes<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Todos los meses</option>{["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}</select></label>
    </div>
    {!rivalKey ? <div className="empty">Elige un contrincante para ver su balance.</div> : !selected ? <div className="empty">No hay resultados contra este contrincante en el periodo seleccionado.</div> : <div className="rivalHistoryDetails">
      <header className="personalOpponentHeading"><div><span>Contrincante</span><h3>{selected.name}</h3></div><strong className={tone(selected.total)}>{money(selected.total)}</strong></header>
      <div className="personalMoneySummary"><div><span>Dinero ganado</span><b className="good">{money(selected.wonMoney)}</b></div><div><span>Dinero perdido</span><b className="bad">{money(-selected.lostMoney)}</b></div><div><span>Balance neto</span><b className={tone(selected.total)}>{money(selected.total)}</b></div></div>
      <div className="personalRoundList">{selected.rounds.map((round) => <details className="personalRoundDisclosure" key={round.roundId}>
        <summary><span>{dateLabel(round.date)} · {round.courseName}</span><b className={tone(round.total)}>{money(round.total)}</b></summary>
        <div>{round.entries.map((entry, index) => <div className="personalModeLine" key={`${entry.betId}-${entry.mode}-${index}`}><span>{entry.modeLabel}</span><b className={tone(entry.amount)}>{money(entry.amount)}</b></div>)}</div>
      </details>)}</div>
    </div>}
  </section>;
}
