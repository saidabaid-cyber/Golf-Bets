"use client";

import { useMemo, useState } from "react";

import { historicalBetDisplayLabel } from "../../lib/bet-catalog";
import { buildHistoricalRoundRecap, type HistoricalRoundRecapIssueCode } from "../../lib/historical-round-recap";
import { canEditSnapshot } from "../../lib/round-editing";
import type { PrivateLeaderboardRow } from "../../lib/round-utils";
import type { Course, HoleScore, Player, RoundSnapshot } from "../../lib/types";
import { FullScorecard } from "./full-scorecard";
import { GolfLeaderboard, type GolfLeaderboardMode } from "./golf-leaderboard";

const money = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
const tone = (value: number) => value > 0 ? "good" : value < 0 ? "bad" : "";
const percentage = (hit: number, attempts: number) => `${Math.round((hit / attempts) * 100)}%`;
const historicalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
};

const lifecycleLabels = {
  draft: "Borrador",
  live: "En juego",
  completed: "Terminada",
  cancelled: "Cancelada",
} as const;

const issueMessages: Record<HistoricalRoundRecapIssueCode, string> = {
  invalid_snapshot: "El registro no tiene una estructura histórica válida.",
  invalid_geometry: "No se guardó una secuencia confiable de 9 o 18 hoyos.",
  invalid_course: "La tarjeta del campo está incompleta o dañada.",
  invalid_players: "Algunos jugadores guardados no tienen una identidad válida.",
  invalid_handicap: "Uno o más HCP guardados no son válidos; su neto no se muestra.",
  invalid_scores: "Se omitieron scores guardados que no eran válidos.",
  invalid_player_balances: "La liquidación por jugador no cuadra y fue ocultada.",
  invalid_category_balances: "Un desglose por modalidad no cuadra y fue ocultado.",
  invalid_financials: "Los totales económicos guardados no coinciden y fueron ocultados.",
  non_final_round: "La ronda no está terminada; no se muestra una liquidación final.",
};

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function legacyOwnerCategories(round: RoundSnapshot) {
  const source = runtimeRecord(round.categoryResults);
  if (!source) return [];
  return Object.entries(source).flatMap(([category, value]) => {
    const label = category.trim();
    return label && typeof value === "number" && Number.isFinite(value)
      ? [{ category: label, amount: value }]
      : [];
  });
}

