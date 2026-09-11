"use client";

import Image from "next/image";
import type { GolfInsights } from "../../lib/golf-insights";
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
  activeRound?: ActiveRoundSummary | null;
  insights: GolfInsights;
  groupCount: number;
  onContinueRound: () => void;
  onAiRound: () => void;
  onNewRound: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  onOpenHistory: () => void;
  onOpenBalances: () => void;
  onOpenStats: () => void;
  onOpenGroups: () => void;
  onOpenRules: () => void;
};

type IconName = "bell" | "settings" | "stats" | "history" | "rules" | "swing" | "trend" | "balance" | "groups" | "arrow";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.5v-.08A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.5h.08A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4.1v.08A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.12.4.33.75.6 1 .3.28.69.42 1.1.4h.1v4.1h-.08a1.7 1.7 0 0 0-1.72 1.5",
    stats: "M4 20h16M7 16v-5M12 16V4M17 16V8",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    rules: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h4",
    swing: "M5 20c4-2 6-6 7-10M10 4l3 6 6-3M7 20h10",
    trend: "M3 18l6-6 4 3 8-9M16 6h5v5",
    balance: "M4 7h16M7 7l-3 7h6L7 7m10 0-3 7h6l-3-7M12 4v16M8 20h8",
    groups: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    arrow: "M5 12h14M13 6l6 6-6 6",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

function relativeLabel(value: number) {
  return value === 0 ? "E" : `${value > 0 ? "+" : ""}${value}`;
}

