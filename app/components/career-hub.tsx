"use client";
import { useMemo, type ReactNode } from "react";
import type { GolfInsights } from "../../lib/golf-insights";
import { deriveRoundAchievements, roundAchievementLabels } from "../../lib/round-achievements";
import type { RoundSnapshot } from "../../lib/types";
import type { SelectedHandicapIndex } from "../../lib/handicap-source";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { BottomBackAction } from "./bottom-back-action";
import styles from "./career-hub.module.css";

export type CareerHubProps = {
  displayName: string; avatarUrl?: string | null; userId: string; index: SelectedHandicapIndex;
  insights: GolfInsights; rounds: RoundSnapshot[]; ready: boolean;
  view: "friends" | "summary" | "trophy"; onView: (view: "friends" | "summary" | "trophy") => void; friends?: ReactNode;
  onOpenStats: () => void; onOpenHistory: () => void; onOpenRound: (id: string) => void;
};
export function CareerHub({ displayName, avatarUrl, userId, index, insights, rounds, ready, view, onView, friends, onOpenStats, onOpenHistory, onOpenRound }: CareerHubProps) {
  const achievements = useMemo(() => rounds.flatMap(round => {
    const summary = deriveRoundAchievements(round, rounds, userId);
    return summary ? roundAchievementLabels(summary).map(label => ({ id: round.id + ":" + label, roundId: round.id, date: round.date, course: round.courseName, label })) : [];
  }).sort((left, right) => right.date.localeCompare(left.date)), [rounds, userId]);
  const records = [
    { label: "Mejor ronda · 18 hoyos", value: insights.scoreCohorts[18]?.bestScore },
    { label: "Mejor 9 hoyos", value: insights.scoreCohorts[9]?.bestScore },
    { label: "Birdies registrados", value: insights.scoredRounds ? insights.birdies : undefined },
    { label: "Campos jugados", value: insights.rounds ? insights.coursesPlayed : undefined },
  ];
  function renderAchievements(items: typeof achievements) {
    return items.length ? <div className={styles.achievementList}>{items.map(item => <button type="button" key={item.id} onClick={() => onOpenRound(item.roundId)}><span className={styles.badge} aria-hidden="true">♜</span><span><b>{item.label}</b><small>{item.course} · {item.date}</small></span><span aria-hidden="true">›</span></button>)}</div> : <p className={styles.empty}>Tus logros aparecerán aquí cuando haya rondas completas verificables.</p>;
  }
  return <section className={styles.screen} aria-label="Carrera">
    <div className={styles.player}><ProfileAvatarMedia className={styles.avatar} value={avatarUrl} fallback={displayName.trim()[0] || "G"} /><div><b>{displayName}</b><small>Tu historia en el golf</small></div><span className={styles.index}>{index.source || "Index"}<strong>{index.value === null ? "—" : index.value.toFixed(1)}</strong></span></div>
    <nav className={styles.tabs} aria-label="Secciones de Carrera"><button type="button" aria-current={view === "friends" ? "page" : undefined} onClick={() => onView("friends")}>Amigos</button><button type="button" aria-current={view === "summary" ? "page" : undefined} onClick={() => onView("summary")}>Resumen</button><button type="button" onClick={onOpenStats}>Estadísticas</button><button type="button" onClick={onOpenHistory}>Historial</button></nav>
    {view === "friends" ? friends : !ready ? <section className={styles.panel}><h2>Preparando tu Carrera</h2><p role="status">Esperando confirmar tus preferencias de estadísticas. Tus rondas guardadas siguen en Historial.</p><button type="button" onClick={onOpenHistory}>Abrir historial</button></section> : view === "trophy" ? <>
      <button type="button" className="textButton" onClick={() => onView("summary")}>← Volver a Carrera</button>
      <section className={styles.panel}><h2>Trophy Room</h2><p className={styles.caption}>Logros y momentos respaldados por tus tarjetas.</p>{renderAchievements(achievements)}</section>
      <section className={styles.panel}><h2>Récords personales</h2><div className={styles.records}>{records.map(record => <div key={record.label}><span>{record.label}</span><b>{record.value ?? "—"}</b></div>)}</div><p className={styles.caption}>Rachas y premios del club · Próximamente.</p></section>
      <BottomBackAction label="← Volver a Carrera" onBack={() => onView("summary")} />
    </> : <>
      <div className={styles.metrics}><div><span aria-hidden="true">♜</span><b>{insights.averageScore?.toFixed(1) ?? "—"}</b><small>Score promedio{insights.scoreScopeHoles ? ` · ${insights.scoreScopeHoles}H` : ""}</small></div><div><span aria-hidden="true">⚑</span><b>{insights.greenAttempts ? Math.round(100 * insights.greensInRegulation / insights.greenAttempts) + "%" : "—"}</b><small>Greens en regulación</small></div><div><span aria-hidden="true">▥</span><b>{insights.rounds || "—"}</b><small>Rondas guardadas</small></div></div>
      <div className={styles.miniMetrics}><span>Putts promedio <b>{insights.averagePutts?.toFixed(1) ?? "—"}</b></span><button type="button" onClick={onOpenStats}>Ver estadísticas ›</button></div>
      <section className={styles.panel}><div className={styles.sectionTitle}><h2>Logros recientes</h2><button type="button" onClick={() => onView("trophy")}>Ver todos ›</button></div>{renderAchievements(achievements.slice(0, 3))}</section>
      <button type="button" className={styles.trophy} onClick={() => onView("trophy")}><span aria-hidden="true">♜</span><div><h2>Trophy Room</h2><p>Colecciona momentos.<br />No sólo scorecards.</p></div><span aria-hidden="true">›</span></button>
      <section className={styles.panel}><div className={styles.sectionTitle}><h2>Récords personales</h2><button type="button" onClick={() => onView("trophy")}>Ver todos ›</button></div><div className={styles.records}>{records.slice(0, 2).map(record => <div key={record.label}><span>{record.label}</span><b>{record.value ?? "—"}</b></div>)}</div></section>
    </>}
  </section>;
}
