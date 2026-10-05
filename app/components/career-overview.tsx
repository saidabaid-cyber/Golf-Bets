"use client";
import { useMemo } from "react";
import { careerSeason, careerPrecision, careerNumber, careerDate, scoreToPar } from "../../lib/career-statistics";
import { verifiedGhinHandicapIndex } from "../../lib/handicap-source";
import type { ScoredRoundInsight } from "../../lib/golf-insights";
import type { CareerHubProps } from "./career-hub";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { CareerPanel, CareerStatCard, CareerEmptyState, CareerCta, CareerErrorState } from "./career-shared";
import styles from "./career-hub.module.css";
import { deriveCareerRivalries, rivalryTotals } from "../../lib/career-rivalries";

export function PlayerCareerCard({ displayName, avatarUrl, username, club, city, index }: CareerHubProps) {
  return <div className={styles.playerCard}><ProfileAvatarMedia value={avatarUrl} fallback={displayName.trim().slice(0, 1) || "⚑"} className={styles.avatar} /><div className={styles.playerIdentity}><h2>{displayName}</h2>{username && <p>@{username.replace(/^@/, "")}</p>}{club && <p>⌖ {club}</p>}{city && <p>{city}</p>}</div><div className={styles.index}><small>{index.source === "GHIN" ? "Handicap Index" : index.source === "BACKYARD" ? "Backyard Index" : "Índice"}</small><strong>{careerNumber(index.value, 1)}</strong>{index.value === null && <small>Sin índice disponible</small>}</div></div>;
}
export function CareerRoundRow({ row, onOpen }: { row: ScoredRoundInsight; onOpen: (id: string) => void }) {
  return <button type="button" className={styles.roundRow} onClick={() => onOpen(row.id)} aria-label={`Ver ronda en ${row.courseName}, ${careerDate(row.date)}`}><span className={styles.rowMain}><strong>{row.courseName}</strong><small>{careerDate(row.date)} · {row.holeCount} hoyos</small>{row.teeName && <small>{row.teeName}</small>}</span><span className={styles.rowScore}><strong>{row.gross}</strong><small>{scoreToPar(row.relativeToPar)} vs. par</small></span><span aria-hidden="true">›</span></button>;
}
export function CareerOverview(props: CareerHubProps) {
  const { insights, onView, onOpenRound, onCreateRound } = props;
  const year = new Date().getFullYear(), holes = insights.scoreScopeHoles ?? 18;
  const season = useMemo(() => careerSeason(insights.recentRounds, year, holes), [insights, year, holes]);
  const precision = useMemo(() => careerPrecision(props.rounds, insights, props.userId), [props.rounds, insights, props.userId]);
  const competitive = useMemo(() => rivalryTotals(deriveCareerRivalries(props.rounds,props.userId)),[props.rounds,props.userId]);
  const ghin = props.ghin?.profile, ghinIndex = verifiedGhinHandicapIndex(ghin);
  return <><PlayerCareerCard {...props} />{props.error ? <CareerErrorState onRetry={props.onRetry} /> : <>
    {insights.rounds === 0 && <CareerEmptyState title="Tu historia empieza con tu primera ronda." action="Crear ronda" onAction={onCreateRound} />}
    <div className={styles.metrics}><CareerStatCard label="Rondas jugadas" value={careerNumber(insights.rounds)} /><CareerStatCard label="Birdies" value={insights.scoredRounds ? careerNumber(insights.birdies) : undefined} hint="Tarjetas por hoyo" /><CareerStatCard label="Águilas o mejor" value={insights.scoredRounds ? careerNumber(insights.eaglesOrBetter) : undefined} /><CareerStatCard label="Mejor ronda" value={careerNumber(insights.bestScore)} hint={`${holes} hoyos · score bruto`} />{insights.betBalance !== undefined && <CareerStatCard label="Balance personal" value={insights.betBalance.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })} hint={`${insights.betRounds} rondas con resultado registrado`} />}</div>
    {competitive.matches > 0 && <div className={styles.metrics}><CareerStatCard label="Victorias" value={`${careerNumber(competitive.winRate)}%`} hint="Enfrentamientos en score bruto" /><CareerStatCard label="Mejor racha" value={competitive.bestStreak} hint="Victorias seguidas contra un rival" /></div>}
    <CareerPanel title={`Temporada ${year}`}><div className={styles.metrics}><CareerStatCard label="Score promedio" value={careerNumber(season.average, 1)} hint={`${holes} hoyos · ${season.rounds} rondas`} /><CareerStatCard label="Evolución" value={season.evolution === undefined ? undefined : `${season.evolution > 0 ? "+" : ""}${careerNumber(season.evolution, 1)}`} hint={`Golpes vs. ${year - 1}`} />{precision.gir !== undefined && <CareerStatCard label="Greens en regulación" value={`${careerNumber(precision.gir)}%`} hint={`${precision.greenAttempts} hoyos capturados`} />}</div><div className={styles.monthChart} role="img" aria-label={`Rondas por mes de ${year}: ${season.months.map(m => `${m.month}: ${m.rounds}`).join(", ")}`}>{season.months.map(m => <div key={m.month}><span>{m.rounds || ""}</span><i style={{ height: `${Math.max(3, m.rounds / Math.max(1, ...season.months.map(x => x.rounds)) * 60)}px` }} /><small>{["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][m.month - 1]}</small></div>)}</div><p className={styles.caption}>Rondas por mes · estadísticas basadas en tarjetas completas. Un periodo sin actividad conserva su espacio.</p></CareerPanel>
    <CareerPanel title="Últimas rondas" action="Ver histórico" onAction={() => onView("rounds")}>{insights.recentRounds.slice(0, 3).map(row => <CareerRoundRow key={row.id} row={row} onOpen={onOpenRound} />)}{!insights.recentRounds.length && <p className={styles.caption}>Las tarjetas completas aparecerán aquí.</p>}</CareerPanel>
  </>}
    <CareerPanel title="GHIN" action="Ver en Perfil" onAction={props.onOpenProfile}>{props.ghin?.error ? <CareerErrorState /> : ghin?.associationStatus === "VERIFIED" ? <><div className={styles.metrics}><CareerStatCard label="Handicap Index" value={careerNumber(ghinIndex, 1)} /><CareerStatCard label="Última actualización" value={ghin.lastSyncedAt ? careerDate(ghin.lastSyncedAt) : undefined} /></div><p className={styles.caption}>{ghin.syncStatus === "SUCCESS" ? "Última consulta completada." : ghin.lastErrorCode ? "La última consulta requiere atención en Perfil." : "Asociación verificada. Consulta de lectura disponible en Perfil."}</p></> : <p className={styles.caption}>{props.ghin?.enabled ? "Asocia tu cuenta GHIN desde Perfil para consultar el índice disponible." : "La consulta GHIN no está disponible en este entorno."}</p>}</CareerPanel>
    <CareerCta title="Más golf. Mejores amigos." label="Crear ronda" onAction={onCreateRound} /></>;
}
