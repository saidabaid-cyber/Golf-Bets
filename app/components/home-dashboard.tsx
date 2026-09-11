"use client";

import Image from "next/image";
import { useState } from "react";
import type { GolfInsights } from "../../lib/golf-insights";
import { ModalShell } from "./modal-shell";
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

type IconName = "bell" | "settings" | "stats" | "history" | "rules" | "balance" | "groups" | "chevron";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string[]> = {
    bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
    settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7", "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.5v-.08A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.5h.08A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4.1v.08A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.12.4.33.75.6 1 .3.28.69.42 1.1.4h.1v4.1h-.08a1.7 1.7 0 0 0-1.72 1.5"],
    stats: ["M4 20h16", "M7 16v-5M12 16V4M17 16V8", "M5 8h4M10 6h4M15 10h4"],
    history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"],
    rules: ["M6 3h12v18H6z", "M9 7h6M9 11h6M9 15h4", "M15 18h.01"],
    balance: ["M4 8.5h14.5A2.5 2.5 0 0 1 21 11v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3h11", "M16 13h5v4h-5a2 2 0 0 1 0-4z"],
    groups: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M15 3.13a4 4 0 0 1 0 7.75", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0"],
    chevron: ["m9 18 6-6-6-6"],
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name].map((path) => <path d={path} key={path} />)}</svg>;
}

function relativeLabel(value: number) {
  return value === 0 ? "E" : `${value > 0 ? "+" : ""}${value}`;
}

