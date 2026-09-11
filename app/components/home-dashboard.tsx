"use client";

import Image from "next/image";
import type { GolfInsights, PersonalActivity, ScoredRoundInsight } from "../../lib/golf-insights";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./home-dashboard-clean.module.css";

export type ActiveRoundSummary = {
  courseName: string;
  roundDate: string;
  status: "setup" | "live" | "review";
  totalHoles: 9 | 18;
  currentHole?: number;
  playedHoles?: number;
  playerCount: number;
};

export type HomeDashboardProps = {
  displayName: string;
  avatarUrl?: string | null;
  handicap: number | null;
  activeRound?: ActiveRoundSummary | null;
  latestRound?: ScoredRoundInsight | null;
  insights: GolfInsights;
  groupCount: number;
  activity: PersonalActivity[];
  onContinueRound: () => void;
  onAiRound: () => void;
  onNewRound: () => void;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
  onOpenBalances: () => void;
  onOpenStats: () => void;
  onOpenGroups: () => void;
  onOpenSocial: () => void;
  onOpenCourses: () => void;
  onOpenRules: () => void;
  onOpenRound: (roundId: string) => void;
  onOpenActivity: (activity: PersonalActivity) => void;
};

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00-06:00` : value);
  if (Number.isNaN(date.getTime())) return "Fecha sin indicar";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(date);
}

function relativeLabel(value: number) {
  return value === 0 ? "Par" : `${value > 0 ? "+" : ""}${value} vs par`;
}

function balanceLabel(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

function activeRoundLabel(round: ActiveRoundSummary) {
  if (round.status === "review") return "Tu tarjeta está lista para revisar.";
  if (round.status === "setup") return "Retoma donde te quedaste.";
  const played = round.playedHoles;
  const current = round.currentHole;
  const validPlayed = typeof played === "number" && Number.isInteger(played) && played >= 0 && played <= round.totalHoles;
  const validCurrent = typeof current === "number" && Number.isInteger(current) && current >= 1 && current <= 18;
  return [validPlayed ? `${played} de ${round.totalHoles} hoyos capturados` : "Ronda en juego", validCurrent ? `Hoyo ${current}` : null].filter(Boolean).join(" · ");
}

function Icon({ name }: { name: "groups" | "rounds" | "stats" | "course" | "arrow" }) {
  const path = {
    groups: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    rounds: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M7 14h3M7 18h7",
    stats: "M4 20h16M7 16v-5M12 16V4M17 16V8",
    course: "M5 21V3M5 3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
    arrow: "M5 12h14M13 6l6 6-6 6",
  }[name];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}

/** Home is a launch point, not the full statistics or settings screen. */
export function HomeDashboard({
  displayName, avatarUrl, activeRound, latestRound, insights, groupCount, activity,
  onContinueRound, onAiRound, onNewRound, onOpenProfile, onOpenHistory, onOpenBalances,
  onOpenStats, onOpenGroups, onOpenSocial, onOpenCourses, onOpenRules, onOpenRound, onOpenActivity,
}: HomeDashboardProps) {
  const firstName = displayName.trim().split(/\s+/)[0] || "Golfista";
  const initial = firstName[0]?.toLocaleUpperCase("es-MX") || "G";
  const primaryLabel = activeRound?.status === "review" ? "Revisar ronda" : activeRound?.status === "setup" ? "Continuar configuración" : activeRound ? "Continuar ronda" : "Jugar una ronda";
  const hasAverage = insights.scoredRounds > 0 && typeof insights.averageScore === "number" && Number.isFinite(insights.averageScore);
  const played = activeRound?.playedHoles;
  const progress = activeRound?.status === "live" && typeof played === "number" && Number.isInteger(played) && played >= 0 && played <= activeRound.totalHoles
    ? Math.round(played / activeRound.totalHoles * 100) : null;
  const links = [
    { icon: "groups" as const, title: "Mis grupos", subtitle: groupCount > 0 ? `${groupCount} grupo${groupCount === 1 ? "" : "s"} guardado${groupCount === 1 ? "" : "s"}` : "Juega con los tuyos", action: onOpenGroups },
    { icon: "rounds" as const, title: "Mis rondas", subtitle: insights.rounds > 0 ? `${insights.rounds} ronda${insights.rounds === 1 ? "" : "s"} guardada${insights.rounds === 1 ? "" : "s"}` : "Tu historial de juego", action: onOpenHistory },
    { icon: "stats" as const, title: "Estadísticas", subtitle: "Conoce tu juego", action: onOpenStats },
    { icon: "course" as const, title: "Campos", subtitle: "Encuentra dónde jugar", action: onOpenCourses },
  ];

  return <section className={styles.home} aria-labelledby="beta-home-title" data-home-version="calm-v1">
    <header className={styles.greeting}>
      <div><h1 id="beta-home-title">Hola, {firstName}.</h1><p>Tu golf. Tu gente. A jugar.</p></div>
      <button type="button" className={styles.avatar} onClick={onOpenProfile} aria-label="Abrir mi perfil"><ProfileAvatarMedia value={avatarUrl} fallback={initial} /></button>
    </header>

    <section className={styles.playCard} aria-label={activeRound ? "Ronda abierta" : "Nueva ronda"}>
      <div className={styles.landscape}>
        <Image src="/brand/backyard-fairway-scene.svg" alt="" aria-hidden="true" fill sizes="(max-width: 760px) 100vw, 760px" priority />
        <div className={styles.heroCopy}><span className={styles.eyebrow}>{activeRound ? "TU RONDA" : "NOS VEMOS EN EL CAMPO"}</span><h2>{activeRound ? activeRound.courseName || "Tu ronda" : <>Más golf.<br />Más buenos momentos.</>}</h2><p>{activeRound ? activeRoundLabel(activeRound) : "Tú pones el grupo. Backyard te ayuda con el resto."}</p></div>
      </div>
      <div className={styles.command}>
        {progress !== null && <div className={styles.progress} role="progressbar" aria-label="Progreso de la ronda" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
        <button type="button" className={styles.primary} onClick={activeRound ? onContinueRound : onAiRound}>{primaryLabel}<Icon name="arrow" /></button>
        {activeRound ? <p className={styles.helper}>{activeRound.playerCount} jugador{activeRound.playerCount === 1 ? "" : "es"} · Retoma tu tarjeta.</p> : <><p className={styles.helper}>Con ayuda de Backyard AI, paso a paso.</p><button type="button" className={styles.manual} onClick={onNewRound}>Prefiero configurar a mano</button></>}
      </div>
    </section>

    <nav className={styles.links} aria-label="Explorar mi golf">{links.map((link) => <button type="button" className={styles.link} key={link.title} onClick={link.action}><span className={styles.linkIcon}><Icon name={link.icon} /></span><span><b>{link.title}</b><small>{link.subtitle}</small></span></button>)}</nav>

    {latestRound && <section className={styles.section} aria-labelledby="home-latest-title">
      <div className={styles.sectionHead}><h2 id="home-latest-title">Tu última ronda</h2><button type="button" className={styles.textLink} onClick={onOpenHistory}>Ver todas</button></div>
      <button type="button" className={styles.lastRound} onClick={() => onOpenRound(latestRound.id)} aria-label={`Abrir ronda en ${latestRound.courseName}`}><span><b>{latestRound.courseName}</b><small>{shortDate(latestRound.date)} · {latestRound.holeCount} hoyos{latestRound.teeName ? ` · ${latestRound.teeName}` : ""}</small></span><span className={styles.lastScore}><strong>{latestRound.gross}</strong><small>{relativeLabel(latestRound.relativeToPar)}</small></span></button>
      {hasAverage && <p className={styles.statsLine}><span><strong>{insights.averageScore!.toFixed(1)}</strong> promedio bruto{insights.scoreScopeHoles ? ` · ${insights.scoreScopeHoles} hoyos` : ""}</span><span>{insights.scoredRounds} tarjeta{insights.scoredRounds === 1 ? "" : "s"} completa{insights.scoredRounds === 1 ? "" : "s"}</span></p>}
    </section>}

    {activity.length > 0 && <section className={styles.section} aria-labelledby="home-activity-title"><div className={styles.sectionHead}><h2 id="home-activity-title">Actividad reciente</h2><button type="button" className={styles.textLink} onClick={onOpenSocial}>Ver actividad</button></div><div className={styles.activityList}>{activity.slice(0, 2).map((item) => <button type="button" className={styles.activity} key={item.id} onClick={() => onOpenActivity(item)}><span><b>{item.title}</b><small>{item.detail}</small></span><time dateTime={item.occurredAt}>{shortDate(item.occurredAt)}</time></button>)}</div></section>}

    <details className={styles.more}><summary>Más de Backyard</summary><div className={styles.moreLinks}><button type="button" onClick={onOpenBalances}><span>Balances de mis juegos</span>{typeof insights.betBalance === "number" && Number.isFinite(insights.betBalance) && <strong>{balanceLabel(insights.betBalance)}</strong>}</button><button type="button" onClick={onOpenRules}>Reglas de golf <span aria-hidden="true">→</span></button><button type="button" onClick={onOpenSocial}>Amigos y actividad <span aria-hidden="true">→</span></button></div></details>
  </section>;
}
