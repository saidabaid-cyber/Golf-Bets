"use client";

import Image from "next/image";
import type { GolfInsights, PersonalActivity, ScoredRoundInsight } from "../../lib/golf-insights";
import { BrandLockup } from "./brand-lockup";
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
  partialGross?: number;
  partialToPar?: number;
};

export type HomeDashboardProps = {
  displayName: string;
  username?: string | null;
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
  onOpenPlay: () => void;
  onOpenEquipment: () => void;
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
  return value === 0 ? "E" : `${value > 0 ? "+" : ""}${value}`;
}

function balanceLabel(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

function activeRoundLabel(round: ActiveRoundSummary) {
  if (round.status === "review") return "Tarjeta lista para revisar";
  if (round.status === "setup") return "Configuración guardada";
  const played = round.playedHoles;
  const validPlayed = typeof played === "number" && Number.isInteger(played) && played >= 0 && played <= round.totalHoles;
  return validPlayed ? `${played} de ${round.totalHoles} hoyos capturados` : "Ronda en juego";
}

type IconName = "play" | "history" | "bag" | "stats" | "profile" | "groups" | "course" | "rules" | "arrow";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    play: "M8 5v14l11-7z",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    bag: "M8 7V5a4 4 0 0 1 8 0v2M6 7h12l1 14H5zM9 11h6",
    stats: "M4 20h16M7 16v-5M12 16V4M17 16V8",
    profile: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
    groups: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    course: "M5 21V3M5 3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
    rules: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h4",
    arrow: "M5 12h14M13 6l6 6-6 6",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

/** Mobile launch point: identity, current round and the five daily actions. */
export function HomeDashboard({
  displayName, username, avatarUrl, handicap, activeRound, latestRound, insights, groupCount, activity,
  onContinueRound, onAiRound, onNewRound, onOpenPlay, onOpenEquipment, onOpenProfile, onOpenHistory,
  onOpenBalances, onOpenStats, onOpenGroups, onOpenSocial, onOpenCourses, onOpenRules, onOpenRound, onOpenActivity,
}: HomeDashboardProps) {
  const firstName = displayName.trim().split(/\s+/)[0] || "Golfista";
  const initial = firstName[0]?.toLocaleUpperCase("es-MX") || "G";
  const normalizedUsername = username?.trim().replace(/^@/, "");
  const hasAverage = insights.scoredRounds > 0 && typeof insights.averageScore === "number" && Number.isFinite(insights.averageScore);
  const played = activeRound?.playedHoles;
  const progress = activeRound?.status === "live" && typeof played === "number" && Number.isInteger(played) && played >= 0 && played <= activeRound.totalHoles
    ? Math.round(played / activeRound.totalHoles * 100) : null;
  const quickLinks = [
    { icon: "play" as const, title: "Jugar", action: activeRound ? onContinueRound : onOpenPlay },
    { icon: "history" as const, title: "Historial", action: onOpenHistory },
    { icon: "bag" as const, title: "Mi Bolsa", action: onOpenEquipment },
    { icon: "stats" as const, title: "Stats", action: onOpenStats },
    { icon: "profile" as const, title: "Perfil", action: onOpenProfile },
  ];

  return <section className={styles.home} aria-labelledby="beta-home-title" data-home-version="play-first-v2">
    <header className={styles.header}>
      <div className={styles.brandLine}><BrandLockup compact /></div>
      <button type="button" className={styles.identity} onClick={onOpenProfile} aria-label="Abrir mi perfil">
        <span className={styles.avatar}><ProfileAvatarMedia value={avatarUrl} fallback={initial} alt={`Avatar de ${displayName}`} /></span>
        <span className={styles.identityCopy}>
          <small>Hola,</small>
          <strong id="beta-home-title">{firstName}</strong>
          <span>{normalizedUsername ? `@${normalizedUsername}` : handicap === null ? "Tu golf empieza aquí" : `HCP Index ${handicap}`}</span>
        </span>
        <span className={styles.profileArrow} aria-hidden="true">›</span>
      </button>
    </header>

    <section className={`${styles.playCard} ${activeRound ? styles.activePlayCard : ""}`} aria-label={activeRound ? "Ronda activa" : "Jugar una nueva ronda"}>
      <div className={styles.landscape}>
        <Image src="/brand/backyard-fairway-scene.svg" alt="" aria-hidden="true" fill sizes="(max-width: 760px) 100vw, 760px" priority />
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{activeRound ? "RONDA ACTIVA" : "LISTO PARA EL TEE"}</span>
          <h2>{activeRound ? activeRound.courseName || "Tu ronda" : "¿Jugamos?"}</h2>
          <p>{activeRound ? activeRoundLabel(activeRound) : "Crea la ronda, arma tu grupo y sal a jugar."}</p>
          {activeRound && <div className={styles.roundFacts}>
            {typeof activeRound.currentHole === "number" && <span><small>HOYO</small><b>{activeRound.currentHole}</b></span>}
            {typeof activeRound.partialGross === "number" && <span><small>SCORE</small><b>{activeRound.partialGross}</b></span>}
            {typeof activeRound.partialToPar === "number" && <span><small>VS PAR</small><b>{relativeLabel(activeRound.partialToPar)}</b></span>}
          </div>}
        </div>
      </div>
      <div className={styles.command}>
        {progress !== null && <div className={styles.progress} role="progressbar" aria-label="Progreso de la ronda" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
        <button type="button" className={styles.primary} onClick={activeRound ? onContinueRound : onNewRound}>
          {activeRound ? "CONTINUAR RONDA" : "JUGAR"}<Icon name="arrow" />
        </button>
        {!activeRound && <button type="button" className={styles.aiAction} onClick={onAiRound}>Armar con Backyard AI</button>}
      </div>
    </section>

    <nav className={styles.quickLinks} aria-label="Accesos rápidos">{quickLinks.map((link) => <button type="button" className={styles.quickLink} key={link.title} onClick={link.action}><span><Icon name={link.icon} /></span><b>{link.title}</b></button>)}</nav>

    {latestRound && <section className={styles.section} aria-labelledby="home-latest-title">
      <div className={styles.sectionHead}><div><small>RECIENTE</small><h2 id="home-latest-title">Tu última ronda</h2></div><button type="button" className={styles.textLink} onClick={onOpenHistory}>Ver historial</button></div>
      <button type="button" className={styles.lastRound} onClick={() => onOpenRound(latestRound.id)} aria-label={`Abrir ronda en ${latestRound.courseName}`}>
        <span><b>{latestRound.courseName}</b><small>{shortDate(latestRound.date)} · {latestRound.holeCount} hoyos{latestRound.teeName ? ` · ${latestRound.teeName}` : ""}</small></span>
        <span className={styles.lastScore}><strong>{latestRound.gross}</strong><small>{relativeLabel(latestRound.relativeToPar)} vs par</small></span>
      </button>
      {hasAverage && <div className={styles.simpleStats}><span><small>PROMEDIO</small><b>{insights.averageScore!.toFixed(1)}</b></span><span><small>TARJETAS</small><b>{insights.scoredRounds}</b></span></div>}
    </section>}

    {activity.length > 0 && <section className={styles.section} aria-labelledby="home-activity-title"><div className={styles.sectionHead}><div><small>LOS TUYOS</small><h2 id="home-activity-title">Actividad reciente</h2></div><button type="button" className={styles.textLink} onClick={onOpenSocial}>Ver actividad</button></div><div className={styles.activityList}>{activity.slice(0, 2).map((item) => <button type="button" className={styles.activity} key={item.id} onClick={() => onOpenActivity(item)}><span><b>{item.title}</b><small>{item.detail}</small></span><time dateTime={item.occurredAt}>{shortDate(item.occurredAt)}</time></button>)}</div></section>}

    <details className={styles.more}><summary>Más de The Backyard</summary><div className={styles.moreLinks}>
      <button type="button" onClick={onOpenGroups}><span><Icon name="groups" /> Grupos</span><small>{groupCount > 0 ? `${groupCount} guardado${groupCount === 1 ? "" : "s"}` : "Juega con los tuyos"}</small></button>
      <button type="button" onClick={onOpenCourses}><span><Icon name="course" /> Campos</span><small>Busca dónde jugar</small></button>
      <button type="button" onClick={onOpenBalances}><span><Icon name="stats" /> Balances</span>{typeof insights.betBalance === "number" && Number.isFinite(insights.betBalance) && <small>{balanceLabel(insights.betBalance)}</small>}</button>
      <button type="button" onClick={onOpenRules}><span><Icon name="rules" /> Reglas de golf</span><small>Consulta rápida</small></button>
    </div></details>
  </section>;
}