export function HistoricalRoundDetail({ round, onEdit, onPhoto }: {
  round: RoundSnapshot;
  onEdit: () => void;
  onPhoto: () => void;
}) {
  const [leaderboardMode, setLeaderboardMode] = useState<GolfLeaderboardMode>("gross");
  const [scorecardScale, setScorecardScale] = useState(75);
  const [showScorecard, setShowScorecard] = useState(false);
  const recap = useMemo(() => buildHistoricalRoundRecap(round), [round]);
  const legacyCategories = useMemo(() => legacyOwnerCategories(round), [round]);
  const canShowLegacyCategories = round.playerBalances === undefined && round.categoryBalances === undefined;
  const issueCopy = [...new Set(recap.issues.map((issue) => issueMessages[issue.code]))];
  const safelyEditable = Boolean(recap.golf)
    && !recap.issues.some((issue) => ["invalid_geometry", "invalid_course", "invalid_players", "invalid_scores"].includes(issue.code))
    && canEditSnapshot(round);
  const duplicateSettlementNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const balance of recap.settlement?.balances || []) counts.set(balance.name, (counts.get(balance.name) || 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [recap.settlement]);
  const settlementName = (name: string, playerId: string) => duplicateSettlementNames.has(name)
    ? `${name} · ${playerId.length > 6 ? `…${playerId.slice(-6)}` : playerId}`
    : name;

  const leaderboardRows = useMemo<PrivateLeaderboardRow[]>(() => recap.golf?.leaderboard.map((player) => ({
    playerId: player.playerId,
    name: player.name,
    handicap: player.handicap,
    gross: player.gross ?? 0,
    net: player.net ?? null,
    relativeToPar: player.grossRelativeToPar ?? 0,
    thru: player.thru,
    finished: player.finished && recap.meta.lifecycleState === "completed",
  })) || [], [recap.golf, recap.meta.lifecycleState]);

  const scorecard = useMemo(() => {
    if (!recap.golf) return undefined;
    const players: Player[] = recap.golf.leaderboard.map((player) => ({
      id: player.playerId,
      name: player.name,
      handicap: player.handicap,
    }));
    const course: Course = {
      id: recap.meta.roundId || "historical-round",
      name: recap.meta.courseName || "Campo no disponible",
      teeName: recap.meta.teeName || "",
      holes: recap.golf.scorecard.map((hole) => ({
        number: hole.number,
        par: hole.par,
        strokeIndex: hole.strokeIndex,
        ...(hole.yards === undefined ? {} : { yards: hole.yards }),
      })),
    };
    const scores: Record<number, HoleScore> = {};
    for (const hole of recap.golf.scorecard) {
      const row: HoleScore = {};
      for (const player of hole.players) {
        if (player.score !== undefined) row[player.playerId] = player.score;
      }
      if (Object.keys(row).length) scores[hole.number] = row;
    }
    return { players, course, scores };
  }, [recap.golf, recap.meta.courseName, recap.meta.roundId, recap.meta.teeName]);

  const metaParts = [
    recap.meta.ownerName ? `Organizó ${recap.meta.ownerName}` : undefined,
    recap.meta.holeCount ? `${recap.meta.holeCount} hoyos` : "Hoyos no registrados",
    recap.meta.startHole ? `Salida H${recap.meta.startHole}` : undefined,
    recap.meta.teeName ? `Tee ${recap.meta.teeName}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return <div className="historicalDetail">
    <section className="card historicalHero">
      <div>
        <span className="eyebrow">RONDA GUARDADA</span>
        <h1>{recap.meta.courseName || "Campo no disponible"}</h1>
        <p>{metaParts.join(" · ")}</p>
      </div>
      <div className="historicalHeroStatus">
        {recap.meta.lifecycleState && <span>{lifecycleLabels[recap.meta.lifecycleState]}</span>}
        {recap.meta.date && <time dateTime={recap.meta.date}>{historicalDate(recap.meta.date)}</time>}
      </div>
    </section>

    {recap.financials && <section className="card historicalEconomy" aria-labelledby="historical-economy-title">
      <div className="sectionTitle"><div><h2 id="historical-economy-title">Resultado económico guardado</h2><p>Totales persistidos al cerrar la ronda; no se recalculan.</p></div></div>
      <div className="historicalEconomyGrid">
        {recap.financials.betResult !== undefined && <article><span>Balance de apuestas</span><b className={tone(recap.financials.betResult)}>{money(recap.financials.betResult)}</b></article>}
        {recap.financials.expenseTotal !== undefined && <article><span>Gastos registrados</span><b>{money(-recap.financials.expenseTotal)}</b></article>}
        {recap.financials.netResult !== undefined && <article><span>Neto del día</span><b className={tone(recap.financials.netResult)}>{money(recap.financials.netResult)}</b></article>}
      </div>
    </section>}

    {recap.golf && scorecard ? <>
      <section className="card historicalGolfResult">
        <GolfLeaderboard rows={leaderboardRows} mode={leaderboardMode} onModeChange={setLeaderboardMode} context="history" />
      </section>
      <button
        type="button"
        className="secondary historicalScorecardToggle"
        aria-expanded={showScorecard}
        aria-controls="historical-full-scorecard"
        onClick={() => setShowScorecard((visible) => !visible)}
      >{showScorecard ? "Ocultar tarjeta completa" : "Ver tarjeta completa"}</button>
      {showScorecard && <div id="historical-full-scorecard"><FullScorecard
          course={scorecard.course}
          players={scorecard.players}
          scores={scorecard.scores}
          order={recap.golf.order}
          scale={scorecardScale}
          onScale={setScorecardScale}
        /></div>}
    </> : <section className="card historicalUnavailable">
      <h2>Resultado de golf no disponible</h2>
      <p>Este registro no contiene campo, jugadores y scores suficientes para reconstruir una clasificación confiable.</p>
    </section>}

    {recap.settlement && <section className="card historicalSettlement" aria-labelledby="historical-settlement-title">
      <div className="sectionTitle"><div><h2 id="historical-settlement-title">Balance final por jugador</h2><p>Liquidación exacta guardada con la ronda. Los gastos no están incluidos.</p></div></div>
      <div className="historicalBalanceList">{recap.settlement.balances.map((balance) => <div className="historicalBalanceRow" key={balance.identityKey}>
        <span>{settlementName(balance.name, balance.playerId)}</span><b className={tone(balance.amount)}>{money(balance.amount)}</b>
      </div>)}</div>
      <div className="historicalTransfers">
        <h3>Ajustes sugeridos</h3>
        {recap.settlement.suggestedTransfers.length ? recap.settlement.suggestedTransfers.map((transfer) => <div className="historicalTransferRow" key={`${transfer.fromIdentityKey}-${transfer.toIdentityKey}`}>
          <span><b>{settlementName(transfer.fromName, transfer.fromPlayerId)}</b> → <b>{settlementName(transfer.toName, transfer.toPlayerId)}</b></span><strong>{money(transfer.amount)}</strong>
        </div>) : <div className="empty">Los balances quedaron en cero; no hay ajustes sugeridos.</div>}
        <p className="notice">{recap.settlement.notice}</p>
      </div>
    </section>}

    {recap.categoryBalances?.length ? <section className="card historicalCategories" aria-labelledby="historical-categories-title">
      <div className="sectionTitle"><div><h2 id="historical-categories-title">Desglose por modalidad</h2><p>Balances por jugador tal como quedaron guardados.</p></div></div>
      <div className="historicalCategoryList">{recap.categoryBalances.map((category) => <article key={category.category}>
        <h3>{historicalBetDisplayLabel(category.category, round.presentation)}</h3>
        {category.balances.map((balance) => <div className="historicalBalanceRow" key={`${category.category}-${balance.playerId}`}><span>{settlementName(balance.name, balance.playerId)}</span><b className={tone(balance.amount)}>{money(balance.amount)}</b></div>)}
      </article>)}</div>
    </section> : canShowLegacyCategories && legacyCategories.length ? <section className="card historicalLegacyCategories">
      <div className="sectionTitle"><div><h2>Balance por modalidad de {recap.meta.ownerName || "la persona organizadora"}</h2><p>Registro anterior: conserva la perspectiva del dueño, pero no identifica contrapartes.</p></div></div>
      {legacyCategories.map((category) => <div className="historicalBalanceRow" key={category.category}><span>{historicalBetDisplayLabel(category.category, round.presentation)}</span><b className={tone(category.amount)}>{money(category.amount)}</b></div>)}
    </section> : null}

    {recap.personalOpponents?.length ? <section className="card historicalPersonalOpponents" aria-labelledby="historical-personal-title">
      <div className="sectionTitle"><div><h2 id="historical-personal-title">Resultados personales guardados</h2><p>Perspectiva de {recap.meta.ownerName || "la persona organizadora"}; es detalle persistido y no se suma nuevamente.</p></div></div>
      <div>{recap.personalOpponents.map((result, index) => <div className="historicalPersonalRow" key={`${result.betId || result.opponentId}-${index}`}>
        <span><b>vs {result.opponentName}</b><small>{result.modeLabel || "Resultado personal"}{result.status ? ` · ${result.status === "final" ? "Final" : result.status === "partial" ? "Parcial" : "Pendiente"}` : ""}</small></span>
        <strong className={tone(result.amount)}>{money(result.amount)}</strong>
      </div>)}</div>
    </section> : null}

    {recap.playerStats?.length ? <section className="card historicalStats" aria-labelledby="historical-stats-title">
      <div className="sectionTitle"><div><h2 id="historical-stats-title">Estadísticas de la ronda</h2><p>Derivadas de scores validados; las métricas opcionales aparecen solo cuando fueron capturadas.</p></div></div>
      <div className="historicalStatsGrid">{recap.playerStats.map((player) => <article key={player.playerId}>
        <h3>{player.name}</h3>
        <div className="historicalStatRows">
          {player.scoring && <>
            <span><small>Hoyos con score</small><b>{player.scoring.scoredHoles}</b></span>
            <span><small>Pars</small><b>{player.scoring.pars}</b></span>
            <span><small>Birdies</small><b>{player.scoring.birdies}</b></span>
            <span><small>Eagles o mejor</small><b>{player.scoring.eaglesOrBetter}</b></span>
            <span><small>Bogeys</small><b>{player.scoring.bogeys}</b></span>
            <span><small>Dobles +</small><b>{player.scoring.doublesPlus}</b></span>
          </>}
          {player.putts && <span><small>Putts</small><b>{player.putts.total}</b><em>{player.putts.capturedHoles} hoyos capturados</em></span>}
          {player.advanced?.fairways && <span><small>Fairways</small><b>{percentage(player.advanced.fairways.hit, player.advanced.fairways.attempts)}</b><em>{player.advanced.fairways.hit}/{player.advanced.fairways.attempts}</em></span>}
          {player.advanced?.greensInRegulation && <span><small>GIR</small><b>{percentage(player.advanced.greensInRegulation.hit, player.advanced.greensInRegulation.attempts)}</b><em>{player.advanced.greensInRegulation.hit}/{player.advanced.greensInRegulation.attempts}</em></span>}
          {player.advanced?.penalties && <span><small>Penalidades</small><b>{player.advanced.penalties.strokes}</b><em>{player.advanced.penalties.capturedHoles} hoyos capturados</em></span>}
        </div>
      </article>)}</div>
    </section> : null}

    {issueCopy.length > 0 && <section className="card historicalDataWarning" role="status">
      <h2>Datos históricos limitados</h2>
      <ul>{issueCopy.map((message) => <li key={message}>{message}</li>)}</ul>
      <p>No se inventaron resultados ni se volvió a ejecutar el motor de apuestas.</p>
    </section>}

    <section className="card historicalActions" aria-label="Acciones de la ronda guardada">
      {round.photoId && <button type="button" className="secondary" onClick={onPhoto}>Ver tarjeta original</button>}
      {safelyEditable ? <button type="button" className="primary" onClick={onEdit}>Corregir ronda guardada</button> : <p className="notice">Registro de solo lectura: faltan datos suficientes para corregirlo sin inventar su configuración original.</p>}
    </section>
  </div>;
}
