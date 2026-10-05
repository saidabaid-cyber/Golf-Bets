"use client";

import type { ActiveRoundSummary } from "./home-dashboard";
import { BackyardIcon } from "./backyard-icon";
import { OfficialPlaySymbol } from "./app-bottom-nav";
import { Clubhouse } from "./clubhouse";
import type { ClubhouseConfig } from "../../lib/clubhouse-capabilities";
import styles from "./play-hub.module.css";

export type PlayHubProps = {
  coursePicker?: React.ReactNode; activeRound?: ActiveRoundSummary | null;
  onContinueRound: () => void; onEditRound?: () => void; onCancelRound?: () => void;
  onAiRound: () => void; onNewRound: () => void; onScoreOnly?: () => void; onTotalScore?: () => void;
  onOpenHistory: () => void; onOpenBalances: () => void; onOpenPersonalHistory: () => void;
  onOpenStats: () => void; onOpenCourses: () => void; onOpenGroups: () => void;
  onOpenRules: () => void; onOpenStandings: () => void; onOpenResults: () => void;
  onOpenGps?: () => void; clubhouseConfig?: ClubhouseConfig | null;
  onCreateGroup?: () => void;
};

function roundProgress(round: ActiveRoundSummary) {
  if (round.status === "review") return "Captura terminada · falta revisar y guardar";
  if (round.status === "setup") return `Configura ${round.totalHoles} hoyos y ${round.playerCount || "los"} jugadores`;
  return `Hoyo ${round.currentHole || "en juego"}${typeof round.playedHoles === "number" ? ` · ${round.playedHoles}/${round.totalHoles} capturados` : ""}`;
}

export function PlayHub({ coursePicker, activeRound, onContinueRound, onEditRound, onCancelRound, onAiRound, onNewRound, onScoreOnly, onTotalScore, onOpenBalances, onOpenPersonalHistory, onOpenCourses, onOpenGroups, onOpenStandings, onOpenResults, onOpenGps, clubhouseConfig, onCreateGroup }: PlayHubProps) {
  return <section className={styles.screen} aria-label="Play">
    <section className={styles.hero} aria-labelledby="play-title"><div className={styles.heroCopy}><h2 id="play-title">A jugar</h2><p>Golf es más que un juego.<br />Es donde las buenas historias<br />siempre encuentran un hoyo más.</p></div>
      <button type="button" className={styles.playAction} onClick={activeRound ? onContinueRound : onNewRound}><span className={styles.symbol}><OfficialPlaySymbol priority /></span><b>{activeRound ? "CONTINUAR RONDA" : "INICIAR RONDA"}</b></button>
      <nav className={styles.contextTools} aria-label="Herramientas de ronda"><button type="button" onClick={activeRound ? onContinueRound : onScoreOnly}><BackyardIcon name="score" /><span>Score</span></button><button type="button" onClick={activeRound ? onEditRound || onContinueRound : onNewRound}><BackyardIcon name="handicap" /><span>Apuestas</span></button><button type="button" onClick={onOpenGroups}><BackyardIcon name="players" /><span>Grupos</span></button><button type="button" disabled={activeRound?.status !== "live"} onClick={onOpenGps} title="GPS y Hole Map durante una ronda activa"><BackyardIcon name="strategy" /><span>GPS / Hole Map</span></button></nav>
    </section>
    {activeRound && <section className={styles.activeRound}><div className={styles.sectionTitle}><h2>{activeRound.courseName}</h2><small>{activeRound.roundDate}</small></div><p>{roundProgress(activeRound)}</p><div className={styles.roundActions}>{onEditRound && <button type="button" onClick={onEditRound}>EDITAR CONFIGURACIÓN</button>}{onCancelRound && <button type="button" onClick={onCancelRound}>CANCELAR RONDA</button>}{activeRound.status === "live" && <><button type="button" onClick={onOpenStandings}>Cómo vamos</button><button type="button" onClick={onOpenResults}>Resultados</button></>}</div></section>}
    <nav className={styles.recurringGroups} aria-label="Grupos recurrentes"><button type="button" onClick={onOpenGroups}><BackyardIcon name="players" /><span><b>CARGAR GRUPO</b><small>Elige quién juega hoy y carga sus apuestas habituales.</small></span><span aria-hidden="true">›</span></button>{onCreateGroup && <button type="button" onClick={onCreateGroup}><BackyardIcon name="players" /><span><b>CREAR GRUPO</b><small>Guarda tus jugadores y apuestas habituales.</small></span><span aria-hidden="true">›</span></button>}</nav>
    <Clubhouse config={clubhouseConfig} />
    {coursePicker}
    <details className={styles.roundOptions}><summary>{activeRound ? "Iniciar una nueva ronda" : "Opciones de ronda"}</summary><div className={styles.roundActions}><button type="button" onClick={onNewRound}>Configurar ronda completa</button><button type="button" onClick={onScoreOnly}>Ronda sin apuestas</button><button type="button" onClick={onTotalScore}>Subir score total</button><button type="button" onClick={onAiRound}>Configurar con Backyard AI</button></div></details>
    <div className={styles.utilityLinks}><button type="button" onClick={onOpenCourses}>Campos</button><button type="button" onClick={onOpenBalances}>Balances</button><button type="button" onClick={onOpenPersonalHistory}>Apuestas personales</button><span aria-disabled="true">Polla Live · Próximamente</span></div>
    <p className={styles.saveNotice}>Tu score se guarda primero en este dispositivo. La sincronización se reintenta cuando vuelve la conexión.</p>
  </section>;
}
