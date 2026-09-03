"use client";

import { useMemo, useState } from "react";
import { buildPersonalHistory, type PersonalHistoryPeriod, type PersonalHistorySort } from "../../lib/personal-history";
import type { RoundSnapshot } from "../../lib/types";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";
const dateLabel = (date: string) => new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" });

export function PersonalHistoryPanel({ history, today, onDelete }: {
  history: RoundSnapshot[];
  today: string;
  onDelete: (target: { roundId: string; resultIndex: number; rivalName: string }) => void;
}) {
  const [period, setPeriod] = useState<PersonalHistoryPeriod>("all");
  const [sort, setSort] = useState<PersonalHistorySort>("recent");
  const rivals = useMemo(() => buildPersonalHistory(history, today, period, sort), [history, today, period, sort]);
  return <section className="card personalRivalHistory">
    <h2>Apuestas personales · histórico</h2>
    <p className="muted">Balance desde el jugador principal de cada ronda: positivo = ganó; negativo = perdió. Toca un rival para ver sus jugadas.</p>
    <div className="rivalHistoryFilters">
      <label>Periodo<select value={period} onChange={(event) => setPeriod(event.target.value as PersonalHistoryPeriod)}><option value="all">Total</option><option value="year">Este año</option><option value="month">Este mes</option></select></label>
      <label>Ordenar por<select value={sort} onChange={(event) => setSort(event.target.value as PersonalHistorySort)}><option value="recent">Reciente</option><option value="played">Más jugado</option><option value="won">Más ganado</option><option value="lost">Más perdido</option></select></label>
    </div>
    {!rivals.length ? <div className="empty">Todavía no hay personales guardadas en este periodo.</div> : rivals.map((rival) => <details className="rivalHistoryDetails" key={rival.key}>
      <summary><span><b>{rival.name}</b><small>{rival.rounds} rondas · {rival.wins} ganadas · {rival.losses} perdidas · {rival.ties} empatadas</small><small>Última jugada: {dateLabel(rival.records[0].date)} · {money(rival.records[0].totalMoney)}</small></span><strong className={tone(rival.total)}>{money(rival.total)}</strong></summary>
      <div className="rivalHistoryBreakdown">Match {money(rival.matchMoney)} · Medal {money(rival.medalMoney)}<small>Los importes incluyen las presiones aplicables; no se suman dos veces.</small></div>
      {rival.records.map((record) => <article className="rivalHistoryRound" key={record.roundId}>
        <header><div><b>{dateLabel(record.date)} · {record.courseName}</b><small>Jugador principal: {record.ownerName}</small></div><strong className={tone(record.totalMoney)}>{money(record.totalMoney)}</strong></header>
        {record.entries.map((entry) => <div className="rivalHistoryEntry" key={entry.resultIndex}>
          <div><b>{entry.rivalName} · HCP {entry.rivalHandicap ?? "no registrado"}</b><span>Match {money(entry.matchMoney)} · Medal {money(entry.medalMoney)} · Total {money(entry.totalMoney)}</span>
            {entry.betSnapshot ? <small>Base {money(entry.betSnapshot.baseValue)} · {entry.betSnapshot.advantageStrokes ? `${entry.betSnapshot.advantageStrokes} golpes recibe ${entry.betSnapshot.advantageReceiver === "owner" ? record.ownerName : entry.rivalName}` : "Sin ventaja"} · {(entry.betSnapshot.pressureMultiplier ?? entry.betSnapshot.back9Multiplier ?? 1) > 1 ? `Presión ${entry.betSnapshot.pressureMultiplier ?? entry.betSnapshot.back9Multiplier}x ${entry.betSnapshot.pressureNine === "holes_1_9" ? "H1–9" : "H10–18"}` : "Sin presión"}</small> : <small>Registro anterior: configuración no registrada.</small>}
          </div><button className="dangerGhost" onClick={() => onDelete({ roundId: record.roundId, resultIndex: entry.resultIndex, rivalName: entry.rivalName })}>Eliminar registro</button>
        </div>)}
      </article>)}
    </details>)}
  </section>;
}