function balanceLabel(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

function activeRoundLabel(round: ActiveRoundSummary) {
  if (round.status === "review") return "Tarjeta por revisar";
  if (round.status === "setup") return "Configuración guardada";
  return typeof round.playedHoles === "number" ? `${round.playedHoles}/${round.totalHoles} hoyos` : "En juego";
}

function BackyardBallAction({ activeRound, onClick }: { activeRound?: ActiveRoundSummary | null; onClick: () => void }) {
  return <button
    type="button"
    className={styles.ballButton}
    onClick={onClick}
    aria-label={activeRound ? "Continuar ronda" : "Elegir cómo armar tu ronda"}
  >
    <span className={styles.ballLogoFull} aria-hidden="true">
      <Image className={styles.ballLogo} src="/brand/the-backyard-logo.svg" alt="" width={763} height={631} preload />
    </span>
    <span className={styles.playCircle} aria-hidden="true"><span /></span>
  </button>;
}

function BackyardAiIdentity() {
  return <span className={styles.aiIdentity} aria-hidden="true">
    <span className={styles.aiBrand}>THE BACKYARD</span><span className={styles.aiBadge}>IA</span>
    <span className={styles.aiPlay}><i />PLAY WITH IT<i /></span>
  </span>;
}

function QuickCard({ icon, title, copy, onClick }: { icon: "stats" | "history" | "rules"; title: string; copy: string; onClick: () => void }) {
  return <button type="button" className={styles.quickCard} onClick={onClick}>
    <span className={styles.quickIcon}><Icon name={icon} /></span>
    <span className={styles.quickCopy}><b>{title}</b><small>{copy}</small></span>
    <span className={styles.cardChevron}><Icon name="chevron" /></span>
  </button>;
}

/** Pixel-matched post-onboarding Home. Existing callbacks remain the only navigation contract. */
export function HomeDashboard({
  displayName, avatarUrl, activeRound, insights, groupCount,
  onContinueRound, onAiRound, onNewRound, onOpenProfile, onOpenSettings, onOpenNotifications,
  onOpenHistory, onOpenBalances, onOpenStats, onOpenGroups, onOpenRules,
}: HomeDashboardProps) {
  const firstName = displayName.trim().split(/\s+/)[0] || "Golfista";
  const initial = firstName[0]?.toLocaleUpperCase("es-MX") || "G";
  const hasScoringInsight = insights.scoredRounds > 0 && typeof insights.averageScore === "number" && Number.isFinite(insights.averageScore);
  const hasBalance = typeof insights.betBalance === "number" && Number.isFinite(insights.betBalance);
  const [roundChoiceOpen, setRoundChoiceOpen] = useState(false);
  const playAction = activeRound ? onContinueRound : () => setRoundChoiceOpen(true);
  const chooseRoundSetup = (mode: "manual" | "ai") => {
    setRoundChoiceOpen(false);
    if (mode === "manual") onNewRound();
    else onAiRound();
  };

  return <><section className={styles.home} aria-labelledby="approved-home-title" data-home-version="approved-golf-home-v2">
    <section className={styles.hero} aria-label={activeRound ? "Ronda activa" : "Jugar con The Backyard"}>
      <Image className={styles.heroPhoto} src="/brand/home-hero-sunrise.jpg" alt="Campo de golf al amanecer" fill sizes="(max-width: 760px) 100vw, 760px" preload />
      <span className={styles.heroShade} aria-hidden="true" />

      <header className={styles.header}>
        <button type="button" className={styles.identity} onClick={onOpenProfile} aria-label="Abrir mi perfil">
          <span className={styles.avatar}><ProfileAvatarMedia value={avatarUrl} fallback={initial} alt={`Avatar de ${displayName}`} /></span>
          <span className={styles.identityCopy}><strong>{displayName.trim() || firstName}</strong><small>Listo para jugar 💪</small></span>
        </button>
        <div className={styles.headerActions}>
          <button type="button" className={styles.notificationButton} onClick={onOpenNotifications} aria-label="Abrir notificaciones"><Icon name="bell" /><span /></button>
          <button type="button" onClick={onOpenSettings} aria-label="Abrir Configuración"><Icon name="settings" /></button>
        </div>
      </header>

      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>THE BACKYARD <i /></span>
        <h1 id="approved-home-title">Buen golf<br /><span>hoy, <em>{firstName}</em></span></h1>
        <p>Rondas más simples.<br />Mejores amigos. Más golf.</p>
      </div>

      <BackyardBallAction activeRound={activeRound} onClick={playAction} />
      <span className={styles.friendScript} aria-hidden="true">Good<br />Golf<br />Better<br />Friends</span>

      {activeRound && <button type="button" className={styles.activeRound} onClick={onContinueRound}>
        <span><small>RONDA ACTIVA</small><b>{activeRound.courseName || "Tu ronda"}</b></span>
        <span>{typeof activeRound.currentHole === "number" ? `H${activeRound.currentHole}` : activeRoundLabel(activeRound)}{typeof activeRound.partialToPar === "number" ? ` · ${relativeLabel(activeRound.partialToPar)}` : ""}</span>
        <strong>CONTINUAR RONDA</strong>
      </button>}

      <span className={styles.heroFade} aria-hidden="true" />
    </section>

    <div className={styles.content}>
      <section className={styles.quickSection} aria-labelledby="quick-title">
        <div className={styles.sectionHeading}><h2 id="quick-title">Accesos rápidos</h2><button type="button" onClick={onOpenStats}>Ver todo <span>›</span></button></div>
        <nav className={styles.quickActions} aria-label="Accesos rápidos">
          <QuickCard icon="stats" title="Estadísticas" copy="Tu rendimiento en el campo" onClick={onOpenStats} />
          <QuickCard icon="history" title="Historial" copy="Todas tus rondas" onClick={onOpenHistory} />
          <QuickCard icon="rules" title="Reglas de golf" copy="Respuestas rápidas" onClick={onOpenRules} />
        </nav>
      </section>

      <section className={styles.promoGrid} aria-label="Mejora tu golf">
        <article className={`${styles.promoCard} ${styles.swingCard}`}>
          <Image src="/brand/home-swing.jpg" alt="Golfista terminando su swing" fill sizes="(max-width: 760px) 50vw, 360px" />
          <span className={styles.promoShade} />
          <div><b>Análisis<br />de swing</b><small className={styles.soonBadge}>PRÓXIMAMENTE</small><p>Mejora tu juego con IA.</p></div>
          <span className={styles.promoChevron}>›</span>
        </article>
        <button type="button" className={`${styles.promoCard} ${styles.progressCard}`} onClick={onOpenStats}>
          <Image src="/brand/home-golf-ball.jpg" alt="Pelota de golf sobre el césped" fill sizes="(max-width: 760px) 50vw, 360px" />
          <span className={styles.promoShade} />
          <div><b>Sigue<br />mejorando</b>{hasScoringInsight ? <p>Promedio {insights.averageScore!.toFixed(1)}<br />en {insights.scoredRounds} ronda{insights.scoredRounds === 1 ? "" : "s"}.</p> : <p>Tips, insights<br />y más golf.</p>}</div>
          <span className={styles.promoChevron}>›</span>
        </button>
      </section>

      <section className={styles.moreBackyard} aria-labelledby="more-backyard-title">
        <h2 id="more-backyard-title">Más de The Backyard</h2>
        <div className={styles.moreGrid}>
          <button type="button" onClick={onOpenBalances}><span className={styles.moreIcon}><Icon name="balance" /></span><span><b>Balances</b><small>{hasBalance ? balanceLabel(insights.betBalance!) : "Tus cuentas y liquidaciones"}</small></span><i><Icon name="chevron" /></i></button>
          <button type="button" onClick={onOpenGroups}><span className={styles.moreIcon}><Icon name="groups" /></span><span><b>Grupos</b><small>{groupCount > 0 ? `${groupCount} grupo${groupCount === 1 ? "" : "s"}` : "Juega con los tuyos"}</small></span><i><Icon name="chevron" /></i></button>
        </div>
      </section>
    </div>
  </section>

  <ModalShell open={roundChoiceOpen} onClose={() => setRoundChoiceOpen(false)} labelledBy="round-choice-title" className={styles.roundChoiceDialog}>
    <header className={styles.roundChoiceHeader}>
      <small>JUGAR</small>
      <h2 id="round-choice-title">¿CÓMO QUIERES ARMAR TU RONDA?</h2>
    </header>
    <div className={styles.roundChoices}>
      <button type="button" className={styles.manualChoice} onClick={() => chooseRoundSetup("manual")}>
        <span className={styles.choiceMark} aria-hidden="true">01</span>
        <span><strong>CONFIGURAR MANUALMENTE</strong><small>Arma tu ronda paso a paso.</small></span>
        <span className={styles.choiceChevron} aria-hidden="true">›</span>
      </button>
      <button type="button" className={styles.aiChoice} onClick={() => chooseRoundSetup("ai")}>
        <strong className={styles.aiChoiceLabel}>ARMAR CON BACKYARD AI</strong>
        <BackyardAiIdentity />
        <small>Dinos cómo quieren jugar y Backyard AI la configura.</small>
        <span className={styles.choiceChevron} aria-hidden="true">›</span>
      </button>
    </div>
  </ModalShell></>;
}