function balanceLabel(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

function activeRoundLabel(round: ActiveRoundSummary) {
  if (round.status === "review") return "Tarjeta lista para revisar";
  if (round.status === "setup") return "Configuración guardada";
  return typeof round.playedHoles === "number" ? `${round.playedHoles} de ${round.totalHoles} hoyos` : "Ronda en juego";
}

function BackyardBallMark() {
  return <span className={styles.ballMark} aria-hidden="true">
    <Image className={styles.ballLogo} src="/brand/the-backyard-logo.svg" alt="" width={763} height={631} priority />
    <span className={styles.playTriangle} />
  </span>;
}

/** Approved post-onboarding Home: two play paths, three daily shortcuts and no duplicated navigation. */
export function HomeDashboard({
  displayName, username, avatarUrl, activeRound, insights, groupCount,
  onContinueRound, onAiRound, onNewRound, onOpenProfile, onOpenSettings, onOpenNotifications,
  onOpenHistory, onOpenBalances, onOpenStats, onOpenGroups, onOpenRules,
}: HomeDashboardProps) {
  const firstName = displayName.trim().split(/\s+/)[0] || "Golfista";
  const initial = firstName[0]?.toLocaleUpperCase("es-MX") || "G";
  const normalizedUsername = username?.trim().replace(/^@/, "");
  const hasScoringInsight = insights.scoredRounds > 0 && typeof insights.averageScore === "number" && Number.isFinite(insights.averageScore);
  const hasBalance = typeof insights.betBalance === "number" && Number.isFinite(insights.betBalance);
  const playAction = activeRound ? onContinueRound : onNewRound;

  return <section className={styles.home} aria-labelledby="approved-home-title" data-home-version="approved-golf-home-v1">
    <header className={styles.header}>
      <button type="button" className={styles.identity} onClick={onOpenProfile} aria-label="Abrir mi perfil">
        <span className={styles.avatar}><ProfileAvatarMedia value={avatarUrl} fallback={initial} alt={`Avatar de ${displayName}`} /></span>
        <span className={styles.identityCopy}>
          <small>BIENVENIDO</small>
          <strong>{displayName.trim() || firstName}</strong>
          {normalizedUsername && <span>@{normalizedUsername}</span>}
        </span>
      </button>
      <div className={styles.headerActions}>
        <button type="button" onClick={onOpenNotifications} aria-label="Abrir notificaciones"><Icon name="bell" /></button>
        <button type="button" onClick={onOpenSettings} aria-label="Abrir Configuración"><Icon name="settings" /></button>
      </div>
    </header>

    <section className={styles.golfHero} aria-label={activeRound ? "Ronda activa" : "Jugar con The Backyard"}>
      <div className={styles.heroLandscape}>
        <Image src="/brand/backyard-fairway-scene.svg" alt="" aria-hidden="true" fill sizes="(max-width: 760px) 100vw, 760px" priority />
        <div className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <span>THE BACKYARD</span>
          <h1 id="approved-home-title">Buen golf hoy, {firstName}.</h1>
          <p>{activeRound ? "Tu ronda sigue lista cuando tú lo estés." : "Tu ronda, tus amigos y tus juegos en un solo lugar."}</p>
          <strong>GOOD GOLF · BETTER FRIENDS</strong>
        </div>
      </div>

      <div className={styles.playDeck}>
        {activeRound && <button type="button" className={styles.activeRound} onClick={onContinueRound}>
          <span><small>RONDA ACTIVA</small><b>{activeRound.courseName || "Tu ronda"}</b><em>{activeRoundLabel(activeRound)}</em></span>
          <span className={styles.activeRoundFacts}>
            {typeof activeRound.currentHole === "number" && <span><small>HOYO</small><b>{activeRound.currentHole}</b></span>}
            {typeof activeRound.partialGross === "number" && <span><small>SCORE</small><b>{activeRound.partialGross}</b></span>}
            {typeof activeRound.partialToPar === "number" && <span><small>VS PAR</small><b>{relativeLabel(activeRound.partialToPar)}</b></span>}
          </span>
        </button>}

        <button type="button" className={styles.ballButton} onClick={playAction} aria-label={activeRound ? "Continuar ronda" : "Configurar ronda manualmente"}>
          <BackyardBallMark />
          <span className={styles.ballActionLabel}>{activeRound ? "CONTINUAR RONDA" : "CONFIGURAR RONDA"}</span>
          <small>{activeRound ? "Retoma tu tarjeta" : "Manual"}</small>
        </button>

        <button type="button" className={styles.aiButton} onClick={onAiRound}>
          <span className={styles.aiLockup}><b>THE BACKYARD</b><strong>IA</strong></span>
          <span className={styles.aiPlay}>PLAY WITH IT <Icon name="arrow" /></span>
        </button>
      </div>
    </section>

    <nav className={styles.quickActions} aria-label="Accesos rápidos">
      <button type="button" onClick={onOpenStats}><span><Icon name="stats" /></span><b>ESTADÍSTICAS</b></button>
      <button type="button" onClick={onOpenHistory}><span><Icon name="history" /></span><b>HISTORIAL</b></button>
      <button type="button" onClick={onOpenRules}><span><Icon name="rules" /></span><b>REGLAS DE GOLF</b></button>
    </nav>

    <section className={styles.improveGrid} aria-label="Mejora tu golf">
      <article className={styles.comingSoon}>
        <span><Icon name="swing" /></span>
        <div><small>PRÓXIMAMENTE</small><b>ANÁLISIS DE SWING</b><p>Tu movimiento, cuando la herramienta esté lista.</p></div>
      </article>
      <button type="button" className={styles.improvement} onClick={onOpenStats}>
        <span><Icon name="trend" /></span>
        <div><small>TU PROGRESO</small><b>SIGUE MEJORANDO</b>{hasScoringInsight ? <p>Promedio {insights.averageScore!.toFixed(1)} · {insights.scoredRounds} tarjeta{insights.scoredRounds === 1 ? "" : "s"}</p> : <p>Tus tendencias aparecerán al guardar tarjetas completas.</p>}</div>
      </button>
    </section>

    <section className={styles.moreBackyard} aria-labelledby="more-backyard-title">
      <div className={styles.sectionTitle}><span /><h2 id="more-backyard-title">MÁS DE THE BACKYARD</h2><span /></div>
      <div className={styles.moreGrid}>
        <button type="button" onClick={onOpenBalances}><span><Icon name="balance" /></span><div><b>BALANCES</b><small>{hasBalance ? balanceLabel(insights.betBalance!) : "Resultados entre amigos"}</small></div><strong>›</strong></button>
        <button type="button" onClick={onOpenGroups}><span><Icon name="groups" /></span><div><b>GRUPOS</b><small>{groupCount > 0 ? `${groupCount} grupo${groupCount === 1 ? "" : "s"}` : "Juega con los tuyos"}</small></div><strong>›</strong></button>
      </div>
    </section>
  </section>;
}
